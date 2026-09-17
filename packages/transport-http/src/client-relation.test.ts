import { describe, expect, it } from "vitest";

import {
    HttpCosmosClient,
} from "./index.js";

function entryDetail(entryId: string, relations: unknown[]) {
    return {
        id: entryId,
        sourceId: "source-a",
        sourceName: "Source A",
        sourceKind: "rss",
        currentRevisionId: "er-a-1",
        metrics: null,
        revisions: [],
        observations: [],
        relatedStories: [],
        relations,
    };
}

describe("HttpCosmosClient entry 关系", () => {
    it("posts both relation commands to the versioned endpoints and validates the EntryDetail", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                return new Response(JSON.stringify(entryDetail("entry-b", [{
                    entryId: "entry-a",
                    relationType: "syndicated_from",
                    direction: "outgoing",
                    title: "Entry A",
                    sourceId: "source-a",
                    sourceName: "Source A",
                    producer: "human",
                    producerVersion: null,
                    confidence: 1,
                    evidence: null,
                    actor: "user",
                    reason: null,
                }])), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const linked = await client.linkEntryRelation({
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
            relationType: "syndicated_from",
        });
        expect(linked.relations[0]?.direction).toBe("outgoing");
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/entry-relations");
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
            relationType: "syndicated_from",
        });

        const unlinked = await client.unlinkEntryRelation({
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
        });
        expect(unlinked.id).toBe("entry-b");
        expect(requests[1]?.url).toBe("http://localhost:4310/api/v1/entry-relations/removals");
    });

    it("rejects an unknown relation kind before it leaves the client", async () => {
        let called = false;
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async () => {
                called = true;
                return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
            },
        });

        await expect(client.linkEntryRelation({
            fromEntryId: "entry-a",
            toEntryId: "entry-b",
            // Only the three frozen words are accepted on the write side.
            relationType: "translated_from" as never,
        })).rejects.toThrow();
        expect(called).toBe(false);
    });
});
