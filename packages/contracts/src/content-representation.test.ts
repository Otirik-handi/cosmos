import { describe, expect, it } from "vitest";

import {
    contentBlockSchema,
    contentEvidenceSchema,
    contentInputBudget,
    contentRepresentationSchema,
    contentSourceSchema,
} from "./content-representation.js";

describe("content representation contracts", () => {
    it("accepts all three content source formats", () => {
        expect(contentSourceSchema.safeParse({ format: "plain-text", text: "hello" }).success).toBe(true);
        expect(contentSourceSchema.safeParse({ format: "safe-html-input", html: "<p>hello</p>", baseUrl: "https://example.com/a" }).success).toBe(true);
        expect(contentSourceSchema.safeParse({ format: "structured-source-content", blocks: [{ type: "paragraph", data: { inlines: [] } }] }).success).toBe(true);
    });

    it("passes oversized source text to Normalizer for partial ingestion", () => {
        const text = "中".repeat(contentInputBudget.maxBytes);
        expect(contentSourceSchema.safeParse({ format: "plain-text", text }).success).toBe(true);
        expect(contentSourceSchema.safeParse({ format: "safe-html-input", html: text }).success).toBe(true);
    });

    it("rejects dangerous URL protocols and non-contract fields", () => {
        expect(contentSourceSchema.safeParse({ format: "safe-html-input", html: "x", baseUrl: "javascript:alert(1)" }).success).toBe(false);
        expect(contentBlockSchema.safeParse({ id: "i", type: "image", data: { assetId: "asset-1", sourceUrl: "data:text/plain,x" } }).success).toBe(false);
        expect(contentBlockSchema.safeParse({ id: "p", type: "paragraph", data: { inlines: [] }, status: "saved" }).success).toBe(false);
    });

    it("keeps media references separate from asset state and enforces budgets", () => {
        const image = contentBlockSchema.safeParse({ id: "i", type: "image", data: { assetId: "asset-1", sourceUrl: "https://example.com/a.png", alt: "a" } });
        expect(image.success).toBe(true);
        expect(contentBlockSchema.safeParse({ id: "i", type: "image", data: { assetId: "asset-1", sourceUrl: "https://example.com/" + "a".repeat(contentInputBudget.maxUrlLength) } }).success).toBe(false);
    });

    it("separates source media locators from persisted asset references", () => {
        const source = { type: "image", data: { sourceUrl: "https://example.com/image.png" } };
        expect(contentSourceSchema.safeParse({ format: "structured-source-content", blocks: [source] }).success).toBe(true);
        expect(contentBlockSchema.safeParse({ id: "image-1", ...source }).success).toBe(false);
        expect(contentBlockSchema.safeParse({ id: "image-1", type: "image", data: { assetId: "asset-1" } }).success).toBe(true);
        expect(contentSourceSchema.safeParse({ format: "structured-source-content", blocks: [
            { type: "image", data: { sourceUrl: "https://example.com/image.png", assetId: "asset-1" } },
        ] }).success).toBe(false);
    });

    it("bounds recursive lists and rejects excessive depth without throwing", () => {
        let block: unknown = { id: "paragraph", type: "paragraph", data: { inlines: [] } };
        for (let depth = 0; depth < contentInputBudget.maxListDepth; depth++) {
            block = { id: `list-${depth}`, type: "list", data: { ordered: false, items: [{ inlines: [], blocks: [block] }] } };
        }
        expect(contentBlockSchema.safeParse(block).success).toBe(true);
        block = { id: "list-overflow", type: "list", data: { ordered: false, items: [{ inlines: [], blocks: [block] }] } };
        expect(contentBlockSchema.safeParse(block).success).toBe(false);
        for (let depth = 0; depth < 100; depth++) {
            block = { id: `quote-${depth}`, type: "quote", data: { blocks: [block] } };
        }
        expect(() => contentBlockSchema.safeParse(block)).not.toThrow();
        expect(contentBlockSchema.safeParse(block).success).toBe(false);
    });

    it("validates representation and evidence version binding", () => {
        expect(contentRepresentationSchema.safeParse({
            id: "representation-1", entryRevisionId: "rev-1", representationVersion: 1, parserVersion: "parser@1", status: "complete",
            blocks: [{ id: "p", type: "paragraph", data: { inlines: [{ type: "text", text: "hi" }] } }], contentText: "hi",
            createdAt: "2026-10-08T00:00:00.000Z",
        }).success).toBe(true);
        expect(contentEvidenceSchema.safeParse({ entryId: "e", entryRevisionId: "r", representationVersion: 1, status: "available" }).success).toBe(true);
        expect(contentEvidenceSchema.safeParse({ entryId: "e", entryRevisionId: "r", representationVersion: 1, blockId: "p", status: "available" }).success).toBe(true);
        expect(contentEvidenceSchema.safeParse({ entryId: "e", entryRevisionId: "r", representationVersion: 1, blockId: "", status: "available" }).success).toBe(false);
        expect(contentEvidenceSchema.safeParse({ entryId: "e", entryRevisionId: "r", representationVersion: 0, status: "available" }).success).toBe(false);
    });
});
