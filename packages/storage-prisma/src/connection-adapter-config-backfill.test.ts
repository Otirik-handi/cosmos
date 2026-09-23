import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { resolvePrismaCliPath } from "./prisma-cli.js";

const temporaryRoots: string[] = [];

// 回填必须跑在它之前那一步留下的 schema 上，所以这个用例按真实迁移顺序部署两次。
const legacyMigration = "20260923120000_connector_state_namespace_owner";
const adapterConfigMigration = "20260923180000_connection_adapter_config";

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
});

describe("连接适配器配置回填 (Proposal connection-login-lifecycle-v1)", () => {
    it("把来源配置里的 profile 搬进连接、计划补上绑定，并保持匿名来源与墓碑不动", async () => {
        const root = await mkdtemp(join(tmpdir(), "connection-adapter-config-"));
        temporaryRoots.push(root);
        const databasePath = join(root, "cosmos.sqlite");

        const migrations = await listMigrations();
        const legacyIndex = migrations.indexOf(legacyMigration);
        expect(legacyIndex, `${legacyMigration} 必须存在`).toBeGreaterThanOrEqual(0);
        expect(migrations, `${adapterConfigMigration} 必须存在`).toContain(adapterConfigMigration);

        deployMigrations(databasePath, await createMigrationWorkspace(
            root,
            migrations.slice(0, legacyIndex + 1),
        ));

        const client = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
        // 同一 profile 的两个来源（hot + feed）必须收敛到同一条连接；另一个 profile 单独一条；
        // 匿名 hot 没有 profile，既不该建连接也不该被绑定。
        await client.$executeRawUnsafe(`
            INSERT INTO "SourceInstance" ("id", "name", "kind", "sourceDefinitionRef", "operationId", "configJson", "enabled", "revision", "connectionId", "deletedAt", "createdAt", "updatedAt")
            VALUES
                ('source-feed', '动态', 'bilibili', 'source.bilibili@1', 'fetch', '{"mode":"feed","limit":20,"profile":"chrome-main"}', 1, 1, NULL, NULL, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('source-hot', '热门', 'bilibili', 'source.bilibili@1', 'fetch', '{"mode":"hot","limit":20,"profile":"chrome-main"}', 1, 1, NULL, NULL, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('source-alt', '备用号动态', 'bilibili', 'source.bilibili@1', 'fetch', '{"mode":"feed","limit":5,"profile":"chrome-alt"}', 1, 1, NULL, NULL, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('source-anon', '匿名热门', 'bilibili', 'source.bilibili@1', 'fetch', '{"mode":"hot","limit":20}', 1, 1, NULL, NULL, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('source-rss', 'RSS', 'rss', 'source.rss@1', 'fetch', '{"feedUrl":"https://example.test/feed.xml"}', 1, 1, NULL, NULL, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('source-gone', '已删除的动态', 'bilibili', 'source.bilibili@1', 'fetch', '{"mode":"feed","limit":20,"profile":"chrome-gone"}', 1, 1, NULL, '2026-09-23T01:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-23T01:00:00.000Z')
        `);
        await client.$executeRawUnsafe(`
            INSERT INTO "CollectionPlan" ("id", "name", "sourceId", "connectionId", "mediaPolicyJson", "overlapPolicy", "enabled", "revision", "createdAt", "updatedAt")
            VALUES
                ('plan:source-feed', '动态', 'source-feed', NULL, NULL, 'forbid', 1, 1, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('plan:source-hot', '热门', 'source-hot', NULL, NULL, 'forbid', 1, 1, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('plan:source-alt', '备用号动态', 'source-alt', NULL, NULL, 'forbid', 1, 1, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('plan:source-anon', '匿名热门', 'source-anon', NULL, NULL, 'forbid', 1, 1, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('plan:source-rss', 'RSS', 'source-rss', NULL, NULL, 'forbid', 1, 1, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z'),
                ('plan:source-gone', '已删除的动态', 'source-gone', NULL, NULL, 'forbid', 0, 1, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z')
        `);
        await client.$disconnect();

        deployMigrations(databasePath, await createMigrationWorkspace(root, migrations));

        const migrated = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
        const sources = await migrated.sourceInstance.findMany({ orderBy: { id: "asc" } });
        const plans = await migrated.collectionPlan.findMany({ orderBy: { id: "asc" } });
        const connections = await migrated.connectionInstance.findMany({ orderBy: { id: "asc" } });
        await migrated.$disconnect();

        // 每个 profile 一条连接，id 是确定性的；匿名来源不产生连接。
        expect(connections.map((connection) => [connection.id, connection.configJson])).toEqual([
            ["connection:bilibili:chrome-alt", '{"profile":"chrome-alt"}'],
            ["connection:bilibili:chrome-main", '{"profile":"chrome-main"}'],
        ]);

        // 来源配置不再承载 profile；墓碑记录保持原样。
        expect(sources.map((source) => [source.id, source.configJson])).toEqual([
            ["source-alt", '{"mode":"feed","limit":5}'],
            ["source-anon", '{"mode":"hot","limit":20}'],
            ["source-feed", '{"mode":"feed","limit":20}'],
            ["source-gone", '{"mode":"feed","limit":20,"profile":"chrome-gone"}'],
            ["source-hot", '{"mode":"hot","limit":20}'],
            ["source-rss", '{"feedUrl":"https://example.test/feed.xml"}'],
        ]);

        // 计划补上绑定：同一 profile 的两个计划指向同一条连接，匿名与 RSS 保持未绑定，
        // 墓碑来源的计划不动。
        expect(plans.map((plan) => [plan.id, plan.connectionId])).toEqual([
            ["plan:source-alt", "connection:bilibili:chrome-alt"],
            ["plan:source-anon", null],
            ["plan:source-feed", "connection:bilibili:chrome-main"],
            ["plan:source-gone", null],
            ["plan:source-hot", "connection:bilibili:chrome-main"],
            ["plan:source-rss", null],
        ]);
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

function deployMigrations(databasePath: string, schemaPath: string): void {
    execFileSync(process.execPath, [
        resolvePrismaCliPath(),
        "migrate",
        "deploy",
        "--schema",
        schemaPath,
    ], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            DATABASE_URL: `file:${databasePath}`,
        },
        stdio: "ignore",
    });
}
