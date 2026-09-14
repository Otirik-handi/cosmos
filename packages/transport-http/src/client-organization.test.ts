import { describe, expect, it } from "vitest";

import {
    HttpCosmosClient,
    type CosmosEventSource,
} from "./index.js";

describe("HttpCosmosClient 用户组织", () => {
    it("calls the user organization endpoints (labels/collections/favorites)", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const ack = (id: string, action: string) => JSON.stringify({
            ok: true,
            id,
            action,
        });
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                const url = String(input);
                let body: unknown = null;
                if (url.endsWith("/api/v1/labels")) {
                    body = {
                        id: "label-a",
                        name: "AI",
                        assignedCount: 0,
                        createdAt: "2026-09-08T00:00:00.000Z",
                        updatedAt: "2026-09-08T00:00:00.000Z",
                    };
                } else if (url.endsWith("/api/v1/labels/label-a")) {
                    body = {
                        id: "label-a",
                        name: "AI",
                        createdAt: "2026-09-08T00:00:00.000Z",
                        updatedAt: "2026-09-08T00:00:00.000Z",
                        assignedStories: [{ id: "story-a", title: "Story a" }],
                        assignedEntries: [],
                        assignedTopics: [],
                    };
                } else if (url.includes("/api/v1/labels/label-a/removals")) {
                    body = JSON.parse(ack("label-a", "label.deleted"));
                } else if (url.endsWith("/api/v1/label-assignments")) {
                    body = JSON.parse(ack("label-a", "label.assigned"));
                } else if (url.endsWith("/api/v1/label-assignments/removals")) {
                    body = JSON.parse(ack("label-a", "label.unassigned"));
                } else if (url.endsWith("/api/v1/collections?storyId=story-a")) {
                    body = {
                        items: [{
                            id: "collection-a",
                            name: "Reading",
                            description: null,
                            itemCount: 1,
                            containsStory: true,
                            createdAt: "2026-09-08T00:00:00.000Z",
                            updatedAt: "2026-09-08T00:00:00.000Z",
                        }],
                    };
                } else if (url.endsWith("/api/v1/collections/collection-a/items")) {
                    body = JSON.parse(ack("collection-a", "collection.item_added"));
                } else if (url.endsWith("/api/v1/favorites")) {
                    body = JSON.parse(ack("story-a", "favorite.set"));
                } else if (url.endsWith("/api/v1/favorites/removals")) {
                    body = JSON.parse(ack("story-a", "favorite.unset"));
                } else {
                    throw new Error(`Unexpected request: ${url}`);
                }
                return new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const created = await client.createLabel({ name: "AI" });
        expect(created).toMatchObject({ name: "AI" });
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/labels");
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ name: "AI" });

        const detail = await client.label("label-a");
        expect(detail.assignedStories).toEqual([{ id: "story-a", title: "Story a" }]);

        const assigned = await client.attachLabel({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-a",
        });
        expect(assigned.action).toBe("label.assigned");
        expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-a",
        });

        await client.deleteLabel("label-a");
        expect(requests[3]?.url).toBe("http://localhost:4310/api/v1/labels/label-a/removals");

        const collections = await client.listCollections({ storyId: "story-a" });
        expect(collections.items[0].containsStory).toBe(true);
        expect(requests[4]?.url).toBe("http://localhost:4310/api/v1/collections?storyId=story-a");

        const added = await client.addCollectionItem("collection-a", { storyId: "story-a" });
        expect(added.action).toBe("collection.item_added");

        const set = await client.setFavorite({ targetType: "story", targetId: "story-a" });
        expect(set.action).toBe("favorite.set");
        expect(JSON.parse(String(requests[6]?.init?.body))).toEqual({
            targetType: "story",
            targetId: "story-a",
        });

        const unset = await client.unsetFavorite({ targetType: "story", targetId: "story-a" });
        expect(unset.action).toBe("favorite.unset");
    });

    it("calls the annotation endpoints (list/create/update/delete)", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const annotation = {
            id: "annotation-a",
            targetType: "story",
            targetId: "story-a",
            targetRevisionId: "rev-s-1",
            quote: "原文",
            body: "备注",
            evidence: null,
            actor: "user",
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        };
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                const url = String(input);
                let body: unknown;
                if (url.includes("/api/v1/annotations?")) {
                    body = { items: [annotation] };
                } else if (url.endsWith("/api/v1/annotations/annotation-a/removals")) {
                    body = { ok: true, id: "annotation-a", action: "annotation.deleted" };
                } else if (url.endsWith("/api/v1/annotations/annotation-a")) {
                    body = { ...annotation, body: "改后" };
                } else if (url.endsWith("/api/v1/annotations")) {
                    body = annotation;
                } else {
                    throw new Error(`Unexpected request: ${url}`);
                }
                return new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const list = await client.listAnnotations({
            targetType: "story",
            targetId: "story-a",
        });
        expect(list.items[0].targetRevisionId).toBe("rev-s-1");
        expect(requests[0]?.url)
            .toBe("http://localhost:4310/api/v1/annotations?targetType=story&targetId=story-a");

        const created = await client.createAnnotation({
            targetType: "story",
            targetId: "story-a",
            body: "备注",
            quote: "原文",
            actor: "user",
        });
        expect(created.body).toBe("备注");
        expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
            targetType: "story",
            targetId: "story-a",
            body: "备注",
        });

        const updated = await client.updateAnnotation("annotation-a", { body: "改后" });
        expect(updated.body).toBe("改后");
        expect(requests[2]?.init).toMatchObject({ method: "PATCH" });

        const deleted = await client.deleteAnnotation("annotation-a");
        expect(deleted.action).toBe("annotation.deleted");
        expect(requests[3]?.url)
            .toBe("http://localhost:4310/api/v1/annotations/annotation-a/removals");
    });

    it("calls saved view endpoints and forwards label/topic search filters", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const view = {
            id: "saved-view-a",
            name: "AI 关注",
            text: "qwen",
            sourceId: null,
            publishedAfter: null,
            publishedBefore: null,
            labelIds: ["label-a"],
            topicIds: [],
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        };
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                const url = String(input);
                let body: unknown;
                if (url.includes("/api/v1/search?")) {
                    body = { items: [], nextCursor: null };
                } else if (url.endsWith("/api/v1/saved-views/saved-view-a/removals")) {
                    body = { ok: true, id: "saved-view-a", action: "saved_view.deleted" };
                } else if (url.endsWith("/api/v1/saved-views/saved-view-a")) {
                    body = { ...view, name: "改" };
                } else if (url.endsWith("/api/v1/saved-views")) {
                    body = Array.isArray(body) ? body : view;
                } else {
                    throw new Error(`Unexpected request: ${url}`);
                }
                return new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const created = await client.createSavedView({
            name: "AI 关注",
            conditions: { text: "qwen", labelIds: ["label-a"] },
        });
        expect(created.labelIds).toEqual(["label-a"]);
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/saved-views");
        expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
            name: "AI 关注",
            conditions: { text: "qwen", labelIds: ["label-a"] },
        });

        const updated = await client.updateSavedView("saved-view-a", {
            name: "改",
            conditions: {},
        });
        expect(updated.name).toBe("改");
        expect(requests[1]?.init).toMatchObject({ method: "PATCH" });

        const deleted = await client.deleteSavedView("saved-view-a");
        expect(deleted.action).toBe("saved_view.deleted");

        await client.search({
            text: "qwen",
            labelIds: "label-a,label-b",
            topicIds: "topic-a",
        });
        const searchUrl = requests[3]?.url ?? "";
        expect(searchUrl).toContain("labelIds=label-a%2Clabel-b");
        expect(searchUrl).toContain("topicIds=topic-a");
    });
});
