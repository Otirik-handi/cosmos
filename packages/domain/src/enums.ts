export const topicMemberRoles = [
    "core",
    "update",
    "background",
    "analysis",
    "counterpoint",
    "tutorial",
] as const;

export type TopicMemberRole = (typeof topicMemberRoles)[number];

export const entityTypes = [
    "person",
    "organization",
    "product",
    "project",
    "model",
    "location",
] as const;

export type EntityType = (typeof entityTypes)[number];

export const entityRelationTypes = [
    "founded",
    "works_at",
    "located_in",
    "produced",
    "part_of",
    "related_to",
] as const;

export type EntityRelationType = (typeof entityRelationTypes)[number];

/**
 * Targets that Label assignments and (later) Annotations can attach to
 * (ADR-0009 decision 1). Unknown values degrade on read, so the list is
 * additive only.
 */
export const targetTypes = [
    "story",
    "entry",
    "topic",
] as const;

export type TargetType = (typeof targetTypes)[number];

/**
 * Favorite targets are a subset of all attach targets: a story or entry can be
 * bookmarked, but a Topic already persists as its own long-lived container
 * (ADR-0009 decision 3).
 */
export const favoriteTargetTypes = [
    "story",
    "entry",
] as const;

export type FavoriteTargetType = (typeof favoriteTargetTypes)[number];

/**
 * Widget types a BoardBlock can render (ADR-0010 decision 2). The list is
 * additive only: readers degrade unknown types to a placeholder instead of
 * failing the whole board.
 */
export const blockTypes = [
    "feed",
    "spotlight",
    "source-health",
    "topic-list",
    "collection",
] as const;

export type BlockType = (typeof blockTypes)[number];

/**
 * Targets a manual spotlight placement can point at (ADR-0010 decision 3).
 * Story and Topic exist today; Workspace/Artifact stay out until Phase 3.
 */
export const spotlightTargetTypes = [
    "story",
    "topic",
] as const;

export type SpotlightTargetType = (typeof spotlightTargetTypes)[number];

/**
 * Auxiliary Entry↔Story relation kinds (ADR-0011 decision 1). The Entry's own
 * primary Story is expressed by `Entry.storyId`, so a link never targets it;
 * unknown values degrade on read, so the list is additive only.
 */
export const entryStoryRelationTypes = [
    "evidence_for",
    "mentions",
] as const;

export type EntryStoryRelationType = (typeof entryStoryRelationTypes)[number];

/**
 * Cross-source duplicate/syndication relations between two Entries (ADR-0022
 * decision 1). One unordered pair of Entries keeps at most one row, so the
 * reader never sees two competing current assertions about the same pair;
 * unknown values degrade on read, so the list is additive only.
 */
export const entryRelationTypes = [
    "duplicate_of",
    "syndicated_from",
    "near_duplicate_of",
] as const;

export type EntryRelationType = (typeof entryRelationTypes)[number];

/**
 * Relation types that make no claim about which Entry came first. They are
 * stored with the two Entry ids in id order, which is what keeps one unordered
 * pair down to a single row (ADR-0022 decision 3); `syndicated_from` keeps the
 * caller's semantic direction instead.
 */
export const symmetricEntryRelationTypes = [
    "duplicate_of",
    "near_duplicate_of",
] as const;

export function isSymmetricEntryRelationType(relationType: string): boolean {
    return (symmetricEntryRelationTypes as readonly string[]).includes(relationType);
}

/**
 * Canonical storage order for one Entry↔Entry relation. Both read directions
 * must land on the same row, so symmetric types are sorted by Entry id while
 * directed types keep the direction the caller asserted.
 */
export function normalizeEntryRelationEndpoints(input: {
    relationType: string;
    fromEntryId: string;
    toEntryId: string;
}): { fromEntryId: string; toEntryId: string } {
    if (!isSymmetricEntryRelationType(input.relationType)) {
        return { fromEntryId: input.fromEntryId, toEntryId: input.toEntryId };
    }
    return input.fromEntryId <= input.toEntryId
        ? { fromEntryId: input.fromEntryId, toEntryId: input.toEntryId }
        : { fromEntryId: input.toEntryId, toEntryId: input.fromEntryId };
}
