import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { XMLParser } from "fast-xml-parser";
import {
    ConnectorExecutionError,
    type LoggerPort,
    type IngestConnector,
} from "@cosmos/application";
import type {
    SourceSnapshot,
} from "@cosmos/contracts";
import type {
    NormalizedAssetInput,
    NormalizedIngestItem,
} from "@cosmos/domain";
import {
    createTemporalValue,
    normalizePublisher,
} from "@cosmos/domain";

export const rssConnectorId = "rss";
export const fixtureRssConnectorId = "fixture-rss";

export interface RssItem {
    externalId: string | null;
    title: string;
    summary: string | null;
    contentText: string;
    webUrl: string | null;
    kind: "article";
    publisher: ReturnType<typeof normalizePublisher>;
    metrics: null;
    publishedAt: ReturnType<typeof createTemporalValue>;
    updatedAt: ReturnType<typeof createTemporalValue>;
    sourceLocator: Record<string, unknown>;
    assets: readonly NormalizedAssetInput[];
}

export interface RssConnectorOptions {
    fetch?: typeof globalThis.fetch;
    logger?: LoggerPort;
}

export function createRssConnector(
    options: RssConnectorOptions = {},
): IngestConnector {
    const fetcher = options.fetch ?? globalThis.fetch;

    return {
        id: rssConnectorId,
        description: "Fetch RSS or RSSHub XML feeds.",
        configVersion: "v1",
        capabilities: ["network", "rss"],
        validate(source) {
            if (!source.config.feedUrl) {
                throw new Error("RSS source is missing config.feedUrl.");
            }
        },
        async fetchItems({ source, signal }) {
            const feedUrl = source.config.feedUrl;
            if (!feedUrl) {
                throw new Error("RSS source is missing config.feedUrl.");
            }
            const startedAt = Date.now();
            options.logger?.debug("connector.transport.started", {
                connectorId: rssConnectorId,
                sourceKind: source.kind,
                host: safeHost(feedUrl),
            });
            let response: Response;
            try {
                response = await fetcher(feedUrl, signal ? { signal } : undefined);
            } catch (error) {
                options.logger?.error("connector.transport.failed", {
                    connectorId: rssConnectorId,
                    sourceKind: source.kind,
                    host: safeHost(feedUrl),
                    durationMs: Date.now() - startedAt,
                }, error);
                throw error;
            }
            if (!response.ok) {
                options.logger?.warn("connector.transport.failed", {
                    connectorId: rssConnectorId,
                    sourceKind: source.kind,
                    host: safeHost(feedUrl),
                    status: response.status,
                    durationMs: Date.now() - startedAt,
                });
                throw new ConnectorExecutionError(
                    response.status === 429
                        ? "rate_limited"
                        : "dependency_unavailable",
                    `RSS fetch failed with HTTP ${response.status}.`,
                    response.status >= 500 || response.status === 429,
                );
            }
            let xml = "";
            let items: readonly NormalizedIngestItem[];
            try {
                xml = await response.text();
                items = parseRssXml(xml, {
                    provider: "rss",
                    feedUrl,
                }).map((item) => ({
                    ...item,
                    rawPayload: xml,
                    rawPayloadMimeType: "application/xml",
                }));
            } catch (error) {
                options.logger?.error("connector.transport.failed", {
                    connectorId: rssConnectorId,
                    sourceKind: source.kind,
                    host: safeHost(feedUrl),
                    status: response.status,
                    responseBytes: Buffer.byteLength(xml, "utf8"),
                    durationMs: Date.now() - startedAt,
                    errorCode: error instanceof ConnectorExecutionError
                        ? error.code
                        : "malformed_payload",
                }, error);
                if (error instanceof ConnectorExecutionError) {
                    throw error;
                }
                throw new ConnectorExecutionError(
                    "malformed_payload",
                    "RSS response could not be parsed.",
                    false,
                    { cause: error },
                );
            }
            options.logger?.info("connector.transport.completed", {
                connectorId: rssConnectorId,
                sourceKind: source.kind,
                host: safeHost(feedUrl),
                status: response.status,
                itemCount: items.length,
                responseBytes: Buffer.byteLength(xml, "utf8"),
                durationMs: Date.now() - startedAt,
            });
            return {
                items,
                nextCursor: hashCursor(xml),
            };
        },
    };
}

export function createFixtureRssConnector(options: {
    rootDirectory?: string;
    pages?: readonly string[];
    logger?: LoggerPort;
} = {}): IngestConnector {
    return {
        id: fixtureRssConnectorId,
        description: "Replay a local RSS fixture deterministically.",
        configVersion: "v1",
        capabilities: ["fixture", "rss"],
        validate(source) {
            const fixturePath = source.config.fixturePath;
            if (fixturePath !== undefined && !fixturePath.trim()) {
                throw new Error("Fixture source config.fixturePath cannot be empty.");
            }
        },
        async fetchItems({ source }) {
            const startedAt = Date.now();
            options.logger?.debug("connector.transport.started", {
                connectorId: fixtureRssConnectorId,
                sourceKind: source.kind,
            });
            let xml = "";
            let items: readonly NormalizedIngestItem[];
            try {
                const pages = options.pages ?? [
                    await readFixture(source, options.rootDirectory),
                ];
                xml = pages[0];
                items = parseRssXml(xml, {
                    provider: "fixture-rss",
                    fixturePath: source.config.fixturePath ?? "fixtures/rss/basic.xml",
                }).map((item) => ({
                    ...item,
                    rawPayload: xml,
                    rawPayloadMimeType: "application/xml",
                }));
            } catch (error) {
                options.logger?.error("connector.transport.failed", {
                    connectorId: fixtureRssConnectorId,
                    sourceKind: source.kind,
                    responseBytes: Buffer.byteLength(xml, "utf8"),
                    durationMs: Date.now() - startedAt,
                    errorCode: error instanceof ConnectorExecutionError
                        ? error.code
                        : "malformed_payload",
                }, error);
                throw error;
            }
            options.logger?.info("connector.transport.completed", {
                connectorId: fixtureRssConnectorId,
                sourceKind: source.kind,
                itemCount: items.length,
                responseBytes: Buffer.byteLength(xml, "utf8"),
                durationMs: Date.now() - startedAt,
            });
            return {
                items,
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
        description: "Replay an in-memory sequence of RSS pages.",
        configVersion: "v1",
        capabilities: ["fixture", "rss", "test"],
        validate() {
            return;
        },
        async fetchItems() {
            const xml = pages[Math.min(pageIndex++, pages.length - 1)];
            return {
                items: parseRssXml(xml, {
                    provider: "fixture-rss",
                    fixturePath: "memory://fixture",
                }).map((item) => ({
                    ...item,
                    rawPayload: xml,
                    rawPayloadMimeType: "application/xml",
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
        const publishedAtRaw = readText(item.pubDate)
            || readText(item.published)
            || readText(item.updated)
            || null;
        const updatedAtRaw = readText(item.updated) || null;
        const author = readText(item.author)
            || readText(item.creator)
            || readText(item["dc:creator"])
            || null;
        const assets = readAssets(item);

        return {
            externalId,
            title,
            summary: readText(item.description) || null,
            contentText,
            webUrl: link,
            kind: "article",
            publisher: normalizePublisher({
                name: author,
                kind: "unknown",
            }),
            metrics: null,
            publishedAt: createTemporalValue({
                exact: publishedAtRaw,
                raw: publishedAtRaw,
                timezone: "UTC",
            }),
            updatedAt: updatedAtRaw
                ? createTemporalValue({
                    exact: updatedAtRaw,
                    raw: updatedAtRaw,
                    timezone: "UTC",
                })
                : null,
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

function hashCursor(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function safeHost(value: string): string | null {
    try {
        return new URL(value).hostname;
    } catch {
        return null;
    }
}
