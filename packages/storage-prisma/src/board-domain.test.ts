import { PrismaClient } from "@prisma/client";
import {
    BoardBlockNotFoundError,
    BoardNameConflictError,
    BoardNotFoundError,
    BoardSectionNotFoundError,
    SpotlightPlacementNotFoundError,
    StoryNotFoundError,
} from "@cosmos/application";
import { type BoardDetail } from "@cosmos/contracts";
import { describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";
import { withRepository } from "./index.fixtures.js";

describe("board domain commands", () => {    it("seeds the default board idempotently with hot/curation/feed sections", async () => {
        await withRepository("board", async (repository, prisma) => {
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
        });
    });

    it("creates, renames and deletes boards with unique names", async () => {
        await withRepository("board", async (repository, prisma) => {
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
        });
    });

    it("validates block configs against the per-type whitelist", async () => {
        await withRepository("board", async (repository, prisma) => {
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
        });
    });

    it("moves blocks across sections with resequencing and toggles visibility", async () => {
        await withRepository("board", async (repository, prisma) => {
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
        });
    });

    it("reorders blocks inside one section by the post-removal index and persists it", async () => {
        await withRepository("board", async (repository, prisma) => {
            const { boardId, blockIds, orderOf } = await seedFourBlockSection(repository);
            const [, blockB] = blockIds;

            // 同分区内把 B（当前第 1 格）移到 position=2。`position` 的口径是
            // 「先移除被拖区块、再在剩余区块之间插入」，等价于 arrayMove 的 `to`
            // ——客户端 `resolveDropTarget` 把「B 拖到 C 上」翻成 C 的下标 2，预览
            // 就是 [A,C,B,D]。若按「全量下标」理解（position 计入被拖区块自己的
            // 槽位），B 会多落一格，得到用户报告过的 [A,C,D,B]。
            const moved = await repository.moveBlock({ blockId: blockB, position: 2 });
            expect(orderOf(moved)).toEqual(["A", "C", "B", "D"]);
            expect(moved.sections[0]!.blocks.map((block) => block.position))
                .toEqual([0, 1, 2, 3]);

            // 移动路径的重新读取：现有 fresh-read 断言只出现在删除路径上。
            const reloaded = await repository.getBoard(boardId);
            expect(orderOf(reloaded!)).toEqual(["A", "C", "B", "D"]);
            expect(reloaded!.sections[0]!.blocks.map((block) => block.position))
                .toEqual([0, 1, 2, 3]);
        });
    });

    it("moves the first block of a section into the second slot", async () => {
        await withRepository("board", async (repository, prisma) => {
            const { boardId, sectionId, blockIds, orderOf } = await seedFourBlockSection(repository);
            const [blockA] = blockIds;

            // 浏览器验收里「把第一个区块拖到第二个槽位」那条断言（position=1）的
            // 下层版本：显式传同一个 sectionId 也必须留在原分区。全量下标口径会得到
            // [B,C,A,D]（A 多跳过一格），正是该 spec 注释记载的旧口径结果。
            const moved = await repository.moveBlock({
                blockId: blockA,
                sectionId,
                position: 1,
            });
            expect(orderOf(moved)).toEqual(["B", "A", "C", "D"]);

            const reloaded = await repository.getBoard(boardId);
            expect(orderOf(reloaded!)).toEqual(["B", "A", "C", "D"]);
        });
    });

    it("duplicates a block with the same config and deletes blocks without touching content", async () => {
        await withRepository("board", async (repository, prisma) => {
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
        });
    });

    it("pins and unpins spotlight placements and follows Story merges", async () => {
        await withRepository("board", async (repository, prisma) => {
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
        });
    });

    it("collapses duplicate spotlight placements on a same-board merge collision", async () => {
        await withRepository("board", async (repository, prisma) => {
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
        });
    });
});

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

/**
 * 一个分区里按 A/B/C/D 顺序放四个区块，并返回把区块 id 折回字母的顺序读取器。
 * 同分区重排的 `position` 口径要靠「谁落在第几格」才看得出来，直接断言 id 读不出来。
 */
async function seedFourBlockSection(repository: PrismaCosmosRepository): Promise<{
    boardId: string;
    sectionId: string;
    blockIds: readonly [string, string, string, string];
    orderOf: (detail: BoardDetail) => string[];
}> {
    const board = await repository.createBoard({ name: "看板" });
    const created = await repository.createSection({
        boardId: board.id,
        title: "信息流",
    });
    const sectionId = created.sections[0]!.id;
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
        const withBlock = await repository.createBlock({
            sectionId,
            type: "collection",
            config: {},
        });
        ids.push(withBlock.sections[0]!.blocks[index]!.id);
    }
    const [blockA, blockB, blockC, blockD] = ids as [string, string, string, string];
    const letters = new Map([
        [blockA, "A"],
        [blockB, "B"],
        [blockC, "C"],
        [blockD, "D"],
    ]);
    return {
        boardId: board.id,
        sectionId,
        blockIds: [blockA, blockB, blockC, blockD],
        orderOf: (detail) =>
            detail.sections[0]!.blocks.map((block) => letters.get(block.id) ?? block.id),
    };
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
