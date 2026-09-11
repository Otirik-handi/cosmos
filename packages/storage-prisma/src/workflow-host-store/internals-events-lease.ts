import { randomUUID } from "node:crypto";
import { type Prisma } from "@prisma/client";
import { canonicalJson, type JsonValue } from "@notnotype/nb-workflow";
import { WorkflowHostConflictError, WorkflowHostError, type WorkflowRunLease } from "@cosmos/application";
import { type WorkflowRunRow, isRecord, isUniqueConstraintError } from "./internals-core.js";

export async function appendWorkflowRunQueuedEvent(
    tx: Prisma.TransactionClient,
    input: {
        workflowRunId: string;
        productRun: JsonValue;
    },
): Promise<void> {
    const payload = workflowRunQueuedEventPayload(input.workflowRunId, input.productRun);
    const payloadJson = canonicalJson(payload);
    const idempotencyKey = `workflow-run:${input.workflowRunId}:queued`;
    const existing = await tx.domainEvent.findFirst({
        where: {
            workflowRunId: input.workflowRunId,
            idempotencyKey,
        },
    });
    if (existing) {
        assertSameWorkflowRunQueuedEvent(existing, payloadJson, idempotencyKey);
        return;
    }
    const data = {
        eventId: randomUUID(),
        type: "run.queued.v1",
        version: "v1",
        payloadJson,
        aggregateType: "WorkflowRun",
        aggregateId: input.workflowRunId,
        runId: null,
        workflowRunId: input.workflowRunId,
        idempotencyKey,
    };
    try {
        await tx.domainEvent.create({ data });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const winner = await tx.domainEvent.findFirst({
            where: {
                workflowRunId: input.workflowRunId,
                idempotencyKey,
            },
        });
        if (!winner) throw error;
        assertSameWorkflowRunQueuedEvent(winner, payloadJson, idempotencyKey);
    }
}

export function workflowRunQueuedEventPayload(
    workflowRunId: string,
    productRun: JsonValue,
): { runId: string; sourceId?: string; triggerKind?: string } {
    const payload: { runId: string; sourceId?: string; triggerKind?: string } = {
        runId: workflowRunId,
    };
    if (!isRecord(productRun)) return payload;
    if (typeof productRun.sourceId === "string" && productRun.sourceId.length > 0) {
        payload.sourceId = productRun.sourceId;
    }
    if (typeof productRun.triggerKind === "string" && productRun.triggerKind.length > 0) {
        payload.triggerKind = productRun.triggerKind;
    }
    return payload;
}

export function assertSameWorkflowRunQueuedEvent(
    existing: {
        type: string;
        version: string;
        payloadJson: string;
        aggregateType: string | null;
        aggregateId: string | null;
        runId: string | null;
        workflowRunId: string | null;
    },
    payloadJson: string,
    idempotencyKey: string,
): void {
    if (
        existing.type !== "run.queued.v1"
        || existing.version !== "v1"
        || existing.payloadJson !== payloadJson
        || existing.aggregateType !== "WorkflowRun"
        || existing.aggregateId !== existing.workflowRunId
        || existing.runId !== null
    ) {
        throw new WorkflowHostConflictError(
            `Workflow domain event ${idempotencyKey} conflicts with the durable Workflow Run queued event.`,
        );
    }
}

export async function appendActivityLifecycleEvent(
    tx: Prisma.TransactionClient,
    input: {
        workflowRunId: string;
        jobId: string;
        attempt: number;
        owner: string;
        expiresAt: Date | null;
        status: string;
        error?: string;
        idempotencyKey: string;
    },
): Promise<void> {
    const payload = {
        workflowRunId: input.workflowRunId,
        jobId: input.jobId,
        attempt: input.attempt,
        owner: input.owner,
        leaseExpiresAt: input.expiresAt?.toISOString() ?? null,
        status: input.status,
        ...(input.error === undefined ? {} : { error: input.error }),
    };
    try {
        await tx.domainEvent.create({
            data: {
                eventId: randomUUID(),
                type: `workflow.activity.${input.status}.v1`,
                version: "v1",
                payloadJson: canonicalJson(payload),
                aggregateType: "WorkflowActivityJob",
                aggregateId: input.jobId,
                runId: null,
                workflowRunId: input.workflowRunId,
                idempotencyKey: input.idempotencyKey,
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
    }
}
export function assertCurrentRunLease(
    row: WorkflowRunRow,
    lease: WorkflowRunLease,
    now: Date,
): void {
    if (!hasCurrentRunLease(row, lease, now)) {
        throw new WorkflowHostError(
            "lease_lost",
            `Workflow run lease ${lease.runId} is no longer current.`,
        );
    }
}

export async function appendWorkflowRunFailedEvent(
    tx: Prisma.TransactionClient,
    input: { workflowRunId: string; error: string },
): Promise<void> {
    const idempotencyKey = `workflow-run:${input.workflowRunId}:failed`;
    const payloadJson = canonicalJson({
        runId: input.workflowRunId,
        status: "failed",
        error: input.error,
    });
    const existing = await tx.domainEvent.findFirst({
        where: {
            workflowRunId: input.workflowRunId,
            idempotencyKey,
        },
    });
    if (existing) return;
    try {
        await tx.domainEvent.create({
            data: {
                eventId: randomUUID(),
                type: "run.failed.v1",
                version: "v1",
                payloadJson,
                aggregateType: "WorkflowRun",
                aggregateId: input.workflowRunId,
                runId: null,
                workflowRunId: input.workflowRunId,
                idempotencyKey,
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
    }
}

export async function appendWorkflowRunCancelledEvent(
    tx: Prisma.TransactionClient,
    input: { workflowRunId: string; reason: string },
): Promise<void> {
    const idempotencyKey = `workflow-run:${input.workflowRunId}:cancelled`;
    const payloadJson = canonicalJson({
        runId: input.workflowRunId,
        status: "cancelled",
        reason: input.reason,
    });
    const existing = await tx.domainEvent.findFirst({
        where: {
            workflowRunId: input.workflowRunId,
            idempotencyKey,
        },
    });
    if (existing) return;
    try {
        await tx.domainEvent.create({
            data: {
                eventId: randomUUID(),
                type: "run.cancelled.v1",
                version: "v1",
                payloadJson,
                aggregateType: "WorkflowRun",
                aggregateId: input.workflowRunId,
                runId: null,
                workflowRunId: input.workflowRunId,
                idempotencyKey,
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
    }
}

export function hasCurrentRunLease(
    row: WorkflowRunRow,
    lease: WorkflowRunLease,
    now: Date,
): boolean {
    return row.id === lease.runId
        && row.runLeaseOwner === lease.owner
        && row.runLeaseToken === lease.leaseToken
        && row.runLeaseExpiresAt !== null
        && row.runLeaseExpiresAt.getTime() > now.getTime();
}

