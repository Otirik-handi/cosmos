import { describe, expect, it } from "vitest";

import {
    collectionPlanOverlapPolicySchema,
    collectionPlanSnapshotSchema,
    collectionPlanWebhookEntryPath,
    collectionPlanWebhookEntrySchema,
    createCollectionPlanCommandSchema,
    updateCollectionPlanCommandSchema,
} from "./index.js";

const snapshot = {
    id: "plan-1",
    name: "主账号动态每 30 分钟",
    sourceId: "source-1",
    sourceRevisionId: "source-1:2",
    connectionId: "connection-1",
    mediaPolicy: null,
    overlapPolicy: "forbid",
    enabled: true,
    revisionId: "plan-1:3",
    scheduleIntervalMs: 1_800_000,
    webhook: null,
    lastRunAt: "2026-09-20T00:00:00.000Z",
    lastError: null,
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

    it("webhook 入口：读投影只回答「已配置」，明文只在生成结果里（ADR-0024）", () => {
        const entryPath = collectionPlanWebhookEntryPath("tok_abc");
        expect(entryPath).toBe("/hooks/collection-plans/tok_abc");

        const withEntry = {
            ...snapshot,
            webhook: { entryPath, credentialConfigured: true },
        };
        expect(collectionPlanSnapshotSchema.parse(withEntry).webhook).toEqual({
            entryPath,
            credentialConfigured: true,
        });
        // 没有入口时是 null，而不是空对象。
        expect(collectionPlanSnapshotSchema.parse({ ...snapshot, webhook: null }).webhook).toBeNull();
        // 读投影是 strict 的：明文凭证字段不能被顺带接受。
        expect(collectionPlanSnapshotSchema.safeParse({
            ...withEntry,
            webhook: { entryPath, credentialConfigured: true, credential: "plaintext" },
        }).success).toBe(false);

        const entry = collectionPlanWebhookEntrySchema.parse({
            planId: "plan-1",
            entryPath,
            credential: "plaintext-once",
        });
        expect(entry.credential).toBe("plaintext-once");
        expect(collectionPlanWebhookEntrySchema.safeParse({ planId: "plan-1", entryPath }).success).toBe(false);
    });
});
