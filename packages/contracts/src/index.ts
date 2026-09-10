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

export const sourceAuthSchema = z.object({
    kind: z.enum(["none", "oauth", "cookie", "secret_ref", "external"]),
    /** Human-readable label for the auth method; optional for none/external. */
    label: z.string().nullable(),
    secretRefRequired: z.boolean(),
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
    /** 机器可读的降级原因（ADR-0015）；读取侧放宽，未知值降级展示。 */
    errorCode: z.string().max(50).nullable().optional(),
    /** 已完成的下载尝试次数，含首次（ADR-0015）。 */
    attemptCount: z.number().int().nonnegative().optional(),
});
export type AssetSnapshot = z.infer<typeof assetSnapshotSchema>;

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

/**
 * Run control v1 (RUN-004 / ADR-0016). Cancel, re-run and recover are
 * durable-WorkflowRun-only actions; the legacy SQL Run lane is out of scope.
 * The result reuses the stable RunSnapshot and adds two user-facing strings
 * that explain which results are reused and which new side effects the action
 * produces, so the UI never has to guess.
 */
export const runControlActionSchema = z.enum(["cancelled", "recovered", "rerun"]);
export type RunControlAction = z.infer<typeof runControlActionSchema>;

export const cancelRunCommandSchema = z.object({
    reason: z.string().trim().max(500).optional(),
}).strict();
export type CancelRunCommand = z.infer<typeof cancelRunCommandSchema>;

export const recoverRunCommandSchema = z.object({
    reason: z.string().trim().max(500).optional(),
}).strict();
export type RecoverRunCommand = z.infer<typeof recoverRunCommandSchema>;

export const rerunRunCommandSchema = z.object({}).strict();
export type RerunRunCommand = z.infer<typeof rerunRunCommandSchema>;

export const runControlResultSchema = z.object({
    action: runControlActionSchema,
    run: runSnapshotSchema,
    /** 面向用户：本动作复用哪些已入库结果。 */
    reuse: z.string(),
    /** 面向用户：本动作产生哪些新副作用。 */
    sideEffects: z.string(),
}).strict();
export type RunControlResult = z.infer<typeof runControlResultSchema>;

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
    // User-organization filters (ADR-0009 decision 5): comma-separated ids.
    labelIds: z.string().optional(),
    topicIds: z.string().optional(),
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

/**
 * Auxiliary Entry↔Story relation kinds (ADR-0011 decision 1). The write-side
 * enum is managed and additive; read-side `relationType` stays a plain string
 * so links written against a future kind degrade instead of failing the payload.
 */
export const entryStoryRelationTypeSchema = z.enum([
    "evidence_for",
    "mentions",
]);
export type EntryStoryRelationType = z.infer<typeof entryStoryRelationTypeSchema>;

export const entryStoryLinkProvenanceSchema = z.object({
    // Same optional-on-write policy as Story↔Entity: storage defaults to
    // producer "human" and confidence 1 unless the caller claims a source.
    producer: z.string().trim().min(1).max(200).nullish(),
    producerVersion: z.string().trim().max(100).nullish(),
    confidence: z.number().min(0).max(1).nullish(),
    evidence: z.string().trim().max(5000).nullish(),
});
export type EntryStoryLinkProvenance = z.infer<typeof entryStoryLinkProvenanceSchema>;

export const storyEvidenceSchema = z.object({
    entryId: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    relationType: z.string(),
    title: z.string().nullable(),
    producer: z.string(),
    producerVersion: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    actor: z.string().nullable(),
    reason: z.string().nullable(),
});
export type StoryEvidence = z.infer<typeof storyEvidenceSchema>;

export const entryRelatedStorySchema = z.object({
    storyId: z.string(),
    relationType: z.string(),
    title: z.string(),
    reason: z.string().nullable(),
});
export type EntryRelatedStory = z.infer<typeof entryRelatedStorySchema>;

export const entryDetailSchema = z.object({
    id: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceKind: sourceKindSchema,
    currentRevisionId: z.string(),
    metrics: contentMetricsSchema.nullable(),
    revisions: entryRevisionSnapshotSchema.array(),
    observations: observationSnapshotSchema.array(),
    // Auxiliary relations from this Entry to other Stories (ADR-0011 decision 6).
    relatedStories: entryRelatedStorySchema.array(),
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

export const storyEntitySummarySchema = z.object({
    entityId: z.string(),
    // Read-side entity identity is a snapshot of the current EntityRevision so
    // clients can render the Story↔Entity list without a second lookup.
    name: z.string(),
    type: z.string(),
    producer: z.string(),
    producerVersion: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    actor: z.string().nullable(),
    reason: z.string().nullable(),
});
export type StoryEntitySummary = z.infer<typeof storyEntitySummarySchema>;

export const labelRefSchema = z.object({
    id: z.string(),
    name: z.string(),
});
export type LabelRef = z.infer<typeof labelRefSchema>;

// A successor created by Story split, projected onto the historical shell so a
// client can list every replacement without a second lookup (ADR-0012
// decision 1).
export const storySuccessorSchema = z.object({
    storyId: z.string(),
    title: z.string(),
    kind: z.enum(["event", "document", "media", "thread"]),
});
export type StorySuccessor = z.infer<typeof storySuccessorSchema>;

// Active Topic memberships of a Story, used by the split command UI to decide
// which Topics move to which successor (ADR-0012 decision 3).
export const storyTopicSchema = z.object({
    topicId: z.string(),
    title: z.string(),
    role: z.string(),
});
export type StoryTopic = z.infer<typeof storyTopicSchema>;

export const storySubtypeStatusSchema = z.enum(["active", "deprecated", "retired"]);
export type StorySubtypeStatus = z.infer<typeof storySubtypeStatusSchema>;

// A managed Story subtype registration (ORG-013). StoryDetail.subtype may still
// carry an unregistered legacy value; this catalog lists what can be written.
export const storySubtypeSchema = z.object({
    id: z.string(),
    kind: z.enum(["event", "document", "media", "thread"]),
    version: z.number().int().positive(),
    label: z.string(),
    description: z.string().nullable(),
    status: storySubtypeStatusSchema,
    identityPolicy: z.string().nullable(),
    owner: z.string(),
});
export type StorySubtype = z.infer<typeof storySubtypeSchema>;

export const storySubtypePageSchema = z.object({
    items: storySubtypeSchema.array(),
    nextCursor: z.string().nullable(),
    snapshotAt: z.string(),
});
export type StorySubtypePage = z.infer<typeof storySubtypePageSchema>;

export const storySubtypeQuerySchema = z.object({
    kind: z.enum(["event", "document", "media", "thread"]).optional(),
});
export type StorySubtypeQuery = z.infer<typeof storySubtypeQuerySchema>;

export const storyDetailSchema = z.object({
    story: z.object({
        id: z.string(),
        kind: z.enum(["event", "document", "media", "thread"]),
        subtype: z.string().nullable(),
        revisionId: z.string(),
        title: z.string(),
        summary: z.string().nullable(),
        // "split" means this Story is a historical shell: it keeps its id,
        // revisions and history but no id redirects to a single successor
        // (ADR-0012 decision 1).
        status: z.enum(["active", "split"]),
        replacedBy: storySuccessorSchema.array(),
    }),
    // A historical shell may have no primary member left; only a Story without
    // a current Revision is unreadable (ADR-0012 decision 2).
    entry: entryDetailSchema.nullable(),
    entries: entryDetailSchema.array(),
    entities: storyEntitySummarySchema.array(),
    topics: storyTopicSchema.array(),
    labels: labelRefSchema.array(),
    favorited: z.boolean(),
    // Entries linked to this Story as evidence/mention, not primary members
    // (ADR-0011 decision 6).
    evidence: storyEvidenceSchema.array(),
});
export type StoryDetail = z.infer<typeof storyDetailSchema>;

export const moveEntryToStoryCommandSchema = z.object({
    entryId: z.string().trim().min(1).max(300),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type MoveEntryToStoryCommand = z.infer<typeof moveEntryToStoryCommandSchema>;

export const updateStoryRevisionCommandSchema = z.object({
    baseRevisionId: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().max(5000).nullish(),
    kind: z.enum(["event", "document", "media", "thread"]),
    subtype: z.string().trim().max(200).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type UpdateStoryRevisionCommand = z.infer<typeof updateStoryRevisionCommandSchema>;

export const mergeStoriesCommandSchema = z.object({
    canonicalStoryId: z.string().trim().min(1).max(300),
    obsoleteStoryIds: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type MergeStoriesCommand = z.infer<typeof mergeStoriesCommandSchema>;

// One successor of a Story split plus the relations explicitly moved from the
// historical shell to it; unlisted relations stay on the shell (ADR-0012
// decision 3).
export const storySplitSuccessorSchema = z.object({
    title: z.string().trim().min(1).max(500),
    summary: z.string().trim().max(5000).nullish(),
    kind: z.enum(["event", "document", "media", "thread"]),
    subtype: z.string().trim().max(200).nullish(),
    entryIds: z.array(z.string().trim().min(1).max(300)).min(1).max(500),
    evidenceEntryIds: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
    entityIds: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
    topicIds: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
});
export type StorySplitSuccessor = z.infer<typeof storySplitSuccessorSchema>;

export const splitStoryCommandSchema = z.object({
    successors: z.array(storySplitSuccessorSchema).min(2).max(20),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type SplitStoryCommand = z.infer<typeof splitStoryCommandSchema>;

export const linkEntryStoryCommandSchema = z.object({
    entryId: z.string().trim().min(1).max(300),
    storyId: z.string().trim().min(1).max(300),
    relationType: entryStoryRelationTypeSchema,
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
}).merge(entryStoryLinkProvenanceSchema);
export type LinkEntryStoryCommand = z.infer<typeof linkEntryStoryCommandSchema>;

export const unlinkEntryStoryCommandSchema = z.object({
    entryId: z.string().trim().min(1).max(300),
    storyId: z.string().trim().min(1).max(300),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type UnlinkEntryStoryCommand = z.infer<typeof unlinkEntryStoryCommandSchema>;

export const topicMemberRoleSchema = z.enum([
    "core",
    "update",
    "background",
    "analysis",
    "counterpoint",
    "tutorial",
]);
export type TopicMemberRole = z.infer<typeof topicMemberRoleSchema>;

export const topicMemberSchema = z.object({
    storyId: z.string(),
    // Read-side role is permissive: unknown roles stored by future writers
    // degrade to a plain string instead of breaking the whole detail payload.
    role: z.string(),
    reason: z.string().nullable(),
    actor: z.string().nullable(),
    revision: z.number().int().positive(),
    removed: z.boolean(),
});
export type TopicMember = z.infer<typeof topicMemberSchema>;

export const topicDetailSchema = z.object({
    topic: z.object({
        id: z.string(),
        revisionId: z.string(),
        title: z.string(),
        purpose: z.string(),
        scope: z.string().nullable(),
    }),
    members: topicMemberSchema.array(),
});
export type TopicDetail = z.infer<typeof topicDetailSchema>;

export const topicSummarySchema = z.object({
    id: z.string(),
    revisionId: z.string(),
    title: z.string(),
    purpose: z.string(),
    scope: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
    updatedAt: z.string(),
});
export type TopicSummary = z.infer<typeof topicSummarySchema>;

export const topicPageSchema = z.object({
    items: topicSummarySchema.array(),
    nextCursor: z.string().nullable(),
});
export type TopicPage = z.infer<typeof topicPageSchema>;

export const createTopicCommandSchema = z.object({
    title: z.string().trim().min(1).max(500),
    purpose: z.string().trim().min(1).max(5000),
    scope: z.string().trim().max(5000).nullish(),
    seedStoryId: z.string().trim().min(1).max(300).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type CreateTopicCommand = z.infer<typeof createTopicCommandSchema>;

export const updateTopicCommandSchema = z.object({
    baseRevisionId: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(500),
    purpose: z.string().trim().min(1).max(5000),
    scope: z.string().trim().max(5000).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type UpdateTopicCommand = z.infer<typeof updateTopicCommandSchema>;

export const mergeTopicsCommandSchema = z.object({
    canonicalTopicId: z.string().trim().min(1).max(300),
    obsoleteTopicIds: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type MergeTopicsCommand = z.infer<typeof mergeTopicsCommandSchema>;

export const addTopicMemberCommandSchema = z.object({
    storyId: z.string().trim().min(1).max(300),
    role: topicMemberRoleSchema,
    reason: z.string().trim().min(1).max(1000).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
});
export type AddTopicMemberCommand = z.infer<typeof addTopicMemberCommandSchema>;

export const updateTopicMemberRoleCommandSchema = z.object({
    storyId: z.string().trim().min(1).max(300),
    role: topicMemberRoleSchema,
    reason: z.string().trim().min(1).max(1000).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
});
export type UpdateTopicMemberRoleCommand = z.infer<typeof updateTopicMemberRoleCommandSchema>;

export const removeTopicMemberCommandSchema = z.object({
    storyId: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(1000).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
});
export type RemoveTopicMemberCommand = z.infer<typeof removeTopicMemberCommandSchema>;

export const restoreTopicMemberCommandSchema = z.object({
    storyId: z.string().trim().min(1).max(300),
    role: topicMemberRoleSchema,
    reason: z.string().trim().min(1).max(1000).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
});
export type RestoreTopicMemberCommand = z.infer<typeof restoreTopicMemberCommandSchema>;

export const entityTypeSchema = z.enum([
    "person",
    "organization",
    "product",
    "project",
    "model",
    "location",
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const entityRelationTypeSchema = z.enum([
    "founded",
    "works_at",
    "located_in",
    "produced",
    "part_of",
    "related_to",
]);
export type EntityRelationType = z.infer<typeof entityRelationTypeSchema>;

export const entityLinkProvenanceSchema = z.object({
    // Provenance is optional on writes; storage defaults to producer "human"
    // and confidence 1 when the caller does not claim a derived source.
    producer: z.string().trim().min(1).max(200).nullish(),
    producerVersion: z.string().trim().max(100).nullish(),
    confidence: z.number().min(0).max(1).nullish(),
    evidence: z.string().trim().max(5000).nullish(),
});
export type EntityLinkProvenance = z.infer<typeof entityLinkProvenanceSchema>;

export const entitySchema = z.object({
    id: z.string(),
    revisionId: z.string(),
    // Read-side type is permissive so unknown future types degrade instead of
    // breaking the whole detail payload (same policy as Story subtype).
    type: z.string(),
    name: z.string(),
});
export type Entity = z.infer<typeof entitySchema>;

export const entityStoryLinkSchema = z.object({
    storyId: z.string(),
    producer: z.string(),
    producerVersion: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    actor: z.string().nullable(),
    reason: z.string().nullable(),
});
export type EntityStoryLink = z.infer<typeof entityStoryLinkSchema>;

export const entityRelationSchema = z.object({
    fromEntityId: z.string(),
    relationType: z.string(),
    toEntityId: z.string(),
    producer: z.string(),
    producerVersion: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    actor: z.string().nullable(),
    reason: z.string().nullable(),
});
export type EntityRelation = z.infer<typeof entityRelationSchema>;

export const entityDetailSchema = z.object({
    entity: entitySchema,
    aliases: z.array(z.string()),
    stories: entityStoryLinkSchema.array(),
    relations: entityRelationSchema.array(),
});
export type EntityDetail = z.infer<typeof entityDetailSchema>;

export const entitySummarySchema = z.object({
    id: z.string(),
    revisionId: z.string(),
    type: z.string(),
    name: z.string(),
    storyCount: z.number().int().nonnegative(),
    relationCount: z.number().int().nonnegative(),
    updatedAt: z.string(),
});
export type EntitySummary = z.infer<typeof entitySummarySchema>;

export const entityPageSchema = z.object({
    items: entitySummarySchema.array(),
    nextCursor: z.string().nullable(),
});
export type EntityPage = z.infer<typeof entityPageSchema>;

export const createEntityCommandSchema = z.object({
    name: z.string().trim().min(1).max(500),
    type: entityTypeSchema,
    alias: z.string().trim().min(1).max(500).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type CreateEntityCommand = z.infer<typeof createEntityCommandSchema>;

export const updateEntityCommandSchema = z.object({
    baseRevisionId: z.string().trim().min(1).max(300),
    name: z.string().trim().min(1).max(500),
    type: entityTypeSchema,
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type UpdateEntityCommand = z.infer<typeof updateEntityCommandSchema>;

export const addEntityAliasCommandSchema = z.object({
    name: z.string().trim().min(1).max(500),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type AddEntityAliasCommand = z.infer<typeof addEntityAliasCommandSchema>;

export const removeEntityAliasCommandSchema = z.object({
    name: z.string().trim().min(1).max(500),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type RemoveEntityAliasCommand = z.infer<typeof removeEntityAliasCommandSchema>;

export const linkStoryEntityCommandSchema = z.object({
    storyId: z.string().trim().min(1).max(300),
    entityId: z.string().trim().min(1).max(300),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
}).merge(entityLinkProvenanceSchema);
export type LinkStoryEntityCommand = z.infer<typeof linkStoryEntityCommandSchema>;

export const unlinkStoryEntityCommandSchema = z.object({
    storyId: z.string().trim().min(1).max(300),
    entityId: z.string().trim().min(1).max(300),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type UnlinkStoryEntityCommand = z.infer<typeof unlinkStoryEntityCommandSchema>;

export const createEntityRelationCommandSchema = z.object({
    fromEntityId: z.string().trim().min(1).max(300),
    toEntityId: z.string().trim().min(1).max(300),
    relationType: entityRelationTypeSchema,
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
}).merge(entityLinkProvenanceSchema);
export type CreateEntityRelationCommand = z.infer<typeof createEntityRelationCommandSchema>;

export const removeEntityRelationCommandSchema = z.object({
    fromEntityId: z.string().trim().min(1).max(300),
    toEntityId: z.string().trim().min(1).max(300),
    // Relation removal matches whatever type string is stored; a permissive
    // type lets stale clients still remove future relation types.
    relationType: z.string().trim().min(1).max(100),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});
export type RemoveEntityRelationCommand = z.infer<typeof removeEntityRelationCommandSchema>;

// ---------------------------------------------------------------------------
// User organization v1 (sub-slice A: Label + Collection + Favorite) — ADR-0009
// ---------------------------------------------------------------------------

export const targetTypeSchema = z.enum(["story", "entry", "topic"]);
export type TargetType = z.infer<typeof targetTypeSchema>;

export const favoriteTargetTypeSchema = z.enum(["story", "entry"]);
export type FavoriteTargetType = z.infer<typeof favoriteTargetTypeSchema>;

/**
 * Result of a top-level user-organization write whose natural outcome is not a
 * single aggregate read model (label delete/detach, collection delete or item
 * toggles, favorite set/unset). `action` names the completed mutation so a
 * client can refresh the right surface without string-parsing the URL.
 */
export const userOrganizationAckSchema = z.object({
    ok: z.literal(true),
    id: z.string(),
    action: z.string(),
});
export type UserOrganizationAck = z.infer<typeof userOrganizationAckSchema>;

export const labelItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    assignedCount: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type LabelItem = z.infer<typeof labelItemSchema>;

export const labelListSchema = z.object({
    items: labelItemSchema.array(),
});
export type LabelList = z.infer<typeof labelListSchema>;

export const labelDetailSchema = z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // Assigned targets grouped by type with a resolved display title so a label
    // drill-down can render without the client resolving each target id.
    assignedStories: z.array(z.object({ id: z.string(), title: z.string() })),
    assignedEntries: z.array(z.object({ id: z.string(), title: z.string() })),
    assignedTopics: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type LabelDetail = z.infer<typeof labelDetailSchema>;

export const createLabelCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
});
export type CreateLabelCommand = z.infer<typeof createLabelCommandSchema>;

export const labelAssignmentCommandSchema = z.object({
    labelId: z.string().trim().min(1).max(300),
    targetType: targetTypeSchema,
    targetId: z.string().trim().min(1).max(300),
});
export type LabelAssignmentCommand = z.infer<typeof labelAssignmentCommandSchema>;

export const collectionSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    itemCount: z.number().int().nonnegative(),
    // Present only when listCollections is asked for one story's membership.
    containsStory: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export const collectionListSchema = z.object({
    items: collectionSummarySchema.array(),
});
export type CollectionList = z.infer<typeof collectionListSchema>;

export const collectionDetailSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    stories: z.array(z.object({
        storyId: z.string(),
        title: z.string(),
        addedAt: z.string(),
    })),
});
export type CollectionDetail = z.infer<typeof collectionDetailSchema>;

export const createCollectionCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).nullish(),
});
export type CreateCollectionCommand = z.infer<typeof createCollectionCommandSchema>;

export const updateCollectionCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).nullish(),
});
export type UpdateCollectionCommand = z.infer<typeof updateCollectionCommandSchema>;

export const collectionItemCommandSchema = z.object({
    storyId: z.string().trim().min(1).max(300),
});
export type CollectionItemCommand = z.infer<typeof collectionItemCommandSchema>;

export const favoriteCommandSchema = z.object({
    targetType: favoriteTargetTypeSchema,
    targetId: z.string().trim().min(1).max(300),
});
export type FavoriteCommand = z.infer<typeof favoriteCommandSchema>;

export const favoriteItemSchema = z.object({
    targetType: favoriteTargetTypeSchema,
    targetId: z.string(),
    createdAt: z.string(),
});
export type FavoriteItem = z.infer<typeof favoriteItemSchema>;

export const favoriteListSchema = z.object({
    items: favoriteItemSchema.array(),
});
export type FavoriteList = z.infer<typeof favoriteListSchema>;

export const annotationSchema = z.object({
    id: z.string(),
    // Read-side target type stays permissive so annotations written against a
    // future target type do not break older clients.
    targetType: z.string(),
    targetId: z.string(),
    // Immutable display revision the note was written against, when the target
    // had one at write time (ADR-0009 decision 4).
    targetRevisionId: z.string().nullable(),
    quote: z.string().nullable(),
    body: z.string(),
    evidence: z.string().nullable(),
    actor: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const annotationListSchema = z.object({
    items: annotationSchema.array(),
});
export type AnnotationList = z.infer<typeof annotationListSchema>;

export const createAnnotationCommandSchema = z.object({
    targetType: targetTypeSchema,
    targetId: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(10000),
    quote: z.string().trim().max(5000).nullish(),
    evidence: z.string().trim().max(5000).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
});
export type CreateAnnotationCommand = z.infer<typeof createAnnotationCommandSchema>;

export const updateAnnotationCommandSchema = z.object({
    body: z.string().trim().min(1).max(10000),
    quote: z.string().trim().max(5000).nullish(),
    evidence: z.string().trim().max(5000).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
});
export type UpdateAnnotationCommand = z.infer<typeof updateAnnotationCommandSchema>;

export const annotationTargetQuerySchema = z.object({
    targetType: targetTypeSchema,
    targetId: z.string().trim().min(1).max(300),
});
export type AnnotationTargetQuery = z.infer<typeof annotationTargetQuerySchema>;

// ---------------------------------------------------------------------------
// Configurable dashboard (ADR-0010)
// ---------------------------------------------------------------------------

/**
 * Widget types a board block can render. Write-side enum, additive only;
 * read-side block `type` stays a plain string so blocks written against a
 * future type degrade to a placeholder instead of failing the board.
 */
export const blockTypeSchema = z.enum([
    "feed",
    "spotlight",
    "source-health",
    "topic-list",
    "collection",
]);
export type BlockType = z.infer<typeof blockTypeSchema>;

const blockLimitSchema = z.number().int().min(1).max(100).optional();

/**
 * Per-type whitelist config, keyed by block type. `feed`/`collection` reference
 * objects by id without a cross-table FK, and the binding is optional: a block
 * can be created unbound and configured later, while a dangling id renders a
 * degraded placeholder on read, never a hard error (ADR-0010 decision 5).
 */
export const blockConfigSchemas = {
    // savedViewId omitted = unfiltered story feed (BRD-006 "可绑定": binding is
    // optional so a block can render the default feed without a Saved View).
    feed: z.object({
        savedViewId: z.string().trim().min(1).max(300).optional(),
        limit: blockLimitSchema,
    }).strict(),
    spotlight: z.object({ limit: blockLimitSchema }).strict(),
    "source-health": z.object({ limit: blockLimitSchema }).strict(),
    "topic-list": z.object({ limit: blockLimitSchema }).strict(),
    // collectionId omitted = created unbound, renders a placeholder until the
    // editor picks a collection (same optional-binding rule as feed).
    collection: z.object({
        collectionId: z.string().trim().min(1).max(300).optional(),
        limit: blockLimitSchema,
    }).strict(),
} as const;

export type FeedBlockConfig = z.infer<typeof blockConfigSchemas.feed>;
export type SpotlightBlockConfig = z.infer<typeof blockConfigSchemas.spotlight>;
export type SourceHealthBlockConfig = z.infer<typeof blockConfigSchemas["source-health"]>;
export type TopicListBlockConfig = z.infer<typeof blockConfigSchemas["topic-list"]>;
export type CollectionBlockConfig = z.infer<typeof blockConfigSchemas.collection>;

/**
 * Config whitelist schema for one block type, or null for an unknown type.
 * Write endpoints parse incoming config with this so a mismatch surfaces as a
 * 400 validation failure; storage re-runs it as the last-line defense.
 */
export function blockConfigSchemaFor(type: string): z.ZodTypeAny | null {
    return (blockConfigSchemas as Record<string, z.ZodTypeAny | undefined>)[type] ?? null;
}

export const boardSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    sectionCount: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type BoardSummary = z.infer<typeof boardSummarySchema>;

export const boardListSchema = z.object({
    items: boardSummarySchema.array(),
});
export type BoardList = z.infer<typeof boardListSchema>;

export const boardBlockSchema = z.object({
    id: z.string(),
    sectionId: z.string(),
    // Permissive on read (see blockTypeSchema above).
    type: z.string(),
    config: z.record(z.string(), z.unknown()),
    position: z.number().int().nonnegative(),
    visible: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type BoardBlock = z.infer<typeof boardBlockSchema>;

export const boardSectionSchema = z.object({
    id: z.string(),
    boardId: z.string(),
    title: z.string(),
    position: z.number().int().nonnegative(),
    // Blocks ordered by position; sections and blocks arrive sorted.
    blocks: boardBlockSchema.array(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type BoardSection = z.infer<typeof boardSectionSchema>;

export const boardDetailSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    sections: boardSectionSchema.array(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type BoardDetail = z.infer<typeof boardDetailSchema>;

export const createBoardCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).nullish(),
});
export type CreateBoardCommand = z.infer<typeof createBoardCommandSchema>;

export const updateBoardCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).nullish(),
});
export type UpdateBoardCommand = z.infer<typeof updateBoardCommandSchema>;

export const createSectionCommandSchema = z.object({
    boardId: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(200),
    // Omitted = append after the current last section.
    position: z.number().int().nonnegative().optional(),
});
export type CreateSectionCommand = z.infer<typeof createSectionCommandSchema>;

export const updateSectionCommandSchema = z.object({
    title: z.string().trim().min(1).max(200),
    // Omitted = keep the current position; provided = move the section there
    // and shift the others (the storage boundary re-sequences the board).
    position: z.number().int().nonnegative().optional(),
});
export type UpdateSectionCommand = z.infer<typeof updateSectionCommandSchema>;

/**
 * Block write commands carry `type` strictly but `config` as a plain record:
 * the storage boundary validates the record against `blockConfigSchemas[type]`,
 * so the whitelist lives in one place instead of being duplicated per endpoint.
 */
export const createBlockCommandSchema = z.object({
    sectionId: z.string().trim().min(1).max(300),
    type: blockTypeSchema,
    config: z.record(z.string(), z.unknown()),
    position: z.number().int().nonnegative().optional(),
});
export type CreateBlockCommand = z.infer<typeof createBlockCommandSchema>;

export const updateBlockConfigCommandSchema = z.object({
    config: z.record(z.string(), z.unknown()),
});
export type UpdateBlockConfigCommand = z.infer<typeof updateBlockConfigCommandSchema>;

export const moveBlockCommandSchema = z.object({
    // Omitted = stay in the current section.
    sectionId: z.string().trim().min(1).max(300).optional(),
    position: z.number().int().nonnegative(),
});
export type MoveBlockCommand = z.infer<typeof moveBlockCommandSchema>;

export const setBlockVisibilityCommandSchema = z.object({
    visible: z.boolean(),
});
export type SetBlockVisibilityCommand = z.infer<typeof setBlockVisibilityCommandSchema>;

/**
 * Result of a top-level board write whose natural outcome is not a single
 * aggregate read model (board/section/block delete, duplicate, visibility,
 * move). Same shape as `userOrganizationAck`.
 */
export const boardCommandAckSchema = z.object({
    ok: z.literal(true),
    id: z.string(),
    action: z.string(),
});
export type BoardCommandAck = z.infer<typeof boardCommandAckSchema>;

/**
 * Manual spotlight placement (ADR-0010 decision 3): write-side target enum
 * story/topic, read-side targetType stays permissive for future kinds. It
 * shares the placement contract with the future automatic policy — v1 only
 * writes `source: "manual"` with a null `expiresAt`.
 */
export const spotlightTargetTypeSchema = z.enum(["story", "topic"]);

export const spotlightPlacementSchema = z.object({
    id: z.string(),
    boardId: z.string(),
    // Permissive on read (see above).
    targetType: z.string(),
    targetId: z.string(),
    source: z.string(),
    reason: z.string().nullable(),
    actor: z.string().nullable(),
    expiresAt: z.string().nullable(),
    // Resolved display title so a spotlight block renders without N+1 lookups.
    targetTitle: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type SpotlightPlacement = z.infer<typeof spotlightPlacementSchema>;

export const spotlightPlacementListSchema = z.object({
    items: spotlightPlacementSchema.array(),
});
export type SpotlightPlacementList = z.infer<typeof spotlightPlacementListSchema>;

export const pinSpotlightCommandSchema = z.object({
    boardId: z.string().trim().min(1).max(300),
    targetType: spotlightTargetTypeSchema,
    targetId: z.string().trim().min(1).max(300),
    reason: z.string().trim().max(1000).nullish(),
    actor: z.string().trim().min(1).max(100).nullish(),
});
export type PinSpotlightCommand = z.infer<typeof pinSpotlightCommandSchema>;

/**
 * Persisted query conditions for reuse (ADR-0009 decision 5). It stores no
 * result snapshot: applying a view re-runs `search` with these conditions.
 */
export const savedViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    text: z.string().nullable(),
    sourceId: z.string().nullable(),
    publishedAfter: z.string().nullable(),
    publishedBefore: z.string().nullable(),
    labelIds: z.array(z.string()),
    topicIds: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type SavedView = z.infer<typeof savedViewSchema>;

export const savedViewListSchema = z.object({
    items: savedViewSchema.array(),
});
export type SavedViewList = z.infer<typeof savedViewListSchema>;

export const savedViewConditionsSchema = z.object({
    text: z.string().trim().max(500).nullish(),
    sourceId: z.string().trim().max(300).nullish(),
    publishedAfter: z.string().datetime({ offset: true }).nullish(),
    publishedBefore: z.string().datetime({ offset: true }).nullish(),
    labelIds: z.array(z.string().trim().min(1).max(300)).max(50).nullish(),
    topicIds: z.array(z.string().trim().min(1).max(300)).max(50).nullish(),
});
export type SavedViewConditions = z.infer<typeof savedViewConditionsSchema>;

export const createSavedViewCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    conditions: savedViewConditionsSchema,
});
export type CreateSavedViewCommand = z.infer<typeof createSavedViewCommandSchema>;

export const updateSavedViewCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    conditions: savedViewConditionsSchema,
});
export type UpdateSavedViewCommand = z.infer<typeof updateSavedViewCommandSchema>;

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
