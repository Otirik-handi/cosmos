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
});
