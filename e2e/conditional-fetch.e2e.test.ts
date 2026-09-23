import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createControlledRssServer, type ControlledRssServer } from "../scripts/e2e/controlled-rss.js";
import {
    applyMigrations,
    assertLogsRedacted,
    createIsolatedStackRoot,
    createRssSource,
    databaseUrl,
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

type HttpResult = { status: number; body: unknown };

const etag = '"conditional-fetch-v1"';
const lastModified = "Fri, 07 Aug 2026 12:00:00 GMT";

let stack: IsolatedStackRoot;
let api: ManagedProcess;
let worker: ManagedProcess;
let apiBaseUrl: string;
let rss: ControlledRssServer;
let sourceId: string;

/**
 * AUT-003 的条件请求在真实 Worker 进程里的验收。
 *
 * 补的缺口：Task 32 切片 3 的 304 短路此前只有 `plugins/rss` 的 fixture 证据，
 * 真实公网验收只跑一次抓取、观察不到第二次的 304。这里用受控 RSS 服务把服务端行为
 * 钉死（第一次 200 + 验证器、第二次 304），断言三件事：
 *   1. 第一次抓取把 ETag / Last-Modified 存进所属计划命名空间的 ConnectorState；
 *   2. 第二次抓取真的带上 `If-None-Match` / `If-Modified-Since`；
 *   3. 304 时短路——Worker 记录 `connector.transport.not_modified`，且不产生新条目。
 */
beforeAll(async () => {
    stack = await createIsolatedStackRoot("conditional-fetch-e2e");
    const fixtureXml = await readFile(new URL("../fixtures/rss/basic.xml", import.meta.url), "utf8");
    rss = await createControlledRssServer(fixtureXml);
    // 服务端在 200 上声明验证器；连接器应把它们存下来供下一次条件请求使用。
    rss.respond(200, fixtureXml, {
        "content-type": "application/rss+xml; charset=utf-8",
        etag,
        "last-modified": lastModified,
    });
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
        COSMOS_WORKER_ID: "conditional-fetch-e2e-worker",
    });
    api = spawnService({
        name: "conditional-fetch-e2e-api",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/api/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    try {
        await waitForHttp(`${apiBaseUrl}/readyz`, 200, 30_000);
        worker = spawnService({
            name: "conditional-fetch-e2e-worker",
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

describe("conditional fetch Node process E2E (AUT-003)", () => {
    it("stores the response validators on the first fetch", async () => {
        const created = await createRssSource({
            apiBaseUrl,
            feedUrl: rss.url,
            name: "Conditional RSS E2E",
        });
        sourceId = readString(created, "id");

        // 抓取由 Run 触发；先排队再等请求，否则 waitForRequest 会等在一个还没发生的抓取上。
        const runId = await queueRun("conditional-fetch-run-1");
        const firstRequest = await rss.waitForRequest(1, 30_000);
        // 第一次抓取没有可用的验证器，不能带条件头。
        expect(firstRequest.headers["if-none-match"]).toBeUndefined();
        expect(firstRequest.headers["if-modified-since"]).toBeUndefined();

        await waitForRunStatus(runId, "succeeded", 60_000);

        await waitForCondition("connector state stores the validators", async () => {
            const state = await readConnectorState();
            return state?.etag === etag && state.lastModified === lastModified;
        }, 30_000, 200);

        // 归属登记由宿主在解析状态句柄时写入（ADR-0026）：没有它，「按连接导出」就只能
        // 每次反查计划表 + 解析 manifest 模板。
        await waitForCondition("connector state namespace is registered to the plan", async () => {
            const owner = await readConnectorStateOwner();
            return owner?.planId === `plan:${sourceId}`;
        }, 30_000, 200);

        const feed = await requestJson(`${apiBaseUrl}/api/v1/feed?limit=10`);
        expect(isRecord(feed.body) ? (feed.body.items as unknown[]) : []).toHaveLength(3);
    }, 120_000);

    it("sends the conditional headers and short-circuits on 304", async () => {
        // 服务端改为「没有变化」：只有条件请求才会拿到 304。
        rss.respond(304, "", {});

        const runId = await queueRun("conditional-fetch-run-2");
        const secondRequest = await rss.waitForRequest(2, 30_000);
        expect(secondRequest.headers["if-none-match"]).toBe(etag);
        expect(secondRequest.headers["if-modified-since"]).toBe(lastModified);

        await waitForRunStatus(runId, "succeeded", 60_000);

        // 短路证据：连接器记录 not_modified，而不是重新解析正文。
        const records = await readStructuredLogs(stack.logRoot);
        const notModified = records.filter(
            (record) => record.event === "connector.transport.not_modified",
        );
        expect(notModified.length).toBeGreaterThanOrEqual(1);
        expect(notModified[0]).toMatchObject({ connectorId: "rss", sourceKind: "rss" });

        // 没有新内容：条目数不变，且不产生修订。
        const feed = await requestJson(`${apiBaseUrl}/api/v1/feed?limit=10`);
        expect(isRecord(feed.body) ? (feed.body.items as unknown[]) : []).toHaveLength(3);
    }, 120_000);
});

async function queueRun(idempotencyKey: string): Promise<string> {
    const queued = await requestJson(`${apiBaseUrl}/api/v1/sources/${sourceId}/runs`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
    });
    expect(queued.status).toBe(201);
    return readString(queued.body, "id");
}

async function waitForRunStatus(
    runId: string,
    status: string,
    timeoutMs: number,
): Promise<void> {
    await waitForCondition(`run ${runId} to reach ${status}`, async () => {
        const result = await requestJson(`${apiBaseUrl}/api/v1/runs/${runId}`);
        if (result.status !== 200 || !isRecord(result.body)) return false;
        if (result.body.status === "failed") {
            throw new Error(`Run failed: ${JSON.stringify(result.body)}`);
        }
        return result.body.status === status;
    }, timeoutMs, 250);
}

/** 直接读 ConnectorState 表：这是「验证器确实落盘」的唯一持久证据。 */
async function readConnectorState(): Promise<{ etag?: string; lastModified?: string } | null> {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl(stack.dataRoot) } },
    });
    try {
        // 命名空间按计划解析（ADR-0023 决策 2）：v1 计划 id 形如 `plan:<sourceId>`。
        const row = await prisma.connectorState.findFirst({
            where: { namespace: `plan:${sourceId}`, key: "http-cache" },
        });
        if (!row) return null;
        return JSON.parse(row.valueJson) as { etag?: string; lastModified?: string };
    } finally {
        await prisma.$disconnect();
    }
}

/** 直接读归属登记表：证明宿主在解析状态句柄时登记了抽屉（ADR-0026）。 */
async function readConnectorStateOwner(): Promise<{ namespace: string; planId: string } | null> {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl(stack.dataRoot) } },
    });
    try {
        return await prisma.connectorStateNamespace.findUnique({
            where: { namespace: `plan:${sourceId}` },
            select: { namespace: true, planId: true },
        });
    } finally {
        await prisma.$disconnect();
    }
}

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
    return { status: response.status, body };
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
