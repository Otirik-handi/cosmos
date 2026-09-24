import type { RetryPolicy } from "@cosmos/contracts";
import { DeferredActivityCompletionConflictError, DeferredActivityLateCompletionError, DeferredActivityNotFoundError, NonJsonValueError, UuidIdGenerator, WorkflowBackendConflictError, WorkflowRunNotFoundError, WorkflowRunner } from "@notnotype/nb-workflow";
import type { ActivityExecutionRequest, AnyWorkflowDefinition, DeferredActivityCompletionInput, DeferredActivityExecutor, DefinitionRegistry, EventSink, EventSinkRequest, IdGenerator, JsonValue, RunView, ValueStore, WorkflowBackend, WorkflowDefinitionReference, WorkflowRunState, WorkflowRunnerOptions as KernelWorkflowRunnerOptions, WorkflowStartOptions } from "@notnotype/nb-workflow";
import { ActionExecutionError, ActionRegistry } from "./action.js";
import type { HostActionExecutionFence } from "./action.js";
import type { LoggerPort } from "./logger.js";
import { WorkflowHostError } from "./workflow-host.js";
import type { ActivityJobLease, ActivityJobTerminalResult, CompleteActivityResult, WorkflowActivityJobClaim, WorkflowCompletionClaim, WorkflowEnvelope, WorkflowHostStore, WorkflowRunLease, WorkflowRuntimeAttempt } from "./workflow-host.js";
import { abortRunner, actionErrorDetails, createCombinedHeartbeat, createHeartbeat, isCancellationError, isJsonValue, isKernelTerminalError, isRetryAllowed, raceWithLease } from "./workflow-action-support.js";
import { backendForLease, createRunner, errorMessage, eventsForLease, heartbeatMsFor, isLeaseLostError, leaseLostError, leaseMsFor, loggerFor, nowFor, ownerFor, resolveDefinition } from "./workflow-runtime-support.js";
import type { WorkflowActivityWorkerOptions, WorkflowActivityWorkerResult, WorkflowLeaseRuntimeOptions, WorkflowRunnerFactory, WorkflowRuntimeDependencies } from "./workflow-host-runtime-types.js";

/**
 * Activity lane: only the WorkflowHostStore activity claim can enter here.
 * Legacy source-ingest/source-probe jobs are rejected before Run or Action work.
 */
export class WorkflowActivityWorker {
    private readonly owner: string;
    private readonly leaseMs: number;
    private readonly heartbeatMs: number;
    private readonly logger: LoggerPort;
    private readonly active = new Map<AbortController, WorkflowRuntimeAttempt>();

    constructor(private readonly options: WorkflowActivityWorkerOptions) {
        this.owner = ownerFor(options);
        this.leaseMs = leaseMsFor(options);
        this.heartbeatMs = heartbeatMsFor(options, this.leaseMs);
        this.logger = loggerFor(options.logger);
    }

    abortActive(reason: unknown): void {
        for (const [controller, attempt] of this.active) {
            if (controller.signal.aborted) continue;
            controller.abort(reason);
            const cancellationRequested = { ...attempt, cancellationRequested: true };
            this.active.set(controller, cancellationRequested);
            this.notifyAttemptStarted(cancellationRequested);
        }
    }

    async pollOnce(): Promise<WorkflowActivityWorkerResult> {
        const job = await this.options.store.claimActivityJob({
            owner: this.owner,
            leaseMs: this.leaseMs,
            now: nowFor(this.options),
        });
        if (!job) return null;
        if (job.kind !== "workflow-activity") {
            this.logger.warn("workflow_activity_legacy_kind_rejected", {
                jobId: job.id,
                kind: job.kind,
            });
            return null;
        }

        const runLease = await this.options.store.claimRun({
            owner: this.owner,
            leaseMs: this.leaseMs,
            runId: job.workflowRunId,
            purpose: "activity",
            now: nowFor(this.options),
        });
        if (!runLease) {
            await this.options.store.releaseActivityJob({
                jobId: job.id,
                leaseToken: job.leaseToken,
                owner: job.leaseOwner,
                reason: "Workflow Run lease is unavailable.",
                now: nowFor(this.options),
            }).catch((error) => {
                this.logger.warn("workflow_activity_job_release_failed", {
                    jobId: job.id,
                    runId: job.workflowRunId,
                    error: errorMessage(error),
                });
            });
            return null;
        }

        const jobLease: ActivityJobLease = {
            jobId: job.id,
            leaseToken: job.leaseToken,
            owner: job.leaseOwner,
            ...(job.leaseExpiresAt === null ? {} : { leaseExpiresAt: job.leaseExpiresAt }),
        };
        const controller = new AbortController();
        const workerLogger = this.logger.child({
            runId: job.workflowRunId,
            jobId: job.id,
        });
        const heartbeat = createCombinedHeartbeat(
            this.heartbeatMs,
            [
                async () => this.options.store.heartbeatRun({
                    ...runLease,
                    leaseMs: this.leaseMs,
                    now: nowFor(this.options),
                }),
                async () => this.options.store.heartbeatActivityJob({
                    jobId: jobLease.jobId,
                    leaseToken: jobLease.leaseToken,
                    owner: jobLease.owner,
                    leaseMs: this.leaseMs,
                    now: nowFor(this.options),
                }),
            ],
            () => controller.abort(leaseLostError("Activity", job.id)),
        );

        let attempt: WorkflowRuntimeAttempt | null = null;
        try {
            const request = this.actionRequest(job, controller.signal);
            const action = this.options.actions.resolve(request.reference);
            attempt = {
                attemptId: `${job.id}:attempt:${job.attempts}`,
                jobId: job.id,
                runId: job.workflowRunId,
                actionRef: request.reference,
                lane: "workflow-activity",
                slot: 0,
                startedAt: nowFor(this.options).toISOString(),
                leaseExpiresAt: job.leaseExpiresAt ?? runLease.leaseExpiresAt ?? nowFor(this.options).toISOString(),
                cancellationRequested: false,
            };
            this.active.set(controller, attempt);
            this.notifyAttemptStarted(attempt);

            const retryPolicy = job.payload.retryPolicy ?? action.definition.execution.retryPolicy;
            const effectiveJob = retryPolicy === null
                ? job
                : {
                    ...job,
                    maxAttempts: retryPolicy.maxAttempts,
                    payload: { ...job.payload, retryPolicy },
                };
            const publicContext = {
                idempotencyKey: request.context.idempotencyKey,
                signal: controller.signal,
            };
            const fence = action.definition.executionPlacement === "host"
                ? await this.hostFence(job, jobLease, runLease)
                : undefined;
            let terminal: ActivityJobTerminalResult;
            try {
                const output = await raceWithLease(
                    action.definition.executionPlacement === "host" && fence
                        ? this.options.actions.dispatchHost(
                            request.reference,
                            request.input,
                            publicContext,
                            fence,
                        )
                        : this.options.actions.dispatch(
                            request.reference,
                            request.input,
                            publicContext,
                        ),
                    heartbeat.lost,
                    leaseLostError("Activity", job.id),
                    controller.signal,
                );
                if (!isJsonValue(output)) {
                    throw new ActionExecutionError(
                        "malformed_payload",
                        `Action ${request.reference} returned a non-JSON value.`,
                        false,
                    );
                }
                terminal = {
                    status: "succeeded",
                    result: output,
                };
            } catch (error) {
                if (heartbeat.wasLost || isLeaseLostError(error)) throw error;
                // A process shutdown leaves the durable Job for lease-expiry
                // recovery. It is not a user-visible Activity cancellation.
                if (controller.signal.aborted) throw error;
                terminal = this.failureResult(effectiveJob, error, controller.signal);
            }
            const completion = terminal.status === "retry_wait"
                ? undefined
                : this.activityCompletion(job, terminal);
            return await this.complete(jobLease, runLease, terminal, completion);
        } finally {
            if (attempt) {
                this.active.delete(controller);
                this.notifyAttemptFinished(attempt.attemptId);
            }
            await heartbeat.stop();
            await this.options.store.releaseRun({ ...runLease, now: nowFor(this.options) }).catch((error) => {
                workerLogger.warn("workflow_activity_run_release_failed", { error: errorMessage(error) });
            });
        }
    }

    private async hostFence(
        job: WorkflowActivityJobClaim,
        jobLease: ActivityJobLease,
        runLease: WorkflowRunLease,
    ): Promise<HostActionExecutionFence> {
        let kernelRevision: number | undefined = job.kernelRevision;
        if (typeof kernelRevision !== "number"
            || !Number.isSafeInteger(kernelRevision)
            || kernelRevision < 0) {
            const state = await this.options.backend?.loadRun(job.workflowRunId);
            kernelRevision = state?.revision;
        }
        if (typeof kernelRevision !== "number"
            || !Number.isSafeInteger(kernelRevision)
            || kernelRevision < 0) {
            throw new WorkflowHostError(
                "unavailable",
                `Kernel revision is required before executing Activity Job ${job.id}.`,
            );
        }
        return {
            workflowRunId: job.workflowRunId,
            kernelRevision,
            activity: job.payload.activity,
            jobId: job.id,
            attempt: job.attempts,
            jobLeaseToken: jobLease.leaseToken,
            runLeaseToken: runLease.leaseToken,
        };
    }

    private actionRequest(
        job: WorkflowActivityJobClaim,
        signal: AbortSignal,
    ): ActivityExecutionRequest {
        return {
            reference: job.payload.reference,
            input: job.payload.input,
            options: job.payload.options,
            context: {
                runId: job.workflowRunId,
                activity: job.payload.activity,
                idempotencyKey: job.payload.idempotencyKey,
                signal,
            },
        };
    }

    private failureResult(
        job: WorkflowActivityJobClaim,
        error: unknown,
        signal: AbortSignal,
    ): ActivityJobTerminalResult {
        const details = actionErrorDetails(error);
        if (isCancellationError(error, signal)) {
            return {
                status: "cancelled",
                errorCode: "cancelled",
                error: details.message,
            };
        }
        const policy = job.payload.retryPolicy;
        const retryable = details.retryable && isRetryAllowed(policy, details.code);
        const exhausted = job.attempts >= job.maxAttempts;
        if (retryable && !exhausted) {
            return {
                status: "retry_wait",
                errorCode: details.code,
                error: details.message,
                retryDelayMs: this.retryDelay(job, error),
            };
        }

        return {
            status: "failed_terminal",
            errorCode: details.code,
            error: details.message,
        };
    }

    private retryDelay(job: WorkflowActivityJobClaim, error: unknown): number {
        const policyDelay = job.payload.retryPolicy?.backoffMs;
        const configured = this.options.retryDelayMs;
        const delay = policyDelay !== undefined
            ? policyDelay
            : typeof configured === "function"
                ? configured(job, error)
                : configured ?? 1_000;
        const bounded = Math.max(0, Number.isFinite(delay) ? delay : 1_000);
        return Math.min(this.options.maxRetryDelayMs ?? 30_000, bounded);
    }

    private activityCompletion(
        job: WorkflowActivityJobClaim,
        result: ActivityJobTerminalResult,
    ): DeferredActivityCompletionInput {
        return {
            activityKey: job.payload.activity.key,
            receipt: job.id,
            reference: job.payload.reference,
            fingerprint: job.payload.activity.fingerprint,
            status: result.status === "succeeded"
                ? "completed"
                : result.status === "cancelled" ? "cancelled" : "failed",
            ...(result.status === "succeeded" && result.result !== undefined
                ? { result: result.result }
                : {}),
            ...(result.error !== undefined && result.error !== null
                ? { error: result.error }
                : {}),
        };
    }

    private async complete(
        jobLease: ActivityJobLease,
        runLease: WorkflowRunLease,
        result: ActivityJobTerminalResult,
        completion?: DeferredActivityCompletionInput,
    ): Promise<CompleteActivityResult> {
        return this.options.store.completeActivity({
            jobLease,
            runLease,
            result,
            ...(completion === undefined ? {} : { completion }),
            now: nowFor(this.options),
        });
    }

    private notifyAttemptStarted(attempt: WorkflowRuntimeAttempt): void {
        try {
            this.options.onAttemptStarted?.(attempt);
        } catch (error) {
            this.logger.warn("workflow_activity_attempt_start_observer_failed", {
                attemptId: attempt.attemptId,
                error: errorMessage(error),
            });
        }
    }

    private notifyAttemptFinished(attemptId: string): void {
        try {
            this.options.onAttemptFinished?.(attemptId);
        } catch (error) {
            this.logger.warn("workflow_activity_attempt_finish_observer_failed", {
                attemptId,
                error: errorMessage(error),
            });
        }
    }
}
