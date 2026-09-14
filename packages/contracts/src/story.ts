import { z } from "zod";
import {
    entryDetailSchema,
    entryStoryLinkProvenanceSchema,
    entryStoryRelationTypeSchema,
    storyEvidenceSchema,
} from "./entry-relation.js";

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

