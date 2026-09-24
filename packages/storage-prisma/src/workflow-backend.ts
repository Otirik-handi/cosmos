import { randomUUID } from "node:crypto";
import { WorkflowBackendConflictError, WorkflowRunNotFoundError, assertJsonValue, canonicalJson } from "@notnotype/nb-workflow";
import type { BackendCapabilities, JsonValue, WorkflowBackend, WorkflowRunState, WorkflowValue } from "@notnotype/nb-workflow";
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { WorkflowRunLease } from "@cosmos/application";
import { WorkflowStateIntegrityError, isUniqueConstraintError } from "./workflow-backend-errors.js";
import { isWorkflowEnvelopeMarker } from "./workflow-envelope-marker.js";
import { RUN_TERMINAL_EVENTS, adoptEnvelopeOrConflict, appendRunTerminalEvent, hasSameActivityCompletion } from "./workflow-run-events.js";
import { completedProductRunJson, fromRow, isEnvelopeOnlyRow, toCreateData, toUpdateData } from "./workflow-state-codec.js";
import { terminalFinishedAt } from "./workflow-state-fields.js";
import { assertImmutableRunFields, assertProjection, normalizeState } from "./workflow-state-validation.js";
import type { WorkflowRunRow } from "./workflow-state-fields.js";

export const durableCapabilities: BackendCapabilities = Object.freeze({
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
        const updated = await this.prisma.$transaction(async (tx) => {
            const result = await tx.workflowRun.updateMany({
                where: {
                    id: next.runId,
                    kernelRevision: expectedRevision,
                    runLeaseOwner: lease.owner,
                    runLeaseToken: lease.leaseToken,
                    runLeaseExpiresAt: { gt: now },
                },
                data: toUpdateData(normalized, expectedRevision + 1, current.productRunJson),
            });
            if (result.count === 1) {
                await appendRunTerminalEvent(tx, normalized);
            }
            return result;
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
        const updated = await this.prisma.$transaction(async (tx) => {
            const result = await tx.workflowRun.updateMany({
                where: {
                    id: next.runId,
                    kernelRevision: expectedRevision,
                },
                data: toUpdateData(normalized, expectedRevision + 1, current.productRunJson),
            });
            if (result.count === 1) {
                await appendRunTerminalEvent(tx, normalized);
            }
            return result;
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
