import { retryPolicySchema } from "@cosmos/contracts";
import { PrismaClient } from "@prisma/client";
import { assertJsonValue, canonicalJson, fingerprint, type ActivityExecutionRequest, type ActivityIdentity, type DeferredActivityCompletionInput, type DeferredActivityStartResult, type JsonValue, type WorkflowDefinitionReference } from "@notnotype/nb-workflow";
import { WorkflowHostConflictError, type ActivityJobLease, type ActivityJobTerminalResult, type CompleteActivityResult, type CreateWorkflowEnvelopeInput, type WorkflowActivityJobClaim, type WorkflowActivityJobPayload, type WorkflowCompletion, type WorkflowEnvelope, type WorkflowJobStatus, type WorkflowRunLease, type WorkflowRunStatus } from "@cosmos/application";
import { isWorkflowEnvelopeMarker } from "../workflow-backend.js";
import { ACTIVITY_KIND, type ActivityJobRow, type PrismaOptions, VALID_COMPLETION_STATUSES, VALID_JOB_STATUSES, VALID_RUN_STATUSES, type WorkflowCompletionRow, type WorkflowRunRow, decodeJson, invalidState, isRecord, normalizeRetryDelay, parseIsoDate, parseJson, requireNonEmptyString, serializationError } from "./internals-core.js";

export function isPrismaOptions(
    input: PrismaClient | PrismaOptions,
): input is PrismaOptions {
    return typeof input === "object" && input !== null && "prisma" in input;
}

export function normalizeEnvelopeInput(input: CreateWorkflowEnvelopeInput): {
    runId: string;
    idempotencyKey: string | null;
    definition: WorkflowDefinitionReference;
    inputSnapshot: JsonValue;
    productRun: JsonValue;
    sourceId: string | null;
    createdAt: Date;
} {
    if (!input || typeof input !== "object") {
        throw invalidState("Workflow envelope input must be an object.");
    }
    const runId = requireNonEmptyString(input.runId, "runId");
    const idempotencyKey = input.idempotencyKey == null
        ? null
        : requireNonEmptyString(input.idempotencyKey, "idempotencyKey");
    const sourceId = input.sourceId == null
        ? null
        : requireNonEmptyString(input.sourceId, "sourceId");
    const definition = normalizeDefinition(input.definition);
    assertJsonValue(input.inputSnapshot);
    assertJsonValue(input.productRun);
    const createdAt = input.createdAt === undefined
        ? new Date()
        : parseIsoDate(input.createdAt, "createdAt");
    return {
        runId,
        idempotencyKey,
        definition,
        inputSnapshot: structuredClone(input.inputSnapshot),
        productRun: structuredClone(input.productRun),
        sourceId,
        createdAt,
    };
}

export function normalizeDefinition(
    definition: WorkflowDefinitionReference,
): WorkflowDefinitionReference {
    if (!definition || typeof definition !== "object") {
        throw invalidState("Workflow definition must be an object.");
    }
    return {
        key: requireNonEmptyString(definition.key, "definition.key"),
        version: requireNonEmptyString(definition.version, "definition.version"),
        manifestHash: requireNonEmptyString(
            definition.manifestHash,
            "definition.manifestHash",
        ),
    };
}

export function normalizeActivityRequest(request: ActivityExecutionRequest): {
    runId: string;
    activity: ActivityIdentity;
    reference: string;
    fingerprint: string;
    input: JsonValue;
    options: ActivityExecutionRequest["options"];
    idempotencyKey: string;
} {
    if (!request || typeof request !== "object") {
        throw invalidState("Activity request must be an object.");
    }
    if (!request.context || typeof request.context !== "object") {
        throw invalidState("Activity request context is required.");
    }
    const context = request.context;
    const activity = normalizeActivityIdentity(context.activity);
    const options = normalizeActivityOptions(request.options);
    assertJsonValue(request.input);
    const reference = requireNonEmptyString(request.reference, "reference");
    const fingerprint = requireNonEmptyString(
        context.activity.fingerprint,
        "activity.fingerprint",
    );
    return {
        runId: requireNonEmptyString(context.runId, "context.runId"),
        activity,
        reference,
        fingerprint,
        input: structuredClone(request.input),
        options,
        idempotencyKey: requireNonEmptyString(
            context.idempotencyKey,
            "context.idempotencyKey",
        ),
    };
}

export function normalizeActivityIdentity(value: ActivityIdentity): ActivityIdentity {
    if (!value || typeof value !== "object") {
        throw invalidState("Activity identity must be an object.");
    }
    const seq = value.seq;
    if (!Number.isSafeInteger(seq) || seq < 0) {
        throw invalidState("Activity identity seq must be a non-negative integer.");
    }
    return {
        key: requireNonEmptyString(value.key, "activity.key"),
        path: requireNonEmptyString(value.path, "activity.path"),
        seq,
        kind: requireNonEmptyString(value.kind, "activity.kind"),
        fingerprint: requireNonEmptyString(value.fingerprint, "activity.fingerprint"),
    };
}

export function normalizeActivityOptions(
    options: ActivityExecutionRequest["options"],
): ActivityExecutionRequest["options"] {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw invalidState("Activity options must be an object.");
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
        if (value === undefined) {
            continue;
        }
        try {
            assertJsonValue(value);
        } catch (error) {
            throw serializationError(`Activity option ${key} is not JSON-safe.`, error);
        }
        result[key] = structuredClone(value);
    }
    if ("timeoutMs" in result) {
        const timeoutMs = result.timeoutMs;
        if (
            typeof timeoutMs !== "number"
            || !Number.isSafeInteger(timeoutMs)
            || timeoutMs < 0
        ) {
            throw invalidState("Activity option timeoutMs must be a non-negative integer.");
        }
    }
    if ("key" in result && typeof result.key !== "string") {
        throw invalidState("Activity option key must be a string.");
    }
    return result as ActivityExecutionRequest["options"];
}

export function existingActionResult(
    row: ActivityJobRow,
    request: {
        runId: string;
        activity: ActivityIdentity;
        reference: string;
        fingerprint: string;
        input: JsonValue;
        options: ActivityExecutionRequest["options"];
        idempotencyKey: string;
    },
    identityJson: string,
): DeferredActivityStartResult {
    if (row.kind !== ACTIVITY_KIND || row.workflowRunId !== request.runId) {
        throw new WorkflowHostConflictError(
            `Idempotency key ${request.idempotencyKey} belongs to another Job.`,
        );
    }
    if (!row.payloadJson) {
        throw serializationError(`Activity Job ${row.id} has no payload.`);
    }
    const payload = parseActivityPayload(row.payloadJson, row.id);
    if (activityIdentityJson(payload) !== identityJson) {
        throw new WorkflowHostConflictError(
            `Activity idempotency key ${request.idempotencyKey} was reused with different identity.`,
        );
    }
    if (!VALID_JOB_STATUSES.includes(row.status as WorkflowJobStatus)) {
        throw invalidState(`Activity Job ${row.id} has unknown status ${row.status}.`);
    }
    if (row.status === "succeeded") {
        const result = row.resultJson === null
            ? null
            : decodeJson(row.resultJson, `Activity Job ${row.id} result`);
        return { status: "completed", result };
    }
    if (row.status === "failed_terminal" || row.status === "cancelled") {
        // Terminal failures are represented by the durable completion row. A
        // replaying Kernel still needs the same receipt to consume that result.
        return {
            status: "pending",
            receipt: row.id,
            reason: "workflow-activity",
        };
    }
    return {
        status: "pending",
        receipt: row.id,
        reason: "workflow-activity",
    };
}

export function parseActivityPayload(
    payloadJson: string | null,
    jobId: string,
): WorkflowActivityJobPayload {
    if (!payloadJson) {
        throw serializationError(`Activity Job ${jobId} has no payload.`);
    }
    const parsed = parseJson(payloadJson, `Activity Job ${jobId} payload`);
    if (!isRecord(parsed)) {
        throw serializationError(`Activity Job ${jobId} payload must be an object.`);
    }
    const activityValue = parsed.activity;
    if (!isRecord(activityValue)) {
        throw serializationError(`Activity Job ${jobId} activity must be an object.`);
    }
    const activity = normalizeActivityIdentity(activityValue as ActivityIdentity);
    const input = parsed.input;
    assertJsonValue(input);
    const optionsValue = parsed.options;
    if (!isRecord(optionsValue)) {
        throw serializationError(`Activity Job ${jobId} options must be an object.`);
    }
    const options = normalizeActivityOptions(optionsValue as ActivityExecutionRequest["options"]);
    const runId = requireNonEmptyString(parsed.runId, `${jobId}.runId`);
    const reference = requireNonEmptyString(parsed.reference, `${jobId}.reference`);
    const idempotencyKey = requireNonEmptyString(
        parsed.idempotencyKey,
        `${jobId}.idempotencyKey`,
    );
    const retryPolicy = parsed.retryPolicy === undefined
        ? undefined
        : retryPolicySchema.parse(parsed.retryPolicy);
    return {
        runId,
        activity,
        reference,
        input: structuredClone(input),
        options,
        idempotencyKey,
        ...(retryPolicy === undefined ? {} : { retryPolicy }),
    };

}
export function activityIdentityJson(
    payload: Pick<WorkflowActivityJobPayload, "runId" | "activity" | "reference" | "input" | "options" | "idempotencyKey" | "retryPolicy">,
): string {
    return canonicalJson({
        runId: payload.runId,
        activity: payload.activity,
        reference: payload.reference,
        fingerprint: payload.activity.fingerprint,
        input: payload.input,
        options: payload.options,
        idempotencyKey: payload.idempotencyKey,
        retryPolicy: payload.retryPolicy ?? null,
    });
}
export function toActivityJobClaim(
    row: ActivityJobRow,
    payload: WorkflowActivityJobPayload,
    owner: string,
    leaseToken: string,
): WorkflowActivityJobClaim {
    if (!row.workflowRunId) {
        throw invalidState(`Activity Job ${row.id} has no Workflow run.`);
    }
    if (row.workflowKernelRevision === null) {
        throw invalidState(`Activity Job ${row.id} has no claimed Kernel revision.`);
    }
    return {
        id: row.id,
        workflowRunId: row.workflowRunId,
        kind: ACTIVITY_KIND,
        status: "leased",
        payload,
        kernelRevision: row.workflowKernelRevision,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        leaseOwner: owner,
        leaseToken,
        leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function validateActivityTerminalResult(result: ActivityJobTerminalResult): void {
    if (!result || typeof result !== "object") {
        throw invalidState("Activity terminal result must be an object.");
    }
    if (!["succeeded", "retry_wait", "failed_terminal", "cancelled"].includes(result.status)) {
        throw invalidState(`Unknown Activity Job result status ${result.status}.`);
    }
    if (result.status === "retry_wait") {
        if (result.retryDelayMs !== undefined) normalizeRetryDelay(result.retryDelayMs);
    } else if (result.retryDelayMs !== undefined) {
        throw invalidState("retryDelayMs is only valid for retry_wait.");
    }
    if (result.result !== undefined) assertJsonValue(result.result);
    if (result.error !== undefined && result.error !== null && typeof result.error !== "string") {
        throw invalidState("Activity error must be a string or null.");
    }
    if (result.errorCode !== undefined && result.errorCode !== null && typeof result.errorCode !== "string") {
        throw invalidState("Activity errorCode must be a string or null.");
    }
}

export function validateCompletionForJob(
    result: ActivityJobTerminalResult,
    completion: DeferredActivityCompletionInput | undefined,
    payload: WorkflowActivityJobPayload,
    jobId: string,
): DeferredActivityCompletionInput | null {
    if (result.status === "retry_wait") {
        if (completion !== undefined) throw invalidState("retry_wait must not create a Workflow completion.");
        return null;
    }
    if (!completion) throw invalidState("Terminal Activity result requires a Workflow completion.");
    if (completion.activityKey !== payload.activity.key
        || completion.receipt !== jobId
        || completion.reference !== payload.reference
        || completion.fingerprint !== payload.activity.fingerprint) {
        throw new WorkflowHostConflictError(`Activity completion identity does not match Job ${jobId}.`);
    }
    const expectedStatus = result.status === "succeeded"
        ? "completed" : result.status === "failed_terminal" ? "failed" : "cancelled";
    if (completion.status !== expectedStatus) {
        throw new WorkflowHostConflictError(
            `Activity completion status ${completion.status} does not match Job status ${result.status}.`,
        );
    }
    const hasResult = Object.prototype.hasOwnProperty.call(completion, "result");
    const hasError = Object.prototype.hasOwnProperty.call(completion, "error");
    if (completion.status === "completed") {
        if (!hasResult || completion.result === undefined || hasError) {
            throw invalidState("Completed Activity completion requires result and forbids error.");
        }
        if (result.result === undefined || canonicalJson(result.result) !== canonicalJson(completion.result)) {
            throw new WorkflowHostConflictError(`Activity completion result does not match succeeded Job ${jobId}.`);
        }
        if (result.error !== undefined && result.error !== null) {
            throw invalidState("Succeeded Activity result must not contain an error.");
        }
    } else if (completion.status === "failed") {
        if (!hasError || typeof completion.error !== "string" || completion.error.trim().length === 0 || hasResult) {
            throw invalidState("Failed Activity completion requires error and forbids result.");
        }
        if ((result.error ?? undefined) !== completion.error) {
            throw new WorkflowHostConflictError(`Activity completion error does not match terminal Job ${jobId}.`);
        }
    } else if (hasResult || hasError) {
        throw invalidState("Cancelled Activity completion forbids result and error.");
    }
    if (completion.result !== undefined) assertJsonValue(completion.result);
    return structuredClone(completion);
}

export function toCompletion(row: WorkflowCompletionRow): WorkflowCompletion {
    if (!VALID_COMPLETION_STATUSES.includes(row.status as (typeof VALID_COMPLETION_STATUSES)[number])) {
        throw invalidState(`Workflow completion ${row.id} has unknown status ${row.status}.`);
    }
    const parsed = parseJson(
        row.completionJson,
        `Workflow completion ${row.id} payload`,
    );
    if (!isRecord(parsed)) {
        throw serializationError(`Workflow completion ${row.id} payload must be an object.`);
    }
    const completion = normalizeCompletionJson(parsed, row.id);
    if (
        completion.activityKey !== row.activityKey
        || completion.receipt !== row.receipt
        || completion.reference !== row.reference
        || completion.fingerprint !== row.fingerprint
    ) {
        throw serializationError(
            `Workflow completion ${row.id} projection does not match its payload.`,
        );
    }
    return {
        id: row.id,
        workflowRunId: row.workflowRunId,
        jobId: row.jobId,
        activityKey: row.activityKey,
        receipt: row.receipt,
        reference: row.reference,
        fingerprint: row.fingerprint,
        completion,
        status: row.status as WorkflowCompletion["status"],
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        availableAt: row.availableAt.toISOString(),
        leaseOwner: row.leaseOwner,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
        lastError: row.lastError,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function normalizeCompletionJson(
    value: Record<string, unknown>,
    id: string,
): DeferredActivityCompletionInput {
    const status = value.status;
    if (status !== "completed" && status !== "failed" && status !== "cancelled") {
        throw serializationError(`Workflow completion ${id} has invalid status.`);
    }
    const activityKey = requireNonEmptyString(value.activityKey, `${id}.activityKey`);
    const receipt = requireNonEmptyString(value.receipt, `${id}.receipt`);
    const reference = requireNonEmptyString(value.reference, `${id}.reference`);
    const fingerprint = requireNonEmptyString(value.fingerprint, `${id}.fingerprint`);
    if (value.result !== undefined) {
        assertJsonValue(value.result);
    }
    if (value.error !== undefined && typeof value.error !== "string") {
        throw serializationError(`Workflow completion ${id} has invalid error.`);
    }
    return {
        activityKey,
        receipt,
        reference,
        fingerprint,
        status,
        ...(value.result === undefined ? {} : { result: structuredClone(value.result) }),
        ...(value.error === undefined ? {} : { error: value.error as string }),
    };
}

export function toEnvelope(row: WorkflowRunRow): WorkflowEnvelope {
    const state = parseJson(row.stateJson, `Workflow run ${row.id} state`);
    if (isWorkflowEnvelopeMarker(state, row.id)) {
        if (row.status !== "queued" && !VALID_RUN_STATUSES.includes(row.status as WorkflowRunStatus)) {
            throw invalidState(`Workflow run ${row.id} has invalid status ${row.status}.`);
        }
    } else {
        assertKernelStateProjection(row, state);
    }
    const inputSnapshot = decodeJson(
        row.inputSnapshotJson,
        `Workflow run ${row.id} input snapshot`,
    );
    const productRun = decodeJson(
        row.productRunJson,
        `Workflow run ${row.id} product snapshot`,
    );
    if (!VALID_RUN_STATUSES.includes(row.status as WorkflowRunStatus)) {
        throw invalidState(`Workflow run ${row.id} has invalid status ${row.status}.`);
    }
    return {
        runId: row.id,
        idempotencyKey: row.idempotencyKey,
        definition: {
            key: row.definitionKey,
            version: row.definitionVersion,
            manifestHash: row.manifestHash,
        },
        inputSnapshot,
        productRun,
        status: row.status as WorkflowRunStatus,
        resumeRequired: row.resumeRequired,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
    };
}

export function assertEnvelopeIdentity(
    row: WorkflowRunRow,
    input: {
        runId: string;
        idempotencyKey: string | null;
        definition: WorkflowDefinitionReference;
    },
    inputSnapshotJson: string,
    productRunJson: string,
): WorkflowEnvelope {
    if (row.idempotencyKey !== input.idempotencyKey) {
        throw new WorkflowHostConflictError(
            `Idempotency key ${input.idempotencyKey ?? "<none>"} is already bound to another envelope.`,
        );
    }
    const existingInput = canonicalJson(
        decodeJson(row.inputSnapshotJson, `Workflow run ${row.id} input snapshot`),
    );
    const existingProduct = canonicalJson(
        decodeJson(row.productRunJson, `Workflow run ${row.id} product snapshot`),
    );
    if (
        row.definitionKey !== input.definition.key
        || row.definitionVersion !== input.definition.version
        || row.manifestHash !== input.definition.manifestHash
        || existingInput !== inputSnapshotJson
        || existingProduct !== productRunJson
    ) {
        throw new WorkflowHostConflictError(
            `Idempotency key ${row.idempotencyKey} was reused with a different Workflow envelope identity.`,
        );
    }
    return toEnvelope(row);
}

export function rejectedActivityResult(status: string | null | undefined): CompleteActivityResult {
    const jobStatus = status !== undefined && status !== null
        && VALID_JOB_STATUSES.includes(status as WorkflowJobStatus)
        ? status as WorkflowJobStatus
        : "queued";
    return {
        accepted: false,
        jobStatus,
        completion: null,
    };
}

export function sameCompletionIdentity(
    left: DeferredActivityCompletionInput,
    right: DeferredActivityCompletionInput,
): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

export function assertKernelStateProjection(row: WorkflowRunRow, state: unknown): void {
    if (!isRecord(state)) {
        throw serializationError(`Workflow run ${row.id} state must be an object.`);
    }
    if (state.runId !== row.id) {
        throw serializationError(`Workflow run ${row.id} state runId does not match its row.`);
    }
    if (!isRecord(state.definition)) {
        throw serializationError(`Workflow run ${row.id} state definition is invalid.`);
    }
    if (
        state.definition.key !== row.definitionKey
        || state.definition.version !== row.definitionVersion
        || state.definition.manifestHash !== row.manifestHash
    ) {
        throw serializationError(`Workflow run ${row.id} definition projection is inconsistent.`);
    }
    if (state.status !== row.status) {
        throw serializationError(`Workflow run ${row.id} status projection is inconsistent.`);
    }
}

export function previousRunLeaseGuard(row: WorkflowRunRow): Record<string, unknown> {
    if (row.runLeaseOwner === null && row.runLeaseToken === null && row.runLeaseExpiresAt === null) {
        return {
            runLeaseOwner: null,
            runLeaseToken: null,
            runLeaseExpiresAt: null,
        };
    }
    return {
        runLeaseOwner: row.runLeaseOwner,
        runLeaseToken: row.runLeaseToken,
        runLeaseExpiresAt: row.runLeaseExpiresAt,
    };
}

export function previousJobLeaseGuard(row: ActivityJobRow): Record<string, unknown> {
    if (row.status !== "leased") {
        return {
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
        };
    }
    return {
        leaseOwner: row.leaseOwner,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt,
    };
}

export function previousCompletionLeaseGuard(row: WorkflowCompletionRow): Record<string, unknown> {
    if (row.status !== "leased") {
        return {
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
        };
    }
    return {
        leaseOwner: row.leaseOwner,
        leaseToken: row.leaseToken,
        leaseExpiresAt: row.leaseExpiresAt,
    };
}

export function normalizeActivityJobLease(input: ActivityJobLease): ActivityJobLease {
    return {
        jobId: requireNonEmptyString(input.jobId, "jobLease.jobId"),
        leaseToken: requireNonEmptyString(input.leaseToken, "jobLease.leaseToken"),
        owner: requireNonEmptyString(input.owner, "jobLease.owner"),
        ...(input.leaseExpiresAt === undefined
            ? {}
            : { leaseExpiresAt: parseIsoDate(input.leaseExpiresAt, "jobLease.leaseExpiresAt").toISOString() }),
    };
}

export function normalizeRunLease(input: WorkflowRunLease): WorkflowRunLease {
    return {
        runId: requireNonEmptyString(input.runId, "runLease.runId"),
        leaseToken: requireNonEmptyString(input.leaseToken, "runLease.leaseToken"),
        owner: requireNonEmptyString(input.owner, "runLease.owner"),
        ...(input.leaseExpiresAt === undefined
            ? {}
            : { leaseExpiresAt: parseIsoDate(input.leaseExpiresAt, "runLease.leaseExpiresAt").toISOString() }),
    };
}

export function activityCompletionForState(
    state: unknown,
    completion: DeferredActivityCompletionInput,
    kernelRevision: number,
): boolean {
    if (!isRecord(state) || state.revision !== kernelRevision) return false;
    const records = state.activityCompletions;
    if (!Array.isArray(records)) return false;
    const incomingFingerprint = fingerprint({
        activityKey: completion.activityKey,
        receipt: completion.receipt,
        reference: completion.reference,
        fingerprint: completion.fingerprint,
        status: completion.status,
        hasResult: Object.prototype.hasOwnProperty.call(completion, "result"),
        result: completion.result === undefined ? null : completion.result,
        hasError: Object.prototype.hasOwnProperty.call(completion, "error"),
        error: completion.error === undefined ? null : completion.error,
    });
    return records.some((record) => {
        if (!isRecord(record)) return false;
        if (
            record.key !== completion.activityKey
            || record.receipt !== completion.receipt
            || record.reference !== completion.reference
            || record.fingerprint !== completion.fingerprint
            || record.status !== completion.status
        ) return false;
        if (typeof record.completionFingerprint === "string") {
            return record.completionFingerprint === incomingFingerprint;
        }
        const encodedResult = record.result;
        const result = isRecord(encodedResult) && encodedResult.kind === "inline"
            ? encodedResult.value
            : encodedResult;
        return fingerprint({
            activityKey: record.key,
            receipt: record.receipt,
            reference: record.reference,
            fingerprint: record.fingerprint,
            status: record.status,
            hasResult: Object.prototype.hasOwnProperty.call(record, "result"),
            result: result === undefined ? null : result,
            hasError: Object.prototype.hasOwnProperty.call(record, "error"),
            error: record.error === undefined ? null : record.error,
        }) === incomingFingerprint;
    });
}


export function pendingActivityForState(
    state: unknown,
    payload: WorkflowActivityJobPayload,
    receipt?: string,
): Record<string, unknown> | null {
    if (!isRecord(state)) return null;
    const pending = state.pendingActivities;
    if (!Array.isArray(pending)) return null;
    const candidate = pending.find((entry) => isRecord(entry)
        && entry.key === payload.activity.key
        && entry.path === payload.activity.path
        && entry.seq === payload.activity.seq
        && entry.kind === payload.activity.kind
        && entry.fingerprint === payload.activity.fingerprint
        && entry.reference === payload.reference
        && (receipt === undefined || entry.receipt === receipt));
    return isRecord(candidate) ? candidate : null;
}

export function hasPendingActivity(
    state: unknown,
    payload: WorkflowActivityJobPayload,
    receipt?: string,
): boolean {
    return pendingActivityForState(state, payload, receipt) !== null;
}

