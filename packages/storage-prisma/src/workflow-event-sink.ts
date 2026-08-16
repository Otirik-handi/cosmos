import { randomUUID } from "node:crypto";

import {
    canonicalJson,
    EventSinkConflictError,
    validateWorkflowEvent,
    type EventSink,
    type EventSinkRequest,
} from "@notnotype/nb-workflow";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WorkflowHostError, type WorkflowRunLease } from "@cosmos/application";

export class PrismaWorkflowEventSink implements EventSink {
    constructor(private readonly prisma: PrismaClient) {}
    async emit(_request: EventSinkRequest): Promise<void> {
        throw new WorkflowHostError(
            "lease_lost",
            "Prisma Workflow EventSink requires a current Workflow Run lease.",
        );
    }

    /** Emit while holding the exact Run lease used by the Kernel execution. */
    async emitWithLease(request: EventSinkRequest, lease: WorkflowRunLease): Promise<void> {
        const prepared = prepareEvent(request);
        await this.prisma.$transaction(async (tx) => {
            await assertCurrentRunLease(tx, lease, new Date());
            await persistEvent(tx, prepared);
        });
    }
}

function prepareEvent(request: EventSinkRequest): {
    event: ReturnType<typeof validateWorkflowEvent>;
    workflowRunId: string;
    idempotencyKey: string;
    payloadJson: string;
} {
    const event = validateWorkflowEvent(request.event);
    return {
        event,
        workflowRunId: request.context.runId,
        idempotencyKey: request.context.idempotencyKey,
        payloadJson: canonicalJson(event.payload),
    };
}

async function persistEvent(
    client: PrismaClient | Prisma.TransactionClient,
    prepared: ReturnType<typeof prepareEvent>,
): Promise<void> {
    const existing = await client.domainEvent.findFirst({
        where: {
            workflowRunId: prepared.workflowRunId,
            idempotencyKey: prepared.idempotencyKey,
        },
    });
    if (existing) {
        assertSameEvent(
            existing,
            prepared.event.type,
            prepared.event.version,
            prepared.payloadJson,
            prepared.idempotencyKey,
        );
        return;
    }

    try {
        await client.domainEvent.create({
            data: {
                eventId: randomUUID(),
                type: prepared.event.type,
                version: prepared.event.version,
                payloadJson: prepared.payloadJson,
                workflowRunId: prepared.workflowRunId,
                idempotencyKey: prepared.idempotencyKey,
            },
        });
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const winner = await client.domainEvent.findFirst({
            where: {
                workflowRunId: prepared.workflowRunId,
                idempotencyKey: prepared.idempotencyKey,
            },
        });
        if (!winner) throw error;
        assertSameEvent(
            winner,
            prepared.event.type,
            prepared.event.version,
            prepared.payloadJson,
            prepared.idempotencyKey,
        );
    }
}

async function assertCurrentRunLease(
    tx: Prisma.TransactionClient,
    lease: WorkflowRunLease,
    now: Date,
): Promise<void> {
    const run = await tx.workflowRun.findUnique({
        where: { id: lease.runId },
        select: {
            runLeaseOwner: true,
            runLeaseToken: true,
            runLeaseExpiresAt: true,
        },
    });
    if (
        !run
        || run.runLeaseOwner !== lease.owner
        || run.runLeaseToken !== lease.leaseToken
        || run.runLeaseExpiresAt === null
        || run.runLeaseExpiresAt <= now
    ) {
        throw new WorkflowHostError(
            "lease_lost",
            `Workflow Run ${lease.runId} lease is no longer current.`,
        );
    }
    const guarded = await tx.workflowRun.updateMany({
        where: {
            id: lease.runId,
            runLeaseOwner: lease.owner,
            runLeaseToken: lease.leaseToken,
            runLeaseExpiresAt: { gt: now },
        },
        data: { runLeaseExpiresAt: run.runLeaseExpiresAt },
    });
    if (guarded.count !== 1) {
        throw new WorkflowHostError(
            "lease_lost",
            `Workflow Run ${lease.runId} lease changed before event emission.`,
        );
    }
}

function assertSameEvent(
    existing: {
        type: string;
        version: string;
        payloadJson: string;
    },
    type: string,
    version: string,
    payloadJson: string,
    idempotencyKey: string,
): void {
    if (
        existing.type !== type
        || existing.version !== version
        || existing.payloadJson !== payloadJson
    ) {
        throw new EventSinkConflictError(idempotencyKey);
    }
}

function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "P2002";
}
