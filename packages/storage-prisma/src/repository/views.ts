import { type SavedView, type SavedViewList, type BoardDetail, type BoardList } from "@cosmos/contracts";
import { SavedViewNotFoundError, BoardNameConflictError, BoardNotFoundError } from "@cosmos/application";
import { appendDomainEvent, isUniqueConstraintError, savedViewData, toSavedView } from "./repository-internals.js";
import { PrismaCosmosRepositoryAnnotations } from "./annotations.js";

export class PrismaCosmosRepositoryViews extends PrismaCosmosRepositoryAnnotations {
    async createSavedView(input: {
        name: string;
        conditions: {
            text?: string | null;
            sourceId?: string | null;
            publishedAfter?: string | null;
            publishedBefore?: string | null;
            labelIds?: readonly string[] | null;
            topicIds?: readonly string[] | null;
        };
    }): Promise<SavedView> {
        const data = savedViewData(input.name, input.conditions);
        const created = await this.prisma.$transaction(async (tx) => {
            const row = await tx.savedView.create({ data });
            await appendDomainEvent(tx, {
                type: "saved_view.created.v1",
                aggregateType: "SavedView",
                aggregateId: row.id,
                payload: { savedViewId: row.id, name: row.name },
            });
            return row;
        });
        return toSavedView(created);
    }

    async updateSavedView(input: {
        savedViewId: string;
        name: string;
        conditions: {
            text?: string | null;
            sourceId?: string | null;
            publishedAfter?: string | null;
            publishedBefore?: string | null;
            labelIds?: readonly string[] | null;
            topicIds?: readonly string[] | null;
        };
    }): Promise<SavedView | null> {
        const existing = await this.prisma.savedView.findUnique({
            where: { id: input.savedViewId },
            select: { id: true },
        });
        if (!existing) {
            throw new SavedViewNotFoundError(input.savedViewId);
        }
        const data = savedViewData(input.name, input.conditions);
        const updated = await this.prisma.$transaction(async (tx) => {
            const row = await tx.savedView.update({
                where: { id: input.savedViewId },
                data,
            });
            await appendDomainEvent(tx, {
                type: "saved_view.updated.v1",
                aggregateType: "SavedView",
                aggregateId: input.savedViewId,
                payload: { savedViewId: input.savedViewId, name: row.name },
            });
            return row;
        });
        return toSavedView(updated);
    }

    async deleteSavedView(savedViewId: string): Promise<void> {
        const existing = await this.prisma.savedView.findUnique({
            where: { id: savedViewId },
            select: { id: true },
        });
        if (!existing) {
            throw new SavedViewNotFoundError(savedViewId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.savedView.delete({ where: { id: savedViewId } });
            await appendDomainEvent(tx, {
                type: "saved_view.deleted.v1",
                aggregateType: "SavedView",
                aggregateId: savedViewId,
                payload: { savedViewId },
            });
        });
    }

    async listSavedViews(): Promise<SavedViewList> {
        const rows = await this.prisma.savedView.findMany({
            orderBy: { createdAt: "asc" },
        });
        return { items: rows.map((row) => toSavedView(row)) };
    }

    // ------------------------------------------------------------------
    // Configurable dashboard (ADR-0010). Block config is validated against
    // the contracts whitelist at this boundary too: the API already rejects
    // mismatches as 400s, so a ZodError escaping from here means a bug.
    // ------------------------------------------------------------------

    async listBoards(): Promise<BoardList> {
        const boards = await this.prisma.board.findMany({
            orderBy: { createdAt: "asc" },
            include: { _count: { select: { sections: true } } },
        });
        return {
            items: boards.map((board) => ({
                id: board.id,
                name: board.name,
                description: board.description,
                sectionCount: board._count.sections,
                createdAt: board.createdAt.toISOString(),
                updatedAt: board.updatedAt.toISOString(),
            })),
        };
    }

    async getBoard(boardId: string): Promise<BoardDetail | null> {
        return this.loadBoardDetail(boardId);
    }

    async createBoard(input: {
        name: string;
        description?: string | null;
    }): Promise<BoardDetail> {
        const created = await this.prisma.$transaction(async (tx) => {
            const row = await tx.board.create({
                data: { name: input.name, description: input.description ?? null },
            });
            await appendDomainEvent(tx, {
                type: "board.created.v1",
                aggregateType: "Board",
                aggregateId: row.id,
                payload: { boardId: row.id, name: row.name },
            });
            return row;
        }).catch((error) => {
            if (isUniqueConstraintError(error)) {
                throw new BoardNameConflictError(input.name);
            }
            throw error;
        });
        return this.requireBoardDetail(created.id);
    }

    async updateBoard(input: {
        boardId: string;
        name: string;
        description?: string | null;
    }): Promise<BoardDetail> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.board.findUnique({
                where: { id: input.boardId },
                select: { id: true },
            });
            if (!existing) {
                throw new BoardNotFoundError(input.boardId);
            }
            await tx.board.update({
                where: { id: input.boardId },
                data: { name: input.name, description: input.description ?? null },
            });
            await appendDomainEvent(tx, {
                type: "board.updated.v1",
                aggregateType: "Board",
                aggregateId: input.boardId,
                payload: { boardId: input.boardId, name: input.name },
            });
        }).catch((error) => {
            if (isUniqueConstraintError(error)) {
                throw new BoardNameConflictError(input.name);
            }
            throw error;
        });
        return this.requireBoardDetail(input.boardId);
    }

    async deleteBoard(boardId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.board.findUnique({
                where: { id: boardId },
                select: { id: true },
            });
            if (!existing) {
                throw new BoardNotFoundError(boardId);
            }
            // Cascade removes sections and blocks; content objects are not
            // referenced by FK, so nothing user-owned is deleted (ADR-0010).
            await tx.board.delete({ where: { id: boardId } });
            await appendDomainEvent(tx, {
                type: "board.deleted.v1",
                aggregateType: "Board",
                aggregateId: boardId,
                payload: { boardId },
            });
        });
    }

    async ensureDefaultBoard(): Promise<BoardDetail> {
        const existing = await this.prisma.board.findFirst({
            orderBy: { createdAt: "asc" },
            select: { id: true },
        });
        if (existing) {
            return this.requireBoardDetail(existing.id);
        }
        const created = await this.prisma.$transaction(async (tx) => {
            const board = await tx.board.create({
                data: {
                    name: "默认看板",
                    description: "预置看板：热点、精华、信息流",
                },
            });
            const hotSection = await tx.boardSection.create({
                data: { boardId: board.id, title: "热点", position: 0 },
            });
            await tx.boardBlock.create({
                data: { sectionId: hotSection.id, type: "spotlight", configJson: "{}", position: 0 },
            });
            const curationSection = await tx.boardSection.create({
                data: { boardId: board.id, title: "精华", position: 1 },
            });
            await tx.boardBlock.create({
                data: { sectionId: curationSection.id, type: "topic-list", configJson: "{}", position: 0 },
            });
            const feedSection = await tx.boardSection.create({
                data: { boardId: board.id, title: "信息流", position: 2 },
            });
            await tx.boardBlock.create({
                data: { sectionId: feedSection.id, type: "feed", configJson: "{}", position: 0 },
            });
            // Source health stays visible after the sidebar moved into blocks:
            // it is operational, not content, so it sits below the feed.
            await tx.boardBlock.create({
                data: { sectionId: feedSection.id, type: "source-health", configJson: "{}", position: 1 },
            });
            await appendDomainEvent(tx, {
                type: "board.seeded.v1",
                aggregateType: "Board",
                aggregateId: board.id,
                payload: { boardId: board.id, name: board.name },
            });
            return board;
        }).catch(async (error) => {
            // Concurrent seed: the unique board name resolves the race; fall
            // back to whichever board won.
            if (isUniqueConstraintError(error)) {
                const winner = await this.prisma.board.findFirst({
                    orderBy: { createdAt: "asc" },
                    select: { id: true },
                });
                if (winner) {
                    return winner;
                }
            }
            throw error;
        });
        return this.requireBoardDetail(created.id);
    }

}
