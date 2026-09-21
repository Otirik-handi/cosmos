import { z } from "zod";

import { sourceMediaPolicySchema, sourceRevisionIdSchema } from "./base.js";

/**
 * 采集计划（ADR-0023）：用户可见的独立采集计划，v1 与采集目标一对一。
 * 重叠策略 v1 只实现与现状等价的一种（上一轮未结束时到点不重复入队）；架构
 * §4.6 预留的 queue/replace/allow/merge 由后续切片补齐，所以合同直接拒绝这些
 * 值，而不是先收下再在运行时忽略。
 */
export const collectionPlanOverlapPolicySchema = z.enum(["forbid"]);
export type CollectionPlanOverlapPolicy = z.infer<typeof collectionPlanOverlapPolicySchema>;

export const collectionPlanSnapshotSchema = z.object({
    id: z.string(),
    name: z.string(),
    sourceId: z.string(),
    connectionId: z.string().nullable(),
    triggerBindingId: z.string().nullable(),
    mediaPolicy: sourceMediaPolicySchema.nullable(),
    overlapPolicy: collectionPlanOverlapPolicySchema,
    enabled: z.boolean(),
    revisionId: sourceRevisionIdSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
}).strict();
export type CollectionPlanSnapshot = z.infer<typeof collectionPlanSnapshotSchema>;

export const createCollectionPlanCommandSchema = z.object({
    name: z.string().trim().min(1).max(200),
    sourceId: z.string().trim().min(1).max(100),
    connectionId: z.string().trim().min(1).max(100).nullable().optional(),
    mediaPolicy: sourceMediaPolicySchema.nullish(),
}).strict();
export type CreateCollectionPlanCommand = z.infer<typeof createCollectionPlanCommandSchema>;

export const updateCollectionPlanCommandSchema = z.object({
    baseRevisionId: sourceRevisionIdSchema,
    name: z.string().trim().min(1).max(200).optional(),
    connectionId: z.string().trim().min(1).max(100).nullable().optional(),
    mediaPolicy: sourceMediaPolicySchema.nullish(),
}).strict();
export type UpdateCollectionPlanCommand = z.infer<typeof updateCollectionPlanCommandSchema>;
