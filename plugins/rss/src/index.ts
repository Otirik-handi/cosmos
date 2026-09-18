import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { XMLParser } from "fast-xml-parser";
import {
    ConnectorExecutionError,
    mediaDownloadCapability,
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

/** 条件请求验证器在来源状态存储里的键；命名空间由宿主按 manifest 解析（ADR-0018）。 */
const rssCacheStateKey = "http-cache";

function readRssValidators(value: unknown): { etag?: string; lastModified?: string } {
    if (typeof value !== "object" || value === null) {
        return {};
    }
    const record = value as { etag?: unknown; lastModified?: unknown };
    return {
        ...(typeof record.etag === "string" && record.etag !== "" ? { etag: record.etag } : {}),
        ...(typeof record.lastModified === "string" && record.lastModified !== ""
            ? { lastModified: record.lastModified }
            : {}),
    };
}

export function createRssConnector(
    options: RssConnectorOptions = {},
): IngestConnector {
    const fetcher = options.fetch ?? globalThis.fetch;

    return {
        id: rssConnectorId,
        description: "Fetch RSS or RSSHub XML feeds.",
        configVersion: "v1",
        capabilities: ["network", "rss", mediaDownloadCapability],
        validate(source) {
            if (!source.config.feedUrl) {
                throw new Error("RSS source is missing config.feedUrl.");
            }
        },
        async fetchItems({ source, cursor, signal, state }) {
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
            // 条件请求（AUT-003）：上次抓到的 ETag / Last-Modified 存在来源的状态存储里，
            // 这次带上；服务端说 304 就说明没有新内容，不再下载与解析正文。宿主没接状态
            // 存储时（legacy 路径）这里退化为无条件抓取。
            const cached = state ? await state.get(rssCacheStateKey) : null;
            const validators = readRssValidators(cached?.value);
            const headers: Record<string, string> = {};
            if (validators.etag) {
                headers["If-None-Match"] = validators.etag;
            }
            if (validators.lastModified) {
                headers["If-Modified-Since"] = validators.lastModified;
            }
            let response: Response;
            try {
                response = await fetcher(feedUrl, {
                    ...(signal ? { signal } : {}),
                    ...(Object.keys(headers).length > 0 ? { headers } : {}),
                });
            } catch (error) {
                options.logger?.error("connector.transport.failed", {
                    connectorId: rssConnectorId,
                    sourceKind: source.kind,
                    host: safeHost(feedUrl),
                    durationMs: Date.now() - startedAt,
                }, error);
                throw error;
            }
            if (response.status === 304) {
                options.logger?.info("connector.transport.not_modified", {
                    connectorId: rssConnectorId,
                    sourceKind: source.kind,
                    host: safeHost(feedUrl),
                    durationMs: Date.now() - startedAt,
                });
                return {
                    items: [],
                    nextCursor: cursor,
                };
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
            // 记下这次的验证器，供下次条件请求使用。写入失败（并发抓取的 CAS 冲突）只是
            // 少一次 304 优化，不该让已经成功的采集失败。
            const etag = response.headers.get("etag");
            const lastModified = response.headers.get("last-modified");
            if (state && (etag || lastModified)) {
                try {
                    await state.put(
                        rssCacheStateKey,
                        { etag, lastModified },
                        cached?.version ?? null,
                    );
                } catch (error) {
                    options.logger?.debug("connector.state.write_skipped", {
                        connectorId: rssConnectorId,
                        sourceKind: source.kind,
                        reason: error instanceof Error ? error.name : "unknown",
                    });
                }
            }
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
        const rawContentHtml = readText(item["content:encoded"])
            || readText(item.description)
            || readText(item.content)
            || "";
        const contentText = stripMarkup(rawContentHtml || title);
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
        const assets = readMediaAssets(
            item,
            rawContentHtml,
            link ?? (typeof locator.feedUrl === "string" ? locator.feedUrl : null),
        );

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
            // RSS 是订阅式来源：内容因为用户订阅了这个来源而被发现（ING-004）。
            discoveryChannel: "account",
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

interface MediaCandidate {
    kind: string;
    sourceUrl: string | null;
    mimeType: string | null;
    byteSize: number | null;
}

/**
 * Entry-scoped media extraction (ADR-0005): enclosure, media:content /
 * media:thumbnail (with media:group nesting) and body <img>/<audio>/<video>.
 * Candidates start as metadata_only; the Application media acquirer later
 * rewrites the image ones to saved/skipped/failed. Duplicate URLs are kept
 * once so a revision does not accumulate identical media rows.
 */
function readMediaAssets(
    item: Record<string, unknown>,
    rawContentHtml: string,
    baseUrl: string | null,
): readonly NormalizedAssetInput[] {
    const candidates: MediaCandidate[] = [];
    for (const data of asObjects(item.enclosure)) {
        candidates.push({
            kind: classifyMediaKind(data["@_type"], data["@_medium"]),
            sourceUrl: readText(data["@_url"]) || null,
            mimeType: readText(data["@_type"]) || null,
            byteSize: parseIntAttr(data["@_length"]),
        });
    }
    for (const tag of ["media:content", "media:thumbnail"] as const) {
        for (const data of asObjects(item[tag])) {
            candidates.push({
                kind: tag === "media:thumbnail"
                    ? "image"
                    : classifyMediaKind(data["@_type"], data["@_medium"]),
                sourceUrl: readText(data["@_url"]) || null,
                mimeType: readText(data["@_type"]) || null,
                byteSize: parseIntAttr(data["@_fileSize"]) ?? parseIntAttr(data["@_length"]),
            });
        }
    }
    const group = firstObject(item["media:group"]);
    if (group) {
        for (const tag of ["media:content", "media:thumbnail"] as const) {
            for (const data of asObjects(group[tag])) {
                candidates.push({
                    kind: tag === "media:thumbnail"
                        ? "image"
                        : classifyMediaKind(data["@_type"], data["@_medium"]),
                    sourceUrl: readText(data["@_url"]) || null,
                    mimeType: readText(data["@_type"]) || null,
                    byteSize: parseIntAttr(data["@_fileSize"]) ?? parseIntAttr(data["@_length"]),
                });
            }
        }
    }
    collectBodyMedia(rawContentHtml, candidates);

    const assets: NormalizedAssetInput[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        const sourceUrl = candidate.sourceUrl
            ? (resolveMediaUrl(candidate.sourceUrl, baseUrl) ?? candidate.sourceUrl)
            : null;
        if (!sourceUrl || seen.has(sourceUrl)) {
            continue;
        }
        seen.add(sourceUrl);
        assets.push({
            kind: candidate.kind,
            sourceUrl,
            status: "metadata_only",
            mimeType: candidate.mimeType,
            byteSize: candidate.byteSize,
            content: null,
        });
    }
    return assets;
}

function collectBodyMedia(
    html: string,
    candidates: MediaCandidate[],
): void {
    const tagPattern = /<(img|audio|video)\b([^>]*)>/gi;
    for (const match of html.matchAll(tagPattern)) {
        const kind = match[1].toLowerCase() === "img"
            ? "image"
            : match[1].toLowerCase();
        const src = readAttribute(match[2], "src");
        if (!src) {
            continue;
        }
        candidates.push({
            kind,
            sourceUrl: src,
            mimeType: null,
            byteSize: null,
        });
    }
}

function readAttribute(attributes: string, name: string): string | null {
    const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s'">]+))`, "i");
    const match = attributes.match(pattern);
    if (!match) {
        return null;
    }
    return (match[1] ?? match[2] ?? match[3])?.trim() || null;
}

function classifyMediaKind(
    type: unknown,
    medium: unknown,
): string {
    const typeText = readText(type).toLowerCase();
    if (typeText.startsWith("image/")) {
        return "image";
    }
    if (typeText.startsWith("audio/")) {
        return "audio";
    }
    if (typeText.startsWith("video/")) {
        return "video";
    }
    const mediumText = readText(medium).toLowerCase();
    if (mediumText === "image") {
        return "image";
    }
    if (mediumText === "audio") {
        return "audio";
    }
    if (mediumText === "video") {
        return "video";
    }
    return "enclosure";
}

function asObjects(value: unknown): readonly Record<string, unknown>[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is Record<string, unknown> => {
            return typeof entry === "object" && entry !== null;
        });
    }
    return typeof value === "object" && value !== null
        ? [value as Record<string, unknown>]
        : [];
}

function firstObject(value: unknown): Record<string, unknown> | null {
    return asObjects(value)[0] ?? null;
}

function parseIntAttr(value: unknown): number | null {
    const parsed = Number.parseInt(readText(value) || "", 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function resolveMediaUrl(sourceUrl: string, baseUrl: string | null): string | null {
    try {
        return new URL(sourceUrl, baseUrl ?? undefined).href;
    } catch {
        return null;
    }
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
