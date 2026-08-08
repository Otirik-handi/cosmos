import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { XMLParser } from "fast-xml-parser";
import type {
    IngestConnector,
} from "@cosmos/application";
import type {
    SourceSnapshot,
} from "@cosmos/contracts";
import type {
    NormalizedAssetInput,
    NormalizedIngestItem,
} from "@cosmos/domain";

export const rssConnectorId = "rss";
export const fixtureRssConnectorId = "fixture-rss";

export interface RssItem {
    externalId: string | null;
    title: string;
    summary: string | null;
    contentText: string;
    webUrl: string | null;
    sourcePublishedAt: string | null;
    sourceLocator: Record<string, unknown>;
    assets: readonly NormalizedAssetInput[];
}

export interface RssConnectorOptions {
    fetch?: typeof globalThis.fetch;
}

export function createRssConnector(
    options: RssConnectorOptions = {},
): IngestConnector {
    const fetcher = options.fetch ?? globalThis.fetch;

    return {
        id: rssConnectorId,
        async fetchItems({ source }) {
            const feedUrl = source.config.feedUrl;
            if (!feedUrl) {
                throw new Error("RSS source is missing config.feedUrl.");
            }
            const response = await fetcher(feedUrl);
            if (!response.ok) {
                throw new Error(`RSS fetch failed with HTTP ${response.status}.`);
            }
            const xml = await response.text();
            return {
                items: parseRssXml(xml, {
                    provider: "rss",
                    feedUrl,
                }).map((item) => ({
                    ...item,
                    rawPayload: xml,
                })),
                nextCursor: hashCursor(xml),
            };
        },
    };
}

export function createFixtureRssConnector(options: {
    rootDirectory?: string;
    pages?: readonly string[];
} = {}): IngestConnector {
    return {
        id: fixtureRssConnectorId,
        async fetchItems({ source }) {
            const pages = options.pages ?? [
                await readFixture(source, options.rootDirectory),
            ];
            const xml = pages[0];
            return {
                items: parseRssXml(xml, {
                    provider: "fixture-rss",
                    fixturePath: source.config.fixturePath ?? "fixtures/rss/basic.xml",
                }).map((item) => ({
                    ...item,
                    rawPayload: xml,
                })),
                nextCursor: hashCursor(xml),
            };
        },
    };
}

export function createSequenceFixtureConnector(
    pages: readonly string[],
): IngestConnector {
    let pageIndex = 0;
    return {
        id: fixtureRssConnectorId,
        async fetchItems() {
            const xml = pages[Math.min(pageIndex++, pages.length - 1)];
            return {
                items: parseRssXml(xml, {
                    provider: "fixture-rss",
                    fixturePath: "memory://fixture",
                }).map((item) => ({
                    ...item,
                    rawPayload: xml,
                })),
                nextCursor: hashCursor(xml),
            };
        },
    };
}

export function parseRssXml(
    xml: string,
    locator: Record<string, unknown>,
): readonly Omit<NormalizedIngestItem, "rawPayload">[] {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        processEntities: false,
        parseTagValue: false,
    });
    const parsed = parser.parse(xml) as {
        rss?: {
            channel?: {
                item?: unknown | unknown[];
            };
        };
        feed?: {
            entry?: unknown | unknown[];
        };
    };
    const rawItems = parsed.rss?.channel?.item ?? parsed.feed?.entry ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items.filter(Boolean).map((raw) => {
        const item = raw as Record<string, unknown>;
        const title = readText(item.title) || "Untitled RSS item";
        const link = readLink(item.link);
        const contentText = stripMarkup(
            readText(item["content:encoded"])
                || readText(item.description)
                || readText(item.content)
                || title,
        );
        const externalId = readText(item.guid)
            || readText(item.id)
            || null;
        const publishedAt = readText(item.pubDate)
            || readText(item.published)
            || readText(item.updated)
            || null;
        const assets = readAssets(item);

        return {
            externalId,
            title,
            summary: readText(item.description) || null,
            contentText,
            webUrl: link,
            sourcePublishedAt: normalizeDate(publishedAt),
            sourceLocator: {
                ...locator,
                externalId,
            },
            assets,
        };
    });
}

async function readFixture(
    source: SourceSnapshot,
    rootDirectory = process.cwd(),
): Promise<string> {
    const configuredPath = source.config.fixturePath ?? "fixtures/rss/basic.xml";
    const path = isAbsolute(configuredPath)
        ? configuredPath
        : resolve(rootDirectory, configuredPath);
    return readFile(path, "utf8");
}

function readText(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (value && typeof value === "object" && "#text" in value) {
        return readText((value as Record<string, unknown>)["#text"]);
    }
    return "";
}

function readLink(value: unknown): string | null {
    if (typeof value === "string") {
        return value.trim() || null;
    }
    if (Array.isArray(value)) {
        const alternate = value.find((candidate) => {
            return typeof candidate === "object"
                && candidate !== null
                && (candidate as Record<string, unknown>)["@_rel"] === "alternate";
        });
        return readLink(alternate ?? value[0]);
    }
    if (value && typeof value === "object") {
        return readText((value as Record<string, unknown>)["@_href"]) || null;
    }
    return null;
}

function readAssets(item: Record<string, unknown>): readonly NormalizedAssetInput[] {
    const enclosure = item.enclosure;
    if (!enclosure || typeof enclosure !== "object") {
        return [];
    }
    const data = enclosure as Record<string, unknown>;
    return [{
        kind: "enclosure",
        sourceUrl: readText(data["@_url"]) || null,
        status: "metadata_only",
        mimeType: readText(data["@_type"]) || null,
        byteSize: Number.parseInt(readText(data["@_length"]) || "", 10) || null,
        content: null,
    }];
}

function stripMarkup(value: string): string {
    return value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeDate(value: string | null): string | null {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hashCursor(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}
