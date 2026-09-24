import type { IngestConnector, LoggerPort } from "@cosmos/application";
import { ConnectorExecutionError } from "@cosmos/application";
import { bilibiliSearchSourceConfigSchema, bilibiliSourceConfigSchema, openCliProfileSchema } from "@cosmos/contracts";
import type { SourceConnectionProjection, SourceExecutionSnapshot } from "@cosmos/contracts";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { normalizeBilibiliOutput } from "./bilibili-normalize.js";
import { assertOpenCliDoctor, assertOpenCliVersion, createNodeOpenCliRunner, readBilibiliAccountName } from "./opencli-runner.js";
import type { BilibiliExecutionPlan } from "./bilibili-normalize.js";
import type { OpenCliRunner } from "./opencli-runner.js";

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

export const createOpenCliConnector = createBilibiliConnector;

/** 多 operation 的分派点（EXT-006）：连接器按 `source.operationId` 选配置 schema 与命令。 */
export const bilibiliSearchOperationId = "search";

export function isBilibiliSearchOperation(source: SourceExecutionSnapshot): boolean {
    return source.operationId === bilibiliSearchOperationId;
}

export function parseBilibiliFetchConfig(source: SourceExecutionSnapshot) {
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

export function parseBilibiliSearchConfig(source: SourceExecutionSnapshot) {
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

/** 搜索匿名可用（不读连接 profile），结果的发现上下文是 search（ING-004）。 */
export function planBilibiliSearchExecution(source: SourceExecutionSnapshot): BilibiliExecutionPlan {
    const config = parseBilibiliSearchConfig(source);
    return {
        args: ["bilibili", "search", config.query, "--limit", String(config.limit), "-f", "json"],
        profile: null,
        shape: { kind: "video", discoveryChannel: "search", locatorMode: "search" },
    };
}

/** `fetch`：hot 是平台推荐流、feed 是关注的动态（ING-004），`feed` 必须有连接里的 profile。 */
export function planBilibiliFetchExecution(source: SourceExecutionSnapshot): BilibiliExecutionPlan {
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
export function readBilibiliProfileFromConnection(
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
export function resolveBilibiliProfile(
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

export const bilibiliConnectorId = "bilibili";
