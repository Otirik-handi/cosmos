import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createControlledRssServer, type ControlledRssServer } from "../scripts/e2e/controlled-rss.js";
import {
    applyMigrations,
    assertLogsRedacted,
    createIsolatedStackRoot,
    delay,
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

const fixtureXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
    <channel>
        <title>Recovery Fixture Feed</title>
        <link>https://example.test/recovery</link>
        <item>
            <guid>recovery-item-001</guid>
            <title>Recovered item</title>
            <link>https://example.test/recovery/1</link>
            <description>Processed after the first Worker was terminated.</description>
            <pubDate>Tue, 18 Aug 2026 12:00:00 GMT</pubDate>
        </item>
    </channel>
</rss>`;

let stack: IsolatedStackRoot;
let rss: ControlledRssServer;
let api: ManagedProcess;
let firstWorker: ManagedProcess;
let secondWorker: ManagedProcess;
let apiBaseUrl: string;

beforeAll(async () => {
    stack = await createIsolatedStackRoot("recovery-e2e");
    applyMigrations(stack.dataRoot);
    rss = await createControlledRssServer(fixtureXml);
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
        COSMOS_WORKER_LEASE_MS: "1000",
        COSMOS_WORKER_SHUTDOWN_DEADLINE_MS: "5000",
    });
    api = spawnService({
        name: "recovery-e2e-api",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/api/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    try {
        await waitForHttp(`${apiBaseUrl}/readyz`, 200, 30_000);
        const source = await requestJson(`${apiBaseUrl}/api/v1/sources`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                name: "Controlled Recovery RSS",
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: rss.url },
            }),
        });
        expect(source.status).toBe(201);
        const sourceId = readString(source.body, "id");
        const activated = await requestJson(
            `${apiBaseUrl}/api/v1/sources/${sourceId}/activation-commands`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "idempotency-key": "recovery-e2e-activation",
                },
                body: JSON.stringify({
                    enabled: true,
                    baseRevisionId: readString(source.body, "revisionId"),
                }),
            },
        );
        expect(activated.status).toBe(201);
        const queued = await requestJson(`${apiBaseUrl}/api/v1/sources/${sourceId}/runs`, {
            method: "POST",
            headers: { "idempotency-key": "recovery-e2e-run" },
        });
        expect(queued.status).toBe(201);
        const runId = readString(queued.body, "id");

        const workerEnvironment = {
            ...environment,
            COSMOS_WORKER_ID: "recovery-worker-1",
        };
        firstWorker = spawnService({
            name: "recovery-e2e-worker-1",
            command: process.env.NODE_BINARY?.trim() || "node",
            args: ["apps/worker/dist/main.js"],
            cwd: repositoryRoot,
            env: workerEnvironment,
        });
        await waitForCondition("first Worker started and claimed RSS", async () => {
            if (firstWorker.child.exitCode !== null || firstWorker.child.signalCode !== null) {
                throw new Error(formatProcessFailure(firstWorker));
            }
            return firstWorker.stdout.includes('"event":"worker.started"') && rss.requests.length >= 1;
        }, 30_000, 50);

        await stopManagedProcess(firstWorker, "force");
        const firstExit = await firstWorker.waitForExit(10_000);
        expect(firstExit.code).not.toBe(0);

        await delay(1_250);
        secondWorker = spawnService({
            name: "recovery-e2e-worker-2",
            command: process.env.NODE_BINARY?.trim() || "node",
            args: ["apps/worker/dist/main.js"],
            cwd: repositoryRoot,
            env: {
                ...environment,
                COSMOS_WORKER_ID: "recovery-worker-2",
            },
        });
        await waitForCondition("second Worker started and reclaimed RSS", async () => {
            if (secondWorker.child.exitCode !== null || secondWorker.child.signalCode !== null) {
                throw new Error(formatProcessFailure(secondWorker));
            }
            return secondWorker.stdout.includes('"event":"worker.started"') && rss.requests.length >= 2;
        }, 30_000, 50);

        rss.release();
        await waitForCondition("recovered Run completion", async () => {
            const result = await requestJson(`${apiBaseUrl}/api/v1/runs/${runId}`);
            return result.status === 200
                && isRecord(result.body)
                && result.body.status === "succeeded";
        }, 60_000, 250);
        const feed = await requestJson(`${apiBaseUrl}/api/v1/feed?limit=10`);
        expect(feed.status).toBe(200);
        expect(feed.body).toMatchObject({
            items: expect.arrayContaining([
                expect.objectContaining({ title: "Recovered item" }),
            ]),
        });
    } catch (error) {
        await stopManagedProcess(firstWorker, "force").catch(() => undefined);
        await stopManagedProcess(secondWorker, "force").catch(() => undefined);
        await stopManagedProcess(api, "force").catch(() => undefined);
        await rss.close().catch(() => undefined);
        throw new Error([
            error instanceof Error ? error.message : String(error),
            api ? formatProcessFailure(api) : "",
            firstWorker ? formatProcessFailure(firstWorker) : "",
            secondWorker ? formatProcessFailure(secondWorker) : "",
        ].filter(Boolean).join("\n"));
    }
}, 180_000);

afterAll(async () => {
    await stopManagedProcess(secondWorker, "force").catch(() => undefined);
    await stopManagedProcess(firstWorker, "force").catch(() => undefined);
    await stopManagedProcess(api, "force").catch(() => undefined);
    await rss?.close().catch(() => undefined);
    if (stack) {
        const records = await readStructuredLogs(stack.logRoot).catch(() => []);
        assertLogsRedacted(records);
        await disposeIsolatedStack(stack.root);
    }
}, 120_000);

describe("cross-process Worker recovery E2E", () => {
    it("is defined by the beforeAll crash-and-reclaim scenario", () => {
        expect(rss.requests.length).toBeGreaterThanOrEqual(2);
        expect(secondWorker.stdout).toContain('"event":"worker.started"');
    });
});

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
