import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PrismaClient } from "@prisma/client";
import {
    BoardBlockNotFoundError,
    BoardNameConflictError,
    BoardNotFoundError,
    BoardSectionNotFoundError,
    SpotlightPlacementNotFoundError,
    StoryNotFoundError,
} from "@cosmos/application";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("board domain commands", () => {    it("seeds the default board idempotently with hot/curation/feed sections", async () => {
        const { repository, prisma } = await setup();
        try {
            const first = await repository.ensureDefaultBoard();
            expect(first.name).toBe("默认看板");
            expect(first.sections.map((section) => section.title)).toEqual([
                "热点",
                "精华",
                "信息流",
            ]);
            const [hot, curation, feed] = first.sections;
            expect(hot!.blocks.map((block) => block.type)).toEqual(["spotlight"]);
            expect(curation!.blocks.map((block) => block.type)).toEqual(["topic-list"]);
            expect(feed!.blocks.map((block) => block.type)).toEqual(["feed", "source-health"]);

            // Second call returns the same board instead of seeding a duplicate.
            const second = await repository.ensureDefaultBoard();
            expect(second.id).toBe(first.id);
            expect((await repository.listBoards()).items).toHaveLength(1);

            // Deleting every board removes the seed target; the next call
            // recreates a fresh default board.
            await repository.deleteBoard(first.id);
            await expect(repository.getBoard(first.id)).resolves.toBeNull();
            const recreated = await repository.ensureDefaultBoard();
            expect(recreated.id).not.toBe(first.id);
            expect(recreated.sections).toHaveLength(3);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("creates, renames and deletes boards with unique names", async () => {
        const { repository, prisma } = await setup();
        try {
            const created = await repository.createBoard({
                name: "工作",
                description: "工作相关",
            });
            expect(created.sections).toEqual([]);
            await expect(repository.createBoard({ name: "工作" }))
                .rejects.toBeInstanceOf(BoardNameConflictError);

            const renamed = await repository.updateBoard({
                boardId: created.id,
                name: "工作看板",
                description: null,
            });
            expect(renamed.name).toBe("工作看板");
            expect(renamed.description).toBeNull();

            await repository.deleteBoard(created.id);
            await expect(repository.getBoard(created.id)).resolves.toBeNull();
            await expect(repository.deleteBoard(created.id))
                .rejects.toBeInstanceOf(BoardNotFoundError);
            await expect(repository.updateBoard({
                boardId: created.id,
                name: "任意",
            })).rejects.toBeInstanceOf(BoardNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("validates block configs against the per-type whitelist", async () => {
        const { repository, prisma } = await setup();
        try {
            const board = await repository.createBoard({ name: "看板" });
            const section = await repository.createSection({
                boardId: board.id,
                title: "信息流",
            });
            const sectionId = section.sections[0]!.id;

            // Whitelisted config passes and is stored losslessly.
            const withView = await repository.createBlock({
                sectionId,
                type: "feed",
                config: { savedViewId: "view-1", limit: 5 },
            });
            expect(withView.sections[0]!.blocks[0]!.config).toEqual({
                savedViewId: "view-1",
                limit: 5,
            });

            // Unknown config keys are rejected (strict whitelist).
            await expect(repository.createBlock({
                sectionId,
                type: "feed",
                config: { savedViewId: "view-1", rogue: true },
            })).rejects.toMatchObject({ name: "ZodError" });

            // Binding is optional for collection blocks too: an unbound block is
            // created and degrades to a placeholder on read (ADR-0010 decision 5).
            const unbound = await repository.createBlock({
                sectionId,
                type: "collection",
                config: {},
            });
            expect(unbound.sections[0]!.blocks[1]!.config).toEqual({});

            // Unknown types have no whitelist and are refused outright.
            await expect(repository.createBlock({
                sectionId,
                type: "gadget" as never,
                config: {},
            })).rejects.toThrow("Unknown board block type");

            // Config updates re-run the whitelist for the stored block type.
            const blockId = withView.sections[0]!.blocks[0]!.id;
            const updated = await repository.updateBlockConfig({
                blockId,
                config: {},
            });
            expect(updated.sections[0]!.blocks[0]!.config).toEqual({});
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("moves blocks across sections with resequencing and toggles visibility", async () => {
        const { repository, prisma } = await setup();
        try {
            const board = await repository.createBoard({ name: "看板" });
            const sections = await repository.createSection({
                boardId: board.id,
                title: "A",
            });
            const sectionA = sections.sections[0]!.id;
            const withB = await repository.createSection({
                boardId: board.id,
                title: "B",
            });
            const sectionB = withB.sections[1]!.id;

            const first = await repository.createBlock({
                sectionId: sectionA,
                type: "source-health",
                config: {},
            });
            const blockA = first.sections[0]!.blocks[0]!.id;
            const second = await repository.createBlock({
                sectionId: sectionA,
                type: "topic-list",
                config: { limit: 3 },
            });
            const blockA2 = second.sections[0]!.blocks[1]!.id;
            const third = await repository.createBlock({
                sectionId: sectionB,
                type: "spotlight",
                config: {},
            });
            const blockB = third.sections[1]!.blocks[0]!.id;

            // Cross-section move: A keeps one block resequenced to 0, B has two.
            const moved = await repository.moveBlock({
                blockId: blockA,
                sectionId: sectionB,
                position: 0,
            });
            const afterMove = moved.sections;
            expect(afterMove[0]!.blocks.map((block) => block.id)).toEqual([blockA2]);
            expect(afterMove[0]!.blocks[0]!.position).toBe(0);
            expect(afterMove[1]!.blocks.map((block) => block.id)).toEqual([blockA, blockB]);

            // Hidden blocks stay in the tree with visible=false.
            const hidden = await repository.setBlockVisibility({
                blockId: blockA,
                visible: false,
            });
            expect(hidden.sections[1]!.blocks.find((block) => block.id === blockA)!.visible)
                .toBe(false);

            await expect(repository.moveBlock({
                blockId: blockA,
                sectionId: "missing-section",
                position: 0,
            })).rejects.toBeInstanceOf(BoardSectionNotFoundError);
            await expect(repository.setBlockVisibility({
                blockId: "missing-block",
                visible: true,
            })).rejects.toBeInstanceOf(BoardBlockNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("duplicates a block with the same config and deletes blocks without touching content", async () => {
        const { repository, prisma } = await setup();
        try {
            const savedView = await repository.createSavedView({
                name: "开发",
                conditions: { text: "dev", labelIds: [], topicIds: [] },
            });
            const board = await repository.createBoard({ name: "看板" });
            const section = await repository.createSection({
                boardId: board.id,
                title: "信息流",
            });
            const sectionId = section.sections[0]!.id;
            const created = await repository.createBlock({
                sectionId,
                type: "feed",
                config: { savedViewId: savedView.id },
            });
            const blockId = created.sections[0]!.blocks[0]!.id;

            const duplicated = await repository.duplicateBlock(blockId);
            const blocks = duplicated.sections[0]!.blocks;
            expect(blocks).toHaveLength(2);
            expect(blocks[0]!.id).toBe(blockId);
            expect(blocks[1]!.config).toEqual({ savedViewId: savedView.id });
            expect(blocks[1]!.type).toBe("feed");
            expect(blocks[1]!.position).toBe(1);

            // Deleting the block must not delete the referenced Saved View.
            await repository.deleteBlock(blockId);
            const afterDelete = await repository.getBoard(board.id);
            expect(afterDelete?.sections[0]!.blocks.map((block) => block.id))
                .toEqual([blocks[1]!.id]);
            await expect(repository.listSavedViews()).resolves.toEqual({
                items: [expect.objectContaining({ id: savedView.id })],
            });

            // The duplicate is unaffected and remains configurable.
            await repository.updateBlockConfig({
                blockId: blocks[1]!.id,
                config: { savedViewId: savedView.id, limit: 10 },
            });
            const refreshed = await repository.getBoard(board.id);
            expect(refreshed?.sections[0]!.blocks[0]!.config).toEqual({
                savedViewId: savedView.id,
                limit: 10,
            });
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("pins and unpins spotlight placements and follows Story merges", async () => {
        const { repository, prisma } = await setup();
        try {
            await seedStory(prisma, "story-a", "Story A");
            await seedStory(prisma, "story-b", "Story B");
            await seedTopic(prisma, "topic-a", "Topic A");
            const board = await repository.createBoard({ name: "看板" });

            const pinned = await repository.createSpotlightPlacement({
                boardId: board.id,
                targetType: "story",
                targetId: "story-a",
                reason: "手动固定",
            });
            expect(pinned.targetTitle).toBe("Story A");
            expect(pinned.source).toBe("manual");
            expect(pinned.expiresAt).toBeNull();

            // Pinning the same target on the same board is an idempotent no-op.
            const again = await repository.createSpotlightPlacement({
                boardId: board.id,
                targetType: "story",
                targetId: "story-a",
            });
            expect(again.id).toBe(pinned.id);

            await repository.createSpotlightPlacement({
                boardId: board.id,
                targetType: "topic",
                targetId: "topic-a",
            });
            const list = await repository.listSpotlightPlacements({ boardId: board.id });
            expect(list.items.map((item) => item.targetTitle)).toEqual(["Story A", "Topic A"]);

            await expect(repository.createSpotlightPlacement({
                boardId: "missing-board",
                targetType: "story",
                targetId: "story-a",
            })).rejects.toBeInstanceOf(BoardNotFoundError);
            await expect(repository.createSpotlightPlacement({
                boardId: board.id,
                targetType: "story",
                targetId: "missing-story",
            })).rejects.toBeInstanceOf(StoryNotFoundError);

            // A Story merge re-points placements to the canonical Story.
            await repository.mergeStories({
                canonicalStoryId: "story-b",
                obsoleteStoryIds: ["story-a"],
            });
            const afterMerge = await repository.listSpotlightPlacements({ boardId: board.id });
            const storyPlacement = afterMerge.items.find((item) => item.targetType === "story");
            expect(storyPlacement?.targetId).toBe("story-b");
            expect(storyPlacement?.targetTitle).toBe("Story B");

            await repository.deleteSpotlightPlacement(pinned.id);
            const afterUnpin = await repository.listSpotlightPlacements({ boardId: board.id });
            expect(afterUnpin.items).toHaveLength(1);
            await expect(repository.deleteSpotlightPlacement(pinned.id))
                .rejects.toBeInstanceOf(SpotlightPlacementNotFoundError);
        } finally {
            await repository.close();
            await prisma.$disconnect();
        }
    });

    it("collapses duplicate spotlight placements on a same-board merge collision", async () => {
        const { repository, prisma } = await setup();
        try {
            await seedStory(prisma, "story-a", "Story A");
            await seedStory(prisma, "story-b", "Story B");
            const board = await repository.createBoard({ name: "看板" });
            await repository.createSpotlightPlacement({
                boardId: board.id,
                targetType: "story",
                targetId: "story-a",
            });
            await repository.createSpotlightPlacement({
                boardId: board.id,
                targetType: "story",
                targetId: "story-b",
            });

            await repository.mergeStories({
                canonicalStoryId: "story-b",
                obsoleteStoryIds: ["story-a"],
            });
            const placements = await repository.listSpotlightPlacements({ boardId: board.id });
            expect(placements.items).toHaveLength(1);
            expect(placements.items[0]!.targetId).toBe("story-b");
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
    const root = await mkdtemp(join(tmpdir(), "cosmos-board-"));
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
    return { repository, prisma };
}

async function seedStory(prisma: PrismaClient, id: string, title: string): Promise<void> {
    await prisma.story.create({ data: { id, kind: "document" } });
    await prisma.storyRevision.create({
        data: {
            id: `rev-${id}-1`,
            storyId: id,
            revision: 1,
            fingerprint: `fp-${id}`,
            title,
            summary: null,
        },
    });
    await prisma.story.update({
        where: { id },
        data: { currentRevisionId: `rev-${id}-1` },
    });
}

async function seedTopic(prisma: PrismaClient, id: string, title: string): Promise<void> {
    await prisma.topic.create({ data: { id } });
    await prisma.topicRevision.create({
        data: {
            id: `rev-${id}-1`,
            topicId: id,
            revision: 1,
            fingerprint: `fp-${id}`,
            title,
            purpose: "seed",
            scope: null,
        },
    });
    await prisma.topic.update({
        where: { id },
        data: { currentRevisionId: `rev-${id}-1` },
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
