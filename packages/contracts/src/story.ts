import { z } from "zod";
import { temporalValueSchema } from "./base.js";
import {
    entryDetailSchema,
    entryStoryLinkProvenanceSchema,
    entryStoryRelationTypeSchema,
    storyEvidenceSchema,
} from "./entry-relation.js";

// Story representation ceilings (ADR-0021 decision 3). They duplicate the
// exported `storyKeyFactMaxCount` / `storyKeyFactMaxTextLength` of @cosmos/domain
// on purpose: this package is bundled into the browser, and @cosmos/domain
// statically imports node:crypto, so importing it here would break the Web build.
// Both sides pin the numbers in their own tests.
const storyKeyFactMaxCount = 20;
const storyKeyFactMaxTextLength = 500;

// Story time range reuses the Entry-side temporal semantics so precision and
// "raw text only" survive on both sides; only `start` is required, and a range
// whose end precedes its start is rejected (ADR-0021 decision 2). Comparison is
// by instant, not by string: `exact` carries an offset.

export const storyTimeRangeSchema = z.object({
    start: temporalValueSchema,
    end: temporalValueSchema.nullable(),
}).refine((value) => {
    if (!value.start.exact || !value.end?.exact) {
        return true;
    }
    return Date.parse(value.end.exact) >= Date.parse(value.start.exact);
}, "Story time range end must not precede its start.");

export type StoryTimeRange = z.infer<typeof storyTimeRangeSchema>;

// One ordered key fact plus its optional single source; the array order is the
// display order and a missing source is a legitimate value (ADR-0021 decision 3).

export const storyKeyFactSchema = z.object({
    text: z.string().trim().min(1).max(storyKeyFactMaxTextLength),
    entryId: z.string().trim().max(300).nullable().default(null),
});

export type StoryKeyFact = z.infer<typeof storyKeyFactSchema>;

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
        // The other two of the four current-representation fields (ADR-0021
        // decision 1). Optional on read so payloads written before the
        // extension still parse; the repository always emits both.
        timeRange: storyTimeRangeSchema.nullish(),
        keyFacts: z.array(storyKeyFactSchema).nullish(),
        // Who wrote the current Revision: "human" means the representation is
        // frozen against automatic writers, so a client can say so instead of
        // showing a Story that silently stopped following its source
        // (ADR-0028). Loose on read like the other producer fields; the write
        // side is server-assigned and not caller-supplied.
        producer: z.string(),
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
    // Full-representation submit: omitting an extension clears it, there is no
    // partial update (ADR-0021 decision 5).
    timeRange: storyTimeRangeSchema.nullish(),
    keyFacts: z.array(storyKeyFactSchema).max(storyKeyFactMaxCount).nullish(),
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
    // Each successor expresses its own representation; the shell's values are
    // never copied over (ADR-0021 decision 6).
    timeRange: storyTimeRangeSchema.nullish(),
    keyFacts: z.array(storyKeyFactSchema).max(storyKeyFactMaxCount).nullish(),
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

// Explicit move of Story-target user state inside one split family: the
// historical shell and the successors it replaced_by. Only state whose target
// is the Story itself is named here — state attached to an Entry or a Topic
// follows that object instead (ADR-0020 decision 1). Naming a row that is not
// on the source Story is a conflict, not a silent no-op: the caller's view is
// stale.

export const migrateStoryUserStateCommandSchema = z.object({
    targetStoryId: z.string().trim().min(1).max(300),
    // There is at most one Story favorite, so it is a flag rather than an id.
    favorite: z.boolean().default(false),
    // Labels and collections are named by their own id, not by the id of the
    // assignment row: `(label, story)` and `(collection, story)` are unique, so
    // the row to move is already unambiguous and the read model never has to
    // expose an internal assignment id.
    labelIds: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
    collectionIds: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
    annotationIds: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
    spotlightPlacementIds: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
    actor: z.string().trim().min(1).max(100).nullish(),
    reason: z.string().trim().min(1).max(1000).nullish(),
    basis: z.string().trim().min(1).max(1000).nullish(),
});

export type MigrateStoryUserStateCommand = z.infer<typeof migrateStoryUserStateCommandSchema>;

// Per-kind outcome of one migration, so the caller can report what actually
// happened instead of assuming every named row moved.

export const storyUserStateMigrationCountsSchema = z.object({
    moved: z.number().int().nonnegative(),
    // Rows dropped because the target Story already carried the equivalent row;
    // the target's row wins (ADR-0020 decision 4, symmetric to Story merge).
    deduped: z.number().int().nonnegative(),
});

export type StoryUserStateMigrationCounts = z.infer<typeof storyUserStateMigrationCountsSchema>;


export const storyUserStateMigrationResultSchema = z.object({
    sourceStoryId: z.string(),
    targetStoryId: z.string(),
    favorite: storyUserStateMigrationCountsSchema,
    labelAssignments: storyUserStateMigrationCountsSchema,
    collectionItems: storyUserStateMigrationCountsSchema,
    annotations: storyUserStateMigrationCountsSchema,
    spotlightPlacements: storyUserStateMigrationCountsSchema,
});

export type StoryUserStateMigrationResult = z.infer<typeof storyUserStateMigrationResultSchema>;


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

