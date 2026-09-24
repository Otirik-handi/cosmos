import { randomUUID } from "node:crypto";
import type { JsonValue } from "@notnotype/nb-workflow";

export const WORKFLOW_ENVELOPE_MARKER_KIND = "cosmos.workflow-envelope" as const;

export const WORKFLOW_ENVELOPE_MARKER_VERSION = 1 as const;

export type WorkflowEnvelopeMarker = {
    readonly kind: typeof WORKFLOW_ENVELOPE_MARKER_KIND;
    readonly version: typeof WORKFLOW_ENVELOPE_MARKER_VERSION;
    readonly runId: string;
};

/** Return the JSON sentinel used while a host envelope has no Kernel state. */
export function createWorkflowEnvelopeMarker(runId: string): WorkflowEnvelopeMarker {
    if (runId.length === 0) {
        throw new Error("A workflow envelope marker requires a run ID.");
    }
    return {
        kind: WORKFLOW_ENVELOPE_MARKER_KIND,
        version: WORKFLOW_ENVELOPE_MARKER_VERSION,
        runId,
    };
}

/** Detect only the exact envelope-only marker shape, never marker-shaped user data. */
export function isWorkflowEnvelopeMarker(
    value: unknown,
    runId?: string,
): value is WorkflowEnvelopeMarker {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
        keys.length !== 3
        || !keys.includes("kind")
        || !keys.includes("version")
        || !keys.includes("runId")
        || record.kind !== WORKFLOW_ENVELOPE_MARKER_KIND
        || record.version !== WORKFLOW_ENVELOPE_MARKER_VERSION
        || typeof record.runId !== "string"
        || record.runId.length === 0
    ) {
        return false;
    }
    return runId === undefined || record.runId === runId;
}
