import { WorkflowBackendConflictError, WorkflowRunNotFoundError, assertJsonValue, canonicalJson } from "@notnotype/nb-workflow";
import type { BackendCapabilities, JsonValue, WorkflowBackend, WorkflowRunState, WorkflowValue } from "@notnotype/nb-workflow";
import { WorkflowStateIntegrityError } from "./workflow-backend-errors.js";
import { isRecord, parseDate, requireArray, requireString, terminalFinishedAt } from "./workflow-state-fields.js";
import type { WorkflowRunRow } from "./workflow-state-fields.js";

export function normalizeState(
    input: unknown,
    revision: number,
): WorkflowRunState {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new WorkflowStateIntegrityError("Workflow state must be an object.");
    }

    const state = input as Record<string, unknown>;
    const runId = requireString(state, "runId");
    const definitionValue = state.definition;
    if (
        typeof definitionValue !== "object" ||
        definitionValue === null ||
        Array.isArray(definitionValue)
    ) {
        throw new WorkflowStateIntegrityError(`${runId}: definition must be an object.`);
    }
    const definitionRecord = definitionValue as Record<string, unknown>;
    const definition = {
        key: requireString(definitionRecord, "key"),
        version: requireString(definitionRecord, "version"),
        manifestHash: requireString(definitionRecord, "manifestHash"),
    };

    const status = requireString(state, "status");
    if (!["running", "waiting", "completed", "failed", "cancelled"].includes(status)) {
        throw new WorkflowStateIntegrityError(`${runId}: invalid workflow status.`);
    }
    const inputValue = state.input;
    validateWorkflowValue(inputValue, `${runId}.input`);
    const extensionContext = state.extensionContext;
    if (extensionContext === undefined) {
        throw new WorkflowStateIntegrityError(`${runId}: extensionContext is required.`);
    }
    assertJsonValue(extensionContext);
    const cancelRequestedAt = state.cancelRequestedAt;
    if (cancelRequestedAt !== null && typeof cancelRequestedAt !== "string") {
        throw new WorkflowStateIntegrityError(`${runId}: invalid cancelRequestedAt.`);
    }
    const budget = state.budget;
    if (budget !== null) {
        assertJsonValue(budget);
    }
    const checkpoint = state.checkpoint;
    if (checkpoint !== null) {
        validateWorkflowValue(checkpoint, `${runId}.checkpoint`);
    }
    if ("result" in state && state.result !== undefined) {
        validateWorkflowValue(state.result, `${runId}.result`);
    }
    if ("error" in state && state.error !== undefined && typeof state.error !== "string") {
        throw new WorkflowStateIntegrityError(`${runId}: invalid error.`);
    }

    const pendingAsks = requireArray(state, "pendingAsks");
    const pendingWaits = requireArray(state, "pendingWaits");
    const pendingActivities = state.pendingActivities === undefined
        ? []
        : requireArray(state, "pendingActivities");
    const activityCompletions = state.activityCompletions === undefined
        ? []
        : requireArray(state, "activityCompletions");
    const logs = requireArray(state, "logs");
    if (!logs.every((entry) => typeof entry === "string")) {
        throw new WorkflowStateIntegrityError(`${runId}: logs must contain strings.`);
    }
    const progress = state.progress;
    if (progress !== null) {
        assertJsonValue(progress);
    }
    const journal = requireArray(state, "journal");
    const createdAt = requireString(state, "createdAt");
    const updatedAt = requireString(state, "updatedAt");
    parseDate(createdAt, "createdAt");
    parseDate(updatedAt, "updatedAt");

    const normalized = {
        runId,
        definition,
        input: structuredClone(inputValue as WorkflowValue),
        extensionContext: structuredClone(extensionContext),
        status: status as WorkflowRunState["status"],
        resumeRequired: state.resumeRequired === true,
        cancelRequestedAt,
        budget: budget === null ? null : structuredClone(budget),
        checkpoint: checkpoint === null
            ? null
            : structuredClone(checkpoint as WorkflowValue),
        ...(state.result === undefined
            ? {}
            : { result: structuredClone(state.result as WorkflowValue) }),
        ...(state.error === undefined ? {} : { error: state.error as string }),
        pendingAsks: structuredClone(pendingAsks),
        pendingWaits: structuredClone(pendingWaits),
        pendingActivities: structuredClone(pendingActivities),
        activityCompletions: structuredClone(activityCompletions),
        logs: [...(logs as string[])],
        progress: progress === null ? null : structuredClone(progress),
        journal: structuredClone(journal),
        revision,
        createdAt,
        updatedAt,
    } as WorkflowRunState;
    try {
        assertJsonValue(normalized);
    } catch (error) {
        throw new WorkflowStateIntegrityError(
            `${runId}: workflow state is not JSON-safe: ${error instanceof Error ? error.message : "unknown error"}`,
        );
    }
    return normalized;
}

export function validateWorkflowValue(value: unknown, path: string): asserts value is WorkflowValue {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new WorkflowStateIntegrityError(`${path} must be a WorkflowValue.`);
    }
    const valueObject = value as Record<string, unknown>;
    if (valueObject.kind !== "inline" && valueObject.kind !== "ref") {
        throw new WorkflowStateIntegrityError(`${path} must be a WorkflowValue.`);
    }
    if (valueObject.kind === "inline") {
        assertJsonValue(valueObject.value);
        return;
    }
    const ref = valueObject.ref;
    if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
        throw new WorkflowStateIntegrityError(`${path}.ref must be an object.`);
    }
    const refObject = ref as Record<string, unknown>;
    const byteSize = refObject.byteSize;
    if (
        typeof refObject.key !== "string" ||
        typeof refObject.hash !== "string" ||
        typeof byteSize !== "number" ||
        !Number.isSafeInteger(byteSize) ||
        byteSize < 0 ||
        refObject.mediaType !== "application/json"
    ) {
        throw new WorkflowStateIntegrityError(`${path}.ref is invalid.`);
    }
}

export function assertImmutableRunFields(
    current: WorkflowRunState,
    next: WorkflowRunState,
): void {
    const currentIdentity = canonicalJson({
        runId: current.runId,
        definition: current.definition,
        input: current.input,
        extensionContext: current.extensionContext,
        createdAt: current.createdAt,
    });
    const nextIdentity = canonicalJson({
        runId: next.runId,
        definition: next.definition,
        input: next.input,
        extensionContext: next.extensionContext,
        createdAt: next.createdAt,
    });
    if (currentIdentity !== nextIdentity) {
        throw new WorkflowStateIntegrityError(
            `Workflow run immutable fields changed: ${current.runId}`,
        );
    }
}

export function assertProjection(row: WorkflowRunRow, state: WorkflowRunState): void {
    const expectedFinishedAt = terminalFinishedAt(state);
    if (
        row.id !== state.runId
        || row.kernelRevision !== state.revision
        || row.status !== state.status
        || row.resumeRequired !== (state.resumeRequired === true)
        || row.definitionKey !== state.definition.key
        || row.definitionVersion !== state.definition.version
        || row.manifestHash !== state.definition.manifestHash
        || row.createdAt.toISOString() !== state.createdAt
        || row.updatedAt.toISOString() !== state.updatedAt
        || (state.status !== "completed"
            && state.status !== "failed"
            && state.status !== "cancelled"
            ? row.finishedAt !== null
            : row.finishedAt !== null
                && row.finishedAt.toISOString() !== expectedFinishedAt?.toISOString())
    ) {
        throw new WorkflowStateIntegrityError(
            `Workflow run ${row.id} projection does not match its state.`,
        );
    }
}
