export * from "./base.js";

import { z } from "zod";
import {
    contentKindSchema,
    contentMetricsSchema,
    publisherSchema,
    sourceConnectorIdSchema,
    sourceDefinitionRefSchema,
    sourceKindSchema,
    sourceOperationIdSchema,
    temporalValueSchema,
} from "./base.js";

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
}).strict();
export type SourceDefinitionManifest = z.infer<typeof sourceDefinitionManifestSchema>;

export const sourceDefinitionPageSchema = z.object({
    items: sourceDefinitionManifestSchema.array(),
    nextCursor: z.string().nullable(),
    snapshotAt: z.string(),
});
export type SourceDefinitionPage = z.infer<typeof sourceDefinitionPageSchema>;

export const runStatusSchema = z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

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
 * Probe an unsaved source configuration: the command carries the config
 * itself instead of a sourceId, so a user can validate a feed before saving
 * the Source. The canonical configuration schema for the ref still owns
 * config validation; the connector only receives the parsed config.
 */
export const sourceConfigProbeCommandSchema = z.object({
    sourceDefinitionRef: sourceDefinitionRefSchema,
    operationId: sourceOperationIdSchema,
    config: z.unknown(),
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
});
export type AssetSnapshot = z.infer<typeof assetSnapshotSchema>;

export const runSnapshotSchema = z.object({
    id: z.string(),
    sourceId: z.string().nullable(),
    triggerKind: z.enum(["manual", "schedule"]),
    status: runStatusSchema,
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    itemCount: z.number(),
    createdEntryCount: z.number(),
    revisedEntryCount: z.number(),
    error: z.string().nullable(),
});
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

export const healthResponseSchema = z.object({
    status: z.literal("ok"),
    service: z.string(),
    version: z.string(),
    protocolVersion: z.string(),
    workerStatus: z.enum(["unknown", "starting", "ready", "stopped"]),
    storageStatus: z.enum(["unknown", "starting", "ready", "failed"]),
    migrationStatus: z.enum(["unknown", "pending", "ready", "failed"]),
    timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const serviceErrorCodeSchema = z.enum([
    "validation_failed",
    "not_found",
    "conflict",
    "service_unavailable",
    "protocol_mismatch",
    "uncertain",
]);

export type ServiceErrorCode = z.infer<typeof serviceErrorCodeSchema>;

export const serviceErrorSchema = z.object({
    code: serviceErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    commandId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    retryable: z.boolean(),
});

export type ServiceError = z.infer<typeof serviceErrorSchema>;

export interface EventEnvelope<TPayload> {
    id: string;
    type: string;
    version: string;
    occurredAt: string;
    payload: TPayload;
}

export const searchQuerySchema = z.object({
    text: z.string().trim().max(500).optional(),
    sourceId: z.string().optional(),
    publishedAfter: z.string().datetime({ offset: true }).optional(),
    publishedBefore: z.string().datetime({ offset: true }).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQuery = z.input<typeof searchQuerySchema>;

export const feedItemSchema = z.object({
    storyId: z.string(),
    storyKind: z.enum(["event", "document", "media", "thread"]),
    title: z.string(),
    summary: z.string().nullable(),
    entryId: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceKind: sourceKindSchema,
    revisionId: z.string(),
    publishedAt: z.string().nullable(),
    assets: assetSnapshotSchema.array(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedPageSchema = z.object({
    items: feedItemSchema.array(),
    nextCursor: z.string().nullable(),
});
export type FeedPage = z.infer<typeof feedPageSchema>;

export const searchResultSchema = feedItemSchema.extend({
    rank: z.number().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchPageSchema = z.object({
    items: searchResultSchema.array(),
    nextCursor: z.string().nullable(),
});
export type SearchPage = z.infer<typeof searchPageSchema>;

export const entryRevisionSnapshotSchema = z.object({
    id: z.string(),
    revision: z.number(),
    title: z.string(),
    summary: z.string().nullable(),
    contentText: z.string(),
    webUrl: z.string().nullable(),
    contentKind: contentKindSchema,
    publisher: publisherSchema.nullable(),
    publishedAt: temporalValueSchema.nullable(),
    updatedAt: temporalValueSchema.nullable(),
    sourcePublishedAt: z.string().nullable(),
    createdAt: z.string(),
    assets: assetSnapshotSchema.array(),
});
export type EntryRevisionSnapshot = z.infer<typeof entryRevisionSnapshotSchema>;

export const observationSnapshotSchema = z.object({
    id: z.string(),
    externalId: z.string().nullable(),
    externalKey: z.string(),
    eventKind: z.enum(["create", "update", "delete", "snapshot"]),
    webUrl: z.string().nullable(),
    capturedAt: z.string(),
    sourcePublishedAt: z.string().nullable(),
});
export type ObservationSnapshot = z.infer<typeof observationSnapshotSchema>;

export const entryDetailSchema = z.object({
    id: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceKind: sourceKindSchema,
    currentRevisionId: z.string(),
    metrics: contentMetricsSchema.nullable(),
    revisions: entryRevisionSnapshotSchema.array(),
    observations: observationSnapshotSchema.array(),
});
export type EntryDetail = z.infer<typeof entryDetailSchema>;

export const entryListQuerySchema = z.object({
    sourceId: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type EntryListQuery = z.input<typeof entryListQuerySchema>;

export const entryListItemSchema = z.object({
    id: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceKind: sourceKindSchema,
    storyId: z.string().nullable(),
    currentRevisionId: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    webUrl: z.string().nullable(),
    contentKind: contentKindSchema,
    publisher: publisherSchema.nullable(),
    metrics: contentMetricsSchema.nullable(),
    publishedAt: z.string().nullable(),
    updatedAt: z.string(),
    revisionCount: z.number().int().nonnegative(),
    observationCount: z.number().int().nonnegative(),
    assets: assetSnapshotSchema.array(),
});
export type EntryListItem = z.infer<typeof entryListItemSchema>;

export const entryPageSchema = z.object({
    items: entryListItemSchema.array(),
    nextCursor: z.string().nullable(),
});
export type EntryPage = z.infer<typeof entryPageSchema>;

export const storyDetailSchema = z.object({
    story: z.object({
        id: z.string(),
        kind: z.enum(["event", "document", "media", "thread"]),
        subtype: z.string().nullable(),
        revisionId: z.string(),
        title: z.string(),
        summary: z.string().nullable(),
    }),
    entry: entryDetailSchema,
});
export type StoryDetail = z.infer<typeof storyDetailSchema>;

export const revisionDetailSchema = entryRevisionSnapshotSchema.extend({
    entryId: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceKind: sourceKindSchema,
});
export type RevisionDetail = z.infer<typeof revisionDetailSchema>;

export const ingestResultSchema = z.object({
    run: runSnapshotSchema,
    createdEntryCount: z.number(),
    revisedEntryCount: z.number(),
    duplicateObservationCount: z.number(),
    errorCode: z.string().nullable().optional(),
    retryable: z.boolean().optional(),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

export const eventSnapshotSchema = z.object({
    id: z.string(),
    type: z.string(),
    version: z.string(),
    occurredAt: z.string(),
    payload: z.unknown(),
});
export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;

export const snapshotRequiredPayloadSchema = z.object({
    reason: z.string(),
    latestEventId: z.string(),
});
export type SnapshotRequiredPayload = z.infer<typeof snapshotRequiredPayloadSchema>;

export const sseEventSchema = z.object({
    id: z.string(),
    type: z.string(),
    version: z.string(),
    occurredAt: z.string(),
    payload: z.unknown(),
});
export type SseEvent = z.infer<typeof sseEventSchema>;
export * from "./action.js";
