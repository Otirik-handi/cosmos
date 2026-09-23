import { z } from "zod";
import {
    sourceConnectorIdSchema,
    sourceDefinitionRefSchema,
    sourceOperationIdSchema,
} from "./base.js";
import {
    runSnapshotSchema,
} from "./run-control.js";

export const connectorDescriptorSchema = z.object({
    id: z.string().trim().min(1),
    description: z.string().trim().min(1),
    capabilities: z.string().array(),
    configVersion: z.string().trim().min(1),
});

export type ConnectorDescriptor = z.infer<typeof connectorDescriptorSchema>;

/**
 * Public projection of a Catalog SourceDefinitionManifest row. The JSON Schema
 * in `configurationSchema.schema` is descriptive: it drives Web form rendering,
 * while canonical config validation stays in the source configuration schema
 * registry at the API boundary.
 */

export const manifestHashSchema = z.object({
    algorithm: z.string().trim().min(1),
    value: z.string().trim().min(1),
});

export type ManifestHash = z.infer<typeof manifestHashSchema>;


export const jsonSchemaRefSchema = z.object({
    id: z.string().trim().min(1),
    version: z.number().int().positive(),
    hash: manifestHashSchema,
    schema: z.record(z.string(), z.unknown()).optional(),
});

export type JsonSchemaRef = z.infer<typeof jsonSchemaRefSchema>;


export const sourceDefinitionStatusSchema = z.enum([
    "enabled",
    "disabled",
    "unavailable",
    "incompatible",
]);

export type SourceDefinitionStatus = z.infer<typeof sourceDefinitionStatusSchema>;


export const sourceAuthSchema = z.object({
    kind: z.enum(["none", "oauth", "cookie", "secret_ref", "external"]),
    /** Human-readable label for the auth method; optional for none/external. */
    label: z.string().nullable(),
    secretRefRequired: z.boolean(),
    /**
     * 这个 Adapter 能不能对连接的登录态给出结论（Proposal connection-login-lifecycle-v1
     * 决定 2）。宿主按声明决定要不要允许发起连接探测，不按 connectorId 硬编码。
     */
    probeSupported: z.boolean(),
}).strict();

export type SourceAuth = z.infer<typeof sourceAuthSchema>;


export const sourceOperationManifestSchema = z.object({
    operationId: sourceOperationIdSchema,
    inputSchema: jsonSchemaRefSchema,
    outputSchema: jsonSchemaRefSchema,
    /** Stable external key the operation uses for dedup across runs (EXT-007). */
    externalKey: z.string().trim().min(1),
    /** Discovery context the operation reads; empty string means none. */
    discoveryContext: z.string(),
    /** Media state declared by the operation: download / metadata_only. */
    media: z.enum(["none", "download", "metadata_only"]),
    /** Namespace for this operation's ConnectorState (e.g. source:{id}); null = none. */
    stateStoreNamespace: z.string().nullable(),
}).strict();

export type SourceOperationManifest = z.infer<typeof sourceOperationManifestSchema>;


export const sourceDefinitionManifestSchema = z.object({
    id: z.string().trim().min(1),
    version: z.number().int().positive(),
    ref: sourceDefinitionRefSchema,
    provider: z.string().trim().min(1),
    connectorId: sourceConnectorIdSchema,
    displayName: z.string().trim().min(1),
    description: z.string().nullable(),
    manifestHash: manifestHashSchema,
    status: sourceDefinitionStatusSchema,
    operationIds: sourceOperationIdSchema.array(),
    capabilities: z.string().array(),
    configurationSchema: jsonSchemaRefSchema,
    /** Auth method declared by the adapter (ADR-0018/EXT-006/007); none for unauth sources. */
    auth: sourceAuthSchema,
    /** Per-operation declaration (input/output, external key, discovery, media, secret/state). */
    operations: sourceOperationManifestSchema.array(),
}).strict();

export type SourceDefinitionManifest = z.infer<typeof sourceDefinitionManifestSchema>;



export const sourceDefinitionPageSchema = z.object({
    items: sourceDefinitionManifestSchema.array(),
    nextCursor: z.string().nullable(),
    snapshotAt: z.string(),
});

export type SourceDefinitionPage = z.infer<typeof sourceDefinitionPageSchema>;


export const stepStatusSchema = z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
]);

export type StepStatus = z.infer<typeof stepStatusSchema>;


export const jobStatusSchema = z.enum([
    "queued",
    "leased",
    "retry_wait",
    "succeeded",
    "failed_terminal",
    "cancelled",
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;


export const jobKindSchema = z.enum([
    "source-ingest",
    "source-probe",
    "source-config-probe",
    "connection-probe",
    "workflow-activity",
]);

export type JobKind = z.infer<typeof jobKindSchema>;


export const jobSnapshotSchema = z.object({
    id: z.string(),
    kind: jobKindSchema,
    sourceId: z.string().nullable(),
    runId: z.string().nullable(),
    status: jobStatusSchema,
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    errorCode: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    result: z.unknown().nullable(),
});

export type JobSnapshot = z.infer<typeof jobSnapshotSchema>;

/**
 * 某个 Run 的 Job 列表（OPS-002）。Run 投影里没有 job 引用，所以产品面要走到
 * Job/Attempt 必须先有这个读端点；Attempt 明细仍由 `GET /jobs/:id/attempts` 提供。
 */
export const jobListSchema = z.object({
    items: jobSnapshotSchema.array(),
});

export type JobList = z.infer<typeof jobListSchema>;

/**
 * Probe an unsaved source configuration: the command carries the config
 * itself instead of a sourceId, so a user can validate a feed before saving
 * the Source. The canonical configuration schema for the ref still owns
 * config validation; the connector only receives the parsed config.
 */

export const sourceConfigProbeCommandSchema = z.object({
    sourceDefinitionRef: sourceDefinitionRefSchema,
    operationId: sourceOperationIdSchema,
    config: z.unknown(),
    /**
     * 未保存配置的探测没有来源、也就没有计划，所以连接必须显式给：`feed` 这类需要
     * 登录态的操作要靠它拿到 profile（Proposal connection-login-lifecycle-v1）。
     */
    connectionId: z.string().trim().min(1).max(100).nullable().optional(),
}).strict();

export type SourceConfigProbeCommand = z.infer<typeof sourceConfigProbeCommandSchema>;

/** Persisted Job payload shape for `source-config-probe` Jobs. */

export const sourceConfigProbeJobPayloadSchema = z.object({
    configProbe: sourceConfigProbeCommandSchema,
}).strict();


export const sourceConfigProbeResultSchema = z.object({
    sourceDefinitionRef: sourceDefinitionRefSchema,
    operationId: sourceOperationIdSchema,
    connectorId: sourceConnectorIdSchema,
    itemCount: z.number().int().nonnegative(),
    nextCursorAvailable: z.boolean(),
    /** At most 3 truncated entry titles so a user can eyeball the fetched content. */
    sampleTitles: z.array(z.string().max(200)).max(3),
    checkedAt: z.string(),
    durationMs: z.number().int().nonnegative(),
});

export type SourceConfigProbeResult = z.infer<typeof sourceConfigProbeResultSchema>;


export const sourceConfigProbeJobSnapshotSchema = jobSnapshotSchema.extend({
    kind: z.literal("source-config-probe"),
    result: sourceConfigProbeResultSchema.nullable(),
});

export type SourceConfigProbeJobSnapshot = z.infer<typeof sourceConfigProbeJobSnapshotSchema>;


/**
 * 连接登录探测（Proposal connection-login-lifecycle-v1 决定 2）：探测是**连接级**能力，
 * 不是 Source Operation——它不返回内容条目，所以不能走 ingest 管线（那条路径抓到什么
 * 都会入库）。`outcome` 是给产品面看的结论，`account` 是探测到的账号标签，`reason` 是
 * 面向用户的失效/失败原因。
 */
export const connectionProbeOutcomeSchema = z.enum(["active", "expired", "error"]);
export type ConnectionProbeOutcome = z.infer<typeof connectionProbeOutcomeSchema>;


export const connectionProbeResultSchema = z.object({
    connectionId: z.string(),
    outcome: connectionProbeOutcomeSchema,
    account: z.string().max(200).nullable(),
    reason: z.string().max(500).nullable(),
    checkedAt: z.string(),
}).strict();
export type ConnectionProbeResult = z.infer<typeof connectionProbeResultSchema>;


/** Persisted Job payload shape for `connection-probe` Jobs. */
export const connectionProbeJobPayloadSchema = z.object({
    connectionId: z.string().trim().min(1).max(100),
}).strict();
export type ConnectionProbeJobPayload = z.infer<typeof connectionProbeJobPayloadSchema>;


export const connectionProbeJobSnapshotSchema = jobSnapshotSchema.extend({
    kind: z.literal("connection-probe"),
    result: connectionProbeResultSchema.nullable(),
});
export type ConnectionProbeJobSnapshot = z.infer<typeof connectionProbeJobSnapshotSchema>;


export const assetStatusSchema = z.enum([
    "saved",
    "metadata_only",
    "skipped",
    "failed",
]);

export type AssetStatus = z.infer<typeof assetStatusSchema>;


export const assetSnapshotSchema = z.object({
    id: z.string(),
    kind: z.string(),
    status: assetStatusSchema,
    sourceUrl: z.string().nullable(),
    storageKey: z.string().nullable(),
    mimeType: z.string().nullable(),
    byteSize: z.number().nullable(),
    /** 面向用户的降级原因；非 saved 状态可能携带（ADR-0005）。 */
    errorMessage: z.string().max(500).nullable().optional(),
    /** 机器可读的降级原因（ADR-0015）；读取侧放宽，未知值降级展示。 */
    errorCode: z.string().max(50).nullable().optional(),
    /** 已完成的下载尝试次数，含首次（ADR-0015）。 */
    attemptCount: z.number().int().nonnegative().optional(),
});

export type AssetSnapshot = z.infer<typeof assetSnapshotSchema>;


/**
 * Product API 公开投影用的 Asset 形状：共享 AssetSnapshot 去掉内部 Blob key。
 *
 * 仓储内部的 Asset snapshot 仍可携带 `storageKey`（见
 * `docs/spec/storage/0001-prisma-repository.md`），公开读 DTO 与客户端响应校验改用这一份，
 * 因此「公开响应不含 storageKey」由 schema 保证，而不是靠调用方记得剥离。
 */
export const publicAssetSnapshotSchema = assetSnapshotSchema.omit({ storageKey: true });

export type PublicAssetSnapshot = z.infer<typeof publicAssetSnapshotSchema>;

/** Explicit retention cleanup command; `dryRun` defaults to true (ADR-0015 decision 7). */

export const mediaCleanupCommandSchema = z.object({
    sourceId: z.string().trim().min(1).optional(),
    dryRun: z.boolean().optional(),
}).strict();

export type MediaCleanupCommand = z.infer<typeof mediaCleanupCommandSchema>;


export const mediaCleanupEntrySchema = z.object({
    assetId: z.string(),
    sourceId: z.string().nullable(),
    sourceName: z.string().nullable(),
    title: z.string().nullable(),
    byteSize: z.number().int().nonnegative().nullable(),
    createdAt: z.string(),
    expiredAt: z.string(),
}).strict();

export type MediaCleanupEntry = z.infer<typeof mediaCleanupEntrySchema>;


export const mediaCleanupReportSchema = z.object({
    dryRun: z.boolean(),
    sourceId: z.string().nullable(),
    candidateCount: z.number().int().nonnegative(),
    /** Bytes held by all candidates; the preview number before anything is deleted. */
    candidateBytes: z.number().int().nonnegative(),
    cleanedCount: z.number().int().nonnegative(),
    cleanedBytes: z.number().int().nonnegative(),
    /** Rows whose Blob bytes are shared with another Asset and were kept. */
    sharedKeyCount: z.number().int().nonnegative(),
    samples: mediaCleanupEntrySchema.array(),
    startedAt: z.string(),
    finishedAt: z.string(),
}).strict();

export type MediaCleanupReport = z.infer<typeof mediaCleanupReportSchema>;


export const mediaCleanupRunSnapshotSchema = z.object({
    runId: z.string(),
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    report: mediaCleanupReportSchema.nullable(),
    error: z.string().nullable(),
});

export type MediaCleanupRunSnapshot = z.infer<typeof mediaCleanupRunSnapshotSchema>;


export const ingestResultSchema = z.object({
    run: runSnapshotSchema,
    createdEntryCount: z.number(),
    revisedEntryCount: z.number(),
    duplicateObservationCount: z.number(),
    errorCode: z.string().nullable().optional(),
    retryable: z.boolean().optional(),
});

export type IngestResult = z.infer<typeof ingestResultSchema>;

