import { describe, expect, it } from "vitest";

import {
    HttpCosmosClient,
    type CosmosEventSource,
} from "./index.js";

describe("HttpCosmosClient entity 与证据", () => {
    it("posts entity commands to the versioned endpoints and validates details", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                return new Response(JSON.stringify({
                    entity: {
                        id: "entity-a",
                        revisionId: "rev-e-1",
                        type: "person",
                        name: "Jeff Dean",
                    },
                    aliases: ["Jeffrey Dean"],
                    stories: [{
                        storyId: "story-a",
                        producer: "human",
                        producerVersion: null,
                        confidence: 1,
                        evidence: null,
                        actor: "user",
                        reason: null,
                    }],
                    relations: [],
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const created = await client.createEntity({
            name: "Jeff Dean",
            type: "person",
            alias: "Jeffrey Dean",
        });
        expect(created.entity.name).toBe("Jeff Dean");
        expect(created.aliases).toEqual(["Jeffrey Dean"]);
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/entities");
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
            name: "Jeff Dean",
            type: "person",
            alias: "Jeffrey Dean",
        });

        const linked = await client.linkStoryEntity({
            storyId: "story-a",
            entityId: "entity-a",
        });
        expect(linked.stories[0].storyId).toBe("story-a");
        expect(requests[1]?.url).toBe("http://localhost:4310/api/v1/story-entity-links");
    });

    it("calls the entry↔story evidence endpoints", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                return new Response(JSON.stringify({
                    story: {
                        id: "story-b",
                        kind: "event",
                        subtype: null,
                        revisionId: "rev-b-1",
                        title: "Event",
                        summary: null,
                        producer: "system",
                        status: "active",
                        replacedBy: [],
                    },
                    entry: {
                        id: "entry-a",
                        sourceId: "source-a",
                        sourceName: "Source A",
                        sourceKind: "rss",
                        currentRevisionId: "er-a-1",
                        metrics: null,
                        revisions: [],
                        observations: [],
                        relatedStories: [{
                            storyId: "story-b",
                            relationType: "evidence_for",
                            title: "Event",
                            reason: null,
                        }],
                        relations: [],
                    },
                    entries: [],
                    entities: [],
                    topics: [],
                    labels: [],
                    favorited: false,
                    evidence: [{
                        entryId: "entry-a",
                        sourceId: "source-a",
                        sourceName: "Source A",
                        relationType: "evidence_for",
                        title: "Long article",
                        producer: "human",
                        producerVersion: null,
                        confidence: 1,
                        evidence: null,
                        actor: null,
                        reason: null,
                    }],
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const linked = await client.linkEntryStory({
            entryId: "entry-a",
            storyId: "story-b",
            relationType: "evidence_for",
        });
        expect(linked.evidence[0]?.entryId).toBe("entry-a");
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/entry-story-links");
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
            entryId: "entry-a",
            storyId: "story-b",
            relationType: "evidence_for",
        });

        const unlinked = await client.unlinkEntryStory({
            entryId: "entry-a",
            storyId: "story-b",
        });
        expect(unlinked.story.id).toBe("story-b");
        expect(requests[1]?.url).toBe("http://localhost:4310/api/v1/entry-story-links/removals");
    });
});
