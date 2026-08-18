import type {
    ActivityExecutionRequest,
    ActivityIdentity,
    DeferredActivityCompletionInput,
    DeferredActivityStartResult,
    JsonValue,
    WorkflowDefinitionReference,
} from "@notnotype/nb-workflow";
import type { ActionDefinition, RetryPolicy } from "@cosmos/contracts";
import type { LoggerPort } from "./index.js";

/**
 * Workflow status stored by the host envelope. `waiting` is an internal
 * Kernel state; Product Run DTOs deliberately map it to `running`.
 */
export type WorkflowRunStatus =
    | "queued"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled";

/** Job statuses are shared with the legacy SQL job lane. */
export type WorkflowJobStatus =
    | "queued"
    | "leased"
    | "retry_wait"
    | "succeeded"
    | "failed_terminal"
    | "cancelled";

/** A completion is a durable, single-consumer delivery record. */
export type WorkflowCompletionStatus =
    | "queued"
    | "leased"
    | "delivered"
    | "dead_letter";

export type WorkflowActivityJobKind = "workflow-activity";

/**
 * Action refs are versioned by the Action contract. Keeping this alias here
 * prevents a host payload from accidentally accepting a bare operation ref.
 */
export type WorkflowActionReference = ActionDefinition["ref"];

/**
 * Durable input used to create the host-side envelope. The input snapshot and
 * product projection are immutable inputs to this operation; changing either
 * for an existing idempotency key is a conflict.
 */
export interface CreateWorkflowEnvelopeInput {
    runId: string;
    idempotencyKey?: string | null;
    definition: WorkflowDefinitionReference;
    inputSnapshot: JsonValue;
    productRun: JsonValue;
    sourceId?: string | null;
    createdAt?: string;
}

/**
 * Host-owned run projection. Kernel state is persisted by WorkflowBackend;
 * this record only describes the envelope and its worker/recovery lifecycle.
 */
export interface WorkflowEnvelope {
    runId: string;
    idempotencyKey: string | null;
    definition: WorkflowDefinitionReference;
    inputSnapshot: JsonValue;
    productRun: JsonValue;
    status: WorkflowRunStatus;
    resumeRequired: boolean;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
}

/** The three required fields are the complete fencing identity of a Run. */
export interface WorkflowRunLease {
    runId: string;
    leaseToken: string;
    owner: string;
    /** Optional because a lease token remains the CAS identity. */
    leaseExpiresAt?: string;
}

export type WorkflowRunClaimPurpose = "execution" | "activity" | "completion";

export interface ClaimWorkflowRunInput {
    owner: string;
    leaseMs: number;
    /** Set when a caller is taking over one known Run; omit to scan. */
    runId?: string;
    /** Execution claims recover Kernel runs; auxiliary claims fence Activity delivery. */
    purpose?: WorkflowRunClaimPurpose;
    now?: Date;
}

export interface HeartbeatWorkflowRunInput extends WorkflowRunLease {
    leaseMs: number;
    now?: Date;
}

export interface ReleaseWorkflowRunInput extends WorkflowRunLease {
    now?: Date;
}

/** A narrow Run-lane port suitable for a SQL implementation or fake. */
export interface WorkflowRunLeasePort {
    claimRun(input: ClaimWorkflowRunInput): Promise<WorkflowRunLease | null>;
    heartbeatRun(input: HeartbeatWorkflowRunInput): Promise<boolean>;
    releaseRun(input: ReleaseWorkflowRunInput): Promise<boolean>;
}

/**
 * Payload persisted in Job.payloadJson. It contains the Kernel activity
 * identity and the JSON action request, but never executable Action schemas.
 */
export interface WorkflowActivityJobPayload {
    runId: string;
    activity: ActivityIdentity;
    reference: WorkflowActionReference;
    input: JsonValue;
    options: ActivityExecutionRequest["options"];
    idempotencyKey: string;
    retryPolicy?: RetryPolicy;
}

export interface WorkflowActivityJob {
    id: string;
    workflowRunId: string;
    /** Kernel state revision observed when the Host claimed this Activity. */
    kernelRevision: number;
    kind: WorkflowActivityJobKind;
    status: WorkflowJobStatus;
    payload: WorkflowActivityJobPayload;
    attempts: number;
    maxAttempts: number;
    leaseOwner: string | null;
    leaseToken: string | null;
    leaseExpiresAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface WorkflowActivityJobClaim extends Omit<
    WorkflowActivityJob,
    "status" | "leaseOwner" | "leaseToken"
> {
    status: "leased";
    leaseOwner: string;
    leaseToken: string;
}

/**
 * An in-memory Activity execution visible to Worker Admin. This is deliberately
 * separate from the durable Job attempt: it exposes process liveness only and
 * never carries a lease token.
 */
export interface WorkflowRuntimeAttempt {
    attemptId: string;
    jobId: string;
    runId: string;
    actionRef: string;
    lane: "workflow-activity";
    slot: number;
    startedAt: string;
    leaseExpiresAt: string;
    cancellationRequested: boolean;
}

export interface ClaimActivityJobInput {
    owner: string;
    leaseMs: number;
    now?: Date;
}

export interface HeartbeatActivityJobInput {
    jobId: string;
    leaseToken: string;
    owner: string;
    leaseMs: number;
    now?: Date;
}

export interface ReleaseActivityJobInput {
    jobId: string;
    leaseToken: string;
    owner: string;
    reason?: string | null;
    now?: Date;
}

export interface ActivityJobLease {
    jobId: string;
    leaseToken: string;
    owner: string;
    leaseExpiresAt?: string;
}

/**
 * `retry_wait` is intentionally represented here even though it does not
 * create a WorkflowCompletion. A retrying Job remains durable SQL truth.
 */
export interface ActivityJobTerminalResult {
    status: Extract<
        WorkflowJobStatus,
        "succeeded" | "retry_wait" | "failed_terminal" | "cancelled"
    >;
    result?: JsonValue;
    errorCode?: string | null;
    error?: string | null;
    retryDelayMs?: number;
}

export interface CompleteActivityInput {
    jobLease: ActivityJobLease;
    runLease: WorkflowRunLease;
    result: ActivityJobTerminalResult;
    /** Required for terminal success/failure/cancel; omitted for retry_wait. */
    completion?: DeferredActivityCompletionInput;
    now?: Date;
}

export interface CompleteActivityResult {
    accepted: boolean;
    jobStatus: WorkflowJobStatus;
    completion: WorkflowCompletion | null;
}

/** A narrow Activity-lane port. */
export interface WorkflowActivityJobPort {
    claimActivityJob(
        input: ClaimActivityJobInput,
    ): Promise<WorkflowActivityJobClaim | null>;
    heartbeatActivityJob(input: HeartbeatActivityJobInput): Promise<boolean>;
    releaseActivityJob(input: ReleaseActivityJobInput): Promise<boolean>;
    completeActivity(input: CompleteActivityInput): Promise<CompleteActivityResult>;
}

/** Durable completion JSON plus its delivery/outbox projection. */
export interface WorkflowCompletion {
    id: string;
    workflowRunId: string;
    jobId: string;
    activityKey: string;
    receipt: string;
    reference: WorkflowActionReference;
    fingerprint: string;
    completion: DeferredActivityCompletionInput;
    status: WorkflowCompletionStatus;
    attempts: number;
    maxAttempts: number;
    availableAt: string;
    leaseOwner: string | null;
    leaseToken: string | null;
    leaseExpiresAt: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface WorkflowCompletionClaim extends Omit<
    WorkflowCompletion,
    "status" | "leaseOwner" | "leaseToken"
> {
    status: "leased";
    leaseOwner: string;
    leaseToken: string;
}

export interface ClaimWorkflowCompletionInput {
    owner: string;
    leaseMs: number;
    now?: Date;
}

export interface HeartbeatWorkflowCompletionInput {
    completionId: string;
    leaseToken: string;
    owner: string;
    leaseMs: number;
    now?: Date;
}

export interface DeliverWorkflowCompletionInput {
    completionId: string;
    leaseToken: string;
    owner: string;
    /** Completion delivery is fenced by the current Run lease as well. */
    runLease: WorkflowRunLease;
    now?: Date;
}

export interface RequeueWorkflowCompletionInput {
    completionId: string;
    leaseToken: string;
    owner: string;
    availableAt?: string;
    error?: string | null;
    now?: Date;
}

export interface DeadLetterWorkflowCompletionInput {
    completionId: string;
    leaseToken: string;
    owner: string;
    error: string;
    now?: Date;
}

/** Completion dispatcher port; SQL remains the durable source of truth. */
export interface WorkflowCompletionPort {
    claimWorkflowCompletion(
        input: ClaimWorkflowCompletionInput,
    ): Promise<WorkflowCompletionClaim | null>;
    heartbeatWorkflowCompletion(
        input: HeartbeatWorkflowCompletionInput,
    ): Promise<boolean>;
    deliverWorkflowCompletion(
        input: DeliverWorkflowCompletionInput,
    ): Promise<boolean>;
    requeueWorkflowCompletion(
        input: RequeueWorkflowCompletionInput,
    ): Promise<boolean>;
    deadLetterWorkflowCompletion(
        input: DeadLetterWorkflowCompletionInput,
    ): Promise<boolean>;
}

export interface MarkResumeRequiredInput {
    runLease: WorkflowRunLease;
    reason?: string | null;
    now?: Date;
}

export interface FailWorkflowRunInput {
    runLease: WorkflowRunLease;
    error: string;
    now?: Date;
}

export interface RecoveryRunsInput {
    limit?: number;
}

/**
 * Shared Host contract. Persistence, Action dispatch and Runner orchestration
 * are deliberately separate: this interface only defines durable boundaries.
 */
export interface WorkflowHostStore
    extends WorkflowRunLeasePort,
        WorkflowActivityJobPort,
        WorkflowCompletionPort {
    /** Load the immutable host envelope without exposing marker state to Kernel callers. */
    loadWorkflowEnvelope(runId: string): Promise<WorkflowEnvelope | null>;

    /** True once the Kernel has adopted the envelope and persisted state. */
    hasWorkflowKernelState(runId: string): Promise<boolean>;
    createWorkflowEnvelope(
        input: CreateWorkflowEnvelopeInput,
    ): Promise<WorkflowEnvelope>;
    findWorkflowEnvelopeByIdempotencyKey(
        idempotencyKey: string,
    ): Promise<WorkflowEnvelope | null>;

    /** Idempotent find-or-create by context.idempotencyKey. */
    startAction(request: ActivityExecutionRequest): Promise<DeferredActivityStartResult>;

    /** Atomically terminalize the Activity Job and enqueue its completion. */
    completeActivity(
        input: CompleteActivityInput,
    ): Promise<CompleteActivityResult>;

    /** Set only through the current Run lease; used by crash recovery. */
    markResumeRequired(input: MarkResumeRequiredInput): Promise<boolean>;

    /** Terminalize a non-terminal Run through the current Run lease. */
    failWorkflowRun(input: FailWorkflowRunInput): Promise<boolean>;

    /** Returns envelope-only or Kernel-running Runs needing `rerun()`. */
    listRunsForRecovery(
        input?: RecoveryRunsInput,
    ): Promise<readonly WorkflowEnvelope[]>;
}

export interface WorkflowHostOptions {
    logger?: LoggerPort;
}

export type WorkflowHostErrorCode =
    | "conflict"
    | "not_found"
    | "lease_lost"
    | "invalid_state"
    | "serialization"
    | "unavailable";

export class WorkflowHostError extends Error {
    constructor(
        readonly code: WorkflowHostErrorCode,
        message: string,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = "WorkflowHostError";
    }
}

export class WorkflowHostConflictError extends WorkflowHostError {
    constructor(message: string, options?: { cause?: unknown }) {
        super("conflict", message, options);
        this.name = "WorkflowHostConflictError";
    }
}
