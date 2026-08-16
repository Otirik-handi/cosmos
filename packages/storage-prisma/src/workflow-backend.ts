import {
    assertJsonValue,
    canonicalJson,
    WorkflowBackendConflictError,
    WorkflowRunNotFoundError,
    type BackendCapabilities,
    type JsonValue,
    type WorkflowBackend,
    type WorkflowRunState,
    type WorkflowValue,
} from "@notnotype/nb-workflow";
import {
    PrismaClient,
    type Prisma,
} from "@prisma/client";
import type { WorkflowRunLease } from "@cosmos/application";

export class WorkflowStateIntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WorkflowStateIntegrityError";
    }
}
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

const durableCapabilities: BackendCapabilities = Object.freeze({
    durability: "durable",
    processRestart: true,
    concurrentExecution: true,
    multiWorker: true,
    leases: true,
    durableSignals: false,
    durableTimers: false,
    childWorkflows: false,
    externalReceipts: true,
    outbox: false,
    valueReferences: true,
});

type WorkflowRunRow = {
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

export class PrismaWorkflowBackend implements WorkflowBackend {
    readonly capabilities = durableCapabilities;

    /**
     * Kernel 0.2.0 reloads once in persistence recovery and once in the
     * completion retry path; keep queued same-Run saves behind both reads.
     */
    private readonly deferredSaveLockReleases = new Map<string, {
        release: () => void;
        remainingLoads: number;
    }>();
    private readonly saveLocks = new Map<string, Promise<void>>();
    private readonly activeSaveLockReleases = new Map<string, () => void>();
    constructor(readonly prisma: PrismaClient) {}

    async createRun(initial: WorkflowRunState): Promise<WorkflowRunState> {
        const normalized = normalizeState(initial, 0);
        if (initial.revision !== 0) {
            throw new Error("A new workflow run must start at revision 0.");
        }

        try {
            return await this.prisma.$transaction(async (tx) => {
                const existing = await tx.workflowRun.findUnique({
                    where: { id: normalized.runId },
                });
                if (existing) {
                    return adoptEnvelopeOrConflict(
                        tx,
                        existing as WorkflowRunRow,
                        normalized,
                    );
                }
                const row = await tx.workflowRun.create({
                    data: toCreateData(normalized),
                });
                return fromRow(row as WorkflowRunRow);
            });
        } catch (error) {
            if (!isUniqueConstraintError(error)) {
                throw error;
            }

            // A concurrent create may have won the id race after the
            // transaction's initial read. Re-enter a transaction so a
            // marker can still be adopted with a conditional update.
            return await this.prisma.$transaction(async (tx) => {
                const existing = await tx.workflowRun.findUnique({
                    where: { id: normalized.runId },
                });
                if (!existing) {
                    throw new WorkflowBackendConflictError(
                        normalized.runId,
                        -1,
                        0,
                    );
                }
                return adoptEnvelopeOrConflict(
                    tx,
                    existing as WorkflowRunRow,
                    normalized,
                );
            });
        }
    }

    async loadRun(runId: string): Promise<WorkflowRunState | null> {
        try {
            const row = await this.prisma.workflowRun.findUnique({
                where: { id: runId },
            });
            if (!row) {
                return null;
            }
            if (isEnvelopeOnlyRow(row as WorkflowRunRow)) {
                return null;
            }
            return fromRow(row as WorkflowRunRow);
        } finally {
            this.releaseDeferredSaveLock(runId);
        }
    }
    async createRunWithLease(
        initial: WorkflowRunState,
        lease: WorkflowRunLease,
        now = new Date(),
    ): Promise<WorkflowRunState> {
        const normalized = normalizeState(initial, 0);
        if (initial.revision !== 0) {
            throw new Error("A new workflow run must start at revision 0.");
        }
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.workflowRun.findUnique({
                where: { id: normalized.runId },
            });
            if (!existing) {
                throw new WorkflowRunNotFoundError(normalized.runId);
            }
            if (
                existing.runLeaseOwner !== lease.owner
                || existing.runLeaseToken !== lease.leaseToken
                || existing.runLeaseExpiresAt === null
                || existing.runLeaseExpiresAt <= now
            ) {
                throw new WorkflowStateIntegrityError(
                    `Workflow run lease is no longer current: ${normalized.runId}`,
                );
            }
            return adoptEnvelopeOrConflict(
                tx,
                existing as WorkflowRunRow,
                normalized,
                lease,
                now,
            );
        });
    }

    async saveRunWithLease(
        next: WorkflowRunState,
        expectedRevision: number,
        lease: {
            runId: string;
            leaseToken: string;
            owner: string;
        },
        now = new Date(),
    ): Promise<WorkflowRunState> {
        return this.withRunSaveLock(next.runId, async () => {
        const current = await this.prisma.workflowRun.findUnique({
            where: { id: next.runId },
        });
        if (!current) {
            throw new WorkflowRunNotFoundError(next.runId);
        }
        if (
            current.id !== lease.runId
            || current.runLeaseOwner !== lease.owner
            || current.runLeaseToken !== lease.leaseToken
            || current.runLeaseExpiresAt === null
            || current.runLeaseExpiresAt.getTime() <= now.getTime()
        ) {
            throw new WorkflowStateIntegrityError(
                `Workflow run lease is no longer current: ${next.runId}`,
            );
        }
        const currentState = fromRow(current as WorkflowRunRow);
        if (current.kernelRevision !== expectedRevision) {
            if (hasSameActivityCompletion(currentState, next)) {
                this.deferCurrentRunSaveLock(next.runId);
            }
            throw new WorkflowBackendConflictError(
                next.runId,
                expectedRevision,
                current.kernelRevision,
            );
        }
        assertImmutableRunFields(currentState, next);
        const normalized = normalizeState(next, expectedRevision + 1);
        const updated = await this.prisma.workflowRun.updateMany({
            where: {
                id: next.runId,
                kernelRevision: expectedRevision,
                runLeaseOwner: lease.owner,
                runLeaseToken: lease.leaseToken,
                runLeaseExpiresAt: { gt: now },
            },
            data: toUpdateData(normalized, expectedRevision + 1),
        });
        if (updated.count !== 1) {
            const actual = await this.prisma.workflowRun.findUnique({
                where: { id: next.runId },
            });
            if (!actual) throw new WorkflowRunNotFoundError(next.runId);
            if (actual.kernelRevision !== expectedRevision) {
                if (hasSameActivityCompletion(fromRow(actual as WorkflowRunRow), next)) {
                    this.deferCurrentRunSaveLock(next.runId);
                }
                throw new WorkflowBackendConflictError(
                    next.runId,
                    expectedRevision,
                    actual.kernelRevision,
                );
            }
            throw new WorkflowStateIntegrityError(
                `Workflow run lease is no longer current: ${next.runId}`,
            );
        }
        const saved = await this.prisma.workflowRun.findUnique({ where: { id: next.runId } });
        if (!saved) throw new WorkflowRunNotFoundError(next.runId);
        return fromRow(saved as WorkflowRunRow);
        });
    }

    async saveRun(
        next: WorkflowRunState,
        expectedRevision: number,
    ): Promise<WorkflowRunState> {
        return this.withRunSaveLock(next.runId, async () => {
        const current = await this.prisma.workflowRun.findUnique({
            where: { id: next.runId },
        });
        if (!current) {
            throw new WorkflowRunNotFoundError(next.runId);
        }
        const currentState = fromRow(current as WorkflowRunRow);
        if (current.kernelRevision !== expectedRevision) {
            if (hasSameActivityCompletion(currentState, next)) {
                this.deferCurrentRunSaveLock(next.runId);
            }
            throw new WorkflowBackendConflictError(
                next.runId,
                expectedRevision,
                current.kernelRevision,
            );
        }
        assertImmutableRunFields(currentState, next);
        const normalized = normalizeState(next, expectedRevision + 1);
        const updated = await this.prisma.workflowRun.updateMany({
            where: {
                id: next.runId,
                kernelRevision: expectedRevision,
            },
            data: toUpdateData(normalized, expectedRevision + 1),
        });
        if (updated.count !== 1) {
            const actual = await this.prisma.workflowRun.findUnique({
                where: { id: next.runId },
            });
            if (!actual) throw new WorkflowRunNotFoundError(next.runId);
            if (actual.kernelRevision !== expectedRevision) {
                if (hasSameActivityCompletion(fromRow(actual as WorkflowRunRow), next)) {
                    this.deferCurrentRunSaveLock(next.runId);
                }
                throw new WorkflowBackendConflictError(
                    next.runId,
                    expectedRevision,
                    actual.kernelRevision,
                );
            }
            throw new WorkflowBackendConflictError(
                next.runId,
                expectedRevision,
                actual.kernelRevision,
            );
        }
        const saved = await this.prisma.workflowRun.findUnique({
            where: { id: next.runId },
        });
        if (!saved) throw new WorkflowRunNotFoundError(next.runId);
        return fromRow(saved as WorkflowRunRow);
        });
    }

    private async withRunSaveLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.saveLocks.get(runId);
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        let released = false;
        const releaseCurrent = () => {
            if (released) return;
            released = true;
            release();
            if (this.saveLocks.get(runId) === current) {
                this.saveLocks.delete(runId);
            }
        };
        this.saveLocks.set(runId, current);
        this.activeSaveLockReleases.set(runId, releaseCurrent);
        if (previous) await previous;
        try {
            return await operation();
        } finally {
            if (this.activeSaveLockReleases.get(runId) === releaseCurrent) {
                this.activeSaveLockReleases.delete(runId);
            }
            if (this.deferredSaveLockReleases.get(runId)?.release !== releaseCurrent) {
                releaseCurrent();
            }
        }
    }

    private deferCurrentRunSaveLock(runId: string): void {
        const release = this.activeSaveLockReleases.get(runId);
        if (!release) {
            throw new Error(`Workflow run save lock is not active: ${runId}`);
        }
        this.deferredSaveLockReleases.set(runId, {
            release,
            remainingLoads: 2,
        });
    }

    private releaseDeferredSaveLock(runId: string): void {
        const deferred = this.deferredSaveLockReleases.get(runId);
        if (!deferred) return;
        deferred.remainingLoads -= 1;
        if (deferred.remainingLoads > 0) return;
        this.deferredSaveLockReleases.delete(runId);
        deferred.release();
    }





    async listRuns(): Promise<readonly WorkflowRunState[]> {
        const rows = await this.prisma.workflowRun.findMany({
            orderBy: [
                { createdAt: "asc" },
                { id: "asc" },
            ],
        });
        return rows
            .filter((row) => !isEnvelopeOnlyRow(row as WorkflowRunRow))
            .map((row) => fromRow(row as WorkflowRunRow));
    }
}


function hasSameActivityCompletion(
    current: WorkflowRunState,
    next: WorkflowRunState,
): boolean {
    const currentCompletions = current.activityCompletions ?? [];
    const nextCompletions = next.activityCompletions ?? [];
    return nextCompletions.some((candidate) => currentCompletions.some(
        (existing) => existing.key === candidate.key
            && existing.completionFingerprint === candidate.completionFingerprint,
    ));
}

async function adoptEnvelopeOrConflict(
    tx: Prisma.TransactionClient,
    existing: WorkflowRunRow,
    normalized: WorkflowRunState,
    lease?: WorkflowRunLease,
    now = new Date(),
): Promise<WorkflowRunState> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(existing.stateJson) as unknown;
    } catch {
        throw new WorkflowStateIntegrityError(
            `Workflow run ${existing.id} contains invalid state JSON.`,
        );
    }

    if (!isWorkflowEnvelopeMarker(parsed, existing.id)) {
        throw new WorkflowBackendConflictError(
            normalized.runId,
            -1,
            existing.kernelRevision,
        );
    }
    if (existing.createdAt.toISOString() !== normalized.createdAt) {
        throw new WorkflowStateIntegrityError(
            `Workflow run immutable createdAt changed: ${normalized.runId}`,
        );
    }

    const updated = await tx.workflowRun.updateMany({
        where: {
            id: normalized.runId,
            kernelRevision: existing.kernelRevision,
            stateJson: existing.stateJson,
            ...(lease === undefined ? {} : {
                runLeaseOwner: lease.owner,
                runLeaseToken: lease.leaseToken,
                runLeaseExpiresAt: { gt: now },
            }),
        },
        data: toUpdateData(normalized, existing.kernelRevision),
    });
    if (updated.count !== 1) {
        const current = await tx.workflowRun.findUnique({
            where: { id: normalized.runId },
            select: { kernelRevision: true },
        });
        throw new WorkflowBackendConflictError(
            normalized.runId,
            -1,
            current?.kernelRevision ?? existing.kernelRevision,
        );
    }

    const adopted = await tx.workflowRun.findUnique({
        where: { id: normalized.runId },
    });
    if (!adopted) {
        throw new WorkflowRunNotFoundError(normalized.runId);
    }
    return fromRow(adopted as WorkflowRunRow);
}

function isEnvelopeOnlyRow(row: WorkflowRunRow): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(row.stateJson) as unknown;
    } catch {
        return false;
    }
    return isWorkflowEnvelopeMarker(parsed, row.id);
}

function toCreateData(state: WorkflowRunState): Prisma.WorkflowRunCreateInput {
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

function toUpdateData(
    state: WorkflowRunState,
    revision: number,
): Prisma.WorkflowRunUpdateManyMutationInput {
    return {
        stateJson: canonicalJson(state),
        kernelRevision: revision,
        status: state.status,
        resumeRequired: state.resumeRequired === true,
        definitionKey: state.definition.key,
        definitionVersion: state.definition.version,
        manifestHash: state.definition.manifestHash,
        updatedAt: parseDate(state.updatedAt, "updatedAt"),
        finishedAt: terminalFinishedAt(state),
    };
}

function fromRow(row: WorkflowRunRow): WorkflowRunState {
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

function normalizeState(
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

function validateWorkflowValue(value: unknown, path: string): asserts value is WorkflowValue {
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

function assertImmutableRunFields(
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

function assertProjection(row: WorkflowRunRow, state: WorkflowRunState): void {
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

function terminalFinishedAt(state: WorkflowRunState): Date | null {
    return state.status === "completed"
        || state.status === "failed"
        || state.status === "cancelled"
        ? parseDate(state.updatedAt, "updatedAt")
        : null;
}

function requireString(
    record: Record<string, unknown>,
    key: string,
): string {
    const value = record[key];
    if (typeof value !== "string" || value.length === 0) {
        throw new WorkflowStateIntegrityError(`${key} must be a non-empty string.`);
    }
    return value;
}

function requireArray(
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

function parseDate(value: string, field: string): Date {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
        throw new WorkflowStateIntegrityError(`Invalid ${field} date.`);
    }
    return parsed;
}


function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
