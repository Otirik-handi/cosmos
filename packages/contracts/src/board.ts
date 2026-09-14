import { z } from "zod";

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
