import { describe, expect, it, vi } from "vitest";
import { ContentQuery, type ContentReadSource } from "./content-query.js";

const authority = { allowedProfiles: ["structured-content"] as const };
const representation = {
    id: "representation-1", entryRevisionId: "revision-1", representationVersion: 1,
    parserVersion: "test@1", status: "complete", blocks: [], contentText: "Parsed body",
    createdAt: "2026-10-08T12:00:00.000Z",
};
function source(overrides: Partial<ContentReadSource> = {}): ContentReadSource {
    return {
        entryId: "entry-1", entryRevisionId: "revision-1", contentText: "Legacy body",
        currentRepresentationId: representation.id, representation,
        evidenceStatus: "available", ...overrides,
    };
}

describe("ContentQuery", () => {
    it("checks host authority before any repository access", async () => {
        const readContentSource = vi.fn(async () => source());
        const query = new ContentQuery({ readContentSource });
        await expect(query.structuredContent({ entryRevisionId: "revision-1" }, { allowedProfiles: ["summary-only"] }))
            .rejects.toThrow("Content profile access denied: structured-content");
        expect(readContentSource).not.toHaveBeenCalled();
    });

    it("returns the actual immutable version with independent evidence availability", async () => {
        const query = new ContentQuery({ readContentSource: async () => source({ evidenceStatus: "deleted" }) });
        const result = await query.structuredContent({ entryRevisionId: "revision-1", representationVersion: 1 }, authority);
        expect(result).toMatchObject({ readingMode: "representation", contentText: "Parsed body", evidenceStatus: "deleted" });
        expect(result?.representation).toMatchObject({ id: "representation-1", representationVersion: 1 });
    });

    it("cleans legacy HTML but never substitutes legacy content for a missing historical version", async () => {
        const query = new ContentQuery({ readContentSource: async () => source({
            currentRepresentationId: null, representation: null,
            contentText: "<p>Readable</p><script>hidden()</script>",
        }) });
        expect(await query.structuredContent({ entryRevisionId: "revision-1" }, authority))
            .toMatchObject({ readingMode: "legacy-text", contentText: "Readable" });
        expect(await query.structuredContent({ entryRevisionId: "revision-1", representationVersion: 2 }, authority))
            .toMatchObject({ readingMode: "unavailable", contentText: "", evidenceStatus: "representation-unavailable" });
    });

    it("reports corrupt current data unavailable and rejects cross-owner or wrong-version records", async () => {
        const corrupt = new ContentQuery({ readContentSource: async () => source({ representation: { invalid: true } }) });
        expect(await corrupt.structuredContent({ entryRevisionId: "revision-1" }, authority))
            .toMatchObject({ readingMode: "unavailable", contentText: "" });
        const foreign = new ContentQuery({ readContentSource: async () => source({ representation: { ...representation, entryRevisionId: "foreign" } }) });
        await expect(foreign.structuredContent({ entryRevisionId: "revision-1" }, authority)).rejects.toThrow("another source revision");
        const wrongVersion = new ContentQuery({ readContentSource: async () => source() });
        await expect(wrongVersion.structuredContent({ entryRevisionId: "revision-1", representationVersion: 2 }, authority)).rejects.toThrow("version mismatch");
        await expect(wrongVersion.structuredContent({ entryRevisionId: "revision-1", representationVersion: 0 }, authority)).rejects.toThrow("Invalid content representation version");
    });
});
