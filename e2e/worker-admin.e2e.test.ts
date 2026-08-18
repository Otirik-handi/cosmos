import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

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

type JsonResponse = {
    status: number;
    body: unknown;
};

let stack: IsolatedStackRoot;
let worker: ManagedProcess;
let prisma: PrismaClient;
let adminProbe = "not-started";
let adminBaseUrl = "";
const token = "worker-admin-e2e-token";

beforeAll(async () => {
    stack = await createIsolatedStackRoot("worker-admin-e2e");
    applyMigrations(stack.dataRoot);
    prisma = new PrismaClient({
        datasources: { db: { url: `file:${stack.dataRoot.replaceAll("\\", "/")}/cosmos.sqlite` } },
    });
    const adminPort = 0;
    const environment = environmentForStack(process.env, stack, {
        NODE_ENV: "test",
        COSMOS_WORKSPACE_ROOT: repositoryRoot,
        COSMOS_WORKFLOW_HOST_ENABLED: "true",
        COSMOS_WORKER_ADMIN_ENABLED: "true",
        COSMOS_WORKER_ADMIN_HOST: "127.0.0.1",
        COSMOS_WORKER_ADMIN_PORT: String(adminPort),
        COSMOS_WORKER_ADMIN_TOKEN: token,
        COSMOS_WORKER_POLL_MS: "50",
        COSMOS_WORKER_LEASE_MS: "30000",
        COSMOS_WORKER_SHUTDOWN_DEADLINE_MS: "5000",
        COSMOS_WORKER_ID: "worker-admin-e2e",
    });
    worker = spawnService({
        name: "worker-admin-e2e",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/worker/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    try {
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
            try {
                const liveness = await requestJson(`${adminBaseUrl}/healthz`);
                adminProbe = `healthz=${liveness.status}`;
                if (liveness.status !== 401) return false;
                const response = await requestJson(`${adminBaseUrl}/readyz`, { headers: authHeaders() });
                adminProbe = `${adminProbe}, readyz=${response.status}, body=${JSON.stringify(response.body)}`;
                return response.status === 200
                    && isRecord(response.body)
                    && response.body.ready === true;
            } catch (error) {
                adminProbe = error instanceof Error ? error.message : String(error);
                return false;
            }
        }, 30_000, 100);
    } catch (error) {
        await stopManagedProcess(worker, "force").catch(() => undefined);
        throw new Error([
            `Admin probe: ${adminProbe}`,
            error instanceof Error ? error.message : String(error),
            formatProcessFailure(worker),
        ].join("\n"));
    }
}, 120_000);

afterAll(async () => {
    if (worker) await stopManagedProcess(worker, "force").catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    if (stack) {
        const records = await readStructuredLogs(stack.logRoot).catch(() => []);
        assertLogsRedacted(records);
        await disposeIsolatedStack(stack.root);
    }
}, 120_000);

describe("Worker Admin Node process E2E", () => {
    it("exposes authenticated worker evidence and drains the real process", async () => {
        await expect(requestJson(`${adminBaseUrl}/healthz`)).resolves.toMatchObject({ status: 401 });
        const liveness = await requestJson(`${adminBaseUrl}/healthz`, { headers: authHeaders() });
        expect(liveness.status).toBe(200);
        expect(liveness.body).toMatchObject({
            status: "alive",
            service: "cosmos-worker",
            workerId: "worker-admin-e2e",
        });

        const readiness = await requestJson(`${adminBaseUrl}/readyz`, { headers: authHeaders() });
        expect(readiness.status).toBe(200);
        expect(readiness.body).toMatchObject({
            ready: true,
            acceptingWork: true,
            draining: false,
        });

        const status = await requestJson(`${adminBaseUrl}/admin/v1/status`, { headers: authHeaders() });
        expect(status.status).toBe(200);
        expect(status.body).toMatchObject({
            workerId: "worker-admin-e2e",
            status: "ready",
            activeAttemptCount: 0,
        });
        const instanceId = readString(status.body, "instanceId");

        const capabilities = await requestJson(`${adminBaseUrl}/admin/v1/capabilities`, { headers: authHeaders() });
        expect(capabilities.status).toBe(200);
        expect(capabilities.body).toMatchObject({
            evidenceAuthority: "local_executable",
            lanes: expect.arrayContaining(["workflow-run", "workflow-activity", "workflow-completion"]),
        });

        const metrics = await requestText(`${adminBaseUrl}/metrics`, { headers: authHeaders() });
        expect(metrics.status).toBe(200);
        expect(metrics.body).toContain("cosmos_worker_ready 1");

        const missingKey = await requestJson(`${adminBaseUrl}/admin/v1/drains`, {
            method: "POST",
            headers: { ...authHeaders(), "content-type": "application/json" },
            body: JSON.stringify({ reason: "missing-key" }),
        });
        expect(missingKey.status).toBe(400);
        expect(missingKey.body).toMatchObject({ code: "invalid_request" });

        const drain = await requestJson(`${adminBaseUrl}/admin/v1/drains`, {
            method: "POST",
            headers: {
                ...authHeaders(),
                "content-type": "application/json",
                "idempotency-key": "worker-admin-e2e-drain",
            },
            body: JSON.stringify({ reason: "e2e-stop", deadlineMs: 5_000 }),
        });
        expect(drain.status).toBe(202);
        expect(drain.body).toMatchObject({
            status: "accepted",
            reason: "e2e-stop",
            resourcesClosed: false,
        });

        const exit = await worker.waitForExit(30_000);
        expect(exit.code).toBe(0);
        await waitForCondition("stopped Worker heartbeat", async () => {
            const heartbeat = await prisma.workerHeartbeat.findUnique({ where: { instanceId } });
            return heartbeat?.status === "stopped";
        }, 10_000, 100);
        await expect(prisma.workerHeartbeat.findUnique({ where: { instanceId } }))
            .resolves.toMatchObject({ status: "stopped" });
    }, 120_000);
});

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

async function requestText(url: string, init?: RequestInit): Promise<{ status: number; body: string }> {
    const response = await fetch(url, init);
    return { status: response.status, body: await response.text() };
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
