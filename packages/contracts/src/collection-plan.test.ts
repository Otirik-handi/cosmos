import { describe, expect, it } from "vitest";

import {
    collectionPlanOverlapPolicySchema,
    collectionPlanSnapshotSchema,
    createCollectionPlanCommandSchema,
    updateCollectionPlanCommandSchema,
} from "./index.js";

const snapshot = {
    id: "plan-1",
    name: "主账号动态每 30 分钟",
    sourceId: "source-1",
    connectionId: "connection-1",
    triggerBindingId: "trigger-1",
    mediaPolicy: null,
    overlapPolicy: "forbid",
    enabled: true,
    revisionId: "3",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
};

describe("CollectionPlan v1 合同 (ADR-0023)", () => {
    it("重叠策略 v1 只有与现状等价的一种，其它值显式拒绝", () => {
        expect(collectionPlanOverlapPolicySchema.options).toEqual(["forbid"]);
        expect(collectionPlanOverlapPolicySchema.safeParse("queue").success).toBe(false);
        expect(collectionPlanOverlapPolicySchema.safeParse("merge").success).toBe(false);
    });

    it("计划快照是 strict 的读投影", () => {
        expect(collectionPlanSnapshotSchema.parse(snapshot)).toEqual(snapshot);
        // 内部字段不能借读投影泄漏（与公开 Asset 投影同一纪律）。
        expect(collectionPlanSnapshotSchema.safeParse({ ...snapshot, sourceInstanceId: "source-1" }).success).toBe(false);
        expect(collectionPlanSnapshotSchema.safeParse({ ...snapshot, mediaPolicyJson: "{}" }).success).toBe(false);
        expect(collectionPlanSnapshotSchema.safeParse({ ...snapshot, enabled: undefined }).success).toBe(false);
    });

    it("创建命令要求采集目标，不接受 Worker 或调度字段", () => {
        expect(createCollectionPlanCommandSchema.parse({
            name: "推荐流每 2 小时",
            sourceId: "source-2",
        })).toEqual({ name: "推荐流每 2 小时", sourceId: "source-2" });

        // 调度由计划自己的 TriggerBinding 承担，命令里再带一份就是第二套真相。
        expect(createCollectionPlanCommandSchema.safeParse({
            name: "x",
            sourceId: "s",
            scheduleIntervalMs: 1_800_000,
        }).success).toBe(false);
        expect(createCollectionPlanCommandSchema.safeParse({ name: "x", sourceId: "s", workerId: "w" }).success).toBe(false);
        expect(createCollectionPlanCommandSchema.safeParse({ name: "", sourceId: "s" }).success).toBe(false);
    });

    it("更新命令必须携带 baseRevisionId，且不能改采集目标", () => {
        expect(updateCollectionPlanCommandSchema.parse({
            baseRevisionId: "1",
            name: "改名",
        })).toEqual({ baseRevisionId: "1", name: "改名" });

        expect(updateCollectionPlanCommandSchema.safeParse({ name: "改名" }).success).toBe(false);
        expect(updateCollectionPlanCommandSchema.safeParse({ baseRevisionId: "1", sourceId: "other" }).success).toBe(false);
    });
});
