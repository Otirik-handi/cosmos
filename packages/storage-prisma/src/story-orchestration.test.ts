import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import {
    StoryMergeConflictError,
    StoryNotFoundError,
    StoryRevisionConflictError,
} from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Story orchestration commands", () => {
    it("moves entries, versions revisions with CAS, and merges Stories via canonical alias", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-story-orchestration-"));
        roots.push(root);
        const databasePath = join(root, "cosmos.sqlite");
        deployMigrations(databasePath);
        const prisma = new PrismaClient({
            datasources: { db: { url: sqliteUrl(databasePath) } },
        });
        const repository = new PrismaCosmosRepository({
            dataRoot: root,
            prisma,
        });
        await repository.initialize();

        try {
            await seedStories(prisma);

            // moveEntryToStory: entry-b joins story-a, old Story row keeps no members.
            const moved = await repository.moveEntryToStory({
                entryId: "entry-b",
                storyId: "story-a",
                actor: "user",
                reason: "same event",
            });
            expect(moved?.story.id).toBe("story-a");
            expect((await prisma.entry.findUnique({
                where: { id: "entry-b" },
                select: { storyId: true },
            }))?.storyId).toBe("story-a");
            expect(await prisma.storyAlias.count()).toBe(0);

            // updateStoryRevision appends only when display fields change; stale base conflicts.
            const updated = await repository.updateStoryRevision({
                storyId: "story-a",
                baseRevisionId: "rev-a-1",
                title: "Merged event title",
                summary: null,
                kind: "event",
                subtype: null,
                actor: "user",
                reason: "retitle",
            });
            expect(updated?.story.revisionId).not.toBe("rev-a-1");
            expect(await prisma.storyRevision.count({
                where: { storyId: "story-a" },
            })).toBe(2);
            const noOp = await repository.updateStoryRevision({
                storyId: "story-a",
                baseRevisionId: updated!.story.revisionId,
                title: "Merged event title",
                summary: null,
                kind: "event",
                subtype: null,
            });
            expect(noOp?.story.revisionId).toBe(updated?.story.revisionId);
            await expect(repository.updateStoryRevision({
                storyId: "story-a",
                baseRevisionId: "rev-a-1",
                title: "Stale edit",
                summary: null,
                kind: "event",
                subtype: null,
            })).rejects.toBeInstanceOf(StoryRevisionConflictError);

            // merge: story-c members move to canonical story-a; old id redirects.
            const merged = await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-c"],
                actor: "user",
                reason: "duplicate coverage",
            });
            expect(merged?.story.id).toBe("story-a");
            const alias = await prisma.storyAlias.findUnique({
                where: { id: "story-c" },
            });
            expect(alias?.canonicalStoryId).toBe("story-a");
            expect((await prisma.entry.findUnique({
                where: { id: "entry-c" },
                select: { storyId: true },
            }))?.storyId).toBe("story-a");
            const redirected = await repository.story("story-c");
            expect(redirected?.story.id).toBe("story-a");

            // obsolete Story rows and their revisions are preserved.
            const obsoleteStory = await prisma.story.findUnique({
                where: { id: "story-c" },
                include: { revisions: true, entries: true },
            });
            expect(obsoleteStory?.revisions).toHaveLength(1);
            expect(obsoleteStory?.entries).toHaveLength(0);

            // already-merged and missing Stories are rejected.
            await expect(repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-c"],
            })).rejects.toBeInstanceOf(StoryMergeConflictError);
            await expect(repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-missing"],
            })).rejects.toBeInstanceOf(StoryNotFoundError);
            await expect(repository.moveEntryToStory({
                entryId: "entry-b",
                storyId: "story-missing",
            })).rejects.toBeInstanceOf(StoryNotFoundError);

            // Domain events record each orchestration with actor/reason.
            const events = await repository.events({ afterSequence: 0, limit: 10 });
            const types = events.map((event) => event.type);
            expect(types).toEqual([
                "story.entry_moved.v1",
                "story.revision_created.v1",
                "story.merged.v1",
            ]);
        } finally {
            await repository.close();
        }
    });

    it("returns null when moving a missing entry and merges into itself is rejected", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-story-orchestration-missing-"));
        roots.push(root);
        const databasePath = join(root, "cosmos.sqlite");
        deployMigrations(databasePath);
        const prisma = new PrismaClient({
            datasources: { db: { url: sqliteUrl(databasePath) } },
        });
        const repository = new PrismaCosmosRepository({
            dataRoot: root,
            prisma,
        });
        await repository.initialize();

        try {
            await seedStories(prisma);
            await expect(repository.moveEntryToStory({
                entryId: "entry-missing",
                storyId: "story-a",
            })).resolves.toBeNull();
            await expect(repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-a"],
            })).rejects.toBeInstanceOf(StoryMergeConflictError);
        } finally {
            await repository.close();
        }
    });
});

async function seedStories(prisma: PrismaClient): Promise<void> {
    for (const id of ["source-a", "source-b"]) {
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
    for (const [id, sourceId] of [
        ["entry-a", "source-a"],
        ["entry-b", "source-b"],
    ] as const) {
        await prisma.entry.create({
            data: {
                id,
                sourceInstanceId: sourceId,
                canonicalExternalId: `external:${id}`,
            },
        });
    }
    await prisma.entry.create({
        data: {
            id: "entry-c",
            sourceInstanceId: "source-b",
            canonicalExternalId: "external:entry-c",
        },
    });
    await prisma.entryRevision.createMany({
        data: [
            {
                id: "er-a-1",
                entryId: "entry-a",
                revision: 1,
                title: "Entry A",
                contentText: "entry-a body",
                contentFingerprint: "fp-entry-a",
            },
            {
                id: "er-b-1",
                entryId: "entry-b",
                revision: 1,
                title: "Entry B",
                contentText: "entry-b body",
                contentFingerprint: "fp-entry-b",
            },
            {
                id: "er-c-1",
                entryId: "entry-c",
                revision: 1,
                title: "Entry C",
                contentText: "entry-c body",
                contentFingerprint: "fp-entry-c",
            },
        ],
    });
    await prisma.story.create({
        data: {
            id: "story-a",
            kind: "document",
        },
    });
    await prisma.story.create({
        data: {
            id: "story-b",
            kind: "document",
        },
    });
    await prisma.story.create({
        data: {
            id: "story-c",
            kind: "document",
        },
    });
    await prisma.storyRevision.createMany({
        data: [
            {
                id: "rev-a-1",
                storyId: "story-a",
                revision: 1,
                fingerprint: "fp-a",
                title: "Story A",
                summary: null,
            },
            {
                id: "rev-b-1",
                storyId: "story-b",
                revision: 1,
                fingerprint: "fp-b",
                title: "Story B",
                summary: null,
            },
            {
                id: "rev-c-1",
                storyId: "story-c",
                revision: 1,
                fingerprint: "fp-c",
                title: "Story C",
                summary: null,
            },
        ],
    });
    await prisma.story.update({
        where: { id: "story-a" },
        data: { currentRevisionId: "rev-a-1" },
    });
    await prisma.story.update({
        where: { id: "story-b" },
        data: { currentRevisionId: "rev-b-1" },
    });
    await prisma.story.update({
        where: { id: "story-c" },
        data: { currentRevisionId: "rev-c-1" },
    });
    await prisma.entry.update({
        where: { id: "entry-a" },
        data: { storyId: "story-a", currentRevisionId: "er-a-1" },
    });
    await prisma.entry.update({
        where: { id: "entry-b" },
        data: { storyId: "story-b", currentRevisionId: "er-b-1" },
    });
    await prisma.entry.update({
        where: { id: "entry-c" },
        data: { storyId: "story-c", currentRevisionId: "er-c-1" },
    });
}

function deployMigrations(databasePath: string): void {
    execFileSync(process.execPath, [
        resolve(
            process.cwd(),
            "packages/storage-prisma/node_modules/prisma/build/index.js",
        ),
        "migrate",
        "deploy",
        "--schema",
        resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma"),
    ], {
        env: { ...process.env, DATABASE_URL: sqliteUrl(databasePath) },
        stdio: "ignore",
    });
}

function sqliteUrl(databasePath: string): string {
    return `file:${databasePath.replaceAll("\\", "/")}`;
}
