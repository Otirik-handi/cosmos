import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { LoggerPort } from "@cosmos/application";
import { ConnectorExecutionError } from "@cosmos/application";
import { openCliProfileSchema } from "@cosmos/contracts";
import { firstText, parseJsonDocument } from "./shared.js";

export const execFileAsync = promisify(execFile);

export const require = createRequire(import.meta.url);

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

export function assertOpenCliDoctor(output: string): void {
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

export function assertOpenCliVersion(output: string, exitCode: number): void {
    const match = output.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
    if (exitCode !== 0 || !match || Number(match[1]) !== supportedOpenCliMajor) {
        throw new ConnectorExecutionError(
            "unsupported_version",
            `OpenCLI major version ${supportedOpenCliMajor} is required.`,
            false,
        );
    }
}

/**
 * 从 `bilibili me` 的输出里取账号标签。实测字段是 `name` 与 `uid`（`-f json` 时是 JSON）；
 * 取不到名字时退到 uid，两者都没有就返回 null——探测结论不因为标签缺失而改变。
 */
export function readBilibiliAccountName(output: string): string | null {
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

export const openCliExecutableEnv = "COSMOS_OPENCLI_PATH";

export const supportedOpenCliMajor = 1;
