import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fingerprint } from "@notnotype/nb-workflow";
import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";
import { PrismaWorkflowHostStore } from "./workflow-host-store.js";
import { PrismaWorkflowEventSink } from "./workflow-event-sink.js";
import { acceptCompletionInKernel, activityRequest, clients, completionFor, createRunningRun, createStore, databasePaths, definition, deployMigrations, roots, seedPendingActivity } from "./workflow-host-store.fixtures.js";

    it("applies the complete migration set to a fresh isolated SQLite root", async () => {
        const store = await createStore();
        const tables = await store.prisma.$queryRawUnsafe<readonly { name: string }[]>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('WorkflowRun', 'WorkflowCompletion', 'Job') ORDER BY name",
        );
        expect(tables.map((table) => table.name)).toEqual(["Job", "WorkflowCompletion", "WorkflowRun"]);
        const columns = await store.prisma.$queryRawUnsafe<readonly { name: string }[]>(
            "PRAGMA table_info(\"WorkflowRun\")",
        );
        expect(columns.map((column) => column.name)).toEqual(
            expect.arrayContaining(["sourceInstanceId", "errorMessage"]),
        );
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
            .resolves.toMatchObject({
                id: "old-run",
                status: "running",
                resumeRequired: true,
                sourceInstanceId: null,
                errorMessage: null,
            });
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

