import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { configuredModelSnapshotSchema, storyDeepReadRevisionDetailSchema, type StoryDeepReadRevisionDetail } from "@cosmos/contracts";
import { StoryDeepReadWorkflowControl, storyDeepReadRequestHash } from "./story-deep-read-workflow-control.js";
import { StoryDeepReadError, type StoryDeepReadSnapshot } from "./story-deep-read-preparation.js";
import type { StoryDeepReadStore, EnqueueStoryDeepReadInput } from "./story-deep-read-store.js";
import type { WorkflowEnvelope } from "./workflow-host.js";

const time = "2026-11-19T00:00:00.000Z";
const frozen: StoryDeepReadSnapshot = { kind: "story-deep-read", storyId: "story", resolvedModelId: "selected",
    input: { storyRevisionId: "sr", sources: [{ entryId: "e", entryRevisionId: "r", representationVersion: 1,
        blockIds: ["b"], includedCharacterCount: 4, truncated: false, omitted: false, reason: null }], omittedSourceCount: 0 },
    messages: [{ role: "user", content: "BODY" }], budget: { maxDurationMs: 300000, maxToolCalls: 0, maxOutputTokens: 6000 } };
function detail(runId: string) {
    return storyDeepReadRevisionDetailSchema.parse({ artifactId: "artifact", storyId: "story", workflowRunId: runId, revision: 1,
        headline: "Report", sections: [{ id: "s1", heading: "View", kind: "opinion", blocks: [], evidence: [] }], input: frozen.input,
        contentHash: "a".repeat(64), producer: "agent", producerVersion: "story-deep-read@1", provider: "actual-provider", model: "actual-model",
        createdAt: time, sourceStatus: "current", cost: { input: 0, output: 0, total: 0, currency: "USD" } });
}
function fixture() {
    let run: WorkflowEnvelope | null = null;
    let hash: string | null = null;
    let revision: StoryDeepReadRevisionDetail | null = null;
    const model = configuredModelSnapshotSchema.parse({ id: "selected", providerId: "p", modelId: "upstream", name: "Model",
        contextWindow: 64000, maxOutputTokens: 6000, version: 1, createdAt: time, updatedAt: time });
    const systemConfig = { getDefaultModelId: vi.fn(async (): Promise<string | null> => "selected"),
        getModelSelection: vi.fn(async (): Promise<{ model: typeof model; providerState: string | null } | null> => ({ model, providerState: "active" })), getStoryAgentTimeoutSeconds: vi.fn(async () => 300) };
    const stories = { readStory: vi.fn(async () => ({ storyId: "story", storyRevisionId: "sr", sources: [{ entryId: "e", entryRevisionId: "r" }] })) };
    const content = { structuredContent: vi.fn(async () => ({ entryId: "e", entryRevisionId: "r", contentText: "BODY",
        readingMode: "representation" as const, evidenceStatus: "available" as const, representation: { id: "rep", entryRevisionId: "r",
            representationVersion: 1, parserVersion: "test", status: "complete" as const, contentText: "BODY", createdAt: time,
            blocks: [{ id: "b", type: "paragraph" as const, data: { inlines: [{ type: "text" as const, text: "BODY" }] } }] } })) };
    const enqueueStoryDeepRead = vi.fn(async (input: EnqueueStoryDeepReadInput) => {
        if (run) {
            if (input.requestHash !== hash || input.storyId !== "story" || input.idempotencyKey !== run.idempotencyKey) throw new StoryDeepReadError("conflict");
            return { run, artifactId: "artifact", reused: true };
        }
        hash = input.requestHash;
        run = { ...input, idempotencyKey: input.idempotencyKey ?? null, status: "queued", resumeRequired: false,
            createdAt: time, updatedAt: time, startedAt: null, finishedAt: null };
        return { run, artifactId: "artifact", reused: false };
    });
    const store: StoryDeepReadStore = { findStoryDeepReadRequest: vi.fn(async (key) => run && run.idempotencyKey === key && hash
        ? { storyId: "story", requestHash: hash, run } : null), enqueueStoryDeepRead, publishStoryDeepReadRevision: async () => { throw new Error("unexpected publish"); },
        findStoryDeepReadRevisionByRun: vi.fn(async () => revision),
        getStoryDeepReadRevision: vi.fn(async () => { if (!revision) throw new StoryDeepReadError("not_found"); return revision; }),
        getStoryDeepReadArtifact: vi.fn(async (): ReturnType<StoryDeepReadStore["getStoryDeepReadArtifact"]> => {
            if (!run) return null;
            const { sections: _sections, input: _input, ...summary } = revision ?? detail(run.runId);
            return { id: "artifact", storyId: "story", kind: "story-deep-read", current: revision, revisions: revision ? [summary] : [],
                generation: { runId: run.runId, storyId: "story", status: "queued", modelId: "selected", provider: null, model: null,
                    createdAt: time, publishedRevision: null, errorCode: null } };
        }) };
    const workflows = { loadWorkflowEnvelope: vi.fn(async () => run), findWorkflowEnvelopeByIdempotencyKey: vi.fn(async () => run) };
    const failureCodes = { getStoryAgentFailureCode: vi.fn(async (): Promise<string | null> => "PRIVATE_PROVIDER_ERROR") };
    const control = new StoryDeepReadWorkflowControl({ store, workflows, stories, content, systemConfig, failureCodes });
    return { control, store, workflows, stories, content, systemConfig, failureCodes, enqueueStoryDeepRead,
        updateRun: (change: Partial<WorkflowEnvelope>) => { if (!run) throw new Error("no run"); run = { ...run, ...change }; },
        publish: (value?: StoryDeepReadRevisionDetail) => { if (!run) throw new Error("no run"); revision = value ?? detail(run.runId); } };
}
const request = { storyId: "story", idempotencyKey: "key" };

describe("deep read workflow control", () => {
    it("hashes canonical raw selection, separating omitted and explicit default requests", () => {
        const expected = createHash("sha256").update('{"modelId":null,"storyId":"story"}').digest("hex");
        expect(storyDeepReadRequestHash("story")).toBe(expected);
        expect(storyDeepReadRequestHash("story", "selected")).not.toBe(expected);
    });
    it("resolves the default model and freezes one source body, timeout and minimal product projection", async () => {
        const f = fixture();
        expect(await f.control.enqueueStoryDeepRead(request)).toMatchObject({ status: "queued", modelId: "selected", publishedRevision: null });
        expect(f.systemConfig.getModelSelection).toHaveBeenCalledWith("selected");
        expect(f.enqueueStoryDeepRead).toHaveBeenCalledOnce();
        const input = f.enqueueStoryDeepRead.mock.calls[0]![0];
        expect(input.definition).toMatchObject({ key: "cosmos.story-deep-read", version: "1" });
        expect(input.inputSnapshot).toMatchObject({ resolvedModelId: "selected", budget: { maxDurationMs: 300000, maxOutputTokens: 6000 } });
        expect(JSON.stringify(input.inputSnapshot).match(/BODY/g)).toHaveLength(1);
        expect(input.productRun).toEqual({ storyId: "story", status: "queued" });
        expect(input.requestHash).toBe(storyDeepReadRequestHash("story"));
    });
    it("restores the same key even if current models and sources are unavailable", async () => {
        const f = fixture();
        const first = await f.control.enqueueStoryDeepRead(request);
        f.stories.readStory.mockRejectedValue(new Error("do not reprepare"));
        f.systemConfig.getDefaultModelId.mockResolvedValue(null);
        expect(await f.control.enqueueStoryDeepRead(request)).toEqual(first);
        expect(f.stories.readStory).toHaveBeenCalledOnce();
        expect(f.systemConfig.getDefaultModelId).toHaveBeenCalledOnce();
        expect(f.enqueueStoryDeepRead).toHaveBeenCalledOnce();
        await expect(f.control.enqueueStoryDeepRead({ ...request, storyId: "other" })).rejects.toMatchObject({ code: "conflict" });
        await expect(f.control.enqueueStoryDeepRead({ ...request, modelId: "different" })).rejects.toMatchObject({ code: "conflict" });
    });
    it("rejects a different key before resolving disabled defaults or unavailable sources", async () => {
        const f = fixture();
        await f.control.enqueueStoryDeepRead(request);
        f.systemConfig.getDefaultModelId.mockResolvedValue(null);
        f.stories.readStory.mockRejectedValue(new Error("SOURCE_UNAVAILABLE"));
        for (const status of ["queued", "running"] as const) {
            const artifact = await f.store.getStoryDeepReadArtifact("story");
            if (!artifact?.generation) throw new Error("fixture missing active artifact");
            vi.mocked(f.store.getStoryDeepReadArtifact).mockResolvedValueOnce({ ...artifact,
                generation: { ...artifact.generation, status } });
            await expect(f.control.enqueueStoryDeepRead({ ...request, idempotencyKey: `different-${status}` }))
                .rejects.toMatchObject({ code: "conflict" });
        }
        expect(f.systemConfig.getDefaultModelId).toHaveBeenCalledOnce();
        expect(f.stories.readStory).toHaveBeenCalledOnce();
        expect(f.enqueueStoryDeepRead).toHaveBeenCalledOnce();
    });
    it("maps missing Story to not_found while preserving existing Story without artifact", async () => {
        const f = fixture();
        expect(await f.control.getDeepReadArtifact("story")).toEqual({ artifact: null });
        vi.mocked(f.store.getStoryDeepReadArtifact).mockRejectedValue(new StoryDeepReadError("not_found"));
        await expect(f.control.getDeepReadArtifact("missing")).rejects.toMatchObject({ code: "not_found" });
        await expect(f.control.enqueueStoryDeepRead({ ...request, storyId: "missing" })).rejects.toMatchObject({ code: "not_found" });
        expect(f.systemConfig.getDefaultModelId).not.toHaveBeenCalled();
        expect(f.enqueueStoryDeepRead).not.toHaveBeenCalled();
    });
    it("uses an explicit model without reading defaults and rejects inactive/missing selection before enqueue", async () => {
        const f = fixture();
        await f.control.enqueueStoryDeepRead({ ...request, modelId: "selected" });
        expect(f.systemConfig.getDefaultModelId).not.toHaveBeenCalled();
        const invalid = fixture();
        const selection = await invalid.systemConfig.getModelSelection();
        if (!selection) throw new Error("fixture missing model");
        invalid.systemConfig.getModelSelection.mockResolvedValueOnce(null);
        await expect(invalid.control.enqueueStoryDeepRead(request)).rejects.toMatchObject({ code: "invalid_configuration" });
        invalid.systemConfig.getModelSelection.mockResolvedValueOnce({ ...selection, providerState: "disabled" });
        await expect(invalid.control.enqueueStoryDeepRead(request)).rejects.toMatchObject({ code: "invalid_configuration" });
        expect(invalid.enqueueStoryDeepRead).not.toHaveBeenCalled();
    });
    it("prioritizes publication over Workflow failure and keeps successful cost/provenance", async () => {
        const f = fixture();
        const queued = await f.control.enqueueStoryDeepRead(request);
        f.publish(); f.updateRun({ status: "failed" });
        const generation = await f.control.getDeepReadGeneration("story", queued.runId);
        expect(generation).toMatchObject({ status: "completed", publishedRevision: 1, provider: "actual-provider", model: "actual-model",
            errorCode: null, cost: { total: 0 } });
        expect(generation).not.toHaveProperty("sections");
        expect(generation).not.toHaveProperty("input");
        const artifact = await f.control.getDeepReadArtifact("story");
        expect(artifact.artifact).toMatchObject({ generation: null, current: { revision: 1 }, revisions: [{ revision: 1 }] });
        expect(artifact.artifact?.revisions[0]).not.toHaveProperty("sections");
        expect(await f.control.getDeepReadRevision("story", 1)).toMatchObject({ revision: 1, sourceStatus: "current" });
        await expect(f.control.getDeepReadGeneration("other", queued.runId)).rejects.toMatchObject({ code: "not_found" });
        await expect(f.control.getDeepReadRevision("other", 1)).rejects.toMatchObject({ code: "not_found" });
    });
    it("never reports completed without publication and uses only safe failure codes", async () => {
        const f = fixture();
        const queued = await f.control.enqueueStoryDeepRead(request);
        f.updateRun({ status: "completed" });
        expect(await f.control.getDeepReadGeneration("story", queued.runId)).toMatchObject({ status: "failed", publishedRevision: null, errorCode: "generation_failed" });
        f.failureCodes.getStoryAgentFailureCode.mockResolvedValue("rate_limited"); f.updateRun({ status: "failed" });
        expect(await f.control.getDeepReadGeneration("story", queued.runId)).toMatchObject({ status: "failed", errorCode: "rate_limited" });
        expect(f.failureCodes.getStoryAgentFailureCode).toHaveBeenCalledWith(queued.runId, "cosmos.story-deep-read");
        f.updateRun({ status: "cancelled" });
        expect(await f.control.getDeepReadArtifact("story")).toMatchObject({ artifact: { generation: null } });
        f.updateRun({ status: "waiting" });
        expect(await f.control.getDeepReadArtifact("story")).toMatchObject({ artifact: { generation: { status: "running" } } });
    });
    it("returns the initial empty read and sanitizes storage exceptions", async () => {
        const f = fixture();
        expect(await f.control.getDeepReadArtifact("story")).toEqual({ artifact: null });
        await expect(f.control.getDeepReadGeneration("story", "missing")).rejects.toMatchObject({ code: "not_found" });
        vi.mocked(f.store.getStoryDeepReadArtifact).mockRejectedValue(new Error("PRIVATE_DATABASE_PATH"));
        await expect(f.control.getDeepReadArtifact("story")).rejects.toMatchObject({ code: "dependency_unavailable", message: "Story deep read storage temporarily unavailable" });
        await expect(f.control.enqueueStoryDeepRead({ ...request, idempotencyKey: " " })).rejects.toMatchObject({ code: "validation_failed" });
    });
});
