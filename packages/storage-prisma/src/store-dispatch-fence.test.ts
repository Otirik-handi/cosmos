import { expect, it } from "vitest";
import { withTestDatabase } from "./index.fixtures.js";
import { PrismaWorkflowHostStore } from "./workflow-host-store.js";
import { activityRequest, completionFor, createRunningRun, seedPendingActivity } from "./workflow-host-store.fixtures.js";

it("allows only one current lease holder to consume an Activity dispatch fence", async () => {
    await withTestDatabase("workflow-dispatch-fence", async (database) => {
        database.deploy();
        const storeA = new PrismaWorkflowHostStore(database.openClient());
        const storeB = new PrismaWorkflowHostStore(database.openClient());
        const run = await createRunningRun(storeA, "dispatch-fence-race", "worker-a");
        const request = activityRequest(run.runId, "dispatch-fence-race");
        const pending = await storeA.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        await seedPendingActivity(storeA, request, pending.receipt);
        const job = await storeA.claimActivityJob({ owner: "worker-a", leaseMs: 5_000 });
        if (!job) throw new Error("expected Activity Job claim");
        const runLease = await storeA.claimRun({
            owner: "worker-a",
            leaseMs: 5_000,
            runId: run.runId,
            purpose: "activity",
        });
        if (!runLease) throw new Error("expected current Run lease");
        const input = {
            jobLease: { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner },
            runLease,
            now: new Date(),
        };

        const results = await Promise.all([
            storeA.consumeActivityDispatch(input),
            storeB.consumeActivityDispatch(input),
        ]);

        expect(results.filter((result) => result.accepted)).toHaveLength(1);
        const persisted = await storeA.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
        expect(persisted.dispatchAuthorizedAt).not.toBeNull();
    });
});

it("does not reclaim a fenced Activity and terminalizes it as outcome_unknown", async () => {
    await withTestDatabase("workflow-dispatch-recovery", async (database) => {
        database.deploy();
        const store = new PrismaWorkflowHostStore(database.openClient());
        const run = await createRunningRun(store, "dispatch-fence-recovery", "worker-a");
        const request = activityRequest(run.runId, "dispatch-fence-recovery");
        const pending = await store.startAction(request);
        if (pending.status !== "pending") throw new Error("expected pending Activity receipt");
        await seedPendingActivity(store, request, pending.receipt);
        const claimAt = new Date("2026-08-14T00:01:00.000Z");
        const job = await store.claimActivityJob({ owner: "worker-a", leaseMs: 1_000, now: claimAt });
        if (!job) throw new Error("expected Activity Job claim");
        const runLease = await store.claimRun({
            owner: "worker-a",
            leaseMs: 1_000,
            runId: run.runId,
            purpose: "activity",
            now: claimAt,
        });
        if (!runLease) throw new Error("expected current Run lease");
        const oldJobLease = { jobId: job.id, leaseToken: job.leaseToken, owner: job.leaseOwner };
        expect(await store.consumeActivityDispatch({ jobLease: oldJobLease, runLease, now: claimAt }))
            .toMatchObject({ accepted: true });

        const takeoverAt = new Date(claimAt.getTime() + 1_001);
        const reclaimed = await store.claimActivityJob({ owner: "worker-b", leaseMs: 1_000, now: takeoverAt });

        expect(reclaimed).toBeNull();
        await expect(store.prisma.job.findUniqueOrThrow({ where: { id: job.id } }))
            .resolves.toMatchObject({ status: "failed_terminal", errorCode: "outcome_unknown" });
        await expect(store.prisma.workflowCompletion.findUnique({ where: { jobId: job.id } }))
            .resolves.toMatchObject({ status: "queued" });
        await expect(store.prisma.workflowRun.findUniqueOrThrow({ where: { id: run.runId } }))
            .resolves.toMatchObject({
                status: "failed",
                errorMessage: "Activity dispatch outcome is unknown; the external request may already have been sent.",
                runLeaseOwner: null,
                runLeaseToken: null,
                runLeaseExpiresAt: null,
                resumeRequired: false,
            });
        expect(await store.completeActivity({
            jobLease: oldJobLease,
            runLease,
            result: { status: "succeeded", result: { candidates: [] } },
            completion: completionFor(request, job.id, { status: "completed", result: { candidates: [] } }),
            now: takeoverAt,
        })).toMatchObject({ accepted: false });
    });
});
