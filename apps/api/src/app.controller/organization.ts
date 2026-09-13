import {
    Bind,
    Get,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    Body,
} from "@nestjs/common";
import {
    createLabelCommandSchema,
    labelAssignmentCommandSchema,
    createCollectionCommandSchema,
    updateCollectionCommandSchema,
    collectionItemCommandSchema,
    favoriteCommandSchema,
    createAnnotationCommandSchema,
    updateAnnotationCommandSchema,
    annotationTargetQuerySchema,
    createSavedViewCommandSchema,
    updateSavedViewCommandSchema,
    createBlockCommandSchema,
    createBoardCommandSchema,
    createSectionCommandSchema,
    moveBlockCommandSchema,
    setBlockVisibilityCommandSchema,
    updateBlockConfigCommandSchema,
    updateBoardCommandSchema,
    updateSectionCommandSchema,
    pinSpotlightCommandSchema,
} from "@cosmos/contracts";
import "reflect-metadata";
import { AppControllerContent } from "./content.js";
import { sourceCommandError } from "./internals.js";

export class AppControllerOrganization extends AppControllerContent {
    // ---- User organization v1 (ADR-0009): Label / Collection / Favorite ----

    @Get("labels")
    async listLabels() {
        return this.repository.listLabels();
    }

    @Get("labels/:labelId")
    @Bind(Param("labelId"))
    async label(labelId: string) {
        const result = await this.repository.label(labelId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Label not found: ${labelId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("labels")
    @Bind(Body())
    async createLabel(body: unknown) {
        try {
            const parsed = createLabelCommandSchema.parse(body);
            return await this.repository.createLabel({ name: parsed.name });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("labels/:labelId/removals")
    @Bind(Param("labelId"))
    async deleteLabel(labelId: string) {
        try {
            await this.repository.deleteLabel(labelId);
            return { ok: true, id: labelId, action: "label.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("label-assignments")
    @Bind(Body())
    async attachLabel(body: unknown) {
        try {
            const parsed = labelAssignmentCommandSchema.parse(body);
            await this.repository.attachLabel({
                labelId: parsed.labelId,
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
            return { ok: true, id: parsed.labelId, action: "label.assigned" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("label-assignments/removals")
    @Bind(Body())
    async detachLabel(body: unknown) {
        try {
            const parsed = labelAssignmentCommandSchema.parse(body);
            await this.repository.detachLabel({
                labelId: parsed.labelId,
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
            return { ok: true, id: parsed.labelId, action: "label.unassigned" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("collections")
    @Bind(Query("storyId"))
    async listCollections(storyId?: string) {
        return this.repository.listCollections(storyId ? { storyId } : {});
    }

    @Get("collections/:collectionId")
    @Bind(Param("collectionId"))
    async collection(collectionId: string) {
        const result = await this.repository.collection(collectionId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Collection not found: ${collectionId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("collections")
    @Bind(Body())
    async createCollection(body: unknown) {
        try {
            const parsed = createCollectionCommandSchema.parse(body);
            return await this.repository.createCollection({
                name: parsed.name,
                description: parsed.description ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("collections/:collectionId")
    @Bind(Param("collectionId"), Body())
    async updateCollection(collectionId: string, body: unknown) {
        try {
            const parsed = updateCollectionCommandSchema.parse(body);
            return await this.repository.updateCollection({
                collectionId,
                name: parsed.name,
                description: parsed.description ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("collections/:collectionId/removals")
    @Bind(Param("collectionId"))
    async deleteCollection(collectionId: string) {
        try {
            await this.repository.deleteCollection(collectionId);
            return { ok: true, id: collectionId, action: "collection.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("collections/:collectionId/items")
    @Bind(Param("collectionId"), Body())
    async addCollectionItem(collectionId: string, body: unknown) {
        try {
            const parsed = collectionItemCommandSchema.parse(body);
            await this.repository.addCollectionItem({
                collectionId,
                storyId: parsed.storyId,
            });
            return { ok: true, id: collectionId, action: "collection.item_added" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("collections/:collectionId/items/removals")
    @Bind(Param("collectionId"), Body())
    async removeCollectionItem(collectionId: string, body: unknown) {
        try {
            const parsed = collectionItemCommandSchema.parse(body);
            await this.repository.removeCollectionItem({
                collectionId,
                storyId: parsed.storyId,
            });
            return { ok: true, id: collectionId, action: "collection.item_removed" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("favorites")
    async listFavorites() {
        return this.repository.listFavorites();
    }

    @Post("favorites")
    @Bind(Body())
    async setFavorite(body: unknown) {
        try {
            const parsed = favoriteCommandSchema.parse(body);
            await this.repository.setFavorite({
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
            return { ok: true, id: parsed.targetId, action: "favorite.set" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("favorites/removals")
    @Bind(Body())
    async unsetFavorite(body: unknown) {
        try {
            const parsed = favoriteCommandSchema.parse(body);
            await this.repository.unsetFavorite({
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
            return { ok: true, id: parsed.targetId, action: "favorite.unset" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("annotations")
    @Bind(Query())
    async listAnnotations(query: Record<string, unknown>) {
        try {
            const parsed = annotationTargetQuerySchema.parse(query);
            return await this.repository.listAnnotations({
                targetType: parsed.targetType,
                targetId: parsed.targetId,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("annotations")
    @Bind(Body())
    async createAnnotation(body: unknown) {
        try {
            const parsed = createAnnotationCommandSchema.parse(body);
            return await this.repository.createAnnotation({
                targetType: parsed.targetType,
                targetId: parsed.targetId,
                body: parsed.body,
                quote: parsed.quote ?? null,
                evidence: parsed.evidence ?? null,
                actor: parsed.actor ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("annotations/:annotationId")
    @Bind(Param("annotationId"), Body())
    async updateAnnotation(annotationId: string, body: unknown) {
        try {
            const parsed = updateAnnotationCommandSchema.parse(body);
            return await this.repository.updateAnnotation({
                annotationId,
                body: parsed.body,
                quote: parsed.quote ?? null,
                evidence: parsed.evidence ?? null,
                actor: parsed.actor ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("annotations/:annotationId/removals")
    @Bind(Param("annotationId"))
    async deleteAnnotation(annotationId: string) {
        try {
            await this.repository.deleteAnnotation(annotationId);
            return { ok: true, id: annotationId, action: "annotation.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("saved-views")
    async listSavedViews() {
        return this.repository.listSavedViews();
    }

    @Post("saved-views")
    @Bind(Body())
    async createSavedView(body: unknown) {
        try {
            const parsed = createSavedViewCommandSchema.parse(body);
            return await this.repository.createSavedView({
                name: parsed.name,
                conditions: parsed.conditions,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("saved-views/:savedViewId")
    @Bind(Param("savedViewId"), Body())
    async updateSavedView(savedViewId: string, body: unknown) {
        try {
            const parsed = updateSavedViewCommandSchema.parse(body);
            return await this.repository.updateSavedView({
                savedViewId,
                name: parsed.name,
                conditions: parsed.conditions,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("saved-views/:savedViewId/removals")
    @Bind(Param("savedViewId"))
    async deleteSavedView(savedViewId: string) {
        try {
            await this.repository.deleteSavedView(savedViewId);
            return { ok: true, id: savedViewId, action: "saved_view.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    // ------------------------------------------------------------------
    // Configurable dashboard (ADR-0010). Tree writes return the full board
    // detail so a client refreshes from one response; block config whitelist
    // validation happens at the storage boundary and surfaces as 400.
    // ------------------------------------------------------------------

    @Get("boards")
    async listBoards() {
        return this.repository.listBoards();
    }

    @Post("boards/ensure-default")
    async ensureDefaultBoard() {
        try {
            return await this.repository.ensureDefaultBoard();
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("boards/:boardId")
    @Bind(Param("boardId"))
    async board(boardId: string) {
        const result = await this.repository.getBoard(boardId);
        if (!result) {
            throw new NotFoundException({
                code: "not_found",
                message: `Board not found: ${boardId}`,
                retryable: false,
            });
        }
        return result;
    }

    @Post("boards")
    @Bind(Body())
    async createBoard(body: unknown) {
        try {
            const parsed = createBoardCommandSchema.parse(body);
            return await this.repository.createBoard(parsed);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("boards/:boardId")
    @Bind(Param("boardId"), Body())
    async updateBoard(boardId: string, body: unknown) {
        try {
            const parsed = updateBoardCommandSchema.parse(body);
            return await this.repository.updateBoard({ boardId, ...parsed });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("boards/:boardId/removals")
    @Bind(Param("boardId"))
    async deleteBoard(boardId: string) {
        try {
            await this.repository.deleteBoard(boardId);
            return { ok: true, id: boardId, action: "board.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-sections")
    @Bind(Body())
    async createBoardSection(body: unknown) {
        try {
            const parsed = createSectionCommandSchema.parse(body);
            return await this.repository.createSection(parsed);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("board-sections/:sectionId")
    @Bind(Param("sectionId"), Body())
    async updateBoardSection(sectionId: string, body: unknown) {
        try {
            const parsed = updateSectionCommandSchema.parse(body);
            return await this.repository.updateSection({
                sectionId,
                title: parsed.title,
                position: parsed.position ?? null,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-sections/:sectionId/removals")
    @Bind(Param("sectionId"))
    async deleteBoardSection(sectionId: string) {
        try {
            await this.repository.deleteSection(sectionId);
            return { ok: true, id: sectionId, action: "board_section.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks")
    @Bind(Body())
    async createBoardBlock(body: unknown) {
        try {
            const parsed = createBlockCommandSchema.parse(body);
            return await this.repository.createBlock(parsed);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Patch("board-blocks/:blockId")
    @Bind(Param("blockId"), Body())
    async updateBoardBlockConfig(blockId: string, body: unknown) {
        try {
            const parsed = updateBlockConfigCommandSchema.parse(body);
            return await this.repository.updateBlockConfig({
                blockId,
                config: parsed.config,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks/:blockId/moves")
    @Bind(Param("blockId"), Body())
    async moveBoardBlock(blockId: string, body: unknown) {
        try {
            const parsed = moveBlockCommandSchema.parse(body);
            return await this.repository.moveBlock({ blockId, ...parsed });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks/:blockId/visibility")
    @Bind(Param("blockId"), Body())
    async setBoardBlockVisibility(blockId: string, body: unknown) {
        try {
            const parsed = setBlockVisibilityCommandSchema.parse(body);
            return await this.repository.setBlockVisibility({
                blockId,
                visible: parsed.visible,
            });
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks/:blockId/duplications")
    @Bind(Param("blockId"))
    async duplicateBoardBlock(blockId: string) {
        try {
            return await this.repository.duplicateBlock(blockId);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("board-blocks/:blockId/removals")
    @Bind(Param("blockId"))
    async deleteBoardBlock(blockId: string) {
        try {
            await this.repository.deleteBlock(blockId);
            return { ok: true, id: blockId, action: "board_block.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Get("spotlight-placements")
    @Bind(Query("boardId"))
    async listSpotlightPlacements(boardId?: string) {
        return this.repository.listSpotlightPlacements({ boardId: boardId ?? null });
    }

    @Post("spotlight-placements")
    @Bind(Body())
    async pinSpotlight(body: unknown) {
        try {
            const parsed = pinSpotlightCommandSchema.parse(body);
            return await this.repository.createSpotlightPlacement(parsed);
        } catch (error) {
            sourceCommandError(error);
        }
    }

    @Post("spotlight-placements/:placementId/removals")
    @Bind(Param("placementId"))
    async unpinSpotlight(placementId: string) {
        try {
            await this.repository.deleteSpotlightPlacement(placementId);
            return { ok: true, id: placementId, action: "spotlight_placement.deleted" };
        } catch (error) {
            sourceCommandError(error);
        }
    }
}
