import { cp, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { withTestDatabase } from "./index.fixtures.js";

// The namespace rewrite must run against the schema the previous step left behind,
// so the suite deploys the real migration order in two passes.
const mediaMigration = "20260921080000_collection_plan_media_ownership";
const namespaceMigration = "20260921160000_collection_plan_state_namespace";

describe("CollectionPlan state namespace 迁移 (ADR-0023 决策 2)", () => {
    it("把连接器状态命名空间从 source:<id> 重写为 plan:<id>，其它命名空间不动", async () => {
        await withTestDatabase("collection-plan-namespace", async (database) => {
            const migrations = await listMigrations();
            const mediaIndex = migrations.indexOf(mediaMigration);
            expect(mediaIndex, `${mediaMigration} 必须存在`).toBeGreaterThanOrEqual(0);
            expect(migrations, `${namespaceMigration} 必须存在`).toContain(namespaceMigration);

            const legacySchema = await createMigrationWorkspace(database.root, migrations.slice(0, mediaIndex + 1));
            database.deploy(legacySchema);

            const client = database.openClient();
            // 读取切换前，宿主按 manifest 的 `source:{id}` 模板写入，所以键长这样。
            await client.$executeRawUnsafe(`
                INSERT INTO "ConnectorState" ("id", "namespace", "key", "valueJson", "version", "updatedAt")
                VALUES
                    ('state-etag', 'source:source-feed', 'http-cache', '{"etag":"W/\\"1\\""}', 1, '2026-09-19T00:00:00.000Z'),
                    ('state-cursor', 'source:source-hot', 'page', '{"cursor":"c-1"}', 2, '2026-09-19T00:00:00.000Z'),
                    ('state-foreign', 'other-namespace', 'page', '{"cursor":"x"}', 1, '2026-09-19T00:00:00.000Z')
            `);
            await client.$disconnect();

            database.deploy(await createMigrationWorkspace(database.root, migrations));

            const migrated = database.openClient();
            const states = await migrated.connectorState.findMany({ orderBy: { id: "asc" } });
            await migrated.$disconnect();

            expect(states.map((state) => [state.id, state.namespace])).toEqual([
                ["state-cursor", "plan:source-hot"],
                ["state-etag", "plan:source-feed"],
                // 不是本模板写出来的命名空间不碰：迁移只认 `source:` 前缀。
                ["state-foreign", "other-namespace"],
            ]);
            // 键与值原样保留：重写只为让切换后仍能查到旧状态，不改状态内容。
            expect(states.find((state) => state.id === "state-etag")).toMatchObject({
                key: "http-cache",
                valueJson: '{"etag":"W/\\"1\\""}',
                version: 1,
            });
            expect(states.find((state) => state.id === "state-cursor")?.version).toBe(2);
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
