import { describe, expect, it } from "vitest";

import {
    createSequenceFixtureConnector,
    parseRssXml,
} from "./index.js";

const firstPage = `<?xml version="1.0"?>
<rss version="2.0"><channel>
    <item>
        <guid>one</guid>
        <title>One</title>
        <link>https://example.test/one</link>
        <description>First item.</description>
        <pubDate>Fri, 07 Aug 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
        <title>No URL</title>
        <description>Second item.</description>
    </item>
</channel></rss>`;

const revisedPage = firstPage.replace("First item.", "Revised item.");

describe("RSS connector", () => {
    it("normalizes URL and URL-free RSS items", () => {
        const items = parseRssXml(firstPage, { provider: "fixture-rss" });

        expect(items).toHaveLength(2);
        expect(items[0].webUrl).toBe("https://example.test/one");
        expect(items[1].webUrl).toBeNull();
        expect(items[1].sourceLocator.externalId).toBeNull();
    });

    it("can deterministically replay a revised page", async () => {
        const connector = createSequenceFixtureConnector([
            firstPage,
            revisedPage,
        ]);
        const source = {
            id: "source-1",
            name: "Fixture",
            kind: "fixture-rss" as const,
            config: {},
            enabled: true,
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
            lastRunAt: null,
            lastError: null,
        };

        const first = await connector.fetchItems({ source, cursor: null });
        const second = await connector.fetchItems({
            source,
            cursor: first.nextCursor,
        });

        expect(first.items[0].contentText).toBe("First item.");
        expect(second.items[0].contentText).toBe("Revised item.");
    });
});
