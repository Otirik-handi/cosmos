import { z } from "zod";
import {
    contentKindSchema,
    sourceKindSchema,
} from "./base.js";
import {
    assetStatusSchema,
    publicAssetSnapshotSchema,
} from "./source.js";

export const searchQuerySchema = z.object({
    text: z.string().trim().max(500).optional(),
    sourceId: z.string().optional(),
    publishedAfter: z.string().datetime({ offset: true }).optional(),
    publishedBefore: z.string().datetime({ offset: true }).optional(),
    // User-organization filters (ADR-0009 decision 5): comma-separated ids.
    labelIds: z.string().optional(),
    topicIds: z.string().optional(),
    // LIB-001 的三个过滤维度：作者按发布者 name/handle 子串匹配，媒体类型取内容形态，
    // 录入状态取该 Entry 当前 Revision 的本地媒体状态。「未读」是 Read State（LIB-005，
    // Phase 4），不在这里表达。
    author: z.string().trim().max(200).optional(),
    contentKind: contentKindSchema.optional(),
    assetStatus: assetStatusSchema.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SearchQuery = z.input<typeof searchQuerySchema>;


export const feedItemSchema = z.object({
    storyId: z.string(),
    storyKind: z.enum(["event", "document", "media", "thread"]),
    title: z.string(),
    summary: z.string().nullable(),
    entryId: z.string(),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceKind: sourceKindSchema,
    revisionId: z.string(),
    publishedAt: z.string().nullable(),
    assets: publicAssetSnapshotSchema.array(),
});

export type FeedItem = z.infer<typeof feedItemSchema>;


export const feedPageSchema = z.object({
    items: feedItemSchema.array(),
    nextCursor: z.string().nullable(),
});

export type FeedPage = z.infer<typeof feedPageSchema>;


export const searchResultSchema = feedItemSchema.extend({
    rank: z.number().nullable(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;


export const searchPageSchema = z.object({
    items: searchResultSchema.array(),
    nextCursor: z.string().nullable(),
});

export type SearchPage = z.infer<typeof searchPageSchema>;

