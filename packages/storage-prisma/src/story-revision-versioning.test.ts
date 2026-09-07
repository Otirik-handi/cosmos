import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const clients = new Set<PrismaClient>();

afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const legacyMigrations = [
    "20260808003247_phase1_foundation",
    "20260808150000_collector_jobs",
    "20260810020829_normalized_content_model",
    "20260813160000_workflow_run_backend",
    "20260814090000_workflow_activity_host",
    "20260815090000_workflow_ingest",
    "20260818000000_workflow_run_source_projection",
    "20260824000000_source_identity_revision",
    "20260824100000_source_activation_result_snapshot",
];

describe("StoryRevision versioning migration", () => {
    it("upgrades legacy StoryRevision rows with per-story revision numbers and fingerprint null", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-story-revision-upgrade-"));
        roots.push(root);
        const databasePath = join(root, "upgrade.sqlite");
        const prismaSource = resolve(
            process.cwd(),
            "packages/storage-prisma/prisma",
        );
        const oldPrismaRoot = join(root, "old-prisma");
        const oldMigrationsRoot = join(oldPrismaRoot, "migrations");
        await mkdir(oldMigrationsRoot, { recursive: true });
        await cp(join(prismaSource, "schema.prisma"), join(oldPrismaRoot, "schema.prisma"));
        await cp(
            join(prismaSource, "migrations", "migration_lock.toml"),
            join(oldMigrationsRoot, "migration_lock.toml"),
        );
        for (const migration of legacyMigrations) {
            await cp(
                join(prismaSource, "migrations", migration),
                join(oldMigrationsRoot, migration),
                { recursive: true },
            );
        }
        deployMigrations(databasePath, join(oldPrismaRoot, "schema.prisma"));

        const oldClient = new PrismaClient({
            datasources: { db: { url: sqliteUrl(databasePath) } },
        });
        clients.add(oldClient);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "Story" ("id", "kind", "subtype", "createdAt", "updatedAt") VALUES
                ('story:entry-a', 'document', NULL, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z'),
                ('story:entry-b', 'event', NULL, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "StoryRevision" ("id", "storyId", "title", "summary", "createdAt") VALUES
                ('rev-a-1', 'story:entry-a', 'Original title', 'Original summary', '2026-08-08T00:00:00.000Z'),
                ('rev-a-2', 'story:entry-a', 'Revised title', NULL, '2026-08-09T00:00:00.000Z'),
                ('rev-b-1', 'story:entry-b', 'Event title', NULL, '2026-08-10T00:00:00.000Z')
        `);
        await oldClient.$disconnect();
        clients.delete(oldClient);

        deployMigrations(databasePath, join(prismaSource, "schema.prisma"));
        const client = new PrismaClient({
            datasources: { db: { url: sqliteUrl(databasePath) } },
        });
        clients.add(client);

        const revisions = await client.storyRevision.findMany({
            orderBy: [{ storyId: "asc" }, { revision: "asc" }],
            select: { id: true, storyId: true, revision: true, fingerprint: true },
        });
        expect(revisions).toEqual([
            { id: "rev-a-1", storyId: "story:entry-a", revision: 1, fingerprint: null },
            { id: "rev-a-2", storyId: "story:entry-a", revision: 2, fingerprint: null },
            { id: "rev-b-1", storyId: "story:entry-b", revision: 1, fingerprint: null },
        ]);

        await expect(client.storyRevision.create({
            data: {
                id: "rev-a-3",
                storyId: "story:entry-a",
                revision: 1,
                title: "Duplicate revision number",
            },
        })).rejects.toThrow(/Unique constraint failed/);
    });
});

function deployMigrations(databasePath: string, schemaPath: string): void {
    execFileSync(process.execPath, [
        resolve(
            process.cwd(),
            "packages/storage-prisma/node_modules/prisma/build/index.js",
        ),
        "migrate",
        "deploy",
        "--schema",
        schemaPath,
    ], {
        env: { ...process.env, DATABASE_URL: sqliteUrl(databasePath) },
        stdio: "ignore",
    });
}

function sqliteUrl(databasePath: string): string {
    return `file:${databasePath.replaceAll("\\", "/")}`;
}
