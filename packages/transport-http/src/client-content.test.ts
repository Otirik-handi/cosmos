import { describe, expect, it } from "vitest";

import { HttpCosmosClient } from "./index.js";

/**
 * LIB-001：搜索的三个新过滤维度必须真的走到 HTTP query 上——只加合同字段而客户端
 * 不拼参数，界面上选中的条件会被静默丢掉。
 */
function clientWithCapture(requests: string[]): HttpCosmosClient {
    return new HttpCosmosClient({
        baseUrl: "http://localhost:4310",
        fetch: async (input) => {
            requests.push(String(input));
            return new Response(JSON.stringify({ items: [], nextCursor: null }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        },
    });
}

describe("HttpCosmosClient structured reading", () => {
    it("rebuilds an encoded source revision with an empty command", async () => {
        const requests: { url: string; body: unknown }[] = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input, init) => {
            requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
            return Response.json({ representationId: "rep-2", representationVersion: 2, promoted: false });
        } });
        expect(await client.rebuildRevisionContent("revision/1")).toEqual({ representationId: "rep-2", representationVersion: 2, promoted: false });
        expect(requests).toEqual([{ url: "http://localhost:4310/api/v1/revisions/revision%2F1/content/rebuild", body: {} }]);
    });
    it("encodes candidate routes and sends only a human decision", async () => {
        const candidate = { id: "candidate/1", storyId: "story/1", storyRevisionId: "story-revision-1",
            producer: "agent", producerVersion: "story-agent@1", provider: "fake", model: "fixture",
            inputSources: [], confidence: null, createdAt: "2026-10-08T12:00:00.000Z",
            proposal: { task: "story.summarize", title: "Title", summary: "Summary", keyFacts: [] } };
        const requests: { url: string; body: unknown }[] = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input, init) => {
            requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
            return Response.json(init?.method === "POST" ? { candidate, status: "rejected" } : [{ candidate, status: "pending" }]);
        } });
        expect(await client.storyAgentCandidates("story/1")).toHaveLength(1);
        expect((await client.decideStoryAgentCandidate("candidate/1", "reject")).status).toBe("rejected");
        expect(requests).toEqual([
            { url: "http://localhost:4310/api/v1/stories/story%2F1/agent-candidates", body: null },
            { url: "http://localhost:4310/api/v1/story-agent-candidates/candidate%2F1/decision", body: { decision: "reject" } },
        ]);
    });
    it("queues exact source bindings with a stable key and reads an encoded generation route", async () => {
        const requests: { url: string; body: unknown; key: string | null }[] = [];
        const generation = { runId: "run/1", storyId: "story/1", task: "story.summarize",
            status: "queued", candidateId: null, errorCode: null };
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input, init) => {
            requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null,
                key: new Headers(init?.headers).get("idempotency-key") });
            return Response.json(generation, { status: init?.method === "POST" ? 202 : 200 });
        } });
        const request = { task: "story.summarize" as const, modelId: "configured-model-1", sources: [{ entryRevisionId: "revision-1", representationVersion: 2 }] };
        await expect(client.proposeStoryAgentCandidate("story/1", request, "stable-key")).resolves.toEqual(generation);
        await expect(client.storyAgentGeneration("story/1", "run/1")).resolves.toEqual(generation);
        expect(requests).toEqual([
            { url: "http://localhost:4310/api/v1/stories/story%2F1/agent-candidates", body: request, key: "stable-key" },
            { url: "http://localhost:4310/api/v1/stories/story%2F1/agent-generations/run%2F1", body: null, key: null },
        ]);
        await expect(client.proposeStoryAgentCandidate("story/1", { ...request, sources: [{ entryRevisionId: "revision-1", representationVersion: 0 }] }, "stable-key")).rejects.toThrow();
        await expect(client.proposeStoryAgentCandidate("story/1", request, " ")).rejects.toThrow();
        expect(requests).toHaveLength(2);
    });
    it("sends a validated selection command to the encoded revision endpoint", async () => {
        const requests: { url: string; body: unknown; method: string | undefined }[] = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input, init) => {
            requests.push({ url: String(input), body: JSON.parse(String(init?.body)), method: init?.method });
            return Response.json({ currentRepresentationId: "old", locked: true, changed: true });
        } });
        const command = { operation: "rollback" as const, expectedCurrentId: "current", expectedLocked: false, representationId: "old" };
        await expect(client.selectRevisionContent("revision/1", command)).resolves.toMatchObject({ locked: true });
        expect(requests[0]).toEqual({ url: "http://localhost:4310/api/v1/revisions/revision%2F1/content/selection", body: command, method: "POST" });
        await expect(client.selectRevisionContent("revision/1", { ...command, representationId: undefined })).rejects.toThrow();
        expect(requests).toHaveLength(1);
    });
    it("requests an exact historical version and validates the response", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input) => {
            requests.push(String(input));
            return Response.json({ entryId: "entry-1", entryRevisionId: "revision/1", representation: null,
                contentText: "", readingMode: "unavailable", evidenceStatus: "representation-unavailable" });
        } });
        expect((await client.revisionContent("revision/1", 4)).readingMode).toBe("unavailable");
        const url = new URL(requests[0]!);
        expect(url.pathname).toBe("/api/v1/revisions/revision%2F1/content");
        expect(url.searchParams.get("representationVersion")).toBe("4");
        await expect(client.revisionContent("revision/1", 0)).rejects.toBeInstanceOf(RangeError);
        expect(requests).toHaveLength(1);
    });
});

describe("HttpCosmosClient deep reads", () => {
    const generation = { runId: "run/1", storyId: "story/1", status: "queued", modelId: "model-1",
        provider: null, model: null, createdAt: "2026-11-19T00:00:00.000Z", publishedRevision: null, errorCode: null };
    const revision = { artifactId: "a1", storyId: "story/1", workflowRunId: "run/1", revision: 1, headline: "Report",
        producer: "agent", producerVersion: "1", provider: "fake", model: "fixture", createdAt: generation.createdAt,
        contentHash: "a".repeat(64), sourceStatus: "current", sections: [{ id: "s1", heading: "Opinion", kind: "opinion", evidence: [],
            blocks: [{ id: "s1-b1", type: "paragraph", data: { inlines: [{ type: "text", text: "Report" }] } }] }],
        input: { storyRevisionId: "sr1", sources: [{ entryId: "e1", entryRevisionId: "er1", representationVersion: 1,
            blockIds: ["b1"], includedCharacterCount: 6, truncated: false, omitted: false, reason: null }], omittedSourceCount: 0 } };
    it("encodes all four URLs, sends a normalized key/model and parses each response", async () => {
        const requests: { url: string; method: string | undefined; body: unknown; key: string | null }[] = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (url, init) => {
            requests.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null,
                key: new Headers(init?.headers).get("Idempotency-Key") });
            return Response.json(String(url).includes("/revisions/") ? revision : String(url).includes("/generations/") || init?.method === "POST"
                ? generation : { artifact: null }, { status: init?.method === "POST" ? 202 : 200 });
        } });
        expect(await client.createStoryDeepRead("story/1", { modelId: " selected " }, " stable ")).toEqual(generation);
        expect(await client.storyDeepReadGeneration("story/1", "run/1")).toEqual(generation);
        expect(await client.storyDeepReadArtifact("story/1")).toEqual({ artifact: null });
        expect(await client.storyDeepReadRevision("story/1", 1)).toEqual(revision);
        expect(requests).toEqual([
            { url: "http://localhost:4310/api/v1/stories/story%2F1/deep-reads", method: "POST", body: { modelId: "selected" }, key: "stable" },
            { url: "http://localhost:4310/api/v1/stories/story%2F1/deep-reads/generations/run%2F1", method: "GET", body: null, key: null },
            { url: "http://localhost:4310/api/v1/stories/story%2F1/deep-reads", method: "GET", body: null, key: null },
            { url: "http://localhost:4310/api/v1/stories/story%2F1/deep-reads/revisions/1", method: "GET", body: null, key: null },
        ]);
    });
    it("allows default model selection and rejects invalid requests before fetch", async () => {
        let calls = 0;
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (_url, init) => {
            calls++;
            expect(JSON.parse(String(init?.body))).toEqual({});
            return Response.json(generation, { status: 202 });
        } });
        await client.createStoryDeepRead("s1", {}, "k1");
        for (const key of ["", " ", "x".repeat(201)]) await expect(client.createStoryDeepRead("s1", {}, key)).rejects.toThrow();
        await expect(client.createStoryDeepRead("s1", { modelId: " " }, "k1")).rejects.toThrow();
        const invalid = { modelId: "model", connectionId: "private" };
        await expect(client.createStoryDeepRead("s1", invalid, "k1")).rejects.toThrow();
        for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await expect(client.storyDeepReadRevision("s1", value)).rejects.toThrow();
        expect(calls).toBe(1);
    });
    it("strictly parses each otherwise valid success payload including nested current/input", async () => {
        const { sections: _sections, input: _input, ...summary } = revision;
        const artifact = { artifact: { id: "a1", storyId: "story/1", kind: "story-deep-read", generation,
            revisions: [summary], current: revision } };
        let payload: unknown = generation;
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async () => Response.json(payload) });
        expect(await client.createStoryDeepRead("s1", {}, "k1")).toEqual(generation);
        payload = { ...generation, lease: "private" };
        await expect(client.createStoryDeepRead("s1", {}, "k1")).rejects.toThrow();
        payload = generation;
        expect(await client.storyDeepReadGeneration("s1", "r1")).toEqual(generation);
        payload = { ...generation, prompt: "private" };
        await expect(client.storyDeepReadGeneration("s1", "r1")).rejects.toThrow();
        payload = artifact;
        expect(await client.storyDeepReadArtifact("s1")).toEqual(artifact);
        payload = { ...artifact, lease: "private" };
        await expect(client.storyDeepReadArtifact("s1")).rejects.toThrow();
        payload = { artifact: { ...artifact.artifact, current: { ...revision, sourceBody: "private" } } };
        await expect(client.storyDeepReadArtifact("s1")).rejects.toThrow();
        payload = revision;
        expect(await client.storyDeepReadRevision("s1", 1)).toEqual(revision);
        payload = { ...revision, lease: "private" };
        await expect(client.storyDeepReadRevision("s1", 1)).rejects.toThrow();
        payload = { ...revision, input: { ...revision.input, sourceBody: "private" } };
        await expect(client.storyDeepReadRevision("s1", 1)).rejects.toThrow();
    });
    it.each([[400, "invalid_configuration"], [404, "not_found"], [409, "conflict"], [503, "dependency_unavailable"]])(
        "preserves HTTP %s and %s", async (status, code) => {
            const body = { code, message: "Safe message", retryable: status === 503 };
            const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async () => Response.json(body, { status: Number(status) }) });
            await expect(client.createStoryDeepRead("s1", {}, "k1")).rejects.toMatchObject({ status, code, body });
        });
});

describe("HttpCosmosClient search filters", () => {
    it("sends author, media type and ingest status as query parameters", async () => {
        const requests: string[] = [];
        const client = clientWithCapture(requests);

        await client.search({
            author: "Alice",
            contentKind: "video",
            assetStatus: "saved",
            limit: 20,
        });

        const url = new URL(requests[0]!);
        expect(url.pathname).toBe("/api/v1/search");
        expect(url.searchParams.get("author")).toBe("Alice");
        expect(url.searchParams.get("contentKind")).toBe("video");
        expect(url.searchParams.get("assetStatus")).toBe("saved");
    });

    it("omits the parameters when the caller leaves them out", async () => {
        const requests: string[] = [];
        const client = clientWithCapture(requests);

        await client.search({ text: "qwen", limit: 20 });

        const url = new URL(requests[0]!);
        expect(url.searchParams.has("author")).toBe(false);
        expect(url.searchParams.has("contentKind")).toBe(false);
        expect(url.searchParams.has("assetStatus")).toBe(false);
    });
});
