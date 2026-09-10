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
    InternalServerErrorException,
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
    WorkflowHostError,
    StoryMergeConflictError,
    StoryNotFoundError,
    StoryRevisionConflictError,
    type CosmosRepository,
    type WorkflowEnvelope,
    type WorkflowHostStore,
} from "@cosmos/application";
import type { CatalogPort } from "@cosmos/application/catalog";
import type { MediaCleanupWorkflowControlService } from "@cosmos/application/media-cleanup";
import type { IngestWorkflowControlService } from "@cosmos/application/workflow-control";
import {
    createSourceCommandSchema,
    entryListQuerySchema,
    searchQuerySchema,
    idempotencyKeySchema,
    mediaCleanupCommandSchema,
    mediaCleanupRunSnapshotSchema,
    mergeStoriesCommandSchema,
    moveEntryToStoryCommandSchema,
    splitStoryCommandSchema,
    storySubtypeQuerySchema,
    addTopicMemberCommandSchema,
    createTopicCommandSchema,
    mergeTopicsCommandSchema,
    removeTopicMemberCommandSchema,
    restoreTopicMemberCommandSchema,
    updateTopicCommandSchema,
    updateTopicMemberRoleCommandSchema,
    createEntityCommandSchema,
    updateEntityCommandSchema,
    addEntityAliasCommandSchema,
    removeEntityAliasCommandSchema,
    linkStoryEntityCommandSchema,
    unlinkStoryEntityCommandSchema,
    linkEntryStoryCommandSchema,
    unlinkEntryStoryCommandSchema,
    createEntityRelationCommandSchema,
    removeEntityRelationCommandSchema,
    createLabelCommandSchema,
    labelAssignmentCommandSchema,
    createCollectionCommandSchema,
    updateCollectionCommandSchema,
    collectionItemCommandSchema,
    favoriteCommandSchema,
    createAnnotationCommandSchema,
    updateAnnotationCommandSchema,
    annotationTargetQuerySchema,
    createSavedViewCommandSchema,
    updateSavedViewCommandSchema,
    createBlockCommandSchema,
    createBoardCommandSchema,
    createSectionCommandSchema,
    moveBlockCommandSchema,
    setBlockVisibilityCommandSchema,
    updateBlockConfigCommandSchema,
    updateBoardCommandSchema,
    updateSectionCommandSchema,
    pinSpotlightCommandSchema,
    sourceActivationCommandSchema,
    sourceConfigProbeCommandSchema,
    updateStoryRevisionCommandSchema,
    updateSourceCommandSchema,
    cancelRunCommandSchema,
    recoverRunCommandSchema,
    rerunRunCommandSchema,
    runControlResultSchema,
    type CreateSourceCommand,
    type HealthResponse,
    type RunControlAction,
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
 * contracts. Anything else reaching this funnel is a server-side failure
 * (storage down, migration missing, bug) and must surface as a 500 instead
 * of masquerading as an invalid client request.
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
    if (error instanceof Error && "code" in error && error.code === "validation") {
        throw new BadRequestException({ code: "validation_failed", message: error.message, retryable: false });
    }
    throw new InternalServerErrorException({
        code: "internal_error",
        message: error instanceof Error ? error.message : "Source command failed.",
        retryable: false,
    });
}

/**
 * Error funnel for the Run control endpoints. `WorkflowHostError` codes map to
 * their HTTP contracts; anything else is a server-side failure and stays a 500.
 */
function runControlError(error: unknown): never {
    if (error instanceof ZodError) validationError(error);
    if (error instanceof WorkflowHostError) {
        switch (error.code) {
            case "not_found":
                throw new NotFoundException({ code: "not_found", message: error.message, retryable: false });
            case "conflict":
                throw new ConflictException({ code: "conflict", message: error.message, retryable: false });
            case "invalid_state":
                throw new BadRequestException({ code: "invalid_state", message: error.message, retryable: false });
            default:
                throw new InternalServerErrorException({
                    code: "internal_error",
                    message: error.message,
                    retryable: false,
                });
        }
    }
    throw error;
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
        @Inject("COSMOS_MEDIA_CLEANUP_CONTROL")
        private readonly mediaCleanupControl?: MediaCleanupWorkflowControlService,
    @Optional()
    @Inject("COSMOS_CATALOG")
    private readonly catalog?: CatalogPort,
    ) {}

    /**
     * Unsaved-input availability/schema validation is the client's
     * responsibility, so its failures are 400s even though the probe service
     * throws plain Errors; storage and other unexpected failures must not
     * inherit that status through the shared funnel.
     */
    private validateSourceDefinition(input: Pick<CreateSourceCommand, "sourceDefinitionRef" | "operationId" | "config">): void {
        try {
            this.sourceProbe.validate(input);
        } catch (error) {
            throw new BadRequestException({
                code: "validation_failed",
                message: error instanceof Error ? error.message : "Source configuration is invalid.",
                retryable: false,
            });
        }
    }

    private requireWorkflowStore(): WorkflowHostStore {
        if (!this.workflowStore) {
            throw new ConflictException({
                code: "conflict",
                message: "The durable workflow host is not enabled.",
                retryable: false,
            });
        }
        return this.workflowStore;
    }

    private toRunControlResult(
        action: RunControlAction,
        envelope: WorkflowEnvelope,
        explanation: { reuse: string; sideEffects: string },
    ) {
        return runControlResultSchema.parse({
            action,
            run: toPublicWorkflowRun(envelope),
            reuse: explanation.reuse,
            sideEffects: explanation.sideEffects,
        });
    }

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
            this.validateSourceDefinition(command);
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
                this.validateSourceDefinition({
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
                this.validateSourceDefinition({
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
            this.validateSourceDefinition(command);
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

    @Get("runs")
    @Bind(Query("sourceId"), Query("limit"))
    async listRuns(sourceId?: string, limit?: string) {
        const envelopes = await this.requireWorkflowStore().listWorkflowRuns({
            sourceId: sourceId ?? null,
            limit: clampLimit(limit),
        });
        return envelopes.map(toPublicWorkflowRun);
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

    /**
     * Run control v1 (RUN-004 / ADR-0016). Cancel and recover operate on the
     * durable WorkflowRun through the Host store; re-run enqueues a fresh ingest
     * Run. Each result explains what is reused and what new side effects follow.
     */
    @Post("runs/:runId/cancellations")
    @Bind(Param("runId"), Body())
    async cancelRun(runId: string, body: unknown) {
        try {
            const parsed = cancelRunCommandSchema.parse(body ?? {});
            const envelope = await this.requireWorkflowStore().cancelWorkflowRun({
                runId,
                reason: parsed.reason ?? null,
            });
            return this.toRunControlResult("cancelled", envelope, {
                reuse: "已入库的 Observation/Entry/Revision 保留不回滚；幂等去重保证重跑不会重复。",
                sideEffects: "取消是终态：后续 Worker 写入被拒绝，不再产生新副作用。",
            });
        } catch (error) {
            runControlError(error);
        }
    }

    @Post("runs/:runId/recoveries")
    @Bind(Param("runId"), Body())
    async recoverRun(runId: string, body: unknown) {
        try {
            recoverRunCommandSchema.parse(body ?? {});
            const envelope = await this.requireWorkflowStore().recoverWorkflowRun({ runId });
            return this.toRunControlResult("recovered", envelope, {
                reuse: "复用已持久化的进度：从最后一个安全步骤续跑，不从头重来。",
                sideEffects: "恢复后 Worker 重新认领并继续执行后续步骤（Kernel rerun）。",
            });
        } catch (error) {
            runControlError(error);
        }
    }

    @Post("runs/:runId/re-runs")
    @Bind(Param("runId"), Body(), Headers("idempotency-key"))
    async rerunRun(runId: string, body: unknown, idempotencyKey?: string) {
        try {
            rerunRunCommandSchema.parse(body ?? {});
            if (!this.workflowControl) {
                throw new ConflictException({
                    code: "conflict",
                    message: "The durable workflow host is not enabled.",
                    retryable: false,
                });
            }
            const providedKey = idempotencyKey === undefined ? undefined : requireIdempotencyKey(idempotencyKey);
            const key = providedKey ?? `rerun:${runId}:${randomUUID()}`;
            const envelope = await this.workflowControl.rerun({ runId, idempotencyKey: key });
            return this.toRunControlResult("rerun", envelope, {
                reuse: "复用已入库内容（按 external key 幂等去重），不重复写 Observation/Entry。",
                sideEffects: "从来源当前 checkpoint 重新 fetch + ingest，产生一个全新的 Run。",
            });
        } catch (error) {
            runControlError(error);
        }
    }

    /**
     * Explicit retention cleanup (ADR-0015 decision 7). The Run always runs in
     * the Worker; `dryRun` defaults to true so a preview never deletes anything.
     */
    @Post("media-cleanups")
    @Bind(Body(), Headers("idempotency-key"))
    async createMediaCleanup(body: unknown, idempotencyKey?: string) {
        if (!this.mediaCleanupControl) {
            throw new ConflictException({
                code: "conflict",
                message: "The durable workflow host is not enabled.",
                retryable: false,
            });
        }
        try {
            const command = mediaCleanupCommandSchema.parse(body ?? {});
            const providedKey = idempotencyKey === undefined
                ? undefined
                : requireIdempotencyKey(idempotencyKey);
            const key = providedKey ?? `media-cleanup:${randomUUID()}`;
            const envelope = await this.mediaCleanupControl.enqueue({
                sourceId: command.sourceId ?? null,
                dryRun: command.dryRun ?? true,
                idempotencyKey: key,
            });
            return this.toMediaCleanupSnapshot(envelope);
        } catch (error) {
            if (error instanceof WorkflowHostConflictError) {
                throw new ConflictException({
                    code: "conflict",
                    message: error.message,
                    retryable: false,
                });
            }
            if (error instanceof ZodError) {
                throw new BadRequestException({
                    code: "validation_failed",
                    message: error.message,
                    retryable: false,
                });
            }
            throw error;
        }
    }

    @Get("media-cleanups/:runId")
    @Bind(Param("runId"))
    async mediaCleanup(runId: string) {
        const envelope = await this.workflowStore?.loadWorkflowEnvelope(runId);
        if (!envelope) {
            throw new NotFoundException({
                code: "not_found",
                message: `Media cleanup run not found: ${runId}`,
                retryable: false,
            });
        }
        return this.toMediaCleanupSnapshot(envelope);
    }

    private async toMediaCleanupSnapshot(envelope: WorkflowEnvelope) {
        const report = await this.repository.getMediaCleanupReport(envelope.runId);
        const parsedProductRun = productRunSchema.safeParse(envelope.productRun);
        return mediaCleanupRunSnapshotSchema.parse({
            runId: envelope.runId,
            status: toProductWorkflowRunStatus(envelope.status),
            report,
            error: parsedProductRun.success ? parsedProductRun.data.error ?? null : null,
        });
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

    @Post("stories/:storyId/entry-moves")
    @Bind(Param("storyId"), Body())
    async moveEntryToStory(storyId: string, body: unknown) {
        try {
            const parsed = moveEntryToStoryCommandSchema.parse(body);
            const result = await this.repository.moveEntryToStory({
                entryId: parsed.entryId,
                storyId,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
            if (!result) {
                throw new NotFoundException({
                    code: "not_found",
                    message: `Entry not found: ${parsed.entryId}`,
                    retryable: false,
                });
            }
            return result;
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("stories/:storyId/revisions")
    @Bind(Param("storyId"), Body())
    async updateStoryRevision(storyId: string, body: unknown) {
        try {
            const parsed = updateStoryRevisionCommandSchema.parse(body);
            const result = await this.repository.updateStoryRevision({
                storyId,
                baseRevisionId: parsed.baseRevisionId,
                title: parsed.title,
                summary: parsed.summary ?? null,
                kind: parsed.kind,
                subtype: parsed.subtype ?? null,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
            return result;
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("stories/merges")
    @Bind(Body())
    async mergeStories(body: unknown) {
        try {
            const parsed = mergeStoriesCommandSchema.parse(body);
            const result = await this.repository.mergeStories({
                canonicalStoryId: parsed.canonicalStoryId,
                obsoleteStoryIds: parsed.obsoleteStoryIds,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
            return result;
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("stories/:storyId/splits")
    @Bind(Param("storyId"), Body())
    async splitStory(storyId: string, body: unknown) {
        try {
            const parsed = splitStoryCommandSchema.parse(body);
            const result = await this.repository.splitStory({
                storyId,
                successors: parsed.successors.map((successor) => ({
                    title: successor.title,
                    summary: successor.summary ?? null,
                    kind: successor.kind,
                    subtype: successor.subtype ?? null,
                    entryIds: successor.entryIds,
                    evidenceEntryIds: successor.evidenceEntryIds,
                    entityIds: successor.entityIds,
                    topicIds: successor.topicIds,
                })),
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
            return result;
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("story-subtypes")
    @Bind(Query("kind"))
    async listStorySubtypes(kind?: string) {
        try {
            const parsed = storySubtypeQuerySchema.parse({ kind });
            const items = await this.repository.listStorySubtypes({ kind: parsed.kind });
            return catalogPage(items);
        } catch (error) {
            validationError(error);
        }
    }

    @Get("topics")
    @Bind(Query("cursor"), Query("limit"))
    async listTopics(cursor?: string, limit?: string) {
        return this.repository.listTopics({
            cursor,
            limit: clampLimit(limit),
        });
    }

    @Get("topics/:topicId")
    @Bind(Param("topicId"))
    async topic(topicId: string) {
        const result = await this.repository.topic(topicId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Topic not found: ${topicId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("topics")
    @Bind(Body())
    async createTopic(body: unknown) {
        try {
            const parsed = createTopicCommandSchema.parse(body);
            return await this.repository.createTopic({
                title: parsed.title,
                purpose: parsed.purpose,
                scope: parsed.scope ?? null,
                seedStoryId: parsed.seedStoryId ?? null,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("topics/:topicId/revisions")
    @Bind(Param("topicId"), Body())
    async updateTopic(topicId: string, body: unknown) {
        try {
            const parsed = updateTopicCommandSchema.parse(body);
            return await this.repository.updateTopic({
                topicId,
                baseRevisionId: parsed.baseRevisionId,
                title: parsed.title,
                purpose: parsed.purpose,
                scope: parsed.scope ?? null,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("topics/merges")
    @Bind(Body())
    async mergeTopics(body: unknown) {
        try {
            const parsed = mergeTopicsCommandSchema.parse(body);
            return await this.repository.mergeTopics({
                canonicalTopicId: parsed.canonicalTopicId,
                obsoleteTopicIds: parsed.obsoleteTopicIds,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("topics/:topicId/members")
    @Bind(Param("topicId"), Body())
    async addTopicMember(topicId: string, body: unknown) {
        try {
            const parsed = addTopicMemberCommandSchema.parse(body);
            return await this.repository.addTopicMember({
                topicId,
                storyId: parsed.storyId,
                role: parsed.role,
                reason: parsed.reason ?? null,
                actor: parsed.actor ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("topics/:topicId/member-role-updates")
    @Bind(Param("topicId"), Body())
    async updateTopicMemberRole(topicId: string, body: unknown) {
        try {
            const parsed = updateTopicMemberRoleCommandSchema.parse(body);
            return await this.repository.updateTopicMemberRole({
                topicId,
                storyId: parsed.storyId,
                role: parsed.role,
                reason: parsed.reason ?? null,
                actor: parsed.actor ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("topics/:topicId/member-removals")
    @Bind(Param("topicId"), Body())
    async removeTopicMember(topicId: string, body: unknown) {
        try {
            const parsed = removeTopicMemberCommandSchema.parse(body);
            return await this.repository.removeTopicMember({
                topicId,
                storyId: parsed.storyId,
                reason: parsed.reason ?? null,
                actor: parsed.actor ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("topics/:topicId/member-restorations")
    @Bind(Param("topicId"), Body())
    async restoreTopicMember(topicId: string, body: unknown) {
        try {
            const parsed = restoreTopicMemberCommandSchema.parse(body);
            return await this.repository.restoreTopicMember({
                topicId,
                storyId: parsed.storyId,
                role: parsed.role,
                reason: parsed.reason ?? null,
                actor: parsed.actor ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("entities")
    @Bind(Query("cursor"), Query("limit"))
    async listEntities(cursor?: string, limit?: string) {
        return this.repository.listEntities({
            cursor,
            limit: clampLimit(limit),
        });
    }

    @Get("entities/:entityId")
    @Bind(Param("entityId"))
    async entity(entityId: string) {
        const result = await this.repository.entity(entityId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Entity not found: ${entityId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("entities")
    @Bind(Body())
    async createEntity(body: unknown) {
        try {
            const parsed = createEntityCommandSchema.parse(body);
            return await this.repository.createEntity({
                name: parsed.name,
                type: parsed.type,
                alias: parsed.alias ?? null,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("entities/:entityId/revisions")
    @Bind(Param("entityId"), Body())
    async updateEntity(entityId: string, body: unknown) {
        try {
            const parsed = updateEntityCommandSchema.parse(body);
            return await this.repository.updateEntity({
                entityId,
                baseRevisionId: parsed.baseRevisionId,
                name: parsed.name,
                type: parsed.type,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("entities/:entityId/aliases")
    @Bind(Param("entityId"), Body())
    async addEntityAlias(entityId: string, body: unknown) {
        try {
            const parsed = addEntityAliasCommandSchema.parse(body);
            return await this.repository.addEntityAlias({
                entityId,
                name: parsed.name,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("entities/:entityId/alias-removals")
    @Bind(Param("entityId"), Body())
    async removeEntityAlias(entityId: string, body: unknown) {
        try {
            const parsed = removeEntityAliasCommandSchema.parse(body);
            return await this.repository.removeEntityAlias({
                entityId,
                name: parsed.name,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("story-entity-links")
    @Bind(Body())
    async linkStoryEntity(body: unknown) {
        try {
            const parsed = linkStoryEntityCommandSchema.parse(body);
            return await this.repository.linkStoryEntity({
                storyId: parsed.storyId,
                entityId: parsed.entityId,
                producer: parsed.producer ?? null,
                producerVersion: parsed.producerVersion ?? null,
                confidence: parsed.confidence ?? null,
                evidence: parsed.evidence ?? null,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("story-entity-links/removals")
    @Bind(Body())
    async unlinkStoryEntity(body: unknown) {
        try {
            const parsed = unlinkStoryEntityCommandSchema.parse(body);
            return await this.repository.unlinkStoryEntity({
                storyId: parsed.storyId,
                entityId: parsed.entityId,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("entry-story-links")
    @Bind(Body())
    async linkEntryStory(body: unknown) {
        try {
            const parsed = linkEntryStoryCommandSchema.parse(body);
            return await this.repository.linkEntryStory({
                entryId: parsed.entryId,
                storyId: parsed.storyId,
                relationType: parsed.relationType,
                producer: parsed.producer ?? null,
                producerVersion: parsed.producerVersion ?? null,
                confidence: parsed.confidence ?? null,
                evidence: parsed.evidence ?? null,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("entry-story-links/removals")
    @Bind(Body())
    async unlinkEntryStory(body: unknown) {
        try {
            const parsed = unlinkEntryStoryCommandSchema.parse(body);
            return await this.repository.unlinkEntryStory({
                entryId: parsed.entryId,
                storyId: parsed.storyId,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("entity-relations")
    @Bind(Body())
    async createEntityRelation(body: unknown) {
        try {
            const parsed = createEntityRelationCommandSchema.parse(body);
            return await this.repository.createEntityRelation({
                fromEntityId: parsed.fromEntityId,
                toEntityId: parsed.toEntityId,
                relationType: parsed.relationType,
                producer: parsed.producer ?? null,
                producerVersion: parsed.producerVersion ?? null,
                confidence: parsed.confidence ?? null,
                evidence: parsed.evidence ?? null,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("entity-relations/removals")
    @Bind(Body())
    async removeEntityRelation(body: unknown) {
        try {
            const parsed = removeEntityRelationCommandSchema.parse(body);
            return await this.repository.removeEntityRelation({
                fromEntityId: parsed.fromEntityId,
                toEntityId: parsed.toEntityId,
                relationType: parsed.relationType,
                actor: parsed.actor ?? null,
                reason: parsed.reason ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    // ---- User organization v1 (ADR-0009): Label / Collection / Favorite ----

    @Get("labels")
    async listLabels() {
        return this.repository.listLabels();
    }

    @Get("labels/:labelId")
    @Bind(Param("labelId"))
    async label(labelId: string) {
        const result = await this.repository.label(labelId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Label not found: ${labelId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("labels")
    @Bind(Body())
    async createLabel(body: unknown) {
        try {
            const parsed = createLabelCommandSchema.parse(body);
            return await this.repository.createLabel({ name: parsed.name });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("labels/:labelId/removals")
    @Bind(Param("labelId"))
    async deleteLabel(labelId: string) {
        try {
            await this.repository.deleteLabel(labelId);
            return { ok: true, id: labelId, action: "label.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("label-assignments")
    @Bind(Body())
    async attachLabel(body: unknown) {
        try {
            const parsed = labelAssignmentCommandSchema.parse(body);
            await this.repository.attachLabel({
                labelId: parsed.labelId,
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
            return { ok: true, id: parsed.labelId, action: "label.assigned" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("label-assignments/removals")
    @Bind(Body())
    async detachLabel(body: unknown) {
        try {
            const parsed = labelAssignmentCommandSchema.parse(body);
            await this.repository.detachLabel({
                labelId: parsed.labelId,
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
            return { ok: true, id: parsed.labelId, action: "label.unassigned" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("collections")
    @Bind(Query("storyId"))
    async listCollections(storyId?: string) {
        return this.repository.listCollections(storyId ? { storyId } : {});
    }

    @Get("collections/:collectionId")
    @Bind(Param("collectionId"))
    async collection(collectionId: string) {
        const result = await this.repository.collection(collectionId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Collection not found: ${collectionId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("collections")
    @Bind(Body())
    async createCollection(body: unknown) {
        try {
            const parsed = createCollectionCommandSchema.parse(body);
            return await this.repository.createCollection({
                name: parsed.name,
                description: parsed.description ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("collections/:collectionId")
    @Bind(Param("collectionId"), Body())
    async updateCollection(collectionId: string, body: unknown) {
        try {
            const parsed = updateCollectionCommandSchema.parse(body);
            return await this.repository.updateCollection({
                collectionId,
                name: parsed.name,
                description: parsed.description ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("collections/:collectionId/removals")
    @Bind(Param("collectionId"))
    async deleteCollection(collectionId: string) {
        try {
            await this.repository.deleteCollection(collectionId);
            return { ok: true, id: collectionId, action: "collection.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("collections/:collectionId/items")
    @Bind(Param("collectionId"), Body())
    async addCollectionItem(collectionId: string, body: unknown) {
        try {
            const parsed = collectionItemCommandSchema.parse(body);
            await this.repository.addCollectionItem({
                collectionId,
                storyId: parsed.storyId,
            });
            return { ok: true, id: collectionId, action: "collection.item_added" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("collections/:collectionId/items/removals")
    @Bind(Param("collectionId"), Body())
    async removeCollectionItem(collectionId: string, body: unknown) {
        try {
            const parsed = collectionItemCommandSchema.parse(body);
            await this.repository.removeCollectionItem({
                collectionId,
                storyId: parsed.storyId,
            });
            return { ok: true, id: collectionId, action: "collection.item_removed" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("favorites")
    async listFavorites() {
        return this.repository.listFavorites();
    }

    @Post("favorites")
    @Bind(Body())
    async setFavorite(body: unknown) {
        try {
            const parsed = favoriteCommandSchema.parse(body);
            await this.repository.setFavorite({
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
            return { ok: true, id: parsed.targetId, action: "favorite.set" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("favorites/removals")
    @Bind(Body())
    async unsetFavorite(body: unknown) {
        try {
            const parsed = favoriteCommandSchema.parse(body);
            await this.repository.unsetFavorite({
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
            return { ok: true, id: parsed.targetId, action: "favorite.unset" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("annotations")
    @Bind(Query())
    async listAnnotations(query: Record<string, unknown>) {
        try {
            const parsed = annotationTargetQuerySchema.parse(query);
            return await this.repository.listAnnotations({
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("annotations")
    @Bind(Body())
    async createAnnotation(body: unknown) {
        try {
            const parsed = createAnnotationCommandSchema.parse(body);
            return await this.repository.createAnnotation({
                targetType: parsed.targetType,
                targetId: parsed.targetId,
                body: parsed.body,
                quote: parsed.quote ?? null,
                evidence: parsed.evidence ?? null,
                actor: parsed.actor ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("annotations/:annotationId")
    @Bind(Param("annotationId"), Body())
    async updateAnnotation(annotationId: string, body: unknown) {
        try {
            const parsed = updateAnnotationCommandSchema.parse(body);
            return await this.repository.updateAnnotation({
                annotationId,
                body: parsed.body,
                quote: parsed.quote ?? null,
                evidence: parsed.evidence ?? null,
                actor: parsed.actor ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("annotations/:annotationId/removals")
    @Bind(Param("annotationId"))
    async deleteAnnotation(annotationId: string) {
        try {
            await this.repository.deleteAnnotation(annotationId);
            return { ok: true, id: annotationId, action: "annotation.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("saved-views")
    async listSavedViews() {
        return this.repository.listSavedViews();
    }

    @Post("saved-views")
    @Bind(Body())
    async createSavedView(body: unknown) {
        try {
            const parsed = createSavedViewCommandSchema.parse(body);
            return await this.repository.createSavedView({
                name: parsed.name,
                conditions: parsed.conditions,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("saved-views/:savedViewId")
    @Bind(Param("savedViewId"), Body())
    async updateSavedView(savedViewId: string, body: unknown) {
        try {
            const parsed = updateSavedViewCommandSchema.parse(body);
            return await this.repository.updateSavedView({
                savedViewId,
                name: parsed.name,
                conditions: parsed.conditions,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("saved-views/:savedViewId/removals")
    @Bind(Param("savedViewId"))
    async deleteSavedView(savedViewId: string) {
        try {
            await this.repository.deleteSavedView(savedViewId);
            return { ok: true, id: savedViewId, action: "saved_view.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    // ------------------------------------------------------------------
    // Configurable dashboard (ADR-0010). Tree writes return the full board
    // detail so a client refreshes from one response; block config whitelist
    // validation happens at the storage boundary and surfaces as 400.
    // ------------------------------------------------------------------

    @Get("boards")
    async listBoards() {
        return this.repository.listBoards();
    }

    @Post("boards/ensure-default")
    async ensureDefaultBoard() {
        try {
            return await this.repository.ensureDefaultBoard();
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("boards/:boardId")
    @Bind(Param("boardId"))
    async board(boardId: string) {
        const result = await this.repository.getBoard(boardId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Board not found: ${boardId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("boards")
    @Bind(Body())
    async createBoard(body: unknown) {
        try {
            const parsed = createBoardCommandSchema.parse(body);
            return await this.repository.createBoard(parsed);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("boards/:boardId")
    @Bind(Param("boardId"), Body())
    async updateBoard(boardId: string, body: unknown) {
        try {
            const parsed = updateBoardCommandSchema.parse(body);
            return await this.repository.updateBoard({ boardId, ...parsed });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("boards/:boardId/removals")
    @Bind(Param("boardId"))
    async deleteBoard(boardId: string) {
        try {
            await this.repository.deleteBoard(boardId);
            return { ok: true, id: boardId, action: "board.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-sections")
    @Bind(Body())
    async createBoardSection(body: unknown) {
        try {
            const parsed = createSectionCommandSchema.parse(body);
            return await this.repository.createSection(parsed);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("board-sections/:sectionId")
    @Bind(Param("sectionId"), Body())
    async updateBoardSection(sectionId: string, body: unknown) {
        try {
            const parsed = updateSectionCommandSchema.parse(body);
            return await this.repository.updateSection({
                sectionId,
                title: parsed.title,
                position: parsed.position ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-sections/:sectionId/removals")
    @Bind(Param("sectionId"))
    async deleteBoardSection(sectionId: string) {
        try {
            await this.repository.deleteSection(sectionId);
            return { ok: true, id: sectionId, action: "board_section.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks")
    @Bind(Body())
    async createBoardBlock(body: unknown) {
        try {
            const parsed = createBlockCommandSchema.parse(body);
            return await this.repository.createBlock(parsed);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("board-blocks/:blockId")
    @Bind(Param("blockId"), Body())
    async updateBoardBlockConfig(blockId: string, body: unknown) {
        try {
            const parsed = updateBlockConfigCommandSchema.parse(body);
            return await this.repository.updateBlockConfig({
                blockId,
                config: parsed.config,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks/:blockId/moves")
    @Bind(Param("blockId"), Body())
    async moveBoardBlock(blockId: string, body: unknown) {
        try {
            const parsed = moveBlockCommandSchema.parse(body);
            return await this.repository.moveBlock({ blockId, ...parsed });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks/:blockId/visibility")
    @Bind(Param("blockId"), Body())
    async setBoardBlockVisibility(blockId: string, body: unknown) {
        try {
            const parsed = setBlockVisibilityCommandSchema.parse(body);
            return await this.repository.setBlockVisibility({
                blockId,
                visible: parsed.visible,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks/:blockId/duplications")
    @Bind(Param("blockId"))
    async duplicateBoardBlock(blockId: string) {
        try {
            return await this.repository.duplicateBlock(blockId);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks/:blockId/removals")
    @Bind(Param("blockId"))
    async deleteBoardBlock(blockId: string) {
        try {
            await this.repository.deleteBlock(blockId);
            return { ok: true, id: blockId, action: "board_block.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("spotlight-placements")
    @Bind(Query("boardId"))
    async listSpotlightPlacements(boardId?: string) {
        return this.repository.listSpotlightPlacements({ boardId: boardId ?? null });
    }

    @Post("spotlight-placements")
    @Bind(Body())
    async pinSpotlight(body: unknown) {
        try {
            const parsed = pinSpotlightCommandSchema.parse(body);
            return await this.repository.createSpotlightPlacement(parsed);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("spotlight-placements/:placementId/removals")
    @Bind(Param("placementId"))
    async unpinSpotlight(placementId: string) {
        try {
            await this.repository.deleteSpotlightPlacement(placementId);
            return { ok: true, id: placementId, action: "spotlight_placement.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
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
    // Per-source media policy (ADR-0014); absent means "follow the default".
    if (source.config.media !== undefined) {
        config.media = source.config.media;
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
