import { describe, expect, it } from "vitest";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { stageIngestBlobs } from "./ingest-blob-staging.js";

function item(): NormalizedIngestItem {
    return {
        title: "Article", summary: null, contentText: "body", webUrl: null,
        kind: "article", publisher: null, metrics: null, publishedAt: null,
        sourceLocator: {}, rawPayload: "evidence", assets: [
            { kind: "image", sourceUrl: "https://example.test/a", status: "saved", mimeType: "image/png", byteSize: 99, content: new Uint8Array([1, 2]) },
            { kind: "audio", sourceUrl: "https://example.test/b", status: "metadata_only", mimeType: null, byteSize: null, content: null },
        ],
    };
}

describe("ingest blob staging", () => {
    it("stages evidence and saved bytes, leaving metadata and the input unchanged", async () => {
        const input = item();
        const writes: { bytes: Uint8Array; mimeType: string | null | undefined }[] = [];
        const result = await stageIngestBlobs(input, {
            async put(bytes, options) {
                writes.push({ bytes, mimeType: options.mimeType });
                return { key: `blob-${writes.length}`, byteSize: bytes.byteLength };
            },
        });
        expect(writes).toHaveLength(2);
        expect(new TextDecoder().decode(writes[0]?.bytes)).toBe("evidence");
        expect(writes[1]?.mimeType).toBe("image/png");
        expect(result.assets[0]).toMatchObject({ storageKey: "blob-2", byteSize: 2 });
        expect(result.assets[1]).toMatchObject({ storageKey: null, status: "metadata_only" });
        expect(input.assets[0]?.byteSize).toBe(99);
    });

    it("retains the declared parsing input separately from raw evidence", async () => {
        const input = { ...item(), contentSource: { format: "safe-html-input" as const, html: "<p>source</p>", baseUrl: "https://example.test/article" } };
        const writes: Uint8Array[] = [];
        const result = await stageIngestBlobs(input, {
            async put(bytes) {
                writes.push(bytes);
                return { key: `blob-${writes.length}`, byteSize: bytes.byteLength };
            },
        });
        expect(result.rawPayload.key).toBe("blob-1");
        expect(result.contentSource?.key).toBe("blob-2");
        expect(JSON.parse(new TextDecoder().decode(writes[1]))).toEqual(input.contentSource);
        expect(new TextDecoder().decode(writes[0])).toBe(input.rawPayload);
    });

    it("propagates write failures before any database binding can begin", async () => {
        await expect(stageIngestBlobs(item(), {
            async put() { throw new Error("blob unavailable"); },
        })).rejects.toThrow("blob unavailable");
    });
});
