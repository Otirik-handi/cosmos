import { EventEmitter } from "node:events";

export type WorkerMode = "direct" | "gateway";

export type ComponentStatus = "ready" | "degraded" | "unavailable" | "disabled" | "unknown";

export interface FailureSnapshot {
    kind: "aborted" | "retryable" | "terminal" | "unknown";
    code: string | null;
    message: string;
    retryable: boolean;
    occurredAt?: string | null;
    detailsRef?: null;
}

export interface ComponentHealth {
    status: ComponentStatus;
    checkedAt: string;
    code?: string | null;
    message?: string | null;
}

export interface WorkerLaneStatus {
    lane: string;
    enabled: boolean;
    configuredSlots: number;
    acceptingSlots: number;
    activeSlots: number;
    idleSlots: number;
    lastClaimAt: string | null;
    lastPollAt: string | null;
    lastError: FailureSnapshot | null;
}

export interface WorkerActiveAttemptSummary {
    attemptId: string;
    jobId: string;
    runId: string;
    actionRef: string;
    lane: string;
    slot: number;
    startedAt: string;
    leaseExpiresAt: string;
    cancellationRequested: boolean;
}

export interface WorkerLivenessSnapshot {
    status: "alive";
    service: "cosmos-worker";
    workerId: string;
    instanceId: string;
    version: string;
    processStartedAt: string;
    timestamp: string;
}

export interface WorkerReadinessSnapshot {
    ready: boolean;
    workerId: string;
    instanceId: string;
    mode: WorkerMode;
    acceptingWork: boolean;
    draining: boolean;
    components: {
        migration: ComponentHealth;
        taskStore?: ComponentHealth;
        gatewaySession?: ComponentHealth;
        definitionCatalog: ComponentHealth;
        actionRegistry: ComponentHealth;
        connectorRegistry: ComponentHealth;
        valueStore: ComponentHealth;
    };
    checkedAt: string;
}

export interface WorkerStatusSnapshot {
    workerId: string;
    instanceId: string;
    registrationGeneration: number | null;
    version: string;
    mode: WorkerMode;
    status: "starting" | "ready" | "draining" | "stopped" | "degraded";
    processStartedAt: string;
    registeredAt: string | null;
    lastHeartbeatAt: string | null;
    lanes: WorkerLaneStatus[];
    activeAttempts: WorkerActiveAttemptSummary[];
    /** Only explicitly registered runtime Attempts; active polls remain separate. */
    activeAttemptCount: number;
    activePollCount: number;
    recentErrors: FailureSnapshot[];
    drain: WorkerDrainSnapshot | null;
    timestamp: string;
}

export interface WorkerManifestEvidence {
    ref: string;
    manifestHash: {
        algorithm: string;
        value: string;
    };
}

export interface WorkerCapabilitySnapshot {
    workerId: string;
    instanceId: string;
    version: string;
    mode: WorkerMode;
    evidenceVersion: number;
    evidenceAuthority: "local_executable" | "catalog_admitted";
    lanes: string[];
    genericCapabilities: string[];
    workflowEvidence: WorkerManifestEvidence[];
    actionEvidence: (WorkerManifestEvidence & {
        executionPlacements: ("host" | "trusted_worker" | "remote_worker")[];
    })[];
    connectorEvidence: WorkerManifestEvidence[];
    limits: {
        maxConcurrency: number;
        maxInlineValueBytes: number;
        maxJobRuntimeMs: number | null;
    };
    generatedAt: string;
}

export interface WorkerDrainSnapshot {
    id: string;
    workerId: string;
    instanceId: string;
    idempotencyKey: string;
    status: "accepted" | "draining" | "succeeded" | "timed_out" | "failed";
    reason: string;
    activeAttemptIds: string[];
    activePollCount: number;
    acceptedAt: string;
    deadlineAt: string | null;
    finishedAt: string | null;
    exitAfterDrain: true;
    resourcesClosed: boolean;
    error: FailureSnapshot | null;
}

export interface WorkerAdminLaneConfig {
    lane: string;
    configuredSlots?: number;
    enabled?: boolean;
}

export interface WorkerAdminOptions {
    workerId: string;
    instanceId: string;
    version: string;
    mode?: WorkerMode;
    processStartedAt?: string;
    now?: () => Date;
    lanes?: readonly WorkerAdminLaneConfig[];
    health?: () => Promise<Partial<WorkerReadinessSnapshot["components"]>>;
    genericCapabilities?: readonly string[];
    workflowEvidence?: readonly WorkerManifestEvidence[];
    actionEvidence?: readonly (WorkerManifestEvidence & {
        executionPlacements: ("host" | "trusted_worker" | "remote_worker")[];
    })[];
    connectorEvidence?: readonly WorkerManifestEvidence[];
    limits?: Partial<WorkerCapabilitySnapshot["limits"]>;
    onDrain?: (snapshot: WorkerDrainSnapshot) => Promise<void>;
    onDrainTimeout?: (snapshot: WorkerDrainSnapshot) => Promise<void>;
}

export interface CreateDrainCommand {
    reason: string;
    deadlineMs?: number | null;
    exitAfterDrain?: true;
}

export interface DrainDecision {
    snapshot: WorkerDrainSnapshot;
    statusCode: 200 | 202;
}

export class WorkerAdminRequestError extends Error {
    constructor(
        readonly code:
            | "invalid_request"
            | "unauthorized"
            | "not_found"
            | "conflict"
            | "drain_in_progress"
            | "already_stopped"
            | "payload_too_large"
            | "internal_error",
        message: string,
        readonly statusCode: 400 | 401 | 404 | 409 | 413 | 500,
        readonly retryable = false,
    ) {
        super(message);
        this.name = "WorkerAdminRequestError";
    }
}
