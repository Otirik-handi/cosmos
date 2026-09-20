import { describe, expect, it } from "vitest";

import { HttpCosmosClient } from "./index.js";

/**
 * LIB-001：搜索的三个新过滤维度必须真的走到 HTTP query 上——只加合同字段而客户端
 * 不拼参数，界面上选中的条件会被静默丢掉。
 */
function clientWithCapture(requests: string[]): HttpCosmosClient {
    return new HttpCosmosClient({
        baseUrl: "http://localhost:4310",
        fetch: async (input) => {
            requests.push(String(input));
            return new Response(JSON.stringify({ items: [], nextCursor: null }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        },
    });
}

describe("HttpCosmosClient search filters", () => {
    it("sends author, media type and ingest status as query parameters", async () => {
        const requests: string[] = [];
        const client = clientWithCapture(requests);

        await client.search({
            author: "Alice",
            contentKind: "video",
            assetStatus: "saved",
            limit: 20,
        });

        const url = new URL(requests[0]!);
        expect(url.pathname).toBe("/api/v1/search");
        expect(url.searchParams.get("author")).toBe("Alice");
        expect(url.searchParams.get("contentKind")).toBe("video");
        expect(url.searchParams.get("assetStatus")).toBe("saved");
    });

    it("omits the parameters when the caller leaves them out", async () => {
        const requests: string[] = [];
        const client = clientWithCapture(requests);

        await client.search({ text: "qwen", limit: 20 });

        const url = new URL(requests[0]!);
        expect(url.searchParams.has("author")).toBe(false);
        expect(url.searchParams.has("contentKind")).toBe(false);
        expect(url.searchParams.has("assetStatus")).toBe(false);
    });
});
