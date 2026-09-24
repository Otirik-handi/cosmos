import { DeferredActivityCompletionConflictError, DeferredActivityLateCompletionError, DeferredActivityNotFoundError, NonJsonValueError, UuidIdGenerator, WorkflowBackendConflictError, WorkflowRunNotFoundError, WorkflowRunner } from "@notnotype/nb-workflow";
import type { ActivityExecutionRequest, AnyWorkflowDefinition, DeferredActivityCompletionInput, DeferredActivityExecutor, DefinitionRegistry, EventSink, EventSinkRequest, IdGenerator, JsonValue, RunView, ValueStore, WorkflowBackend, WorkflowDefinitionReference, WorkflowRunState, WorkflowRunnerOptions as KernelWorkflowRunnerOptions, WorkflowStartOptions } from "@notnotype/nb-workflow";
import type { LoggerPort } from "./logger.js";
import { WorkflowHostError } from "./workflow-host.js";
import type { ActivityJobLease, ActivityJobTerminalResult, CompleteActivityResult, WorkflowActivityJobClaim, WorkflowCompletionClaim, WorkflowEnvelope, WorkflowHostStore, WorkflowRunLease, WorkflowRuntimeAttempt } from "./workflow-host.js";
import { createCombinedHeartbeat, isKernelTerminalError, raceWithLease } from "./workflow-action-support.js";
import { backendForLease, createRunner, errorMessage, heartbeatMsFor, isLeaseLostError, leaseLostError, leaseMsFor, loggerFor, nowFor, ownerFor, resolveDefinition } from "./workflow-runtime-support.js";
import type { WorkflowCompletionDispatcherOptions, WorkflowCompletionDispatcherResult, WorkflowLeaseRuntimeOptions, WorkflowRuntimeDependencies } from "./workflow-host-runtime-types.js";

/**
 * Completion lane: a durable completion is delivered to the Kernel only while
 * both its completion lease and its Workflow Run lease are current.
 */
export class WorkflowCompletionDispatcher {
    private readonly owner: string;
    private readonly leaseMs: number;
    private readonly heartbeatMs: number;
    private readonly logger: LoggerPort;
    private readonly active = new Set<AbortController>();

    constructor(private readonly options: WorkflowCompletionDispatcherOptions) {
        this.owner = ownerFor(options);
        this.leaseMs = leaseMsFor(options);
        this.heartbeatMs = heartbeatMsFor(options, this.leaseMs);
        this.logger = loggerFor(options.logger);
    }

    abortActive(reason: unknown): void {
        for (const controller of this.active) {
            if (!controller.signal.aborted) controller.abort(reason);
        }
    }

    async pollOnce(): Promise<WorkflowCompletionDispatcherResult> {
        const completion = await this.options.store.claimWorkflowCompletion({
            owner: this.owner,
            leaseMs: this.leaseMs,
            now: nowFor(this.options),
        });
        if (!completion) return null;

        const completionLease = {
            completionId: completion.id,
            leaseToken: completion.leaseToken,
            owner: completion.leaseOwner,
        };

        const runLease = await this.options.store.claimRun({
            owner: this.owner,
            leaseMs: this.leaseMs,
            runId: completion.workflowRunId,
            purpose: "completion",
            now: nowFor(this.options),
        });
        if (!runLease) {
            await this.requeueOrDeadLetter(completion, "Workflow Run lease is unavailable.");
            return null;
        }

        const controller = new AbortController();
        this.active.add(controller);
        const dispatcherLogger = this.logger.child({
            runId: completion.workflowRunId,
            jobId: completion.jobId,
        });
        const heartbeat = createCombinedHeartbeat(
            this.heartbeatMs,
            [
                async () => this.options.store.heartbeatRun({
                    ...runLease,
                    leaseMs: this.leaseMs,
                    now: nowFor(this.options),
                }),
                async () => this.options.store.heartbeatWorkflowCompletion({
                    completionId: completionLease.completionId,
                    leaseToken: completionLease.leaseToken,
                    owner: completionLease.owner,
                    leaseMs: this.leaseMs,
                    now: nowFor(this.options),
                }),
            ],
            () => controller.abort(leaseLostError("Completion", completion.id)),
        );

        try {
            const runner = createRunner(
                this.options,
                this.options.ids ?? new UuidIdGenerator(),
                runLease,
            );
            try {
                const view = await raceWithLease(
                    runner.completeActivity(
                        completion.workflowRunId,
                        completion.completion,
                    ),
                    heartbeat.lost,
                    leaseLostError("Completion", completion.id),
                    controller.signal,
                );
                if (heartbeat.wasLost) throw leaseLostError("Completion", completion.id);
                const delivered = await this.options.store.deliverWorkflowCompletion({
                    ...completionLease,
                    runLease,
                    now: nowFor(this.options),
                });
                if (!delivered) {
                    // A false CAS may mean a concurrent delivery or a temporary
                    // fence race. It is not evidence of a bad Kernel identity.
                    dispatcherLogger.debug("workflow_completion_delivery_rejected", {
                        completionId: completion.id,
                    });
                    await this.requeueOrDeadLetter(
                        completion,
                        "Workflow completion delivery was not accepted by the durable fence.",
                        undefined,
                        runLease,
                    );
                    return null;
                }
                return view;
            } catch (error) {
                if (heartbeat.wasLost || isLeaseLostError(error)) {
                    dispatcherLogger.warn("workflow_completion_lease_lost", {
                        completionId: completion.id,
                        error: errorMessage(error),
                    });
                    return null;
                }
                if (controller.signal.aborted) {
                    dispatcherLogger.info("workflow_completion_shutdown_aborted", {
                        completionId: completion.id,
                    });
                    return null;
                }
                await this.requeueOrDeadLetter(completion, errorMessage(error), error, runLease);
                return null;
            }
        } finally {
            this.active.delete(controller);
            await heartbeat.stop();
            await this.options.store.releaseRun({ ...runLease, now: nowFor(this.options) }).catch((error) => {
                dispatcherLogger.warn("workflow_completion_run_release_failed", { error: errorMessage(error) });
            });
        }
    }

    private async requeueOrDeadLetter(
        completion: WorkflowCompletionClaim,
        error: string,
        cause?: unknown,
        runLease?: WorkflowRunLease,
    ): Promise<void> {
        if (this.shouldDeadLetter(completion, cause)) {
            await this.deadLetter(completion, error, runLease);
            return;
        }
        await this.requeue(completion, error);
    }
    private shouldDeadLetter(completion: WorkflowCompletionClaim, error: unknown): boolean {
        const maxAttempts = this.options.maxCompletionAttempts ?? 5;
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
            throw new RangeError("maxCompletionAttempts must be a positive integer.");
        }
        return completion.attempts >= maxAttempts || isKernelTerminalError(error);
    }

    private async requeue(completion: WorkflowCompletionClaim, error: string): Promise<void> {
        await this.options.store.requeueWorkflowCompletion({
            completionId: completion.id,
            leaseToken: completion.leaseToken,
            owner: completion.leaseOwner,
            availableAt: new Date(
                nowFor(this.options).getTime() + this.retryDelayMs(completion, error),
            ).toISOString(),
            error,
            now: nowFor(this.options),
        });
    }

    private async deadLetter(
        completion: WorkflowCompletionClaim,
        error: string,
        runLease?: WorkflowRunLease,
    ): Promise<void> {
        const deadLettered = await this.options.store.deadLetterWorkflowCompletion({
            completionId: completion.id,
            leaseToken: completion.leaseToken,
            owner: completion.leaseOwner,
            error,
            now: nowFor(this.options),
        });
        if (!deadLettered || !this.options.store.failWorkflowRun) return;
        const currentRunLease = runLease ?? await this.options.store.claimRun({
            owner: this.owner,
            leaseMs: this.leaseMs,
            runId: completion.workflowRunId,
            purpose: "completion",
            now: nowFor(this.options),
        });
        if (!currentRunLease) return;
        await this.options.store.failWorkflowRun({
            runLease: currentRunLease,
            error,
            now: nowFor(this.options),
        });
        if (runLease === undefined) {
            await this.options.store.releaseRun({ ...currentRunLease, now: nowFor(this.options) })
                .catch(() => undefined);
        }
    }

    private retryDelayMs(completion: WorkflowCompletionClaim, error: unknown): number {
        const configured = this.options.completionRetryDelayMs;
        const base = typeof configured === "function"
            ? configured(completion, error)
            : configured ?? 1_000;
        const boundedBase = Number.isFinite(base) ? Math.max(0, base) : 1_000;
        const max = this.options.maxCompletionRetryDelayMs ?? 60_000;
        if (!Number.isFinite(max) || max < 0) {
            throw new RangeError("maxCompletionRetryDelayMs must be non-negative.");
        }
        const exponent = Math.max(0, completion.attempts - 1);
        return Math.min(max, boundedBase * (2 ** exponent));
    }
}
