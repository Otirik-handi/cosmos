import "reflect-metadata";
import type { StoryDeepReadSnapshotReader, StoryDeepReadWorkflowControl } from "@cosmos/application";
import { storyDetailSchema, type StoryDetail } from "@cosmos/contracts";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => {
    const readers: StoryDeepReadSnapshotReader[] = [];
    return { readers, story: vi.fn<(id: string) => Promise<StoryDetail | null>>() };
});
vi.mock("@cosmos/application", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@cosmos/application")>();
    return { ...actual, StoryDeepReadWorkflowControl: class {
        constructor(options: ConstructorParameters<typeof StoryDeepReadWorkflowControl>[0]) { captured.readers.push(options.stories); }
    } };
});
vi.mock("@cosmos/application/catalog", () => ({ createBuiltinManifestCatalog: () => ({}) }));
vi.mock("@cosmos/application/media-cleanup", () => ({ MediaCleanupWorkflowControlService: class {} }));
vi.mock("@cosmos/application/workflow-control", () => ({ IngestWorkflowControlService: class {} }));
vi.mock("@cosmos/storage-prisma", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@cosmos/storage-prisma")>();
    class Port {}
    return { ...actual,
        PrismaCosmosRepository: class { prisma = {}; story = captured.story; },
        PrismaWorkflowHostStore: Port, PrismaContentQueryRepository: Port, PrismaContentRebuildRepository: Port,
        PrismaContentSelectionRepository: Port, PrismaStoryAgentCandidateRepository: Port, PrismaStoryAgentFailureCodeReader: Port,
        PrismaSystemConfigRepository: Port, PrismaModelProviderQueryRepository: Port, PrismaConfiguredModelRepository: Port,
        PrismaModelProviderRemovalRepository: Port, PrismaProviderCredentialRepository: Port, PrismaProviderDiscoveryReader: Port,
    };
});
vi.mock("@cosmos/logging", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@cosmos/logging")>();
    return { ...actual, createLogger: () => ({}) };
});

// Import the production composition, replacing infrastructure constructors before they can perform I/O.
import "./app.module.js";

function storyDetail(count: number, withoutRevision = -1): StoryDetail {
    const entries = Array.from({ length: count }, (_, index) => ({ id: `entry-${index}`, sourceId: "source-1", sourceName: "Fixture",
        sourceKind: "rss", currentRevisionId: index === withoutRevision ? "" : `entry-revision-${index}`, metrics: null,
        revisions: [], observations: [], relatedStories: [], relations: [] }));
    return storyDetailSchema.parse({ story: { id: "story-1", kind: "event", subtype: null, revisionId: "story-revision-1", title: "Fixture",
        summary: null, producer: "human", status: "active", replacedBy: [] }, entry: entries[0], entries,
        entities: [], topics: [], labels: [], favorited: false, evidence: [] });
}
function reader(): StoryDeepReadSnapshotReader {
    expect(captured.readers).toHaveLength(1);
    const value = captured.readers[0];
    if (!value) throw new Error("Deep-read reader was not assembled");
    return value;
}

describe("AppModule deep-read snapshot reader", () => {
    it.each([1, 2, 3, 4, 5, 6, 7])("freezes %s members once in repository order despite the primary alias", async (count) => {
        const detail = storyDetail(count);
        expect(detail.entry?.id).toBe(detail.entries[0]?.id);
        captured.story.mockResolvedValue(detail);
        const snapshot = await reader().readStory("story-1");
        expect(snapshot).toEqual({ storyId: "story-1", storyRevisionId: "story-revision-1",
            sources: detail.entries.map((entry) => ({ entryId: entry.id, entryRevisionId: entry.currentRevisionId })) });
        expect(snapshot?.sources).toHaveLength(count);
        expect(snapshot?.sources.filter((source) => source.entryId === "entry-0")).toHaveLength(1);
        expect(captured.story).toHaveBeenLastCalledWith("story-1");
    });
    it("skips members without a revision, including the primary alias", async () => {
        captured.story.mockResolvedValue(storyDetail(3, 0));
        expect(await reader().readStory("story-1")).toEqual({ storyId: "story-1", storyRevisionId: "story-revision-1", sources: [
            { entryId: "entry-1", entryRevisionId: "entry-revision-1" }, { entryId: "entry-2", entryRevisionId: "entry-revision-2" },
        ] });
    });
    it("returns null for a missing Story", async () => {
        captured.story.mockResolvedValue(null);
        expect(await reader().readStory("missing")).toBeNull();
    });
});
