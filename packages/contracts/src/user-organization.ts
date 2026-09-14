import { z } from "zod";

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

