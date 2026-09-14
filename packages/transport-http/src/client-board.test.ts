import { describe, expect, it } from "vitest";

import {
    HttpCosmosClient,
    type CosmosEventSource,
} from "./index.js";

describe("HttpCosmosClient 看板", () => {
    it("calls board endpoints and validates block config through the client", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const board = {
            id: "board-a",
            name: "默认看板",
            description: null,
            sections: [{
                id: "section-a",
                boardId: "board-a",
                title: "信息流",
                position: 0,
                blocks: [{
                    id: "block-a",
                    sectionId: "section-a",
                    type: "feed",
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
        };
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                const url = String(input);
                let body: unknown;
                if (url.endsWith("/api/v1/boards/ensure-default")) {
                    body = board;
                } else if (url.endsWith("/api/v1/boards")) {
                    body = { items: [{ ...board, sectionCount: 1 }] };
                } else if (url.endsWith("/api/v1/board-blocks/block-a/moves")) {
                    body = board;
                } else if (url.endsWith("/api/v1/board-blocks/block-a")) {
                    body = board;
                } else {
                    throw new Error(`Unexpected request: ${url}`);
                }
                return new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const seeded = await client.ensureDefaultBoard();
        expect(seeded.sections[0]?.blocks[0]?.type).toBe("feed");
        expect(requests[0]?.init).toMatchObject({ method: "POST" });

        const list = await client.listBoards();
        expect(list.items[0]?.sectionCount).toBe(1);

        await client.moveBoardBlock("block-a", { sectionId: "section-a", position: 0 });
        expect(requests[2]?.url)
            .toBe("http://localhost:4310/api/v1/board-blocks/block-a/moves");

        // The client-side command schema rejects an unknown block type before
        // any request; per-type config whitelisting stays at the API/storage
        // boundary where the stored block type is known.
        const before = requests.length;
        await expect(client.createBoardBlock({
            sectionId: "section-a",
            type: "gadget" as never,
            config: {},
        })).rejects.toThrow();
        expect(requests.length).toBe(before);
    });

    it("calls spotlight placement endpoints", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
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
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                const url = String(input);
                let body: unknown;
                if (url.endsWith("/api/v1/spotlight-placements/placement-a/removals")) {
                    body = { ok: true, id: "placement-a", action: "spotlight_placement.deleted" };
                } else if (url.includes("/api/v1/spotlight-placements")) {
                    body = (init?.method ?? "GET") === "POST"
                        ? placement
                        : { items: [placement] };
                } else {
                    throw new Error(`Unexpected request: ${url}`);
                }
                return new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const list = await client.listSpotlightPlacements({ boardId: "board-a" });
        expect(list.items[0]?.targetTitle).toBe("Story A");
        expect(requests[0]?.url)
            .toBe("http://localhost:4310/api/v1/spotlight-placements?boardId=board-a");

        const pinned = await client.pinSpotlight({
            boardId: "board-a",
            targetType: "story",
            targetId: "story-a",
        });
        expect(pinned.id).toBe("placement-a");
        expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
            boardId: "board-a",
            targetType: "story",
            targetId: "story-a",
        });

        const unpinned = await client.unpinSpotlight("placement-a");
        expect(unpinned.action).toBe("spotlight_placement.deleted");
    });
});
