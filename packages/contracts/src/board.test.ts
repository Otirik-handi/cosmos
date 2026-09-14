import { describe, expect, it } from "vitest";

import {
    blockConfigSchemaFor,
    boardBlockSchema,
    boardCommandAckSchema,
    boardDetailSchema,
    createBlockCommandSchema,
    pinSpotlightCommandSchema,
    spotlightPlacementSchema,
} from "./index.js";

describe("board contracts", () => {
    it("enforces the block type enum on write commands and degrades unknown types on read", () => {
        expect(() => createBlockCommandSchema.parse({
            sectionId: "section-1",
            type: "gadget",
            config: {},
        })).toThrow();

        const block = boardBlockSchema.parse({
            id: "block-1",
            sectionId: "section-1",
            type: "gadget",
            config: { anything: true },
            position: 0,
            visible: true,
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        });
        expect(block.type).toBe("gadget");
    });

    it("validates per-type block config whitelists through blockConfigSchemaFor", () => {
        const feed = blockConfigSchemaFor("feed");
        expect(feed?.parse({ savedViewId: "view-1", limit: 5 })).toEqual({
            savedViewId: "view-1",
            limit: 5,
        });
        // Binding is optional (BRD-006 "可绑定"): an unbound feed block is valid.
        expect(feed?.parse({})).toEqual({});
        expect(() => feed!.parse({ savedViewId: "view-1", rogue: true })).toThrow();

        const collection = blockConfigSchemaFor("collection");
        // Binding is optional (created unbound, configured later).
        expect(collection!.parse({})).toEqual({});
        expect(collection!.parse({ collectionId: "collection-1" })).toEqual({
            collectionId: "collection-1",
        });
        expect(() => collection!.parse({ collectionId: "" })).toThrow();

        expect(blockConfigSchemaFor("gadget")).toBeNull();
    });

    it("parses the board detail tree and command acks", () => {
        const detail = boardDetailSchema.parse({
            id: "board-1",
            name: "默认看板",
            description: null,
            sections: [{
                id: "section-1",
                boardId: "board-1",
                title: "热点",
                position: 0,
                blocks: [{
                    id: "block-1",
                    sectionId: "section-1",
                    type: "spotlight",
                    config: {},
                    position: 0,
                    visible: true,
                    createdAt: "2026-09-09T00:00:00.000Z",
                    updatedAt: "2026-09-09T00:00:00.000Z",
                }],
                createdAt: "2026-09-09T00:00:00.000Z",
                updatedAt: "2026-09-09T00:00:00.000Z",
            }],
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        });
        expect(detail.sections[0]!.blocks[0]!.type).toBe("spotlight");

        expect(boardCommandAckSchema.parse({ ok: true, id: "board-1", action: "board.deleted" }))
            .toEqual({ ok: true, id: "board-1", action: "board.deleted" });
        expect(() => boardCommandAckSchema.parse({ ok: false, id: "board-1", action: "x" }))
            .toThrow();
    });
});

describe("spotlight placement contracts", () => {
    it("restricts write-side targets to story/topic and parses placements", () => {
        expect(() => pinSpotlightCommandSchema.parse({
            boardId: "board-1",
            targetType: "workspace",
            targetId: "x",
        })).toThrow();
        const command = pinSpotlightCommandSchema.parse({
            boardId: "board-1",
            targetType: "topic",
            targetId: "topic-1",
            reason: "关注",
        });
        expect(command.targetType).toBe("topic");

        const placement = spotlightPlacementSchema.parse({
            id: "placement-1",
            boardId: "board-1",
            targetType: "story",
            targetId: "story-1",
            source: "manual",
            reason: null,
            actor: null,
            expiresAt: null,
            targetTitle: "Story 1",
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        });
        expect(placement.targetTitle).toBe("Story 1");
        // Read-side targetType stays permissive for future kinds.
        expect(spotlightPlacementSchema.parse({
            ...placement,
            targetType: "workspace",
        }).targetType).toBe("workspace");
    });
});
