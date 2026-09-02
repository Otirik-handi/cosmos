import "reflect-metadata";
import {
    BadRequestException,
    ConflictException,
    Bind,
    Controller,
    Get,
    Header,
    HttpCode,
    Inject,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    Body,
    StreamableFile,
    Headers,
    Sse,
    Optional,
    type MessageEvent,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { z, ZodError } from "zod";

import {
    createHealthSnapshot,
    WorkflowHostConflictError,
    type CosmosRepository,
    type WorkflowEnvelope,
    type WorkflowHostStore,
} from "@cosmos/application";
import type { CatalogPort } from "@cosmos/application/catalog";
import type { IngestWorkflowControlService } from "@cosmos/application/workflow-control";
import {
    createSourceCommandSchema,
    entryListQuerySchema,
    searchQuerySchema,
    idempotencyKeySchema,
    sourceActivationCommandSchema,
    sourceConfigProbeCommandSchema,
    updateSourceCommandSchema,
    type HealthResponse,
    type RunStatus,
    type SourceSnapshot,
} from "@cosmos/contracts";
import type { Logger } from "@cosmos/logging";
import { SourceProbeService } from "./source-probe.service.js";

const productRunSchema = z.object({
    sourceId: z.string().nullable().optional(),
    triggerKind: z.enum(["manual", "schedule"]).optional(),
    itemCount: z.number().int().nonnegative().optional(),
    createdEntryCount: z.number().int().nonnegative().optional(),
    revisedEntryCount: z.number().int().nonnegative().optional(),
    error: z.string().nullable().optional(),
}).passthrough();

function validationError(error: unknown): never {
    if (error instanceof ZodError) {
        throw new BadRequestException({
            code: "validation_failed",
            message: "Request validation failed.",
            details: error.flatten(),
            retryable: false,
        });
    }
    throw error;
}

function requireIdempotencyKey(rawHeader?: string): string {
    const parsed = idempotencyKeySchema.safeParse(rawHeader ?? "");
    if (!parsed.success) {
        throw new BadRequestException({
            code: "validation_failed",
            message: "Idempotency-Key must be 1-300 characters.",
            retryable: false,
        });
    }
    return parsed.data;
}

/**
 * Single error funnel for the Source write endpoints: schema issues become
 * validation failures, storage not-found/conflict codes map to their HTTP
 * contracts, and anything else is a validation failure with the original
 * message preserved.
 */
function sourceCommandError(error: unknown): never {
    if (error instanceof ZodError) validationError(error);
    if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
    }
    if (error instanceof Error && "code" in error && error.code === "not_found") {
        throw new NotFoundException({ code: "not_found", message: error.message, retryable: false });
    }
    if (error instanceof Error && "code" in error && error.code === "conflict") {
        throw new ConflictException({ code: "conflict", message: error.message, retryable: false });
    }
    throw new BadRequestException({
        code: "validation_failed",
        message: error instanceof Error ? error.message : "Source configuration is invalid.",
        retryable: false,
    });
}

@Controller()
export class AppController {
    constructor(
        @Inject("COSMOS_PRODUCT_PORT")
        private readonly repository: CosmosRepository,
        @Inject(SourceProbeService)
        private readonly sourceProbe: SourceProbeService,
        @Optional()
        @Inject("COSMOS_LOGGER")
        private readonly logger?: Logger,
        @Optional()
        @Inject("COSMOS_WORKFLOW_CONTROL")
        private readonly workflowControl?: IngestWorkflowControlService,
        @Optional()
        @Inject("COSMOS_WORKFLOW_STORE")
        private readonly workflowStore?: WorkflowHostStore,
        @Optional()
        @Inject("COSMOS_CATALOG")
        private readonly catalog?: CatalogPort,
    ) {}

    @Get("health")
    async health(): Promise<HealthResponse> {
        const state = await this.repository.health();
        return createHealthSnapshot({
            version: process.env.COSMOS_VERSION ?? "0.1.0",
            ...state,
        });
    }

    @Get("connectors")
    connectors() {
        return this.sourceProbe.list();
    }


    @Get("source-definitions")
    sourceDefinitions() {
        return catalogPage(this.catalog?.listSourceDefinitions() ?? []);
    }

    @Get("source-definitions/:id")
    @Bind(Param("id"))
    sourceDefinition(id: string) {
        const result = this.catalog?.getSourceDefinition(id);
        if (!result) throw new NotFoundException({ code: "not_found", message: `Source definition not found: ${id}`, retryable: false });
        return result;
    }

    @Get("workflow-definitions")
    workflowDefinitions() {
        return catalogPage(this.catalog?.listWorkflowDefinitions() ?? []);
    }

    @Get("workflow-definitions/:id/versions/:version")
    @Bind(Param("id"), Param("version"))
    workflowDefinition(id: string, version: string) {
        const parsedVersion = parsePositiveInteger(version);
        const result = this.catalog?.getWorkflowDefinition(id, parsedVersion);
        if (!result) throw new NotFoundException({ code: "not_found", message: `Workflow definition not found: ${id}@${version}`, retryable: false });
        return result;
    }

    @Get("action-definitions")
    actionDefinitions() {
        return catalogPage(this.catalog?.listActionDefinitions() ?? []);
    }

    @Get("action-definitions/:id/versions/:version")
    @Bind(Param("id"), Param("version"))
    actionDefinition(id: string, version: string) {
        const parsedVersion = parsePositiveInteger(version);
        const result = this.catalog?.getActionDefinition(id, parsedVersion);
        if (!result) throw new NotFoundException({ code: "not_found", message: `Action definition not found: ${id}@${version}`, retryable: false });
        return result;
    }

    @Get("capabilities")
    capabilities() {
        return {
            productProtocolVersion: "1",
            workerProtocolVersions: ["1"],
            features: {
                sourceDefinitions: { status: "enabled", version: "1" },
                workflowDefinitions: { status: "enabled", version: "1" },
                actionDefinitions: { status: "enabled", version: "1" },
                workflowIngest: { status: "enabled", version: "1" },
            },
            limits: {
                maxPageSize: 100,
                maxInlineValueBytes: 64 * 1024,
                maxUploadBytes: null,
                sseReplayLimit: Number(process.env.COSMOS_SSE_REPLAY_LIMIT ?? "100"),
            },
            serverTime: new Date().toISOString(),
        };
    }
    @Get("sources")
    async sources() {
        return (await this.repository.listSources()).map(toPublicSource);
    }

    @Get("sources/:sourceId")
    @Bind(Param("sourceId"))
    async source(sourceId: string) {
        const source = await this.repository.getSource(sourceId);
        if (!source) {
            throw new NotFoundException({
                code: "not_found",
                message: `Source not found: ${sourceId}`,
                retryable: false,
            });
        }
        return toPublicSource(source);
    }

    @Post("sources")
    @Bind(Body())
    async createSource(body: unknown) {
        try {
            const command = createSourceCommandSchema.parse(body);
            this.sourceProbe.validate(command);
            return toPublicSource(await this.repository.createSource(command));
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("sources/:sourceId")
    @Bind(Param("sourceId"), Body())
    async updateSource(sourceId: string, body: unknown) {
        try {
            const input = updateSourceCommandSchema.parse(body);
            const source = await this.repository.getSource(sourceId);
            if (!source) {
                throw new NotFoundException({
                    code: "not_found",
                    message: `Source not found: ${sourceId}`,
                    retryable: false,
                });
            }
            if (input.config !== undefined) {
                this.sourceProbe.validate({
                    sourceDefinitionRef: source.sourceDefinitionRef,
                    operationId: source.operationId,
                    config: input.config,
                });
            }
            const updated = await this.repository.updateSource(sourceId, input);
            return toPublicSource(updated);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("sources/:sourceId/activation-commands")
    @Bind(Param("sourceId"), Body(), Headers("idempotency-key"))
    async activateSource(sourceId: string, body: unknown, idempotencyKey?: string) {
        try {
            const key = requireIdempotencyKey(idempotencyKey);
            const command = sourceActivationCommandSchema.parse(body);
            if (command.enabled) {
                const source = await this.repository.getSource(sourceId);
                if (!source) {
                    throw new NotFoundException({
                        code: "not_found",
                        message: `Source not found: ${sourceId}`,
                        retryable: false,
                    });
                }
                this.sourceProbe.validate({
                    sourceDefinitionRef: source.sourceDefinitionRef,
                    operationId: source.operationId,
                    config: source.config,
                });
            }
            return toPublicSource(await this.repository.activateSource({
                ...command,
                sourceId,
                idempotencyKey: key,
            }));
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("sources/:sourceId/test")
    @HttpCode(202)
    @Bind(Param("sourceId"), Headers("idempotency-key"))
    async testSource(sourceId: string, idempotencyKey?: string) {
        const source = await this.repository.getSource(sourceId);
        if (!source) {
            throw new NotFoundException({
                code: "not_found",
                message: `Source not found: ${sourceId}`,
                retryable: false,
            });
        }
        const providedKey = idempotencyKey === undefined ? undefined : requireIdempotencyKey(idempotencyKey);
        const job = await this.repository.createProbeJob({
            sourceId,
            idempotencyKey: providedKey ?? `probe:${sourceId}:${randomUUID()}`,
        });
        this.logger?.info("job.queued", {
            jobId: job.id,
            sourceId: job.sourceId ?? sourceId,
            kind: job.kind,
            status: job.status,
        });
        return job;
    }

    /**
     * Probe an unsaved source configuration. The canonical schema validation
     * runs synchronously before the Job is created so an invalid config is a
     * 400, not a wasted Worker round-trip.
     */
    @Post("source-config-probes")
    @HttpCode(202)
    @Bind(Body(), Headers("idempotency-key"))
    async createSourceConfigProbe(body: unknown, idempotencyKey?: string) {
        try {
            const command = sourceConfigProbeCommandSchema.parse(body);
            this.sourceProbe.validate(command);
            const providedKey = idempotencyKey === undefined ? undefined : requireIdempotencyKey(idempotencyKey);
            const job = await this.repository.createConfigProbeJob({
                command,
                idempotencyKey: providedKey ?? `config-probe:${randomUUID()}`,
            });
            this.logger?.info("job.queued", {
                jobId: job.id,
                kind: job.kind,
                status: job.status,
            });
            return job;
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("source-config-probes/:jobId")
    @Bind(Param("jobId"))
    async sourceConfigProbe(jobId: string) {
        const result = await this.repository.getJob(jobId);
        if (!result || result.kind !== "source-config-probe") {
            throw new NotFoundException({
                code: "not_found",
                message: `Source config probe job not found: ${jobId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("sources/:sourceId/runs")
    @Bind(Param("sourceId"), Headers("idempotency-key"))
    async runSource(sourceId: string, idempotencyKey?: string) {
        const source = await this.repository.getSource(sourceId);
        if (!source) {
            throw new NotFoundException({
                code: "not_found",
                message: `Source not found: ${sourceId}`,
                retryable: false,
            });
        }
        if (!source.enabled) {
            throw new ConflictException({
                code: "conflict",
                message: `Source is not enabled: ${sourceId}`,
                retryable: false,
            });
        }
        const providedKey = idempotencyKey === undefined ? undefined : requireIdempotencyKey(idempotencyKey);
        const key = providedKey ?? `manual:${sourceId}:${randomUUID()}`;
        if (this.workflowControl) {
            try {
                const envelope = await this.workflowControl.enqueue({
                    sourceId,
                    triggerKind: "manual",
                    idempotencyKey: key,
                });
                const result = toPublicWorkflowRun(envelope);
                this.logger?.info("workflow.run.queued", {
                    runId: result.id,
                    sourceId,
                    triggerKind: result.triggerKind,
                    status: result.status,
                });
                return result;
            } catch (error) {
                if (error instanceof WorkflowHostConflictError) {
                    throw new ConflictException({
                        code: "conflict",
                        message: error.message,
                        retryable: false,
                    });
                }
                throw error;
            }
        }
        const run = await this.repository.createQueuedRun({
            sourceId,
            triggerKind: "manual",
            idempotencyKey: key,
        });
        this.logger?.info("run.queued", {
            runId: run.id,
            sourceId: run.sourceId ?? sourceId,
            triggerKind: run.triggerKind,
            status: run.status,
        });
        return run;
    }

    @Get("runs/:runId")
    @Bind(Param("runId"))
    async run(runId: string) {
        const envelope = await this.workflowStore?.loadWorkflowEnvelope(runId);
        if (envelope) return toPublicWorkflowRun(envelope);
        const result = await this.repository.getRun(runId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Run not found: ${runId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Get("workflow-runs/:runId")
    @Bind(Param("runId"))
    async workflowRun(runId: string) {
        return this.run(runId);
    }



    @Get("jobs/:jobId")
    @Bind(Param("jobId"))
    async job(jobId: string) {
        const result = await this.repository.getJob(jobId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Job not found: ${jobId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Get("jobs/:jobId/attempts")
    @Bind(Param("jobId"))
    async attempts(jobId: string) {
        return catalogPage(await this.repository.listWorkflowAttempts(jobId));
    }

    @Get("attempts/:attemptId")
    @Bind(Param("attemptId"))
    async attempt(attemptId: string) {
        const result = await this.repository.getWorkflowAttempt(attemptId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Attempt not found: ${attemptId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Get("feed")
    @Bind(Query("cursor"), Query("limit"))
    async feed(cursor?: string, limit?: string) {
        return this.repository.feed({
            cursor,
            limit: clampLimit(limit),
        });
    }

    @Get("search")
    @Bind(Query())
    async search(query: Record<string, unknown>) {
        try {
            return await this.repository.search(searchQuerySchema.parse(query));
        } catch (error) {
            validationError(error);
        }
    }

    @Get("entries")
    @Bind(Query())
    async entries(query: Record<string, unknown>) {
        try {
            const parsed = entryListQuerySchema.parse(query);
            return await this.repository.entries({
                sourceId: parsed.sourceId,
                cursor: parsed.cursor,
                limit: parsed.limit,
            });
        } catch (error) {
            validationError(error);
        }
    }

    @Get("stories/:storyId")
    @Bind(Param("storyId"))
    async story(storyId: string) {
        const result = await this.repository.story(storyId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Story not found: ${storyId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Get("entries/:entryId")
    @Bind(Param("entryId"))
    async entry(entryId: string) {
        const result = await this.repository.entry(entryId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Entry not found: ${entryId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Get("revisions/:revisionId")
    @Bind(Param("revisionId"))
    async revision(revisionId: string) {
        const result = await this.repository.revision(revisionId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Revision not found: ${revisionId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Get("assets/:assetId")
    @Bind(Param("assetId"))
    async asset(assetId: string) {
        const asset = await this.repository.readAsset(assetId);
        if (!asset) {
            throw new NotFoundException({
                code: "not_found",
                message: `Asset not found: ${assetId}`,
                retryable: false,
            });
        }
        return new StreamableFile(Buffer.from(asset.content), {
            type: asset.mimeType,
        });
    }

    @Sse("events")
    @Header("Cache-Control", "no-cache")
    @Header("Connection", "keep-alive")
    events(
        @Headers("last-event-id") lastEventId?: string,
        @Query("after") after?: string,
    ): Observable<MessageEvent> {
        let cursor = parseEventCursor(lastEventId ?? after);
        const replayLimit = Math.min(
            Math.max(
                Number.parseInt(
                    process.env.COSMOS_SSE_REPLAY_LIMIT ?? "100",
                    10,
                ),
                1,
            ),
            1_000,
        );

        return new Observable<MessageEvent>((subscriber) => {
            let closed = false;
            let running = false;
            let lastKeepAliveAt = 0;

            const poll = async (): Promise<void> => {
                if (closed || running) {
                    return;
                }
                running = true;
                try {
                    const events = await this.repository.events({
                        afterSequence: cursor,
                        limit: replayLimit + 1,
                    });
                    if (events.length > replayLimit) {
                        const latestEventId = String(
                            await this.repository.latestEventSequence(),
                        );
                        cursor = Number.parseInt(latestEventId, 10);
                        subscriber.next({
                            id: latestEventId,
                            type: "message",
                            data: JSON.stringify({
                                id: latestEventId,
                                type: "snapshot_required",
                                version: "v1",
                                occurredAt: new Date().toISOString(),
                                payload: {
                                    reason: "replay_limit",
                                    latestEventId,
                                },
                            }),
                        });
                    } else {
                        for (const event of events) {
                            cursor = Number.parseInt(event.id, 10);
                            subscriber.next({
                                id: event.id,
                                type: "message",
                                data: JSON.stringify(event),
                            });
                        }
                        if (
                            events.length === 0
                            && Date.now() - lastKeepAliveAt >= 10_000
                        ) {
                            lastKeepAliveAt = Date.now();
                            subscriber.next({
                                id: String(cursor),
                                type: "message",
                                data: JSON.stringify({
                                    id: String(cursor),
                                    type: "keepalive.v1",
                                    version: "v1",
                                    occurredAt: new Date().toISOString(),
                                    payload: {},
                                }),
                            });
                        }
                    }
                } catch (error) {
                    subscriber.error(error);
                } finally {
                    running = false;
                }
            };

            void poll();
            const timer = setInterval(() => {
                void poll();
            }, 500);

            return () => {
                closed = true;
                clearInterval(timer);
            };
        });
    }
}

function clampLimit(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "20", 10);
    if (!Number.isFinite(parsed)) {
        return 20;
    }
    return Math.min(Math.max(parsed, 1), 100);
}

function parseEventCursor(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "0", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function catalogPage<T>(items: readonly T[]): { items: T[]; nextCursor: null; snapshotAt: string } {
    return {
        items: [...items],
        nextCursor: null,
        snapshotAt: new Date().toISOString(),
    };
}

function parsePositiveInteger(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new BadRequestException({
            code: "validation_failed",
            message: "Version must be a positive integer.",
            retryable: false,
        });
    }
    return parsed;
}

function toPublicSource(source: SourceSnapshot) {
    const config: Record<string, unknown> = {};
    if (typeof source.config.feedUrl === "string") config.feedUrl = source.config.feedUrl;
    if (typeof source.config.scheduleIntervalMs === "number") {
        config.scheduleIntervalMs = source.config.scheduleIntervalMs;
    }
    if (source.kind === "bilibili") {
        for (const key of ["mode", "limit", "profile", "schemaVersion"] as const) {
            const value = source.config[key];
            if (value !== undefined) config[key] = value;
        }
    }
    return {
        id: source.id,
        name: source.name,
        sourceDefinitionRef: source.sourceDefinitionRef,
        operationId: source.operationId,
        connectorId: source.connectorId,
        kind: source.kind,
        config,
        enabled: source.enabled,
        revisionId: source.revisionId,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        lastRunAt: source.lastRunAt,
        lastError: source.lastError,
    };
}

function toProductWorkflowRunStatus(status: WorkflowEnvelope["status"]): RunStatus {
    switch (status) {
        case "queued":
            return "queued";
        case "running":
        case "waiting":
            return "running";
        case "completed":
            return "succeeded";
        case "failed":
            return "failed";
        case "cancelled":
            return "cancelled";
    }
}

function toPublicWorkflowRun(envelope: WorkflowEnvelope) {
    const parsedProductRun = productRunSchema.safeParse(envelope.productRun);
    const productRun = parsedProductRun.success ? parsedProductRun.data : {};
    const triggerKind = productRun.triggerKind ?? "manual";
    return {
        id: envelope.runId,
        sourceId: productRun.sourceId ?? null,
        triggerKind,
        status: toProductWorkflowRunStatus(envelope.status),
        createdAt: envelope.createdAt,
        startedAt: envelope.startedAt,
        finishedAt: envelope.finishedAt,
        itemCount: productRun.itemCount ?? 0,
        createdEntryCount: productRun.createdEntryCount ?? 0,
        revisedEntryCount: productRun.revisedEntryCount ?? 0,
        error: productRun.error ?? null,
    };
}
