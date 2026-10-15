import type { NormalizedAssetInput, NormalizedIngestItem, StructuredSourceBlock } from "@cosmos/domain";
import { adaptLegacyContentText, normalizeContent, type ContentDraft } from "./content-normalizer.js";

export interface PreparedContentItem {
    item: NormalizedIngestItem;
    draft: ContentDraft;
}

/** Discover body media before acquisition so existing media policy governs every source asset. */
export function prepareContentItem(item: NormalizedIngestItem): PreparedContentItem {
    const draft = item.contentSource === undefined
        ? adaptLegacyContentText(item.contentText)
        : normalizeContent(item.contentSource);
    const assets: NormalizedAssetInput[] = [...item.assets];
    const keys = new Set(assets.map((asset) => JSON.stringify([asset.kind, asset.sourceUrl])));
    function visit(blocks: readonly StructuredSourceBlock[]): void {
        for (const block of blocks) {
            if (block.type === "quote") visit(block.data.blocks);
            else if (block.type === "list") {
                for (const child of block.data.items) visit(child.blocks ?? []);
            } else if (block.type === "image" || block.type === "video" || block.type === "audio") {
                const key = JSON.stringify([block.type, block.data.sourceUrl]);
                if (keys.has(key)) continue;
                keys.add(key);
                assets.push({
                    kind: block.type,
                    sourceUrl: block.data.sourceUrl,
                    status: "metadata_only",
                    mimeType: null,
                    byteSize: null,
                    content: null,
                });
            }
        }
    }
    visit(draft.blocks);
    return { item: { ...item, contentText: draft.contentText, assets }, draft };
}
