import { describe, expect, it } from "vitest";

import { withRepository } from "./index.fixtures.js";

describe("CollectionPlan 与来源同批创建 (ADR-0023 决策 1)", () => {
    it("创建来源时同批建出默认计划，并把调度绑定挂到计划上", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: "https://example.test/feed.xml" },
                scheduleIntervalMs: 1_800_000,
            });

            const plans = await repository.prisma.collectionPlan.findMany();
            expect(plans).toHaveLength(1);
            expect(plans[0]).toMatchObject({
                id: `plan:${source.id}`,
                name: "动态",
                sourceId: source.id,
                connectionId: null,
                overlapPolicy: "forbid",
                enabled: false,
                revision: 1,
            });
            // 媒体预算归计划，创建时没有就是 null（跟随全局默认），不再从来源配置继承。
            expect(plans[0]?.mediaPolicyJson).toBeNull();

            // 读取切换后调度按计划走，所以新建来源的绑定必须已经有计划归属。
            const bindings = await repository.prisma.triggerBinding.findMany();
            expect(bindings.map((binding) => binding.planId)).toEqual([`plan:${source.id}`]);
        });
    });

    it("来源没有媒体策略时计划不写空对象，也不写调度绑定", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const source = await repository.createSource({
                name: "推荐流",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: "https://example.test/hot.xml" },
            });

            const plans = await repository.prisma.collectionPlan.findMany();
            expect(plans.map((plan) => plan.mediaPolicyJson)).toEqual([null]);
            await expect(repository.prisma.triggerBinding.count()).resolves.toBe(0);
            await expect(repository.prisma.collectionPlan.count({ where: { sourceId: source.id } })).resolves.toBe(1);
        });
    });

    it("调度按计划取数：同一连接下的两个计划各带自己的间隔与计划归属", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const connection = await repository.createConnection({ name: "主账号", connectorId: "bilibili" });
            const feed = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
                scheduleIntervalMs: 1_800_000,
            });
            const hot = await repository.createSource({
                name: "推荐流",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
                scheduleIntervalMs: 7_200_000,
            });
            await repository.updateCollectionPlan(feed.planId, {
                baseRevisionId: feed.planRevisionId,
                connectionId: connection.id,
            });
            await repository.updateCollectionPlan(hot.planId, {
                baseRevisionId: hot.planRevisionId,
                connectionId: connection.id,
            });
            // 未启用的计划不参与调度；启用状态归计划（ADR-0023 决策 2），这里直接置位，
            // 本用例只验证调度取数口径。
            await repository.prisma.collectionPlan.updateMany({
                where: { sourceId: { in: [feed.id, hot.id] } },
                data: { enabled: true },
            });

            const triggers = await repository.listScheduleTriggers();
            expect(triggers.map((trigger) => [trigger.planId, trigger.sourceId, trigger.intervalMs])).toEqual([
                [`plan:${feed.id}`, feed.id, 1_800_000],
                [`plan:${hot.id}`, hot.id, 7_200_000],
            ]);

            // 停用一个计划只影响它自己：另一个计划仍在调度里。
            await repository.prisma.collectionPlan.update({
                where: { id: `plan:${hot.id}` },
                data: { enabled: false },
            });
            const afterPause = await repository.listScheduleTriggers();
            expect(afterPause.map((trigger) => trigger.planId)).toEqual([`plan:${feed.id}`]);
        });
    });

    it("读投影一次返回同一连接下的两个计划", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const connection = await repository.createConnection({ name: "主账号", connectorId: "bilibili" });
            const feed = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            const hot = await repository.createSource({
                name: "推荐流",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            await repository.updateCollectionPlan(feed.planId, {
                baseRevisionId: feed.planRevisionId,
                connectionId: connection.id,
            });
            await repository.updateCollectionPlan(hot.planId, {
                baseRevisionId: hot.planRevisionId,
                connectionId: connection.id,
            });

            // 产品面按连接分组呈现：一次读投影就要给出该连接下的两行，而不是只给一条。
            const plans = await repository.listCollectionPlans();
            const expectedIds = [`plan:${feed.id}`, `plan:${hot.id}`].sort();
            expect(plans).toHaveLength(2);
            expect(plans.map((plan) => plan.id).sort()).toEqual(expectedIds);
            expect(plans.map((plan) => plan.connectionId)).toEqual([connection.id, connection.id]);
            expect(plans.filter((plan) => plan.connectionId === connection.id).map((plan) => plan.id).sort())
                .toEqual(expectedIds);
        });
    });

    it("读投影按计划返回连接、频率与媒体预算，并跟随来源编辑", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const connection = await repository.createConnection({ name: "主账号", connectorId: "bilibili" });
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: "https://example.test/feed.xml" },
                scheduleIntervalMs: 1_800_000,
            });
            await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: source.planRevisionId,
                mediaPolicy: { images: "metadata_only" },
            });

            // 计划是产品面的对象（ADR-0023），读投影要能直接回答「哪个连接、多久一次、什么预算、
            // 最近一次失败」——产品面按计划呈现状态，不再从来源行借用这些事实。
            await expect(repository.listCollectionPlans()).resolves.toEqual([
                {
                    id: `plan:${source.id}`,
                    name: "动态",
                    sourceId: source.id,
                    sourceRevisionId: source.revisionId,
                    connectionId: null,
                    mediaPolicy: { images: "metadata_only" },
                    overlapPolicy: "forbid",
                    enabled: false,
                    revisionId: `plan:${source.id}:2`,
                    scheduleIntervalMs: 1_800_000,
                    webhook: null,
                    lastRunAt: null,
                    lastError: null,
                    createdAt: expect.any(String),
                    updatedAt: expect.any(String),
                },
            ]);

            // 计划端点是名字与连接的唯一写入口（ADR-0023 决策 2）：来源端点不再写穿，
            // 所以这里改计划、再确认来源读投影跟着走。
            await repository.updateCollectionPlan(`plan:${source.id}`, {
                baseRevisionId: `plan:${source.id}:2`,
                name: "动态（主账号）",
                connectionId: connection.id,
            });
            await expect(repository.getCollectionPlan(`plan:${source.id}`)).resolves.toMatchObject({
                name: "动态（主账号）",
                connectionId: connection.id,
                revisionId: `plan:${source.id}:3`,
            });
            await expect(repository.getSource(source.id)).resolves.toMatchObject({
                connectionId: connection.id,
                mediaPolicy: { images: "metadata_only" },
                planRevisionId: `plan:${source.id}:3`,
            });

            await expect(repository.getCollectionPlan("plan:missing")).resolves.toBeNull();
        });
    });

    it("给已有来源补上调度时，绑定同时挂到计划上", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const source = await repository.createSource({
                name: "无调度来源",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: "https://example.test/later.xml" },
            });
            const scheduled = await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: source.planRevisionId,
                scheduleIntervalMs: 3_600_000,
            });
            expect(scheduled.scheduleIntervalMs).toBe(3_600_000);

            // 读取切换后调度按计划取数：绑定必须带计划归属，否则永远不会被调度。
            const bindings = await repository.prisma.triggerBinding.findMany();
            expect(bindings.map((binding) => binding.planId)).toEqual([`plan:${source.id}`]);
            await repository.prisma.collectionPlan.update({
                where: { id: source.planId },
                data: { enabled: true },
            });
            await expect(repository.listScheduleTriggers()).resolves.toMatchObject([
                { planId: `plan:${source.id}`, intervalMs: 3_600_000 },
            ]);
        });
    });

    it("媒体预算只在计划端点上写，来源配置里不留第二份", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: "https://example.test/feed.xml" },
            });
            await expect(repository.getCollectionPlan(source.planId))
                .resolves.toMatchObject({ mediaPolicy: null });

            const tightened = await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: source.planRevisionId,
                mediaPolicy: { images: "metadata_only", retentionDays: 30 },
            });
            expect(tightened.mediaPolicy).toEqual({ images: "metadata_only", retentionDays: 30 });
            // 来源读投影也跟着走：产品面读的是同一个事实。
            await expect(repository.getSource(source.id))
                .resolves.toMatchObject({ mediaPolicy: { images: "metadata_only", retentionDays: 30 } });
            // 来源配置里不再有 media（1c-1c-b2 起目标配置不接受它）。
            const raw = await repository.prisma.sourceInstance.findUniqueOrThrow({ where: { id: source.id } });
            expect(JSON.parse(raw.configJson)).toEqual({ feedUrl: "https://example.test/feed.xml" });

            // 清除策略时回到「跟随全局默认」，不留下旧值。
            const cleared = await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: tightened.revisionId,
                mediaPolicy: null,
            });
            expect(cleared.mediaPolicy).toBeNull();
            await expect(repository.getSource(source.id)).resolves.toMatchObject({ mediaPolicy: null });
        });
    });

    it("maxFileBytes 经计划端点写入后原样读回，来源配置里不留第二份", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: "https://example.test/feed.xml" },
            });
            const policy = { images: "metadata_only", maxFileBytes: 2 * 1024 * 1024 } as const;

            const updated = await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: source.planRevisionId,
                mediaPolicy: policy,
            });
            expect(updated.mediaPolicy).toEqual(policy);

            // 持久化证据：读回的是落库那一列，而不是写命令的入参。
            const planRow = await repository.prisma.collectionPlan.findUniqueOrThrow({
                where: { id: source.planId },
            });
            expect(JSON.parse(planRow.mediaPolicyJson ?? "null")).toEqual(policy);

            await expect(repository.getCollectionPlan(source.planId))
                .resolves.toMatchObject({ mediaPolicy: policy });
            await expect(repository.getSource(source.id))
                .resolves.toMatchObject({ mediaPolicy: policy });
            // 两个读投影都逐字段相等：不只是「有策略」，而是预算值一起原样回来。
            expect((await repository.getCollectionPlan(source.planId))?.mediaPolicy).toEqual(policy);
            expect((await repository.getSource(source.id))?.mediaPolicy).toEqual(policy);
            // 来源配置里仍然没有第二份 media。
            const raw = await repository.prisma.sourceInstance.findUniqueOrThrow({ where: { id: source.id } });
            expect(JSON.parse(raw.configJson)).toEqual({ feedUrl: "https://example.test/feed.xml" });
        });
    });

    it("一个计划可以同时持有 schedule 与 webhook 触发器，删调度不动 webhook", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: "https://example.test/feed.xml" },
                scheduleIntervalMs: 1_800_000,
            });

            // ADR-0025：webhook 触发器是独立的行，而不是把 schedule 那行的 kind 改掉——
            // 后者会让这个计划的定时抓取静默停止。
            const webhookBinding = {
                sourceId: source.id,
                planId: source.planId,
                kind: "webhook",
                configJson: JSON.stringify({}),
                enabled: true,
                revision: 1,
            };
            await repository.prisma.triggerBinding.create({ data: webhookBinding });
            const bindings = await repository.prisma.triggerBinding.findMany({ orderBy: { kind: "asc" } });
            expect(bindings.map((binding) => binding.kind)).toEqual(["schedule", "webhook"]);

            // 唯一约束是「每计划每种类型一行」：同类型第二行被数据库拒绝。
            await expect(repository.prisma.triggerBinding.create({ data: webhookBinding })).rejects.toThrow();

            // 删调度只删 schedule 行，webhook 触发器不受影响。
            const cleared = await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: source.planRevisionId,
                scheduleIntervalMs: null,
            });
            expect(cleared.scheduleIntervalMs).toBeNull();
            await expect(repository.prisma.triggerBinding.findMany({ where: { planId: source.planId } }))
                .resolves.toMatchObject([{ kind: "webhook" }]);

            // 调度列表只认 schedule 行：只剩 webhook 时不再有定时。
            await repository.prisma.collectionPlan.update({
                where: { id: source.planId },
                data: { enabled: true },
            });
            await expect(repository.listScheduleTriggers()).resolves.toEqual([]);
        });
    });

    it("失败只落在失败的那个计划上：健康计划跑成功后无错误也不停留在「尚未运行」", async () => {
        await withRepository("collection-plan-repo", async (repository) => {
            const connection = await repository.createConnection({ name: "主账号", connectorId: "bilibili" });
            const bad = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            const healthy = await repository.createSource({
                name: "推荐流",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            await repository.updateCollectionPlan(bad.planId, {
                baseRevisionId: bad.planRevisionId,
                connectionId: connection.id,
                enabled: true,
            });
            await repository.updateCollectionPlan(healthy.planId, {
                baseRevisionId: healthy.planRevisionId,
                connectionId: connection.id,
                enabled: true,
            });

            // 先确认基线：两个计划都还没跑过，读投影都是 null。没有这一步，「非空」可能
            // 来自别的行，而不是下面那一次失败的 Run。
            const before = await repository.listCollectionPlans();
            expect(before.map((plan) => [plan.lastError, plan.lastRunAt])).toEqual([[null, null], [null, null]]);

            const run = await repository.createQueuedRun({ sourceId: bad.id, triggerKind: "manual" });
            await repository.completeRun({ runId: run.id, status: "failed", error: "feed 拉取失败" });

            // 浏览器用例断「失败只落在失败的那一个计划上」（collection-plan-multi.spec.ts:13）：
            // 数据侧等价物就是这条读投影——失败计划带诊断，健康计划既没有错误、也没被写成跑过。
            const afterFailure = await repository.listCollectionPlans();
            const failedPlan = afterFailure.find((plan) => plan.id === bad.planId);
            const untouchedPlan = afterFailure.find((plan) => plan.id === healthy.planId);
            expect(failedPlan?.lastError).toBe("feed 拉取失败");
            expect(failedPlan?.lastRunAt).not.toBeNull();
            expect(untouchedPlan?.lastError).toBeNull();
            expect(untouchedPlan?.lastRunAt).toBeNull();

            // 同一句契约的后半段是「成功计划不出现错误，也不停留在『尚未运行』」：健康计划
            // 随后自己跑成功，它必须离开「尚未运行」；两个计划各自独立记账，后来那次成功
            // 不能抹掉失败计划的诊断，也不能把错误带给健康计划。
            const healthyRun = await repository.createQueuedRun({ sourceId: healthy.id, triggerKind: "manual" });
            await repository.completeRun({ runId: healthyRun.id, status: "succeeded" });

            const plans = await repository.listCollectionPlans();
            const failed = plans.find((plan) => plan.id === bad.planId);
            const healthyPlan = plans.find((plan) => plan.id === healthy.planId);
            expect(healthyPlan?.lastError).toBeNull();
            expect(healthyPlan?.lastRunAt).not.toBeNull();
            expect(failed?.lastError).toBe("feed 拉取失败");
            expect(failed?.lastRunAt).not.toBeNull();
        });
    });
});
