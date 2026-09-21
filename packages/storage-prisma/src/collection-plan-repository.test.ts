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
});
