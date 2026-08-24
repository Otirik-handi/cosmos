import { describe, expect, it } from "vitest";

import { toReadableExcerpt } from "./feed-browser";

describe("toReadableExcerpt", () => {
    it("returns the fallback for empty values", () => {
        expect(toReadableExcerpt(null)).toBe("暂无摘要");
        expect(toReadableExcerpt(undefined)).toBe("暂无摘要");
        expect(toReadableExcerpt("")).toBe("暂无摘要");
    });

    it("returns the fallback when only tags and whitespace remain", () => {
        expect(toReadableExcerpt("<p>   </p>")).toBe("暂无摘要");
        expect(toReadableExcerpt("<br/>\n\t")).toBe("暂无摘要");
    });

    it("strips HTML tags from RSS summaries", () => {
        expect(toReadableExcerpt("<p>Hello <b>world</b></p>")).toBe("Hello world");
        expect(toReadableExcerpt('<a href="https://example.test">link</a> text')).toBe("link text");
    });

    it("collapses consecutive whitespace", () => {
        expect(toReadableExcerpt("第一段\n\n第二段\t\t续行")).toBe("第一段 第二段 续行");
    });

    it("decodes common HTML entities after stripping tags", () => {
        expect(toReadableExcerpt("A &amp; B")).toBe("A & B");
        expect(toReadableExcerpt("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe(
            "<script>alert(1)</script>",
        );
        expect(toReadableExcerpt("say &quot;hi&quot; &#65; &#x42;")).toBe("say \"hi\" A B");
    });

    it("keeps plain text unchanged", () => {
        expect(toReadableExcerpt("纯文本摘要，没有标签。")).toBe("纯文本摘要，没有标签。");
    });

    it("truncates very long text deterministically", () => {
        const longText = "内容".repeat(300);
        const excerpt = toReadableExcerpt(longText);
        expect(excerpt).toHaveLength(241);
        expect(excerpt.startsWith("内容".repeat(120))).toBe(true);
        expect(excerpt.endsWith("…")).toBe(true);
    });
});
