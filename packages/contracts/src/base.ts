import { z } from "zod";

export const protocolVersion = "v1" as const;

export const contentKindSchema = z.enum([
    "post",
    "article",
    "video",
    "audio",
    "image",
    "comment",
    "listing",
]);
export type ContentKind = z.infer<typeof contentKindSchema>;

/**
 * 发现渠道（ING-004）的 wire 形状。语义 owner 是 `@cosmos/domain` 的 `discoveryChannels`
 * （由连接器在域层声明），这里只负责跨 HTTP / Workflow JSON 边界的取值校验。
 */
export const discoveryChannelSchema = z.enum([
    "account",
    "recommendation",
    "search",
    "announcement",
    "email",
    "manual",
    "related",
    "agent",
    "unknown",
]);
export type DiscoveryChannel = z.infer<typeof discoveryChannelSchema>;

export const publisherKindSchema = z.enum([
    "user",
    "channel",
    "subreddit",
    "official-account",
    "org",
    "unknown",
]);
export type PublisherKind = z.infer<typeof publisherKindSchema>;

const nullableTrimmedStringSchema = z.preprocess(
    (value) => typeof value === "string" ? value.trim() || null : value,
    z.string().min(1).nullable(),
);

export const publisherMetricsSchema = z.object({
    followers: z.number().finite().nullable().optional(),
    following: z.number().finite().nullable().optional(),
    statuses: z.number().finite().nullable().optional(),
    voteup: z.number().finite().nullable().optional(),
    reliable: z.enum(["high", "low", "unknown"]).optional(),
});
export type PublisherMetrics = z.infer<typeof publisherMetricsSchema>;

export const publisherSchema = z.object({
    platformId: nullableTrimmedStringSchema,
    name: z.string().trim().min(1),
    handle: nullableTrimmedStringSchema,
    profileUrl: nullableTrimmedStringSchema,
    kind: publisherKindSchema,
    metrics: publisherMetricsSchema.nullable().optional(),
});
export type Publisher = z.infer<typeof publisherSchema>;

export const temporalPrecisionSchema = z.enum([
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "year",
    "unknown",
]);
export type TemporalPrecision = z.infer<typeof temporalPrecisionSchema>;

export const temporalFallbackSchema = z.object({
    raw: z.string().min(1),
    lowerBound: z.string().datetime({ offset: true }),
    precision: temporalPrecisionSchema,
    timezone: z.string().nullable(),
    confidence: z.enum(["high", "inferred", "uncertain"]),
});
export type TemporalFallback = z.infer<typeof temporalFallbackSchema>;

export const temporalValueSchema = z.object({
    exact: z.string().datetime({ offset: true }).nullable(),
    exactPrecision: z.literal("second").nullable(),
    fallback: temporalFallbackSchema.nullable(),
}).refine((value) => {
    return value.exact !== null || value.fallback !== null;
}, "TemporalValue must contain exact or fallback time data.");
export type TemporalValue = z.infer<typeof temporalValueSchema>;

export const contentMetricsSchema = z.object({
    values: z.object({
        likes: z.number().finite().nullable().optional(),
        views: z.number().finite().nullable().optional(),
        reposts: z.number().finite().nullable().optional(),
        comments: z.number().finite().nullable().optional(),
        collects: z.number().finite().nullable().optional(),
        score: z.number().finite().nullable().optional(),
    }),
    raw: z.record(z.string(), z.string()),
    reliability: z.enum(["high", "low", "unknown"]),
    capturedAt: z.string().datetime({ offset: true }),
});
export type ContentMetrics = z.infer<typeof contentMetricsSchema>;

/**
 * Legacy runtime connector-family key. New Product API commands use
 * sourceDefinitionRef; kind remains in execution snapshots during migration.
 */
export const sourceKindSchema = z.string().trim().min(1).max(100);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceDefinitionRefSchema = z.string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^source\.[A-Za-z0-9._-]+@[1-9][0-9]*$/);
export type SourceDefinitionRef = z.infer<typeof sourceDefinitionRefSchema>;

export const sourceOperationIdSchema = z.string().trim().min(1).max(100);
export type SourceOperationId = z.infer<typeof sourceOperationIdSchema>;

export const sourceConnectorIdSchema = z.string().trim().min(1).max(100);
export type SourceConnectorId = z.infer<typeof sourceConnectorIdSchema>;

export const sourceRevisionIdSchema = z.string().trim().min(1).max(300);
export type SourceRevisionId = z.infer<typeof sourceRevisionIdSchema>;
/** Idempotency keys share one wire budget across commands and headers. */
export const idempotencyKeySchema = z.string().trim().min(1).max(300);

/**
 * Connector transports speak HTTP(S) only; rejecting other schemes at the
 * contract boundary keeps file:, data:, ftp: URLs out of server-side fetches.
 */
const httpFeedUrlSchema = z.string().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
}, { message: "feedUrl must be an http or https URL." });

// Schedule is a first-class TriggerBinding now (ADR-0018); config no longer
// carries scheduleIntervalMs. The anchor stays empty so the config schemas keep
// a stable spread shape.
const scheduleConfigShape = {};

/**
 * Ceilings for the per-source media policy (ADR-0014 decision 2). They equal
 * the global defaults: a source may tighten its own budget but never raise it
 * above the resource line frozen by ADR-0005. The acquirer reads the same
 * values as its runtime defaults.
 */
export const mediaPolicyCeilings = {
    maxFileBytes: 10 * 1024 * 1024,
    maxRunBytes: 50 * 1024 * 1024,
} as const;

export const mediaPolicyImagesSchema = z.enum(["download", "metadata_only"]);
export type MediaPolicyImages = z.infer<typeof mediaPolicyImagesSchema>;

/**
 * Managed write-side reason codes for degraded assets (ADR-0015 decision 2).
 * Read-side projections stay lenient so an unknown future value degrades instead
 * of breaking the Asset snapshot.
 */
export const assetErrorCodes = [
    "timeout",
    "network",
    "http_error",
    "budget_run",
    "budget_file",
    "not_image",
    "security_blocked",
    "invalid_url",
    "retention_expired",
    "unknown",
] as const;
export const assetErrorCodeSchema = z.enum(assetErrorCodes);
export type AssetErrorCode = z.infer<typeof assetErrorCodeSchema>;

/** Degraded states the retry step may attempt again (ADR-0015 decision 2). */
export const retryableAssetErrorCodes = [
    "timeout",
    "network",
    "http_error",
    "budget_run",
] as const satisfies readonly AssetErrorCode[];

/** Attempt ceiling shared by the schema bound and the application default (ADR-0015 decision 3). */
export const mediaRetryCeiling = 10;

/**
 * Per-source retry policy. `maxAttempts` counts the first download too, so 1
 * means "never retry" and 0 disables the candidate query entirely.
 */
export const mediaRetryPolicySchema = z.object({
    maxAttempts: z.coerce.number().int().min(0).max(mediaRetryCeiling).optional(),
}).strict();
export type MediaRetryPolicy = z.infer<typeof mediaRetryPolicySchema>;

/** Per-source media policy; every field is optional and falls back to the global default. */
export const sourceMediaPolicySchema = z.object({
    images: mediaPolicyImagesSchema.optional(),
    maxFileBytes: z.coerce.number().int()
        .min(64 * 1024)
        .max(mediaPolicyCeilings.maxFileBytes)
        .optional(),
    maxRunBytes: z.coerce.number().int()
        .min(1024 * 1024)
        .max(mediaPolicyCeilings.maxRunBytes)
        .optional(),
    retry: mediaRetryPolicySchema.optional(),
    /** Saved-media retention; absent or 0 keeps media forever (ADR-0015 decision 6). */
    retentionDays: z.coerce.number().int().min(0).max(3650).optional(),
}).strict();
export type SourceMediaPolicy = z.infer<typeof sourceMediaPolicySchema>;

/**
 * 采集目标的配置。媒体预算**不在**这里：它归采集计划（ADR-0023 决策 2 的字段边界），
 * 读取方是 `CollectionPlan.mediaPolicyJson`，写入口是 `PATCH /collection-plans/{id}`。
 */
export const sourceConfigSchema = z.object({
    feedUrl: z.string().url().optional(),
    fixturePath: z.string().min(1).optional(),
    ...scheduleConfigShape,
}).passthrough();
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const rssSourceConfigSchema = z.object({
    feedUrl: httpFeedUrlSchema,
    ...scheduleConfigShape,
}).strict();
export type RssSourceConfig = z.infer<typeof rssSourceConfigSchema>;

export const fixtureRssSourceConfigSchema = z.object({
    fixturePath: z.string().min(1).optional(),
    ...scheduleConfigShape,
}).strict();
export type FixtureRssSourceConfig = z.infer<typeof fixtureRssSourceConfigSchema>;

/**
 * OpenCLI profile 的格式规则。profile 从来源配置搬到连接的 `configJson`
 * （Proposal connection-login-lifecycle-v1 决定 1），但格式规则的**唯一出处**留在这里：
 * 连接器读连接配置时用它，避免同一条规则在适配器与合同两处漂移。
 */
export const openCliProfileSchema = z.string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/);

/**
 * `feed` 需要登录态这件事不再由来源配置表达：profile 已不在 config 里，校验发生在
 * 连接器读到连接投影之后（Proposal 决定 1；见 Task 22 切片 4a 记录的后果）。
 */
export const bilibiliSourceConfigSchema = z.object({
    schemaVersion: z.coerce.number().int().positive().default(1),
    mode: z.enum(["hot", "feed"]),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    ...scheduleConfigShape,
}).strict();
export type BilibiliSourceConfig = z.infer<typeof bilibiliSourceConfigSchema>;

/**
 * Bilibili 第二个 operation（`search`）的用户配置：搜索要一个查询词，`fetch` 的 mode/limit
 * 对它没有意义——这正是「按 operation 声明配置 schema」要解决的事（EXT-006）。搜索匿名
 * 可用，所以它**不要求连接**（对比 `fetch` 的 mode=feed）。
 */
export const bilibiliSearchSourceConfigSchema = z.object({
    schemaVersion: z.coerce.number().int().positive().default(1),
    query: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    ...scheduleConfigShape,
}).strict();
export type BilibiliSearchSourceConfig = z.infer<typeof bilibiliSearchSourceConfigSchema>;

export const aiHotSourceConfigSchema = z.object({
    schemaVersion: z.coerce.number().int().positive().default(1),
    ...scheduleConfigShape,
}).strict();
export type AiHotSourceConfig = z.infer<typeof aiHotSourceConfigSchema>;

/**
 * Canonical configuration schemas keyed by the versioned source definition ref.
 * The Product API boundary validates against these so connector-specific rules
 * (e.g. a Bilibili feed profile) cannot drift from the manifest's published
 * JSON Schema projection, which intentionally stays descriptive.
 */
export const sourceConfigurationSchemas = {
    "source.rss@1": rssSourceConfigSchema,
    "source.fixture-rss@1": fixtureRssSourceConfigSchema,
    "source.bilibili@1": bilibiliSourceConfigSchema,
    "source.aihot@1": aiHotSourceConfigSchema,
} as const;

/**
 * 按 operation 覆盖定义级配置 schema（EXT-006）。一个 Adapter 的第二个 operation 往往要
 * 用户填完全不同的东西（Bilibili 的 `search` 要查询词），所以「用户可填配置」不能只有一份；
 * 未登记的 operation 回退定义级那份（`bilibili.fetch` 就是这种：它沿用 mode/limit）。
 */
export const sourceOperationConfigurationSchemas: Record<
    string,
    Record<string, z.ZodTypeAny>
> = {
    "source.bilibili@1": { search: bilibiliSearchSourceConfigSchema },
};

export function getSourceConfigurationSchema(
    sourceDefinitionRef: string,
    operationId?: string,
): z.ZodTypeAny | null {
    if (operationId !== undefined) {
        const override = sourceOperationConfigurationSchemas[sourceDefinitionRef]?.[operationId];
        if (override) {
            return override;
        }
    }
    return sourceConfigurationSchemas[sourceDefinitionRef as keyof typeof sourceConfigurationSchemas] ?? null;
}

export const triggerIntervalSchema = z.coerce.number().int().min(1_000).max(31 * 24 * 60 * 60 * 1_000);

export const createSourceCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    sourceDefinitionRef: sourceDefinitionRefSchema,
    operationId: sourceOperationIdSchema,
    config: z.unknown(),
    /** Optional schedule interval; creates a schedule TriggerBinding (ADR-0018). */
    scheduleIntervalMs: triggerIntervalSchema.optional(),
    /**
     * 可选的连接绑定（ADR-0017）。连接归采集计划（ADR-0023 决策 2），但创建命令在
     * 同一步里建出来源与默认计划，所以这里接受它——与 `scheduleIntervalMs` 同例，
     * 避免「先建目标再补连接」这种会留下半成品的两步流程。
     */
    connectionId: z.string().trim().min(1).max(100).nullable().optional(),
}).strict();
export type CreateSourceCommand = z.infer<typeof createSourceCommandSchema>;

/**
 * 采集目标自身的可写字段（ADR-0023 决策 2 的字段边界）：来源只拥有名字（内容出处的
 * 名字）与目标配置。连接、调度、媒体预算与启用状态都归采集计划，写入口是
 * `PATCH /collection-plans/{id}`——同一个事实不设第二个写入口。
 */
export const updateSourceCommandSchema = z.object({
    baseRevisionId: sourceRevisionIdSchema,
    name: z.string().trim().min(1).max(200).optional(),
    config: z.unknown().optional(),
}).strict();
export type UpdateSourceCommand = z.infer<typeof updateSourceCommandSchema>;

/**
 * 删除来源（AUT-001）。删除只移除来源配置与调度绑定：已录入的 Entry/Observation/Revision
 * 保留（需求验收把「删除凭据、停用来源、删除历史数据」定为三个独立动作）。
 */
export const deleteSourceCommandSchema = z.object({
    baseRevisionId: sourceRevisionIdSchema,
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
}).strict();
export type DeleteSourceCommand = z.infer<typeof deleteSourceCommandSchema>;

export const sourceProbeResultSchema = z.object({
    sourceId: z.string(),
    connectorId: z.string(),
    itemCount: z.number().int().nonnegative(),
    nextCursorAvailable: z.boolean(),
    checkedAt: z.string(),
});
export type SourceProbeResult = z.infer<typeof sourceProbeResultSchema>;

export const sourceTestResultSchema = sourceProbeResultSchema;
export type SourceTestResult = SourceProbeResult;

export const ingestCommandSchema = z.object({
    sourceId: z.string().min(1),
    triggerKind: z.enum(["manual", "schedule", "webhook"]).default("manual"),
    idempotencyKey: idempotencyKeySchema.optional(),
});
export type IngestCommand = z.input<typeof ingestCommandSchema>;

/**
 * 冻结进执行快照的连接投影（Proposal connection-login-lifecycle-v1 决定 1）。只带身份与
 * 非秘密适配器配置；`status`/`lastError` 这类活诊断**不进**——AUT-016 要求排队后改连接
 * 配置不改变已创建 Run 的输入，而活诊断冻下来只会误导后来读它的人。
 */
export const sourceConnectionProjectionSchema = z.object({
    id: z.string(),
    connectorId: z.string(),
    configJson: z.string().nullable(),
}).strict();
export type SourceConnectionProjection = z.infer<typeof sourceConnectionProjectionSchema>;

/** Immutable source data captured when a workflow is enqueued. */
export const sourceExecutionSnapshotSchema = z.object({
    id: z.string(),
    name: z.string(),
    sourceDefinitionRef: sourceDefinitionRefSchema,
    operationId: sourceOperationIdSchema,
    connectorId: sourceConnectorIdSchema,
    /** Migration-era runtime projection; not accepted by Product API commands. */
    kind: sourceKindSchema,
    config: sourceConfigSchema,
    enabled: z.boolean(),
    /**
     * 所属计划（ADR-0023 决策 2）。入队时固化：checkpoint 提交与连接器状态命名空间都在
     * workflow 内部发生，那里拿不到 envelope，只能从执行快照取计划身份。
     */
    planId: z.string(),
    /**
     * 所属计划的媒体预算，入队时固化（ADR-0023 决策 2 + ADR-0014 语义）。媒体获取与重试
     * 读的是这一份，不是目标配置：一轮运行中途改策略不该影响这一轮。null 表示跟随全局默认。
     */
    mediaPolicy: sourceMediaPolicySchema.nullable(),
    revisionId: sourceRevisionIdSchema,
    /**
     * 当轮连接的投影（Proposal connection-login-lifecycle-v1）。`.optional()` 与本文件
     * `sourceSnapshotSchema.connectionId` 同例：未保存配置的探测路径没有连接，连接器
     * 必须容忍缺省，不能假定它一定存在。
     */
    connection: sourceConnectionProjectionSchema.nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type SourceExecutionSnapshot = z.infer<typeof sourceExecutionSnapshotSchema>;

/** Current source projection, including mutable run diagnostics. */
export const sourceSnapshotSchema = sourceExecutionSnapshotSchema.extend({
    lastRunAt: z.string().nullable(),
    lastError: z.string().nullable(),
    /**
     * 计划派生的只读投影（ADR-0023 决策 2）：v1 计划与采集目标一对一，来源读投影
     * 带上计划的 CAS 凭据与计划自有字段，让既有产品入口能作用到这些事实的所有者，
     * 而不必再查一次计划。计划 id 在基类里（执行路径也要用）。
     */
    planRevisionId: sourceRevisionIdSchema,
    /** 所属计划的连接引用（ADR-0017）；未认证来源的计划没有连接。 */
    connectionId: z.string().nullable(),
    /** 所属计划的调度间隔；没有调度绑定时为 null（只手动触发）。 */
    scheduleIntervalMs: z.number().int().positive().nullable(),
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

/**
 * Reusable login/authorization on an external platform (ADR-0017). The DTO
 * exposes identity, scope, status and an opaque `secretRef`; the credential
 * body never appears here or in any config/Job/Event/log.
 */
export const connectionStatusSchema = z.enum(["active", "revoked", "expired", "error"]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const connectionInstanceSchema = z.object({
    id: z.string(),
    name: z.string(),
    connectorId: z.string(),
    account: z.string().nullable(),
    scopeJson: z.string().nullable(),
    /**
     * 适配器的**非秘密**配置（Proposal connection-login-lifecycle-v1 决定 1），与
     * `scopeJson` 同形是 JSON 文本。凭证永远不在这里——`secretRef` 只是不透明引用。
     */
    configJson: z.string().nullable(),
    status: connectionStatusSchema,
    secretRef: z.string().nullable(),
    lastError: z.string().nullable(),
    /**
     * 最近一次登录探测的时间（Proposal connection-login-lifecycle-v1 决定 2）；从未探测为 null。
     * 它由探测回写，不走公开的更新命令。
     */
    lastCheckedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
}).strict();
export type ConnectionInstance = z.infer<typeof connectionInstanceSchema>;

export const createConnectionCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    connectorId: z.string().trim().min(1).max(100),
    account: z.string().trim().max(200).nullable().optional(),
    scopeJson: z.string().max(4000).nullable().optional(),
    configJson: z.string().max(4000).nullable().optional(),
    secretRef: z.string().trim().min(1).max(300).nullable().optional(),
}).strict();
export type CreateConnectionCommand = z.infer<typeof createConnectionCommandSchema>;

export const updateConnectionCommandSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    status: connectionStatusSchema.optional(),
    configJson: z.string().max(4000).nullable().optional(),
    secretRef: z.string().trim().min(1).max(300).nullable().optional(),
    lastError: z.string().max(500).nullable().optional(),
}).strict();
export type UpdateConnectionCommand = z.infer<typeof updateConnectionCommandSchema>;

/**
 * First-class trigger (ADR-0018). ADR-0024 adds webhook as the only remaining
 * Phase 2 form; internal-event, condition and upstream-workflow triggers stay
 * deferred to Phase 3, so the binding kind must not grow silently.
 */
export const triggerKindSchema = z.enum(["schedule", "manual", "webhook"]);
export type TriggerKind = z.infer<typeof triggerKindSchema>;

export const triggerConfigSchema = z.object({
    intervalMs: triggerIntervalSchema.optional(),
}).strict();
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

export const triggerBindingSchema = z.object({
    id: z.string(),
    sourceId: z.string(),
    kind: triggerKindSchema,
    config: triggerConfigSchema,
    enabled: z.boolean(),
    revisionId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
}).strict();
export type TriggerBinding = z.infer<typeof triggerBindingSchema>;
