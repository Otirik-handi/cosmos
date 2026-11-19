import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { StoryDeepReadError } from "@cosmos/application";
import { artifactReadSchema, deepReadGenerationSchema, storyDeepReadRevisionDetailSchema } from "@cosmos/contracts";
import type { Logger } from "@cosmos/logging";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryDeepReadController, type StoryDeepReadControl } from "./story-deep-read.controller.js";
import { RequestExceptionFilter, storyDeepReadBodyParserError } from "./request-logging.js";
import { configureModelConfigurationBodyParsers } from "./model-configuration-body-parser.js";

const generation = deepReadGenerationSchema.parse({ runId: "run/1", storyId: "story/1", status: "queued", modelId: "model-1",
    provider: null, model: null, createdAt: "2026-11-19T00:00:00.000Z", publishedRevision: null, errorCode: null });
function detail(revision = 1) {
    return storyDeepReadRevisionDetailSchema.parse({ artifactId: "artifact-1", storyId: "story/1", workflowRunId: `run-${revision}`,
        revision, headline: "Report", producer: "agent", producerVersion: "1", provider: "fake", model: "model", createdAt: generation.createdAt,
        contentHash: "a".repeat(64), sourceStatus: "current", sections: [{ id: "s1", heading: "Opinion", kind: "opinion", evidence: [],
            blocks: [{ id: "s1-b1", type: "paragraph", data: { inlines: [{ type: "text", text: "Report text" }] } }] }],
        input: { storyRevisionId: "sr-1", omittedSourceCount: 1, sources: [
            { entryId: "e-1", entryRevisionId: "er-1", representationVersion: 1, blockIds: ["b1"], includedCharacterCount: 12,
                truncated: false, omitted: false, reason: null },
            { entryId: "e-2", entryRevisionId: "er-2", representationVersion: null, blockIds: [], includedCharacterCount: 0,
                truncated: false, omitted: true, reason: "unavailable" },
        ] } });
}
function artifact(count = 50) {
    const revisions = Array.from({ length: count }, (_, index) => {
        const { sections: _sections, input: _input, ...summary } = detail(count - index);
        return summary;
    });
    return artifactReadSchema.parse({ artifact: { id: "artifact-1", storyId: "story/1", kind: "story-deep-read",
        generation, revisions, current: count ? detail(count) : null } });
}
const control = {
    enqueueStoryDeepRead: vi.fn<StoryDeepReadControl["enqueueStoryDeepRead"]>(),
    getDeepReadGeneration: vi.fn<StoryDeepReadControl["getDeepReadGeneration"]>(),
    getDeepReadArtifact: vi.fn<StoryDeepReadControl["getDeepReadArtifact"]>(),
    getDeepReadRevision: vi.fn<StoryDeepReadControl["getDeepReadRevision"]>(),
};
const logger: Logger = { child: () => logger, withContext: (_context, use) => use(),
    debug() {}, info() {}, warn() {}, error() {}, async close() {} };

describe("Story deep-read Product API", () => {
    let app: NestExpressApplication;
    let base: string;
    beforeAll(async () => {
        @Module({ controllers: [StoryDeepReadController], providers: [{ provide: "COSMOS_STORY_DEEP_READ_CONTROL", useValue: control }] })
        class TestModule {}
        app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false, bodyParser: false });
        configureModelConfigurationBodyParsers(app);
        app.use(storyDeepReadBodyParserError);
        app.setGlobalPrefix("api/v1");
        app.useGlobalFilters(new RequestExceptionFilter(logger));
        await app.listen(0, "127.0.0.1");
        base = `${await app.getUrl()}/api/v1/stories/story%2F1/deep-reads`;
    });
    afterAll(async () => { await app?.close(); });
    beforeEach(() => {
        vi.resetAllMocks();
        control.enqueueStoryDeepRead.mockResolvedValue(generation);
        control.getDeepReadGeneration.mockResolvedValue(generation);
        control.getDeepReadArtifact.mockResolvedValue({ artifact: null });
        control.getDeepReadRevision.mockResolvedValue(detail());
    });
    const post = (body: unknown = {}, key: string | null = " stable-key ") => fetch(base, {
        method: "POST", headers: { "content-type": "application/json", ...(key === null ? {} : { "Idempotency-Key": key }) }, body: JSON.stringify(body),
    });

    it.each(["{", '"PRIVATE_SOURCE_BODY"', "42", "null"])("normalizes raw parser failure %s to a strict safe envelope", async (body) => {
        const response = await fetch(`${base}?ignored=1`, { method: "POST", headers: { "content-type": "application/json" }, body });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ code: "validation_failed", message: "深入阅读请求正文无效。", retryable: false });
        expect(control.enqueueStoryDeepRead).not.toHaveBeenCalled();
    });
    it("normalizes oversized deep-read input while retaining 413", async () => {
        const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ modelId: "x".repeat(110_000) }) });
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ code: "validation_failed", message: "深入阅读请求正文无效。", retryable: false });
    });
    it("preserves the global error envelope on other paths", async () => {
        const response = await fetch(base.replace("/deep-reads", "/agent-candidates"), {
            method: "POST", headers: { "content-type": "application/json" }, body: "{",
        });
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toHaveProperty("requestId", expect.any(String));
        expect(body.code).toBe("validation_failed");
        expect(body.message).not.toBe("深入阅读请求正文无效。");
    });

    it("returns 202 for create/replay and passes normalized request only", async () => {
        for (let repeat = 0; repeat < 2; repeat++) {
            const response = await post({ modelId: " selected " });
            expect(response.status).toBe(202);
            expect(await response.json()).toEqual(generation);
        }
        expect(control.enqueueStoryDeepRead).toHaveBeenLastCalledWith({ storyId: "story/1", modelId: "selected", idempotencyKey: "stable-key" });
    });
    it("returns a failed Run as 200 with a safe errorCode", async () => {
        const failed = { ...generation, status: "failed" as const, errorCode: "timeout" as const };
        control.getDeepReadGeneration.mockResolvedValue(failed);
        const response = await fetch(`${base}/generations/run%2F1`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(failed);
        expect(control.getDeepReadGeneration).toHaveBeenCalledWith("story/1", "run/1");
    });
    it("returns strict artifact:null before the first request", async () => {
        const response = await fetch(base);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ artifact: null });
    });
    it("preserves active generation, current, 50 descending summaries and omission statistics", async () => {
        const expected = artifact();
        control.getDeepReadArtifact.mockResolvedValue(expected);
        const response = await fetch(base);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toEqual(expected);
        expect(body.artifact.revisions).toHaveLength(50);
        expect(body.artifact.revisions[0]).not.toHaveProperty("sections");
        expect(body.artifact.revisions[0]).not.toHaveProperty("input");
    });
    it("returns artifact identity with no published revision", async () => {
        control.getDeepReadArtifact.mockResolvedValue(artifact(0));
        expect(await (await fetch(base)).json()).toEqual(artifact(0));
    });
    it("reads an exact revision with source coverage intact", async () => {
        const response = await fetch(`${base}/revisions/1`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(detail());
        expect(control.getDeepReadRevision).toHaveBeenCalledWith("story/1", 1);
    });
    it.each([null, "", " ", "x".repeat(201)])("rejects invalid idempotency header %s before enqueue", async (key) => {
        const response = await post({}, key);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ code: "validation_failed", message: "Story deep read request invalid", retryable: false });
        expect(control.enqueueStoryDeepRead).not.toHaveBeenCalled();
    });
    it.each([{ connectionId: "private" }, { modelId: null }, { modelId: " " }, { modelId: "x".repeat(201) }])("rejects invalid strict body %j", async (body) => {
        expect((await post(body)).status).toBe(400);
        expect(control.enqueueStoryDeepRead).not.toHaveBeenCalled();
    });
    it.each(["0", "-1", "1.2", "01", "1e2", "9007199254740992", "abc"])("rejects revision %s", async (revision) => {
        expect((await fetch(`${base}/revisions/${revision}`)).status).toBe(400);
        expect(control.getDeepReadRevision).not.toHaveBeenCalled();
    });
    it("validates story and run IDs at the HTTP boundary", async () => {
        expect((await fetch(base.replace("story%2F1", "%20"))).status).toBe(400);
        expect((await fetch(`${base}/generations/${"r".repeat(201)}`)).status).toBe(400);
        expect(control.getDeepReadArtifact).not.toHaveBeenCalled();
        expect(control.getDeepReadGeneration).not.toHaveBeenCalled();
    });
    it.each([
        ["not_found", false, 404], ["conflict", false, 409], ["invalid_configuration", false, 400],
        ["malformed_payload", false, 400], ["dependency_unavailable", true, 503], ["dependency_unavailable", false, 500],
    ] as const)("maps %s (retryable %s) to %s with a strict local envelope", async (code, retryable, status) => {
        const error = new StoryDeepReadError(code, retryable);
        control.enqueueStoryDeepRead.mockRejectedValue(error);
        const response = await post();
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ code, message: error.message, retryable: status === 503 });
    });
    it.each(["generation", "artifact", "revision"] as const)("maps %s missing or mismatched ownership to 404", async (route) => {
        const error = new StoryDeepReadError("not_found");
        control.getDeepReadGeneration.mockRejectedValue(error);
        control.getDeepReadArtifact.mockRejectedValue(error);
        control.getDeepReadRevision.mockRejectedValue(error);
        const suffix = route === "generation" ? "/generations/run-2" : route === "revision" ? "/revisions/2" : "";
        const response = await fetch(`${base}${suffix}`);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ code: "not_found", message: error.message, retryable: false });
    });
    it("does not expose raw dependency exceptions", async () => {
        control.getDeepReadArtifact.mockRejectedValue(new Error("SECRET /private/path SOURCE BODY"));
        const response = await fetch(base);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ code: "dependency_unavailable", message: "Story deep read storage temporarily unavailable", retryable: false });
    });
    it("fails closed on contract-external data and excessive revision history", async () => {
        const poisonedGeneration = { ...generation, lease: "SECRET" };
        control.getDeepReadGeneration.mockResolvedValue(poisonedGeneration);
        const poisoned = await fetch(`${base}/generations/run-1`);
        expect(poisoned.status).toBe(500);
        expect(JSON.stringify(await poisoned.json())).not.toContain("SECRET");
        const valid = artifact();
        if (!valid.artifact) throw new Error("Expected artifact fixture");
        control.getDeepReadArtifact.mockResolvedValue({ artifact: { ...valid.artifact, revisions: [...valid.artifact.revisions, detail(51)] } });
        const excessive = await fetch(base);
        expect(excessive.status).toBe(500);
        expect(await excessive.json()).toHaveProperty("code", "dependency_unavailable");
    });
});
