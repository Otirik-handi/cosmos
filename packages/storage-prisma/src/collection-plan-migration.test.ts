import { describe, expect, it } from "vitest";

import { withRepository } from "./index.fixtures.js";

type ColumnInfo = { name: string; notnull: number | bigint };

describe("CollectionPlan expand 迁移 (ADR-0023 决策 2)", () => {
    it("建出计划表，并给 Run/WorkflowRun/Checkpoint/TriggerBinding 增加可空计划列", async () => {
        await withRepository("collection-plan", async (repository) => {
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
        });
    });

    it("计划与采集目标一对一：同一目标的第二个计划被数据库拒绝", async () => {
        await withRepository("collection-plan", async (repository) => {
            // 创建来源已经带出默认计划（切片 1c-1a），这里要证明的是第二个计划进不来，
            // 而不是靠调用方自觉维持一对一。
            const source = await repository.createSource({
                name: "Bilibili 动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });

            await expect(repository.prisma.collectionPlan.create({
                data: { id: "plan-2", name: "同一目标的第二个计划", sourceId: source.id },
            })).rejects.toThrow(/Unique constraint/);
        });
    });
});
