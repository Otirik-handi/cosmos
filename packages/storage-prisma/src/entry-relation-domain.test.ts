import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import {
    EntryNotFoundError,
    EntryRelationConflictError,
} from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";
import { resolvePrismaCliPath } from "./prisma-cli.js";

const roots: string[] = [];
const clients = new Set<PrismaClient>();

afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Everything before the Entry↔Entry relation migration. */
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
    "20260907120000_story_revision_versioning",
    "20260907130000_story_merge_alias",
    "20260908000000_topic_domain_v1",
    "20260908120000_entity_relation_v1",
    "20260908140000_user_organization_v1",
    "20260908160000_annotation_v1",
    "20260908180000_saved_view_v1",
    "20260909100000_board_section_block_v1",
    "20260909120000_spotlight_placement_v1",
    "20260909140000_entry_story_evidence_v1",
    "20260909160000_story_split_v1",
    "20260909200000_media_retry_retention_v1",
    "20260910120000_connection_state_store_v1",
    "20260910140000_trigger_binding_v1",
    "20260916120000_story_representation_v1",
];

describe("Entry↔Entry duplicate relations", () => {
    it("stores a reprint in its semantic direction and reads it from both sides", async () => {
        const { repository, prisma } = await setup();
        try {
            // entry-b is the reprint, entry-a the original.
            await repository.linkEntryRelation({
                fromEntryId: "entry-b",
                toEntryId: "entry-a",
                relationType: "syndicated_from",
                evidence: "原文链接一致",
                actor: "user",
                reason: "门户转载官网",
            });

            expect((await repository.entry("entry-b"))?.relations).toEqual([{
                entryId: "entry-a",
                relationType: "syndicated_from",
                direction: "outgoing",
                title: "entry-a",
                sourceId: "source-a",
                sourceName: "source-a",
                producer: "human",
                producerVersion: null,
                confidence: 1,
                evidence: "原文链接一致",
                actor: "user",
                reason: "门户转载官网",
            }]);
            // The original must see the same row pointing back at it.
            expect((await repository.entry("entry-a"))?.relations).toEqual([{
                entryId: "entry-b",
                relationType: "syndicated_from",
                direction: "incoming",
                title: "entry-b",
                sourceId: "source-b",
                sourceName: "source-b",
                producer: "human",
                producerVersion: null,
                confidence: 1,
                evidence: "原文链接一致",
                actor: "user",
                reason: "门户转载官网",
            }]);
            expect(await prisma.entryRelation.count()).toBe(1);
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("normalizes symmetric pairs onto one row, so a reversed submit is not a conflict", async () => {
        const { repository, prisma } = await setup();
        try {
            await repository.linkEntryRelation({
                fromEntryId: "entry-a",
                toEntryId: "entry-c",
                relationType: "duplicate_of",
            });
            const stored = await prisma.entryRelation.findMany();
            expect(stored.map((row) => [row.fromEntryId, row.toEntryId])).toEqual([["entry-a", "entry-c"]]);

            // The exact reverse of a symmetric pair is the same pair: it must
            // reach the existing row instead of 409 (ADR-0022 decision 3).
            await repository.linkEntryRelation({
                fromEntryId: "entry-c",
                toEntryId: "entry-a",
                relationType: "duplicate_of",
                confidence: 0.5,
            });

            const rows = await prisma.entryRelation.findMany();
            expect(rows).toHaveLength(1);
            expect(rows[0]?.confidence).toBe(0.5);
            // Both sides read the relation as symmetric, with no storage order leak.
            expect((await repository.entry("entry-c"))?.relations[0]).toMatchObject({
                entryId: "entry-a",
                relationType: "duplicate_of",
                direction: "symmetric",
            });
            expect((await repository.entry("entry-a"))?.relations[0]).toMatchObject({
                entryId: "entry-c",
                direction: "symmetric",
            });
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("replays an identical write as a no-op and overwrites on a type change", async () => {
        const { repository, prisma } = await setup();
        try {
            const command = {
                fromEntryId: "entry-b",
                toEntryId: "entry-a",
                relationType: "syndicated_from" as const,
                reason: "转载",
            };
            await repository.linkEntryRelation(command);
            await repository.linkEntryRelation(command);

            expect(await prisma.entryRelation.count()).toBe(1);
            // An identical replay is a no-op, so it appends no second event.
            expect(await prisma.domainEvent.count({ where: { type: "entry.relation_linked.v1" } })).toBe(1);

            await repository.linkEntryRelation({ ...command, relationType: "near_duplicate_of" });
            const rows = await prisma.entryRelation.findMany();
            expect(rows).toHaveLength(1);
            expect(rows[0]?.relationType).toBe("near_duplicate_of");
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("rejects the opposite direction of a directed pair", async () => {
        const { repository, prisma } = await setup();
        try {
            await repository.linkEntryRelation({
                fromEntryId: "entry-b",
                toEntryId: "entry-a",
                relationType: "syndicated_from",
            });

            await expect(repository.linkEntryRelation({
                fromEntryId: "entry-a",
                toEntryId: "entry-b",
                relationType: "syndicated_from",
            })).rejects.toBeInstanceOf(EntryRelationConflictError);
            expect(await prisma.entryRelation.count()).toBe(1);
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("rejects self relations and unknown endpoints", async () => {
        const { repository, prisma } = await setup();
        try {
            await expect(repository.linkEntryRelation({
                fromEntryId: "entry-a",
                toEntryId: "entry-a",
                relationType: "duplicate_of",
            })).rejects.toBeInstanceOf(EntryRelationConflictError);

            await expect(repository.linkEntryRelation({
                fromEntryId: "entry-a",
                toEntryId: "entry-missing",
                relationType: "duplicate_of",
            })).rejects.toBeInstanceOf(EntryNotFoundError);
            expect(await prisma.entryRelation.count()).toBe(0);
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("lets a symmetric pair be re-typed into a directed one without leaving a second row", async () => {
        const { repository, prisma } = await setup();
        try {
            await repository.linkEntryRelation({
                fromEntryId: "entry-a",
                toEntryId: "entry-c",
                relationType: "duplicate_of",
            });
            // entry-c is now the reprint; the row flips rather than multiplying.
            await repository.linkEntryRelation({
                fromEntryId: "entry-c",
                toEntryId: "entry-a",
                relationType: "syndicated_from",
            });

            const rows = await prisma.entryRelation.findMany();
            expect(rows).toHaveLength(1);
            expect([rows[0]?.fromEntryId, rows[0]?.toEntryId, rows[0]?.relationType])
                .toEqual(["entry-c", "entry-a", "syndicated_from"]);
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("removes the relation from both sides and keeps unlink idempotent", async () => {
        const { repository, prisma } = await setup();
        try {
            await repository.linkEntryRelation({
                fromEntryId: "entry-a",
                toEntryId: "entry-b",
                relationType: "duplicate_of",
            });
            await repository.unlinkEntryRelation({ fromEntryId: "entry-b", toEntryId: "entry-a" });

            expect(await prisma.entryRelation.count()).toBe(0);
            expect((await repository.entry("entry-a"))?.relations).toEqual([]);
            expect(await prisma.domainEvent.count({ where: { type: "entry.relation_unlinked.v1" } })).toBe(1);

            // A second removal has nothing left to delete and stays silent.
            await repository.unlinkEntryRelation({ fromEntryId: "entry-a", toEntryId: "entry-b" });
            expect(await prisma.domainEvent.count({ where: { type: "entry.relation_unlinked.v1" } })).toBe(1);
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("cascades away with the deleted Entry", async () => {
        const { repository, prisma } = await setup();
        try {
            await repository.linkEntryRelation({
                fromEntryId: "entry-a",
                toEntryId: "entry-b",
                relationType: "near_duplicate_of",
            });
            await prisma.entry.delete({ where: { id: "entry-b" } });

            expect(await prisma.entryRelation.count()).toBe(0);
            expect((await repository.entry("entry-a"))?.relations).toEqual([]);
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("annotates Story member rows, including a counterpart outside the Story", async () => {
        const { repository, prisma } = await setup();
        try {
            // entry-d is a member of story-a whose counterpart entry-c lives in
            // another Story: the member row still has to show it (ADR-0022
            // decision 7, no counterpart Story link).
            await repository.linkEntryRelation({
                fromEntryId: "entry-d",
                toEntryId: "entry-c",
                relationType: "syndicated_from",
            });
            await repository.linkEntryRelation({
                fromEntryId: "entry-a",
                toEntryId: "entry-b",
                relationType: "duplicate_of",
            });

            const story = await repository.story("story-a");
            const byId = new Map(story!.entries.map((entry) => [entry.id, entry]));
            expect(byId.get("entry-d")?.relations[0]).toMatchObject({
                entryId: "entry-c",
                relationType: "syndicated_from",
                direction: "outgoing",
                title: "entry-c",
                sourceName: "source-c",
            });
            expect(byId.get("entry-a")?.relations[0]).toMatchObject({
                entryId: "entry-b",
                relationType: "duplicate_of",
                direction: "symmetric",
            });
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("degrades an unknown relation type instead of dropping the row", async () => {
        const { repository, prisma } = await setup();
        try {
            await prisma.entryRelation.create({
                data: {
                    fromEntryId: "entry-a",
                    toEntryId: "entry-b",
                    relationType: "translated_from",
                },
            });

            expect((await repository.entry("entry-a"))?.relations[0]).toMatchObject({
                entryId: "entry-b",
                relationType: "translated_from",
                // An unknown type is not sorted as symmetric, so the stored
                // direction is what the reader gets.
                direction: "outgoing",
            });
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("leaves the relations untouched across mergeStories and splitStory", async () => {
        const { repository, prisma } = await setup();
        try {
            const linked = await repository.linkEntryRelation({
                fromEntryId: "entry-b",
                toEntryId: "entry-a",
                relationType: "syndicated_from",
                evidence: "转载",
                actor: "user",
                reason: "门户转载官网",
            });
            expect(linked).not.toBeNull();
            const before = await prisma.entryRelation.findMany({ orderBy: { id: "asc" } });

            await repository.mergeStories({ canonicalStoryId: "story-a", obsoleteStoryIds: ["story-b"] });
            expect(await prisma.entryRelation.findMany({ orderBy: { id: "asc" } })).toEqual(before);

            await repository.splitStory({
                storyId: "story-a",
                successors: [
                    {
                        title: "后继 A",
                        summary: null,
                        kind: "event",
                        subtype: null,
                        entryIds: ["entry-a"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                    {
                        title: "后继 B",
                        summary: null,
                        kind: "document",
                        subtype: null,
                        entryIds: ["entry-b", "entry-d"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                ],
                actor: "user",
                reason: "拆开两个事件",
            });
            expect(await prisma.entryRelation.findMany({ orderBy: { id: "asc" } })).toEqual(before);
            // Relations hang on the Entry identity, so they are readable after
            // the split even though both members changed Story (ADR-0022 decision 4).
            expect((await repository.entry("entry-a"))?.relations[0]).toMatchObject({
                entryId: "entry-b",
                relationType: "syndicated_from",
                direction: "incoming",
            });
            expect((await repository.entry("entry-b"))?.relations[0]).toMatchObject({
                entryId: "entry-a",
                direction: "outgoing",
            });
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("keeps Feed and search order identical across a relation mark", async () => {
        const { repository, prisma } = await setup();
        try {
            const readFeedOrder = async (): Promise<string[]> =>
                (await repository.feed({ limit: 20 })).items.map((item) => item.entryId);
            const readSearchOrder = async (): Promise<string[]> =>
                (await repository.search({ text: "body", limit: 20 })).items.map((item) => item.entryId);

            // 文本搜索读 FTS5 索引，而索引只由录入写路径维护；本文件的 seed 直接写表，
            // 所以这里按同一形状补索引行，否则文本搜索永远返回空集、下面的比对就是空转。
            for (const entryId of ["entry-a", "entry-b", "entry-c", "entry-d"]) {
                await prisma.$executeRawUnsafe(
                    "INSERT INTO entry_search (entry_id, title, content_text) VALUES (?, ?, ?)",
                    entryId,
                    entryId,
                    `${entryId} body`,
                );
            }

            // 先记录标记前的两个序列：没有这一步，下面的比对就是空转。
            const feedBefore = await readFeedOrder();
            const searchBefore = await readSearchOrder();
            expect(feedBefore).toHaveLength(4);
            expect(searchBefore).toHaveLength(4);

            await repository.linkEntryRelation({
                fromEntryId: "entry-b",
                toEntryId: "entry-a",
                relationType: "syndicated_from",
                evidence: "原文链接一致",
                actor: "user",
                reason: "门户转载官网",
            });
            // 标记确实落库了，再读一遍才有意义。
            expect((await repository.entry("entry-b"))?.relations).toHaveLength(1);

            // 标记只是标记与展示（ADR-0022 决定 6）：顺序与集合逐字节不变。
            expect(await readFeedOrder()).toEqual(feedBefore);
            expect(await readSearchOrder()).toEqual(searchBefore);
        } finally {
            await prisma.$disconnect();
            clients.delete(prisma);
        }
    });

    it("upgrades an existing database by adding an empty table only", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-entry-relation-upgrade-"));
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
            INSERT INTO "SourceInstance" ("id", "name", "kind", "sourceDefinitionRef", "operationId", "configJson", "enabled", "revision", "createdAt", "updatedAt") VALUES
                ('source-a', 'source-a', 'rss', 'source.rss@1', 'fetch', '{}', 1, 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "Entry" ("id", "sourceInstanceId", "canonicalExternalId", "createdAt", "updatedAt") VALUES
                ('entry-a', 'source-a', 'external:entry-a', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$disconnect();
        clients.delete(oldClient);

        deployMigrations(databasePath, join(prismaSource, "schema.prisma"));

        const client = new PrismaClient({
            datasources: { db: { url: sqliteUrl(databasePath) } },
        });
        clients.add(client);

        // Existing rows survive; the new table starts empty (no backfill).
        expect(await client.entry.count()).toBe(1);
        expect(await client.entryRelation.count()).toBe(0);
        await client.entry.create({
            data: { id: "entry-b", sourceInstanceId: "source-a", canonicalExternalId: "external:entry-b" },
        });
        await client.entryRelation.create({
            data: { id: "relation-1", fromEntryId: "entry-a", toEntryId: "entry-b", relationType: "duplicate_of" },
        });
        expect(await client.entryRelation.count()).toBe(1);
        await expect(client.entryRelation.create({
            data: { id: "relation-2", fromEntryId: "entry-a", toEntryId: "entry-b", relationType: "near_duplicate_of" },
        })).rejects.toThrow(/Unique constraint failed/);
    });
});

async function setup(): Promise<{
    repository: PrismaCosmosRepository;
    prisma: PrismaClient;
}> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-entry-relation-"));
    roots.push(root);
    const databasePath = join(root, "cosmos.sqlite");
    deployMigrations(databasePath, resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma"));
    const prisma = new PrismaClient({
        datasources: { db: { url: sqliteUrl(databasePath) } },
    });
    clients.add(prisma);
    const repository = new PrismaCosmosRepository({
        dataRoot: root,
        prisma,
    });
    await repository.initialize();
    await seedEntries(prisma);
    return { repository, prisma };
}

async function seedEntries(prisma: PrismaClient): Promise<void> {
    for (const id of ["source-a", "source-b", "source-c"]) {
        await prisma.sourceInstance.create({
            data: {
                id,
                name: id,
                kind: "rss",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                configJson: "{}",
                enabled: true,
            },
        });
    }
    // entry-a and entry-d share a Story, so the same-Story case is covered too.
    for (const [entryId, sourceId, storyId] of [
        ["entry-a", "source-a", "story-a"],
        ["entry-b", "source-b", "story-b"],
        ["entry-c", "source-c", "story-c"],
        ["entry-d", "source-a", "story-a"],
    ] as const) {
        const suffix = entryId.at(-1);
        await prisma.entry.create({
            data: {
                id: entryId,
                sourceInstanceId: sourceId,
                canonicalExternalId: `external:${entryId}`,
            },
        });
        await prisma.entryRevision.create({
            data: {
                id: `er-${suffix}-1`,
                entryId,
                revision: 1,
                title: entryId,
                contentText: `${entryId} body`,
                contentFingerprint: `fp-${entryId}`,
            },
        });
        await prisma.entry.update({
            where: { id: entryId },
            data: { currentRevisionId: `er-${suffix}-1` },
        });
    }
    for (const [storyId, title] of [
        ["story-a", "Story a"],
        ["story-b", "Story b"],
        ["story-c", "Story c"],
    ] as const) {
        const suffix = storyId.at(-1);
        await prisma.story.create({ data: { id: storyId, kind: "document" } });
        await prisma.storyRevision.create({
            data: {
                id: `rev-${suffix}-1`,
                storyId,
                revision: 1,
                fingerprint: `fp-${storyId}`,
                title,
                summary: null,
            },
        });
        await prisma.story.update({
            where: { id: storyId },
            data: { currentRevisionId: `rev-${suffix}-1` },
        });
    }
    for (const [entryId, storyId] of [
        ["entry-a", "story-a"],
        ["entry-b", "story-b"],
        ["entry-c", "story-c"],
        ["entry-d", "story-a"],
    ] as const) {
        await prisma.entry.update({
            where: { id: entryId },
            data: { storyId },
        });
    }
}

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
