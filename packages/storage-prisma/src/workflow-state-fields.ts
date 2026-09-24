import { WorkflowBackendConflictError, WorkflowRunNotFoundError, assertJsonValue, canonicalJson } from "@notnotype/nb-workflow";
import type { BackendCapabilities, JsonValue, WorkflowBackend, WorkflowRunState, WorkflowValue } from "@notnotype/nb-workflow";
import { WorkflowStateIntegrityError } from "./workflow-backend-errors.js";

export type WorkflowRunRow = {
    id: string;
    stateJson: string;
    kernelRevision: number;
    status: string;
    resumeRequired: boolean;
    definitionKey: string;
    definitionVersion: string;
    manifestHash: string;
    createdAt: Date;
    updatedAt: Date;
    finishedAt: Date | null;
};

export function parseDate(value: string, field: string): Date {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
        throw new WorkflowStateIntegrityError(`Invalid ${field} date.`);
    }
    return parsed;
}

export function terminalFinishedAt(state: WorkflowRunState): Date | null {
    return state.status === "completed"
        || state.status === "failed"
        || state.status === "cancelled"
        ? parseDate(state.updatedAt, "updatedAt")
        : null;
}

export function requireString(
    record: Record<string, unknown>,
    key: string,
): string {
    const value = record[key];
    if (typeof value !== "string" || value.length === 0) {
        throw new WorkflowStateIntegrityError(`${key} must be a non-empty string.`);
    }
    return value;
}

export function requireArray(
    record: Record<string, unknown>,
    key: string,
): JsonValue[] {
    const value = record[key];
    if (!Array.isArray(value)) {
        throw new WorkflowStateIntegrityError(`${key} must be an array.`);
    }
    assertJsonValue(value);
    return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
