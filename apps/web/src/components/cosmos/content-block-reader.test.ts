import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContentBlockContract, PublicAssetSnapshot } from "@cosmos/contracts";

import { ContentBlockReader } from "./content-block-reader";

const paragraph = (id: string, text: string): ContentBlockContract => ({
    id, type: "paragraph", data: { inlines: [{ type: "text", text }] },
});
const asset: PublicAssetSnapshot = {
    id: "image/one", kind: "image", status: "saved", sourceUrl: "https://example.com/image.png",
    mimeType: "image/png", byteSize: 12,
};
function render(blocks: readonly ContentBlockContract[], assets: readonly PublicAssetSnapshot[] = []) {
    return renderToStaticMarkup(createElement(ContentBlockReader, { blocks, assets }));
}

describe("ordered content reader", () => {
    it("keeps saved media between source paragraphs and uses local bytes", () => {
        const html = render([
            paragraph("before", "before-image"),
            { id: "image", type: "image", data: { assetId: asset.id, alt: "source alt", caption: "caption" } },
            paragraph("after", "after-image"),
        ], [asset]);
        expect(html.indexOf("before-image")).toBeLessThan(html.indexOf("<figure"));
        expect(html.indexOf("</figure>")).toBeLessThan(html.indexOf("after-image"));
        expect(html).toContain('/api/v1/assets/image%2Fone');
        expect(html).toContain('alt="source alt"');
        expect(html).not.toContain("https://example.com/image.png");
    });

    it("escapes source text and refuses executable links and embeds", () => {
        const html = render([
            paragraph("text", "<script>alert(1)</script>"),
            { id: "link", type: "paragraph", data: { inlines: [{ type: "link", text: "unsafe", url: "javascript:alert(1)" }] } },
            { id: "embed", type: "embed", data: { provider: "unknown", url: "data:text/html,unsafe", title: "embed title" } },
        ]);
        expect(html).toContain("&lt;script&gt;");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("data:text/html");
        expect(html).not.toContain("<iframe");
    });

    it("keeps a missing asset block readable and links its safe source URL", () => {
        const html = render([
            paragraph("before", "before-missing"),
            { id: "missing", type: "image", data: { assetId: "absent", sourceUrl: "https://example.com/original.png", alt: "original image" } },
            paragraph("after", "after-missing"),
        ]);
        expect(html).toContain('data-asset-status="asset-missing"');
        expect(html).toContain("媒体资源缺失");
        expect(html).toContain('href="https://example.com/original.png"');
        expect(html).toContain("查看原文外链");
        expect(html.indexOf("before-missing")).toBeLessThan(html.indexOf("媒体资源缺失"));
        expect(html.indexOf("媒体资源缺失")).toBeLessThan(html.indexOf("after-missing"));
        expect(html).not.toContain("<img");
    });

    it("does not expose an unsafe source URL for a missing asset", () => {
        const html = render([
            { id: "missing", type: "video", data: { assetId: "absent", sourceUrl: "javascript:alert(1)", title: "video" } },
        ]);
        expect(html).toContain('data-asset-status="asset-missing"');
        expect(html).toContain("媒体资源缺失");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("href=");
        expect(html).not.toContain("<video");
    });

    it("uses the asset source URL when a media block omits its own URL", () => {
        const html = render([
            { id: "image", type: "image", data: { assetId: asset.id } },
        ], [asset]);
        expect(html).toContain('src="/api/v1/assets/image%2Fone"');
        expect(html).not.toContain("查看原文外链");
        expect(html).not.toContain("javascript:");
    });

    it("shows failed media in place without inventing a download", () => {
        const html = render([
            paragraph("before", "before-failure"),
            { id: "image", type: "image", data: { assetId: asset.id } },
            paragraph("after", "after-failure"),
        ], [{ ...asset, status: "failed", errorMessage: "download unavailable", sourceUrl: "javascript:alert(1)" }]);
        expect(html.indexOf("before-failure")).toBeLessThan(html.indexOf("download unavailable"));
        expect(html.indexOf("download unavailable")).toBeLessThan(html.indexOf("after-failure"));
        expect(html).not.toContain("<img");
        expect(html).not.toContain("href=");
    });

    it("preserves nested media and renders unknown readable content", () => {
        const html = render([
            { id: "quote", type: "quote", data: { blocks: [paragraph("nested", "quoted text"), { id: "missing", type: "audio", data: { assetId: "missing" } }] } },
            { id: "unknown", type: "unknown", data: { text: "readable remainder", reason: "unsupported" } },
        ]);
        expect(html).toContain("<blockquote");
        expect(html).toContain("quoted text");
        expect(html).toContain('data-asset-status="asset-missing"');
        expect(html).toContain("媒体资源缺失");
        expect(html).toContain("readable remainder");
    });
});
