import { describe, expect, it } from "vitest";

import {
    HttpCosmosClient,
    type CosmosEventSource,
} from "./index.js";

describe("HttpCosmosClient", () => {
    it("uses the versioned service endpoint and validates health responses", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310/",
            fetch: async (input) => {
                requests.push(String(input));
                return new Response(JSON.stringify({
                    status: "ok",
                    service: "cosmos-api",
                    version: "0.1.0",
                    protocolVersion: "v1",
                    workerStatus: "unknown",
                    storageStatus: "ready",
                    migrationStatus: "ready",
                    timestamp: "2026-08-08T00:00:00.000Z",
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const health = await client.health();

        expect(health.protocolVersion).toBe("v1");
        expect(requests).toEqual(["http://localhost:4310/api/v1/health"]);
    });

    it("lists connector capabilities through the API-only control surface", async () => {
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async () => new Response(JSON.stringify([{
                id: "bilibili",
                description: "Bilibili",
                capabilities: ["bilibili", "opencli"],
                configVersion: "v1",
            }]), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        });

        const connectors = await client.listConnectors();

        expect(connectors).toEqual([{
            id: "bilibili",
            description: "Bilibili",
            capabilities: ["bilibili", "opencli"],
            configVersion: "v1",
        }]);
    });

    it("posts source activation commands with the idempotency key", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                return new Response(JSON.stringify({
                    id: "source-1",
                    name: "RSS",
                    sourceDefinitionRef: "source.rss@1",
                    operationId: "fetch",
                    connectorId: "rss",
                    kind: "rss",
                    config: { feedUrl: "https://example.test/feed.xml" },
                    enabled: true,
                    revisionId: "source-1:2",
                    createdAt: "2026-08-24T00:00:00.000Z",
                    updatedAt: "2026-08-24T00:00:01.000Z",
                    lastRunAt: null,
                    lastError: null,
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const activated = await client.activateSource("source-1", {
            enabled: true,
            baseRevisionId: "source-1:1",
        }, "activation-1");

        expect(activated.revisionId).toBe("source-1:2");
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/sources/source-1/activation-commands");
        expect(requests[0]?.init).toMatchObject({
            method: "POST",
            headers: expect.objectContaining({ "idempotency-key": "activation-1" }),
        });
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
            enabled: true,
            baseRevisionId: "source-1:1",
        });
    });

    it("reads the source definition catalog page", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input) => {
                requests.push(String(input));
                return new Response(JSON.stringify({
                    items: [{
                        id: "rss",
                        version: 1,
                        ref: "source.rss@1",
                        provider: "cosmos",
                        connectorId: "rss",
                        displayName: "RSS",
                        description: "Fetch one RSS or Atom feed page.",
                        manifestHash: { algorithm: "builtin", value: "builtin:source.rss@1" },
                        status: "enabled",
                        operationIds: ["fetch"],
                        capabilities: ["source:read", "cursor"],
                        configurationSchema: {
                            id: "source.rss.config@1",
                            version: 1,
                            hash: { algorithm: "builtin", value: "source.rss.config@1" },
                            schema: {
                                type: "object",
                                properties: { feedUrl: { type: "string", format: "uri" } },
                                required: ["feedUrl"],
                            },
                        },
                    }],
                    nextCursor: null,
                    snapshotAt: "2026-09-02T00:00:00.000Z",
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const definitions = await client.listSourceDefinitions();

        expect(definitions).toHaveLength(1);
        expect(definitions[0]).toMatchObject({ ref: "source.rss@1", status: "enabled" });
        expect(requests).toEqual(["http://localhost:4310/api/v1/source-definitions"]);
    });

    it("posts unsaved config probes and reads them back by job id", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const jobAt = (status: string, result: unknown) => JSON.stringify({
            id: "job-config-1",
            kind: "source-config-probe",
            sourceId: null,
            runId: null,
            status,
            attempts: 0,
            maxAttempts: 3,
            errorCode: null,
            error: null,
            createdAt: "2026-09-02T00:00:00.000Z",
            updatedAt: "2026-09-02T00:00:01.000Z",
            result,
        });
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                return new Response(requests.length === 1 ? jobAt("queued", null) : jobAt("succeeded", {
                    sourceDefinitionRef: "source.rss@1",
                    operationId: "fetch",
                    connectorId: "rss",
                    itemCount: 3,
                    nextCursorAvailable: false,
                    sampleTitles: ["First", "Second"],
                    checkedAt: "2026-09-02T00:00:01.000Z",
                    durationMs: 140,
                }), {
                    status: requests.length === 1 ? 202 : 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const queued = await client.createSourceConfigProbe({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: { feedUrl: "https://example.test/feed.xml" },
        }, "config-probe-1");

        expect(queued).toMatchObject({ id: "job-config-1", kind: "source-config-probe", result: null });
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/source-config-probes");
        expect(requests[0]?.init).toMatchObject({
            method: "POST",
            headers: expect.objectContaining({ "idempotency-key": "config-probe-1" }),
        });
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: { feedUrl: "https://example.test/feed.xml" },
        });

        const finished = await client.getSourceConfigProbe("job-config-1");

        expect(finished.status).toBe("succeeded");
        expect(finished.result).toMatchObject({ itemCount: 3, sampleTitles: ["First", "Second"] });
        expect(requests[1]?.url).toBe("http://localhost:4310/api/v1/source-config-probes/job-config-1");
    });

    it("opens the versioned SSE endpoint and validates event envelopes", () => {
        let instance: CosmosEventSource | undefined;
        let openedUrl = "";
        let received: string | undefined;
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310/",
            eventSourceFactory: (url) => {
                openedUrl = url;
                instance = {
                    onmessage: null,
                    onerror: null,
                    close: () => undefined,
                };
                return instance;
            },
        });

        const close = client.openEventStream({
            afterEventId: "12",
            onEvent: (event) => {
                received = event.type;
            },
        });

        instance!.onmessage?.({
            data: JSON.stringify({
                id: "13",
                type: "feed.updated.v1",
                version: "v1",
                occurredAt: "2026-08-08T00:00:00.000Z",
                payload: { storyId: "story:1" },
            }),
        });
        close();

        expect(openedUrl).toBe("http://localhost:4310/api/v1/events?after=12");
        expect(received).toBe("feed.updated.v1");
    });

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
