import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";
import { resolvePrismaCliPath } from "./prisma-cli.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function prepareDatabase(root: string): void {
    const schema = resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma");
    const prismaCli = resolvePrismaCliPath();
    const databaseUrl = `file:${resolve(root, "cosmos.sqlite").replaceAll("\\", "/")}`;
    writeFileSync(resolve(root, "cosmos.sqlite"), new Uint8Array());
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "ignore",
    });
}

async function createRepository(): Promise<PrismaCosmosRepository> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-collection-plan-repo-"));
    roots.push(root);
    prepareDatabase(root);
    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();
    return repository;
}

describe("CollectionPlan 与来源同批创建 (ADR-0023 决策 1)", () => {
    it("创建来源时同批建出默认计划，并把调度绑定挂到计划上", async () => {
        const repository = await createRepository();
        try {
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
        } finally {
            await repository.close();
        }
    });

    it("来源没有媒体策略时计划不写空对象，也不写调度绑定", async () => {
        const repository = await createRepository();
        try {
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
        } finally {
            await repository.close();
        }
    });

    it("调度按计划取数：同一连接下的两个计划各带自己的间隔与计划归属", async () => {
        const repository = await createRepository();
        try {
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
        } finally {
            await repository.close();
        }
    });

    it("读投影按计划返回连接、频率与媒体预算，并跟随来源编辑", async () => {
        const repository = await createRepository();
        try {
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
                    triggerBindingId: expect.any(String),
                    mediaPolicy: { images: "metadata_only" },
                    overlapPolicy: "forbid",
                    enabled: false,
                    revisionId: `plan:${source.id}:2`,
                    scheduleIntervalMs: 1_800_000,
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
        } finally {
            await repository.close();
        }
    });

    it("给已有来源补上调度时，绑定同时挂到计划上", async () => {
        const repository = await createRepository();
        try {
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
        } finally {
            await repository.close();
        }
    });

    it("媒体预算只在计划端点上写，来源配置里不留第二份", async () => {
        const repository = await createRepository();
        try {
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
        } finally {
            await repository.close();
        }
    });
});
