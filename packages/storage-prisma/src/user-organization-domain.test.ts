import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import {
    CollectionNotFoundError,
    AnnotationNotFoundError,
    EntryNotFoundError,
    LabelConflictError,
    LabelNotFoundError,
    StoryNotFoundError,
    TopicNotFoundError,
} from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("user organization domain commands", () => {
    it("creates and deletes labels with unique names and assignment counts", async () => {
        const { repository, prisma } = await setup();
        try {
            const created = await repository.createLabel({ name: "AI" });
            expect(created.assignedCount).toBe(0);
            await expect(repository.createLabel({ name: "AI" }))
                .rejects.toBeInstanceOf(LabelConflictError);
            await repository.createLabel({ name: "  硬件 " });

            const list = await repository.listLabels();
            expect(list.items.map((item) => item.name)).toEqual(["AI", "硬件"]);
            expect(list.items[0].assignedCount).toBe(0);

            await repository.attachLabel({
                labelId: created.id,
                targetType: "story",
                targetId: "story-a",
            });
            expect((await repository.listLabels()).items
                .find((item) => item.id === created.id)!.assignedCount).toBe(1);

            await repository.deleteLabel(created.id);
            expect(await repository.label(created.id)).toBeNull();
            await expect(repository.deleteLabel(created.id))
                .rejects.toBeInstanceOf(LabelNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("attaches labels to story/entry/topic targets and resolves titles on detail", async () => {
        const { repository, prisma } = await setup();
        try {
            const topic = await repository.createTopic({
                title: "Jeff Dean 去向",
                purpose: "跟踪去向",
                scope: null,
            });
            const label = await repository.createLabel({ name: "关注" });

            await repository.attachLabel({
                labelId: label.id,
                targetType: "story",
                targetId: "story-a",
            });
            await repository.attachLabel({
                labelId: label.id,
                targetType: "entry",
                targetId: "entry-a",
            });
            await repository.attachLabel({
                labelId: label.id,
                targetType: "topic",
                targetId: topic!.topic.id,
            });
            // Attaching the same label again is an idempotent no-op.
            await repository.attachLabel({
                labelId: label.id,
                targetType: "story",
                targetId: "story-a",
            });

            const detail = await repository.label(label.id);
            expect(detail?.assignedStories).toEqual([{ id: "story-a", title: "Story a" }]);
            expect(detail?.assignedEntries).toEqual([{ id: "entry-a", title: "entry-a" }]);
            expect(detail?.assignedTopics).toEqual([
                { id: topic!.topic.id, title: "Jeff Dean 去向" },
            ]);

            await repository.detachLabel({
                labelId: label.id,
                targetType: "entry",
                targetId: "entry-a",
            });
            expect((await repository.label(label.id))?.assignedEntries).toHaveLength(0);
            // Detaching a non-existent assignment is a no-op, not an error.
            await repository.detachLabel({
                labelId: label.id,
                targetType: "entry",
                targetId: "entry-a",
            });

            await expect(repository.attachLabel({
                labelId: label.id,
                targetType: "story",
                targetId: "story-missing",
            })).rejects.toBeInstanceOf(StoryNotFoundError);
            await expect(repository.attachLabel({
                labelId: label.id,
                targetType: "entry",
                targetId: "entry-missing",
            })).rejects.toBeInstanceOf(EntryNotFoundError);
            await expect(repository.attachLabel({
                labelId: label.id,
                targetType: "topic",
                targetId: "topic-missing",
            })).rejects.toBeInstanceOf(TopicNotFoundError);
            await expect(repository.attachLabel({
                labelId: "label-missing",
                targetType: "story",
                targetId: "story-a",
            })).rejects.toBeInstanceOf(LabelNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("manages collections and their Story membership", async () => {
        const { repository, prisma } = await setup();
        try {
            const created = await repository.createCollection({
                name: "Reading",
                description: "稍后阅读",
            });
            expect(created.itemCount).toBe(0);

            const renamed = await repository.updateCollection({
                collectionId: created.id,
                name: "Read later",
                description: null,
            });
            expect(renamed.name).toBe("Read later");
            expect(renamed.itemCount).toBe(0);

            await repository.addCollectionItem({
                collectionId: created.id,
                storyId: "story-a",
            });
            await repository.addCollectionItem({
                collectionId: created.id,
                storyId: "story-b",
            });
            // Re-adding the same Story is an idempotent no-op.
            await repository.addCollectionItem({
                collectionId: created.id,
                storyId: "story-a",
            });
            expect((await repository.listCollections()).items[0].itemCount).toBe(2);

            const membership = await repository.listCollections({ storyId: "story-a" });
            expect(membership.items.find((item) => item.id === created.id)?.containsStory)
                .toBe(true);

            const detail = await repository.collection(created.id);
            expect(detail?.stories.map((item) => item.storyId)).toEqual(["story-a", "story-b"]);
            expect(detail?.stories[0].title).toBe("Story a");

            await repository.removeCollectionItem({
                collectionId: created.id,
                storyId: "story-a",
            });
            expect((await repository.collection(created.id))?.stories).toHaveLength(1);

            await expect(repository.addCollectionItem({
                collectionId: created.id,
                storyId: "story-missing",
            })).rejects.toBeInstanceOf(StoryNotFoundError);
            await expect(repository.addCollectionItem({
                collectionId: "collection-missing",
                storyId: "story-a",
            })).rejects.toBeInstanceOf(CollectionNotFoundError);
            await expect(repository.collection("collection-missing")).resolves.toBeNull();

            await repository.deleteCollection(created.id);
            await expect(repository.collection(created.id)).resolves.toBeNull();
            await expect(repository.deleteCollection(created.id))
                .rejects.toBeInstanceOf(CollectionNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("sets and unsets Story/Entry favorites and reflects them on Story detail", async () => {
        const { repository, prisma } = await setup();
        try {
            const story = await repository.story("story-a");
            expect(story?.favorited).toBe(false);
            expect(story?.labels).toEqual([]);

            await repository.setFavorite({ targetType: "story", targetId: "story-a" });
            await repository.setFavorite({ targetType: "entry", targetId: "entry-a" });
            // Setting twice is an idempotent no-op.
            await repository.setFavorite({ targetType: "story", targetId: "story-a" });

            expect((await repository.story("story-a"))?.favorited).toBe(true);
            const favorites = await repository.listFavorites();
            expect(favorites.items).toHaveLength(2);

            await repository.unsetFavorite({ targetType: "story", targetId: "story-a" });
            expect((await repository.story("story-a"))?.favorited).toBe(false);
            expect((await repository.listFavorites()).items).toHaveLength(1);
            await repository.unsetFavorite({ targetType: "story", targetId: "story-a" });

            await expect(repository.setFavorite({
                targetType: "story",
                targetId: "story-missing",
            })).rejects.toBeInstanceOf(StoryNotFoundError);
            await expect(repository.setFavorite({
                targetType: "entry",
                targetId: "entry-missing",
            })).rejects.toBeInstanceOf(EntryNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("migrates collections, favorites and labels when Stories are merged", async () => {
        const { repository, prisma } = await setup();
        try {
            // Move path: obsolete story-b owns the only row.
            const reading = await repository.createCollection({ name: "Reading" });
            await repository.addCollectionItem({
                collectionId: reading.id,
                storyId: "story-b",
            });
            await repository.setFavorite({ targetType: "story", targetId: "story-b" });
            const label = await repository.createLabel({ name: "关注" });
            await repository.attachLabel({
                labelId: label.id,
                targetType: "story",
                targetId: "story-b",
            });

            await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-b"],
            });
            expect((await repository.collection(reading.id))?.stories.map((item) => item.storyId))
                .toEqual(["story-a"]);
            expect((await repository.listFavorites()).items.map((item) => item.targetId))
                .toContain("story-a");
            expect((await repository.story("story-a"))?.labels).toEqual([
                { id: label.id, name: "关注" },
            ]);
            // The obsolete alias is now resolved to canonical on further attaches.
            await repository.setFavorite({ targetType: "story", targetId: "story-b" });
            const favorites = await repository.listFavorites();
            expect(favorites.items.filter((item) => item.targetType === "story")).toHaveLength(1);
            expect((await repository.label(label.id))?.assignedStories).toHaveLength(1);

            // Collision path: obsolete story-c rows already exist on canonical.
            const shelf = await repository.createCollection({ name: "Shelf" });
            await repository.addCollectionItem({ collectionId: shelf.id, storyId: "story-a" });
            await repository.addCollectionItem({ collectionId: shelf.id, storyId: "story-c" });
            await repository.setFavorite({ targetType: "story", targetId: "story-c" });
            await repository.attachLabel({
                labelId: label.id,
                targetType: "story",
                targetId: "story-c",
            });

            await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-c"],
            });
            expect((await repository.collection(shelf.id))?.stories).toHaveLength(1);
            expect((await repository.story("story-a"))?.favorited).toBe(true);
            expect((await repository.label(label.id))?.assignedStories).toEqual([
                { id: "story-a", title: "Story a" },
            ]);
            const assignments = await prisma.labelAssignment.findMany({ where: { labelId: label.id } });
            expect(assignments).toHaveLength(1);

            const events = await repository.events({ afterSequence: 0, limit: 100 });
            expect(events.some((event) => event.type === "collection.item_merged.v1")).toBe(true);
            expect(events.some((event) => event.type === "label.assignment_merged.v1")).toBe(true);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });
    it("creates, edits and deletes annotations with target revision capture", async () => {
        const { repository, prisma } = await setup();
        try {
            const created = await repository.createAnnotation({
                targetType: "story",
                targetId: "story-a",
                body: "值得跟进",
                quote: "原文片段",
                evidence: "上下文",
                actor: "user",
            });
            // Story targets capture the current StoryRevision at write time.
            expect(created.targetType).toBe("story");
            expect(created.targetId).toBe("story-a");
            expect(created.targetRevisionId).toBe("rev-a-1");
            expect(created.quote).toBe("原文片段");
            expect(created.actor).toBe("user");

            // Entry and topic targets carry no revision pointer.
            const onEntry = await repository.createAnnotation({
                targetType: "entry",
                targetId: "entry-a",
                body: "条目备注",
            });
            expect(onEntry.targetRevisionId).toBeNull();

            const topic = await repository.createTopic({
                title: "T",
                purpose: "P",
                scope: null,
            });
            await repository.createAnnotation({
                targetType: "topic",
                targetId: topic!.topic.id,
                body: "话题备注",
            });

            expect((await repository.listAnnotations({
                targetType: "story",
                targetId: "story-a",
            })).items).toHaveLength(1);
            expect((await repository.listAnnotations({
                targetType: "entry",
                targetId: "entry-a",
            })).items[0].body).toBe("条目备注");

            const updated = await repository.updateAnnotation({
                annotationId: created.id,
                body: "改后",
                quote: null,
                actor: "user",
            });
            expect(updated?.body).toBe("改后");
            expect(updated?.quote).toBeNull();

            await repository.deleteAnnotation(created.id);
            expect((await repository.listAnnotations({
                targetType: "story",
                targetId: "story-a",
            })).items).toHaveLength(0);

            await expect(repository.updateAnnotation({
                annotationId: "annotation-missing",
                body: "x",
            })).rejects.toBeInstanceOf(AnnotationNotFoundError);
            await expect(repository.deleteAnnotation("annotation-missing"))
                .rejects.toBeInstanceOf(AnnotationNotFoundError);
            await expect(repository.createAnnotation({
                targetType: "story",
                targetId: "story-missing",
                body: "x",
            })).rejects.toBeInstanceOf(StoryNotFoundError);

            const events = await repository.events({ afterSequence: 0, limit: 100 });
            expect(events.some((event) => event.type === "annotation.created.v1")).toBe(true);
            expect(events.some((event) => event.type === "annotation.deleted.v1")).toBe(true);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("re-points annotations to the canonical Story on merge", async () => {
        const { repository, prisma } = await setup();
        try {
            const annotation = await repository.createAnnotation({
                targetType: "story",
                targetId: "story-b",
                body: "归并前写的备注",
            });
            await repository.mergeStories({
                canonicalStoryId: "story-a",
                obsoleteStoryIds: ["story-b"],
            });
            const onCanonical = await repository.listAnnotations({
                targetType: "story",
                targetId: "story-a",
            });
            expect(onCanonical.items.map((item) => item.id)).toEqual([annotation.id]);
            // The alias resolves to canonical on further reads too.
            expect((await repository.listAnnotations({
                targetType: "story",
                targetId: "story-b",
            })).items.map((item) => item.id)).toEqual([annotation.id]);
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
    const root = await mkdtemp(join(tmpdir(), "cosmos-user-organization-"));
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
    await seedStories(prisma);
    return { repository, prisma };
}

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
        ["entry-c", "source-b"],
    ] as const) {
        await prisma.entry.create({
            data: {
                id,
                sourceInstanceId: sourceId,
                canonicalExternalId: `external:${id}`,
            },
        });
        await prisma.entryRevision.create({
            data: {
                id: `er-${id}-1`,
                entryId: id,
                revision: 1,
                title: id,
                contentText: `${id} body`,
                contentFingerprint: `fp-${id}`,
            },
        });
        await prisma.story.create({ data: { id: `story-${id.at(-1)}`, kind: "document" } });
        await prisma.storyRevision.create({
            data: {
                id: `rev-${id.at(-1)}-1`,
                storyId: `story-${id.at(-1)}`,
                revision: 1,
                fingerprint: `fp-story-${id.at(-1)}`,
                title: `Story ${id.at(-1)}`,
                summary: null,
            },
        });
        await prisma.story.update({
            where: { id: `story-${id.at(-1)}` },
            data: { currentRevisionId: `rev-${id.at(-1)}-1` },
        });
        await prisma.entry.update({
            where: { id },
            data: { storyId: `story-${id.at(-1)}`, currentRevisionId: `er-${id}-1` },
        });
    }
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
