import { DeferredActivityCompletionConflictError, DeferredActivityLateCompletionError, DeferredActivityNotFoundError, NonJsonValueError, UuidIdGenerator, WorkflowBackendConflictError, WorkflowRunNotFoundError, WorkflowRunner } from "@notnotype/nb-workflow";
import type { ActivityExecutionRequest, AnyWorkflowDefinition, DeferredActivityCompletionInput, DeferredActivityExecutor, DefinitionRegistry, EventSink, EventSinkRequest, IdGenerator, JsonValue, RunView, ValueStore, WorkflowBackend, WorkflowDefinitionReference, WorkflowRunState, WorkflowRunnerOptions as KernelWorkflowRunnerOptions, WorkflowStartOptions } from "@notnotype/nb-workflow";
import type { LoggerPort } from "./logger.js";
import { WorkflowHostError } from "./workflow-host.js";
import type { ActivityJobLease, ActivityJobTerminalResult, CompleteActivityResult, WorkflowActivityJobClaim, WorkflowCompletionClaim, WorkflowEnvelope, WorkflowHostStore, WorkflowRunLease, WorkflowRuntimeAttempt } from "./workflow-host.js";
import type { WorkflowLeaseRuntimeOptions, WorkflowRunnerLike, WorkflowRuntimeDependencies } from "./workflow-host-runtime-types.js";

export const noopLogger: LoggerPort = {
    child: () => noopLogger,
    withContext: (_context, callback) => callback(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

export function loggerFor(logger?: LoggerPort): LoggerPort {
    return logger ?? noopLogger;
}

export function ownerFor(options: WorkflowLeaseRuntimeOptions): string {
    return options.owner ?? options.workerId ?? "workflow-host";
}

export function leaseMsFor(options: WorkflowLeaseRuntimeOptions): number {
    const value = options.leaseMs ?? options.runLeaseMs ?? 30_000;
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError("Workflow leaseMs must be a positive finite number.");
    }
    return value;
}

export function heartbeatMsFor(options: WorkflowLeaseRuntimeOptions, leaseMs: number): number {
    const value = options.heartbeatMs ?? options.heartbeatIntervalMs
        ?? Math.max(1, Math.floor(leaseMs / 3));
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError("Workflow heartbeatMs must be a non-negative finite number.");
    }
    return value;
}

export function nowFor(options: WorkflowLeaseRuntimeOptions): Date {
    return options.now?.() ?? new Date();
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function isLeaseLostError(error: unknown): boolean {
    return error instanceof WorkflowHostError && error.code === "lease_lost";
}

export function leaseLostError(kind: string, id: string, cause?: unknown): WorkflowHostError {
    return new WorkflowHostError(
        "lease_lost",
        `${kind} lease was lost while executing ${id}.`,
        cause === undefined ? undefined : { cause },
    );
}

export function isTerminalRunStatus(status: RunView["status"]): boolean {
    return status === "waiting"
        || status === "completed"
        || status === "failed"
        || status === "cancelled";
}

export function resolveDefinition(
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

export function formatReference(reference: WorkflowDefinitionReference): string {
    return `${reference.key}@${reference.version}#${reference.manifestHash}`;
}

export type LeaseScopedWorkflowBackend = WorkflowBackend & {
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

export function backendForLease(
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

export function initialRunClock(createdAt: string): { now(): Date } {
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

export function defaultRunnerFactory(options: KernelWorkflowRunnerOptions): WorkflowRunnerLike {
    return new WorkflowRunner(undefined, undefined, options);
}

export type LeaseAwareEventSink = EventSink & {
    emitWithLease?: (request: EventSinkRequest, lease: WorkflowRunLease) => Promise<void>;
};

export function eventsForLease(
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

export function createRunner(
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
