import { describe, expect, it } from "vitest";

import {
    HttpCosmosClient,
    type CosmosEventSource,
} from "./index.js";

describe("HttpCosmosClient Story", () => {
    it("posts a Story split and parses the historical shell", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                return new Response(JSON.stringify({
                    story: {
                        id: "story-shell",
                        kind: "event",
                        subtype: null,
                        revisionId: "rev-shell-1",
                        title: "Was one Story",
                        summary: null,
                        producer: "human",
                        status: "split",
                        replacedBy: [
                            { storyId: "story-a", title: "Event A", kind: "event" },
                            { storyId: "story-b", title: "Event B", kind: "document" },
                        ],
                    },
                    entry: null,
                    entries: [],
                    entities: [],
                    topics: [],
                    labels: [],
                    favorited: false,
                    evidence: [],
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const shell = await client.splitStory("story-shell", {
            successors: [
                {
                    title: "Event A",
                    kind: "event",
                    entryIds: ["entry-a"],
                    evidenceEntryIds: [],
                    entityIds: [],
                    topicIds: [],
                },
                {
                    title: "Event B",
                    kind: "document",
                    entryIds: ["entry-b"],
                    evidenceEntryIds: [],
                    entityIds: [],
                    topicIds: [],
                },
            ],
            reason: "两个事件被错误合并",
        });
        expect(shell.story.status).toBe("split");
        expect(shell.entry).toBeNull();
        expect(shell.story.replacedBy.map((successor) => successor.storyId))
            .toEqual(["story-a", "story-b"]);
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/stories/story-shell/splits");
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
            successors: [
                {
                    title: "Event A",
                    kind: "event",
                    entryIds: ["entry-a"],
                    evidenceEntryIds: [],
                    entityIds: [],
                    topicIds: [],
                },
                {
                    title: "Event B",
                    kind: "document",
                    entryIds: ["entry-b"],
                    evidenceEntryIds: [],
                    entityIds: [],
                    topicIds: [],
                },
            ],
            reason: "两个事件被错误合并",
        });
    });

    it("reads the managed Story subtype catalog with an optional kind filter", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input) => {
                requests.push(String(input));
                return new Response(JSON.stringify({
                    items: [
                        {
                            id: "media.comic",
                            kind: "media",
                            version: 1,
                            label: "漫画",
                            description: null,
                            status: "active",
                            identityPolicy: "same-work-v1",
                            owner: "core",
                        },
                    ],
                    nextCursor: null,
                    snapshotAt: "2026-09-09T00:00:00.000Z",
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const subtypes = await client.listStorySubtypes({ kind: "media" });
        expect(subtypes).toEqual([
            {
                id: "media.comic",
                kind: "media",
                version: 1,
                label: "漫画",
                description: null,
                status: "active",
                identityPolicy: "same-work-v1",
                owner: "core",
            },
        ]);
        expect(requests).toEqual(["http://localhost:4310/api/v1/story-subtypes?kind=media"]);

        await client.listStorySubtypes();
        expect(requests[1]).toBe("http://localhost:4310/api/v1/story-subtypes?");
    });
});
