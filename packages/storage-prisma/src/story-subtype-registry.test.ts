import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import { StorySubtypeInvalidError } from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];
const clients = new Set<PrismaClient>();

afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Story subtype registry", () => {
    it("persists a registered subtype and a changed kind on the Story", async () => {
        const { repository, prisma } = await setup();
        try {
            await seedStory(prisma, { storyId: "story-1", kind: "document", subtype: null, title: "作品" });

            const updated = await repository.updateStoryRevision({
                storyId: "story-1",
                baseRevisionId: "rev-story-1",
                title: "作品",
                summary: null,
                kind: "media",
                subtype: "media.comic",
                actor: "user",
                reason: "分类",
            });

            expect(updated?.story).toMatchObject({ kind: "media", subtype: "media.comic" });
            expect(await prisma.storyRevision.count({ where: { storyId: "story-1" } })).toBe(2);
            expect((await repository.story("story-1"))?.story.subtype).toBe("media.comic");
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("rejects unregistered and cross-kind subtypes without touching the Story", async () => {
        const { repository, prisma } = await setup();
        try {
            await seedStory(prisma, { storyId: "story-1", kind: "media", subtype: null, title: "作品" });

            await expect(repository.updateStoryRevision({
                storyId: "story-1",
                baseRevisionId: "rev-story-1",
                title: "作品",
                summary: null,
                kind: "media",
                subtype: "media.unknown",
            })).rejects.toBeInstanceOf(StorySubtypeInvalidError);

            await expect(repository.updateStoryRevision({
                storyId: "story-1",
                baseRevisionId: "rev-story-1",
                title: "作品",
                summary: null,
                kind: "event",
                subtype: "media.comic",
            })).rejects.toBeInstanceOf(StorySubtypeInvalidError);

            await expect(repository.updateStoryRevision({
                storyId: "story-1",
                baseRevisionId: "rev-story-1",
                title: "作品",
                summary: null,
                kind: "media",
                subtype: "   ",
            })).rejects.toBeInstanceOf(StorySubtypeInvalidError);

            const story = await repository.story("story-1");
            expect(story?.story).toMatchObject({ kind: "media", subtype: null, title: "作品" });
            expect(await prisma.storyRevision.count({ where: { storyId: "story-1" } })).toBe(1);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("keeps an unregistered legacy subtype while other fields change", async () => {
        const { repository, prisma } = await setup();
        try {
            await seedStory(prisma, {
                storyId: "story-legacy",
                kind: "event",
                subtype: "event.announcement",
                title: "旧值",
            });

            const updated = await repository.updateStoryRevision({
                storyId: "story-legacy",
                baseRevisionId: "rev-story-legacy",
                title: "改标题但保留旧 subtype",
                summary: "摘要",
                kind: "event",
                subtype: "event.announcement",
            });

            expect(updated?.story).toMatchObject({
                kind: "event",
                subtype: "event.announcement",
                title: "改标题但保留旧 subtype",
            });
            expect(await prisma.storyRevision.count({ where: { storyId: "story-legacy" } })).toBe(2);

            // The same Story may still move to a registered subtype.
            const migrated = await repository.updateStoryRevision({
                storyId: "story-legacy",
                baseRevisionId: updated!.story.revisionId,
                title: "改标题但保留旧 subtype",
                summary: "摘要",
                kind: "media",
                subtype: "media.anime",
            });
            expect(migrated?.story).toMatchObject({ kind: "media", subtype: "media.anime" });
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("rejects a legacy subtype when the kind changes or the value is replaced", async () => {
        const { repository, prisma } = await setup();
        try {
            await seedStory(prisma, {
                storyId: "story-legacy",
                kind: "event",
                subtype: "event.announcement",
                title: "旧值",
            });

            await expect(repository.updateStoryRevision({
                storyId: "story-legacy",
                baseRevisionId: "rev-story-legacy",
                title: "换 kind",
                summary: null,
                kind: "document",
                subtype: "event.announcement",
            })).rejects.toBeInstanceOf(StorySubtypeInvalidError);

            await expect(repository.updateStoryRevision({
                storyId: "story-legacy",
                baseRevisionId: "rev-story-legacy",
                title: "换 subtype",
                summary: null,
                kind: "event",
                subtype: "event.other",
            })).rejects.toBeInstanceOf(StorySubtypeInvalidError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("rejects an unregistered successor subtype on split", async () => {
        const { repository, prisma } = await setup();
        try {
            await seedStory(prisma, { storyId: "story-shell", kind: "media", subtype: null, title: "被合并的作品" });
            await seedSourceAndEntries(prisma, ["entry-a", "entry-b"], "story-shell");

            await expect(repository.splitStory({
                storyId: "story-shell",
                successors: [
                    {
                        title: "后继 A",
                        summary: null,
                        kind: "media",
                        subtype: "media.unknown",
                        entryIds: ["entry-a"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                    {
                        title: "后继 B",
                        summary: null,
                        kind: "media",
                        subtype: "media.video",
                        entryIds: ["entry-b"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                ],
            })).rejects.toBeInstanceOf(StorySubtypeInvalidError);

            expect((await repository.story("story-shell"))?.story.status).toBe("active");
            expect(await prisma.storyReplacement.count()).toBe(0);

            const split = await repository.splitStory({
                storyId: "story-shell",
                successors: [
                    {
                        title: "后继 A",
                        summary: null,
                        kind: "media",
                        subtype: "media.comic",
                        entryIds: ["entry-a"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                    {
                        title: "后继 B",
                        summary: null,
                        kind: "media",
                        subtype: "media.video",
                        entryIds: ["entry-b"],
                        evidenceEntryIds: [],
                        entityIds: [],
                        topicIds: [],
                    },
                ],
            });
            expect(split?.story.replacedBy).toHaveLength(2);
            const successors = await prisma.story.findMany({
                where: { id: { in: split!.story.replacedBy.map((successor) => successor.storyId) } },
                select: { kind: true, subtype: true },
            });
            expect(successors.map((successor) => successor.subtype).sort())
                .toEqual(["media.comic", "media.video"]);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });
});

async function setup(): Promise<{
    repository: PrismaCosmosRepository;
    prisma: PrismaClient;
}> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-story-subtype-"));
    roots.push(root);
    const databasePath = join(root, "cosmos.sqlite");
    deployMigrations(
        databasePath,
        resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma"),
    );
    const prisma = new PrismaClient({
        datasources: { db: { url: sqliteUrl(databasePath) } },
    });
    clients.add(prisma);
    const repository = new PrismaCosmosRepository({ dataRoot: root, prisma });
    await repository.initialize();
    return { repository, prisma };
}

async function seedStory(
    prisma: PrismaClient,
    input: { storyId: string; kind: string; subtype: string | null; title: string },
): Promise<void> {
    await prisma.story.create({
        data: { id: input.storyId, kind: input.kind, subtype: input.subtype },
    });
    await prisma.storyRevision.create({
        data: {
            id: `rev-${input.storyId}`,
            storyId: input.storyId,
            revision: 1,
            fingerprint: `fp-${input.storyId}`,
            title: input.title,
            summary: null,
        },
    });
    await prisma.story.update({
        where: { id: input.storyId },
        data: { currentRevisionId: `rev-${input.storyId}` },
    });
}

async function seedSourceAndEntries(
    prisma: PrismaClient,
    entryIds: readonly string[],
    storyId: string,
): Promise<void> {
    await prisma.sourceInstance.create({
        data: {
            id: "source-a",
            name: "source-a",
            kind: "rss",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            configJson: "{}",
            enabled: true,
        },
    });
    for (const entryId of entryIds) {
        await prisma.entry.create({
            data: {
                id: entryId,
                sourceInstanceId: "source-a",
                canonicalExternalId: `external:${entryId}`,
            },
        });
        await prisma.entryRevision.create({
            data: {
                id: `er-${entryId}`,
                entryId,
                revision: 1,
                title: entryId,
                contentText: `${entryId} body`,
                contentFingerprint: `fp-${entryId}`,
            },
        });
        await prisma.entry.update({
            where: { id: entryId },
            data: { storyId, currentRevisionId: `er-${entryId}` },
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
