import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import {
    EntryNotFoundError,
    EntryStoryLinkConflictError,
    StoryNotFoundError,
} from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];
const clients = new Set<PrismaClient>();

afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Everything before the Entry↔Story evidence migration. */
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
];

describe("Entry↔Story evidence relations", () => {
    it("links an entry to another story and projects both directions", async () => {
        const { repository, prisma } = await setup();
        try {
            const updated = await repository.linkEntryStory({
                entryId: "entry-a",
                storyId: "story-b",
                relationType: "evidence_for",
                evidence: "官方公告",
                actor: "user",
                reason: "同一事件",
            });
            expect(updated?.evidence).toHaveLength(1);
            expect(updated?.evidence[0]).toMatchObject({
                entryId: "entry-a",
                sourceId: "source-a",
                sourceName: "source-a",
                relationType: "evidence_for",
                title: "entry-a",
                producer: "human",
                confidence: 1,
                evidence: "官方公告",
                actor: "user",
                reason: "同一事件",
            });

            const entry = await repository.entry("entry-a");
            expect(entry?.relatedStories).toEqual([{
                storyId: "story-b",
                relationType: "evidence_for",
                title: "Story b",
                reason: "同一事件",
            }]);

            // Identical replay is a no-op; a different relation type overwrites
            // the single meaning of the pair (ADR-0011 decision 1).
            const replayed = await repository.linkEntryStory({
                entryId: "entry-a",
                storyId: "story-b",
                relationType: "evidence_for",
                evidence: "官方公告",
                actor: "user",
                reason: "同一事件",
            });
            expect(replayed?.evidence).toHaveLength(1);
            const relinked = await repository.linkEntryStory({
                entryId: "entry-a",
                storyId: "story-b",
                relationType: "mentions",
            });
            expect(relinked?.evidence).toHaveLength(1);
            expect(relinked?.evidence[0]?.relationType).toBe("mentions");
            expect((await repository.entry("entry-a"))?.relatedStories[0]?.relationType)
                .toBe("mentions");

            const unlinked = await repository.unlinkEntryStory({
                entryId: "entry-a",
                storyId: "story-b",
            });
            expect(unlinked?.evidence).toEqual([]);
            expect((await repository.entry("entry-a"))?.relatedStories).toEqual([]);
            // Unlinking again is idempotent.
            expect((await repository.unlinkEntryStory({
                entryId: "entry-a",
                storyId: "story-b",
            }))?.evidence).toEqual([]);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("rejects linking an entry to its own primary story and unknown targets", async () => {
        const { repository, prisma } = await setup();
        try {
            await expect(repository.linkEntryStory({
                entryId: "entry-a",
                storyId: "story-a",
                relationType: "evidence_for",
            })).rejects.toBeInstanceOf(EntryStoryLinkConflictError);

            await expect(repository.linkEntryStory({
                entryId: "entry-missing",
                storyId: "story-b",
                relationType: "evidence_for",
            })).rejects.toBeInstanceOf(EntryNotFoundError);

            await expect(repository.linkEntryStory({
                entryId: "entry-a",
                storyId: "story-missing",
                relationType: "evidence_for",
            })).rejects.toBeInstanceOf(StoryNotFoundError);

            await expect(repository.unlinkEntryStory({
                entryId: "entry-missing",
                storyId: "story-b",
            })).rejects.toBeInstanceOf(EntryNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("moves links to the canonical story on merge and drops links to the entry's own story", async () => {
        const { repository, prisma } = await setup();
        try {
            await repository.linkEntryStory({
                entryId: "entry-a",
                storyId: "story-b",
                relationType: "evidence_for",
            });
            await repository.linkEntryStory({
                entryId: "entry-a",
                storyId: "story-c",
                relationType: "mentions",
            });
            await repository.linkEntryStory({
                entryId: "entry-c",
                storyId: "story-b",
                relationType: "evidence_for",
            });

            // story-c merges into story-a: entry-a's link to story-c would point
            // at its own primary Story and is dropped, while entry-c's link to
            // the untouched story-b survives.
            const merged = await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-c"],
            });
            expect(merged?.evidence).toEqual([]);
            const evidenceEntryIds = (await repository.story("story-b"))
                ?.evidence.map((item) => item.entryId) ?? [];
            expect([...evidenceEntryIds].sort()).toEqual(["entry-a", "entry-c"]);
            expect((await repository.entry("entry-a"))?.relatedStories
                .map((item) => item.storyId)).toEqual(["story-b"]);

            // story-b merges into story-a: entry-a and entry-c are now members
            // of story-a, so their surviving links become self-links and go away.
            const mergedAgain = await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-b"],
            });
            expect(mergedAgain?.evidence).toEqual([]);
            expect((await repository.entry("entry-a"))?.relatedStories).toEqual([]);
            expect((await repository.entry("entry-c"))?.relatedStories).toEqual([]);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("collapses a duplicate link when both the obsolete and canonical story are linked", async () => {
        const { repository, prisma } = await setup();
        try {
            await repository.linkEntryStory({
                entryId: "entry-c",
                storyId: "story-b",
                relationType: "evidence_for",
            });
            await repository.linkEntryStory({
                entryId: "entry-c",
                storyId: "story-a",
                relationType: "mentions",
            });

            const merged = await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-b"],
            });
            // The pair already exists on the canonical Story, so the obsolete
            // side is dropped and the canonical semantics win.
            expect(merged?.evidence.map((item) => [item.entryId, item.relationType]))
                .toEqual([["entry-c", "mentions"]]);
            expect((await repository.entry("entry-c"))?.relatedStories)
                .toEqual([{
                    storyId: "story-a",
                    relationType: "mentions",
                    title: "Story a",
                    reason: null,
                }]);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("drops a redundant link when the entry moves to its linked story", async () => {
        const { repository, prisma } = await setup();
        try {
            await repository.linkEntryStory({
                entryId: "entry-a",
                storyId: "story-b",
                relationType: "evidence_for",
            });
            const moved = await repository.moveEntryToStory({
                entryId: "entry-a",
                storyId: "story-b",
            });
            expect(moved?.evidence).toEqual([]);
            expect((await repository.entry("entry-a"))?.relatedStories).toEqual([]);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("upgrades a pre-evidence database without losing entries, stories or links", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-entry-story-upgrade-"));
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
            INSERT INTO "Story" ("id", "kind", "subtype", "createdAt", "updatedAt") VALUES
                ('story-a', 'document', NULL, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'),
                ('story-b', 'event', NULL, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "StoryRevision" ("id", "storyId", "revision", "fingerprint", "title", "summary", "createdAt") VALUES
                ('rev-a-1', 'story-a', 1, 'fp-a', 'Story a', NULL, '2026-09-09T00:00:00.000Z'),
                ('rev-b-1', 'story-b', 1, 'fp-b', 'Story b', NULL, '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            UPDATE "Story" SET "currentRevisionId" = 'rev-a-1' WHERE "id" = 'story-a';
        `);
        await oldClient.$executeRawUnsafe(`
            UPDATE "Story" SET "currentRevisionId" = 'rev-b-1' WHERE "id" = 'story-b';
        `);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "Entry" ("id", "sourceInstanceId", "canonicalExternalId", "storyId", "createdAt", "updatedAt") VALUES
                ('entry-a', 'source-a', 'external:entry-a', 'story-a', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            INSERT INTO "EntryRevision" ("id", "entryId", "revision", "title", "contentText", "contentFingerprint", "contentKind", "createdAt") VALUES
                ('er-a-1', 'entry-a', 1, 'entry-a', 'body', 'fp-er-a', 'article', '2026-09-09T00:00:00.000Z')
        `);
        await oldClient.$executeRawUnsafe(`
            UPDATE "Entry" SET "currentRevisionId" = 'er-a-1' WHERE "id" = 'entry-a';
        `);
        await oldClient.$disconnect();
        clients.delete(oldClient);

        deployMigrations(databasePath, join(prismaSource, "schema.prisma"));
        const client = new PrismaClient({
            datasources: { db: { url: sqliteUrl(databasePath) } },
        });
        clients.add(client);

        // Existing rows survive the upgrade and the new relation table works.
        expect(await client.entry.count()).toBe(1);
        expect(await client.story.count()).toBe(2);
        await client.entryStoryLink.create({
            data: {
                id: "link-1",
                entryId: "entry-a",
                storyId: "story-b",
                relationType: "evidence_for",
            },
        });
        expect(await client.entryStoryLink.count()).toBe(1);
        await expect(client.entryStoryLink.create({
            data: {
                id: "link-2",
                entryId: "entry-a",
                storyId: "story-b",
                relationType: "mentions",
            },
        })).rejects.toThrow(/Unique constraint failed/);
    });
});

async function setup(): Promise<{
    repository: PrismaCosmosRepository;
    prisma: PrismaClient;
}> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-entry-story-"));
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
    await seedStories(prisma);
    return { repository, prisma };
}

async function seedStories(prisma: PrismaClient): Promise<void> {
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
    for (const [entryId, sourceId, storyId] of [
        ["entry-a", "source-a", "story-a"],
        ["entry-b", "source-b", "story-b"],
        ["entry-c", "source-c", "story-c"],
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
        await prisma.story.create({ data: { id: storyId, kind: "document" } });
        await prisma.storyRevision.create({
            data: {
                id: `rev-${suffix}-1`,
                storyId,
                revision: 1,
                fingerprint: `fp-${storyId}`,
                title: `Story ${suffix}`,
                summary: null,
            },
        });
        await prisma.story.update({
            where: { id: storyId },
            data: { currentRevisionId: `rev-${suffix}-1` },
        });
        await prisma.entry.update({
            where: { id: entryId },
            data: { storyId, currentRevisionId: `er-${suffix}-1` },
        });
    }
}

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
