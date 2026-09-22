import { z } from "zod";

import { sourceMediaPolicySchema, sourceRevisionIdSchema, triggerIntervalSchema } from "./base.js";

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
    /**
     * 目标的 revision。v1 的删除仍是目标域命令（`DELETE /collection-plans/{id}` 是 Planned），
     * 产品面要拿它才能发那条命令；这是「计划引用目标」的读投影，与
     * `SourceSnapshot.planRevisionId` 对称。
     */
    sourceRevisionId: sourceRevisionIdSchema,
    connectionId: z.string().nullable(),
    triggerBindingId: z.string().nullable(),
    mediaPolicy: sourceMediaPolicySchema.nullable(),
    overlapPolicy: collectionPlanOverlapPolicySchema,
    enabled: z.boolean(),
    revisionId: sourceRevisionIdSchema,
    /** 计划的调度间隔；没有调度绑定时为 null（只手动触发）。 */
    scheduleIntervalMs: z.number().int().nullable(),
    /**
     * 最近一次运行与错误，取**归计划**的 Run／WorkflowRun（ADR-0023 决策 2 已把运行归属
     * 计划）。产品面按计划呈现状态，所以这是计划自己的事实，不再从来源行借用。
     */
    lastRunAt: z.string().nullable(),
    lastError: z.string().nullable(),
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

/**
 * 计划自有字段的唯一写入口（ADR-0023 决策 2 的字段边界）。启用状态也在这里，不另设
 * activation Command：Draft 未为计划定义该路由，`baseRevisionId` CAS 已能阻止并发覆盖，
 * 且启停不产生新事实、不需要幂等键。
 */
export const updateCollectionPlanCommandSchema = z.object({
    baseRevisionId: sourceRevisionIdSchema,
    name: z.string().trim().min(1).max(200).optional(),
    connectionId: z.string().trim().min(1).max(100).nullable().optional(),
    /** null 移除调度绑定（计划只手动触发）。 */
    scheduleIntervalMs: triggerIntervalSchema.nullable().optional(),
    mediaPolicy: sourceMediaPolicySchema.nullish(),
    enabled: z.boolean().optional(),
}).strict();
export type UpdateCollectionPlanCommand = z.infer<typeof updateCollectionPlanCommandSchema>;
