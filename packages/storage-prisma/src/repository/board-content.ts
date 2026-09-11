import { type BoardBlock, type BoardDetail, type SpotlightPlacement, type SpotlightPlacementList } from "@cosmos/contracts";
import { type BlockType, type SpotlightTargetType } from "@cosmos/domain";
import { BoardBlockNotFoundError, BoardNotFoundError, BoardSectionNotFoundError, SpotlightPlacementNotFoundError, StoryNotFoundError, TopicNotFoundError } from "@cosmos/application";
import { appendDomainEvent, stringifyBlockConfig, toSpotlightPlacement } from "./repository-internals.js";
import { PrismaCosmosRepositoryViews } from "./views.js";

export class PrismaCosmosRepositoryBoardContent extends PrismaCosmosRepositoryViews {
    async createSection(input: {
        boardId: string;
        title: string;
        position?: number | null;
    }): Promise<BoardDetail> {
        await this.prisma.$transaction(async (tx) => {
            const board = await tx.board.findUnique({
                where: { id: input.boardId },
                select: { id: true },
            });
            if (!board) {
                throw new BoardNotFoundError(input.boardId);
            }
            const last = await tx.boardSection.aggregate({
                where: { boardId: input.boardId },
                _max: { position: true },
            });
            const position = input.position ?? (last._max.position ?? -1) + 1;
            await tx.boardSection.updateMany({
                where: { boardId: input.boardId, position: { gte: position } },
                data: { position: { increment: 1 } },
            });
            const row = await tx.boardSection.create({
                data: { boardId: input.boardId, title: input.title, position },
            });
            await appendDomainEvent(tx, {
                type: "board.section.created.v1",
                aggregateType: "BoardSection",
                aggregateId: row.id,
                payload: { boardId: input.boardId, sectionId: row.id, title: row.title },
            });
        });
        return this.requireBoardDetail(input.boardId);
    }

    async updateSection(input: {
        sectionId: string;
        title: string;
        position?: number | null;
    }): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardSection.findUnique({
                where: { id: input.sectionId },
                select: { boardId: true, position: true },
            });
            if (!existing) {
                throw new BoardSectionNotFoundError(input.sectionId);
            }
            if (input.position != null && input.position !== existing.position) {
                // Re-sequence the board in memory and write back only changed
                // rows, same shape as moveBlock.
                const sections = await tx.boardSection.findMany({
                    where: { boardId: existing.boardId },
                    orderBy: { position: "asc" },
                });
                const others = sections.filter((section) => section.id !== input.sectionId);
                const insertAt = Math.min(Math.max(input.position, 0), others.length);
                const positionById = new Map(others.map((section) => [section.id, section.position]));
                const orderedIds = others.map((section) => section.id);
                orderedIds.splice(insertAt, 0, input.sectionId);
                for (const [index, id] of orderedIds.entries()) {
                    if (id === input.sectionId) {
                        await tx.boardSection.update({
                            where: { id },
                            data: { position: index },
                        });
                        continue;
                    }
                    if (positionById.get(id) !== index) {
                        await tx.boardSection.update({
                            where: { id },
                            data: { position: index },
                        });
                    }
                }
            }
            await tx.boardSection.update({
                where: { id: input.sectionId },
                data: { title: input.title },
            });
            await appendDomainEvent(tx, {
                type: "board.section.updated.v1",
                aggregateType: "BoardSection",
                aggregateId: input.sectionId,
                payload: { sectionId: input.sectionId, title: input.title },
            });
            return existing.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async deleteSection(sectionId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardSection.findUnique({
                where: { id: sectionId },
                select: { id: true },
            });
            if (!existing) {
                throw new BoardSectionNotFoundError(sectionId);
            }
            await tx.boardSection.delete({ where: { id: sectionId } });
            await appendDomainEvent(tx, {
                type: "board.section.deleted.v1",
                aggregateType: "BoardSection",
                aggregateId: sectionId,
                payload: { sectionId },
            });
        });
    }

    async createBlock(input: {
        sectionId: string;
        type: BlockType;
        config: Record<string, unknown>;
        position?: number | null;
    }): Promise<BoardDetail> {
        const configJson = stringifyBlockConfig(input.type, input.config);
        const boardId = await this.prisma.$transaction(async (tx) => {
            const section = await tx.boardSection.findUnique({
                where: { id: input.sectionId },
                select: { boardId: true },
            });
            if (!section) {
                throw new BoardSectionNotFoundError(input.sectionId);
            }
            const last = await tx.boardBlock.aggregate({
                where: { sectionId: input.sectionId },
                _max: { position: true },
            });
            const position = input.position ?? (last._max.position ?? -1) + 1;
            await tx.boardBlock.updateMany({
                where: { sectionId: input.sectionId, position: { gte: position } },
                data: { position: { increment: 1 } },
            });
            const row = await tx.boardBlock.create({
                data: {
                    sectionId: input.sectionId,
                    type: input.type,
                    configJson,
                    position,
                },
            });
            await appendDomainEvent(tx, {
                type: "board.block.created.v1",
                aggregateType: "BoardBlock",
                aggregateId: row.id,
                payload: {
                    sectionId: input.sectionId,
                    blockId: row.id,
                    blockType: input.type,
                },
            });
            return section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async updateBlockConfig(input: {
        blockId: string;
        config: Record<string, unknown>;
    }): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardBlock.findUnique({
                where: { id: input.blockId },
                select: { type: true, section: { select: { boardId: true } } },
            });
            if (!existing) {
                throw new BoardBlockNotFoundError(input.blockId);
            }
            const configJson = stringifyBlockConfig(existing.type, input.config);
            await tx.boardBlock.update({
                where: { id: input.blockId },
                data: { configJson },
            });
            await appendDomainEvent(tx, {
                type: "board.block.config_updated.v1",
                aggregateType: "BoardBlock",
                aggregateId: input.blockId,
                payload: { blockId: input.blockId, blockType: existing.type },
            });
            return existing.section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async setBlockVisibility(input: {
        blockId: string;
        visible: boolean;
    }): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardBlock.findUnique({
                where: { id: input.blockId },
                select: { section: { select: { boardId: true } } },
            });
            if (!existing) {
                throw new BoardBlockNotFoundError(input.blockId);
            }
            // Hidden ≠ deleted: the row stays so the block can be restored.
            await tx.boardBlock.update({
                where: { id: input.blockId },
                data: { visible: input.visible },
            });
            await appendDomainEvent(tx, {
                type: "board.block.visibility_updated.v1",
                aggregateType: "BoardBlock",
                aggregateId: input.blockId,
                payload: { blockId: input.blockId, visible: input.visible },
            });
            return existing.section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async duplicateBlock(blockId: string): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const original = await tx.boardBlock.findUnique({
                where: { id: blockId },
                select: {
                    position: true,
                    sectionId: true,
                    type: true,
                    configJson: true,
                    section: { select: { boardId: true } },
                },
            });
            if (!original) {
                throw new BoardBlockNotFoundError(blockId);
            }
            // Free the slot right after the original, then copy into it.
            await tx.boardBlock.updateMany({
                where: { sectionId: original.sectionId, position: { gte: original.position + 1 } },
                data: { position: { increment: 1 } },
            });
            const row = await tx.boardBlock.create({
                data: {
                    sectionId: original.sectionId,
                    type: original.type,
                    configJson: original.configJson,
                    position: original.position + 1,
                },
            });
            await appendDomainEvent(tx, {
                type: "board.block.duplicated.v1",
                aggregateType: "BoardBlock",
                aggregateId: row.id,
                payload: {
                    sourceBlockId: blockId,
                    blockId: row.id,
                    blockType: original.type,
                },
            });
            return original.section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async deleteBlock(blockId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardBlock.findUnique({
                where: { id: blockId },
                select: { id: true },
            });
            if (!existing) {
                throw new BoardBlockNotFoundError(blockId);
            }
            await tx.boardBlock.delete({ where: { id: blockId } });
            await appendDomainEvent(tx, {
                type: "board.block.deleted.v1",
                aggregateType: "BoardBlock",
                aggregateId: blockId,
                payload: { blockId },
            });
        });
    }

    async listSpotlightPlacements(query: {
        boardId?: string | null;
    } = {}): Promise<SpotlightPlacementList> {
        const rows = await this.prisma.spotlightPlacement.findMany({
            where: query.boardId ? { boardId: query.boardId } : undefined,
            orderBy: { createdAt: "asc" },
        });
        const storyIds = rows
            .filter((row) => row.targetType === "story")
            .map((row) => row.targetId);
        const topicIds = rows
            .filter((row) => row.targetType === "topic")
            .map((row) => row.targetId);
        const [stories, topics] = await Promise.all([
            this.prisma.story.findMany({
                where: { id: { in: storyIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
            this.prisma.topic.findMany({
                where: { id: { in: topicIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
        ]);
        const storyTitles = new Map(
            stories.map((story) => [story.id, story.currentRevision?.title ?? null]),
        );
        const topicTitles = new Map(
            topics.map((topic) => [topic.id, topic.currentRevision?.title ?? null]),
        );
        return {
            items: rows.map((row) => toSpotlightPlacement(row, row.targetType === "story"
                ? storyTitles.get(row.targetId) ?? null
                : row.targetType === "topic"
                    ? topicTitles.get(row.targetId) ?? null
                    : null)),
        };
    }

    async createSpotlightPlacement(input: {
        boardId: string;
        targetType: SpotlightTargetType;
        targetId: string;
        reason?: string | null;
        actor?: string | null;
    }): Promise<SpotlightPlacement> {
        const canonicalTargetId = input.targetType === "story"
            ? await this.resolveCanonicalStoryId(input.targetId)
            : await this.resolveCanonicalTopicId(input.targetId);
        if (!canonicalTargetId) {
            throw input.targetType === "story"
                ? new StoryNotFoundError(input.targetId)
                : new TopicNotFoundError(input.targetId);
        }
        const row = await this.prisma.$transaction(async (tx) => {
            const board = await tx.board.findUnique({
                where: { id: input.boardId },
                select: { id: true },
            });
            if (!board) {
                throw new BoardNotFoundError(input.boardId);
            }
            const existing = await tx.spotlightPlacement.findUnique({
                where: {
                    boardId_targetType_targetId: {
                        boardId: input.boardId,
                        targetType: input.targetType,
                        targetId: canonicalTargetId,
                    },
                },
            });
            // Pinning the same target on the same board is an idempotent no-op.
            if (existing) {
                return existing;
            }
            const created = await tx.spotlightPlacement.create({
                data: {
                    boardId: input.boardId,
                    targetType: input.targetType,
                    targetId: canonicalTargetId,
                    source: "manual",
                    reason: input.reason ?? null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                },
            });
            await appendDomainEvent(tx, {
                type: "spotlight.placement_created.v1",
                aggregateType: "SpotlightPlacement",
                aggregateId: created.id,
                payload: {
                    placementId: created.id,
                    boardId: created.boardId,
                    targetType: created.targetType,
                    targetId: created.targetId,
                },
            });
            return created;
        });
        const targetTitle = await this.loadSpotlightTargetTitle(
            row.targetType,
            row.targetId,
        );
        return toSpotlightPlacement(row, targetTitle);
    }

    async deleteSpotlightPlacement(placementId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.spotlightPlacement.findUnique({
                where: { id: placementId },
                select: { id: true },
            });
            if (!existing) {
                throw new SpotlightPlacementNotFoundError(placementId);
            }
            await tx.spotlightPlacement.delete({ where: { id: placementId } });
            await appendDomainEvent(tx, {
                type: "spotlight.placement_deleted.v1",
                aggregateType: "SpotlightPlacement",
                aggregateId: placementId,
                payload: { placementId },
            });
        });
    }

}
