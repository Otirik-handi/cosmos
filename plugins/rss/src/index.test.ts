import { describe, expect, it } from "vitest";

import { createLogger } from "@cosmos/logging";
import type { ConnectorStateHandle } from "@cosmos/application";

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
    it("sends stored validators and skips the body on 304 (AUT-003)", async () => {
        const requests: Array<{ url: string; headers: Record<string, string> }> = [];
        const connector = createRssConnector({
            fetch: async (input, init) => {
                requests.push({
                    url: String(input),
                    headers: (init?.headers ?? {}) as Record<string, string>,
                });
                return requests.length === 1
                    ? new Response(firstPage, {
                        status: 200,
                        headers: {
                            etag: 'W/"feed-v1"',
                            "last-modified": "Fri, 07 Aug 2026 12:00:00 GMT",
                        },
                    })
                    : new Response(null, { status: 304 });
            },
        });
        const source = {
            id: "source-rss",
            name: "RSS",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            kind: "rss",
            config: { feedUrl: "https://example.test/feed.xml" },
            enabled: true,
            mediaPolicy: null,
            planId: "plan:source-rss",
            revisionId: "source-rss:1",
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
        } as const;
        // 宿主注入的命名空间化状态句柄：这里用内存版记录读写。
        const entries = new Map<string, { value: unknown; version: number }>();
        const state: ConnectorStateHandle = {
            get: async (key) => {
                const entry = entries.get(key);
                return entry ? { value: entry.value as never, version: entry.version } : null;
            },
            put: async (key, value, expectedVersion) => {
                expect(expectedVersion).toBe(entries.get(key)?.version ?? null);
                const version = (expectedVersion ?? 0) + 1;
                entries.set(key, { value, version });
                return { version };
            },
        };

        const first = await connector.fetchItems({ source, cursor: null, state });
        expect(first.items).toHaveLength(2);
        expect(entries.get("http-cache")?.value).toEqual({
            etag: 'W/"feed-v1"',
            lastModified: "Fri, 07 Aug 2026 12:00:00 GMT",
        });

        const second = await connector.fetchItems({
            source,
            cursor: first.nextCursor,
            state,
        });
        // 304 = 没有变化：不下载正文、不解析、cursor 不变。
        expect(second.items).toHaveLength(0);
        expect(second.nextCursor).toBe(first.nextCursor);
        expect(requests[1]?.headers["If-None-Match"]).toBe('W/"feed-v1"');
        expect(requests[1]?.headers["If-Modified-Since"]).toBe("Fri, 07 Aug 2026 12:00:00 GMT");
    });

    it("falls back to an unconditional fetch when no state handle is injected", async () => {
        const requests: Array<Record<string, string>> = [];
        const connector = createRssConnector({
            fetch: async (_input, init) => {
                requests.push((init?.headers ?? {}) as Record<string, string>);
                return new Response(firstPage, { status: 200 });
            },
        });

        const page = await connector.fetchItems({
            source: {
                id: "source-rss",
                name: "RSS",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                connectorId: "rss",
                kind: "rss",
                config: { feedUrl: "https://example.test/feed.xml" },
                enabled: true,
                mediaPolicy: null,
                planId: "plan:source-rss",
                revisionId: "source-rss:1",
                createdAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
            },
            cursor: null,
        });

        expect(page.items).toHaveLength(2);
        expect(requests[0]?.["If-None-Match"]).toBeUndefined();
        expect(requests[0]?.["If-Modified-Since"]).toBeUndefined();
    });

    it("normalizes URL and URL-free RSS items", () => {
        const items = parseRssXml(firstPage, { provider: "fixture-rss" });

        expect(items).toHaveLength(2);
        expect(items[0].webUrl).toBe("https://example.test/one");
        expect(items[0].kind).toBe("article");
        // RSS 是订阅式来源（ING-004）。
        expect(items[0].discoveryChannel).toBe("account");
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
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            connectorId: "fixture-rss",
            kind: "fixture-rss" as const,
            config: {},
            enabled: true,
            mediaPolicy: null,
            planId: "plan:source-1",
            revisionId: "source-1:1",
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
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
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                connectorId: "rss",
                kind: "rss",
                config: { feedUrl: "https://example.test/feed.xml" },
                enabled: true,
                mediaPolicy: null,
                planId: "plan:source-rss",
                revisionId: "source-rss:1",
                createdAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
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

const mediaFeed = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item>
        <guid>media-1</guid>
        <title>Media item</title>
        <link>https://example.test/post/a</link>
        <description>See body.</description>
        <enclosure url="https://example.test/cosmos/media.png" type="image/png" length="2048"/>
        <media:content url="https://cdn.example.test/movie.mp4" type="video/mp4" fileSize="999"/>
        <media:thumbnail url="https://cdn.example.test/thumb.jpg" type="image/jpeg"/>
        <content:encoded><![CDATA[
            <p>Hello</p>
            <img src="https://cdn.example.test/a.jpg" alt="a"/>
            <img src="/img/relative.png"/>
            <audio src="https://cdn.example.test/song.mp3"></audio>
            <video src="https://cdn.example.test/movie.mp4"></video>
        ]]></content:encoded>
    </item>
</channel></rss>`;

describe("RSS media extraction (ADR-0005)", () => {
    it("extracts enclosure, media namespace and body media candidates", () => {
        const [entry] = parseRssXml(mediaFeed, { provider: "rss", feedUrl: "https://example.test/feed.xml" });
        const assets = entry.assets;

        const enclosure = assets.find((item) => item.sourceUrl === "https://example.test/cosmos/media.png");
        expect(enclosure).toMatchObject({
            kind: "image",
            status: "metadata_only",
            mimeType: "image/png",
            byteSize: 2048,
            content: null,
        });

        const bodyImage = assets.find((item) => item.sourceUrl === "https://cdn.example.test/a.jpg");
        expect(bodyImage?.kind).toBe("image");

        const relativeResolved = assets.find((item) => item.sourceUrl === "https://example.test/img/relative.png");
        expect(relativeResolved?.kind).toBe("image");

        const audio = assets.find((item) => item.sourceUrl === "https://cdn.example.test/song.mp3");
        expect(audio?.kind).toBe("audio");

        const video = assets.find((item) => item.sourceUrl === "https://cdn.example.test/movie.mp4");
        expect(video).toMatchObject({ kind: "video", status: "metadata_only" });

        const thumbnail = assets.find((item) => item.sourceUrl === "https://cdn.example.test/thumb.jpg");
        expect(thumbnail).toMatchObject({ kind: "image", mimeType: "image/jpeg" });

        for (const item of assets) {
            expect(item.status).toBe("metadata_only");
            expect(item.content).toBeNull();
        }
    });

    it("deduplicates identical media URLs into one candidate", () => {
        const feed = mediaFeed.replace(
            '<img src="/img/relative.png"/>',
            '<img src="https://example.test/cosmos/media.png"/>',
        );
        const [entry] = parseRssXml(feed, { provider: "rss", feedUrl: "https://example.test/feed.xml" });
        const matches = entry.assets.filter(
            (item) => item.sourceUrl === "https://example.test/cosmos/media.png",
        );
        expect(matches).toHaveLength(1);
    });

    it("keeps an unresolvable relative URL as evidence without a base", () => {
        const noLink = mediaFeed.replace(
            '<link>https://example.test/post/a</link>',
            "",
        );
        const [entry] = parseRssXml(noLink, { provider: "fixture-rss" });
        const image = entry.assets.find((item) => item.kind === "image" && item.sourceUrl === "/img/relative.png");
        expect(image?.kind).toBe("image");
        expect(image?.sourceUrl).toBe("/img/relative.png");
    });

    it("declares the real rss connector media-download capability", () => {
        const connector = createRssConnector({ fetch: async () => new Response("", { status: 200 }) });
        expect(connector.capabilities).toContain("media-download");
    });
});
