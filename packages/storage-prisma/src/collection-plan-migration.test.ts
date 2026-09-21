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
    const root = await mkdtemp(join(tmpdir(), "cosmos-collection-plan-"));
    roots.push(root);
    prepareDatabase(root);
    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();
    return repository;
}

type ColumnInfo = { name: string; notnull: number | bigint };

describe("CollectionPlan expand 迁移 (ADR-0023 决策 2)", () => {
    it("建出计划表，并给 Run/WorkflowRun/Checkpoint/TriggerBinding 增加可空计划列", async () => {
        const repository = await createRepository();
        try {
            const planColumns = await repository.prisma.$queryRawUnsafe<ColumnInfo[]>(
                `PRAGMA table_info("CollectionPlan")`,
            );
            expect(planColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
                "id",
                "name",
                "sourceId",
                "connectionId",
                "mediaPolicyJson",
                "overlapPolicy",
                "enabled",
                "revision",
                "createdAt",
                "updatedAt",
            ]));

            // expand 只加列：旧路径在回填与读取切换之前必须继续可写，所以计划列一律可空。
            for (const table of ["Run", "WorkflowRun", "Checkpoint", "TriggerBinding"]) {
                const columns = await repository.prisma.$queryRawUnsafe<ColumnInfo[]>(
                    `PRAGMA table_info("${table}")`,
                );
                const planId = columns.find((column) => column.name === "planId");
                expect(planId, `${table}.planId 必须存在`).toBeDefined();
                expect(Number(planId?.notnull), `${table}.planId 必须可空`).toBe(0);
            }
        } finally {
            await repository.close();
        }
    });

    it("计划与采集目标一对一，默认值符合 v1 合同", async () => {
        const repository = await createRepository();
        try {
            const source = await repository.createSource({
                name: "Bilibili 动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });

            const plan = await repository.prisma.collectionPlan.create({
                data: { id: "plan-1", name: "主账号动态每 30 分钟", sourceId: source.id },
            });
            expect(plan).toMatchObject({
                connectionId: null,
                mediaPolicyJson: null,
                overlapPolicy: "forbid",
                enabled: false,
                revision: 1,
            });

            // v1 一个目标一个计划：第二个计划必须被数据库拒绝，而不是靠调用方自觉。
            await expect(repository.prisma.collectionPlan.create({
                data: { id: "plan-2", name: "同一目标的第二个计划", sourceId: source.id },
            })).rejects.toThrow();
        } finally {
            await repository.close();
        }
    });
});
