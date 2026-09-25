import { cp, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { withTestDatabase } from "./index.fixtures.js";

// Backfill must run against the schema the expand step left behind, so the suite
// deploys the real migration order in two passes instead of seeding a current DB.
const expandMigration = "20260920120000_collection_plan_v1";
const backfillMigration = "20260920140000_collection_plan_backfill";

describe("CollectionPlan backfill 迁移 (ADR-0023 决策 2)", () => {
    it("为每个既有来源生成默认计划并回填计划引用，但不搬走来源侧仍是唯一读取方的字段", async () => {
        await withTestDatabase("collection-plan-backfill", async (database) => {
            const migrations = await listMigrations();
            const expandIndex = migrations.indexOf(expandMigration);
            expect(expandIndex, `${expandMigration} 必须存在`).toBeGreaterThanOrEqual(0);
            expect(migrations, `${backfillMigration} 必须存在`).toContain(backfillMigration);

            const legacySchema = await createMigrationWorkspace(database.root, migrations.slice(0, expandIndex + 1));
            database.deploy(legacySchema);

            const client = database.openClient();
            await client.$executeRawUnsafe(`
                INSERT INTO "ConnectionInstance" ("id", "name", "connectorId", "status", "createdAt", "updatedAt")
                VALUES ('connection-1', '主账号', 'bilibili', 'active', '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
            `);
            await client.$executeRawUnsafe(`
                INSERT INTO "SourceInstance" ("id", "name", "kind", "sourceDefinitionRef", "operationId", "configJson", "enabled", "revision", "connectionId", "deletedAt", "createdAt", "updatedAt")
                VALUES
                    ('source-feed', '动态', 'bilibili', 'source.bilibili@1', 'fetch', '{"mode":"feed","profile":"chrome-main","media":{"images":"metadata_only"}}', 1, 3, 'connection-1', NULL, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
                    ('source-hot', '推荐流', 'bilibili', 'source.bilibili@1', 'fetch', '{"mode":"hot"}', 1, 2, 'connection-1', NULL, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
                    ('source-deleted', '已删除来源', 'rss', 'source.rss@1', 'fetch', '{"feedUrl":"https://example.test/feed.xml"}', 1, 1, NULL, '2026-09-19T12:00:00.000Z', '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
            `);
            await client.$executeRawUnsafe(`
                INSERT INTO "TriggerBinding" ("id", "sourceId", "kind", "configJson", "enabled", "revision", "createdAt", "updatedAt")
                VALUES
                    ('trigger-feed', 'source-feed', 'schedule', '{"intervalMs":1800000}', 1, 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
                    ('trigger-hot', 'source-hot', 'schedule', '{"intervalMs":7200000}', 1, 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
            `);
            await client.$executeRawUnsafe(`
                INSERT INTO "Checkpoint" ("id", "sourceInstanceId", "cursor", "revision", "updatedAt")
                VALUES ('checkpoint-feed', 'source-feed', 'cursor-feed', 4, '2026-09-19T00:00:00.000Z')
            `);
            await client.$executeRawUnsafe(`
                INSERT INTO "Run" ("id", "sourceInstanceId", "triggerKind", "status", "createdAt")
                VALUES ('run-feed', 'source-feed', 'schedule', 'succeeded', '2026-09-19T00:00:00.000Z')
            `);
            await client.$executeRawUnsafe(`
                INSERT INTO "WorkflowRun" ("id", "stateJson", "status", "sourceInstanceId", "definitionKey", "definitionVersion", "manifestHash", "createdAt", "updatedAt")
                VALUES ('workflow-feed', '{}', 'succeeded', 'source-feed', 'cosmos.ingest', '1', 'hash', '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
            `);
            await client.$disconnect();

            // 先只部署到 backfill 步：这一步的合同是「只写新列、不动来源侧」，
            // 后面的读取切换（激活归属、媒体归属）不属于它的证据。
            const backfillIndex = migrations.indexOf(backfillMigration);
            const backfillSchema = await createMigrationWorkspace(database.root, migrations.slice(0, backfillIndex + 1));
            database.deploy(backfillSchema);

            const afterBackfill = database.openClient();
            const backfilledSources = await afterBackfill.sourceInstance.findMany({
                orderBy: { id: "asc" },
                select: { id: true, configJson: true, connectionId: true },
            });
            await afterBackfill.$disconnect();

            // 读取切换之前，来源侧仍是唯一读取方：回填不搬走 media，也不动状态命名空间。
            expect(backfilledSources.map((source) => source.id)).toEqual(["source-deleted", "source-feed", "source-hot"]);
            expect(JSON.parse(backfilledSources.find((source) => source.id === "source-feed")?.configJson ?? "{}"))
                .toMatchObject({ media: { images: "metadata_only" } });
            expect(backfilledSources.find((source) => source.id === "source-feed")?.connectionId).toBe("connection-1");

            database.deploy(await createMigrationWorkspace(database.root, migrations));

            const migrated = database.openClient();
            const plans = await migrated.collectionPlan.findMany({ orderBy: { id: "asc" } });
            const sources = await migrated.sourceInstance.findMany({
                orderBy: { id: "asc" },
                select: { id: true, configJson: true, connectionId: true },
            });
            const bindings = await migrated.triggerBinding.findMany({ orderBy: { id: "asc" } });
            const checkpoints = await migrated.checkpoint.findMany();
            const runs = await migrated.run.findMany();
            const workflowRuns = await migrated.workflowRun.findMany();
            await migrated.$disconnect();

            // 每个既有来源（含墓碑）一个默认计划，id 可推导，便于核对与回滚。
            expect(plans.map((plan) => plan.id)).toEqual(["plan:source-deleted", "plan:source-feed", "plan:source-hot"]);
            expect(plans.find((plan) => plan.id === "plan:source-feed")).toMatchObject({
                name: "动态",
                sourceId: "source-feed",
                connectionId: "connection-1",
                overlapPolicy: "forbid",
                enabled: true,
                revision: 1,
            });
            // 媒体策略按 ADR-0014 语义继承到计划上。
            expect(JSON.parse(plans.find((plan) => plan.id === "plan:source-feed")?.mediaPolicyJson ?? "null"))
                .toEqual({ images: "metadata_only" });
            expect(plans.find((plan) => plan.id === "plan:source-hot")?.mediaPolicyJson).toBeNull();
            // 墓碑来源的计划不可执行：即使来源行仍带 enabled=1。
            expect(plans.find((plan) => plan.id === "plan:source-deleted")).toMatchObject({ enabled: false });

            // 计划引用回填到四处，历史 Run 也能回答「属于哪个计划」。
            expect(bindings.map((binding) => [binding.id, binding.planId])).toEqual([
                ["trigger-feed", "plan:source-feed"],
                ["trigger-hot", "plan:source-hot"],
            ]);
            expect(checkpoints.map((checkpoint) => checkpoint.planId)).toEqual(["plan:source-feed"]);
            expect(runs.map((run) => run.planId)).toEqual(["plan:source-feed"]);
            expect(workflowRuns.map((run) => run.planId)).toEqual(["plan:source-feed"]);

            // 全部迁移跑完后的终态：媒体预算归计划，来源配置里的那份已被移除。
            expect(sources.map((source) => source.id)).toEqual(["source-deleted", "source-feed", "source-hot"]);
            expect(JSON.parse(sources.find((source) => source.id === "source-feed")?.configJson ?? "{}"))
                .not.toHaveProperty("media");
            expect(JSON.parse(plans.find((plan) => plan.id === "plan:source-feed")?.mediaPolicyJson ?? "null"))
                .toEqual({ images: "metadata_only" });
            expect(sources.find((source) => source.id === "source-feed")?.connectionId).toBe("connection-1");
        });
    });
});

async function listMigrations(): Promise<string[]> {
    const migrationsRoot = resolve(process.cwd(), "packages/storage-prisma/prisma/migrations");
    const entries = await readdir(migrationsRoot, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

async function createMigrationWorkspace(root: string, names: readonly string[]): Promise<string> {
    const sourceRoot = resolve(process.cwd(), "packages/storage-prisma/prisma");
    const targetRoot = join(root, `prisma-${names.length}`);
    const targetMigrations = join(targetRoot, "migrations");
    await mkdir(targetMigrations, { recursive: true });
    await cp(join(sourceRoot, "schema.prisma"), join(targetRoot, "schema.prisma"));
    await cp(
        join(sourceRoot, "migrations", "migration_lock.toml"),
        join(targetMigrations, "migration_lock.toml"),
    );
    await Promise.all(names.map((name) => cp(
        join(sourceRoot, "migrations", name),
        join(targetMigrations, name),
        { recursive: true },
    )));
    return join(targetRoot, "schema.prisma");
}
