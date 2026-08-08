import { AsyncLocalStorage } from "node:async_hooks";
import { hostname } from "node:os";
import {
    appendFile,
    mkdir,
    readdir,
    rename,
    stat,
    unlink,
} from "node:fs/promises";
import {
    basename,
    join,
    resolve,
} from "node:path";

export const logSchemaVersion = "log.v1" as const;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogOutput = "stdout" | "file" | "both";

export interface LogContext {
    requestId?: string;
    runId?: string;
    jobId?: string;
    sourceId?: string;
    connectorId?: string;
}

export interface LogError {
    name: string;
    message: string;
    stack?: string;
    cause?: LogError | string;
}

export interface LogRecord extends LogContext {
    schemaVersion: typeof logSchemaVersion;
    timestamp: string;
    level: LogLevel;
    service: string;
    instanceId: string;
    pid: number;
    hostname: string;
    event: string;
    durationMs?: number;
    status?: string;
    attempt?: number;
    error?: LogError | string;
    [key: string]: unknown;
}

export interface Logger {
    child(context: LogContext): Logger;
    withContext<T>(context: LogContext, callback: () => T): T;
    withContext<T>(
        context: LogContext,
        callback: () => Promise<T>,
    ): Promise<T>;
    debug(event: string, fields?: Record<string, unknown>): void;
    info(event: string, fields?: Record<string, unknown>): void;
    warn(event: string, fields?: Record<string, unknown>): void;
    error(
        event: string,
        fields?: Record<string, unknown>,
        error?: unknown,
    ): void;
    close(): Promise<void>;
}

export interface LoggerOptions {
    service: string;
    fileName?: string;
    instanceId?: string;
    logRoot?: string;
    level?: LogLevel;
    output?: LogOutput;
    retentionDays?: number;
    maxBytes?: number;
    rotateBytes?: number;
    stdoutWriter?: (line: string) => void;
    stderrWriter?: (line: string) => void;
}

export interface ResolvedLoggerConfig {
    service: string;
    fileName: string;
    instanceId: string;
    logRoot: string;
    level: LogLevel;
    output: LogOutput;
    retentionDays: number;
    maxBytes: number;
    rotateBytes: number;
}

const levelWeights: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const defaultMaxRecordBytes = 64 * 1024;
const maxStringLength = 4 * 1024;
const maxObjectKeys = 64;
const maxArrayItems = 64;
const secretKeyPattern = /(?:secret|token|password|cookie|authorization|api[-_]?key|prompt|payload|content(?:text)?|body|headers|stdout|stderr|query(?:string)?|requesturl|responsebody)/i;
const secretTextPatterns = [
    /((?:bearer|basic)\s+)[^\s,;]+/gi,
    /((?:token|secret|password|api[_-]?key)\s*=\s*)[^&\s,;]+/gi,
    /((?:authorization|cookie)\s*:\s*)[^\r\n;]+/gi,
    /((?:["']?)(?:access[_-]?token|refresh[_-]?token|token|secret|password|api[_-]?key|cookie|authorization|prompt|payload|body|content(?:text)?|stdout|stderr)(?:["']?\s*[:=]\s*))(?:"[^"]*"|'[^']*'|[^,\s}\]]+)/gi,
];
const contextStorage = new AsyncLocalStorage<LogContext>();

export function createLogger(options: LoggerOptions): Logger {
    const config = resolveLoggerConfig(options);
    const stdoutWriter = options.stdoutWriter ?? ((line) => {
        process.stdout.write(`${line}\n`);
    });
    const stderrWriter = options.stderrWriter ?? ((line) => {
        process.stderr.write(`${line}\n`);
    });
    const fileSink = config.output === "file" || config.output === "both"
        ? new RotatingFileSink(
            config,
            stderrWriter,
            config.output === "file" ? stdoutWriter : undefined,
        )
        : null;

    return new RuntimeLogger(
        config,
        contextStorage,
        stdoutWriter,
        stderrWriter,
        fileSink,
    );
}

export function resolveLoggerConfig(
    options: LoggerOptions,
): ResolvedLoggerConfig {
    const nodeEnvironment = process.env.NODE_ENV ?? "development";
    const configuredLevel = options.level
        ?? parseLogLevel(process.env.COSMOS_LOG_LEVEL)
        ?? (nodeEnvironment === "production" ? "info" : "debug");
    const configuredOutput = options.output
        ?? parseLogOutput(process.env.COSMOS_LOG_OUTPUT)
        ?? "both";
    const configuredLogRoot = nonBlankString(options.logRoot)
        ?? nonBlankString(process.env.COSMOS_LOG_ROOT);
    const dataRoot = nonBlankString(process.env.COSMOS_DATA_ROOT) ?? ".cosmos";

    return {
        service: options.service,
        fileName: safeFileName(options.fileName ?? options.service)
            || safeFileName(options.service)
            || "cosmos",
        instanceId: options.instanceId ?? `${hostname()}:${process.pid}`,
        logRoot: resolve(/* turbopackIgnore: true */
            configuredLogRoot ?? join(dataRoot, "logs"),
        ),
        level: configuredLevel,
        output: configuredOutput,
        retentionDays: positiveInteger(
            options.retentionDays
                ?? process.env.COSMOS_LOG_RETENTION_DAYS,
            7,
        ),
        maxBytes: positiveInteger(
            options.maxBytes
                ?? process.env.COSMOS_LOG_MAX_BYTES,
            256 * 1024 * 1024,
        ),
        rotateBytes: positiveInteger(
            options.rotateBytes,
            16 * 1024 * 1024,
        ),
    };
}

export function serializeError(
    value: unknown,
    depth = 0,
): LogError | string {
    if (depth > 3) {
        return "[CAUSE_TRUNCATED]";
    }
    if (value instanceof Error) {
        const result: LogError = {
            name: sanitizeString(value.name),
            message: sanitizeString(value.message),
        };
        if (value.stack) {
            result.stack = sanitizeString(value.stack);
        }
        if (value.cause !== undefined) {
            result.cause = serializeError(value.cause, depth + 1);
        }
        return result;
    }
    return sanitizeString(String(value));
}

export function sanitizeLogFields(
    fields: Record<string, unknown>,
): Record<string, unknown> {
    return sanitizeObject(fields, 0) as Record<string, unknown>;
}

export function sanitizeLogText(value: string): string {
    return sanitizeString(value);
}

class RuntimeLogger implements Logger {
    constructor(
        private readonly config: ResolvedLoggerConfig,
        private readonly storage: AsyncLocalStorage<LogContext>,
        private readonly stdoutWriter: (line: string) => void,
        private readonly stderrWriter: (line: string) => void,
        private readonly fileSink: RotatingFileSink | null,
        private readonly localContext: LogContext = {},
    ) {}

    child(context: LogContext): Logger {
        return new RuntimeLogger(
            this.config,
            this.storage,
            this.stdoutWriter,
            this.stderrWriter,
            this.fileSink,
            {
                ...this.localContext,
                ...context,
            },
        );
    }

    withContext<T>(context: LogContext, callback: () => T): T;
    withContext<T>(
        context: LogContext,
        callback: () => Promise<T>,
    ): Promise<T>;
    withContext<T>(
        context: LogContext,
        callback: () => T | Promise<T>,
    ): T | Promise<T> {
        return this.storage.run(
            {
                ...this.storage.getStore(),
                ...this.localContext,
                ...context,
            },
            callback,
        );
    }

    debug(event: string, fields: Record<string, unknown> = {}): void {
        this.write("debug", event, fields);
    }

    info(event: string, fields: Record<string, unknown> = {}): void {
        this.write("info", event, fields);
    }

    warn(event: string, fields: Record<string, unknown> = {}): void {
        this.write("warn", event, fields);
    }

    error(
        event: string,
        fields: Record<string, unknown> = {},
        error?: unknown,
    ): void {
        this.write("error", event, {
            ...fields,
            ...(error === undefined ? {} : { error: serializeError(error) }),
        });
    }

    async close(): Promise<void> {
        await this.fileSink?.close();
    }

    private write(
        level: LogLevel,
        event: string,
        fields: Record<string, unknown>,
    ): void {
        if (levelWeights[level] < levelWeights[this.config.level]) {
            return;
        }

        const context = {
            ...this.storage.getStore(),
            ...this.localContext,
        };
        const safeFields = sanitizeLogFields(fields);
        const record: LogRecord = {
            ...safeFields,
            schemaVersion: logSchemaVersion,
            timestamp: new Date().toISOString(),
            level,
            service: this.config.service,
            instanceId: this.config.instanceId,
            pid: process.pid,
            hostname: hostname(),
            event: sanitizeString(event),
            ...context,
        };
        const line = limitRecordSize(record);

        if (this.config.output === "stdout" || this.config.output === "both") {
            try {
                this.stdoutWriter(line);
            } catch (error) {
                this.reportSinkFailure("stdout", error);
            }
        }
        if (this.fileSink) {
            this.fileSink.write(line);
        }
    }

    private reportSinkFailure(sink: string, error: unknown): void {
        try {
            this.stderrWriter(JSON.stringify({
                schemaVersion: logSchemaVersion,
                timestamp: new Date().toISOString(),
                level: "error",
                service: this.config.service,
                instanceId: this.config.instanceId,
                pid: process.pid,
                hostname: hostname(),
                event: "logging.sink_failed",
                sink,
                error: serializeError(error),
            }));
        } catch {
            // A logging fallback must never affect the application.
        }
    }
}

class RotatingFileSink {
    private queue: Promise<void> = Promise.resolve();
    private currentDate: string | null = null;
    private currentBytes = 0;
    private closed = false;
    private failureReported = false;
    private failed = false;

    constructor(
        private readonly config: ResolvedLoggerConfig,
        private readonly stderrWriter: (line: string) => void,
        private readonly fallbackWriter?: (line: string) => void,
    ) {}

    write(line: string): void {
        if (this.closed) {
            return;
        }
        this.queue = this.queue
            .then(() => {
                if (this.failed) {
                    this.writeFallback(line);
                    return;
                }
                return this.append(line);
            })
            .catch((error) => {
                this.failed = true;
                this.reportFailure(error);
                this.writeFallback(line);
            });
    }

    async close(): Promise<void> {
        this.closed = true;
        await this.queue;
    }

    private async append(line: string): Promise<void> {
        const content = `${line}\n`;
        const byteLength = Buffer.byteLength(content, "utf8");
        await mkdir(this.config.logRoot, { recursive: true });

        const date = dateKey(new Date());
        const currentPath = join(
            this.config.logRoot,
            `${this.config.fileName}.jsonl`,
        );
        if (this.currentDate === null) {
            const currentMetadata = await fileMetadata(currentPath);
            this.currentDate = currentMetadata
                ? dateKey(new Date(currentMetadata.mtimeMs))
                : date;
            this.currentBytes = currentMetadata?.size ?? 0;
        }
        if (
            this.currentBytes > 0
            && (
                this.currentDate !== date
                || this.currentBytes + byteLength > this.config.rotateBytes
            )
        ) {
            await this.rotate(currentPath, date);
            this.currentDate = date;
            this.currentBytes = 0;
        }

        await appendFile(currentPath, content, "utf8");
        this.currentBytes += byteLength;
        await pruneLogRoot(this.config);
    }

    private async rotate(currentPath: string, date: string): Promise<void> {
        const rotatedPath = join(
            this.config.logRoot,
            `${this.config.fileName}-${date}-${Date.now()}-${process.pid}.jsonl`,
        );
        try {
            await rename(currentPath, rotatedPath);
        } catch (error) {
            if (!isFileNotFound(error)) {
                throw error;
            }
        }
    }

    private reportFailure(error: unknown): void {
        if (this.failureReported) {
            return;
        }
        this.failureReported = true;
        try {
            this.stderrWriter(JSON.stringify({
                schemaVersion: logSchemaVersion,
                timestamp: new Date().toISOString(),
                level: "error",
                service: this.config.service,
                instanceId: this.config.instanceId,
                pid: process.pid,
                hostname: hostname(),
                event: "logging.file_sink_failed",
                error: serializeError(error),
            }));
        } catch {
            // A logging fallback must never affect the application.
        }
    }

    private writeFallback(line: string): void {
        if (!this.fallbackWriter) {
            return;
        }
        try {
            this.fallbackWriter(line);
        } catch (error) {
            try {
                this.stderrWriter(JSON.stringify({
                    schemaVersion: logSchemaVersion,
                    timestamp: new Date().toISOString(),
                    level: "error",
                    service: this.config.service,
                    instanceId: this.config.instanceId,
                    pid: process.pid,
                    hostname: hostname(),
                    event: "logging.file_sink_fallback_failed",
                    error: serializeError(error),
                }));
            } catch {
                // A logging fallback must never affect the application.
            }
        }
    }
}

async function pruneLogRoot(config: ResolvedLoggerConfig): Promise<void> {
    let entries;
    try {
        entries = await readdir(config.logRoot);
    } catch (error) {
        if (isFileNotFound(error)) {
            return;
        }
        throw error;
    }

    const files: Array<{
        path: string;
        name: string;
        bytes: number;
        modifiedAt: number;
        active: boolean;
    }> = [];
    for (const name of entries) {
        if (!name.endsWith(".jsonl")) {
            continue;
        }
        const path = join(config.logRoot, name);
        const metadata = await stat(path).catch(() => null);
        if (!metadata?.isFile()) {
            continue;
        }
        files.push({
            path,
            name,
            bytes: metadata.size,
            modifiedAt: metadata.mtimeMs,
            active: !rotatedFilePattern.test(name),
        });
    }

    const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1_000;
    const rotated = files
        .filter((file) => !file.active)
        .sort((left, right) => left.modifiedAt - right.modifiedAt);
    for (const file of rotated) {
        if (file.modifiedAt >= cutoff) {
            continue;
        }
        await unlink(file.path).catch((error) => {
            if (!isFileNotFound(error)) {
                throw error;
            }
        });
        file.bytes = 0;
    }

    let totalBytes = files.reduce((total, file) => total + file.bytes, 0);
    for (const file of rotated) {
        if (totalBytes <= config.maxBytes || file.bytes === 0) {
            continue;
        }
        await unlink(file.path).catch((error) => {
            if (!isFileNotFound(error)) {
                throw error;
            }
        });
        totalBytes -= file.bytes;
        file.bytes = 0;
    }
}

function limitRecordSize(record: LogRecord): string {
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, "utf8") <= defaultMaxRecordBytes) {
        return serialized;
    }
    return JSON.stringify({
        schemaVersion: logSchemaVersion,
        timestamp: record.timestamp,
        level: record.level,
        service: record.service,
        instanceId: record.instanceId,
        pid: record.pid,
        hostname: record.hostname,
        event: record.event,
        requestId: record.requestId,
        runId: record.runId,
        jobId: record.jobId,
        sourceId: record.sourceId,
        connectorId: record.connectorId,
        truncated: true,
    });
}

function sanitizeObject(value: unknown, depth: number, key?: string): unknown {
    if (key && secretKeyPattern.test(key)) {
        return "[REDACTED]";
    }
    if (value === undefined) {
        return undefined;
    }
    if (depth > 5) {
        return "[TRUNCATED]";
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") {
        return value;
    }
    if (typeof value === "string") {
        return sanitizeString(value);
    }
    if (typeof value === "bigint") {
        return sanitizeString(value.toString());
    }
    if (value instanceof Error) {
        return serializeError(value, depth);
    }
    if (Array.isArray(value)) {
        return value
            .slice(0, maxArrayItems)
            .map((item) => sanitizeObject(item, depth + 1));
    }
    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value).slice(0, maxObjectKeys)) {
            const sanitized = sanitizeObject(childValue, depth + 1, childKey);
            if (sanitized !== undefined) {
                result[childKey] = sanitized;
            }
        }
        return result;
    }
    return sanitizeString(String(value));
}

function sanitizeString(value: string): string {
    return secretTextPatterns
        .reduce(
            (current, pattern) => current.replace(pattern, "$1[REDACTED]"),
            value,
        )
        .slice(0, maxStringLength);
}

function parseLogLevel(value: string | undefined): LogLevel | undefined {
    return value === "debug"
        || value === "info"
        || value === "warn"
        || value === "error"
        ? value
        : undefined;
}

function parseLogOutput(value: string | undefined): LogOutput | undefined {
    return value === "stdout" || value === "file" || value === "both"
        ? value
        : undefined;
}

function positiveInteger(value: number | string | undefined, fallback: number): number {
    const parsed = typeof value === "number"
        ? value
        : Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : fallback;
}

function nonBlankString(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
}

function dateKey(value: Date): string {
    return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function safeFileName(value: string): string {
    return basename(value).replace(/[^A-Za-z0-9._-]/g, "_");
}

async function fileMetadata(path: string): Promise<{
    size: number;
    mtimeMs: number;
} | null> {
    const metadata = await stat(path).catch(() => null);
    return metadata?.isFile()
        ? { size: metadata.size, mtimeMs: metadata.mtimeMs }
        : null;
}

function isFileNotFound(error: unknown): boolean {
    return error instanceof Error
        && "code" in error
        && error.code === "ENOENT";
}

const rotatedFilePattern = /-\d{8}-\d+-\d+\.jsonl$/;
