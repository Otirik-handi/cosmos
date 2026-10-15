import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ContentRebuild, StoryAgent, StoryAgentService, ContentCommands, ContentQuery, StoryAgentCandidates, StoryAgentCandidateError } from "@cosmos/application";
import { AppController } from "./app.controller.js";

function setup() {
    const readContentSource = vi.fn(async () => ({
        entryId: "entry-1", entryRevisionId: "revision-1", currentRepresentationId: null,
        contentText: "<p>Readable</p><script>danger()</script>", representation: null,
        evidenceStatus: "available" as const,
    }));
    const controller = new AppController({} as never, {} as never, undefined, undefined,
        undefined, undefined, undefined, new ContentQuery({ readContentSource }));
    return { controller, readContentSource };
}

describe("structured content endpoint", () => {
    it("rebuilds retained input with host authority and rejects request-controlled input", async () => {
        const readRebuildSource = vi.fn(async () => ({ currentRepresentationId: "rep-1", locked: true,
            source: { format: "plain-text", text: "Retained content" } as unknown }));
        const commitRebuild = vi.fn(async () => ({ representationId: "rep-2", representationVersion: 2, promoted: false }));
        const controller = new AppController({} as never, {} as never, undefined, undefined, undefined,
            undefined, undefined, undefined, undefined, undefined, undefined, new ContentRebuild({ readRebuildSource, commitRebuild }));
        await expect(controller.rebuildRevisionContent("revision-1", { actorId: "agent" })).rejects.toBeInstanceOf(BadRequestException);
        expect(readRebuildSource).not.toHaveBeenCalled();
        await expect(controller.rebuildRevisionContent("revision-1", {})).resolves.toMatchObject({ representationVersion: 2, promoted: false });
        expect(commitRebuild).toHaveBeenCalledWith(expect.objectContaining({ actorId: "user", expectedCurrentId: "rep-1", expectedLocked: true }));
        await expect(setup().controller.rebuildRevisionContent("revision-1", {})).rejects.toMatchObject({ status: 409 });
        readRebuildSource.mockResolvedValueOnce({ currentRepresentationId: "rep-1", locked: true, source: null });
        await expect(controller.rebuildRevisionContent("revision-1", {})).rejects.toMatchObject({ status: 409 });
    });
    it("generates only a pending candidate with host-owned Agent configuration", async () => {
        const invoke = vi.fn(async () => ({ content: JSON.stringify({ task: "story.summarize", title: "Suggested", summary: "Summary", keyFacts: [] }),
            toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: "fake", model: "fixture", finishReason: "stop" as const, metadata: {} }));
        const save = vi.fn(async (candidate: import("@cosmos/contracts").StoryAgentCandidate) => ({ candidate, status: "pending" as const }));
        const decide = vi.fn(async (): Promise<never> => { throw new Error("Unexpected formal decision"); });
        const candidates = new StoryAgentCandidates({ save, decide, list: async () => [] });
        const agent = new StoryAgent({ readStory: async () => ({ storyId: "story-1", storyRevisionId: "sr-1", title: "Original", summary: "", entryRevisionIds: [] }) },
            new ContentQuery({ readContentSource: async () => { throw new Error("Unexpected source read"); } }), { invoke });
        const service = new StoryAgentService(agent, candidates, { authority: { allowedProfiles: ["summary-only"] },
            provider: "fake", model: "fixture", budget: { maxDurationMs: 1000, maxToolCalls: 0, maxOutputTokens: 1000 },
            createCandidateId: () => "candidate-1", now: () => new Date("2026-10-08T12:00:00.000Z") });
        const controller = new AppController({} as never, {} as never, undefined, undefined, undefined,
            undefined, undefined, undefined, undefined, candidates, service);
        await expect(controller.proposeStoryAgentCandidate("story-1", { task: "story.summarize", provider: "attacker" })).rejects.toBeInstanceOf(BadRequestException);
        expect(invoke).not.toHaveBeenCalled();
        await expect(controller.proposeStoryAgentCandidate("story-1", { task: "story.summarize" })).resolves.toMatchObject({ status: "pending", candidate: { storyRevisionId: "sr-1", inputSources: [] } });
        expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ provider: "fake", model: "fixture", tools: [] }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(save).toHaveBeenCalledOnce();
        expect(decide).not.toHaveBeenCalled();
        await expect(setup().controller.proposeStoryAgentCandidate("story-1", { task: "story.summarize" })).rejects.toMatchObject({ status: 409 });
    });
    it("lists candidates and rejects request-controlled decision authority", async () => {
        const list = vi.fn(async () => []);
        const decide = vi.fn(async () => { throw new StoryAgentCandidateError("conflict", "Story candidate decision conflict"); });
        const candidates = new StoryAgentCandidates({ list, decide, save: async () => { throw new Error("unused"); } });
        const controller = new AppController({} as never, {} as never, undefined, undefined,
            undefined, undefined, undefined, undefined, undefined, candidates);
        await expect(controller.listStoryAgentCandidates("story-1")).resolves.toEqual([]);
        expect(list).toHaveBeenCalledWith("story-1");
        await expect(controller.decideStoryAgentCandidate("candidate-1", { decision: "accept", actorId: "agent" })).rejects.toBeInstanceOf(BadRequestException);
        expect(decide).not.toHaveBeenCalled();
        await expect(controller.decideStoryAgentCandidate("candidate-1", { decision: "reject" })).rejects.toMatchObject({ status: 409 });
        expect(decide).toHaveBeenCalledWith({ candidateId: "candidate-1", decision: "reject", actorId: "user" });
        decide.mockRejectedValueOnce(new StoryAgentCandidateError("not_found", "Story candidate not found"));
        await expect(controller.decideStoryAgentCandidate("missing", { decision: "accept" })).rejects.toBeInstanceOf(NotFoundException);
        decide.mockRejectedValueOnce(new Error("Database unavailable"));
        await expect(controller.decideStoryAgentCandidate("candidate-1", { decision: "accept" })).rejects.toThrow("Database unavailable");
    });
    it("validates selection bodies and uses host management authority", async () => {
        const readSelection = vi.fn(async () => ({ entryRevisionId: "revision-1", currentRepresentationId: null, locked: false, target: null }));
        const commitSelection = vi.fn(async () => ({ currentRepresentationId: null, locked: true, changed: true }));
        const controller = new AppController({} as never, {} as never, undefined, undefined,
            undefined, undefined, undefined, undefined, new ContentCommands({ readSelection, commitSelection }));
        const command = { operation: "lock", expectedCurrentId: null, expectedLocked: false };
        await expect(controller.selectRevisionContent("revision-1", { ...command, actorId: "agent" })).rejects.toBeInstanceOf(BadRequestException);
        expect(readSelection).not.toHaveBeenCalled();
        await expect(controller.selectRevisionContent("revision-1", command)).resolves.toMatchObject({ locked: true });
        expect(commitSelection).toHaveBeenCalledWith(expect.objectContaining({ actorId: "user", command: { ...command, entryRevisionId: "revision-1" } }));
    });
    it("sanitizes legacy text and grants only the host reading profile", async () => {
        const { controller } = setup();
        const result = await controller.revisionContent("revision-1");
        expect(result.readingMode).toBe("legacy-text");
        expect(result.contentText).toBe("Readable");
        expect(result).not.toHaveProperty("rawPayload");
    });

    it("keeps a missing historical representation unavailable", async () => {
        const { controller, readContentSource } = setup();
        const result = await controller.revisionContent("revision-1", { representationVersion: "4" });
        expect(readContentSource).toHaveBeenCalledWith({ entryRevisionId: "revision-1", representationVersion: 4 });
        expect(result.readingMode).toBe("unavailable");
        expect(result.contentText).toBe("");
    });

    it("rejects invalid versions and request-controlled authority before storage", async () => {
        const { controller, readContentSource } = setup();
        for (const query of [{ representationVersion: "0" }, { representationVersion: "1.5" },
            { representationVersion: "9007199254740992" }, { allowedProfiles: ["media-bytes"] }]) {
            await expect(controller.revisionContent("revision-1", query)).rejects.toBeInstanceOf(BadRequestException);
        }
        expect(readContentSource).not.toHaveBeenCalled();
    });

    it("reports a missing revision as 404", async () => {
        const controller = new AppController({} as never, {} as never, undefined, undefined,
            undefined, undefined, undefined, new ContentQuery({ readContentSource: async () => null }));
        await expect(controller.revisionContent("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
});
