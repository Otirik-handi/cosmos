import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
let apiBaseUrl: string;
let planId: string;
let sourceId: string;
let entryPath: string;
let credential: string;

beforeAll(async () => {
    stack = await createIsolatedStackRoot("webhook-entry-e2e");
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
    });
    api = spawnService({
        name: "webhook-entry-e2e-api",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/api/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    try {
        await waitForHttp(`${apiBaseUrl}/readyz`, 200, 30_000);
        const source = await createRssSource({
            apiBaseUrl,
            feedUrl: "http://127.0.0.1:9/fixture.xml",
            name: "Webhook 入口验收来源",
            enabled: true,
            scheduleIntervalMs: 1_800_000,
        });
        sourceId = readString(source, "id");
        planId = readString(source, "planId");
    } catch (error) {
        await stopManagedProcess(api, "force").catch(() => undefined);
        throw new Error([
            error instanceof Error ? error.message : String(error),
            api ? formatProcessFailure(api) : "",
        ].filter(Boolean).join("\n"));
    }
}, 120_000);

afterAll(async () => {
    await stopManagedProcess(api, "graceful").catch(() => undefined);
    if (stack) {
        const records = await readStructuredLogs(stack.logRoot).catch(() => []);
        assertLogsRedacted(records);
        await disposeIsolatedStack(stack.root);
    }
}, 120_000);

describe("Webhook 入口 E2E (ADR-0024)", () => {
    it("入口地址不在 /api/v1 下，读投影只回答「已配置」", async () => {
        const created = await requestJson(`${apiBaseUrl}/api/v1/collection-plans/${encodeURIComponent(planId)}/webhook-entry`, {
            method: "POST",
        });
        expect(created.status).toBe(201);
        entryPath = readString(created.body, "entryPath");
        credential = readString(created.body, "credential");
        // 入口独立于产品 API 的版本前缀（ADR-0024 决定 2）。
        expect(entryPath.startsWith("/hooks/collection-plans/")).toBe(true);

        const plan = await requestJson(`${apiBaseUrl}/api/v1/collection-plans/${encodeURIComponent(planId)}`);
        expect(plan.status).toBe(200);
        expect(plan.body).toMatchObject({
            webhook: { entryPath, credentialConfigured: true },
            // 生成入口不影响定时触发（ADR-0025）：一个计划可以两种触发方式并存。
            scheduleIntervalMs: 1_800_000,
        });
        // 明文凭证不在这条读路径上。
        expect(JSON.stringify(plan.body)).not.toContain(credential);

        // 挂在产品 API 版本前缀下的同一条路径不存在：路由确实被排除在全局前缀外。
        const underPrefix = await requestJson(`${apiBaseUrl}/api/v1${entryPath}`, {
            method: "POST",
            headers: { "x-cosmos-credential": credential, "x-cosmos-event-id": "evt-prefix" },
        });
        expect(underPrefix.status).toBe(404);
    });

    it("正确凭证入队一次，重复事件不产生第二个 Run，触发证据可查", async () => {
        const first = await callEntry({ eventId: "evt-1" });
        expect(first.status).toBe(202);
        const runId = readString(first.body, "id");
        expect(first.body).toMatchObject({ triggerKind: "webhook", status: "queued" });

        const detail = await requestJson(`${apiBaseUrl}/api/v1/runs/${encodeURIComponent(runId)}`);
        expect(detail.status).toBe(200);
        expect(detail.body).toMatchObject({
            triggerKind: "webhook",
            triggerEvidence: { externalEventId: "evt-1" },
        });

        // 同一次外部事件重复投递：返回同一个 Run，不产生第二个。
        const duplicate = await callEntry({ eventId: "evt-1" });
        expect(duplicate.status).toBe(202);
        expect(readString(duplicate.body, "id")).toBe(runId);

        const runs = await requestJson(`${apiBaseUrl}/api/v1/runs?sourceId=${encodeURIComponent(sourceId)}&limit=50`);
        expect(runs.status).toBe(200);
        const items = readItems(runs.body);
        expect(items.filter((item) => item.triggerKind === "webhook")).toHaveLength(1);
    });

    it("错误凭证与不存在的入口返回同一个结果", async () => {
        const wrongCredential = await callEntry({ credential: "not-the-credential", eventId: "evt-2" });
        const unknownEntry = await requestJson(`${apiBaseUrl}/hooks/collection-plans/no-such-entry`, {
            method: "POST",
            headers: { "x-cosmos-credential": credential, "x-cosmos-event-id": "evt-3" },
        });

        expect(wrongCredential.status).toBe(404);
        expect(unknownEntry.status).toBe(404);
        // 两者除了 requestId 之外完全一样：入口不存在与凭证不对不能被区分出来。
        expect(withoutRequestId(wrongCredential.body)).toEqual(withoutRequestId(unknownEntry.body));
    });

    it("缺事件标识 400，请求体超过上限 413，且都不入队", async () => {
        const missingEvent = await requestJson(`${apiBaseUrl}${entryPath}`, {
            method: "POST",
            headers: { "x-cosmos-credential": credential },
        });
        expect(missingEvent.status).toBe(400);

        const oversized = await requestJson(`${apiBaseUrl}${entryPath}`, {
            method: "POST",
            headers: {
                "x-cosmos-credential": credential,
                "x-cosmos-event-id": "evt-too-big",
                "content-type": "application/json",
            },
            body: JSON.stringify({ padding: "x".repeat(20_000) }),
        });
        expect(oversized.status).toBe(413);

        const runs = await requestJson(`${apiBaseUrl}/api/v1/runs?sourceId=${encodeURIComponent(sourceId)}&limit=50`);
        const items = readItems(runs.body);
        expect(items.filter((item) => item.triggerKind === "webhook")).toHaveLength(1);
    });

    it("撤销后入口立刻失效，凭证不出现在日志里", async () => {
        const revoked = await requestJson(`${apiBaseUrl}/api/v1/collection-plans/${encodeURIComponent(planId)}/webhook-entry`, {
            method: "DELETE",
        });
        expect(revoked.status).toBe(200);
        expect(revoked.body).toMatchObject({ webhook: null });

        const afterRevoke = await callEntry({ eventId: "evt-4" });
        expect(afterRevoke.status).toBe(404);

        const records = await readStructuredLogs(stack.logRoot);
        const serialized = JSON.stringify(records);
        expect(serialized).not.toContain(credential);
        expect(records.some((record) => record.event === "collection_plan.webhook.accepted")).toBe(true);
    });
});

async function callEntry(overrides: { credential?: string; eventId?: string } = {}): Promise<JsonResponse> {
    return await requestJson(`${apiBaseUrl}${entryPath}`, {
        method: "POST",
        headers: {
            "x-cosmos-credential": overrides.credential ?? credential,
            "x-cosmos-event-id": overrides.eventId ?? "evt-default",
            "content-type": "application/json",
        },
        body: JSON.stringify({}),
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

function readItems(value: unknown): readonly Record<string, unknown>[] {
    // `GET /runs` 返回裸数组（transport 客户端按 `runSnapshotSchema.array()` 解析）。
    if (!Array.isArray(value)) {
        throw new Error("Expected a run array in the response.");
    }
    return value.filter(isRecord);
}

/** 错误响应里的 requestId 每次请求都不同，比较语义时要先摘掉它。 */
function withoutRequestId(value: unknown): unknown {
    if (!isRecord(value)) return value;
    const { requestId: _requestId, ...rest } = value;
    return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
