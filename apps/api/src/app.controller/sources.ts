import {
    ConflictException,
    Bind,
    Delete,
    Get,
    HttpCode,
    HttpException,
    HttpStatus,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    StreamableFile,
    Body,
    Headers,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createHealthSnapshot, WorkflowHostConflictError } from "@cosmos/application";
import {
    connectorStateExportQuerySchema,
    connectorStateImportCommandSchema,
    createSourceCommandSchema,
    deleteSourceCommandSchema,
    sourceConfigProbeCommandSchema,
    updateCollectionPlanCommandSchema,
    updateSourceCommandSchema,
    createConnectionCommandSchema,
    updateConnectionCommandSchema,
    type ConnectorStateExportQuery,
    type ConnectorStateExportScope,
    type HealthResponse,
} from "@cosmos/contracts";
import "reflect-metadata";
import { AppControllerBase } from "./base.js";
import { requireIdempotencyKey, sourceCommandError, connectionError, catalogPage, parsePositiveInteger, toPublicSource, toPublicWorkflowRun } from "./internals.js";

/** 导出文件名：时间戳里的 `:` 在 Windows 上是非法字符，统一换成 `-`。 */
function exportFileName(prefix: string, exportedAt: string): string {
    return `${prefix}-${exportedAt.replaceAll(":", "-")}.json`;
}

/**
 * 连接器状态导入件的体积上限。状态条目本身很小，上限的作用是让超大 body 在我们的
 * 契约里就被拒绝，而不是先被 HTTP 层按自己的错误形状挡掉。
 */
export const CONNECTOR_STATE_IMPORT_MAX_BODY_BYTES = 64 * 1024;

/**
 * 查询参数到导出范围的映射。`connectorStateExportQuerySchema` 已经保证四选一，
 * 这里只挑出唯一给出的那一个；一个都没给就是"全部已归属"。
 */
function connectorStateScope(query: ConnectorStateExportQuery): ConnectorStateExportScope {
    if (query.namespace !== undefined) return { kind: "namespace", namespace: query.namespace };
    if (query.planId !== undefined) return { kind: "plan", planId: query.planId };
    if (query.connectionId !== undefined) {
        return { kind: "connection", connectionId: query.connectionId };
    }
    if (query.sourceId !== undefined) return { kind: "source", sourceId: query.sourceId };
    return { kind: "attributed" };
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
            // 连接归计划（ADR-0023 决策 2）：不先查一次的话，不存在的连接会撞数据库外键
            // 变成 500，而它其实是一个可以明确告诉调用方的输入错误。
            if (command.connectionId) {
                const connection = await this.repository.getConnection(command.connectionId);
                if (!connection) {
                    throw new NotFoundException({
                        code: "not_found",
                        message: `Connection not found: ${command.connectionId}`,
                        retryable: false,
                    });
                }
            }
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

    /**
     * 计划自有字段的唯一写入口（ADR-0023 决策 2）：名字、连接、调度、媒体预算与启用状态。
     * 启用沿用来源端点原有的前置条件——已保存的目标配置必须仍然有效，否则启用会造出一个
     * 每次运行都失败的启用计划。
     */
    @Patch("collection-plans/:planId")
    @Bind(Param("planId"), Body())
    async updateCollectionPlan(planId: string, body: unknown) {
        try {
            const input = updateCollectionPlanCommandSchema.parse(body);
            if (input.enabled === true) {
                const plan = await this.repository.getCollectionPlan(planId);
                if (!plan) {
                    throw new NotFoundException({
                        code: "not_found",
                        message: `Collection plan not found: ${planId}`,
                        retryable: false,
                    });
                }
                const source = await this.repository.getSource(plan.sourceId);
                if (!source) {
                    throw new NotFoundException({
                        code: "not_found",
                        message: `Source not found: ${plan.sourceId}`,
                        retryable: false,
                    });
                }
                this.validateSourceDefinition({
                    sourceDefinitionRef: source.sourceDefinitionRef,
                    operationId: source.operationId,
                    config: source.config,
                });
            }
            return await this.repository.updateCollectionPlan(planId, input);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    /**
     * Webhook 入口的生成/轮换（ADR-0024）：入口标识与凭证一起换新，明文凭证只在这个
     * 响应里出现一次。生成不要求计划已启用——配置入口与启用采集是两件事；计划停用时
     * 由 inbound 端点拒绝请求。
     */
    @Post("collection-plans/:planId/webhook-entry")
    @Bind(Param("planId"))
    async rotateCollectionPlanWebhookEntry(planId: string) {
        try {
            return await this.repository.rotateCollectionPlanWebhookEntry(planId);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    /** 撤销入口（幂等）：删除入口标识与凭证字节，需要重新生成才能再用。 */
    @Delete("collection-plans/:planId/webhook-entry")
    @Bind(Param("planId"))
    async revokeCollectionPlanWebhookEntry(planId: string) {
        try {
            return await this.repository.revokeCollectionPlanWebhookEntry(planId);
        } catch (error) {
            sourceCommandError(error);
        }
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
                disposition: `attachment; filename="${exportFileName("cosmos-user-data", payload.exportedAt)}"`,
            },
        );
    }

    // ---- Connector state export/import (ING-012 / ADR-0026). ----

    @Get("connector-state/namespaces")
    async listConnectorStateNamespaces() {
        return this.repository.listConnectorStateNamespaces();
    }

    /**
     * 导出连接器状态（ING-012）：只读、不落盘，返回 JSON 附件。范围四选一，缺省是
     * 全部已归属；未归属抽屉只能按名字点名，不会被"全部"顺手带走。
     */
    @Get("exports/connector-state")
    @Bind(Query())
    async exportConnectorState(query: Record<string, unknown>) {
        try {
            const scope = connectorStateScope(connectorStateExportQuerySchema.parse(query));
            const payload = await this.repository.exportConnectorState(scope);
            return new StreamableFile(
                Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"),
                {
                    type: "application/json",
                    disposition: `attachment; filename="${exportFileName("cosmos-connector-state", payload.exportedAt)}"`,
                },
            );
        } catch (error) {
            sourceCommandError(error);
        }
    }

    /**
     * 导入连接器状态（ADR-0026）：导出件是外部输入，先按契约整批校验再在单个事务里写。
     * 只写 `ConnectorState`，不触发采集、不写事件、不改计划与连接。
     */
    @Post("imports/connector-state")
    @Bind(Headers("content-length"), Body())
    async importConnectorState(contentLength?: string, body?: unknown) {
        const declaredLength = Number.parseInt(contentLength ?? "", 10);
        if (Number.isFinite(declaredLength) && declaredLength > CONNECTOR_STATE_IMPORT_MAX_BODY_BYTES) {
            throw this.connectorStateImportTooLarge();
        }
        if (
            body !== undefined
            && Buffer.byteLength(JSON.stringify(body) ?? "", "utf8") > CONNECTOR_STATE_IMPORT_MAX_BODY_BYTES
        ) {
            throw this.connectorStateImportTooLarge();
        }
        try {
            const command = connectorStateImportCommandSchema.parse(body);
            return await this.repository.importConnectorState(command);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    private connectorStateImportTooLarge(): HttpException {
        return new HttpException({
            code: "payload_too_large",
            message: `Connector state import must not exceed ${CONNECTOR_STATE_IMPORT_MAX_BODY_BYTES} bytes.`,
            retryable: false,
        }, HttpStatus.PAYLOAD_TOO_LARGE);
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
