import { describe, expect, it } from "vitest";

import { createLogger } from "@cosmos/logging";

import {
    createRssConnector,
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
        <author>RSS author</author>
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
        expect(items[0].kind).toBe("article");
        expect(items[0].publisher).toMatchObject({
            platformId: null,
            name: "RSS author",
            kind: "unknown",
        });
        expect(items[1].webUrl).toBeNull();
        expect(items[1].publisher).toBeNull();
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

    it("logs a response body failure without recording its contents", async () => {
        const lines: string[] = [];
        const logger = createLogger({
            service: "rss-test",
            output: "stdout",
            stdoutWriter: (line) => lines.push(line),
        });
        const connector = createRssConnector({
            fetch: async () => ({
                ok: true,
                status: 200,
                text: async () => {
                    throw new Error('response body token=LEAK');
                },
            } as unknown as Response),
            logger,
        });

        await expect(connector.fetchItems({
            source: {
                id: "source-rss",
                name: "RSS",
                kind: "rss",
                config: { feedUrl: "https://example.test/feed.xml" },
                enabled: true,
                createdAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
                lastRunAt: null,
                lastError: null,
            },
            cursor: null,
        })).rejects.toThrow("RSS response could not be parsed.");
        await logger.close();

        const failed = lines
            .map((line) => JSON.parse(line) as Record<string, unknown>)
            .find((record) => record.event === "connector.transport.failed");
        expect(failed).toMatchObject({
            connectorId: "rss",
            errorCode: "malformed_payload",
        });
        expect(lines.join("\n")).not.toContain("LEAK");
    });
});
