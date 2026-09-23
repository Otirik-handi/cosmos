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
    bilibiliSearchSourceConfigSchema,
    bilibiliSourceConfigSchema,
    openCliProfileSchema,
    type SourceConnectionProjection,
    type SourceExecutionSnapshot,
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
            if (isBilibiliSearchOperation(source)) {
                parseBilibiliSearchConfig(source);
                return;
            }
            resolveBilibiliProfile(source, parseBilibiliFetchConfig(source));
        },
        async fetchItems({ source, signal }) {
            // 一个 manifest 下的多个 operation 由连接器按 `operationId` 分派（EXT-006）：
            // 宿主不解释 operation 的含义，只把它原样带进执行快照。
            const plan = isBilibiliSearchOperation(source)
                ? planBilibiliSearchExecution(source)
                : planBilibiliFetchExecution(source);
            const env = {
                OPENCLI_PROFILE: plan.profile ?? undefined,
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
            const result = await runner.run(plan.args, {
                env,
                signal,
            });
            if (result.exitCode === 66) {
                return { items: [], nextCursor: null };
            }
            return {
                items: normalizeBilibiliOutput(result.stdout, plan.shape),
                nextCursor: null,
            };
        },
        /**
         * 连接登录探测（Proposal connection-login-lifecycle-v1 决定 2）：跑一次登录门控命令
         * `bilibili me`，把结论翻译成宿主的三种 outcome。不跑 doctor——runner 已经把
         * Browser Bridge 不可用（69）与需要登录（77）分成不同错误，这里只要分开翻译。
         */
        async probeAuthorization({ connection, signal }) {
            const profile = readBilibiliProfileFromConnection(connection);
            if (profile === null) {
                return {
                    outcome: "error",
                    reason: "连接没有 OpenCLI profile，无法检查登录状态。",
                };
            }
            const env = { OPENCLI_PROFILE: profile };
            let stdout: string;
            try {
                const result = await runner.run(["bilibili", "me", "-f", "json"], { env, signal });
                if (result.exitCode !== 0) {
                    return {
                        outcome: "error",
                        reason: `OpenCLI bilibili me 以退出码 ${result.exitCode} 结束。`,
                    };
                }
                stdout = result.stdout;
            } catch (error) {
                if (error instanceof ConnectorExecutionError) {
                    if (error.code === "authentication_required") {
                        return {
                            outcome: "expired",
                            reason: "需要重新登录 Bilibili（浏览器里的登录态已失效）。",
                        };
                    }
                    // 浏览器桥不可用与超时都是「这次没得出结论」，按 outcome 返回而不是抛出：
                    // 端口约定探测给出结论，宿主只把真正意外的异常留给 Job 失败。
                    if (error.code === "dependency_unavailable" || error.code === "timeout") {
                        return { outcome: "error", reason: error.message };
                    }
                }
                throw error;
            }
            return {
                outcome: "active",
                account: readBilibiliAccountName(stdout),
                reason: null,
            };
        },
    };
}

/**
 * 从 `bilibili me` 的输出里取账号标签。实测字段是 `name` 与 `uid`（`-f json` 时是 JSON）；
 * 取不到名字时退到 uid，两者都没有就返回 null——探测结论不因为标签缺失而改变。
 */
function readBilibiliAccountName(output: string): string | null {
    let parsed: unknown;
    try {
        parsed = parseJsonDocument(output);
    } catch {
        return null;
    }
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof row !== "object" || row === null) {
        return null;
    }
    const record = row as Record<string, unknown>;
    const name = firstText(record.name, record.uname, record.nickname, record.author);
    if (name) {
        return name.slice(0, 200);
    }
    const uid = firstText(record.uid, record.mid, record.id);
    return uid ? uid.slice(0, 200) : null;
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

/** 多 operation 的分派点（EXT-006）：连接器按 `source.operationId` 选配置 schema 与命令。 */
const bilibiliSearchOperationId = "search";

function isBilibiliSearchOperation(source: SourceExecutionSnapshot): boolean {
    return source.operationId === bilibiliSearchOperationId;
}

function parseBilibiliFetchConfig(source: SourceExecutionSnapshot) {
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

function parseBilibiliSearchConfig(source: SourceExecutionSnapshot) {
    try {
        return bilibiliSearchSourceConfigSchema.parse(source.config);
    } catch (error) {
        throw new ConnectorExecutionError(
            "invalid_configuration",
            "Bilibili search configuration is invalid.",
            false,
            { cause: error },
        );
    }
}

/** 一次 Bilibili 抓取的完整决定：命令参数、要带的 profile、结果怎么归类。 */
type BilibiliExecutionPlan = {
    args: string[];
    profile: string | null;
    shape: {
        kind: "listing" | "video";
        discoveryChannel: "recommendation" | "account" | "search";
        locatorMode: string;
    };
};

/** 搜索匿名可用（不读连接 profile），结果的发现上下文是 search（ING-004）。 */
function planBilibiliSearchExecution(source: SourceExecutionSnapshot): BilibiliExecutionPlan {
    const config = parseBilibiliSearchConfig(source);
    return {
        args: ["bilibili", "search", config.query, "--limit", String(config.limit), "-f", "json"],
        profile: null,
        shape: { kind: "video", discoveryChannel: "search", locatorMode: "search" },
    };
}

/** `fetch`：hot 是平台推荐流、feed 是关注的动态（ING-004），`feed` 必须有连接里的 profile。 */
function planBilibiliFetchExecution(source: SourceExecutionSnapshot): BilibiliExecutionPlan {
    const config = parseBilibiliFetchConfig(source);
    return {
        args: ["bilibili", config.mode, "--limit", String(config.limit), "-f", "json"],
        profile: resolveBilibiliProfile(source, config),
        shape: {
            kind: config.mode === "hot" ? "listing" : "video",
            discoveryChannel: config.mode === "hot" ? "recommendation" : "account",
            locatorMode: config.mode,
        },
    };
}

/**
 * 连接上的 Bilibili 适配器配置（Proposal connection-login-lifecycle-v1 决定 1）：
 * profile 归连接，来源配置里已经没有它。格式规则与合同共用 `openCliProfileSchema`。
 */
function readBilibiliProfileFromConnection(
    connection: SourceConnectionProjection | null | undefined,
): string | null {
    const raw = connection?.configJson;
    if (raw === null || raw === undefined) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new ConnectorExecutionError(
            "invalid_configuration",
            "Bilibili connection configuration is not valid JSON.",
            false,
            { cause: error },
        );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ConnectorExecutionError(
            "invalid_configuration",
            "Bilibili connection configuration must be a JSON object.",
            false,
        );
    }
    const profile = (parsed as { profile?: unknown }).profile;
    if (profile === undefined || profile === null) {
        return null;
    }
    const checked = openCliProfileSchema.safeParse(profile);
    if (!checked.success) {
        throw new ConnectorExecutionError(
            "invalid_configuration",
            "Bilibili connection profile is invalid.",
            false,
            { cause: checked.error },
        );
    }
    return checked.data;
}

/**
 * `feed` 需要登录态：校验从「配置里有 profile」搬到「连接上有 profile」（Proposal 决定 1），
 * 因此这个判断属于连接器，不属于来源配置 schema。hot 匿名可用，没有连接也照常抓。
 */
function resolveBilibiliProfile(
    source: SourceExecutionSnapshot,
    config: { mode: "hot" | "feed" },
): string | null {
    const profile = readBilibiliProfileFromConnection(source.connection);
    if (config.mode === "feed" && profile === null) {
        throw new ConnectorExecutionError(
            "invalid_configuration",
            "Bilibili feed requires a connection with an OpenCLI profile.",
            false,
        );
    }
    return profile;
}

function parseAiHotConfig(source: SourceExecutionSnapshot) {
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
    shape: BilibiliExecutionPlan["shape"],
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
            kind: shape.kind,
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
                mode: shape.locatorMode,
                rank: index + 1,
                externalId,
            },
            // hot 是平台推荐流、feed 是关注的动态、search 是显式查询（ING-004）：同一个 manifest
            // 下的不同发现方式由 operation 声明，而不是靠一个 mode 字段兼顾所有情况。
            discoveryChannel: shape.discoveryChannel,
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
        // AI HOT 是公开聚合榜：内容因为进入聚合推荐流而被发现（ING-004）。
        discoveryChannel: "recommendation",
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
