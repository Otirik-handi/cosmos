import {
    boardCommandAckSchema,
    boardDetailSchema,
    boardListSchema,
    createBlockCommandSchema,
    createBoardCommandSchema,
    createSectionCommandSchema,
    moveBlockCommandSchema,
    setBlockVisibilityCommandSchema,
    updateBlockConfigCommandSchema,
    updateBoardCommandSchema,
    updateSectionCommandSchema,
    pinSpotlightCommandSchema,
    spotlightPlacementListSchema,
    spotlightPlacementSchema,
    type BoardCommandAck,
    type BoardDetail,
    type BoardList,
    type CreateBlockCommand,
    type CreateBoardCommand,
    type CreateSectionCommand,
    type MoveBlockCommand,
    type SetBlockVisibilityCommand,
    type UpdateBlockConfigCommand,
    type UpdateBoardCommand,
    type UpdateSectionCommand,
    type PinSpotlightCommand,
    type SpotlightPlacement,
    type SpotlightPlacementList,
} from "@cosmos/contracts";

import { OrganizationClient } from "./client-organization.js";
import type {
    CosmosEventSource,
    HttpCosmosClientOptions,
} from "./types.js";
import { CosmosTransportError } from "./types.js";
export class BoardClient extends OrganizationClient {
    async listBoards(): Promise<BoardList> {
        return this.request("/api/v1/boards", {
            schema: boardListSchema,
        });
    }

    async getBoard(boardId: string): Promise<BoardDetail> {
        return this.request(`/api/v1/boards/${encodeURIComponent(boardId)}`, {
            schema: boardDetailSchema,
        });
    }

    async ensureDefaultBoard(): Promise<BoardDetail> {
        return this.request("/api/v1/boards/ensure-default", {
            method: "POST",
            schema: boardDetailSchema,
        });
    }

    async createBoard(input: CreateBoardCommand): Promise<BoardDetail> {
        const payload = createBoardCommandSchema.parse(input);
        return this.request("/api/v1/boards", {
            method: "POST",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async updateBoard(
        boardId: string,
        input: UpdateBoardCommand,
    ): Promise<BoardDetail> {
        const payload = updateBoardCommandSchema.parse(input);
        return this.request(`/api/v1/boards/${encodeURIComponent(boardId)}`, {
            method: "PATCH",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async deleteBoard(boardId: string): Promise<BoardCommandAck> {
        return this.request(`/api/v1/boards/${encodeURIComponent(boardId)}/removals`, {
            method: "POST",
            schema: boardCommandAckSchema,
        });
    }

    async createBoardSection(input: CreateSectionCommand): Promise<BoardDetail> {
        const payload = createSectionCommandSchema.parse(input);
        return this.request("/api/v1/board-sections", {
            method: "POST",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async updateBoardSection(
        sectionId: string,
        input: UpdateSectionCommand,
    ): Promise<BoardDetail> {
        const payload = updateSectionCommandSchema.parse(input);
        return this.request(
            `/api/v1/board-sections/${encodeURIComponent(sectionId)}`,
            {
                method: "PATCH",
                body: payload,
                schema: boardDetailSchema,
            },
        );
    }

    async deleteBoardSection(sectionId: string): Promise<BoardCommandAck> {
        return this.request(
            `/api/v1/board-sections/${encodeURIComponent(sectionId)}/removals`,
            {
                method: "POST",
                schema: boardCommandAckSchema,
            },
        );
    }

    async createBoardBlock(input: CreateBlockCommand): Promise<BoardDetail> {
        const payload = createBlockCommandSchema.parse(input);
        return this.request("/api/v1/board-blocks", {
            method: "POST",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async updateBoardBlockConfig(
        blockId: string,
        input: UpdateBlockConfigCommand,
    ): Promise<BoardDetail> {
        const payload = updateBlockConfigCommandSchema.parse(input);
        return this.request(`/api/v1/board-blocks/${encodeURIComponent(blockId)}`, {
            method: "PATCH",
            body: payload,
            schema: boardDetailSchema,
        });
    }

    async moveBoardBlock(
        blockId: string,
        input: MoveBlockCommand,
    ): Promise<BoardDetail> {
        const payload = moveBlockCommandSchema.parse(input);
        return this.request(
            `/api/v1/board-blocks/${encodeURIComponent(blockId)}/moves`,
            {
                method: "POST",
                body: payload,
                schema: boardDetailSchema,
            },
        );
    }

    async setBoardBlockVisibility(
        blockId: string,
        input: SetBlockVisibilityCommand,
    ): Promise<BoardDetail> {
        const payload = setBlockVisibilityCommandSchema.parse(input);
        return this.request(
            `/api/v1/board-blocks/${encodeURIComponent(blockId)}/visibility`,
            {
                method: "POST",
                body: payload,
                schema: boardDetailSchema,
            },
        );
    }

    async duplicateBoardBlock(blockId: string): Promise<BoardDetail> {
        return this.request(
            `/api/v1/board-blocks/${encodeURIComponent(blockId)}/duplications`,
            {
                method: "POST",
                schema: boardDetailSchema,
            },
        );
    }

    async deleteBoardBlock(blockId: string): Promise<BoardCommandAck> {
        return this.request(
            `/api/v1/board-blocks/${encodeURIComponent(blockId)}/removals`,
            {
                method: "POST",
                schema: boardCommandAckSchema,
            },
        );
    }

    async listSpotlightPlacements(query: {
        boardId?: string;
    } = {}): Promise<SpotlightPlacementList> {
        const params = new URLSearchParams();
        if (query.boardId) {
            params.set("boardId", query.boardId);
        }
        const suffix = params.toString();
        return this.request(
            `/api/v1/spotlight-placements${suffix ? `?${suffix}` : ""}`,
            { schema: spotlightPlacementListSchema },
        );
    }

    async pinSpotlight(input: PinSpotlightCommand): Promise<SpotlightPlacement> {
        const payload = pinSpotlightCommandSchema.parse(input);
        return this.request("/api/v1/spotlight-placements", {
            method: "POST",
            body: payload,
            schema: spotlightPlacementSchema,
        });
    }

    async unpinSpotlight(placementId: string): Promise<BoardCommandAck> {
        return this.request(
            `/api/v1/spotlight-placements/${encodeURIComponent(placementId)}/removals`,
            {
                method: "POST",
                schema: boardCommandAckSchema,
            },
        );
    }
}
