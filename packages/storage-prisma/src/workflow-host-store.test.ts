import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
    canonicalJson,
    fingerprint,
    type ActivityExecutionRequest,
    type DeferredActivityCompletionInput,
} from "@notnotype/nb-workflow";
import { PrismaClient } from "@prisma/client";
import type { RetryPolicy } from "@cosmos/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaWorkflowHostStore } from "./workflow-host-store.js";
import { PrismaWorkflowEventSink } from "./workflow-event-sink.js";

const roots: string[] = [];
const clients = new Set<PrismaClient>();
const databasePaths = new WeakMap<PrismaWorkflowHostStore, string>();

const definition = {
    key: "cosmos.ingest",
    version: "1",
    manifestHash: "sha256:cosmos-ingest",
} as const;

const inputSnapshot = {
    sourceId: "source-1",
    cursor: null,
};

const productRun = {
    status: "queued",
    sourceId: "source-1",
    triggerKind: "manual",
};
afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PrismaWorkflowHostStore", () => {
    it("applies the complete migration set to a fresh isolated SQLite root", async () => {
        const store = await createStore();
        const tables = await store.prisma.$queryRawUnsafe<readonly { name: string }[]>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('WorkflowRun', 'WorkflowCompletion', 'Job') ORDER BY name",
        );
        expect(tables.map((table) => table.name)).toEqual(["Job", "WorkflowCompletion", "WorkflowRun"]);
        await expect(store.prisma.workflowRun.count()).resolves.toBe(0);
        await expect(store.prisma.workflowCompletion.count()).resolves.toBe(0);
    });

    it("rejects EventSink writes after the Run lease expires", async () => {
        const store = await createStore();
        const lease = await createRunningRun(store, "workflow-event-fence");
        const sink = new PrismaWorkflowEventSink(store.prisma);
        const request = {
            event: {
                type: "workflow.test.v1",
                version: "v1",
                payload: { ok: true },
            },
            context: {
                runId: lease.runId,
                activity: {
                    key: "event#0",
                    path: "root",
                    seq: 0,
                    kind: "event",
                    fingerprint: "sha256:event",
                },
                idempotencyKey: "workflow-event-fence",
                signal: new AbortController().signal,
            },
        };
        await expect(sink.emit(request)).rejects.toMatchObject({ code: "lease_lost" });
        await sink.emitWithLease(request, lease);
        await expect(store.prisma.domainEvent.count({
            where: { workflowRunId: lease.runId, idempotencyKey: request.context.idempotencyKey },
        })).resolves.toBe(1);
        await store.prisma.workflowRun.update({
            where: { id: lease.runId },
            data: { runLeaseExpiresAt: new Date("2026-08-13T00:00:00.000Z") },
        });
        await expect(sink.emitWithLease({
            ...request,
            context: { ...request.context, idempotencyKey: "workflow-event-fence-2" },
        }, lease)).rejects.toMatchObject({ code: "lease_lost" });
        await expect(store.prisma.domainEvent.count({ where: { workflowRunId: lease.runId } })).resolves.toBe(2);
    });
    it("upgrades an isolated pre-host database while preserving old WorkflowRun data", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-workflow-host-upgrade-"));
        roots.push(root);
        const databasePath = join(root, "upgrade.sqlite");
        const oldPrismaRoot = join(root, "old-prisma");
        const oldMigrationsRoot = join(oldPrismaRoot, "migrations");
        await mkdir(oldMigrationsRoot, { recursive: true });
        const sourcePrismaRoot = resolve(process.cwd(), "packages/storage-prisma/prisma");
        await cp(join(sourcePrismaRoot, "schema.prisma"), join(oldPrismaRoot, "schema.prisma"));
        await cp(join(sourcePrismaRoot, "migrations", "migration_lock.toml"), join(oldMigrationsRoot, "migration_lock.toml"));
        for (const migration of [
            "20260808003247_phase1_foundation",
            "20260808150000_collector_jobs",
            "20260810020829_normalized_content_model",
            "20260813160000_workflow_run_backend",
        ]) {
            await cp(join(sourcePrismaRoot, "migrations", migration), join(oldMigrationsRoot, migration), { recursive: true });
        }
        await deployMigrations(databasePath, join(oldPrismaRoot, "schema.prisma"));
        const oldClient = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
        clients.add(oldClient);
        await oldClient.$executeRawUnsafe(
            `INSERT INTO "WorkflowRun" ("id", "stateJson", "kernelRevision", "status", "resumeRequired", "definitionKey", "definitionVersion", "manifestHash", "createdAt", "updatedAt") VALUES ('old-run', '{"runId":"old-run","definition":{"key":"cosmos.ingest","version":"1","manifestHash":"sha256:old"},"input":{"kind":"inline","value":{}},"extensionContext":{},"status":"running","resumeRequired":true,"cancelRequestedAt":null,"budget":null,"checkpoint":null,"pendingAsks":[],"pendingWaits":[],"pendingActivities":[],"activityCompletions":[],"logs":[],"progress":null,"journal":[],"revision":0,"createdAt":"2026-08-14T00:00:00.000Z","updatedAt":"2026-08-14T00:00:00.000Z"}', 0, 'running', 1, 'cosmos.ingest', '1', 'sha256:old', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')`,
        );
        await oldClient.$disconnect();
        clients.delete(oldClient);

        await deployMigrations(databasePath, join(sourcePrismaRoot, "schema.prisma"));
        const client = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
        clients.add(client);
        const store = new PrismaWorkflowHostStore(client);
        databasePaths.set(store, databasePath);
        await expect(client.workflowRun.findUnique({ where: { id: "old-run" } }))
            .resolves.toMatchObject({ id: "old-run", status: "running", resumeRequired: true });
        await expect(store.loadWorkflowEnvelope("old-run"))
            .resolves.toMatchObject({ runId: "old-run", status: "running" });
    });

    it("fences claims and old completion leases across two Prisma clients", async () => {
        const firstStore = await createStore();
        const databasePath = databasePaths.get(firstStore);
        if (!databasePath) throw new Error("expected isolated database path");
        const secondClient = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
        clients.add(secondClient);
        const secondStore = new PrismaWorkflowHostStore(secondClient);
        const claimNow = new Date("2026-08-14T00:01:00.000Z");
        const run = await createRunningRun(
            firstStore,
            "workflow-run-two-clients",
            "initial-worker",
            new Date("2026-08-14T00:00:00.000Z"),
        );
        const request = activityRequest(run.runId, "two-clients");
        const pending = await firstStore.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        await seedPendingActivity(firstStore, request, pending.receipt);
        const job = await firstStore.claimActivityJob({ owner: "worker-a", leaseMs: 1_000, now: claimNow });
        if (!job) throw new Error("expected Activity claim after Run lease expiry");
        const currentRunLease = await firstStore.claimRun({
            owner: "worker-a",
            leaseMs: 10_000,
            runId: run.runId,
            purpose: "activity",
            now: claimNow,
        });
        if (!currentRunLease) throw new Error("expected Run takeover");
        const completionInput = completionFor(request, job.id, { status: "completed", result: { ok: true } });
        const completed = await firstStore.completeActivity({
            jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
            runLease: currentRunLease,
            result: { status: "succeeded", result: { ok: true } },
            completion: completionInput,
            now: claimNow,
        });
        expect(completed.accepted).toBe(true);
        await acceptCompletionInKernel(firstStore, request, completionInput);
        const available = await firstStore.prisma.workflowCompletion.findUniqueOrThrow({
            where: { jobId: job.id },
            select: { availableAt: true },
        });
        const firstCompletion = await firstStore.claimWorkflowCompletion({
            owner: "dispatcher-a",
            leaseMs: 1_000,
            now: available.availableAt,
        });
        if (!firstCompletion) throw new Error("expected first completion claim");
        await firstStore.prisma.workflowRun.update({
            where: { id: run.runId },
            data: { runLeaseExpiresAt: new Date(available.availableAt.getTime() - 1) },
        });
        const takeover = await secondStore.claimRun({
            owner: "dispatcher-b",
            leaseMs: 10_000,
            runId: run.runId,
            purpose: "completion",
            now: new Date(available.availableAt.getTime() + 2_000),
        });
        if (!takeover) throw new Error("expected completion Run takeover");
        const reclaimed = await secondStore.claimWorkflowCompletion({
            owner: "dispatcher-b",
            leaseMs: 10_000,
            now: new Date(available.availableAt.getTime() + 2_000),
        });
        if (!reclaimed) throw new Error("expected reclaimed completion");
        expect(await secondStore.deliverWorkflowCompletion({
            completionId: firstCompletion.id,
            leaseToken: firstCompletion.leaseToken,
            owner: firstCompletion.leaseOwner,
            runLease: currentRunLease,
            now: new Date(available.availableAt.getTime() + 2_000),
        })).toBe(false);
        expect(await secondStore.deliverWorkflowCompletion({
            completionId: reclaimed.id,
            leaseToken: reclaimed.leaseToken,
            owner: reclaimed.leaseOwner,
            runLease: takeover,
            now: new Date(available.availableAt.getTime() + 2_000),
        })).toBe(true);
    });

    it("finds an envelope by idempotency key and rejects identity changes", async () => {
        const store = await createStore();
        const first = await store.createWorkflowEnvelope({
            runId: "workflow-run-1",
            idempotencyKey: "enqueue-1",
            definition,
            inputSnapshot,
            productRun,
            createdAt: "2026-08-14T00:00:00.000Z",
        });
        const queuedEvents = await store.prisma.domainEvent.findMany({
            where: {
                workflowRunId: first.runId,
                type: "run.queued.v1",
            },
        });
        expect(queuedEvents).toHaveLength(1);
        expect(queuedEvents[0]).toMatchObject({
            type: "run.queued.v1",
            version: "v1",
            aggregateType: "WorkflowRun",
            aggregateId: first.runId,
            runId: null,
            workflowRunId: first.runId,
            idempotencyKey: `workflow-run:${first.runId}:queued`,
        });
        expect(JSON.parse(queuedEvents[0].payloadJson)).toEqual({
            runId: first.runId,
            sourceId: "source-1",
            triggerKind: "manual",
        });

        await expect(store.createWorkflowEnvelope({
            runId: "another-run-id",
            idempotencyKey: "enqueue-1",
            definition,
            inputSnapshot,
            productRun,
        })).resolves.toEqual(first);
        const duplicateQueuedEvents = await store.prisma.domainEvent.findMany({
            where: {
                workflowRunId: first.runId,
                type: "run.queued.v1",
            },
        });
        expect(duplicateQueuedEvents).toHaveLength(1);

        await expect(store.createWorkflowEnvelope({
            runId: "another-run-id",
            idempotencyKey: "enqueue-1",
            definition,
            inputSnapshot: { ...inputSnapshot, cursor: "changed" },
            productRun,
        })).rejects.toMatchObject({ code: "conflict" });

        await expect(store.loadWorkflowEnvelope(first.runId)).resolves.toMatchObject({
            runId: first.runId,
            status: "queued",
            resumeRequired: false,
        });
    });

    it("rejects late Activity completion for terminal Runs while the old lease is still valid", async () => {
        const store = await createStore();
        for (const status of ["completed", "cancelled"] as const) {
            const run = await createRunningRun(store, `workflow-run-late-${status}`, "activity-worker");
            const request = activityRequest(run.runId, `late-completion-${status}`);
            const pending = await store.startAction(request);
            if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
            await seedPendingActivity(store, request, pending.receipt);
            const job = await store.claimActivityJob({
                owner: "activity-worker",
                leaseMs: 10_000,
            });
            if (!job) throw new Error("expected Activity claim");
            await store.prisma.workflowRun.update({
                where: { id: run.runId },
                data: { status },
            });

            await expect(store.completeActivity({
                jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
                runLease: run,
                result: { status: "succeeded", result: { late: true } },
                completion: completionFor(request, job.id, {
                    status: "completed",
                    result: { late: true },
                }),
            })).resolves.toMatchObject({ accepted: false, jobStatus: "leased", completion: null });
            await expect(store.prisma.job.findUnique({ where: { id: job.id } }))
                .resolves.toMatchObject({ status: "leased", leaseToken: job.leaseToken });
            await expect(store.prisma.workflowCompletion.findUnique({ where: { jobId: job.id } }))
                .resolves.toBeNull();
        }
    }, 30_000);

    it("rejects terminal startAction and does not create a Job", async () => {
        for (const status of ["completed", "cancelled"] as const) {
            const store = await createStore();
            const run = await createRunningRun(store, `workflow-run-start-${status}`, "activity-worker");
            await store.prisma.workflowRun.update({ where: { id: run.runId }, data: { status } });
            await expect(store.startAction(activityRequest(run.runId, `terminal-start-${status}`)))
                .rejects.toMatchObject({ code: "conflict" });
            await expect(store.prisma.job.count({ where: { workflowRunId: run.runId } }))
                .resolves.toBe(0);
        }
    }, 30_000);

    it("fences completion on Kernel revision and pending-activity identity", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-state-fence", "activity-worker");
        const request = activityRequest(run.runId, "state-fence");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        await seedPendingActivity(store, request, pending.receipt);
        const job = await store.claimActivityJob({ owner: "activity-worker", leaseMs: 10_000 });
        if (!job) throw new Error("expected Activity claim");
        await store.prisma.workflowRun.update({
            where: { id: run.runId },
            data: { kernelRevision: job.kernelRevision + 1 },
        });
        const completion = completionFor(request, job.id, { status: "completed", result: { ok: true } });
        const input = {
            jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
            runLease: run,
            result: { status: "succeeded" as const, result: { ok: true } },
            completion,
        };
        await expect(store.completeActivity(input)).resolves.toMatchObject({ accepted: false });
        await store.prisma.workflowRun.update({
            where: { id: run.runId },
            data: {
                kernelRevision: job.kernelRevision,
                stateJson: canonicalJson({
                    runId: run.runId,
                    definition,
                    input: { kind: "inline", value: inputSnapshot },
                    extensionContext: {},
                    status: "waiting",
                    resumeRequired: false,
                    cancelRequestedAt: null,
                    budget: null,
                    checkpoint: null,
                    pendingAsks: [],
                    pendingWaits: [],
                    pendingActivities: [],
                    activityCompletions: [],
                    progress: null,
                    journal: [],
                    revision: job.kernelRevision,
                    createdAt: "2026-08-14T00:00:00.000Z",
                    updatedAt: "2026-08-14T00:00:00.000Z",
                }),
            },
        });
        await expect(store.completeActivity(input)).resolves.toMatchObject({ accepted: false });
        await expect(store.prisma.job.findUnique({ where: { id: job.id } }))
            .resolves.toMatchObject({ status: "leased", workflowKernelRevision: job.kernelRevision });
        await expect(store.prisma.workflowCompletion.findUnique({ where: { jobId: job.id } }))
            .resolves.toBeNull();
    });

    it("leaves an orphan queued Activity Job unclaimed", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-orphan", "activity-worker");
        const request = activityRequest(run.runId, "orphan");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        expect(await store.claimActivityJob({ owner: "activity-worker", leaseMs: 10_000 })).toBeNull();
        await expect(store.prisma.job.findUnique({ where: { id: pending.receipt } }))
            .resolves.toMatchObject({ status: "queued", workflowRunId: run.runId });
    });

    it("takes over expired Run leases and fences heartbeat/release", async () => {
        const store = await createStore();
        await store.createWorkflowEnvelope({
            runId: "workflow-run-lease",
            idempotencyKey: "enqueue-lease",
            definition,
            inputSnapshot,
            productRun,
        });
        const now = new Date("2026-08-14T00:00:00.000Z");
        const first = await store.claimRun({
            owner: "worker-a",
            leaseMs: 1000,
            runId: "workflow-run-lease",
            now,
        });
        expect(first).not.toBeNull();
        if (!first) {
            throw new Error("expected first Run lease");
        }
        expect(await store.heartbeatRun({
            ...first,
            owner: "worker-b",
            leaseMs: 1000,
            now: new Date(now.getTime() + 100),
        })).toBe(false);

        const takeover = await store.claimRun({
            owner: "worker-b",
            leaseMs: 1000,
            runId: first.runId,
            now: new Date(now.getTime() + 1001),
        });
        expect(takeover).not.toBeNull();
        expect(await store.releaseRun(first)).toBe(false);
        expect(await store.releaseRun({ ...takeover!, now: new Date(now.getTime() + 1001) })).toBe(true);
    });
    it("preserves Kernel resumeRequired during execution lease takeover", async () => {
        const store = await createStore();
        await store.createWorkflowEnvelope({
            runId: "workflow-run-resume-required",
            idempotencyKey: "enqueue-resume-required",
            definition,
            inputSnapshot,
            productRun,
        });
        const initial = await store.claimRun({
            owner: "worker-a",
            leaseMs: 1_000,
            runId: "workflow-run-resume-required",
            now: new Date("2026-08-14T00:00:00.000Z"),
        });
        if (!initial) throw new Error("expected initial Run lease");
        await store.prisma.workflowRun.update({
            where: { id: initial.runId },
            data: {
                status: "running",
                resumeRequired: true,
                stateJson: JSON.stringify({
                    runId: initial.runId,
                    definition,
                    input: { kind: "inline", value: inputSnapshot },
                    extensionContext: {},
                    status: "running",
                    resumeRequired: true,
                    cancelRequestedAt: null,
                    budget: null,
                    checkpoint: null,
                    pendingAsks: [],
                    pendingWaits: [],
                    pendingActivities: [],
                    activityCompletions: [],
                    logs: [],
                    progress: null,
                    journal: [],
                    revision: 0,
                    createdAt: new Date("2026-08-14T00:00:00.000Z").toISOString(),
                    updatedAt: new Date("2026-08-14T00:00:00.000Z").toISOString(),
                }),
                runLeaseExpiresAt: new Date("2026-08-14T00:00:00.000Z"),
            },
        });
        const takeover = await store.claimRun({
            owner: "worker-b",
            leaseMs: 1_000,
            runId: initial.runId,
            now: new Date("2026-08-14T00:00:01.000Z"),
        });
        expect(takeover).not.toBeNull();
        expect(await store.prisma.workflowRun.findUnique({ where: { id: initial.runId } }))
            .toMatchObject({ status: "running", resumeRequired: true });
    });

    it("finds or creates Activity Jobs by exact idempotency identity", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-action", "activity-worker");
        const request = activityRequest(run.runId, "action-key-1");

        const pending = await store.startAction(request);
        expect(pending).toMatchObject({ status: "pending" });
        if (pending.status !== "pending") {
            throw new Error("expected pending Activity receipt");
        }
        expect(await store.claimActivityJob({
            owner: "activity-worker",
            leaseMs: 10_000,
        })).toBeNull();
        await seedPendingActivity(store, request, pending.receipt);
        await expect(store.startAction(request)).resolves.toEqual(pending);
        await expect(store.startAction({
            ...request,
            input: { changed: true },
        })).rejects.toMatchObject({ code: "conflict" });

        const job = await store.claimActivityJob({
            owner: "activity-worker",
            leaseMs: 10_000,
        });
        expect(job).toMatchObject({
            id: pending.receipt,
            workflowRunId: run.runId,
            kind: "workflow-activity",
            status: "leased",
        });
    });

    it("atomically completes success, does not enqueue retry_wait, and rejects old leases", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-activity", "activity-worker-a");
        const runLease = run;
        const request = activityRequest(run.runId, "action-key-2");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") {
            throw new Error("expected pending Activity receipt");
        }
        await seedPendingActivity(store, request, pending.receipt);
        const job = await store.claimActivityJob({
            owner: "activity-worker-a",
            leaseMs: 10_000,
        });
        if (!job) {
            throw new Error("expected claimed Activity Job");
        }
        const completion = completionFor(request, pending.receipt, {
            status: "completed",
            result: { ok: true },
        });
        const completed = await store.completeActivity({
            jobLease: {
                jobId: job.id,
                leaseToken: job.leaseToken,
                owner: job.leaseOwner,
            },
            runLease: run,
            result: {
                status: "succeeded",
                result: { ok: true },
            },
            completion,
        });
        expect(completed).toMatchObject({
            accepted: true,
            jobStatus: "succeeded",
            completion: { status: "queued", receipt: job.id },
        });

        const duplicate = await store.completeActivity({
            jobLease: {
                jobId: job.id,
                leaseToken: job.leaseToken,
                owner: job.leaseOwner,
            },
            runLease: run,
            result: { status: "succeeded", result: { ok: true } },
            completion,
        });
        expect(duplicate).toMatchObject({ accepted: true, jobStatus: "succeeded" });
        await expect(store.completeActivity({
            jobLease: {
                jobId: job.id,
                leaseToken: job.leaseToken,
                owner: job.leaseOwner,
            },
            runLease,
            result: { status: "succeeded", result: { changed: true } },
            completion: completionFor(request, pending.receipt, {
                status: "completed",
                result: { changed: true },
            }),
        })).rejects.toMatchObject({ code: "conflict" });

        const replay = await store.startAction(request);
        expect(replay).toEqual({ status: "completed", result: { ok: true } });

        const claimedCompletion = await store.claimWorkflowCompletion({
            owner: "dispatcher-a",
            leaseMs: 10_000,
        });
        expect(claimedCompletion).toMatchObject({ status: "leased", jobId: job.id });
        if (!claimedCompletion) {
            throw new Error("expected claimed completion");
        }
        await acceptCompletionInKernel(store, request, completion);
        expect(await store.deliverWorkflowCompletion({
            completionId: claimedCompletion.id,
            leaseToken: claimedCompletion.leaseToken,
            owner: claimedCompletion.leaseOwner,
            runLease,
        })).toBe(true);

        const retryRequest = activityRequest(run.runId, "action-key-retry");
        const retryPending = await store.startAction(retryRequest);
        if (retryPending.status !== "pending") {
            throw new Error("expected retry Activity receipt");
        }
        await seedPendingActivity(store, retryRequest, retryPending.receipt);
        const retryJob = await store.claimActivityJob({
            owner: "activity-worker-a",
            leaseMs: 10_000,
        });
        if (retryPending.status !== "pending" || !retryJob) {
            throw new Error("expected retry Activity Job");
        }
        await expect(store.completeActivity({
            jobLease: {
                jobId: retryJob.id,
                leaseToken: retryJob.leaseToken,
                owner: retryJob.leaseOwner,
            },
            runLease,
            result: { status: "retry_wait", retryDelayMs: 100 },
        })).resolves.toMatchObject({
            accepted: true,
            jobStatus: "retry_wait",
            completion: null,
        });

        const oldLease = await store.claimActivityJob({
            owner: "activity-worker-old",
            leaseMs: 1,
        });
        if (oldLease) {
            const newLease = await store.claimActivityJob({
                owner: "activity-worker-new",
                leaseMs: 10_000,
            });
            if (newLease) {
                expect(await store.completeActivity({
                    jobLease: {
                        jobId: oldLease.id,
                        leaseToken: oldLease.leaseToken,
                        owner: oldLease.leaseOwner,
                    },
                    runLease,
                    result: { status: "succeeded", result: true },
                    completion: completionFor(
                        retryRequest,
                        oldLease.id,
                        { status: "completed", result: true },
                    ),
                })).toMatchObject({ accepted: false });
            }
        }
    });

    it("reclaims and delivers a completion after Kernel acceptance but before outbox delivery", async () => {
        const store = await createStore();
        const base = new Date("2026-08-14T00:00:00.000Z");
        const run = await createRunningRun(store, "workflow-run-crash-window", "activity", base);
        const request = activityRequest(run.runId, "crash-window");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        await seedPendingActivity(store, request, pending.receipt);
        const job = await store.claimActivityJob({ owner: "activity", leaseMs: 10_000, now: base });
        if (!job) throw new Error("expected Activity claim");
        const completionInput = completionFor(request, job.id, {
            status: "completed",
            result: { accepted: true },
        });
        await store.completeActivity({
            jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
            runLease: run,
            result: { status: "succeeded", result: { accepted: true } },
            completion: completionInput,
            now: base,
        });
        const first = await store.claimWorkflowCompletion({ owner: "dispatcher-a", leaseMs: 100, now: base });
        if (!first) throw new Error("expected first completion claim");
        await acceptCompletionInKernel(store, request, completionInput);
        await store.prisma.workflowRun.update({
            where: { id: run.runId },
            data: { runLeaseExpiresAt: new Date(base.getTime() + 50) },
        });
        const reclaimed = await store.claimWorkflowCompletion({
            owner: "dispatcher-b",
            leaseMs: 10_000,
            now: new Date(base.getTime() + 1_000),
        });
        if (!reclaimed) throw new Error("expected reclaimed completion");
        const takeover = await store.claimRun({
            owner: "dispatcher-b",
            leaseMs: 10_000,
            runId: run.runId,
            purpose: "completion",
            now: new Date(base.getTime() + 1_000),
        });
        if (!takeover) throw new Error("expected completion Run takeover");
        expect(await store.deliverWorkflowCompletion({
            completionId: reclaimed.id,
            leaseToken: reclaimed.leaseToken,
            owner: reclaimed.leaseOwner,
            runLease: takeover,
            now: new Date(base.getTime() + 1_000),
        })).toBe(true);
        await expect(store.prisma.workflowCompletion.findUnique({ where: { id: reclaimed.id } }))
            .resolves.toMatchObject({ status: "delivered", attempts: 2 });
    });

    it("dead-letters a completion that reaches its maximum delivery attempts", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-completion-exhausted", "activity");
        const request = activityRequest(run.runId, "completion-exhausted");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        await seedPendingActivity(store, request, pending.receipt);
        const job = await store.claimActivityJob({ owner: "activity", leaseMs: 10_000 });
        if (!job) throw new Error("expected Activity claim");
        await store.completeActivity({
            jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
            runLease: run,
            result: { status: "succeeded", result: { ok: true } },
            completion: completionFor(request, job.id, { status: "completed", result: { ok: true } }),
        });
        await store.prisma.workflowCompletion.update({
            where: { jobId: job.id },
            data: { attempts: 5, maxAttempts: 5 },
        });
        expect(await store.claimWorkflowCompletion({ owner: "dispatcher", leaseMs: 10_000 })).toBeNull();
        await expect(store.prisma.workflowCompletion.findUnique({ where: { jobId: job.id } }))
            .resolves.toMatchObject({ status: "dead_letter", attempts: 5 });
    });

    it("rejects delivery with a stale Run lease or stale Kernel state", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-stale-delivery", "activity");
        const request = activityRequest(run.runId, "stale-delivery");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        await seedPendingActivity(store, request, pending.receipt);
        const job = await store.claimActivityJob({ owner: "activity", leaseMs: 10_000 });
        if (!job) throw new Error("expected Activity claim");
        const completionInput = completionFor(request, job.id, { status: "completed", result: { ok: true } });
        await store.completeActivity({
            jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
            runLease: run,
            result: { status: "succeeded", result: { ok: true } },
            completion: completionInput,
        });
        const completion = await store.claimWorkflowCompletion({ owner: "dispatcher", leaseMs: 10_000 });
        if (!completion) throw new Error("expected completion claim");
        expect(await store.deliverWorkflowCompletion({
            completionId: completion.id,
            leaseToken: completion.leaseToken,
            owner: completion.leaseOwner,
            runLease: { ...run, leaseToken: "stale-run-token" },
        })).toBe(false);
        await store.prisma.workflowRun.update({
            where: { id: run.runId },
            data: {
                stateJson: canonicalJson({
                    runId: run.runId,
                    revision: 999,
                    activityCompletions: [],
                }),
            },
        });
        expect(await store.deliverWorkflowCompletion({
            completionId: completion.id,
            leaseToken: completion.leaseToken,
            owner: completion.leaseOwner,
            runLease: run,
        })).toBe(false);
        await expect(store.prisma.workflowCompletion.findUnique({ where: { id: completion.id } }))
            .resolves.toMatchObject({ status: "leased", leaseToken: completion.leaseToken });
    });

    it("requeues and dead-letters completion leases without touching legacy Jobs", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-completion", "activity");
        const request = activityRequest(run.runId, "action-key-completion");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") {
            throw new Error("expected pending Activity receipt");
        }
        await seedPendingActivity(store, request, pending.receipt);
        const job = await store.claimActivityJob({ owner: "activity", leaseMs: 1000 });
        if (!job) {
            throw new Error("expected Activity claim");
        }
        const completion = completionFor(request, job.id, {
            status: "failed",
            error: "permanent",
        });
        await store.completeActivity({
            jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
            runLease: run,
            result: { status: "failed_terminal", error: "permanent" },
            completion,
        });
        const leased = await store.claimWorkflowCompletion({ owner: "dispatcher", leaseMs: 1000 });
        if (!leased) {
            throw new Error("expected completion claim");
        }
        expect(await store.requeueWorkflowCompletion({
            completionId: leased.id,
            leaseToken: leased.leaseToken,
            owner: leased.leaseOwner,
            error: "transient",
        })).toBe(true);
        const requeuedRow = await store.prisma.workflowCompletion.findUniqueOrThrow({
            where: { id: leased.id },
            select: { availableAt: true },
        });
        const leasedAgain = await store.claimWorkflowCompletion({
            owner: "dispatcher",
            leaseMs: 1000,
            now: new Date(requeuedRow.availableAt.getTime() + 1),
        });
        if (!leasedAgain) {
            throw new Error("expected requeued completion claim");
        }
        expect(await store.deadLetterWorkflowCompletion({
            completionId: leasedAgain.id,
            leaseToken: leasedAgain.leaseToken,
            owner: leasedAgain.leaseOwner,
            error: "permanent",
        })).toBe(true);

        const source = await store.prisma.sourceInstance.create({
            data: {
                name: "legacy",
                kind: "rss",
                configJson: "{}",
            },
        });
        const legacyRun = await store.prisma.run.create({
            data: {
                sourceInstanceId: source.id,
                triggerKind: "manual",
                status: "queued",
            },
        });
        const legacyJob = await store.prisma.job.create({
            data: {
                runId: legacyRun.id,
                kind: "source-ingest",
                status: "queued",
                idempotencyKey: `legacy:${legacyRun.id}`,
            },
        });
        expect(await store.claimActivityJob({ owner: "activity", leaseMs: 1000 })).toBeNull();
        expect(await store.prisma.job.findUnique({ where: { id: legacyJob.id } }))
            .toMatchObject({ kind: "source-ingest", status: "queued" });
    });

    it("delivers a completion already accepted before its Workflow Run becomes terminal", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-terminal-completion", "activity");
        const request = activityRequest(run.runId, "action-key-terminal-completion");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        await seedPendingActivity(store, request, pending.receipt);
        const job = await store.claimActivityJob({ owner: "activity", leaseMs: 10_000 });
        if (!job) throw new Error("expected Activity claim");
        const completionInput = completionFor(request, job.id, {
            status: "completed",
            result: { ok: true },
        });
        await store.completeActivity({
            jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
            runLease: run,
            result: { status: "succeeded", result: { ok: true } },
            completion: completionInput,
        });
        await acceptCompletionInKernel(store, request, completionInput, true);
        const completion = await store.claimWorkflowCompletion({ owner: "dispatcher", leaseMs: 10_000 });
        if (!completion) throw new Error("expected completion claim");
        await store.prisma.workflowRun.update({
            where: { id: run.runId },
            data: { status: "completed" },
        });
        expect(await store.deliverWorkflowCompletion({
            completionId: completion.id,
            leaseToken: completion.leaseToken,
            owner: completion.leaseOwner,
            runLease: run,
        })).toBe(true);
        expect(await store.prisma.workflowCompletion.findUnique({ where: { id: completion.id } }))
            .toMatchObject({ status: "delivered" });
    });
    it("finds an ingest envelope by idempotency key", async () => {
        const store = await createStore();
        const first = await store.createWorkflowEnvelope({
            runId: "workflow-ingest-find",
            idempotencyKey: "ingest-command-find",
            definition,
            inputSnapshot,
            productRun,
        });
        await expect(store.findWorkflowEnvelopeByIdempotencyKey("ingest-command-find"))
            .resolves.toMatchObject({
                runId: first.runId,
                idempotencyKey: "ingest-command-find",
            });
        await expect(store.findWorkflowEnvelopeByIdempotencyKey("missing-command"))
            .resolves.toBeNull();
    });
    it("persists the Action manifest retry policy on the Activity Job", async () => {
        const retryPolicy: RetryPolicy = {
            maxAttempts: 5,
            backoffMs: 700,
            retryableErrors: ["timeout"],
        };
        const store = await createStore({
            actionRetryPolicies: { "library.ingest@1": retryPolicy },
        });
        const run = await createRunningRun(store, "workflow-run-policy", "activity-worker");
        const request = activityRequest(run.runId, "action-key-policy");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") throw new Error("expected policy Activity receipt");
        const job = await store.prisma.job.findUnique({ where: { id: pending.receipt } });
        expect(job).toMatchObject({ maxAttempts: 5 });
        expect(job?.payloadJson ? JSON.parse(job.payloadJson) : null).toMatchObject({ retryPolicy });
    });

    it("terminalizes exhausted Activity Jobs and creates one failure completion", async () => {
        const store = await createStore();
        const run = await createRunningRun(store, "workflow-run-max-attempts", "activity-worker");
        const request = activityRequest(run.runId, "action-key-max-attempts");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") {
            throw new Error("expected max-attempt Activity receipt");
        }
        await seedPendingActivity(store, request, pending.receipt);
        await store.prisma.job.update({
            where: { id: pending.receipt },
            data: { attempts: 3, maxAttempts: 3 },
        });
        expect(await store.claimActivityJob({ owner: "activity-worker", leaseMs: 10_000 }))
            .toBeNull();
        await expect(store.prisma.job.findUnique({ where: { id: pending.receipt } }))
            .resolves.toMatchObject({ status: "failed_terminal", errorCode: "max_attempts" });
        await expect(store.prisma.workflowCompletion.findUnique({ where: { jobId: pending.receipt } }))
            .resolves.toMatchObject({ status: "queued", jobId: pending.receipt });
    });
});

async function createStore(
    options: { actionRetryPolicies?: Readonly<Record<string, RetryPolicy>> } = {},
): Promise<PrismaWorkflowHostStore> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-workflow-host-"));
    roots.push(root);
    const databasePath = join(root, "cosmos.sqlite");
    const client = new PrismaClient({
        datasources: { db: { url: `file:${databasePath}` } },
    });
    clients.add(client);
    deployMigrations(databasePath, resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma"));
    const store = new PrismaWorkflowHostStore(client, options);
    databasePaths.set(store, databasePath);
    return store;
}

function deployMigrations(databasePath: string, schemaPath: string): void {
    execFileSync(process.execPath, [
        resolve(process.cwd(), "packages/storage-prisma/node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--schema",
        schemaPath,
    ], {
        env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
        stdio: "ignore",
    });
}

async function createRunningRun(
    store: PrismaWorkflowHostStore,
    runId: string,
    owner = "run-worker",
    now?: Date,
) {
    await store.createWorkflowEnvelope({
        runId,
        idempotencyKey: `${runId}:enqueue`,
        definition,
        inputSnapshot,
        productRun,
    });
    const lease = await store.claimRun({ owner, leaseMs: 60_000, runId, ...(now ? { now } : {}) });
    if (!lease) {
        throw new Error("expected Run lease");
    }
    return lease;
}
function activityRequest(runId: string, idempotencyKey: string): ActivityExecutionRequest {
    return {
        reference: "library.ingest@1",
        input: { sourceId: "source-1" },
        options: { timeoutMs: 1000, metadata: { sourceId: "source-1" } },
        context: {
            runId,
            idempotencyKey,
            signal: new AbortController().signal,
            activity: {
                key: `activity:${idempotencyKey}`,
                path: "root",
                seq: 0,
                kind: "action",
                fingerprint: `sha256:${idempotencyKey}`,
            },
        },
    };
}

function completionFor(
    request: ActivityExecutionRequest,
    receipt: string,
    completion: Pick<DeferredActivityCompletionInput, "status" | "result" | "error">,
): DeferredActivityCompletionInput {
    return {
        activityKey: request.context.activity.key,
        receipt,
        reference: request.reference,
        fingerprint: request.context.activity.fingerprint,
        ...completion,
    };
}
async function acceptCompletionInKernel(
    store: PrismaWorkflowHostStore,
    request: ActivityExecutionRequest,
    completion: DeferredActivityCompletionInput,
    terminal = false,
): Promise<void> {
    const row = await store.prisma.workflowRun.findUniqueOrThrow({
        where: { id: request.context.runId },
    });
    const state = JSON.parse(row.stateJson) as Record<string, unknown>;
    const pending = Array.isArray(state.pendingActivities) ? state.pendingActivities : [];
    const record = {
        ...(pending.find((item): item is Record<string, unknown> => (
            typeof item === "object" && item !== null && "key" in item
        )) ?? {}),
        status: completion.status,
        completionFingerprint: fingerprint({
            activityKey: completion.activityKey,
            receipt: completion.receipt,
            reference: completion.reference,
            fingerprint: completion.fingerprint,
            status: completion.status,
            hasResult: Object.prototype.hasOwnProperty.call(completion, "result"),
            result: completion.result === undefined ? null : completion.result,
            hasError: Object.prototype.hasOwnProperty.call(completion, "error"),
            error: completion.error === undefined ? null : completion.error,
        }),
        ...(completion.result === undefined ? {} : { result: { kind: "inline", value: completion.result } }),
        ...(completion.error === undefined ? {} : { error: completion.error }),
        completedAt: "2026-08-14T00:00:00.000Z",
    };
    await store.prisma.workflowRun.update({
        where: { id: row.id },
        data: {
            stateJson: canonicalJson({
                ...state,
                status: terminal ? "completed" : "running",
                pendingActivities: terminal ? [] : state.pendingActivities,
                activityCompletions: [record],
                revision: row.kernelRevision,
            }),
            status: terminal ? "completed" : "running",
        },
    });
}
async function seedPendingActivity(
    store: PrismaWorkflowHostStore,
    request: ActivityExecutionRequest,
    receipt: string,
): Promise<void> {
    const row = await store.prisma.workflowRun.findUnique({
        where: { id: request.context.runId },
    });
    if (!row) throw new Error("expected WorkflowRun fixture");
    const now = "2026-08-14T00:00:00.000Z";
    const state = {
        runId: row.id,
        definition: {
            key: row.definitionKey,
            version: row.definitionVersion,
            manifestHash: row.manifestHash,
        },
        input: { kind: "inline", value: inputSnapshot },
        extensionContext: {},
        status: "waiting",
        resumeRequired: false,
        cancelRequestedAt: null,
        budget: null,
        checkpoint: null,
        pendingAsks: [],
        pendingWaits: [],
        pendingActivities: [{
            kind: "action",
            key: request.context.activity.key,
            path: request.context.activity.path,
            seq: request.context.activity.seq,
            fingerprint: request.context.activity.fingerprint,
            reference: request.reference,
            receipt,
            reason: "workflow-activity",
            stateRevision: row.kernelRevision,
            createdAt: now,
        }],
        activityCompletions: [],
        progress: null,
        journal: [],
        revision: row.kernelRevision,
        createdAt: row.createdAt.toISOString(),
        updatedAt: now,
    };
    await store.prisma.workflowRun.update({
        where: { id: row.id },
        data: {
            stateJson: canonicalJson(state),
            status: "waiting",
            resumeRequired: false,
        },
    });
}
