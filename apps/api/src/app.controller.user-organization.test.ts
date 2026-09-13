import {
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import {
    StoryNotFoundError,
    LabelNotFoundError,
    CollectionNotFoundError,
    AnnotationNotFoundError,
    SavedViewNotFoundError,
    BoardBlockNotFoundError,
    BoardNameConflictError,
    BoardNotFoundError,
    SpotlightPlacementNotFoundError,
} from "@cosmos/application";
import { AppController } from "./app.controller.js";
describe("AppController user organization orchestration", () => {
    function createController(repository: Record<string, unknown>) {
        return new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );
    }

    it("creates a label and returns the label item", async () => {
        const repository = {
            createLabel: vi.fn().mockResolvedValue({
                id: "label-a",
                name: "AI",
                assignedCount: 0,
                createdAt: "2026-09-08T00:00:00.000Z",
                updatedAt: "2026-09-08T00:00:00.000Z",
            }),
        };
        const controller = createController(repository);
        const result = await controller.createLabel({ name: "AI" });
        expect(result).toMatchObject({ id: "label-a", name: "AI" });
        expect(repository.createLabel).toHaveBeenCalledWith({ name: "AI" });
    });

    it("maps missing label/collection targets to 404 and conflicts through the funnel", async () => {
        await expect(createController({
            deleteLabel: vi.fn().mockRejectedValue(new LabelNotFoundError("label-missing")),
        }).deleteLabel("label-missing")).rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({
            deleteCollection: vi.fn().mockRejectedValue(
                new CollectionNotFoundError("collection-missing"),
            ),
        }).deleteCollection("collection-missing")).rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({
            attachLabel: vi.fn().mockRejectedValue(new StoryNotFoundError("story-missing")),
        }).attachLabel({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-missing",
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    it("attaches/detaches labels, toggles collection membership and favorites, returning acks", async () => {
        const repository = {
            attachLabel: vi.fn().mockResolvedValue(undefined),
            detachLabel: vi.fn().mockResolvedValue(undefined),
            addCollectionItem: vi.fn().mockResolvedValue(undefined),
            removeCollectionItem: vi.fn().mockResolvedValue(undefined),
            setFavorite: vi.fn().mockResolvedValue(undefined),
            unsetFavorite: vi.fn().mockResolvedValue(undefined),
            deleteLabel: vi.fn().mockResolvedValue(undefined),
            listCollections: vi.fn().mockResolvedValue({ items: [] }),
        };
        const controller = createController(repository);

        await expect(controller.attachLabel({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-a",
        })).resolves.toMatchObject({ ok: true, action: "label.assigned" });
        await expect(controller.detachLabel({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-a",
        })).resolves.toMatchObject({ action: "label.unassigned" });
        await expect(controller.addCollectionItem("collection-a", { storyId: "story-a" }))
            .resolves.toMatchObject({ action: "collection.item_added" });
        await expect(controller.removeCollectionItem("collection-a", { storyId: "story-a" }))
            .resolves.toMatchObject({ action: "collection.item_removed" });
        await expect(controller.setFavorite({ targetType: "story", targetId: "story-a" }))
            .resolves.toMatchObject({ action: "favorite.set" });
        await expect(controller.unsetFavorite({ targetType: "story", targetId: "story-a" }))
            .resolves.toMatchObject({ action: "favorite.unset" });
        await expect(controller.deleteLabel("label-a"))
            .resolves.toMatchObject({ ok: true, action: "label.deleted" });
    });

    it("rejects malformed user organization commands with 400", async () => {
        const repository = { createLabel: vi.fn(), setFavorite: vi.fn() };
        const controller = createController(repository);
        await expect(controller.createLabel({})).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.setFavorite({ targetType: "story", targetId: 42 }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.attachLabel({
            labelId: "label-a",
            targetType: "workspace",
            targetId: "story-a",
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("creates, updates and deletes annotations through the funnel", async () => {
        const annotation = {
            id: "annotation-a",
            targetType: "story",
            targetId: "story-a",
            targetRevisionId: "rev-s-1",
            quote: null,
            body: "备注",
            evidence: null,
            actor: "user",
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        };
        const repository = {
            createAnnotation: vi.fn().mockResolvedValue(annotation),
            updateAnnotation: vi.fn().mockResolvedValue({ ...annotation, body: "改后" }),
            deleteAnnotation: vi.fn().mockResolvedValue(undefined),
            listAnnotations: vi.fn().mockResolvedValue({ items: [annotation] }),
        };
        const controller = createController(repository);

        await expect(controller.listAnnotations({
            targetType: "story",
            targetId: "story-a",
        })).resolves.toMatchObject({ items: [expect.objectContaining({ id: "annotation-a" })] });
        expect(repository.listAnnotations).toHaveBeenCalledWith({
            targetType: "story",
            targetId: "story-a",
        });

        await expect(controller.createAnnotation({
            targetType: "story",
            targetId: "story-a",
            body: "备注",
            actor: "user",
        })).resolves.toMatchObject({ id: "annotation-a" });
        expect(repository.createAnnotation).toHaveBeenCalledWith({
            targetType: "story",
            targetId: "story-a",
            body: "备注",
            quote: null,
            evidence: null,
            actor: "user",
        });

        await expect(controller.updateAnnotation("annotation-a", { body: "改后" }))
            .resolves.toMatchObject({ body: "改后" });
        await expect(controller.deleteAnnotation("annotation-a"))
            .resolves.toMatchObject({ ok: true, action: "annotation.deleted" });

        await expect(createController({
            updateAnnotation: vi.fn().mockRejectedValue(
                new AnnotationNotFoundError("annotation-missing"),
            ),
        }).updateAnnotation("annotation-missing", { body: "x" }))
            .rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({ createAnnotation: vi.fn() }).createAnnotation({
            targetType: "workspace",
            targetId: "story-a",
            body: "x",
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("creates, updates and deletes saved views", async () => {
        const view = {
            id: "saved-view-a",
            name: "AI 关注",
            text: null,
            sourceId: null,
            publishedAfter: null,
            publishedBefore: null,
            labelIds: ["label-a"],
            topicIds: [],
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        };
        const repository = {
            listSavedViews: vi.fn().mockResolvedValue({ items: [view] }),
            createSavedView: vi.fn().mockResolvedValue(view),
            updateSavedView: vi.fn().mockResolvedValue({ ...view, name: "改" }),
            deleteSavedView: vi.fn().mockResolvedValue(undefined),
        };
        const controller = createController(repository);

        await expect(controller.listSavedViews())
            .resolves.toMatchObject({ items: [expect.objectContaining({ id: "saved-view-a" })] });
        await expect(controller.createSavedView({
            name: "AI 关注",
            conditions: { labelIds: ["label-a"] },
        })).resolves.toMatchObject({ id: "saved-view-a" });
        expect(repository.createSavedView).toHaveBeenCalledWith({
            name: "AI 关注",
            conditions: { labelIds: ["label-a"] },
        });
        await expect(controller.updateSavedView("saved-view-a", { name: "改", conditions: {} }))
            .resolves.toMatchObject({ name: "改" });
        await expect(controller.deleteSavedView("saved-view-a"))
            .resolves.toMatchObject({ ok: true, action: "saved_view.deleted" });

        await expect(createController({
            updateSavedView: vi.fn().mockRejectedValue(
                new SavedViewNotFoundError("saved-view-missing"),
            ),
        }).updateSavedView("saved-view-missing", { name: "x", conditions: {} }))
            .rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({ createSavedView: vi.fn() }).createSavedView({
            name: "",
            conditions: {},
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("seeds, reads and writes boards with tree responses and mapped errors", async () => {
        const block = {
            id: "block-a",
            sectionId: "section-a",
            type: "feed",
            config: {},
            position: 0,
            visible: true,
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        };
        const board = {
            id: "board-a",
            name: "默认看板",
            description: null,
            sections: [{
                id: "section-a",
                boardId: "board-a",
                title: "信息流",
                position: 0,
                blocks: [block],
                createdAt: "2026-09-09T00:00:00.000Z",
                updatedAt: "2026-09-09T00:00:00.000Z",
            }],
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        };
        const placement = {
            id: "placement-a",
            boardId: "board-a",
            targetType: "story",
            targetId: "story-a",
            source: "manual",
            reason: null,
            actor: null,
            expiresAt: null,
            targetTitle: "Story A",
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        };
        const repository = {
            listBoards: vi.fn().mockResolvedValue({ items: [{ ...board, sectionCount: 1 }] }),
            ensureDefaultBoard: vi.fn().mockResolvedValue(board),
            getBoard: vi.fn().mockResolvedValue(board),
            createBoard: vi.fn().mockResolvedValue(board),
            updateBoard: vi.fn().mockResolvedValue(board),
            deleteBoard: vi.fn().mockResolvedValue(undefined),
            createSection: vi.fn().mockResolvedValue(board),
            updateSection: vi.fn().mockResolvedValue(board),
            deleteSection: vi.fn().mockResolvedValue(undefined),
            createBlock: vi.fn().mockResolvedValue(board),
            updateBlockConfig: vi.fn().mockResolvedValue(board),
            moveBlock: vi.fn().mockResolvedValue(board),
            setBlockVisibility: vi.fn().mockResolvedValue(board),
            duplicateBlock: vi.fn().mockResolvedValue(board),
            deleteBlock: vi.fn().mockResolvedValue(undefined),
            listSpotlightPlacements: vi.fn().mockResolvedValue({ items: [placement] }),
            createSpotlightPlacement: vi.fn().mockResolvedValue(placement),
            deleteSpotlightPlacement: vi.fn().mockResolvedValue(undefined),
        };
        const controller = createController(repository);

        await expect(controller.listBoards())
            .resolves.toMatchObject({ items: [expect.objectContaining({ sectionCount: 1 })] });
        await expect(controller.ensureDefaultBoard())
            .resolves.toMatchObject({ id: "board-a" });
        await expect(controller.board("board-a"))
            .resolves.toMatchObject({ sections: [expect.objectContaining({ title: "信息流" })] });

        await controller.createBoard({ name: "工作", description: null });
        expect(repository.createBoard).toHaveBeenCalledWith({ name: "工作", description: null });
        await controller.updateBoard("board-a", { name: "改" });
        expect(repository.updateBoard).toHaveBeenCalledWith({ boardId: "board-a", name: "改" });
        await expect(controller.deleteBoard("board-a"))
            .resolves.toMatchObject({ ok: true, action: "board.deleted" });

        await controller.createBoardSection({ boardId: "board-a", title: "热点" });
        expect(repository.createSection).toHaveBeenCalledWith({ boardId: "board-a", title: "热点" });
        await controller.updateBoardSection("section-a", { title: "改" });
        expect(repository.updateSection).toHaveBeenCalledWith({
            sectionId: "section-a",
            title: "改",
            position: null,
        });
        await expect(controller.deleteBoardSection("section-a"))
            .resolves.toMatchObject({ action: "board_section.deleted" });

        await controller.createBoardBlock({
            sectionId: "section-a",
            type: "feed",
            config: { savedViewId: "view-a" },
        });
        expect(repository.createBlock).toHaveBeenCalledWith({
            sectionId: "section-a",
            type: "feed",
            config: { savedViewId: "view-a" },
        });
        await controller.updateBoardBlockConfig("block-a", { config: { limit: 5 } });
        expect(repository.updateBlockConfig).toHaveBeenCalledWith({
            blockId: "block-a",
            config: { limit: 5 },
        });
        await controller.moveBoardBlock("block-a", { position: 1 });
        expect(repository.moveBlock).toHaveBeenCalledWith({ blockId: "block-a", position: 1 });
        await controller.setBoardBlockVisibility("block-a", { visible: false });
        expect(repository.setBlockVisibility).toHaveBeenCalledWith({
            blockId: "block-a",
            visible: false,
        });
        await expect(controller.duplicateBoardBlock("block-a")).resolves.toMatchObject({ id: "board-a" });
        await expect(controller.deleteBoardBlock("block-a"))
            .resolves.toMatchObject({ action: "board_block.deleted" });

        // Missing resources map to 404 and unknown block types to 400.
        await expect(createController({ getBoard: vi.fn().mockResolvedValue(null) }).board("missing"))
            .rejects.toBeInstanceOf(NotFoundException);
        await expect(createController({
            updateBoard: vi.fn().mockRejectedValue(new BoardNotFoundError("missing")),
        }).updateBoard("missing", { name: "x" })).rejects.toBeInstanceOf(NotFoundException);
        await expect(createController({
            createBoard: vi.fn().mockRejectedValue(new BoardNameConflictError("工作")),
        }).createBoard({ name: "工作" })).rejects.toBeInstanceOf(ConflictException);
        await expect(createController({ createBlock: vi.fn() }).createBoardBlock({
            sectionId: "section-a",
            type: "gadget",
            config: {},
        })).rejects.toBeInstanceOf(BadRequestException);
        await expect(createController({
            updateBlockConfig: vi.fn().mockRejectedValue(new BoardBlockNotFoundError("missing")),
        }).updateBoardBlockConfig("missing", { config: {} }))
            .rejects.toBeInstanceOf(NotFoundException);

        await expect(controller.listSpotlightPlacements("board-a"))
            .resolves.toMatchObject({ items: [expect.objectContaining({ targetTitle: "Story A" })] });
        expect(repository.listSpotlightPlacements).toHaveBeenCalledWith({ boardId: "board-a" });
        await expect(controller.pinSpotlight({
            boardId: "board-a",
            targetType: "story",
            targetId: "story-a",
        })).resolves.toMatchObject({ id: "placement-a" });
        await expect(controller.unpinSpotlight("placement-a"))
            .resolves.toMatchObject({ action: "spotlight_placement.deleted" });
        await expect(createController({ pinSpotlight: undefined, createSpotlightPlacement: vi.fn() })
            .pinSpotlight({
                boardId: "board-a",
                targetType: "workspace",
                targetId: "x",
            })).rejects.toBeInstanceOf(BadRequestException);
        await expect(createController({
            deleteSpotlightPlacement: vi.fn().mockRejectedValue(
                new SpotlightPlacementNotFoundError("missing"),
            ),
        }).unpinSpotlight("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
});
