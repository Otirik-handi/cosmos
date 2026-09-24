import { UuidIdGenerator } from "@notnotype/nb-workflow";
import type { ActivityExecutionRequest, AnyWorkflowDefinition, DeferredActivityCompletionInput, DeferredActivityExecutor, DefinitionRegistry, EventSink, EventSinkRequest, IdGenerator, JsonValue, RunView, ValueStore, WorkflowBackend, WorkflowDefinitionReference, WorkflowRunState, WorkflowRunnerOptions as KernelWorkflowRunnerOptions, WorkflowStartOptions } from "@notnotype/nb-workflow";
import { ActionRegistry } from "./action.js";
import type { LoggerPort } from "./logger.js";
import { WorkflowHostError } from "./workflow-host.js";
import type { ActivityJobLease, ActivityJobTerminalResult, CompleteActivityResult, WorkflowActivityJobClaim, WorkflowCompletionClaim, WorkflowEnvelope, WorkflowHostStore, WorkflowRunLease, WorkflowRuntimeAttempt } from "./workflow-host.js";

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
