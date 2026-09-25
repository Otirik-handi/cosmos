import { cp, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { withTestDatabase } from "./index.fixtures.js";

// The read switch must run against the schema the previous step left behind, so
// the suite deploys the real migration order in two passes instead of seeding a
// current DB.
const activationMigration = "20260920160000_collection_plan_activation_ownership";
const mediaMigration = "20260921080000_collection_plan_media_ownership";

describe("CollectionPlan media ownership 迁移 (ADR-0023 决策 2)", () => {
    it("把来源配置里的 media 移交给计划，并从来源配置里删掉", async () => {
        await withTestDatabase("collection-plan-media", async (database) => {
            const migrations = await listMigrations();
            const activationIndex = migrations.indexOf(activationMigration);
            expect(activationIndex, `${activationMigration} 必须存在`).toBeGreaterThanOrEqual(0);
            expect(migrations, `${mediaMigration} 必须存在`).toContain(mediaMigration);

            const legacySchema = await createMigrationWorkspace(database.root, migrations.slice(0, activationIndex + 1));
            database.deploy(legacySchema);

            const client = database.openClient();
            await client.$executeRawUnsafe(`
                INSERT INTO "SourceInstance" ("id", "name", "kind", "sourceDefinitionRef", "operationId", "configJson", "enabled", "revision", "createdAt", "updatedAt")
                VALUES
                    ('source-tightened', '动态', 'rss', 'source.rss@1', 'fetch', '{"feedUrl":"https://example.test/a.xml","media":{"images":"metadata_only","maxFileBytes":2097152}}', 0, 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
                    ('source-drifted', '推荐流', 'rss', 'source.rss@1', 'fetch', '{"feedUrl":"https://example.test/b.xml","media":{"retentionDays":30}}', 0, 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
                    ('source-plain', '无策略', 'rss', 'source.rss@1', 'fetch', '{"feedUrl":"https://example.test/c.xml"}', 0, 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
            `);
            // source-tightened 的计划与来源配置一致（1c-1c-a 的写穿透维持的形态）；
            // source-drifted 的计划停在旧值——迁移必须以来源配置那份「最后意图」为准。
            await client.$executeRawUnsafe(`
                INSERT INTO "CollectionPlan" ("id", "name", "sourceId", "mediaPolicyJson", "overlapPolicy", "enabled", "revision", "createdAt", "updatedAt")
                VALUES
                    ('plan:source-tightened', '动态', 'source-tightened', '{"images":"metadata_only","maxFileBytes":2097152}', 'forbid', 0, 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
                    ('plan:source-drifted', '推荐流', 'source-drifted', '{"images":"metadata_only"}', 'forbid', 0, 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'),
                    ('plan:source-plain', '无策略', 'source-plain', NULL, 'forbid', 0, 1, '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
            `);
            await client.$disconnect();

            const fullSchema = await createMigrationWorkspace(database.root, migrations);
            database.deploy(fullSchema);

            const migrated = database.openClient();
            const plans = await migrated.collectionPlan.findMany({ orderBy: { id: "asc" } });
            const sources = await migrated.sourceInstance.findMany({ orderBy: { id: "asc" } });

            // 计划成为唯一读取方：收紧过的策略完整保留。
            expect(plans.find((plan) => plan.id === "plan:source-tightened")?.mediaPolicyJson)
                .toBe('{"images":"metadata_only","maxFileBytes":2097152}');
            // 漂移的计划被来源配置的最后意图覆盖，而不是把旧值当权威。
            expect(plans.find((plan) => plan.id === "plan:source-drifted")?.mediaPolicyJson)
                .toBe('{"retentionDays":30}');
            expect(plans.find((plan) => plan.id === "plan:source-plain")?.mediaPolicyJson).toBeNull();

            // 来源配置里的 media 被删掉，其余配置原样保留。
            const configOf = (sourceId: string): Record<string, unknown> => {
                const raw = sources.find((source) => source.id === sourceId)?.configJson;
                if (typeof raw !== "string") throw new Error(`missing configJson for ${sourceId}`);
                return JSON.parse(raw) as Record<string, unknown>;
            };
            expect(configOf("source-tightened")).toEqual({ feedUrl: "https://example.test/a.xml" });
            expect(configOf("source-drifted")).toEqual({ feedUrl: "https://example.test/b.xml" });
            expect(configOf("source-plain")).toEqual({ feedUrl: "https://example.test/c.xml" });

            await migrated.$disconnect();
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
