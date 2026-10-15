import { describe, expect, it } from "vitest";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { prepareContentItem } from "./content-ingest.js";

function item(): NormalizedIngestItem {
    return {
        title: "Article", summary: null, contentText: "old text", webUrl: null,
        kind: "article", publisher: null, metrics: null, publishedAt: null,
        sourceLocator: {}, rawPayload: "evidence", assets: [],
    };
}

describe("content ingest preparation", () => {
    it("discovers nested body media once without replacing existing acquisition state", () => {
        const input = item();
        input.contentSource = { format: "safe-html-input", html: "<blockquote>before<img src='https://example.test/a.png'>after</blockquote><img src='https://example.test/a.png'><audio src='https://example.test/a.mp3'></audio>" };
        input.assets = [{ kind: "image", sourceUrl: "https://example.test/a.png", status: "failed", mimeType: null, byteSize: null, content: null, errorCode: "timeout" }];
        const prepared = prepareContentItem(input);
        expect(prepared.item.assets).toHaveLength(2);
        expect(prepared.item.assets[0]).toEqual(input.assets[0]);
        expect(prepared.item.assets[1]).toMatchObject({ kind: "audio", status: "metadata_only", content: null });
        expect(prepared.item.contentText).toContain("before");
        expect(prepared.item.rawPayload).toBe("evidence");
        expect(input.contentText).toBe("old text");
        expect(input.assets).toHaveLength(1);
    });

    it("keeps a legacy plain-text source usable", () => {
        const prepared = prepareContentItem(item());
        expect(prepared.item.contentText).toBe("old text");
        expect(prepared.draft.blocks[0]?.type).toBe("paragraph");
        expect(prepared.item.contentSource).toBeUndefined();
    });
});
