/**
 * OPS-011 行为测试（真实进程）。
 *
 * 验收文字要求两件事在进程边界上成立：
 * ① Worker 停止时 API 仍可 ready，并读取已保存内容；
 * ③ draining 的 Worker 进程仍 alive，但 execution readiness 为 false。
 *
 * 单元测试里 API 与 Worker 是两个互不相干的对象，证明不了这两条；必须在真实进程上跑。
 * Windows 上 `child.kill("SIGTERM")` 不会触发 Node 的信号处理器，所以这里走 Worker Admin
 * drain 这条生产关闭路径，而不是发信号。
 */
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    createControlledRssServer,
    type ControlledRssServer,
} from "../scripts/e2e/controlled-rss.js";
import {
    applyMigrations,
    assertLogsRedacted,
    createIsolatedStackRoot,
    createRssSource,
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
/** 立刻放行：用来跑完一次完整录入，产出「已保存内容」。 */
let rssCompleted: ControlledRssServer;
/** 故意不放行：把 Worker 卡在一次 poll 里，好让 draining 窗口可观测。 */
let rssBlocking: ControlledRssServer;
let apiBaseUrl = "";
let adminBaseUrl = "";
const token = "api-worker-independence-e2e-token";
const workerId = "api-worker-independence-e2e";

beforeAll(async () => {
    stack = await createIsolatedStackRoot("api-worker-independence-e2e");
    const fixtureXml = await readFile(new URL("../fixtures/rss/basic.xml", import.meta.url), "utf8");
    rssCompleted = await createControlledRssServer(fixtureXml);
    rssCompleted.release();
    rssBlocking = await createControlledRssServer(fixtureXml);
    applyMigrations(stack.dataRoot);

    const apiPort = await findAvailablePort(4310);
    apiBaseUrl = `http://127.0.0.1:${apiPort}`;
    const environment = environmentForStack(process.env, stack, {
        NODE_ENV: "test",
        COSMOS_API_HOST: "127.0.0.1",
        COSMOS_API_PORT: String(apiPort),
        COSMOS_WORKSPACE_ROOT: repositoryRoot,
        COSMOS_WORKFLOW_HOST_ENABLED: "true",
        COSMOS_WORKER_ADMIN_ENABLED: "true",
        COSMOS_WORKER_ADMIN_HOST: "127.0.0.1",
        COSMOS_WORKER_ADMIN_PORT: "0",
        COSMOS_WORKER_ADMIN_TOKEN: token,
        COSMOS_WORKER_POLL_MS: "50",
        COSMOS_WORKER_LEASE_MS: "30000",
        COSMOS_WORKER_SHUTDOWN_DEADLINE_MS: "15000",
        COSMOS_WORKER_ID: workerId,
    });
    api = spawnService({
        name: "api-worker-independence-e2e-api",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/api/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    worker = spawnService({
        name: "api-worker-independence-e2e-worker",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/worker/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    try {
        await waitForHttp(`${apiBaseUrl}/readyz`, 200, 30_000);
        await waitForCondition("Worker Admin readiness", async () => {
            if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
                throw new Error(formatProcessFailure(worker));
            }
            const started = worker.stdout
                .split(/\r?\n/)
                .map((line) => {
                    try {
                        return JSON.parse(line) as Record<string, unknown>;
                    } catch {
                        return null;
                    }
                })
                .find((record) => record?.event === "worker.admin.started");
            if (typeof started?.port !== "number") return false;
            adminBaseUrl = `http://127.0.0.1:${started.port}`;
            const response = await requestJson(`${adminBaseUrl}/readyz`, { headers: authHeaders() });
            return response.status === 200 && isRecord(response.body) && response.body.ready === true;
        }, 30_000, 100);
    } catch (error) {
        await stopManagedProcess(worker, "force").catch(() => undefined);
        await stopManagedProcess(api, "force").catch(() => undefined);
        await rssCompleted.close().catch(() => undefined);
        await rssBlocking.close().catch(() => undefined);
        throw new Error([
            error instanceof Error ? error.message : String(error),
            api ? formatProcessFailure(api) : "",
            worker ? formatProcessFailure(worker) : "",
        ].filter(Boolean).join("\n"));
    }
}, 120_000);

afterAll(async () => {
    await stopManagedProcess(worker, "force").catch(() => undefined);
    await stopManagedProcess(api, "force").catch(() => undefined);
    await rssCompleted?.close().catch(() => undefined);
    await rssBlocking?.close().catch(() => undefined);
    if (stack) {
        const records = await readStructuredLogs(stack.logRoot).catch(() => []);
        assertLogsRedacted(records);
        await disposeIsolatedStack(stack.root);
    }
}, 120_000);

describe("API independence from the Worker process", () => {
    it("keeps the API ready across a Worker drain and serves saved content after the Worker stops", async () => {
        // ---- 阶段 A：跑完一次完整录入，产出「已保存内容」。 ----
        const completedSource = await createRssSource({
            apiBaseUrl,
            feedUrl: rssCompleted.url,
            name: "Independence Completed Source",
        });
        const completedSourceId = readString(completedSource, "id");
        const queued = await requestJson(`${apiBaseUrl}/api/v1/sources/${completedSourceId}/runs`, {
            method: "POST",
            headers: { "idempotency-key": "api-worker-independence-e2e-run" },
        });
        expect(queued.status).toBe(201);
        const runId = readString(queued.body, "id");
        await waitForCondition("durable ingest Run completion", async () => {
            const result = await requestJson(`${apiBaseUrl}/api/v1/runs/${runId}`);
            return result.status === 200
                && isRecord(result.body)
                && result.body.status === "succeeded";
        }, 60_000, 250);

        const savedBefore = await readEntryTitles(completedSourceId);
        expect(savedBefore).toHaveLength(3);

        // ---- 阶段 B：制造一个卡住的 poll，让 draining 窗口可观测。 ----
        const blockingSource = await createRssSource({
            apiBaseUrl,
            feedUrl: rssBlocking.url,
            name: "Independence Blocking Source",
        });
        const blockingSourceId = readString(blockingSource, "id");
        const blockingQueued = await requestJson(`${apiBaseUrl}/api/v1/sources/${blockingSourceId}/runs`, {
            method: "POST",
            headers: { "idempotency-key": "api-worker-independence-e2e-blocking-run" },
        });
        expect(blockingQueued.status).toBe(201);
        // 受控 RSS 不释放响应，Worker 会停在这一 poll 上。
        await rssBlocking.waitForRequest(1, 30_000);

        const drain = await requestJson(`${adminBaseUrl}/admin/v1/drains`, {
            method: "POST",
            headers: {
                ...authHeaders(),
                "content-type": "application/json",
                "idempotency-key": "api-worker-independence-e2e-drain",
            },
            body: JSON.stringify({ reason: "ops-011-e2e", deadlineMs: 15_000 }),
        });
        expect(drain.status).toBe(202);
        expect(drain.body).toMatchObject({ status: "accepted", resourcesClosed: false });

        // OPS-011 ③：排空期间进程仍 alive，但不再接受工作。
        const drainingLiveness = await requestJson(`${adminBaseUrl}/healthz`, { headers: authHeaders() });
        expect(drainingLiveness.status).toBe(200);
        expect(drainingLiveness.body).toMatchObject({ status: "alive", service: "cosmos-worker", workerId });
        // 探针本身可达（进程活着），但 readiness 判定为 false，故 /readyz 按约定回 503。
        const drainingReadiness = await requestJson(`${adminBaseUrl}/readyz`, { headers: authHeaders() });
        expect(drainingReadiness.status).toBe(503);
        expect(drainingReadiness.body).toMatchObject({
            ready: false,
            draining: true,
            acceptingWork: false,
        });

        // 排空期间 API 侧的 ready 与 Worker 的 readiness 互不影响。
        const apiDuringDrain = await requestJson(`${apiBaseUrl}/readyz`);
        expect(apiDuringDrain.status).toBe(200);
        expect(apiDuringDrain.body).toMatchObject({ status: "ready", service: "cosmos-api" });

        // ---- 阶段 C：放行，排空完成，Worker 退出。 ----
        rssBlocking.release();
        const exit = await worker.waitForExit(30_000);
        expect(exit.code).toBe(0);

        // OPS-011 ①：Worker 停止后 API 仍 ready，且已保存内容仍可读。
        const readyz = await requestJson(`${apiBaseUrl}/readyz`);
        expect(readyz.status).toBe(200);
        expect(readyz.body).toMatchObject({ status: "ready", service: "cosmos-api" });

        await waitForCondition("product health reports the stopped Worker", async () => {
            const health = await requestJson(`${apiBaseUrl}/api/v1/health`);
            return health.status === 200
                && isRecord(health.body)
                && health.body.workerStatus === "stopped";
        }, 30_000, 100);
        const health = await requestJson(`${apiBaseUrl}/api/v1/health`);
        expect(health.body).toMatchObject({
            status: "ok",
            storageStatus: "ready",
            migrationStatus: "ready",
            workerStatus: "stopped",
        });

        await expect(readEntryTitles(completedSourceId)).resolves.toEqual(savedBefore);
    }, 180_000);
});

async function readEntryTitles(sourceId: string): Promise<string[]> {
    const result = await requestJson(
        `${apiBaseUrl}/api/v1/entries?sourceId=${encodeURIComponent(sourceId)}&limit=10`,
    );
    expect(result.status).toBe(200);
    const items = isRecord(result.body) && Array.isArray(result.body.items) ? result.body.items : [];
    return items.map((item) => isRecord(item) ? String(item.title) : "");
}

function authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${token}` };
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
