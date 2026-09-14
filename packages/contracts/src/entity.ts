import { z } from "zod";

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

