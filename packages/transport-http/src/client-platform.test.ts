import { describe, expect, it } from "vitest";

import {
    HttpCosmosClient,
    type CosmosEventSource,
} from "./index.js";

describe("HttpCosmosClient 平台面", () => {
    it("reads the jobs of a run from the run-scoped endpoint (OPS-002)", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input) => {
                requests.push(String(input));
                return new Response(JSON.stringify({
                    items: [{
                        id: "job-1",
                        kind: "source-ingest",
                        sourceId: "source-1",
                        runId: "run-1",
                        status: "succeeded",
                        attempts: 2,
                        maxAttempts: 3,
                        errorCode: null,
                        error: null,
                        createdAt: "2026-08-08T00:00:00.000Z",
                        updatedAt: "2026-08-08T00:00:01.000Z",
                        result: null,
                    }],
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const jobs = await client.listRunJobs("run-1");

        expect(requests).toEqual(["http://localhost:4310/api/v1/runs/run-1/jobs"]);
        expect(jobs[0]).toMatchObject({ id: "job-1", attempts: 2, maxAttempts: 3 });
    });

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

    it("downloads the user data export through the versioned endpoint (LIB-008 / OPS-004)", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input) => {
                requests.push(String(input));
                return new Response(JSON.stringify({
                    schemaVersion: 1,
                    exportedAt: "2026-09-20T12:30:00.000Z",
                    counts: {
                        labels: 0,
                        collections: 0,
                        favorites: 0,
                        annotations: 0,
                        savedViews: 0,
                        boards: 0,
                        spotlightPlacements: 0,
                        targets: 0,
                    },
                    data: {
                        labels: [],
                        collections: [],
                        favorites: [],
                        annotations: [],
                        savedViews: [],
                        boards: [],
                        spotlightPlacements: [],
                        targets: [],
                    },
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const payload = await client.exportUserData();

        expect(requests).toEqual(["http://localhost:4310/api/v1/exports/user-data"]);
        expect(payload.schemaVersion).toBe(1);
        expect(payload.counts.labels).toBe(0);
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
