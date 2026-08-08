import {
    mkdtemp,
    readFile,
    rm,
    stat,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    createLogger,
    resolveLoggerConfig,
    sanitizeLogFields,
    sanitizeLogText,
    serializeError,
} from "./index.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
});

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-logging-"));
    roots.push(root);
    return root;
}

describe("createLogger", () => {
    it("uses the configured log root and ignores blank roots", () => {
        const originalDataRoot = process.env.COSMOS_DATA_ROOT;
        const originalLogRoot = process.env.COSMOS_LOG_ROOT;
        try {
            process.env.COSMOS_DATA_ROOT = "data-root";
            process.env.COSMOS_LOG_ROOT = "   ";

            expect(resolveLoggerConfig({
                service: "api",
            }).logRoot).toMatch(/[\\/]data-root[\\/]logs$/);
            expect(resolveLoggerConfig({
                service: "api",
                logRoot: "configured-logs",
            }).logRoot).toMatch(/[\\/]configured-logs$/);
        } finally {
            if (originalDataRoot === undefined) {
                delete process.env.COSMOS_DATA_ROOT;
            } else {
                process.env.COSMOS_DATA_ROOT = originalDataRoot;
            }
            if (originalLogRoot === undefined) {
                delete process.env.COSMOS_LOG_ROOT;
            } else {
                process.env.COSMOS_LOG_ROOT = originalLogRoot;
            }
        }
    });

    it("writes versioned structured records with context and level filtering", async () => {
        const root = await tempRoot();
        const lines: string[] = [];
        const logger = createLogger({
            service: "test-service",
            fileName: "api",
            logRoot: root,
            level: "info",
            output: "both",
            stdoutWriter: (line) => lines.push(line),
        });

        logger.debug("debug.ignored");
        logger.withContext({ requestId: "request-1", runId: "run-1" }, () => {
            logger.info("request.completed", {
                status: 200,
                query: "private text should not be logged as query",
                optional: undefined,
            });
        });
        await logger.close();

        expect(lines).toHaveLength(1);
        const record = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(record).toMatchObject({
            schemaVersion: "log.v1",
            level: "info",
            service: "test-service",
            event: "request.completed",
            requestId: "request-1",
            runId: "run-1",
            status: 200,
        });
        expect(record.query).toBe("[REDACTED]");
        expect(record.optional).toBeUndefined();
        const file = await readFile(join(root, "api.jsonl"), "utf8");
        expect(file).toContain("\"event\":\"request.completed\"");
    });

    it("redacts sensitive fields and bounds error output", () => {
        const fields = sanitizeLogFields({
            token: "secret-token",
            headers: { authorization: "Bearer secret" },
            contentText: "private content",
            safe: "value",
        });
        expect(fields).toEqual({
            token: "[REDACTED]",
            headers: "[REDACTED]",
            contentText: "[REDACTED]",
            safe: "value",
        });

        const error = serializeError(new Error(
            `response {"token":"very-secret"} token=very-secret ${"x".repeat(10_000)}`,
        ));
        expect(typeof error).toBe("object");
        expect(JSON.stringify(error)).not.toContain("very-secret");
        expect(JSON.stringify(error).length).toBeLessThan(20_000);
        expect(sanitizeLogText(
            `authorization: Bearer secret ${"x".repeat(10_000)}`,
        )).not.toContain("Bearer secret");

        const caused = new Error(
            "response {\"cookie\":\"cookie-secret\"}",
            { cause: new Error("password=secret-password") },
        );
        expect(JSON.stringify(serializeError(caused))).not.toContain(
            "cookie-secret",
        );
        expect(JSON.stringify(serializeError(caused))).not.toContain(
            "secret-password",
        );
    });

    it("rotates on the configured size and prunes old rotated files", async () => {
        const root = await tempRoot();
        const logger = createLogger({
            service: "worker",
            fileName: "worker",
            logRoot: root,
            level: "debug",
            output: "file",
            rotateBytes: 1,
            maxBytes: 1,
            retentionDays: 1,
        });

        logger.info("first");
        logger.info("second");
        await logger.close();

        const files = await import("node:fs/promises").then(({ readdir }) => readdir(root));
        expect(files).toContain("worker.jsonl");
        expect(files.filter((file) => file.startsWith("worker-"))).toHaveLength(0);
    });

    it("rotates on a date change and removes expired rotated files", async () => {
        const root = await tempRoot();
        const firstLogger = createLogger({
            service: "api",
            fileName: "api",
            logRoot: root,
            output: "file",
            rotateBytes: 16 * 1024 * 1024,
            retentionDays: 1,
        });
        firstLogger.info("old");
        await firstLogger.close();

        const activePath = join(root, "api.jsonl");
        const oldDate = new Date("2020-01-01T00:00:00.000Z");
        const currentMetadata = await stat(activePath);
        await utimes(activePath, oldDate, oldDate);
        expect(currentMetadata.size).toBeGreaterThan(0);

        const logger = createLogger({
            service: "api",
            fileName: "api",
            logRoot: root,
            output: "file",
            rotateBytes: 16 * 1024 * 1024,
            retentionDays: 1,
        });
        logger.info("new");
        await logger.close();

        const files = await import("node:fs/promises")
            .then(({ readdir }) => readdir(root));
        expect(files).toEqual(["api.jsonl"]);
    });

    it("counts the active file before pruning rotated files", async () => {
        const root = await tempRoot();
        const activePath = join(root, "worker.jsonl");
        const rotatedPath = join(root, "worker-20200101-1-1.jsonl");
        await writeFile(activePath, "a".repeat(100), "utf8");
        await writeFile(rotatedPath, "b".repeat(100), "utf8");

        const logger = createLogger({
            service: "worker",
            fileName: "worker",
            logRoot: root,
            output: "file",
            rotateBytes: 16 * 1024 * 1024,
            maxBytes: 150,
        });
        logger.info("active");
        await logger.close();

        await expect(readFile(rotatedPath, "utf8")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(await readFile(activePath, "utf8")).toContain("active");
    });

    it("truncates oversized records while preserving correlation ids", async () => {
        const lines: string[] = [];
        const logger = createLogger({
            service: "worker",
            output: "stdout",
            stdoutWriter: (line) => lines.push(line),
        });
        logger.withContext({
            requestId: "request-large",
            runId: "run-large",
            jobId: "job-large",
        }, () => {
            logger.info("large.record", Object.fromEntries(
                Array.from({ length: 64 }, (_, index) => [
                    `field${index}`,
                    "x".repeat(4_096),
                ]),
            ));
        });
        await logger.close();

        const record = JSON.parse(lines[0]) as Record<string, unknown>;
        expect(record).toMatchObject({
            event: "large.record",
            requestId: "request-large",
            runId: "run-large",
            jobId: "job-large",
            truncated: true,
        });
        expect(Buffer.byteLength(lines[0], "utf8")).toBeLessThanOrEqual(64 * 1024);
    });

    it("falls back to stdout when file output is unavailable", async () => {
        const root = await tempRoot();
        const blockedRoot = join(root, "blocked");
        await writeFile(blockedRoot, "not a directory");
        const lines: string[] = [];
        const errors: string[] = [];
        const logger = createLogger({
            service: "api",
            fileName: "api",
            logRoot: blockedRoot,
            output: "file",
            stdoutWriter: (line) => lines.push(line),
            stderrWriter: (line) => errors.push(line),
        });

        logger.info("file.unavailable");
        logger.info("file.unavailable.again");
        await logger.close();

        expect(lines).toHaveLength(2);
        expect(errors.join("\n")).toContain("logging.file_sink_failed");
    });

    it("does not throw when stdout fails and reports the sink failure to stderr", async () => {
        const root = await tempRoot();
        const errors: string[] = [];
        const logger = createLogger({
            service: "test-service",
            logRoot: root,
            output: "stdout",
            stdoutWriter: () => {
                throw new Error("stdout unavailable");
            },
            stderrWriter: (line) => errors.push(line),
        });

        expect(() => logger.error("fatal", {}, new Error("failed"))).not.toThrow();
        await logger.close();

        expect(errors.join("\n")).toContain("logging.sink_failed");
    });
});
