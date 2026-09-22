import { z } from "zod";

import { ingestTriggerEvidenceSchema, ingestTriggerKindSchema } from "./action.js";

export const runStatusSchema = z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
]);

export type RunStatus = z.infer<typeof runStatusSchema>;


export const runSnapshotSchema = z.object({
    id: z.string(),
    sourceId: z.string().nullable(),
    triggerKind: ingestTriggerKindSchema,
    /**
     * 触发原因（AUT-004）。可选是为了兼容两类既有生产者：legacy SQL Run 行没有证据
     * 概念，durable 快照里 manual/schedule 的 Run 也没有。null 表示「这一类触发没有
     * 证据」，与 undefined（生产者还没提供该字段）区分。
     */
    triggerEvidence: ingestTriggerEvidenceSchema.nullable().optional(),
    status: runStatusSchema,
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    itemCount: z.number(),
    createdEntryCount: z.number(),
    revisedEntryCount: z.number(),
    error: z.string().nullable(),
});

export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

/**
 * Run control v1 (RUN-004 / ADR-0016). Cancel, re-run and recover are
 * durable-WorkflowRun-only actions; the legacy SQL Run lane is out of scope.
 * The result reuses the stable RunSnapshot and adds two user-facing strings
 * that explain which results are reused and which new side effects the action
 * produces, so the UI never has to guess.
 */

export const runControlActionSchema = z.enum(["cancelled", "recovered", "rerun"]);

export type RunControlAction = z.infer<typeof runControlActionSchema>;


export const cancelRunCommandSchema = z.object({
    reason: z.string().trim().max(500).optional(),
}).strict();

export type CancelRunCommand = z.infer<typeof cancelRunCommandSchema>;


export const recoverRunCommandSchema = z.object({
    reason: z.string().trim().max(500).optional(),
}).strict();

export type RecoverRunCommand = z.infer<typeof recoverRunCommandSchema>;


export const rerunRunCommandSchema = z.object({}).strict();

export type RerunRunCommand = z.infer<typeof rerunRunCommandSchema>;


export const runControlResultSchema = z.object({
    action: runControlActionSchema,
    run: runSnapshotSchema,
    /** 面向用户：本动作复用哪些已入库结果。 */
    reuse: z.string(),
    /** 面向用户：本动作产生哪些新副作用。 */
    sideEffects: z.string(),
}).strict();

export type RunControlResult = z.infer<typeof runControlResultSchema>;

/**
 * Storage occupancy snapshot (ADR-0019 / OPS-003). Sizes are byte counts; the
 * `categories` split raw data / user data / rebuildable cache / cleanable media
 * so the UI never has to guess what is safe to delete.
 */
