import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { resolvePrismaCliPath } from "./prisma-cli.js";

const roots: string[] = [];
const clients = new Set<PrismaClient>();

afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const producerMigration = "20260924100000_story_revision_producer";

/**
 * `StoryRevision.producer` 的回填判据（ADR-0028 决定 1）。
 *
 * 回填不能靠启发式猜测：`actorJson` 是自由文本显示字段（Web 的人工编辑根本不传），
 * 人工与 ingest 投影落库时都是 NULL。可用的信号是 `story.revision_created.v1`——
 * 它只由命令路径发出（updateStoryRevision 与 splitStory 的后继），投影不发。
 * 本用例把这条判据钉在数据上：有匹配事件的 Revision 归人工，其余保持 `system`。
 */
describe("StoryRevision producer backfill", () => {
    it("marks only the revisions a command recorded an event for", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-story-producer-upgrade-"));
        roots.push(root);
        const databasePath = join(root, "upgrade.sqlite");
        const prismaSource = resolve(process.cwd(), "packages/storage-prisma/prisma");
        const oldPrismaRoot = join(root, "old-prisma");
        const oldMigrationsRoot = join(oldPrismaRoot, "migrations");
        await mkdir(oldMigrationsRoot, { recursive: true });
        await cp(join(prismaSource, "schema.prisma"), join(oldPrismaRoot, "schema.prisma"));
        await cp(
            join(prismaSource, "migrations", "migration_lock.toml"),
            join(oldMigrationsRoot, "migration_lock.toml"),
        );
        // Every migration before this one: the pre-`producer` shape, without
        // hardcoding a list that would rot as migrations are added.
        const migrations = (await readdir(join(prismaSource, "migrations"), { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name !== producerMigration)
            .map((entry) => entry.name);
        expect(migrations).not.toContain(producerMigration);
        for (const migration of migrations) {
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
                ('story:entry-a', 'document', NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
                ('story:entry-b', 'document', NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "StoryRevision" ("id", "storyId", "revision", "title", "summary", "createdAt") VALUES
                ('rev-a-1', 'story:entry-a', 1, 'Ingest title', NULL, '2026-09-01T00:00:00.000Z'),
                ('rev-a-2', 'story:entry-a', 2, 'Human title', NULL, '2026-09-02T00:00:00.000Z'),
                ('rev-b-1', 'story:entry-b', 1, 'Ingest title B', NULL, '2026-09-01T00:00:00.000Z')
        `);
        // rev-a-2 was written by `updateStoryRevision`, so a matching event exists.
        // The other two rows only ever came from the ingest projection, which
        // emits no such event. The last row is a decoy: same Story, other revision.
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "DomainEvent" ("eventId", "type", "version", "payloadJson", "occurredAt", "aggregateType", "aggregateId") VALUES
                ('evt-1', 'story.revision_created.v1', 'v1',
                 '{"storyId":"story:entry-a","baseRevisionId":"rev-a-1","revision":2,"actor":null,"reason":null}',
                 '2026-09-02T00:00:00.000Z', 'Story', 'story:entry-a'),
                ('evt-2', 'story.revision_created.v1', 'v1',
                 '{"storyId":"story:entry-b","baseRevisionId":null,"revision":9,"actor":null,"reason":null}',
                 '2026-09-02T00:00:00.000Z', 'Story', 'story:entry-b')
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
            select: { id: true, producer: true },
        });
        expect(revisions).toEqual([
            { id: "rev-a-1", producer: "system" },
            { id: "rev-a-2", producer: "human" },
            { id: "rev-b-1", producer: "system" },
        ]);
    });
});

function deployMigrations(databasePath: string, schemaPath: string): void {
    execFileSync(process.execPath, [
        resolvePrismaCliPath(),
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
