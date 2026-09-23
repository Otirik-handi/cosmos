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

    it("lists connector state namespaces and exports one scope (ING-012 / ADR-0026)", async () => {
        const requests: string[] = [];
        const exported = {
            schemaVersion: 1,
            exportedAt: "2026-09-23T12:30:00.000Z",
            scope: { kind: "plan", value: "plan:source-1" },
            counts: { namespaces: 1, keys: 1 },
            namespaces: [{
                namespace: "plan:source-1",
                owner: { planId: "plan:source-1", sourceId: "source-1", connectionId: null },
                entries: [{
                    key: "http-cache",
                    value: { etag: 'W/"1"' },
                    version: 2,
                    updatedAt: "2026-09-23T12:00:00.000Z",
                }],
            }],
        };
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input) => {
                const url = String(input);
                requests.push(url);
                return new Response(JSON.stringify(
                    url.includes("/connector-state/namespaces")
                        ? [{
                            namespace: "plan:source-1",
                            keyCount: 1,
                            planId: "plan:source-1",
                            sourceId: "source-1",
                            connectionId: null,
                            unattributed: false,
                        }]
                        : exported,
                ), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const listed = await client.listConnectorStateNamespaces();
        expect(listed[0]).toMatchObject({ namespace: "plan:source-1", keyCount: 1 });

        const payload = await client.exportConnectorState({ kind: "plan", planId: "plan:source-1" });
        expect(payload.counts).toEqual({ namespaces: 1, keys: 1 });

        // 缺省范围不带查询参数：全部已归属是服务端的默认口径。
        await client.exportConnectorState();
        expect(requests).toEqual([
            "http://localhost:4310/api/v1/connector-state/namespaces",
            "http://localhost:4310/api/v1/exports/connector-state?planId=plan%3Asource-1",
            "http://localhost:4310/api/v1/exports/connector-state",
        ]);
    });

    it("imports a connector state export through the versioned endpoint (ADR-0026)", async () => {
        const requests: { url: string; body: string | undefined }[] = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push({ url: String(input), body: init?.body === undefined ? undefined : String(init.body) });
                return new Response(JSON.stringify({
                    mode: "skip-existing",
                    namespaces: 1,
                    created: 1,
                    overwritten: 0,
                    skipped: 0,
                }), {
                    status: 201,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const result = await client.importConnectorState({
            targetNamespace: "plan:source-2",
            export: {
                schemaVersion: 1,
                exportedAt: "2026-09-23T12:30:00.000Z",
                scope: { kind: "namespace", value: "plan:source-old" },
                counts: { namespaces: 1, keys: 1 },
                namespaces: [{
                    namespace: "plan:source-old",
                    owner: null,
                    entries: [{
                        key: "http-cache",
                        value: { etag: "old" },
                        version: 4,
                        updatedAt: "2026-09-23T12:00:00.000Z",
                    }],
                }],
            },
        });

        expect(result.created).toBe(1);
        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/imports/connector-state");
        expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
            targetNamespace: "plan:source-2",
            export: { namespaces: [{ namespace: "plan:source-old" }] },
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
