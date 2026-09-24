import { randomUUID } from "node:crypto";
import { WorkflowBackendConflictError, WorkflowRunNotFoundError, assertJsonValue, canonicalJson } from "@notnotype/nb-workflow";
import type { BackendCapabilities, JsonValue, WorkflowBackend, WorkflowRunState, WorkflowValue } from "@notnotype/nb-workflow";
import type { Prisma } from "@prisma/client";
import type { WorkflowRunLease } from "@cosmos/application";
import { WorkflowStateIntegrityError, isUniqueConstraintError } from "./workflow-backend-errors.js";
import { isWorkflowEnvelopeMarker } from "./workflow-envelope-marker.js";
import { fromRow, isEnvelopeOnlyRow, toUpdateData } from "./workflow-state-codec.js";
import { normalizeState } from "./workflow-state-validation.js";
import type { WorkflowRunRow } from "./workflow-state-fields.js";

/** Kernel terminal status mapped to the product Run event vocabulary. */
export const RUN_TERMINAL_EVENTS = {
    completed: { type: "run.succeeded.v1", status: "succeeded" },
    failed: { type: "run.failed.v1", status: "failed" },
    cancelled: { type: "run.cancelled.v1", status: "cancelled" },
} as const;

/**
 * A durable Run terminal transition must emit the same auditable event the
 * legacy `completeRun` path emits, or SSE consumers never learn about a
 * successful run that saved zero entries. The idempotency key matches
 * `appendWorkflowRunFailedEvent` in the host store, so a Kernel-state
 * failure save and the store-level failure path share one event.
 */
export async function appendRunTerminalEvent(
    tx: Prisma.TransactionClient,
    state: WorkflowRunState,
): Promise<void> {
    if (state.status !== "completed" && state.status !== "failed" && state.status !== "cancelled") {
        return;
    }
    const terminal = RUN_TERMINAL_EVENTS[state.status];
    const idempotencyKey = `workflow-run:${state.runId}:${terminal.status}`;
    const existing = await tx.domainEvent.findFirst({
        where: { workflowRunId: state.runId, idempotencyKey },
    });
    if (existing) {
        return;
    }
    try {
        await tx.domainEvent.create({
            data: {
                eventId: randomUUID(),
                type: terminal.type,
                version: "v1",
                payloadJson: canonicalJson({
                    runId: state.runId,
                    status: terminal.status,
                    error: state.error ?? null,
                }),
                aggregateType: "WorkflowRun",
                aggregateId: state.runId,
                runId: null,
                workflowRunId: state.runId,
                idempotencyKey,
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
    }
}

export async function adoptEnvelopeOrConflict(
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

export function hasSameActivityCompletion(
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
