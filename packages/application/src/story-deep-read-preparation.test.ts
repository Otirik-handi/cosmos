import { describe, expect, it, vi } from "vitest";
import { ContentQuery } from "./content-query.js";
import { prepareStoryDeepRead, type StoryDeepReadSnapshotReader } from "./story-deep-read-preparation.js";
import { runStoryDeepReadWorkflow } from "./story-deep-read-workflow.js";
import type { ContentReadSource } from "./content-query.js";

function fixture(texts: readonly (readonly string[] | null)[]) {
    const sources = texts.map((_, index) => ({ entryId: `e${index}`, entryRevisionId: `r${index}` }));
    const stories: StoryDeepReadSnapshotReader = { readStory: async () => ({ storyId: "story", storyRevisionId: "sr", sources }) };
    const readContentSource = vi.fn(async ({ entryRevisionId }: { entryRevisionId: string }): Promise<ContentReadSource | null> => {
        const index = sources.findIndex((source) => source.entryRevisionId === entryRevisionId);
        const blocks = texts[index];
        if (blocks === null || blocks === undefined) return null;
        return { entryId: `e${index}`, entryRevisionId, currentRepresentationId: `rep${index}`, contentText: "SHOULD_NOT_COPY_CONTENTTEXT",
            evidenceStatus: "available", representation: { id: `rep${index}`, entryRevisionId, representationVersion: 2,
                parserVersion: "test", status: "complete", contentText: "SHOULD_NOT_COPY_REPRESENTATION_TEXT",
                blocks: blocks.map((text, i) => ({ id: `b${index}-${i}`, type: "paragraph", data: { inlines: [{ type: "text", text }] } })),
                createdAt: "2026-11-19T00:00:00.000Z" } };
    });
    return { stories, content: new ContentQuery({ readContentSource }), readContentSource };
}
function prepare(texts: readonly (readonly string[] | null)[]) {
    const f = fixture(texts);
    return prepareStoryDeepRead(f.stories, f.content, "story", "resolved-model", 300_000);
}

describe("deep read preparation", () => {
    it("freezes one normalized body copy and only identities in input", async () => {
        const result = await prepare([["ONE_UNIQUE_SOURCE_BODY  \n   second"]]);
        expect(result).toMatchObject({ kind: "story-deep-read", resolvedModelId: "resolved-model",
            budget: { maxDurationMs: 300_000, maxToolCalls: 0, maxOutputTokens: 6000 },
            input: { storyRevisionId: "sr", sources: [{ blockIds: ["b0-0"], includedCharacterCount: 29, omitted: false, truncated: false, reason: null }] } });
        const serialized = JSON.stringify(result);
        expect(serialized.match(/ONE_UNIQUE_SOURCE_BODY/g)).toHaveLength(1);
        expect(JSON.stringify(result.input)).not.toContain("SOURCE_BODY");
        expect(serialized).not.toContain("SHOULD_NOT_COPY");
        expect(Object.keys(result).sort()).toEqual(["budget", "input", "kind", "messages", "resolvedModelId", "storyId"]);
        expect(result.messages[0]?.content).toContain("untrusted evidence");
        expect(result.messages[0]?.content).toContain("Every fact section");
        expect(result.messages[0]?.content).toContain("No HTML");
        expect(result.messages[0]?.content).toContain("Do not use tools");
    });
    it("cuts at a block boundary and omits a source whose first block exceeds its budget", async () => {
        const result = await prepare([["a".repeat(8000), "b".repeat(5000), "later"], ["x".repeat(12001), "small"], ["usable"]]);
        expect(result.input.sources).toMatchObject([
            { includedCharacterCount: 8000, truncated: true, omitted: false, reason: "budget", blockIds: ["b0-0"] },
            { includedCharacterCount: 0, truncated: false, omitted: true, reason: "budget", blockIds: [] },
            { includedCharacterCount: 6, omitted: false },
        ]);
        expect(result.input.omittedSourceCount).toBe(1);
        expect(result.messages[1]?.content).not.toContain("later");
        expect(result.messages[1]?.content).not.toContain("small");
    });
    it("caps total at 60k and only considers the first eight without replacement", async () => {
        const f = fixture(Array.from({ length: 10 }, () => ["x".repeat(12000)]));
        const result = await prepareStoryDeepRead(f.stories, f.content, "story", "model", 1000);
        expect(f.readContentSource).toHaveBeenCalledTimes(8);
        expect(result.input.sources).toHaveLength(8);
        expect(result.input.sources.reduce((sum, source) => sum + source.includedCharacterCount, 0)).toBe(60000);
        expect(result.input.sources.slice(5).every((source) => source.omitted && source.reason === "budget")).toBe(true);
        expect(result.input.omittedSourceCount).toBe(5);
        expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(65000);
    });
    it("records unavailable and empty sources, using null only for unknown representation", async () => {
        const result = await prepare([null, ["   "], ["last"]]);
        expect(result.input.sources).toMatchObject([
            { representationVersion: null, omitted: true, blockIds: [], includedCharacterCount: 0, reason: "unavailable" },
            { representationVersion: 2, omitted: true, reason: "no_usable_block" },
            { representationVersion: 2, omitted: false },
        ]);
        expect(result.input.omittedSourceCount).toBe(2);
    });
    it("omits a failed source read and fails safely when none remain", async () => {
        const f = fixture([["ok"], ["other"]]);
        f.readContentSource.mockRejectedValueOnce(new Error("PRIVATE_SOURCE_ERROR"));
        const result = await prepareStoryDeepRead(f.stories, f.content, "story", "model", 1000);
        expect(result.input.sources[0]).toMatchObject({ omitted: true, reason: "unavailable", representationVersion: null });
        expect(JSON.stringify(result)).not.toContain("PRIVATE_SOURCE_ERROR");
        await expect(prepare([])).rejects.toMatchObject({ code: "invalid_configuration" });
        await expect(prepare([null, [" \n"]])).rejects.toMatchObject({ code: "invalid_configuration" });
    });
    it("only exposes nonempty top-level block identities and rejects nested evidence", async () => {
        const f = fixture([["placeholder"]]);
        f.readContentSource.mockResolvedValueOnce({ entryId: "e0", entryRevisionId: "r0", currentRepresentationId: "rep0",
            contentText: "", evidenceStatus: "available", representation: { id: "rep0", entryRevisionId: "r0", representationVersion: 2,
                parserVersion: "test", status: "complete", contentText: "", createdAt: "2026-11-19T00:00:00.000Z", blocks: [
                    { id: "parent", type: "quote", data: { blocks: [
                        { id: "nested-text", type: "paragraph", data: { inlines: [{ type: "text", text: "Nested text" }] } },
                        { id: "nested-media", type: "image", data: { assetId: "asset", alt: "not evidence text" } },
                        { id: "nested-blank", type: "paragraph", data: { inlines: [{ type: "text", text: "  " }] } },
                    ] } },
                    { id: "top-blank", type: "paragraph", data: { inlines: [{ type: "text", text: " " }] } },
                    { id: "top-media", type: "video", data: { assetId: "video", title: "not evidence text" } },
                ] } });
        const prepared = await prepareStoryDeepRead(f.stories, f.content, "story", "model", 1000);
        expect(prepared.input.sources[0]?.blockIds).toEqual(["parent"]);
        expect(prepared.messages[1]?.content).toContain("Nested text");
        for (const id of ["nested-text", "nested-media", "nested-blank", "top-blank", "top-media"]) {
            expect(prepared.messages[1]?.content).not.toContain(id);
        }
        for (const blockId of ["nested-text", "nested-media", "nested-blank", "parent"]) {
            const publish = vi.fn(async () => ({ published: true }));
            const result = runStoryDeepReadWorkflow(prepared, async (ref) => {
                if (ref === "artifact.publish@1") return publish();
                return { content: JSON.stringify({ headline: "Report", sections: [{ heading: "Fact", kind: "fact", blocks: [],
                    evidence: [{ entryId: "e0", entryRevisionId: "r0", representationVersion: 2, blockId }] }] }),
                    toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: "fake", model: "fake", finishReason: "stop" };
            });
            if (blockId === "parent") { await expect(result).resolves.toEqual({ published: true }); expect(publish).toHaveBeenCalledOnce(); }
            else { await expect(result).rejects.toMatchObject({ code: "malformed_payload" }); expect(publish).not.toHaveBeenCalled(); }
        }
    });
    it("requires the requested Story current snapshot", async () => {
        await expect(prepareStoryDeepRead({ readStory: async () => null }, fixture([]).content, "story", "model", 1000))
            .rejects.toMatchObject({ code: "not_found" });
    });
});
