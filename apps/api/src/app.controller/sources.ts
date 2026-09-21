import {
    ConflictException,
    Bind,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    Patch,
    Post,
    StreamableFile,
    Body,
    Headers,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createHealthSnapshot, WorkflowHostConflictError } from "@cosmos/application";
import {
    createSourceCommandSchema,
    deleteSourceCommandSchema,
    sourceActivationCommandSchema,
    sourceConfigProbeCommandSchema,
    updateSourceCommandSchema,
    createConnectionCommandSchema,
    updateConnectionCommandSchema,
    type HealthResponse,
} from "@cosmos/contracts";
import "reflect-metadata";
import { AppControllerBase } from "./base.js";
import { requireIdempotencyKey, sourceCommandError, connectionError, catalogPage, parsePositiveInteger, toPublicSource, toPublicWorkflowRun } from "./internals.js";

/** 导出文件名：时间戳里的 `:` 在 Windows 上是非法字符，统一换成 `-`。 */
function exportFileName(exportedAt: string): string {
    return `cosmos-user-data-${exportedAt.replaceAll(":", "-")}.json`;
}

export class AppControllerSources extends AppControllerBase {
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

    /**
     * 删除来源（AUT-001）。墓碑语义：来源从列表/读取/调度中消失，已录入的
     * Entry/Observation/Revision 保留。命令天然幂等，重复调用返回同一份结果。
     */
    @Post("sources/:sourceId/removals")
    @Bind(Param("sourceId"), Body(), Headers("idempotency-key"))
    async deleteSource(sourceId: string, body: unknown, idempotencyKey?: string) {
        try {
            const key = requireIdempotencyKey(idempotencyKey);
            const command = deleteSourceCommandSchema.parse(body);
            return toPublicSource(await this.repository.deleteSource({
                sourceId,
                baseRevisionId: command.baseRevisionId,
                idempotencyKey: key,
                actor: command.actor ?? null,
                reason: command.reason ?? null,
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

    // ---- Connections (ADR-0017): reusable login/authorization identity. ----

    @Get("connections")
    async listConnections() {
        return this.repository.listConnections();
    }

    @Get("connections/:connectionId")
    @Bind(Param("connectionId"))
    async connection(connectionId: string) {
        const result = await this.repository.getConnection(connectionId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Connection not found: ${connectionId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("connections")
    @Bind(Body())
    async createConnection(body: unknown) {
        try {
            const command = createConnectionCommandSchema.parse(body);
            return await this.repository.createConnection(command);
        } catch (error) {
            connectionError(error);
        }
    }

    @Patch("connections/:connectionId")
    @Bind(Param("connectionId"), Body())
    async updateConnection(connectionId: string, body: unknown) {
        try {
            const command = updateConnectionCommandSchema.parse(body);
            return await this.repository.updateConnection(connectionId, command);
        } catch (error) {
            connectionError(error);
        }
    }

    @Post("connections/:connectionId/removals")
    @Bind(Param("connectionId"))
    async deleteConnection(connectionId: string) {
        try {
            await this.repository.deleteConnection(connectionId);
            return { ok: true, id: connectionId, action: "connection.deleted" };
        } catch (error) {
            connectionError(error);
        }
    }

    // ---- Collection plans (ADR-0023): the user-visible collection unit. ----

    @Get("collection-plans")
    async listCollectionPlans() {
        return this.repository.listCollectionPlans();
    }

    @Get("collection-plans/:planId")
    @Bind(Param("planId"))
    async collectionPlan(planId: string) {
        const result = await this.repository.getCollectionPlan(planId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Collection plan not found: ${planId}`,
                retryable: false,
            });
        }
        return result;
    }

    // ---- Storage occupancy + backup/restore (ADR-0019 / OPS-003/004). ----

    @Get("storage-stats")
    async storageStats() {
        return this.repository.getStorageStats();
    }

    @Get("backups")
    async listBackups() {
        return this.repository.listBackups();
    }

    @Post("backups")
    async createBackup() {
        return this.repository.createBackup();
    }

    @Post("backups/:backupId/restores")
    @Bind(Param("backupId"))
    async restoreBackup(backupId: string) {
        try {
            await this.repository.restoreBackup(backupId);
            return { ok: true, id: backupId, action: "backup.restored" };
        } catch (error) {
            if (error instanceof Error && error.message.startsWith("Backup not found")) {
                throw new NotFoundException({ code: "not_found", message: error.message, retryable: false });
            }
            throw error;
        }
    }

    /**
     * 用户数据导出（LIB-008 / OPS-004）。以附件下载返回：文件名带导出时间，
     * 用户存下来即可长期保存；这是只读 Query，不落盘、不改状态。
     */
    @Get("exports/user-data")
    async exportUserData() {
        const payload = await this.repository.exportUserData();
        return new StreamableFile(
            Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"),
            {
                type: "application/json",
                disposition: `attachment; filename="${exportFileName(payload.exportedAt)}"`,
            },
        );
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
}
