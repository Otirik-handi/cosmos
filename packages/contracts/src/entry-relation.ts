import { z } from "zod";
import {
    contentKindSchema,
    contentMetricsSchema,
    publisherSchema,
    sourceKindSchema,
    temporalValueSchema,
} from "./base.js";
import {
    assetSnapshotSchema,
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


export const revisionDetailSchema = entryRevisionSnapshotSchema.extend({
    entryId: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceKind: sourceKindSchema,
});

export type RevisionDetail = z.infer<typeof revisionDetailSchema>;

