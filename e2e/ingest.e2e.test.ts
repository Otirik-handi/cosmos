import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    applyMigrations,
    assertLogsRedacted,
    createIsolatedStackRoot,
    disposeIsolatedStack,
    environmentForStack,
    findAvailablePort,
    formatProcessFailure,
    readStructuredLogs,
    repositoryRoot,
    spawnService,
    stopManagedProcess,
    waitForCondition,
    waitForHttp,
    type IsolatedStackRoot,
    type ManagedProcess,
} from "../scripts/e2e/helpers.js";

type HttpResult = {
    status: number;
    headers: Headers;
    body: unknown;
};

let stack: IsolatedStackRoot;
let api: ManagedProcess;
let worker: ManagedProcess;
let apiBaseUrl: string;

beforeAll(async () => {
    stack = await createIsolatedStackRoot("ingest-e2e");
    applyMigrations(stack.dataRoot);

    const apiPort = await findAvailablePort(4310);
    apiBaseUrl = `http://127.0.0.1:${apiPort}`;
    const environment = environmentForStack(process.env, stack, {
        NODE_ENV: "test",
        COSMOS_API_HOST: "127.0.0.1",
        COSMOS_API_PORT: String(apiPort),
        COSMOS_WORKSPACE_ROOT: repositoryRoot,
        COSMOS_WORKFLOW_HOST_ENABLED: "true",
        COSMOS_WORKER_ADMIN_ENABLED: "false",
        COSMOS_WORKER_POLL_MS: "50",
        COSMOS_WORKER_LEASE_MS: "30000",
        COSMOS_WORKER_SHUTDOWN_DEADLINE_MS: "5000",
        COSMOS_WORKER_ID: "ingest-e2e-worker",
    });
    api = spawnService({
        name: "ingest-e2e-api",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/api/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    try {
        await waitForHttp(`${apiBaseUrl}/readyz`, 200, 30_000);
        worker = spawnService({
            name: "ingest-e2e-worker",
            command: process.env.NODE_BINARY?.trim() || "node",
            args: ["apps/worker/dist/main.js"],
            cwd: repositoryRoot,
            env: environment,
        });
        await waitForCondition("worker heartbeat ready", async () => {
            if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
                throw new Error(formatProcessFailure(worker));
            }
            const result = await requestJson(`${apiBaseUrl}/api/v1/health`);
            return result.status === 200
                && isRecord(result.body)
                && result.body.workerStatus === "ready";
        }, 30_000, 100);
    } catch (error) {
        if (worker) await stopManagedProcess(worker, "force").catch(() => undefined);
        await stopManagedProcess(api, "force").catch(() => undefined);
        throw new Error([
            error instanceof Error ? error.message : String(error),
            api ? formatProcessFailure(api) : "",
            worker ? formatProcessFailure(worker) : "",
        ].filter(Boolean).join("\n"));
    }
}, 120_000);


describe("ingest Node process E2E", () => {
    it("creates a source, queues a durable Run, ingests the fixture, and exposes events", async () => {
        const invalidSource = await requestJson(`${apiBaseUrl}/api/v1/sources`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                name: "Invalid fixture",
                kind: "fixture-rss",
                config: { fixturePath: "" },
                enabled: true,
            }),
        });
        expect(invalidSource.status).toBe(400);
        expect(invalidSource.body).toMatchObject({ code: "validation_failed" });

        const sourceResponse = await requestJson(`${apiBaseUrl}/api/v1/sources`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                name: "Fixture RSS E2E",
                kind: "fixture-rss",
                config: { fixturePath: "fixtures/rss/basic.xml" },
                enabled: true,
            }),
        });
        expect(sourceResponse.status).toBe(201);
        expect(sourceResponse.body).toMatchObject({
            name: "Fixture RSS E2E",
            kind: "fixture-rss",
            config: {},
        });
        const sourceId = readString(sourceResponse.body, "id");

        const secondSourceResponse = await requestJson(`${apiBaseUrl}/api/v1/sources`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                name: "Second Fixture RSS E2E",
                kind: "fixture-rss",
                config: { fixturePath: "fixtures/rss/basic.xml" },
                enabled: true,
            }),
        });
        expect(secondSourceResponse.status).toBe(201);
        const secondSourceId = readString(secondSourceResponse.body, "id");

        const missingRun = await requestJson(`${apiBaseUrl}/api/v1/runs/missing-run`);
        expect(missingRun.status).toBe(404);
        expect(missingRun.body).toMatchObject({ code: "not_found" });

        const idempotencyKey = "ingest-e2e-run-1";
        const queued = await requestJson(`${apiBaseUrl}/api/v1/sources/${sourceId}/runs`, {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
        });
        expect(queued.status).toBe(201);
        expect(queued.body).toMatchObject({
            id: expect.any(String),
            sourceId,
            triggerKind: "manual",
            status: "queued",
        });
        const runId = readString(queued.body, "id");

        const repeated = await requestJson(`${apiBaseUrl}/api/v1/sources/${sourceId}/runs`, {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
        });
        expect(repeated.status).toBe(201);
        expect(repeated.body).toMatchObject({ id: runId, sourceId });
        expect(["queued", "running", "succeeded", "failed", "cancelled"]).toContain(
            isRecord(repeated.body) ? repeated.body.status : undefined,
        );

        const conflict = await requestJson(`${apiBaseUrl}/api/v1/sources/${secondSourceId}/runs`, {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
        });
        expect(conflict.status).toBe(409);
        expect(conflict.body).toMatchObject({ code: "conflict", retryable: false });

        const sseText = await waitForSseEvent(
            `${apiBaseUrl}/api/v1/events?after=0`,
            "run.queued.v1",
            15_000,
        );
        expect(sseText).toContain(runId);

        let completedRun: Record<string, unknown> | null = null;
        await waitForCondition("durable ingest Run completion", async () => {
            const result = await requestJson(`${apiBaseUrl}/api/v1/runs/${runId}`);
            if (result.status !== 200 || !isRecord(result.body)) return false;
            completedRun = result.body;
            return result.body.status === "succeeded";
        }, 60_000, 250);
        expect(completedRun).toMatchObject({ id: runId, sourceId, status: "succeeded" });

        let feed: Record<string, unknown> = {};
        await waitForCondition("fixture entries", async () => {
            const result = await requestJson(`${apiBaseUrl}/api/v1/feed?limit=10`);
            if (result.status !== 200 || !isRecord(result.body)) return false;
            feed = result.body;
            return Array.isArray(result.body.items) && result.body.items.length >= 3;
        }, 30_000, 250);
        expect(feed.items).toHaveLength(3);

        const source = await requestJson(`${apiBaseUrl}/api/v1/sources/${sourceId}`);
        expect(source.status).toBe(200);
        expect(source.body).toMatchObject({
            id: sourceId,
            lastRunAt: expect.any(String),
            lastError: null,
        });
    }, 120_000);
});

async function requestJson(url: string, init?: RequestInit): Promise<HttpResult> {
    const response = await fetch(url, init);
    const text = await response.text();
    let body: unknown = null;
    if (text) {
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            body = text;
        }
    }
    return { status: response.status, headers: response.headers, body };
}

async function waitForSseEvent(url: string, marker: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || !response.body) {
            throw new Error(`SSE endpoint returned ${response.status}.`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                text += decoder.decode(chunk.value, { stream: true });
                if (text.includes(marker)) return text;
            }
        } finally {
            await reader.cancel().catch(() => undefined);
        }
        throw new Error(`SSE stream ended before ${marker} appeared.`);
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`Timed out waiting for SSE marker ${marker}.`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        controller.abort();
    }
}

function readString(value: unknown, key: string): string {
    if (!isRecord(value) || typeof value[key] !== "string" || value[key].length === 0) {
        throw new Error(`Expected ${key} in response.`);
    }
    return value[key];
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
