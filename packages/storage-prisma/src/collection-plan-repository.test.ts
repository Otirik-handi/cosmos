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
                config: { feedUrl: "https://example.test/feed.xml", media: { images: "metadata_only" } },
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
            expect(JSON.parse(plans[0]?.mediaPolicyJson ?? "null")).toEqual({ images: "metadata_only" });

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
            await repository.updateSource(feed.id, { baseRevisionId: feed.revisionId, connectionId: connection.id });
            await repository.updateSource(hot.id, { baseRevisionId: hot.revisionId, connectionId: connection.id });
            // 未启用的来源不参与调度；这里直接置位，本用例只验证调度取数口径。
            await repository.prisma.sourceInstance.update({ where: { id: feed.id }, data: { enabled: true } });
            await repository.prisma.sourceInstance.update({ where: { id: hot.id }, data: { enabled: true } });

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
            await repository.prisma.sourceInstance.update({ where: { id: hot.id }, data: { enabled: false } });
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
                config: { feedUrl: "https://example.test/feed.xml", media: { images: "metadata_only" } },
                scheduleIntervalMs: 1_800_000,
            });

            // 计划是产品面的对象（ADR-0023），读投影要能直接回答「哪个连接、多久一次、什么预算」。
            await expect(repository.listCollectionPlans()).resolves.toEqual([
                {
                    id: `plan:${source.id}`,
                    name: "动态",
                    sourceId: source.id,
                    connectionId: null,
                    triggerBindingId: expect.any(String),
                    mediaPolicy: { images: "metadata_only" },
                    overlapPolicy: "forbid",
                    enabled: false,
                    revisionId: "1",
                    scheduleIntervalMs: 1_800_000,
                    createdAt: expect.any(String),
                    updatedAt: expect.any(String),
                },
            ]);

            // 过渡期写穿透：来源端点的改名与连接绑定同时写进计划，避免两个界面各说一套。
            const linked = await repository.updateSource(source.id, {
                baseRevisionId: source.revisionId,
                name: "动态（主账号）",
                connectionId: connection.id,
            });
            await expect(repository.getCollectionPlan(`plan:${source.id}`)).resolves.toMatchObject({
                name: "动态（主账号）",
                connectionId: connection.id,
                revisionId: "1",
            });
            expect(linked.connectionId).toBe(connection.id);

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
            const scheduled = await repository.updateSource(source.id, {
                baseRevisionId: source.revisionId,
                scheduleIntervalMs: 3_600_000,
            });
            expect(scheduled.scheduleIntervalMs).toBe(3_600_000);

            // 读取切换后调度按计划取数：后补的绑定没有计划归属就会永远不被调度。
            const bindings = await repository.prisma.triggerBinding.findMany();
            expect(bindings.map((binding) => binding.planId)).toEqual([`plan:${source.id}`]);
            await repository.prisma.sourceInstance.update({ where: { id: source.id }, data: { enabled: true } });
            await expect(repository.listScheduleTriggers()).resolves.toMatchObject([
                { planId: `plan:${source.id}`, intervalMs: 3_600_000 },
            ]);
        } finally {
            await repository.close();
        }
    });

    it("在来源端点改媒体策略时，计划的媒体预算同步更新", async () => {
        const repository = await createRepository();
        try {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: "https://example.test/feed.xml" },
            });
            await expect(repository.getCollectionPlan(`plan:${source.id}`))
                .resolves.toMatchObject({ mediaPolicy: null });

            // 过渡期：来源端点仍是产品唯一的编辑入口，改媒体策略必须同时落进计划，
            // 否则计划读投影会一直显示创建时那份旧值。
            await repository.updateSource(source.id, {
                baseRevisionId: source.revisionId,
                config: { feedUrl: "https://example.test/feed.xml", media: { images: "metadata_only" } },
            });
            await expect(repository.getCollectionPlan(`plan:${source.id}`))
                .resolves.toMatchObject({ mediaPolicy: { images: "metadata_only" } });

            // 移除策略时计划要回到「跟随全局默认」，不能留下旧值。
            const current = await repository.getSource(source.id);
            await repository.updateSource(source.id, {
                baseRevisionId: current?.revisionId ?? source.revisionId,
                config: { feedUrl: "https://example.test/feed.xml" },
            });
            await expect(repository.getCollectionPlan(`plan:${source.id}`))
                .resolves.toMatchObject({ mediaPolicy: null });
        } finally {
            await repository.close();
        }
    });
});
