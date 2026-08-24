import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

const legacyMigrations = [
    "20260808003247_phase1_foundation",
    "20260808150000_collector_jobs",
    "20260810020829_normalized_content_model",
    "20260813160000_workflow_run_backend",
    "20260814090000_workflow_activity_host",
    "20260815090000_workflow_ingest",
    "20260818000000_workflow_run_source_projection",
] as const;
// Identity cutover must run against the legacy schema; the activation-result
// column lands after it so suites always deploy migrations in real order.
const identityMigration = "20260824000000_source_identity_revision";
const activationResultMigration = "20260824100000_source_activation_result_snapshot";
const currentMigrations = [
    ...legacyMigrations,
    identityMigration,
    activationResultMigration,
] as const;

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
});

describe("Source identity migration", () => {
    it("backfills known legacy kinds and preserves enabled state", async () => {
        const root = await mkdtemp(join(tmpdir(), "source-migration-known-"));
        temporaryRoots.push(root);
        const databasePath = join(root, "cosmos.sqlite");
        const legacySchema = await createMigrationWorkspace(root, legacyMigrations);
        deployMigrations(databasePath, legacySchema);

        const client = new PrismaClient({
            datasources: { db: { url: `file:${databasePath}` } },
        });
        await client.$executeRawUnsafe(`
            INSERT INTO "SourceInstance" ("id", "name", "kind", "configJson", "enabled", "createdAt", "updatedAt")
            VALUES
                ('source-rss', 'RSS', 'rss', '{}', 1, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
                ('source-fixture', 'Fixture', 'fixture-rss', '{}', 0, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
                ('source-bilibili', 'Bilibili', 'bilibili', '{}', 1, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z'),
                ('source-aihot', 'AI HOT', 'aihot', '{}', 0, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z')
        `);
        await client.$disconnect();

        const currentSchema = await createMigrationWorkspace(root, currentMigrations);
        deployMigrations(databasePath, currentSchema);
        const migrated = new PrismaClient({
            datasources: { db: { url: `file:${databasePath}` } },
        });
        const sources = await migrated.sourceInstance.findMany({
            orderBy: { id: "asc" },
            select: {
                id: true,
                kind: true,
                sourceDefinitionRef: true,
                operationId: true,
                enabled: true,
                revision: true,
            },
        });
        await migrated.$disconnect();

        expect(sources).toEqual([
            {
                id: "source-aihot",
                kind: "aihot",
                sourceDefinitionRef: "source.aihot@1",
                operationId: "fetch",
                enabled: false,
                revision: 1,
            },
            {
                id: "source-bilibili",
                kind: "bilibili",
                sourceDefinitionRef: "source.bilibili@1",
                operationId: "fetch",
                enabled: true,
                revision: 1,
            },
            {
                id: "source-fixture",
                kind: "fixture-rss",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                enabled: false,
                revision: 1,
            },
            {
                id: "source-rss",
                kind: "rss",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                enabled: true,
                revision: 1,
            },
        ]);
    });

    it("blocks unknown legacy kinds before replacing the source table", async () => {
        const root = await mkdtemp(join(tmpdir(), "source-migration-unknown-"));
        temporaryRoots.push(root);
        const databasePath = join(root, "cosmos.sqlite");
        const legacySchema = await createMigrationWorkspace(root, legacyMigrations);
        deployMigrations(databasePath, legacySchema);

        const client = new PrismaClient({
            datasources: { db: { url: `file:${databasePath}` } },
        });
        await client.$executeRawUnsafe(`
            INSERT INTO "SourceInstance" ("id", "name", "kind", "configJson", "enabled", "createdAt", "updatedAt")
            VALUES ('source-unknown', 'Unknown', 'future-connector', '{}', 1, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z')
        `);
        await client.$disconnect();

        const currentSchema = await createMigrationWorkspace(root, currentMigrations);
        expect(() => deployMigrations(databasePath, currentSchema)).toThrow();

        const unchanged = new PrismaClient({
            datasources: { db: { url: `file:${databasePath}` } },
        });
        const columns = await unchanged.$queryRawUnsafe<readonly { name: string }[]>(
            "PRAGMA table_info(\"SourceInstance\")",
        );
        const rows = await unchanged.$queryRawUnsafe<readonly { id: string; kind: string; enabled: number }[]>(
            "SELECT \"id\", \"kind\", \"enabled\" FROM \"SourceInstance\"",
        );
        await unchanged.$disconnect();

        expect(columns.map((column) => column.name)).not.toContain("sourceDefinitionRef");
        expect(rows).toEqual([{ id: "source-unknown", kind: "future-connector", enabled: true }]);
    });
});

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
        resolve(process.cwd(), "packages/storage-prisma/node_modules/prisma/build/index.js"),
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
