import { cp, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { withTestDatabase } from "./index.fixtures.js";

// 归属回填必须跑在它之前那一步留下的 schema 上，所以这个用例按真实迁移顺序部署两次。
const legacyMigration = "20260922140000_trigger_binding_webhook_entry";
const ownerMigration = "20260923120000_connector_state_namespace_owner";

describe("ConnectorStateNamespace 归属回填 (ADR-0026)", () => {
    it("把已有抽屉登记到同名计划，算不出归属的抽屉不登记且状态原样保留", async () => {
        await withTestDatabase("connector-state-owner", async (database) => {
            const migrations = await listMigrations();
            const legacyIndex = migrations.indexOf(legacyMigration);
            expect(legacyIndex, `${legacyMigration} 必须存在`).toBeGreaterThanOrEqual(0);
            expect(migrations, `${ownerMigration} 必须存在`).toContain(ownerMigration);

            database.deploy(await createMigrationWorkspace(
                database.root,
                migrations.slice(0, legacyIndex + 1),
            ));

            const client = database.openClient();
            await client.$executeRawUnsafe(`
                INSERT INTO "ConnectionInstance" ("id", "name", "connectorId", "status", "createdAt", "updatedAt")
                VALUES ('connection-1', '主账号', 'bilibili', 'active', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z')
            `);
            await client.$executeRawUnsafe(`
                INSERT INTO "SourceInstance" ("id", "name", "kind", "sourceDefinitionRef", "operationId", "configJson", "enabled", "revision", "connectionId", "deletedAt", "createdAt", "updatedAt")
                VALUES
                    ('source-feed', '动态', 'rss', 'source.rss@1', 'fetch', '{"feedUrl":"https://example.test/feed.xml"}', 1, 1, 'connection-1', NULL, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z'),
                    ('source-hot', '推荐流', 'rss', 'source.rss@1', 'fetch', '{"feedUrl":"https://example.test/hot.xml"}', 1, 1, 'connection-1', NULL, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z')
            `);
            // 计划 id 的形状由 backfill 迁移固定为 `plan:<sourceId>`；这里直接插入等价行，
            // 因为来源是在那次迁移之后才建出来的。
            await client.$executeRawUnsafe(`
                INSERT INTO "CollectionPlan" ("id", "name", "sourceId", "connectionId", "mediaPolicyJson", "overlapPolicy", "enabled", "revision", "createdAt", "updatedAt")
                VALUES
                    ('plan:source-feed', '动态', 'source-feed', 'connection-1', NULL, 'forbid', 1, 1, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z'),
                    ('plan:source-hot', '推荐流', 'source-hot', 'connection-1', NULL, 'forbid', 1, 1, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z')
            `);
            await client.$executeRawUnsafe(`
                INSERT INTO "ConnectorState" ("id", "namespace", "key", "valueJson", "version", "updatedAt")
                VALUES
                    ('state-etag', 'plan:source-feed', 'http-cache', '{"etag":"W/\\"1\\""}', 2, '2026-09-22T00:00:00.000Z'),
                    ('state-page', 'plan:source-hot', 'page', '{"cursor":"c-1"}', 1, '2026-09-22T00:00:00.000Z'),
                    ('state-foreign', 'other-namespace', 'page', '{"cursor":"x"}', 1, '2026-09-22T00:00:00.000Z')
            `);
            await client.$disconnect();

            database.deploy(await createMigrationWorkspace(database.root, migrations));

            const migrated = database.openClient();
            const owners = await migrated.connectorStateNamespace.findMany({ orderBy: { namespace: "asc" } });
            const states = await migrated.connectorState.findMany({ orderBy: { id: "asc" } });
            await migrated.$disconnect();

            expect(owners.map((owner) => [owner.namespace, owner.planId])).toEqual([
                ["plan:source-feed", "plan:source-feed"],
                ["plan:source-hot", "plan:source-hot"],
            ]);
            // 回填只写归属表：状态行本身一个字都不动。
            expect(states.map((state) => [state.id, state.namespace, state.version])).toEqual([
                ["state-etag", "plan:source-feed", 2],
                ["state-foreign", "other-namespace", 1],
                ["state-page", "plan:source-hot", 1],
            ]);
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
