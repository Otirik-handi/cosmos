"use client";

import { useState, type ReactNode } from "react";
import type { ContentBlockContract, PublicAssetSnapshot } from "@cosmos/contracts";

import { RevisionAssets } from "./story-panel/revision-assets";
import { messages } from "@/copy/messages";

const copy = messages.reading.content;

type Inline = Extract<ContentBlockContract, { type: "paragraph" }> ["data"]["inlines"][number];

import { safeContentUrl } from "@/lib/content-url";

function InlineContent({ inlines }: { inlines: readonly Inline[] }): ReactNode {
    return inlines.map((inline, index) => {
        switch (inline.type) {
            case "strong": return <strong key={index}><InlineContent inlines={inline.inlines} /></strong>;
            case "emphasis": return <em key={index}><InlineContent inlines={inline.inlines} /></em>;
            case "code": return <code key={index} className="rounded bg-muted px-1 font-mono text-[0.9em]">{inline.text}</code>;
            case "link": return safeContentUrl(inline.url)
                ? <a key={index} href={safeContentUrl(inline.url)} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">{inline.text}</a>
                : <span key={index}>{inline.text}</span>;
            case "text": return <span key={index}>{inline.text}</span>;
        }
    });
}

function MediaBlock({ block, assets }: {
    block: Extract<ContentBlockContract, { type: "image" | "video" | "audio" }>;
    assets: ReadonlyMap<string, PublicAssetSnapshot>;
}) {
    const [imageFailed, setImageFailed] = useState(false);
    const asset = assets.get(block.data.assetId);
    if (!asset) {
        const sourceUrl = safeContentUrl(block.data.sourceUrl);
        return <div className="my-4" data-asset-status="asset-missing">
            <p role="status" className="text-sm text-muted-foreground">{copy.assetMissing}</p>
            {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">{copy.mediaOriginal}</a>}
        </div>;
    }
    if (block.type === "image" && asset.kind === "image" && asset.status === "saved") {
        const sourceUrl = safeContentUrl(block.data.sourceUrl) ?? safeContentUrl(asset.sourceUrl);
        return <figure className="my-5" data-asset-id={asset.id} data-asset-status="saved">
            <img src={`/api/v1/assets/${encodeURIComponent(asset.id)}`} alt={block.data.alt ?? ""} loading="lazy" hidden={imageFailed} onError={() => setImageFailed(true)} className="max-h-[70vh] w-full object-contain" />
            {imageFailed && <div className="rounded border border-border p-3 text-sm">
                <p role="status" className="text-muted-foreground">{copy.imageLoadFailed}</p>
                {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">{copy.mediaOriginal}</a>}
            </div>}
            {block.data.caption && <figcaption className="mt-2 text-center text-sm text-muted-foreground">{block.data.caption}</figcaption>}
        </figure>;
    }
    return <RevisionAssets assets={[asset]} />;
}

function Block({ block, assets }: { block: ContentBlockContract; assets: ReadonlyMap<string, PublicAssetSnapshot> }): ReactNode {
    switch (block.type) {
        case "heading": {
            const Heading = block.data.level <= 2 ? "h2" : block.data.level === 3 ? "h3" : "h4";
            return <Heading className="mt-7 mb-3 font-display text-xl font-semibold"><InlineContent inlines={block.data.inlines} /></Heading>;
        }
        case "paragraph": return <p className="my-4 whitespace-pre-wrap"><InlineContent inlines={block.data.inlines} /></p>;
        case "quote": return <blockquote className="my-5 border-l-2 border-border pl-5 text-muted-foreground"><Blocks blocks={block.data.blocks} assets={assets} /></blockquote>;
        case "list": {
            const List = block.data.ordered ? "ol" : "ul";
            return <List className={`my-4 pl-6 ${block.data.ordered ? "list-decimal" : "list-disc"}`}>
                {block.data.items.map((item, index) => <li key={index} className="my-2"><InlineContent inlines={item.inlines} />{item.blocks && <Blocks blocks={item.blocks} assets={assets} />}</li>)}
            </List>;
        }
        case "code": return <pre className="my-5 overflow-x-auto rounded bg-muted p-4 text-sm"><code>{block.data.text}</code></pre>;
        case "image": case "audio": case "video": return <MediaBlock key={`${block.type}:${block.data.assetId}`} block={block} assets={assets} />;
        case "embed": return <p className="my-4"><a href={safeContentUrl(block.data.url)} target="_blank" rel="noreferrer" className="text-primary underline">{block.data.title ?? copy.embed(block.data.provider)}</a></p>;
        case "table": return <div className="my-5 overflow-x-auto"><table className="w-full border-collapse text-sm">
            <thead><tr>{block.data.columns.map((column, index) => <th key={index} scope="col" className="border border-border p-2 text-left">{column}</th>)}</tr></thead>
            <tbody>{block.data.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className="border border-border p-2 align-top">{cell}</td>)}</tr>)}</tbody>
        </table></div>;
        case "divider": return <hr className="my-6 border-border" />;
        case "unknown": return <aside className="my-4 rounded border border-border p-3 text-sm"><p>{block.data.text}</p><p className="text-muted-foreground">{copy.unknown}</p></aside>;
    }
}

function Blocks({ blocks, assets }: { blocks: readonly ContentBlockContract[]; assets: ReadonlyMap<string, PublicAssetSnapshot> }) {
    return blocks.map((block) => <div key={block.id} data-content-block={block.type} data-block-id={block.id}><Block block={block} assets={assets} /></div>);
}

export function ContentBlockReader({ blocks, assets }: { blocks: readonly ContentBlockContract[]; assets: readonly PublicAssetSnapshot[] }) {
    return <div className="min-w-0 text-[16px] leading-[1.8] [overflow-wrap:anywhere]"><Blocks blocks={blocks} assets={new Map(assets.map((asset) => [asset.id, asset]))} /></div>;
}
