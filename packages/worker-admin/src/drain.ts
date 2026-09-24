import { WorkerAdminRequestError } from "./types.js";
import type { CreateDrainCommand, WorkerAdminLaneConfig, WorkerDrainSnapshot, WorkerLaneStatus } from "./types.js";

export type LaneState = WorkerLaneStatus & {
    activePolls: number;
    pollCount: number;
    claimCount: number;
};

export type DrainRecord = {
    snapshot: WorkerDrainSnapshot;
    reason: string;
    deadlineMs: number | null;
};

export const DEFAULT_LANES: readonly WorkerAdminLaneConfig[] = [{ lane: "direct", configuredSlots: 1 }];

export const MAX_DRAIN_HISTORY = 20;

export const DEFAULT_DRAIN_DEADLINE_MS = 30_000;

export const MAX_DRAIN_DEADLINE_MS = 24 * 60 * 60 * 1_000;

export const MAX_REASON_LENGTH = 200;

export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export function isTerminalDrain(status: WorkerDrainSnapshot["status"]): boolean {
    return status === "succeeded" || status === "timed_out" || status === "failed";
}

export function cloneDrain(snapshot: WorkerDrainSnapshot): WorkerDrainSnapshot {
    return {
        ...snapshot,
        activeAttemptIds: [...snapshot.activeAttemptIds],
        activePollCount: snapshot.activePollCount,
        error: snapshot.error ? { ...snapshot.error } : null,
    };
}

export function parseDrainCommand(body: Record<string, unknown>): CreateDrainCommand {
    const command: CreateDrainCommand = {
        reason: validateReason(body.reason),
    };
    if ("deadlineMs" in body) {
        const deadlineMs = body.deadlineMs;
        if (deadlineMs !== null && typeof deadlineMs !== "number") {
            throw new WorkerAdminRequestError("invalid_request", "deadlineMs must be a number or null.", 400);
        }
        command.deadlineMs = deadlineMs === null ? null : normalizeDeadline(deadlineMs);
    }
    if ("exitAfterDrain" in body) {
        if (body.exitAfterDrain !== true) {
            throw new WorkerAdminRequestError("invalid_request", "exitAfterDrain must be true when provided.", 400);
        }
        command.exitAfterDrain = true;
    }
    return command;
}

export function normalizeDeadline(value: number | null | undefined): number | null {
    if (value === null) return null;
    const deadline = value === undefined ? DEFAULT_DRAIN_DEADLINE_MS : value;
    if (!Number.isSafeInteger(deadline) || deadline < 0 || deadline > MAX_DRAIN_DEADLINE_MS) {
        throw new WorkerAdminRequestError(
            "invalid_request",
            `deadlineMs must be an integer between 0 and ${MAX_DRAIN_DEADLINE_MS}.`,
            400,
        );
    }
    return deadline;
}

export function validateReason(value: unknown): string {
    if (typeof value !== "string") {
        throw new WorkerAdminRequestError("invalid_request", "reason is required.", 400);
    }
    const reason = value.trim();
    if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
        throw new WorkerAdminRequestError(
            "invalid_request",
            `reason must contain 1-${MAX_REASON_LENGTH} characters.`,
            400,
        );
    }
    return reason;
}

export function validateIdempotencyKey(value: string): string {
    const key = value.trim();
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        throw new WorkerAdminRequestError(
            "invalid_request",
            `Idempotency-Key must contain 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
            400,
        );
    }
    return key;
}
