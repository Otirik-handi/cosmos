import { type RetryPolicy } from "@cosmos/contracts";
import { PrismaClient, type Prisma } from "@prisma/client";
import { assertJsonValue, canonicalJson, fingerprint, type JsonValue } from "@notnotype/nb-workflow";
import { WorkflowHostError, type LoggerPort } from "@cosmos/application";

export const ACTIVITY_KIND = "workflow-activity" as const;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_COMPLETION_MAX_ATTEMPTS = 5;
export const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"] as const;
export const RECOVERABLE_RUN_STATUSES = ["running", "waiting"] as const;
export const VALID_RUN_STATUSES = [
    "queued",
    "running",
    "waiting",
    "completed",
    "failed",
    "cancelled",
] as const;
export const VALID_JOB_STATUSES = [
    "queued",
    "leased",
    "retry_wait",
    "succeeded",
    "failed_terminal",
    "cancelled",
] as const;
export const VALID_COMPLETION_STATUSES = [
    "queued",
    "leased",
    "delivered",
    "dead_letter",
] as const;

/**
 * Prisma implementation of the durable Host boundary.
 *
 * The legacy `Run`/`Job` lane remains owned by PrismaCosmosRepository. This
 * class only touches `WorkflowRun` rows and Jobs explicitly attached to one
 * such row (`kind = workflow-activity`). Every state transition is guarded by
 * the relevant lease token, owner and current status in the same transaction.
 */
export type PrismaOptions = {
    prisma: PrismaClient;
    logger?: LoggerPort;
    actionRetryPolicies?: Readonly<Record<string, RetryPolicy>>;
};

export type WorkflowRunRow = {
    id: string;
    stateJson: string;
    kernelRevision: number;
    status: string;
    resumeRequired: boolean;
    sourceInstanceId: string | null;
    errorMessage: string | null;
    definitionKey: string;
    definitionVersion: string;
    manifestHash: string;
    idempotencyKey: string | null;
    inputSnapshotJson: string;
    productRunJson: string;
    runLeaseOwner: string | null;
    runLeaseToken: string | null;
    runLeaseExpiresAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};
export type ActivityJobRow = {
    id: string;
    runId: string | null;
    stepId: string | null;
    workflowRunId: string | null;
    workflowKernelRevision: number | null;
    kind: string;
    status: string;
    payloadJson: string | null;
    resultJson: string | null;
    idempotencyKey: string;
    attempts: number;
    maxAttempts: number;
    leaseOwner: string | null;
    leaseToken: string | null;
    leaseExpiresAt: Date | null;
    nextAttemptAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
};

export type WorkflowCompletionRow = {
    id: string;
    workflowRunId: string;
    jobId: string;
    activityKey: string;
    receipt: string;
    reference: string;
    fingerprint: string;
    completionJson: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    availableAt: Date;
    leaseOwner: string | null;
    leaseToken: string | null;
    leaseExpiresAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
};

export function isTerminalRunStatus(status: string): boolean {
    return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export function encodeJson(value: unknown, label: string): string {
    try {
        assertJsonValue(value);
        return canonicalJson(value);
    } catch (error) {
        throw serializationError(`${label} is not JSON-safe.`, error);
    }
}

export function decodeJson(value: string, label: string): JsonValue {
    const parsed = parseJson(value, label);
    try {
        assertJsonValue(parsed);
    } catch (error) {
        throw serializationError(`${label} is not a JSON value.`, error);
    }
    return structuredClone(parsed);
}

export function parseJson(value: string, label: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch (error) {
        throw serializationError(`${label} contains invalid JSON.`, error);
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireNonEmptyString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw invalidState(`${label} must be a non-empty string.`);
    }
    return value;
}

export function parseIsoDate(value: string, label: string): Date {
    if (typeof value !== "string") {
        throw invalidState(`${label} must be an ISO date string.`);
    }
    const date = new Date(value);
    assertValidDate(date, label);
    return date;
}

export function assertValidDate(value: Date, label: string): void {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw invalidState(`${label} must be a valid date.`);
    }
}

export function validateLeaseMs(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw invalidState("leaseMs must be a positive integer.");
    }
}

export function normalizeRetryDelay(value: number | undefined): number {
    const delay = value ?? 30_000;
    if (!Number.isSafeInteger(delay) || delay < 0) {
        throw invalidState("retryDelayMs must be a non-negative integer.");
    }
    return delay;
}

export function completionBackoffMs(attempt: number): number {
    const safeAttempt = Math.max(1, Math.min(10, Math.floor(attempt)));
    return Math.min(30_000, 1_000 * (2 ** (safeAttempt - 1)));
}

export function invalidState(message: string): WorkflowHostError {
    return new WorkflowHostError("invalid_state", message);
}

export function serializationError(message: string, cause?: unknown): WorkflowHostError {
    return new WorkflowHostError("serialization", message, cause === undefined ? undefined : { cause });
}

export function isUniqueConstraintError(error: unknown): boolean {
    return isRecord(error) && error.code === "P2002";
}
