import { describe, expect, it, vi } from "vitest";
import type { StoryAgentCandidate } from "@cosmos/contracts";
import { StoryAgentCandidates, type StoryAgentCandidateRepository } from "./story-agent-candidates.js";

const candidate: StoryAgentCandidate = {
    id: "candidate-1", storyId: "story-1", storyRevisionId: "story-revision-1",
    producer: "agent", producerVersion: "story-agent@1", provider: "fake", model: "fake",
    inputSources: [], confidence: null,
    proposal: { task: "story.summarize", title: "Title", summary: "Summary", keyFacts: [] },
    createdAt: "2026-10-08T00:00:00.000Z",
};

function setup() {
    const repository: StoryAgentCandidateRepository = {
        save: vi.fn<StoryAgentCandidateRepository["save"]>(async (value) => ({ candidate: value, status: "pending" })),
        list: vi.fn<StoryAgentCandidateRepository["list"]>(async () => [{ candidate, status: "pending" }]),
        decide: vi.fn<StoryAgentCandidateRepository["decide"]>(async () => ({ candidate, status: "accepted" })),
    };
    return { repository, service: new StoryAgentCandidates(repository) };
}

const authority = { actorId: "user", canManageCandidates: true };

describe("Story Agent candidate boundary", () => {
    it("validates provenance and preserves a pending proposal without a formal write", async () => {
        const { repository, service } = setup();
        expect(await service.save(candidate)).toEqual({ candidate, status: "pending" });
        expect(repository.save).toHaveBeenCalledWith(candidate);
        expect(repository.decide).not.toHaveBeenCalled();
        await expect(service.save({ ...candidate, confidence: 2 })).rejects.toThrow();
        expect(repository.save).toHaveBeenCalledTimes(1);
    });

    it("checks read permission and story identity before listing candidates", async () => {
        const { repository, service } = setup();
        await expect(service.list(candidate.storyId, { allowedProfiles: [] })).rejects.toThrow("Content profile access denied");
        await expect(service.list(" ", { allowedProfiles: ["summary-only"] })).rejects.toThrow("Invalid Story candidate story ID");
        expect(repository.list).not.toHaveBeenCalled();
        expect(await service.list(candidate.storyId, { allowedProfiles: ["summary-only"] }))
            .toEqual([{ candidate, status: "pending" }]);
        expect(repository.list).toHaveBeenCalledWith(candidate.storyId);
    });

    it("denies management before repository access", async () => {
        const { repository, service } = setup();
        await expect(service.decide(candidate.id, "accept", { ...authority, canManageCandidates: false }))
            .rejects.toThrow("Story candidate management access denied");
        await expect(service.decide(candidate.id, "reject", { ...authority, actorId: " " }))
            .rejects.toThrow("Story candidate management access denied");
        expect(repository.decide).not.toHaveBeenCalled();
    });

    it("passes only the host actor and explicit human decision to atomic persistence", async () => {
        const { repository, service } = setup();
        await service.decide(candidate.id, "accept", authority);
        expect(repository.decide).toHaveBeenLastCalledWith({ candidateId: candidate.id, decision: "accept", actorId: "user" });
        await service.decide(candidate.id, "reject", authority);
        expect(repository.decide).toHaveBeenLastCalledWith({ candidateId: candidate.id, decision: "reject", actorId: "user" });
    });

    it("rejects an empty candidate ID and propagates stale acceptance conflicts", async () => {
        const { repository, service } = setup();
        await expect(service.decide(" ", "accept", authority)).rejects.toThrow("Invalid Story candidate decision");
        expect(repository.decide).not.toHaveBeenCalled();
        vi.mocked(repository.decide).mockRejectedValueOnce(new Error("Story candidate input changed"));
        await expect(service.decide(candidate.id, "accept", authority)).rejects.toThrow("Story candidate input changed");
    });
});
