import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import {
    ConnectorExecutionError,
    ConnectorRegistry,
    type LoggerPort,
    type IngestConnector,
} from "@cosmos/application";
import {
    aiHotSourceConfigSchema,
    bilibiliSourceConfigSchema,
    type SourceSnapshot,
} from "@cosmos/contracts";
import type {
    ContentMetrics,
    NormalizedAssetInput,
    NormalizedIngestItem,
} from "@cosmos/domain";
import {
    createTemporalValue,
    normalizePublisher,
} from "@cosmos/domain";
import {
    createFixtureRssConnector,
    createRssConnector,
} from "@cosmos/plugin-rss";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export const bilibiliConnectorId = "bilibili";
export const aiHotConnectorId = "aihot";
export const openCliExecutableEnv = "COSMOS_OPENCLI_PATH";
export const aiHotItemsUrl = "https://aihot.virxact.com/api/v1/items";
export const supportedOpenCliMajor = 1;

export interface OpenCliRunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface OpenCliRunOptions {
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    maxBufferBytes?: number;
    signal?: AbortSignal;
}

export interface OpenCliRunner {
    run(
        args: readonly string[],
        options?: OpenCliRunOptions,
    ): Promise<OpenCliRunResult>;
}

export interface OpenCliRunnerOptions {
    executable?: string;
    timeoutMs?: number;
    maxBufferBytes?: number;
    logger?: LoggerPort;
}

export function createNodeOpenCliRunner(
    options: OpenCliRunnerOptions = {},
): OpenCliRunner {
    const configuredExecutable = options.executable
        ?? process.env[openCliExecutableEnv];
    const externalExecutable = configuredExecutable?.trim() || null;
    const executable = externalExecutable ?? process.execPath;
    const executableArgs = externalExecutable
        ? []
        : [require.resolve("@jackwener/opencli")];
    const timeoutMs = options.timeoutMs ?? 120_000;
    const maxBufferBytes = options.maxBufferBytes ?? 4 * 1024 * 1024;
    const logger = options.logger;

    return {
        async run(args, runOptions = {}) {
            const startedAt = Date.now();
            const operation = args[0] ?? "unknown";
            logger?.debug("connector.opencli.started", {
                operation,
                argumentCount: args.length,
            });
            try {
                const result = await execFileAsync(
                    executable,
                    [...executableArgs, ...args],
                    {
                    cwd: process.cwd(),
                    env: {
                        ...process.env,
                        ...(runOptions.env ?? {}),
                    },
                    timeout: runOptions.timeoutMs ?? timeoutMs,
                    signal: runOptions.signal,
                    shell: Boolean(
                        externalExecutable
                        && /\.(cmd|bat)$/i.test(externalExecutable),
                    ),
                    encoding: "utf8",
                    },
                );
                const normalized = {
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exitCode: 0,
                };
                logger?.info("connector.opencli.completed", {
                    operation,
                    exitCode: normalized.exitCode,
                    stdoutBytes: Buffer.byteLength(normalized.stdout, "utf8"),
                    stderrBytes: Buffer.byteLength(normalized.stderr, "utf8"),
                    durationMs: Date.now() - startedAt,
                });
                return normalized;
            } catch (error) {
                const details = error as {
                    code?: unknown;
                    stdout?: unknown;
                    stderr?: unknown;
                    killed?: unknown;
                    signal?: unknown;
                    message?: unknown;
                };
                const stdout = typeof details.stdout === "string"
                    ? details.stdout
                    : "";
                const stderr = typeof details.stderr === "string"
                    ? details.stderr
                    : "";
                const exitCode = typeof details.code === "number"
                    ? details.code
                    : null;
                logger?.warn("connector.opencli.failed", {
                    operation,
                    exitCode,
                    stdoutBytes: Buffer.byteLength(stdout, "utf8"),
                    stderrBytes: Buffer.byteLength(stderr, "utf8"),
                    durationMs: Date.now() - startedAt,
                });

                if (exitCode === 66) {
                    return { stdout, stderr, exitCode };
                }
                if (exitCode === 69) {
                    throw new ConnectorExecutionError(
                        "dependency_unavailable",
                        "OpenCLI Browser Bridge is unavailable.",
                        true,
                        { cause: error },
                    );
                }
                if (exitCode === 77) {
                    throw new ConnectorExecutionError(
                        "authentication_required",
                        "OpenCLI requires a logged-in browser profile.",
                        false,
                        { cause: error },
                    );
                }
                if (
                    details.killed === true
                    || details.signal === "SIGTERM"
                    || details.code === "ETIMEDOUT"
                ) {
                    throw new ConnectorExecutionError(
                        "timeout",
                        "OpenCLI timed out.",
                        true,
                        { cause: error },
                    );
                }
                throw new ConnectorExecutionError(
                    "dependency_unavailable",
                    typeof details.message === "string"
                        ? details.message
                        : "OpenCLI failed to execute.",
                    true,
                    { cause: error },
                );
            }
        },
    };
}

export interface OpenCliConnectorOptions {
    executable?: string;
    runner?: OpenCliRunner;
    timeoutMs?: number;
    maxBufferBytes?: number;
    preflight?: boolean;
    checkVersion?: boolean;
    logger?: LoggerPort;
}

export function createBilibiliConnector(
    options: OpenCliConnectorOptions = {},
): IngestConnector {
    const runner = options.runner ?? createNodeOpenCliRunner({
        executable: options.executable,
        timeoutMs: options.timeoutMs,
        maxBufferBytes: options.maxBufferBytes,
        logger: options.logger,
    });
    const preflight = options.preflight ?? true;
    const checkVersion = options.checkVersion ?? true;
    let versionChecked = false;

    return {
        id: bilibiliConnectorId,
        description: "Collect Bilibili hot or followed-feed items through OpenCLI.",
        configVersion: "v1",
        capabilities: ["bilibili", "opencli", "browser-bridge"],
        validate(source) {
            parseBilibiliConfig(source);
        },
        async fetchItems({ source, signal }) {
            const config = parseBilibiliConfig(source);
            const args = [
                "bilibili",
                config.mode,
                "--limit",
                String(config.limit),
                "-f",
                "json",
            ];
            const env = {
                OPENCLI_PROFILE: config.profile,
            };
            if (checkVersion && !versionChecked) {
                const version = await runner.run(["--version"], { env });
                assertOpenCliVersion(version.stdout, version.exitCode);
                versionChecked = true;
            }
            if (preflight) {
                const doctor = await runner.run(["doctor"], { env });
                assertOpenCliDoctor(doctor.stdout);
            }
            const result = await runner.run(args, {
                env,
                signal,
            });
            if (result.exitCode === 66) {
                return { items: [], nextCursor: null };
            }
            return {
                items: normalizeBilibiliOutput(result.stdout, config.mode),
                nextCursor: null,
            };
        },
    };
}

function assertOpenCliDoctor(output: string): void {
    if (
        /extension:\s+not connected/i.test(output)
        || /connectivity:\s+failed/i.test(output)
    ) {
        throw new ConnectorExecutionError(
            "dependency_unavailable",
            "OpenCLI Browser Bridge extension is not connected.",
            true,
        );
    }
}

function assertOpenCliVersion(output: string, exitCode: number): void {
    const match = output.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
    if (exitCode !== 0 || !match || Number(match[1]) !== supportedOpenCliMajor) {
        throw new ConnectorExecutionError(
            "unsupported_version",
            `OpenCLI major version ${supportedOpenCliMajor} is required.`,
            false,
        );
    }
}

export const createOpenCliConnector = createBilibiliConnector;

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

export function createBuiltInConnectorRegistry(options: {
    workspaceRoot?: string;
    fetch?: typeof globalThis.fetch;
    openCliExecutable?: string;
    openCliRunner?: OpenCliRunner;
    logger?: LoggerPort;
} = {}): ConnectorRegistry {
    return new ConnectorRegistry([
        createRssConnector({
            fetch: options.fetch,
            logger: options.logger,
        }),
        createFixtureRssConnector({
            rootDirectory: options.workspaceRoot,
            logger: options.logger,
        }),
        createBilibiliConnector({
            executable: options.openCliExecutable,
            runner: options.openCliRunner,
            logger: options.logger,
        }),
        createAiHotConnector({
            fetch: options.fetch,
            logger: options.logger,
        }),
    ]);
}

function parseBilibiliConfig(source: SourceSnapshot) {
    try {
        return bilibiliSourceConfigSchema.parse(source.config);
    } catch (error) {
        throw new ConnectorExecutionError(
            "invalid_configuration",
            "Bilibili source configuration is invalid.",
            false,
            { cause: error },
        );
    }
}

function parseAiHotConfig(source: SourceSnapshot) {
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

function normalizeBilibiliOutput(
    output: string,
    mode: "hot" | "feed",
): readonly NormalizedIngestItem[] {
    const rows = extractRows(parseJsonDocument(output));
    return rows.map((row, index) => {
        const externalId = firstText(
            row.bvid,
            row.id,
            row.aid,
            row.video_id,
        );
        const title = firstText(row.title, row.name) || "Untitled Bilibili item";
        const author = firstText(
            row.author,
            row.author_name,
            readRecordValue(row.author, "name"),
            readRecordValue(row.owner, "name"),
        );
        const owner = asRecord(row.owner);
        const description = firstText(
            row.description,
            row.desc,
            row.summary,
        );
        const webUrl = firstUrl(
            row.url,
            row.link,
            row.web_url,
            externalId?.startsWith("BV")
                ? `https://www.bilibili.com/video/${externalId}`
                : null,
        );
        const publishedAtRaw = firstText(
            row.published_at,
            row.publishedAt,
            row.pubdate,
            row.time,
        );
        const asset = createMetadataAsset(
            "cover",
            firstUrl(row.cover, row.pic, row.thumbnail, row.cover_url),
        );
        const metrics = normalizeContentMetrics({
            likes: firstText(row.likes, row.like),
            views: firstText(row.views, row.view),
            reposts: firstText(row.reposts, row.repost),
            comments: firstText(row.comments, row.comment),
            collects: firstText(row.collects, row.favorite, row.favorites),
            score: firstText(row.score),
        });

        return {
            externalId,
            title,
            summary: description || null,
            contentText: description || title,
            webUrl,
            kind: mode === "hot" ? "listing" : "video",
            publisher: normalizePublisher({
                platformId: firstText(
                    row.mid,
                    row.uid,
                    row.author_id,
                    readRecordValue(owner, "mid"),
                    readRecordValue(owner, "uid"),
                ),
                name: author,
                kind: "user",
                profileUrl: firstUrl(
                    row.author_url,
                    readRecordValue(owner, "url"),
                ),
            }),
            metrics,
            publishedAt: createTemporalValue({
                exact: publishedAtRaw,
                raw: publishedAtRaw,
                timezone: "Asia/Shanghai",
            }),
            updatedAt: null,
            sourceLocator: {
                provider: "bilibili",
                mode,
                rank: index + 1,
                externalId,
            },
            rawPayload: JSON.stringify(row),
            rawPayloadMimeType: "application/json",
            assets: asset ? [asset] : [],
        };
    });
}

function normalizeAiHotItem(
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
        rawPayload: JSON.stringify(item),
        rawPayloadMimeType: "application/json",
        assets: imageUrl
            ? [createMetadataAsset("image", imageUrl)!]
            : [],
    };
}

function parseAiHotResponse(output: string): {
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

function parseJsonDocument(output: string): unknown {
    const trimmed = output.trim();
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        for (let index = 0; index < trimmed.length; index += 1) {
            if (trimmed[index] !== "[" && trimmed[index] !== "{") {
                continue;
            }
            const candidate = extractJsonCandidate(trimmed, index);
            if (!candidate) {
                continue;
            }
            try {
                return JSON.parse(candidate) as unknown;
            } catch {
                continue;
            }
        }
    }
    throw new ConnectorExecutionError(
        "malformed_payload",
        "OpenCLI returned no valid JSON payload.",
        false,
    );
}

function extractRows(value: unknown): readonly Record<string, unknown>[] {
    if (Array.isArray(value) && value.every(isRecord)) {
        return value;
    }
    if (isRecord(value)) {
        for (const key of ["items", "data", "results"]) {
            const rows = value[key];
            if (Array.isArray(rows) && rows.every(isRecord)) {
                return rows;
            }
        }
        return [value];
    }
    throw new ConnectorExecutionError(
        "malformed_payload",
        "OpenCLI returned an unsupported JSON shape.",
        false,
    );
}

function extractJsonCandidate(input: string, start: number): string | null {
    const opening = input[start];
    const closing = opening === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < input.length; index += 1) {
        const character = input[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === "\"") {
                inString = false;
            }
            continue;
        }
        if (character === "\"") {
            inString = true;
        } else if (character === opening) {
            depth += 1;
        } else if (character === closing) {
            depth -= 1;
            if (depth === 0) {
                return input.slice(start, index + 1);
            }
        }
    }
    return null;
}

function createMetadataAsset(
    kind: string,
    sourceUrl: string | null,
): NormalizedAssetInput | null {
    return sourceUrl
        ? {
            kind,
            sourceUrl,
            status: "metadata_only",
            mimeType: null,
            byteSize: null,
            content: null,
        }
        : null;
}

function normalizeContentMetrics(input: {
    likes?: string | null;
    views?: string | null;
    reposts?: string | null;
    comments?: string | null;
    collects?: string | null;
    score?: string | null;
}): ContentMetrics | null {
    const values: ContentMetrics["values"] = {};
    const raw: Record<string, string> = {};
    const entries = Object.entries(input) as Array<
        [keyof ContentMetrics["values"], string | null | undefined]
    >;

    for (const [key, rawValue] of entries) {
        if (!rawValue) {
            continue;
        }
        raw[key] = rawValue;
        const numeric = Number(rawValue.replaceAll(",", ""));
        if (Number.isFinite(numeric)) {
            values[key] = numeric;
        }
    }

    return Object.keys(raw).length > 0
        ? {
            values,
            raw,
            reliability: "unknown",
            capturedAt: new Date().toISOString(),
        }
        : null;
}

function readRecordValue(
    value: unknown,
    key: string,
): unknown {
    return isRecord(value) ? value[key] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstText(...values: readonly unknown[]): string | null {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }
    }
    return null;
}

function firstUrl(...values: readonly unknown[]): string | null {
    for (const value of values) {
        if (
            typeof value === "string"
            && (value.startsWith("http://") || value.startsWith("https://"))
        ) {
            return value;
        }
    }
    return null;
}
