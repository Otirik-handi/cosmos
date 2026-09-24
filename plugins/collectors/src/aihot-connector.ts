import type { IngestConnector, LoggerPort } from "@cosmos/application";
import { ConnectorExecutionError } from "@cosmos/application";
import { aiHotSourceConfigSchema } from "@cosmos/contracts";
import type { SourceExecutionSnapshot } from "@cosmos/contracts";
import { createTemporalValue, normalizePublisher } from "@cosmos/domain";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { asRecord, createMetadataAsset, extractRows, firstText, firstUrl, isRecord, normalizeContentMetrics, parseJsonDocument, readRecordValue } from "./shared.js";

export interface AiHotConnectorOptions {
    fetch?: typeof globalThis.fetch;
    logger?: LoggerPort;
}

export function createAiHotConnector(
    options: AiHotConnectorOptions = {},
): IngestConnector {
    const fetcher = options.fetch ?? globalThis.fetch;

    return {
        id: aiHotConnectorId,
        description: "Collect public AI HOT items from the verified API.",
        configVersion: "v1",
        capabilities: ["aihot", "http", "public"],
        validate(source) {
            parseAiHotConfig(source);
        },
        async fetchItems({ source, cursor, signal }) {
            parseAiHotConfig(source);
            const url = new URL(aiHotItemsUrl);
            if (cursor) {
                url.searchParams.set("cursor", cursor);
            }
            const startedAt = Date.now();
            options.logger?.debug("connector.transport.started", {
                connectorId: aiHotConnectorId,
                sourceKind: source.kind,
                cursorPresent: cursor !== null,
            });
            let response: Response;
            try {
                response = await fetcher(url, signal ? { signal } : undefined);
            } catch (error) {
                options.logger?.error("connector.transport.failed", {
                    connectorId: aiHotConnectorId,
                    sourceKind: source.kind,
                    durationMs: Date.now() - startedAt,
                }, error);
                throw error;
            }
            if (!response.ok) {
                options.logger?.warn("connector.transport.failed", {
                    connectorId: aiHotConnectorId,
                    sourceKind: source.kind,
                    status: response.status,
                    durationMs: Date.now() - startedAt,
                });
                throw new ConnectorExecutionError(
                    response.status === 429
                        ? "rate_limited"
                        : "dependency_unavailable",
                    `AI HOT request failed with HTTP ${response.status}.`,
                    response.status >= 500 || response.status === 429,
                );
            }

            let output = "";
            let payload: {
                items: readonly Record<string, unknown>[];
                nextCursor: string | null;
            };
            try {
                output = await response.text();
                payload = parseAiHotResponse(output);
                const items = payload.items.map((item) => normalizeAiHotItem(item));
                options.logger?.info("connector.transport.completed", {
                    connectorId: aiHotConnectorId,
                    sourceKind: source.kind,
                    status: response.status,
                    itemCount: items.length,
                    responseBytes: Buffer.byteLength(output, "utf8"),
                    durationMs: Date.now() - startedAt,
                });
                return {
                    items,
                    nextCursor: payload.nextCursor,
                };
            } catch (error) {
                options.logger?.error("connector.transport.failed", {
                    connectorId: aiHotConnectorId,
                    sourceKind: source.kind,
                    status: response.status,
                    responseBytes: Buffer.byteLength(output, "utf8"),
                    durationMs: Date.now() - startedAt,
                    errorCode: error instanceof ConnectorExecutionError
                        ? error.code
                        : "malformed_payload",
                }, error);
                throw error;
            }
        },
    };
}

export function parseAiHotConfig(source: SourceExecutionSnapshot) {
    try {
        return aiHotSourceConfigSchema.parse(source.config);
    } catch (error) {
        throw new ConnectorExecutionError(
            "invalid_configuration",
            "AI HOT source configuration is invalid.",
            false,
            { cause: error },
        );
    }
}

export function normalizeAiHotItem(
    item: Record<string, unknown>,
): NormalizedIngestItem {
    const externalId = firstText(item.id);
    const title = firstText(item.title);
    if (!externalId || !title) {
        throw new ConnectorExecutionError(
            "malformed_payload",
            "AI HOT returned an item without id or title.",
            false,
        );
    }

    const links = asRecord(item.links);
    const source = asRecord(item.source);
    const summary = firstText(item.summary, item.description);
    const publishedAtRaw = firstText(
        item.publishedAt,
        item.published_at,
        item.discoveredAt,
    );
    const originalUrl = firstUrl(
        links?.original,
        links?.url,
        item.url,
    );
    const aiHotUrl = firstUrl(links?.aihot);
    const imageUrl = firstUrl(
        links?.image,
        links?.thumbnail,
        item.image,
        item.thumbnail,
    );
    const metrics = normalizeContentMetrics({
        likes: firstText(item.likes, item.like),
        views: firstText(item.views, item.view),
        reposts: firstText(item.reposts, item.repost),
        comments: firstText(item.comments, item.comment),
        collects: firstText(item.collects, item.collectsCount),
        score: firstText(item.score),
    });

    return {
        externalId,
        title,
        summary: summary || null,
        contentText: firstText(item.content, item.text, summary, title) ?? title,
        webUrl: originalUrl ?? aiHotUrl,
        kind: "article",
        publisher: normalizePublisher({
            platformId: firstText(
                item.authorId,
                item.author_id,
                asRecord(item.author)?.id,
            ),
            name: firstText(
                item.author,
                item.authorName,
                asRecord(item.author)?.name,
                source?.name,
            ),
            kind: "unknown",
        }),
        metrics,
        publishedAt: createTemporalValue({
            exact: publishedAtRaw,
            raw: publishedAtRaw,
            timezone: "UTC",
        }),
        updatedAt: null,
        sourceLocator: {
            provider: "aihot",
            itemId: externalId,
            category: firstText(item.category) || null,
            sourceName: firstText(source?.name) || null,
            links,
        },
        // AI HOT 是公开聚合榜：内容因为进入聚合推荐流而被发现（ING-004）。
        discoveryChannel: "recommendation",
        rawPayload: JSON.stringify(item),
        rawPayloadMimeType: "application/json",
        assets: imageUrl
            ? [createMetadataAsset("image", imageUrl)!]
            : [],
    };
}

export function parseAiHotResponse(output: string): {
    items: readonly Record<string, unknown>[];
    nextCursor: string | null;
} {
    let value: unknown;
    try {
        value = JSON.parse(output) as unknown;
    } catch (error) {
        throw new ConnectorExecutionError(
            "malformed_payload",
            "AI HOT returned invalid JSON.",
            false,
            { cause: error },
        );
    }
    if (!isRecord(value) || !Array.isArray(value.items)) {
        throw new ConnectorExecutionError(
            "malformed_payload",
            "AI HOT response is missing an items array.",
            false,
        );
    }
    const items = value.items.filter(isRecord);
    if (items.length !== value.items.length) {
        throw new ConnectorExecutionError(
            "malformed_payload",
            "AI HOT response contains a non-object item.",
            false,
        );
    }
    const page = asRecord(value.page);
    const nextCursor = firstText(page?.nextCursor) || null;
    return {
        items,
        nextCursor,
    };
}

export const aiHotConnectorId = "aihot";

export const aiHotItemsUrl = "https://aihot.virxact.com/api/v1/items";
