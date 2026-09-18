import { z } from "zod";
import {
    contentKindSchema,
    contentMetricsSchema,
    publisherSchema,
    sourceKindSchema,
    temporalValueSchema,
} from "./base.js";
import {
    publicAssetSnapshotSchema,
} from "./source.js";

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
    assets: publicAssetSnapshotSchema.array(),
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


export const entryRelationTypeSchema = z.enum([
    "duplicate_of",
    "syndicated_from",
    "near_duplicate_of",
]);

export type EntryRelationType = z.infer<typeof entryRelationTypeSchema>;


export const entryRelationProvenanceSchema = z.object({
    // Same optional-on-write policy as the other relation tables: storage
    // defaults to producer "human" and confidence 1 unless the caller claims a
    // source (ADR-0022 decision 5).
    producer: z.string().trim().min(1).max(200).nullish(),
    producerVersion: z.string().trim().max(100).nullish(),
    confidence: z.number().min(0).max(1).nullish(),
    evidence: z.string().trim().max(5000).nullish(),
});

export type EntryRelationProvenance = z.infer<typeof entryRelationProvenanceSchema>;


/**
 * One Entry↔Entry relation as seen from the Entry being read: `entryId` is the
 * other side and `direction` says which way the relation points from here, so
 * the UI never has to know the storage order (ADR-0022 decision 7).
 */
export const entryRelationSchema = z.object({
    entryId: z.string(),
    // Read side stays a plain string so a relation written by a future version
    // degrades instead of failing the whole Entry payload.
    relationType: z.string(),
    direction: z.enum(["outgoing", "incoming", "symmetric"]),
    title: z.string().nullable(),
    sourceId: z.string(),
    sourceName: z.string(),
    producer: z.string(),
    producerVersion: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    actor: z.string().nullable(),
    reason: z.string().nullable(),
});

export type EntryRelation = z.infer<typeof entryRelationSchema>;


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
    // Cross-source duplicate/syndication relations. Story members are
    // EntryDetail too, so this one field also carries the member-row annotation
    // of ADR-0022 decision 7 instead of growing a second projection.
    relations: entryRelationSchema.array(),
});

export type EntryDetail = z.infer<typeof entryDetailSchema>;


/**
 * Write side of one Entry↔Entry relation. `fromEntryId`/`toEntryId` are the
 * caller's assertion: for `syndicated_from` the direction is the meaning, for
 * the symmetric kinds storage sorts the pair, so either order is the same
 * relation (ADR-0022 decision 3).
 */
export const linkEntryRelationCommandSchema = z.object({
    fromEntryId: z.string().trim().min(1).max(300),
    toEntryId: z.string().trim().min(1).max(300),
    relationType: entryRelationTypeSchema,
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
}).merge(entryRelationProvenanceSchema);

export type LinkEntryRelationCommand = z.infer<typeof linkEntryRelationCommandSchema>;


export const unlinkEntryRelationCommandSchema = z.object({
    fromEntryId: z.string().trim().min(1).max(300),
    toEntryId: z.string().trim().min(1).max(300),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
});

export type UnlinkEntryRelationCommand = z.infer<typeof unlinkEntryRelationCommandSchema>;


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
    assets: publicAssetSnapshotSchema.array(),
});

export type EntryListItem = z.infer<typeof entryListItemSchema>;


export const entryPageSchema = z.object({
    items: entryListItemSchema.array(),
    nextCursor: z.string().nullable(),
});

export type EntryPage = z.infer<typeof entryPageSchema>;


export const revisionDetailSchema = entryRevisionSnapshotSchema.extend({
    entryId: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceKind: sourceKindSchema,
});

export type RevisionDetail = z.infer<typeof revisionDetailSchema>;

