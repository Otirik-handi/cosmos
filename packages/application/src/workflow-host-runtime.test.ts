import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
    DeferredActivityCompletionConflictError,
    DeferredActivityLateCompletionError,
    DeferredActivityNotFoundError,
    type AnyWorkflowDefinition,
    type DeferredActivityCompletionInput,
    type JsonValue,
    type RunView,
} from "@notnotype/nb-workflow";
import type { ActionDefinition } from "@cosmos/contracts";

import {
    ActionExecutionError,
    ActionRegistry,
    WorkflowActivityWorker,
    WorkflowCompletionDispatcher,
    WorkflowRunLane,
    type WorkflowActivityJobClaim,
    type WorkflowCompletionClaim,
    type WorkflowEnvelope,
    type WorkflowHostStore,
    type WorkflowRunLease,
} from "./index.js";
import type {
    CompleteActivityInput,
    CompleteActivityResult,
} from "./workflow-host.js";

const clock = new Date("2026-08-14T00:00:00.000Z");
const definition = {
    key: "demo.workflow",
    version: "1",
    manifestHash: "sha256:demo-workflow",
    run: async () => ({ ok: true }),
} satisfies AnyWorkflowDefinition;
const envelope: WorkflowEnvelope = {
    runId: "run-1",
    idempotencyKey: "enqueue-1",
    definition: {
        key: definition.key,
        version: definition.version,
        manifestHash: definition.manifestHash!,
    },
    inputSnapshot: { value: "input" },
    productRun: { status: "queued" },
    status: "queued",
    resumeRequired: false,
    createdAt: clock.toISOString(),
    updatedAt: clock.toISOString(),
    startedAt: null,
    finishedAt: null,
};
const runLease: WorkflowRunLease = {
    runId: "run-1",
    owner: "worker-1",
    leaseToken: "run-token",
    leaseExpiresAt: new Date(clock.getTime() + 10_000).toISOString(),
};

function view(status: RunView["status"] = "waiting"): RunView {
    return {
        runId: "run-1",
        workflowKey: definition.key,
        workflowVersion: definition.version!,
        workflowManifestHash: definition.manifestHash!,
        status,
        resumeRequired: false,
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
        revision: 1,
        createdAt: clock.toISOString(),
        updatedAt: clock.toISOString(),
    };
}

function actionDefinition(
    executionPlacement: ActionDefinition["executionPlacement"] = "trusted_worker",
): ActionDefinition {
    return {
        ref: "demo.echo@1",
        kind: "transform",
        description: "Echo an input value.",
        capabilities: ["demo:echo"],
        executionPlacement,
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ echoed: z.string() }),
        execution: {
            idempotent: true,
            supportsCancellation: true,
            timeoutMs: null,
            retryPolicy: null,
        },
    };
}

function activityJob(): WorkflowActivityJobClaim {
    return {
        id: "job-1",
        workflowRunId: runLease.runId,
        kernelRevision: 1,
        kind: "workflow-activity",
        status: "leased",
        payload: {
            runId: runLease.runId,
            activity: {
                key: "root#0",
                path: "root",
                seq: 0,
                kind: "action",
                fingerprint: "sha256:activity",
            },
            reference: "demo.echo@1",
            input: { value: "hello" },
            options: { timeoutMs: 1000 },
            idempotencyKey: "run-1:root#0:sha256:activity",
        },
        attempts: 1,
        maxAttempts: 3,
        leaseOwner: "worker-1",
        leaseToken: "job-token",
        leaseExpiresAt: new Date(clock.getTime() + 10_000).toISOString(),
        createdAt: clock.toISOString(),
        updatedAt: clock.toISOString(),
    };
}

function completion(): WorkflowCompletionClaim {
    const job = activityJob();
    const input: DeferredActivityCompletionInput = {
        activityKey: job.payload.activity.key,
        receipt: job.id,
        reference: job.payload.reference,
        fingerprint: job.payload.activity.fingerprint,
        status: "completed",
        result: { echoed: "hello" },
    };
    return {
        id: "completion-1",
        workflowRunId: runLease.runId,
        jobId: job.id,
        activityKey: input.activityKey,
        receipt: input.receipt,
        reference: input.reference,
        fingerprint: input.fingerprint,
        completion: input,
        status: "leased",
        attempts: 1,
        maxAttempts: 5,
        availableAt: clock.toISOString(),
        leaseOwner: "worker-1",
        leaseToken: "completion-token",
        leaseExpiresAt: new Date(clock.getTime() + 10_000).toISOString(),
        lastError: null,
        createdAt: clock.toISOString(),
        updatedAt: clock.toISOString(),
    };
}

function fakeStore(overrides: Record<string, unknown> = {}): WorkflowHostStore {
    return {
        claimRun: async () => runLease,
        heartbeatRun: async () => true,
        releaseRun: async () => true,
        loadWorkflowEnvelope: async () => envelope,
        hasWorkflowKernelState: async () => false,
        createWorkflowEnvelope: async () => envelope,
        startAction: async () => ({
            status: "pending",
            receipt: "job-1",
            reason: "workflow-activity",
        }),
        claimActivityJob: async () => activityJob(),
        heartbeatActivityJob: async () => true,
        completeActivity: async () => ({
            accepted: true,
            jobStatus: "succeeded",
            completion: null,
        }),
        claimWorkflowCompletion: async () => completion(),
        heartbeatWorkflowCompletion: async () => true,
        deliverWorkflowCompletion: async () => true,
        requeueWorkflowCompletion: async () => true,
        deadLetterWorkflowCompletion: async () => true,
        markResumeRequired: async () => true,
        listRunsForRecovery: async () => [envelope],
        ...overrides,
    } as unknown as WorkflowHostStore;
}

function runnerFactory(
    onCreate: (options: Record<string, unknown>) => void,
    behavior: {
        begin?: () => Promise<RunView>;
        rerun?: () => Promise<RunView>;
        completeActivity?: () => Promise<RunView>;
    } = {},
) {
    return (options: Record<string, unknown>) => {
        onCreate(options);
        return {
            begin: (_definition: AnyWorkflowDefinition, _args: JsonValue) => ({
                runId: "run-1",
                done: behavior.begin?.() ?? Promise.resolve(view()),
            }),
            rerun: async () => behavior.rerun?.() ?? view(),
            completeActivity: async () => behavior.completeActivity?.() ?? view("completed"),
        };
    };
}

describe("Workflow Host runtime", () => {
    it("requeues a completion when durable delivery returns false", async () => {
        let requeued: unknown;
        const dispatcher = new WorkflowCompletionDispatcher({
            store: fakeStore({
                deliverWorkflowCompletion: async () => false,
                requeueWorkflowCompletion: async (input: unknown) => {
                    requeued = input;
                    return true;
                },
            }),
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            completionRetryDelayMs: 0,
            now: () => clock,
            runnerFactory: runnerFactory(() => undefined),
        });
        await expect(dispatcher.pollOnce()).resolves.toBeNull();
        expect(requeued).toMatchObject({ completionId: "completion-1" });
    });

    it("returns null when no completion is claimable", async () => {
        let created = false;
        const dispatcher = new WorkflowCompletionDispatcher({
            store: fakeStore({ claimWorkflowCompletion: async () => null }),
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            runnerFactory: runnerFactory(() => { created = true; }),
        });
        await expect(dispatcher.pollOnce()).resolves.toBeNull();
        expect(created).toBe(false);
    });

    it("requeues a completion when its Run claim is unavailable", async () => {
        let requeued: unknown;
        let deadLettered = false;
        const dispatcher = new WorkflowCompletionDispatcher({
            store: fakeStore({
                claimRun: async () => null,
                requeueWorkflowCompletion: async (input: unknown) => {
                    requeued = input;
                    return true;
                },
                deadLetterWorkflowCompletion: async () => {
                    deadLettered = true;
                    return true;
                },
            }),
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            completionRetryDelayMs: 0,
            runnerFactory: runnerFactory(() => undefined),
        });
        await expect(dispatcher.pollOnce()).resolves.toBeNull();
        expect(requeued).toMatchObject({
            completionId: "completion-1",
            error: "Workflow Run lease is unavailable.",
        });
        expect(deadLettered).toBe(false);
    });

    it("dead-letters completion after max delivery attempts", async () => {
        let deadLettered: unknown;
        const dispatcher = new WorkflowCompletionDispatcher({
            store: fakeStore({
                claimWorkflowCompletion: async () => ({ ...completion(), attempts: 5, maxAttempts: 5 }),
                deadLetterWorkflowCompletion: async (input: unknown) => {
                    deadLettered = input;
                    return true;
                },
                requeueWorkflowCompletion: async () => {
                    throw new Error("must not requeue exhausted completion");
                },
            }),
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            runnerFactory: runnerFactory(() => undefined, {
                completeActivity: async () => { throw new Error("transient"); },
            }),
        });
        await expect(dispatcher.pollOnce()).resolves.toBeNull();
        expect(deadLettered).toMatchObject({ completionId: "completion-1", error: "transient" });
    });

    it("rejects a legacy Activity kind before claiming its Run", async () => {
        let claimedRun = false;
        const legacy = { ...activityJob(), kind: "source-ingest" } as unknown as WorkflowActivityJobClaim;
        const dispatcher = new WorkflowActivityWorker({
            store: fakeStore({
                claimActivityJob: async () => legacy,
                claimRun: async () => {
                    claimedRun = true;
                    return runLease;
                },
            }),
            actions: new ActionRegistry(),
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
        });
        await expect(dispatcher.pollOnce()).resolves.toBeNull();
        expect(claimedRun).toBe(false);
    });

    it("returns null when the Run lane has no claim", async () => {
        let created = false;
        const lane = new WorkflowRunLane({
            store: fakeStore({ claimRun: async () => null }),
            owner: runLease.owner,
            heartbeatMs: 0,
            now: () => clock,
            resolveDefinition: () => definition,
            runnerFactory: runnerFactory(() => { created = true; }),
        });
        await expect(lane.pollOnce()).resolves.toBeNull();
        expect(created).toBe(false);
    });

    it("maps retryable Activity failures below exhaustion to retry_wait", async () => {
        let completed: CompleteActivityInput | undefined;
        const actions = new ActionRegistry();
        actions.register(actionDefinition(), async () => {
            throw new ActionExecutionError("rate_limited", "try later", true);
        });
        const worker = new WorkflowActivityWorker({
            store: fakeStore({
                claimActivityJob: async () => ({ ...activityJob(), attempts: 1, maxAttempts: 3 }),
                completeActivity: async (input: CompleteActivityInput) => {
                    completed = input;
                    return { accepted: true, jobStatus: input.result.status, completion: null };
                },
            }),
            actions,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            retryDelayMs: 250,
        });
        await expect(worker.pollOnce()).resolves.toMatchObject({ accepted: true, jobStatus: "retry_wait" });
        expect(completed).toMatchObject({ result: {
            status: "retry_wait",
            errorCode: "rate_limited",
            error: "try later",
            retryDelayMs: 250,
        } });
        expect(completed).not.toHaveProperty("completion");
    });

    it("enforces an Action manifest retryableErrors allow-list", async () => {
        let completed: CompleteActivityInput | undefined;
        const actions = new ActionRegistry();
        actions.register({
            ...actionDefinition(),
            execution: {
                ...actionDefinition().execution,
                retryPolicy: {
                    maxAttempts: 5,
                    backoffMs: 700,
                    retryableErrors: ["timeout"],
                },
            },
        }, async () => {
            throw new ActionExecutionError("rate_limited", "not allowed by policy", true);
        });
        const worker = new WorkflowActivityWorker({
            store: fakeStore({
                claimActivityJob: async () => ({ ...activityJob(), attempts: 1, maxAttempts: 5 }),
                completeActivity: async (input: CompleteActivityInput) => {
                    completed = input;
                    return { accepted: true, jobStatus: input.result.status, completion: null };
                },
            }),
            actions,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            retryDelayMs: 1,
        });
        await expect(worker.pollOnce()).resolves.toMatchObject({ accepted: true, jobStatus: "failed_terminal" });
        expect(completed).toMatchObject({
            result: { status: "failed_terminal", errorCode: "rate_limited" },
            completion: { status: "failed", error: "not allowed by policy" },
        });
    });

    it("classifies retryable Activity failures at exhaustion without completion", async () => {
        let completed: CompleteActivityInput | undefined;
        const job = { ...activityJob(), attempts: 3, maxAttempts: 3 };
        const actions = new ActionRegistry();
        actions.register(actionDefinition(), async () => {
            throw new ActionExecutionError("rate_limited", "slow down", true);
        });
        const worker = new WorkflowActivityWorker({
            store: fakeStore({
                claimActivityJob: async () => job,
                completeActivity: async (input: CompleteActivityInput) => {
                    completed = input;
                    return { accepted: true, jobStatus: input.result.status, completion: null };
                },
            }),
            actions,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
        });
        await expect(worker.pollOnce()).resolves.toMatchObject({ accepted: true, jobStatus: "failed_terminal" });
        expect(completed?.result).toMatchObject({ status: "failed_terminal", errorCode: "rate_limited" });
        expect(completed).toMatchObject({ completion: { status: "failed", error: "slow down" } });
    });

    it("maps AbortError and cancelled errors to a cancelled completion", async () => {
        const outcomes: readonly unknown[] = [
            new DOMException("aborted", "AbortError"),
            { code: "cancelled", message: "stopped" },
        ];
        for (const failure of outcomes) {
            let completed: CompleteActivityInput | undefined;
            const actions = new ActionRegistry();
            actions.register(actionDefinition(), async () => ({ echoed: "ignored" }));
            vi.spyOn(actions, "dispatch").mockRejectedValue(failure);
            const worker = new WorkflowActivityWorker({
                store: fakeStore({
                    completeActivity: async (input: CompleteActivityInput) => {
                        completed = input;
                        return { accepted: true, jobStatus: input.result.status, completion: null };
                    },
                }),
                actions,
                owner: runLease.owner,
                leaseMs: 10_000,
                heartbeatMs: 0,
                now: () => clock,
            });
            await worker.pollOnce();
            expect(completed).toMatchObject({
                result: { status: "cancelled", errorCode: "cancelled" },
                completion: { status: "cancelled" },
            });
            vi.restoreAllMocks();
        }
    });

    it("releases an Activity Job when its Run claim is unavailable", async () => {
        let released: unknown;
        const store = fakeStore({
            claimRun: async () => null,
            releaseActivityJob: async (input: unknown) => { released = input; return true; },
        });
        const worker = new WorkflowActivityWorker({
            store,
            actions: new ActionRegistry(),
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
        });
        await expect(worker.pollOnce()).resolves.toBeNull();
        expect(released).toMatchObject({ jobId: "job-1", reason: "Workflow Run lease is unavailable." });
    });

    it("returns null and does not complete when the Activity heartbeat is lost", async () => {
        let completed = false;
        let resolveAction: (value: unknown) => void = () => undefined;
        const actionGate = new Promise<unknown>((resolve) => {
            resolveAction = resolve;
        });
        const actions = new ActionRegistry();
        actions.register(actionDefinition(), async () => actionGate);
        const store = fakeStore({
            heartbeatRun: async () => false,
            completeActivity: async () => {
                completed = true;
                return { accepted: true, jobStatus: "succeeded", completion: null };
            },
        });
        const worker = new WorkflowActivityWorker({
            store,
            actions,
            owner: runLease.owner,
            leaseMs: 10,
            heartbeatMs: 1,
            now: () => clock,
        });
        vi.useFakeTimers();
        try {
            const pending = worker.pollOnce();
            const rejection = expect(pending).rejects.toMatchObject({ code: "lease_lost" });
            await vi.advanceTimersByTimeAsync(1);
            await rejection;
        } finally {
            resolveAction({ ok: true });
            vi.useRealTimers();
        }
        expect(completed).toBe(false);
    });
    it("uses the claimed Run id for begin and releases with the injected clock", async () => {
        const released: WorkflowRunLease[] = [];
        let createdOptions: Record<string, unknown> | undefined;
        const store = fakeStore({
            releaseRun: async (input: WorkflowRunLease & { now?: Date }) => {
                released.push(input);
                return true;
            },
        });
        const lane = new WorkflowRunLane({
            store,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            resolveDefinition: () => definition,
            runnerFactory: runnerFactory((options) => {
                createdOptions = options;
            }),
        });

        const result = await lane.pollOnce();

        expect(result?.runId).toBe(runLease.runId);
        expect(released).toEqual([{ ...runLease, now: clock }]);
        const idsValue = createdOptions?.ids;
        expect(idsValue && typeof idsValue === "object" && "nextId" in idsValue
            && typeof idsValue.nextId === "function"
            ? idsValue.nextId("run")
            : undefined).toBe(runLease.runId);
    });

    it("reruns adopted Kernel state after a crash instead of beginning twice", async () => {
        let beginCalls = 0;
        let rerunCalls = 0;
        const store = fakeStore({ hasWorkflowKernelState: async () => true });
        const lane = new WorkflowRunLane({
            store,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            resolveDefinition: () => definition,
            runnerFactory: runnerFactory(() => undefined, {
                begin: async () => {
                    beginCalls += 1;
                    return view("completed");
                },
                rerun: async () => {
                    rerunCalls += 1;
                    return view("completed");
                },
            }),
        });

        await lane.pollOnce();

        expect(beginCalls).toBe(0);
        expect(rerunCalls).toBe(1);
    });

    it("dispatches an Activity with the durable identity and atomically completes it", async () => {
        let completed: CompleteActivityInput | undefined;
        const store = fakeStore({
            completeActivity: async (input: CompleteActivityInput): Promise<CompleteActivityResult> => {
                completed = input;
                return {
                    accepted: true,
                    jobStatus: input.result.status,
                    completion: null,
                };
            },
        });
        const actions = new ActionRegistry();
        actions.register(actionDefinition(), async (input) => {
            if (typeof input !== "object" || input === null || !("value" in input)
                || typeof input.value !== "string") {
                throw new Error("schema did not validate input");
            }
            return { echoed: input.value };
        });
        const worker = new WorkflowActivityWorker({
            store,
            actions,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
        });

        const result = await worker.pollOnce();

        expect(result).toMatchObject({ accepted: true, jobStatus: "succeeded" });
        expect(completed).toMatchObject({
            jobLease: {
                jobId: "job-1",
                leaseToken: "job-token",
                owner: "worker-1",
            },
            runLease,
            result: { status: "succeeded", result: { echoed: "hello" } },
            completion: {
                activityKey: "root#0",
                receipt: "job-1",
                reference: "demo.echo@1",
                fingerprint: "sha256:activity",
                status: "completed",
                result: { echoed: "hello" },
            },
            now: clock,
        });
    });

    it("passes a host-only fence without leaking lease fields to public payloads", async () => {
        let observed: unknown;
        const actions = new ActionRegistry();
        actions.register(actionDefinition("host"), async (_input, received) => {
            observed = received;
            return { echoed: "hello" };
        });
        const worker = new WorkflowActivityWorker({
            store: fakeStore(),
            actions,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
        });

        await worker.pollOnce();

        expect(observed).toMatchObject({
            idempotencyKey: "run-1:root#0:sha256:activity",
            fence: {
                workflowRunId: "run-1",
                kernelRevision: 1,
                activity: activityJob().payload.activity,
                jobId: "job-1",
                attempt: 1,
                jobLeaseToken: "job-token",
                runLeaseToken: "run-token",
            },
        });
        expect(observed).not.toHaveProperty("leaseToken");
        expect(activityJob().payload).not.toHaveProperty("jobLeaseToken");
        expect(activityJob().payload).not.toHaveProperty("runLeaseToken");
    });

    it("requeues a completion when durable delivery is temporarily rejected", async () => {
        let requeued = 0;
        let deadLettered = 0;
        const store = fakeStore({
            deliverWorkflowCompletion: async () => false,
            requeueWorkflowCompletion: async (input: { availableAt?: string }) => {
                requeued += 1;
                expect(input.availableAt).toBe(new Date(clock.getTime() + 1_000).toISOString());
                return true;
            },
            deadLetterWorkflowCompletion: async () => {
                deadLettered += 1;
                return true;
            },
        });
        const dispatcher = new WorkflowCompletionDispatcher({
            store,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            runnerFactory: runnerFactory(() => undefined),
        });
        await dispatcher.pollOnce();
        expect(requeued).toBe(1);
        expect(deadLettered).toBe(0);
    });

    it("delivers the final Activity after Kernel execution becomes terminal", async () => {
        let delivered = 0;
        let deadLettered = 0;
        const store = fakeStore({
            deliverWorkflowCompletion: async () => {
                delivered += 1;
                return true;
            },
            deadLetterWorkflowCompletion: async () => {
                deadLettered += 1;
                return true;
            },
        });
        const dispatcher = new WorkflowCompletionDispatcher({
            store,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            runnerFactory: runnerFactory(() => undefined, {
                completeActivity: async () => view("completed"),
            }),
        });
        await expect(dispatcher.pollOnce()).resolves.toMatchObject({ status: "completed" });
        expect(delivered).toBe(1);
        expect(deadLettered).toBe(0);
    });

    it("dead-letters deterministic Kernel completion errors and requeues transient errors", async () => {
        let requeued = 0;
        let deadLettered = 0;
        const store = fakeStore({
            requeueWorkflowCompletion: async () => {
                requeued += 1;
                return true;
            },
            deadLetterWorkflowCompletion: async () => {
                deadLettered += 1;
                return true;
            },
        });
        const deterministic = new WorkflowCompletionDispatcher({
            store,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            runnerFactory: runnerFactory(() => undefined, {
                completeActivity: async () => {
                    throw new DeferredActivityNotFoundError("root#0");
                },
            }),
        });
        await deterministic.pollOnce();
        expect(deadLettered).toBe(1);

        const transient = new WorkflowCompletionDispatcher({
            store,
            owner: runLease.owner,
            leaseMs: 10_000,
            heartbeatMs: 0,
            now: () => clock,
            runnerFactory: runnerFactory(() => undefined, {
                completeActivity: async () => {
                    throw new Error("database unavailable");
                },
            }),
        });
        await transient.pollOnce();
        expect(requeued).toBe(1);
    });
});
