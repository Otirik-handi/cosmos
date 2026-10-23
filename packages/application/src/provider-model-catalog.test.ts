import { describe, expect, it } from "vitest";

import { parseProviderModelCatalog, providerModelCatalogLimits } from "./provider-model-catalog.js";

describe("parseProviderModelCatalog", () => {
    it("keeps only the documented candidate fields and defaults a missing name to the id", () => {
        expect(parseProviderModelCatalog({
            object: "list",
            data: [
                { id: "gpt-x", name: "GPT X", owned_by: "someone", created: 1 },
                { id: "text-embedding-3", owned_by: "someone" },
            ],
        })).toEqual({
            ok: true,
            candidates: [
                { modelId: "gpt-x", name: "GPT X" },
                { modelId: "text-embedding-3", name: "text-embedding-3" },
            ],
        });
    });

    it("drops duplicate and unusable entries instead of failing the whole listing", () => {
        const result = parseProviderModelCatalog({
            data: [
                { id: "gpt-x", name: "GPT X" },
                { id: "gpt-x", name: "GPT X again" },
                { id: "   " },
                { id: "https://provider.example/model", name: "unsafe" },
                { name: "no id" },
            ],
        });
        expect(result).toEqual({ ok: true, candidates: [{ modelId: "gpt-x", name: "GPT X" }] });
    });

    it("rejects malformed bodies, empty listings and oversized listings", () => {
        expect(parseProviderModelCatalog(null)).toEqual({ ok: false, errorCode: "malformed_response" });
        expect(parseProviderModelCatalog({ models: [] })).toEqual({ ok: false, errorCode: "malformed_response" });
        expect(parseProviderModelCatalog({ data: [] })).toEqual({ ok: false, errorCode: "empty_result" });
        expect(parseProviderModelCatalog({ data: [{ id: "   " }] })).toEqual({ ok: false, errorCode: "empty_result" });

        const oversized = {
            data: Array.from({ length: providerModelCatalogLimits.maxCandidates + 1 }, (_, index) => ({
                id: `model-${index}`,
            })),
        };
        expect(parseProviderModelCatalog(oversized)).toEqual({ ok: false, errorCode: "response_too_large" });
    });

    it("accepts exactly the candidate cap", () => {
        const boundary = {
            data: Array.from({ length: providerModelCatalogLimits.maxCandidates }, (_, index) => ({ id: `model-${index}` })),
        };
        const result = parseProviderModelCatalog(boundary);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.candidates).toHaveLength(providerModelCatalogLimits.maxCandidates);
    });
});
