import {
    DeferredActivityCompletionConflictError,
    DeferredActivityLateCompletionError,
    DeferredActivityNotFoundError,
    NonJsonValueError,
    UuidIdGenerator,
    WorkflowBackendConflictError,
    WorkflowRunNotFoundError,
    WorkflowRunner,
    type ActivityExecutionRequest,
    type AnyWorkflowDefinition,
    type DefinitionRegistry,
    type DeferredActivityCompletionInput,
    type DeferredActivityExecutor,
    type EventSink,
    type EventSinkRequest,
    type IdGenerator,
    type JsonValue,
    type RunView,
    type ValueStore,
    type WorkflowBackend,
    type WorkflowDefinitionReference,
    type WorkflowRunState,
    type WorkflowRunnerOptions as KernelWorkflowRunnerOptions,
    type WorkflowStartOptions,
} from "@notnotype/nb-workflow";
import type { RetryPolicy } from "@cosmos/contracts";
import { ActionExecutionError, ActionRegistry } from "./action.js";
import type { HostActionExecutionFence } from "./action.js";
import type { LoggerPort } from "./index.js";
import {
    WorkflowHostError,
    type ActivityJobLease,
    type ActivityJobTerminalResult,
    type CompleteActivityResult,
    type WorkflowActivityJobClaim,
    type WorkflowCompletionClaim,
    type WorkflowEnvelope,
    type WorkflowHostStore,
    type WorkflowRunLease,
    type WorkflowRuntimeAttempt,
} from "./workflow-host.js";

/**
 * The small part of WorkflowRunner used by the host lanes. Keeping this as a
 * structural type makes each lane straightforward to exercise with a fake,
 * without replacing the real Kernel in production.
 */
export interface WorkflowRunnerLike {
    begin(
        definition: AnyWorkflowDefinition,
        args: JsonValue,
        options?: WorkflowStartOptions,
    ): { runId: string; done: Promise<RunView> };
    rerun(runId: string): Promise<RunView>;
    completeActivity(
        runId: string,
        completion: DeferredActivityCompletionInput,
    ): Promise<RunView>;
}

/** Factory seam used by focused host tests and by alternate Kernel adapters. */
export type WorkflowRunnerFactory = (
    options: KernelWorkflowRunnerOptions,
) => WorkflowRunnerLike;

/** WorkflowHostStore exposes its envelope probes as required durable ports. */

export interface WorkflowRuntimeDependencies {
    store: WorkflowHostStore;
    /** Required by the default Runner; omitted only when a fake runner is injected. */
    backend?: WorkflowBackend;
    /** Required by the default Runner; omitted only when a fake runner is injected. */
    deferredActivities?: DeferredActivityExecutor;
    /** Required by the real Kernel for rerun; optional only for fake runners. */
    definitions?: DefinitionRegistry;
    /** Required by the real Kernel for Workflow values. */
    values?: ValueStore;
    events?: EventSink;
    /** Completion dispatch does not create a Run, so it may use a supplied generator. */
    ids?: IdGenerator;
    /** Resolve the executable definition for a durable envelope. */
    resolveDefinition?: (
        reference: WorkflowDefinitionReference,
    ) => AnyWorkflowDefinition;
    runnerFactory?: WorkflowRunnerFactory;
    now?: () => Date;
}
export interface WorkflowLeaseRuntimeOptions {
    /** Stable process/worker identity used by every lease operation. */
    owner?: string;
    workerId?: string;
    /** Lease duration in milliseconds. */
    leaseMs?: number;
    /** Alias accepted by worker composition code. */
    runLeaseMs?: number;
    /** Heartbeat period. Defaults to roughly one third of leaseMs. */
    heartbeatMs?: number;
    /** Alias accepted by worker composition code. */
    heartbeatIntervalMs?: number;
    logger?: LoggerPort;
    now?: () => Date;
}

export interface WorkflowRunLaneOptions
    extends WorkflowRuntimeDependencies,
        WorkflowLeaseRuntimeOptions {}

export interface WorkflowActivityWorkerOptions
    extends WorkflowRuntimeDependencies,
        WorkflowLeaseRuntimeOptions {
    actions: ActionRegistry;
    /** Base delay used when a retryable action reaches retry_wait. */
    retryDelayMs?: number | ((job: WorkflowActivityJobClaim, error: unknown) => number);
    maxRetryDelayMs?: number;
    /** Worker-owned runtime visibility; failures here must not change the Job outcome. */
    onAttemptStarted?: (attempt: WorkflowRuntimeAttempt) => void;
    onAttemptFinished?: (attemptId: string) => void;
}

export interface WorkflowCompletionDispatcherOptions
    extends WorkflowRuntimeDependencies,
        WorkflowLeaseRuntimeOptions {
    /** Base completion retry delay; attempts apply exponential backoff. */
    completionRetryDelayMs?: number | ((completion: WorkflowCompletionClaim, error: unknown) => number);
    maxCompletionRetryDelayMs?: number;
    /** Maximum delivery attempts before deterministic dead-lettering. */
    maxCompletionAttempts?: number;
}

export type WorkflowRunLaneResult = RunView | null;
export type WorkflowActivityWorkerResult = CompleteActivityResult | null;
export type WorkflowCompletionDispatcherResult = RunView | null;

/** An IdGenerator that makes the first Kernel begin() use the host Run id. */
export class FixedRunIdGenerator implements IdGenerator {
    private readonly delegate: IdGenerator;

    constructor(
        private readonly runId: string,
        delegate: IdGenerator = new UuidIdGenerator(),
    ) {
        this.delegate = delegate;
    }

    nextId(scope: "run" | "event" | "value"): string {
        return scope === "run" ? this.runId : this.delegate.nextId(scope);
    }
}

const noopLogger: LoggerPort = {
    child: () => noopLogger,
    withContext: (_context, callback) => callback(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

function loggerFor(logger?: LoggerPort): LoggerPort {
    return logger ?? noopLogger;
}

function ownerFor(options: WorkflowLeaseRuntimeOptions): string {
    return options.owner ?? options.workerId ?? "workflow-host";
}

function leaseMsFor(options: WorkflowLeaseRuntimeOptions): number {
    const value = options.leaseMs ?? options.runLeaseMs ?? 30_000;
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError("Workflow leaseMs must be a positive finite number.");
    }
    return value;
}

function heartbeatMsFor(options: WorkflowLeaseRuntimeOptions, leaseMs: number): number {
    const value = options.heartbeatMs ?? options.heartbeatIntervalMs
        ?? Math.max(1, Math.floor(leaseMs / 3));
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError("Workflow heartbeatMs must be a non-negative finite number.");
    }
    return value;
}

function nowFor(options: WorkflowLeaseRuntimeOptions): Date {
    return options.now?.() ?? new Date();
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isLeaseLostError(error: unknown): boolean {
    return error instanceof WorkflowHostError && error.code === "lease_lost";
}

function leaseLostError(kind: string, id: string, cause?: unknown): WorkflowHostError {
    return new WorkflowHostError(
        "lease_lost",
        `${kind} lease was lost while executing ${id}.`,
        cause === undefined ? undefined : { cause },
    );
}

function isTerminalRunStatus(status: RunView["status"]): boolean {
    return status === "waiting"
        || status === "completed"
        || status === "failed"
        || status === "cancelled";
}

function resolveDefinition(
    options: WorkflowRuntimeDependencies,
    envelope: WorkflowEnvelope,
): AnyWorkflowDefinition {
    if (options.resolveDefinition) {
        return options.resolveDefinition(envelope.definition);
    }
    if (options.definitions) {
        return options.definitions.resolve(envelope.definition);
    }
    throw new WorkflowHostError(
        "unavailable",
        `No workflow definition resolver is configured for ${formatReference(envelope.definition)}.`,
    );
}

function formatReference(reference: WorkflowDefinitionReference): string {
    return `${reference.key}@${reference.version}#${reference.manifestHash}`;
}

type LeaseScopedWorkflowBackend = WorkflowBackend & {
    createRunWithLease?: (
        initial: WorkflowRunState,
        lease: WorkflowRunLease,
        now?: Date,
    ) => Promise<WorkflowRunState>;
    saveRunWithLease?: (
        next: WorkflowRunState,
        expectedRevision: number,
        lease: WorkflowRunLease,
        now?: Date,
    ) => Promise<WorkflowRunState>;
};

function backendForLease(
    backend: WorkflowBackend | undefined,
    lease: WorkflowRunLease | undefined,
    now?: () => Date,
): WorkflowBackend | undefined {
    if (!backend || !lease) return backend;
    const candidate = backend as LeaseScopedWorkflowBackend;
    if (!candidate.createRunWithLease && !candidate.saveRunWithLease) return backend;
    return {
        capabilities: backend.capabilities,
        createRun: (initial) => candidate.createRunWithLease
            ? candidate.createRunWithLease(initial, lease, now?.() ?? new Date())
            : backend.createRun(initial),
        loadRun: (runId) => backend.loadRun(runId),
        listRuns: () => backend.listRuns(),
        saveRun: (next, expectedRevision) => candidate.saveRunWithLease
            ? candidate.saveRunWithLease(next, expectedRevision, lease, now?.() ?? new Date())
            : backend.saveRun(next, expectedRevision),
    };
}

function initialRunClock(createdAt: string): { now(): Date } {
    let first = true;
    return {
        now: () => {
            if (first) {
                first = false;
                return new Date(createdAt);
            }
            return new Date();
        },
    };
}

function defaultRunnerFactory(options: KernelWorkflowRunnerOptions): WorkflowRunnerLike {
    return new WorkflowRunner(undefined, undefined, options);
}

type LeaseAwareEventSink = EventSink & {
    emitWithLease?: (request: EventSinkRequest, lease: WorkflowRunLease) => Promise<void>;
};

function eventsForLease(
    events: EventSink | undefined,
    lease: WorkflowRunLease | undefined,
): EventSink | undefined {
    if (!events || !lease) return events;
    const candidate = events as LeaseAwareEventSink;
    if (!candidate.emitWithLease) return events;
    return {
        emit: (request) => candidate.emitWithLease!(request, lease),
    };
}

function createRunner(
    options: WorkflowRuntimeDependencies,
    ids: IdGenerator,
    lease?: WorkflowRunLease,
    initialCreatedAt?: string,
): WorkflowRunnerLike {
    if (!options.runnerFactory && (!options.backend || !options.definitions || !options.values)) {
        throw new WorkflowHostError(
            "unavailable",
            "The production WorkflowRunner requires a Backend, DefinitionRegistry and ValueStore.",
        );
    }
    const deferredActivities = options.deferredActivities ?? {
        startAction: (request: ActivityExecutionRequest) => options.store.startAction(request),
    };
    const runnerOptions: KernelWorkflowRunnerOptions = {
        backend: backendForLease(options.backend, lease, options.now),
        definitions: options.definitions,
        deferredActivities,
        events: eventsForLease(options.events, lease),
        values: options.values,
        ids,
        ...(initialCreatedAt === undefined ? {} : { clock: initialRunClock(initialCreatedAt) }),
    };
    return (options.runnerFactory ?? defaultRunnerFactory)(runnerOptions);
}

/**
 * Run lane: claims one durable Run, executes begin/rerun under its fence, and
 * releases the fence when Kernel execution reaches waiting or a terminal state.
 */
export class WorkflowRunLane {
    private readonly store: WorkflowHostStore;
    private readonly owner: string;
    private readonly leaseMs: number;
    private readonly heartbeatMs: number;
    private readonly logger: LoggerPort;
    private readonly active = new Map<AbortController, { runId: string; runner?: WorkflowRunnerLike }>();

    constructor(private readonly options: WorkflowRunLaneOptions) {
        this.store = options.store;
        this.owner = ownerFor(options);
        this.leaseMs = leaseMsFor(options);
        this.heartbeatMs = heartbeatMsFor(options, this.leaseMs);
        this.logger = loggerFor(options.logger);
    }

    abortActive(reason: unknown): void {
        for (const [controller, active] of this.active) {
            if (controller.signal.aborted) continue;
            controller.abort(reason);
            abortRunner(active.runner, active.runId, controller.signal, this.logger);
        }
    }

    async pollOnce(input: { runId?: string } = {}): Promise<WorkflowRunLaneResult> {
        const lease = await this.store.claimRun({
            owner: this.owner,
            leaseMs: this.leaseMs,
            purpose: "execution",
            ...(input.runId === undefined ? {} : { runId: input.runId }),
            now: nowFor(this.options),
        });
        if (!lease) return null;

        const runLogger = this.logger.child({ runId: lease.runId });
        const controller = new AbortController();
        const active = { runId: lease.runId } as { runId: string; runner?: WorkflowRunnerLike };
        this.active.set(controller, active);
        let runner: WorkflowRunnerLike | undefined;
        const heartbeat = createHeartbeat(
            this.heartbeatMs,
            async () => this.store.heartbeatRun({
                ...lease,
                leaseMs: this.leaseMs,
                now: nowFor(this.options),
            }),
            () => {
                controller.abort(leaseLostError("Run", lease.runId));
                abortRunner(runner, lease.runId, controller.signal, runLogger);
            },
        );
        try {
            const envelope = await this.loadEnvelope(lease.runId);
            const definition = resolveDefinition(this.options, envelope);
            runner = createRunner(
                this.options,
                new FixedRunIdGenerator(lease.runId),
                lease,
                envelope.createdAt,
            );
            active.runner = runner;
            const hasKernelState = await this.store.hasWorkflowKernelState(lease.runId);
            const execution = !hasKernelState
                ? this.begin(runner, definition, envelope, controller.signal)
                : this.rerun(runner, lease.runId, controller.signal);
            const view = await raceWithLease(
                execution,
                heartbeat.lost,
                leaseLostError("Run", lease.runId),
                controller.signal,
            );
            if (isTerminalRunStatus(view.status)) {
                runLogger.debug("workflow_run_execution_finished", { status: view.status });
            }
            return view;
        } catch (error) {
            if (heartbeat.wasLost || isLeaseLostError(error)) {
                runLogger.warn("workflow_run_lease_lost", { error: errorMessage(error) });
            } else if (controller.signal.aborted) {
                runLogger.info("workflow_run_shutdown_aborted", { error: errorMessage(error) });
            }
            throw error;
        } finally {
            this.active.delete(controller);
            await heartbeat.stop();
            await this.store.releaseRun({ ...lease, now: nowFor(this.options) }).catch((error) => {
                runLogger.warn("workflow_run_release_failed", { error: errorMessage(error) });
            });
        }
    }

    private async loadEnvelope(runId: string): Promise<WorkflowEnvelope> {
        const envelope = await this.store.loadWorkflowEnvelope(runId);
        if (!envelope) {
            throw new WorkflowHostError(
                "not_found",
                `Workflow envelope ${runId} was not found after its Run lease was claimed.`,
            );
        }
        return envelope;
    }

    private begin(
        runner: WorkflowRunnerLike,
        definition: AnyWorkflowDefinition,
        envelope: WorkflowEnvelope,
        signal: AbortSignal,
    ): Promise<RunView> {
        const started = runner.begin(definition, envelope.inputSnapshot, { signal });
        return started.done;
    }

    private rerun(
        runner: WorkflowRunnerLike,
        runId: string,
        _signal: AbortSignal,
    ): Promise<RunView> {
        return runner.rerun(runId);
    }
}

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

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (typeof value !== "object") {
        return false;
    }
    return Object.values(value).every(isJsonValue);
}

function actionErrorDetails(error: unknown): {
    code: string | null;
    message: string;
    retryable: boolean;
} {
    if (error instanceof ActionExecutionError) {
        return {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
        };
    }
    if (typeof error === "object" && error !== null) {
        const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown };
        return {
            code: typeof candidate.code === "string" ? candidate.code : null,
            message: typeof candidate.message === "string" ? candidate.message : String(error),
            retryable: candidate.retryable === true,
        };
    }
    return { code: null, message: String(error), retryable: false };
}

function isCancellationError(error: unknown, signal: AbortSignal): boolean {
    if (signal.aborted) return true;
    if (typeof error !== "object" || error === null) return false;
    const candidate = error as { name?: unknown; code?: unknown };
    return candidate.name === "AbortError" || candidate.code === "ABORT_ERR"
        || candidate.code === "cancelled";
}

function isRetryAllowed(policy: RetryPolicy | undefined, code: string | null): boolean {
    const allowed = policy?.retryableErrors;
    return allowed === undefined || (code !== null && allowed.some((candidate) => candidate === code));
}

function isKernelTerminalError(error: unknown): boolean {
    if (error instanceof DeferredActivityCompletionConflictError
        || error instanceof DeferredActivityLateCompletionError
        || error instanceof DeferredActivityNotFoundError
        || error instanceof WorkflowRunNotFoundError
        || error instanceof NonJsonValueError) {
        return true;
    }
    if (error instanceof WorkflowBackendConflictError) return false;
    if (error instanceof WorkflowHostError) {
        return error.code === "conflict"
            || error.code === "not_found"
            || error.code === "serialization"
            || error.code === "invalid_state";
    }
    if (error instanceof TypeError || error instanceof SyntaxError) return true;
    if (typeof error === "object" && error !== null) {
        const candidate = error as { name?: unknown; code?: unknown };
        if (candidate.name === "ZodError" || candidate.name === "ValidationError") return true;
        if (typeof candidate.code === "string") {
            return candidate.code === "validation_error"
                || candidate.code === "invalid_input"
                || candidate.code === "invalid_state"
                || candidate.code.startsWith("invalid_");
        }
    }
    return false;
}

interface HeartbeatHandle {
    readonly lost: Promise<void>;
    readonly wasLost: boolean;
    stop(): Promise<void>;
}

function createHeartbeat(
    intervalMs: number,
    heartbeat: () => Promise<boolean>,
    onLost: (error?: unknown) => void,
): HeartbeatHandle {
    return createCombinedHeartbeat(intervalMs, [heartbeat], onLost);
}

function createCombinedHeartbeat(
    intervalMs: number,
    heartbeats: readonly (() => Promise<boolean>)[],
    onLost: (error?: unknown) => void,
): HeartbeatHandle {
    let stopped = false;
    let lost = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const inFlight = new Set<Promise<void>>();
    let lose: (() => void) | undefined;
    const lostPromise = new Promise<void>((resolve) => {
        lose = resolve;
    });

    const beat = (): void => {
        if (stopped || lost) return;
        const pending = Promise.all(heartbeats.map((heartbeat) => heartbeat()))
            .then((results) => {
                if (stopped || lost) return;
                if (results.some((result) => !result)) {
                    lost = true;
                    onLost();
                    lose?.();
                }
            })
            .catch((error: unknown) => {
                if (stopped || lost) return;
                lost = true;
                onLost(error);
                lose?.();
            })
            .finally(() => {
                inFlight.delete(pending);
            });
        inFlight.add(pending);
    };

    if (intervalMs > 0) {
        timer = setInterval(beat, intervalMs);
        const maybeUnref = timer as unknown as { unref?: () => void };
        maybeUnref.unref?.();
    }

    return {
        get wasLost() {
            return lost;
        },
        lost: lostPromise,
        async stop(): Promise<void> {
            stopped = true;
            clearInterval(timer);
            await Promise.allSettled([...inFlight]);
        },
    };
}

async function raceWithLease<T>(
    execution: Promise<T>,
    leaseLost: Promise<void>,
    error: WorkflowHostError,
    signal?: AbortSignal,
): Promise<T> {
    // A runner may not observe AbortSignal (rerun() in Kernel 0.2.0 has no
    // signal parameter), so the lane must stop waiting as soon as a lease or
    // process shutdown is known stale. A rejection handler prevents a late
    // runner error from becoming an unhandled rejection after the race settles.
    execution.catch(() => undefined);
    const aborted = signal === undefined
        ? new Promise<never>(() => undefined)
        : new Promise<never>((_, reject) => {
            if (signal.aborted) {
                reject(signal.reason ?? new Error("Workflow runtime aborted."));
                return;
            }
            signal.addEventListener("abort", () => {
                reject(signal.reason ?? new Error("Workflow runtime aborted."));
            }, { once: true });
        });
    return Promise.race([
        execution,
        leaseLost.then(() => {
            throw error;
        }),
        aborted,
    ]);
}

function abortRunner(
    runner: WorkflowRunnerLike | undefined,
    runId: string,
    signal: AbortSignal,
    logger: LoggerPort,
): void {
    if (!runner) return;
    const candidate = runner as unknown as {
        abort?: (runId: string, signal?: AbortSignal) => void | Promise<void>;
        stop?: (runId: string, signal?: AbortSignal) => void | Promise<void>;
        interrupt?: (runId: string, signal?: AbortSignal) => void | Promise<void>;
    };
    const stopper = candidate.abort ?? candidate.stop ?? candidate.interrupt;
    if (!stopper) return;
    Promise.resolve(stopper.call(runner, runId, signal)).catch((error) => {
        logger.warn("workflow_runner_abort_failed", { runId, error: errorMessage(error) });
    });
}
