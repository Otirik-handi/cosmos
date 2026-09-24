import { WorkflowBackendConflictError, WorkflowRunNotFoundError, assertJsonValue, canonicalJson } from "@notnotype/nb-workflow";
import type { BackendCapabilities, JsonValue, WorkflowBackend, WorkflowRunState, WorkflowValue } from "@notnotype/nb-workflow";
import type { Prisma } from "@prisma/client";
import { WorkflowStateIntegrityError } from "./workflow-backend-errors.js";
import { isWorkflowEnvelopeMarker } from "./workflow-envelope-marker.js";
import { isRecord, parseDate, terminalFinishedAt } from "./workflow-state-fields.js";
import { assertProjection, normalizeState } from "./workflow-state-validation.js";
import type { WorkflowRunRow } from "./workflow-state-fields.js";

export function toCreateData(state: WorkflowRunState): Prisma.WorkflowRunCreateInput {
    return {
        id: state.runId,
        stateJson: canonicalJson(state),
        kernelRevision: 0,
        status: state.status,
        resumeRequired: state.resumeRequired === true,
        definitionKey: state.definition.key,
        definitionVersion: state.definition.version,
        manifestHash: state.definition.manifestHash,
        createdAt: parseDate(state.createdAt, "createdAt"),
        updatedAt: parseDate(state.updatedAt, "updatedAt"),
        finishedAt: terminalFinishedAt(state),
    };
}

export function toUpdateData(
    state: WorkflowRunState,
    revision: number,
    existingProductRunJson = "{}",
): Prisma.WorkflowRunUpdateManyMutationInput {
    const data: Prisma.WorkflowRunUpdateManyMutationInput = {
        stateJson: canonicalJson(state),
        kernelRevision: revision,
        status: state.status,
        resumeRequired: state.resumeRequired === true,
        definitionKey: state.definition.key,
        definitionVersion: state.definition.version,
        manifestHash: state.definition.manifestHash,
        updatedAt: parseDate(state.updatedAt, "updatedAt"),
        finishedAt: terminalFinishedAt(state),
        // The product Source projection reads this column for source health
        // lastError; a Kernel-state failure must persist its error text or
        // the failure stays invisible outside the event stream.
        errorMessage: state.error ?? null,
    };
    const productRunJson = completedProductRunJson(state, existingProductRunJson);
    if (productRunJson !== undefined) data.productRunJson = productRunJson;
    return data;
}

export function fromRow(row: WorkflowRunRow): WorkflowRunState {
    let parsed: unknown;
    try {
        parsed = JSON.parse(row.stateJson) as unknown;
    } catch {
        throw new WorkflowStateIntegrityError(
            `Workflow run ${row.id} contains invalid state JSON.`,
        );
    }
    const state = normalizeState(parsed, row.kernelRevision);
    assertProjection(row, state);
    return structuredClone(state);
}

export function completedProductRunJson(
    state: WorkflowRunState,
    existingProductRunJson: string,
): string | undefined {
    if (state.status !== "completed") return undefined;
    const encodedResult = state.result;
    if (!isRecord(encodedResult) || encodedResult.kind !== "inline") return undefined;
    const output = encodedResult.value;
    if (!isRecord(output) || !isBoundedCount(output.itemCount)) return undefined;
    const existingValue = safeJsonParse(existingProductRunJson);
    const existing = isRecord(existingValue) ? existingValue : {};
    return canonicalJson({
        ...existing,
        itemCount: output.itemCount,
        ...(isBoundedCount(output.createdEntryCount) ? { createdEntryCount: output.createdEntryCount } : {}),
        ...(isBoundedCount(output.revisedEntryCount) ? { revisedEntryCount: output.revisedEntryCount } : {}),
    });
}

export function isEnvelopeOnlyRow(row: WorkflowRunRow): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(row.stateJson) as unknown;
    } catch {
        return false;
    }
    return isWorkflowEnvelopeMarker(parsed, row.id);
}

export function safeJsonParse(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}

export function isBoundedCount(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
