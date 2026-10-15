import type { ContentBlock, StructuredSourceBlock } from "@cosmos/domain";

export interface ContentAssetBinding {
    id: string;
    kind: "image" | "video" | "audio";
    sourceUrl: string;
}

/** Bind only persisted assets from this revision; callers supply the transaction's created records. */
export function bindContentBlocks(
    blocks: readonly StructuredSourceBlock[],
    assets: readonly ContentAssetBinding[],
): readonly ContentBlock[] {
    let sequence = 0;
    const bySource = new Map<string, string>();
    for (const asset of assets) {
        const key = JSON.stringify([asset.kind, asset.sourceUrl]);
        if (!bySource.has(key)) bySource.set(key, asset.id);
    }
    function bind(block: StructuredSourceBlock): ContentBlock {
        const id = `block-${++sequence}`;
        const common = { id, source: block.source, warnings: block.warnings };
        switch (block.type) {
            case "quote":
                return { ...common, type: "quote", data: { blocks: block.data.blocks.map(bind) } };
            case "list":
                return {
                    ...common, type: "list", data: {
                        ordered: block.data.ordered,
                        items: block.data.items.map((item) => ({
                            inlines: item.inlines,
                            ...(item.blocks === undefined ? {} : { blocks: item.blocks.map(bind) }),
                        })),
                    },
                };
            case "image":
            case "video":
            case "audio": {
                const assetId = bySource.get(JSON.stringify([block.type, block.data.sourceUrl]));
                if (!assetId) throw new Error(`Content media binding missing for ${block.type}`);
                return { ...common, ...block, data: { ...block.data, assetId } };
            }
            default:
                return { ...common, ...block };
        }
    }
    return blocks.map(bind);
}
