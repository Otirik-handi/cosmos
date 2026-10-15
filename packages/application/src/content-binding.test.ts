import { describe, expect, it } from "vitest";
import { contentBlockSchema } from "@cosmos/contracts";
import type { StructuredSourceBlock } from "@cosmos/domain";
import { bindContentBlocks } from "./content-binding.js";

const image: StructuredSourceBlock = { type: "image", data: { sourceUrl: "https://example.test/image.png", alt: "figure" } };
const assets = [{ id: "asset-1", kind: "image" as const, sourceUrl: "https://example.test/image.png" }];

describe("content media binding", () => {
    it("preserves nested order with unique version-local block IDs and real asset references", () => {
        const input: StructuredSourceBlock[] = [
            { type: "quote", data: { blocks: [image] } },
            { type: "list", data: { ordered: false, items: [{ inlines: [], blocks: [image] }] } },
        ];
        const blocks = bindContentBlocks(input, assets);
        expect(blocks.map((block) => block.id)).toEqual(["block-1", "block-3"]);
        expect(blocks.every((block) => contentBlockSchema.safeParse(block).success)).toBe(true);
        expect(blocks[0]).toMatchObject({ data: { blocks: [{ id: "block-2", data: { assetId: "asset-1" } }] } });
        expect(blocks[1]).toMatchObject({ data: { items: [{ blocks: [{ id: "block-4", data: { assetId: "asset-1" } }] }] } });
        expect(bindContentBlocks(input, assets)).toEqual(blocks);
        expect(image.data).not.toHaveProperty("assetId");
    });

    it("rejects missing or mismatched media bindings instead of inventing IDs", () => {
        expect(() => bindContentBlocks([image], [])).toThrow("Content media binding missing for image");
        expect(() => bindContentBlocks([image], [{ ...assets[0], kind: "video" }])).toThrow("Content media binding missing for image");
    });
});
