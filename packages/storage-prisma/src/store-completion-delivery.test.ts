import { canonicalJson } from "@notnotype/nb-workflow";
import type { RetryPolicy } from "@cosmos/contracts";
import { expect, it } from "vitest";
import { acceptCompletionInKernel, activityRequest, completionFor, createRunningRun, createStore, definition, inputSnapshot, productRun, seedPendingActivity } from "./workflow-host-store.fixtures.js";

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

    it("claims an exhausted completion for dispatcher-owned dead-letter handling", async () => {
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
        const completion = await store.claimWorkflowCompletion({ owner: "dispatcher", leaseMs: 10_000 });
        expect(completion).toMatchObject({ attempts: 6, maxAttempts: 5, status: "leased" });
        if (!completion) throw new Error("expected exhausted completion claim");
        expect(await store.deadLetterWorkflowCompletion({
            completionId: completion.id,
            leaseToken: completion.leaseToken,
            owner: completion.leaseOwner,
            error: "completion exhausted",
        })).toBe(true);
        await expect(store.prisma.workflowCompletion.findUnique({ where: { jobId: job.id } }))
            .resolves.toMatchObject({ status: "dead_letter", attempts: 6 });
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
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                configJson: "{}",
                enabled: true,
                revision: 1,
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

