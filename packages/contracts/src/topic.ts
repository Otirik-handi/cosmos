import { z } from "zod";

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

