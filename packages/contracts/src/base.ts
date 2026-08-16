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
 * A source kind is a stable connector family identifier. Plugin-defined
 * values remain valid so the core does not need an enum migration per plugin.
 */
export const sourceKindSchema = z.string().trim().min(1).max(100);
export type SourceKind = z.infer<typeof sourceKindSchema>;

const scheduleConfigShape = {
    scheduleIntervalMs: z.coerce.number().int().min(1_000).max(31 * 24 * 60 * 60 * 1_000).optional(),
};

export const sourceConfigSchema = z.object({
    feedUrl: z.string().url().optional(),
    fixturePath: z.string().min(1).optional(),
    ...scheduleConfigShape,
}).passthrough();
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const rssSourceConfigSchema = z.object({
    feedUrl: z.string().url(),
    ...scheduleConfigShape,
}).strict();
export type RssSourceConfig = z.infer<typeof rssSourceConfigSchema>;

export const fixtureRssSourceConfigSchema = z.object({
    fixturePath: z.string().min(1).optional(),
    ...scheduleConfigShape,
}).strict();
export type FixtureRssSourceConfig = z.infer<typeof fixtureRssSourceConfigSchema>;

const safeProfileSchema = z.string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/);

export const bilibiliSourceConfigSchema = z.object({
    schemaVersion: z.coerce.number().int().positive().default(1),
    mode: z.enum(["hot", "feed"]),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    profile: safeProfileSchema.optional(),
    ...scheduleConfigShape,
}).strict().superRefine((value, context) => {
    if (value.mode === "feed" && !value.profile) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["profile"],
            message: "Bilibili feed requires an OpenCLI profile.",
        });
    }
});
export type BilibiliSourceConfig = z.infer<typeof bilibiliSourceConfigSchema>;

export const aiHotSourceConfigSchema = z.object({
    schemaVersion: z.coerce.number().int().positive().default(1),
    ...scheduleConfigShape,
}).strict();
export type AiHotSourceConfig = z.infer<typeof aiHotSourceConfigSchema>;

export const createSourceCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    kind: sourceKindSchema,
    config: sourceConfigSchema,
    enabled: z.boolean().default(true),
});
export type CreateSourceCommand = z.input<typeof createSourceCommandSchema>;

export const updateSourceCommandSchema = z.object({
    enabled: z.boolean(),
});
export type UpdateSourceCommand = z.infer<typeof updateSourceCommandSchema>;

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
    triggerKind: z.enum(["manual", "schedule"]).default("manual"),
    idempotencyKey: z.string().trim().min(1).max(300).optional(),
});
export type IngestCommand = z.input<typeof ingestCommandSchema>;

/** Immutable source data captured when a workflow is enqueued. */
export const sourceExecutionSnapshotSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: sourceKindSchema,
    config: sourceConfigSchema,
    enabled: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type SourceExecutionSnapshot = z.infer<typeof sourceExecutionSnapshotSchema>;

/** Current source projection, including mutable run diagnostics. */
export const sourceSnapshotSchema = sourceExecutionSnapshotSchema.extend({
    lastRunAt: z.string().nullable(),
    lastError: z.string().nullable(),
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
