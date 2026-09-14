import { z } from "zod";

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

