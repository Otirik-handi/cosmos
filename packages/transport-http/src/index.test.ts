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
