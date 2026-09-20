import { describe, expect, it } from "vitest";

import {
    HttpCosmosClient,
    type CosmosEventSource,
} from "./index.js";

describe("HttpCosmosClient 来源与运行", () => {
    it("posts a source removal with the base revision and the idempotency key", async () => {
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
                    enabled: false,
                    revisionId: "source-1:3",
                    createdAt: "2026-08-24T00:00:00.000Z",
                    updatedAt: "2026-08-24T00:00:02.000Z",
                    lastRunAt: null,
                    lastError: null,
                }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        await client.deleteSource("source-1", {
            baseRevisionId: "source-1:2",
            actor: "user",
            reason: "不再关注",
        }, "removal-1");

        expect(requests[0]?.url).toBe("http://localhost:4310/api/v1/sources/source-1/removals");
        expect(requests[0]?.init).toMatchObject({
            method: "POST",
            headers: expect.objectContaining({ "idempotency-key": "removal-1" }),
            body: JSON.stringify({
                baseRevisionId: "source-1:2",
                actor: "user",
                reason: "不再关注",
            }),
        });
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
                        auth: { kind: "none", label: null, secretRefRequired: false },
                        operations: [{
                            operationId: "fetch",
                            inputSchema: { id: "source.rss.fetch.input@1", version: 1, hash: { algorithm: "builtin", value: "i" } },
                            outputSchema: { id: "source.rss.fetch.output@1", version: 1, hash: { algorithm: "builtin", value: "o" } },
                            externalKey: "url",
                            discoveryContext: "",
                            media: "download",
                            stateStoreNamespace: "source:{id}",
                        }],
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

    it("lists the durable Run history with source and limit query params", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input) => {
                requests.push(String(input));
                return new Response(JSON.stringify([{
                    id: "run-1",
                    sourceId: "source-a",
                    triggerKind: "manual",
                    status: "failed",
                    createdAt: "2026-09-10T00:00:00.000Z",
                    startedAt: "2026-09-10T00:00:01.000Z",
                    finishedAt: "2026-09-10T00:00:02.000Z",
                    itemCount: 0,
                    createdEntryCount: 0,
                    revisedEntryCount: 0,
                    error: null,
                }]), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const list = await client.listRuns({ sourceId: "source-a", limit: 10 });
        expect(list[0]).toMatchObject({ id: "run-1", status: "failed" });
        expect(requests[0]).toBe("http://localhost:4310/api/v1/runs?sourceId=source-a&limit=10");
    });

    it("creates and lists connections through the versioned endpoint", async () => {
        const requests: string[] = [];
        const connection = {
            id: "c1",
            name: "主账号",
            connectorId: "bilibili",
            account: null,
            scopeJson: null,
            status: "active",
            secretRef: "secret:c1",
            lastError: null,
            createdAt: "2026-09-10T08:00:00.000Z",
            updatedAt: "2026-09-10T08:00:00.000Z",
        };
        const client = new HttpCosmosClient({
            baseUrl: "http://localhost:4310",
            fetch: async (input, init) => {
                requests.push(String(input));
                const isPost = (init as RequestInit | undefined)?.method === "POST";
                return new Response(JSON.stringify(isPost ? connection : [connection]), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        });

        const created = await client.createConnection({ name: "主账号", connectorId: "bilibili" });
        expect(created).toMatchObject({ id: "c1", status: "active" });
        expect(requests[0]).toBe("http://localhost:4310/api/v1/connections");

        const listed = await client.listConnections();
        expect(listed).toHaveLength(1);
        expect(requests[1]).toBe("http://localhost:4310/api/v1/connections");
    });
});
