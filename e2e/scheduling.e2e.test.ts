import { readFile } from "node:fs/promises";

import { createControlledRssServer, type ControlledRssServer } from "../scripts/e2e/controlled-rss.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    applyMigrations,
    createRssSource,
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

type JsonResponse = {
    status: number;
    body: unknown;
};

let stack: IsolatedStackRoot;
let api: ManagedProcess;
let worker: ManagedProcess;
let apiBaseUrl: string;
let badSourceId: string;
let goodSourceId: string;
let rss: ControlledRssServer;

beforeAll(async () => {
    stack = await createIsolatedStackRoot("scheduling-e2e");
    const fixtureXml = await readFile(new URL("../fixtures/rss/basic.xml", import.meta.url), "utf8");
    rss = await createControlledRssServer(fixtureXml);
    rss.release();
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
        COSMOS_WORKER_ID: "scheduling-e2e-worker",
    });
    api = spawnService({
        name: "scheduling-e2e-api",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/api/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    try {
        await waitForHttp(`${apiBaseUrl}/readyz`, 200, 30_000);
        const collisionSource = await createSource("Collision binding", true);
        const badSource = await createSource("Broken schedule source", true);
        const goodSource = await createSource("Healthy schedule source", true);
        badSourceId = readString(badSource, "id");
        goodSourceId = readString(goodSource, "id");
        const bucket = Math.floor(Date.now() / 60_000);
        const collisionKey = `schedule:${badSourceId}:${bucket}`;
        const collisionRun = await requestJson(
            `${apiBaseUrl}/api/v1/sources/${readString(collisionSource, "id")}/runs`,
            {
                method: "POST",
                headers: { "idempotency-key": collisionKey },
            },
        );
        expect(collisionRun.status).toBe(201);

        worker = spawnService({
            name: "scheduling-e2e-worker",
            command: process.env.NODE_BINARY?.trim() || "node",
            args: ["apps/worker/dist/main.js"],
            cwd: repositoryRoot,
            env: environment,
        });
        await waitForCondition("schedule Worker heartbeat ready", async () => {
            if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
                throw new Error(formatProcessFailure(worker));
            }
            const health = await requestJson(`${apiBaseUrl}/api/v1/health`);
            return health.status === 200
                && isRecord(health.body)
                && health.body.workerStatus === "ready";
        }, 30_000, 100);
    } catch (error) {
        await stopManagedProcess(worker, "force").catch(() => undefined);
        await stopManagedProcess(api, "force").catch(() => undefined);
        await rss.close().catch(() => undefined);
        throw new Error([
            error instanceof Error ? error.message : String(error),
            api ? formatProcessFailure(api) : "",
            worker ? formatProcessFailure(worker) : "",
        ].filter(Boolean).join("\n"));
    }
}, 120_000);

afterAll(async () => {
    await stopManagedProcess(worker, "graceful").catch(() => undefined);
    await stopManagedProcess(api, "graceful").catch(() => undefined);
    await rss?.close().catch(() => undefined);
    if (stack) {
        const records = await readStructuredLogs(stack.logRoot).catch(() => []);
        assertLogsRedacted(records);
        await disposeIsolatedStack(stack.root);
    }
}, 120_000);

describe("schedule failure isolation E2E", () => {
    it("continues scheduling and executing a healthy source after a conflict", async () => {
        let entries: Record<string, unknown> = {};
        await waitForCondition("healthy scheduled source entries", async () => {
            const result = await requestJson(
                `${apiBaseUrl}/api/v1/entries?sourceId=${encodeURIComponent(goodSourceId)}&limit=10`,
            );
            if (result.status !== 200 || !isRecord(result.body)) return false;
            entries = result.body;
            return Array.isArray(result.body.items) && result.body.items.length >= 3;
        }, 60_000, 250);
        expect(entries.items).toHaveLength(3);

        let records: readonly Record<string, unknown>[] = [];
        await waitForCondition("schedule isolation logs", async () => {
            records = await readStructuredLogs(stack.logRoot);
            return records.some((record) =>
                record.event === "workflow.run.queue_failed" && record.sourceId === badSourceId,
            ) && records.some((record) =>
                record.event === "workflow.run.queued"
                    && record.sourceId === goodSourceId
                    && record.triggerKind === "schedule",
            );
        }, 30_000, 100);
        expect(records).toEqual(expect.arrayContaining([
            expect.objectContaining({
                event: "workflow.run.queue_failed",
                sourceId: badSourceId,
            }),
        ]));
        expect(records).toEqual(expect.arrayContaining([
            expect.objectContaining({
                event: "workflow.run.queued",
                sourceId: goodSourceId,
                triggerKind: "schedule",
            }),
        ]));
    }, 120_000);
});

async function createSource(name: string, enabled: boolean): Promise<unknown> {
    return await createRssSource({
        apiBaseUrl,
        feedUrl: rss.url,
        name,
        enabled,
        scheduleIntervalMs: 60_000,
        activationIdempotencyKey: (sourceId) => `scheduling-activate:${sourceId}`,
    });
}

async function requestJson(url: string, init?: RequestInit): Promise<JsonResponse> {
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
    return { status: response.status, body };
}

function readString(value: unknown, key: string): string {
    if (!isRecord(value) || typeof value[key] !== "string" || value[key].length === 0) {
        throw new Error(`Expected ${key} in response.`);
    }
    return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
