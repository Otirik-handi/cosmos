import { afterEach, describe, expect, it } from "vitest";

import {
    WorkerAdminService,
    createWorkerAdminServer,
} from "./index.js";
import type { WorkerAdminServer } from "./index.js";

const servers: WorkerAdminServer[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("WorkerAdminService", () => {
    it("keeps readiness separate from liveness and reports executable evidence", async () => {
        const service = new WorkerAdminService({
            workerId: "worker-1",
            instanceId: "instance-1",
            version: "test",
            lanes: [{ lane: "workflow", configuredSlots: 2 }],
            workflowEvidence: [{
                ref: "cosmos.ingest@1",
                manifestHash: { algorithm: "builtin", value: "workflow-hash" },
            }],
            actionEvidence: [{
                ref: "source.fetch@1",
                manifestHash: { algorithm: "builtin", value: "action-hash" },
                executionPlacements: ["trusted_worker"],
            }],
            connectorEvidence: [{
                ref: "source.fixture-rss@1",
                manifestHash: { algorithm: "builtin", value: "connector-hash" },
            }],
        });

        expect(service.liveness()).toMatchObject({ status: "alive", service: "cosmos-worker" });
        expect((await service.readiness()).ready).toBe(false);
        service.markReady();
        expect((await service.readiness()).ready).toBe(true);
        expect(service.capabilities()).toMatchObject({
            evidenceAuthority: "local_executable",
            workflowEvidence: [{ ref: "cosmos.ingest@1" }],
            actionEvidence: [{ ref: "source.fetch@1" }],
        });
    });

    it("marks throwing health unavailable, then recovers on a successful poll", async () => {
        let healthy = false;
        const service = new WorkerAdminService({
            workerId: "worker-health",
            instanceId: "instance-health",
            version: "test",
            health: async () => {
                if (!healthy) throw new Error("database token=secret-value");
                return {
                    migration: { status: "ready", checkedAt: new Date().toISOString() },
                    taskStore: { status: "ready", checkedAt: new Date().toISOString() },
                    definitionCatalog: { status: "ready", checkedAt: new Date().toISOString() },
                    actionRegistry: { status: "ready", checkedAt: new Date().toISOString() },
                    connectorRegistry: { status: "ready", checkedAt: new Date().toISOString() },
                    valueStore: { status: "ready", checkedAt: new Date().toISOString() },
                };
            },
        });
        service.markReady();

        const failed = await service.readiness();
        expect(failed.ready).toBe(false);
        expect(failed.components.taskStore).toMatchObject({ status: "unavailable" });
        expect(service.status()).toMatchObject({ status: "degraded" });
        expect(service.status().recentErrors[0]?.message).not.toContain("secret-value");

        healthy = true;
        expect((await service.readiness()).ready).toBe(true);
        expect(service.status()).toMatchObject({ status: "ready" });
    });

    it("reports active polls separately and drains only after the poll ends", async () => {
        const service = new WorkerAdminService({
            workerId: "worker-poll",
            instanceId: "instance-poll",
            version: "test",
            lanes: [{ lane: "workflow", configuredSlots: 1 }],
        });
        service.markReady();
        expect(service.beginPoll("workflow")).toBe(true);
        expect(service.status()).toMatchObject({ activeAttemptCount: 0, activePollCount: 1 });

        const accepted = service.requestDrain("poll-drain", { reason: "stop", deadlineMs: 1_000 });
        expect(accepted.snapshot).toMatchObject({ activeAttemptIds: [], activePollCount: 1 });
        let settled = false;
        const waiting = service.waitForDrain(accepted.snapshot.id).then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        service.endPoll("workflow");
        await waiting;
        expect(service.getDrain(accepted.snapshot.id)).toMatchObject({
            status: "succeeded",
            activePollCount: 0,
            resourcesClosed: true,
        });
    });

    it("does not accept polls when every configured lane is disabled", async () => {
        const service = new WorkerAdminService({
            workerId: "worker-disabled",
            instanceId: "instance-disabled",
            version: "test",
            lanes: [{ lane: "workflow", enabled: false }],
        });
        service.markReady();
        expect((await service.readiness()).ready).toBe(false);
        expect(service.status()).toMatchObject({ status: "degraded", activePollCount: 0 });
        expect(service.status().recentErrors).toEqual([]);
    });

    it("clears degraded status after a failed poll is followed by a successful poll", () => {
        const service = new WorkerAdminService({
            workerId: "worker-recovery",
            instanceId: "instance-recovery",
            version: "test",
            lanes: [{ lane: "workflow" }],
        });
        service.markReady();
        expect(service.beginPoll("workflow")).toBe(true);
        service.endPoll("workflow", new Error("transient poll failure"));
        expect(service.status()).toMatchObject({ status: "degraded" });
        expect(service.beginPoll("workflow")).toBe(true);
        service.endPoll("workflow");
        expect(service.status()).toMatchObject({ status: "ready" });
        expect(service.status().lanes[0]).toMatchObject({ lastError: null });
    });

    it("enforces drain idempotency and rejects a conflicting command", async () => {
        let closeCalls = 0;
        const service = new WorkerAdminService({
            workerId: "worker-1",
            instanceId: "instance-1",
            version: "test",
            onDrain: async () => {
                closeCalls += 1;
            },
        });
        service.markReady();

        const accepted = service.requestDrain("drain-1", {
            reason: "deploy",
            deadlineMs: 1_000,
            exitAfterDrain: true,
        });
        expect(accepted.statusCode).toBe(202);
        expect(accepted.snapshot.status).toBe("accepted");
        expect(service.requestDrain("drain-1", {
            reason: "deploy",
            deadlineMs: 1_000,
            exitAfterDrain: true,
        })).toMatchObject({ statusCode: 202, snapshot: { id: accepted.snapshot.id } });
        expect(() => service.requestDrain("drain-1", {
            reason: "different",
            deadlineMs: 1_000,
        })).toThrowError(/different drain command/);
        await service.waitForDrain(accepted.snapshot.id);
        expect(service.getDrain(accepted.snapshot.id)).toMatchObject({
            status: "succeeded",
            resourcesClosed: true,
        });
        expect(closeCalls).toBe(1);
    });

    it("rejects drain conflicts, malformed commands, and oversized bodies", async () => {
        const service = new WorkerAdminService({
            workerId: "worker-boundary",
            instanceId: "instance-boundary",
            version: "test",
            lanes: [{ lane: "workflow" }],
        });
        service.markReady();
        expect(service.beginPoll("workflow")).toBe(true);
        const first = service.requestDrain("boundary-1", { reason: "stop", deadlineMs: 1_000 });
        expect(() => service.requestDrain("boundary-2", { reason: "stop", deadlineMs: 1_000 }))
            .toThrowError(/already in progress/);
        service.endPoll("workflow");
        await service.waitForDrain(first.snapshot.id);
        service.markStopped();
        expect(() => service.requestDrain("boundary-3", { reason: "stop" }))
            .toThrowError(/already stopped/);
    });

    it("times out without claiming that active attempts were closed", async () => {
        const service = new WorkerAdminService({
            workerId: "worker-1",
            instanceId: "instance-1",
            version: "test",
        });
        service.markReady();
        service.registerAttempt({
            attemptId: "attempt-1",
            jobId: "job-1",
            runId: "run-1",
            actionRef: "source.fetch@1",
            lane: "workflow",
            slot: 0,
            startedAt: new Date().toISOString(),
            leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            cancellationRequested: false,
        });

        const accepted = service.requestDrain("drain-timeout", { reason: "stop", deadlineMs: 0 });
        await service.waitForDrain(accepted.snapshot.id);
        expect(service.getDrain(accepted.snapshot.id)).toMatchObject({
            status: "timed_out",
            resourcesClosed: false,
            activeAttemptIds: ["attempt-1"],
            activePollCount: 0,
        });
    });
});

describe("Worker Admin HTTP host", () => {
    it("serves probes, status, drain list/get and protected commands on its own port", async () => {
        const server = createWorkerAdminServer({
            workerId: "worker-http",
            instanceId: "instance-http",
            version: "test",
            port: 0,
            authorize: (request) => request.headers.authorization === "Bearer admin",
        });
        servers.push(server);
        await server.start();
        const address = server.server.address();
        if (!address || typeof address === "string") throw new Error("admin server did not bind");
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const unauthorized = await fetch(`${baseUrl}/healthz`);
        expect(unauthorized.status).toBe(401);
        const notReady = await fetch(`${baseUrl}/readyz`, {
            headers: { authorization: "Bearer admin" },
        });
        expect(notReady.status).toBe(503);
        expect(await notReady.json()).toMatchObject({ ready: false, workerId: "worker-http" });

        server.service.markReady();
        const ready = await fetch(`${baseUrl}/readyz`, {
            headers: { authorization: "Bearer admin" },
        });
        expect(ready.status).toBe(200);
        const status = await fetch(`${baseUrl}/admin/v1/status`, {
            headers: { authorization: "Bearer admin" },
        });
        expect(status.status).toBe(200);
        expect(await status.json()).toMatchObject({ workerId: "worker-http", activeAttemptCount: 0 });
        const metrics = await fetch(`${baseUrl}/metrics`);
        expect(metrics.status).toBe(401);

        const drain = await fetch(`${baseUrl}/admin/v1/drains`, {
            method: "POST",
            headers: {
                authorization: "Bearer admin",
                "content-type": "application/json",
                "idempotency-key": "http-drain-1",
            },
            body: JSON.stringify({ reason: "test" }),
        });
        expect(drain.status).toBe(202);
        const drainBody = await drain.json() as {
            id: string;
            status: string;
            activeAttemptIds: string[];
            activePollCount: number;
        };
        expect(drainBody).toMatchObject({
            status: "accepted",
            activeAttemptIds: [],
            activePollCount: 0,
        });
        const list = await fetch(`${baseUrl}/admin/v1/drains`, {
            headers: { authorization: "Bearer admin" },
        });
        expect(list.status).toBe(200);
        const listBody = await list.json() as {
            items: Array<{ id: string; activePollCount: number }>;
            nextCursor: string | null;
            snapshotAt?: string;
        };
        expect(listBody.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: drainBody.id, activePollCount: 0 }),
        ]));
        expect(listBody.nextCursor).toBeNull();
        expect(listBody.snapshotAt).toEqual(expect.any(String));
        const byId = await fetch(`${baseUrl}/admin/v1/drains/${encodeURIComponent(drainBody.id)}`, {
            headers: { authorization: "Bearer admin" },
        });
        expect(byId.status).toBe(200);
        expect(await byId.json()).toMatchObject({ id: drainBody.id, activePollCount: 0 });
    });

    it("rejects missing auth, malformed JSON, missing idempotency and oversized bodies", async () => {
        const server = createWorkerAdminServer({
            workerId: "worker-errors",
            instanceId: "instance-errors",
            version: "test",
            port: 0,
            maxBodyBytes: 32,
            authorize: (request) => request.headers.authorization === "Bearer admin",
        });
        servers.push(server);
        server.service.markReady();
        await server.start();
        const address = server.server.address();
        if (!address || typeof address === "string") throw new Error("admin server did not bind");
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const headers = { authorization: "Bearer admin", "content-type": "application/json" };

        expect((await fetch(`${baseUrl}/admin/v1/drains`, { method: "POST", headers })).status).toBe(400);
        expect((await fetch(`${baseUrl}/admin/v1/drains`, {
            method: "POST",
            headers: { ...headers, "idempotency-key": "invalid-json" },
            body: "not-json",
        })).status).toBe(400);
        expect((await fetch(`${baseUrl}/admin/v1/drains`, {
            method: "POST",
            headers: { ...headers, "idempotency-key": "too-large" },
            body: JSON.stringify({ reason: "this body is deliberately larger than thirty-two bytes" }),
        })).status).toBe(413);
    });

    it("keeps loopback probes open by default and isolates throwing health from liveness", async () => {
        const server = createWorkerAdminServer({
            workerId: "worker-loopback",
            instanceId: "instance-loopback",
            version: "test",
            port: 0,
            health: async () => {
                throw new Error("backend unavailable at /srv/private/token=secret");
            },
        });
        servers.push(server);
        await server.start();
        const address = server.server.address();
        if (!address || typeof address === "string") throw new Error("admin server did not bind");
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const health = await fetch(`${baseUrl}/healthz`);
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({ status: "alive", workerId: "worker-loopback" });
        const ready = await fetch(`${baseUrl}/readyz`);
        expect(ready.status).toBe(503);
        const body = await ready.json() as { components: { taskStore?: { status: string; message?: string | null } } };
        expect(body.components.taskStore?.status).toBe("unavailable");
        expect(body.components.taskStore?.message).not.toContain("/srv/private");
    });

    it("requires an authorization boundary beyond loopback", () => {
        expect(() => createWorkerAdminServer({
            workerId: "worker-http",
            instanceId: "instance-http",
            version: "test",
            host: "0.0.0.0",
        })).toThrowError(/authorize middleware/);
    });
});
