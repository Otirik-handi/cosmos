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
    entries: entryDetailSchema.array(),
    entities: storyEntitySummarySchema.array(),
    labels: labelRefSchema.array(),
    favorited: z.boolean(),
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
