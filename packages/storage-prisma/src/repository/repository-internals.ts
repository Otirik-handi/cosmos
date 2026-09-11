import { createHash, randomUUID } from "node:crypto";
import { type SourceActivationCommand, type TemporalValue, type SavedView, type BoardBlock, type SpotlightPlacement, blockConfigSchemaFor } from "@cosmos/contracts";
import { checkStorySubtype, type StoryKind } from "@cosmos/domain";
import { StorySubtypeInvalidError, type HostActionExecutionFence, type JobLease, type WorkflowAttemptSnapshot } from "@cosmos/application";
import { type Prisma } from "@prisma/client";

export function projectWorkflowAttempts(
    jobId: string,
    events: readonly {
        type: string;
        payloadJson: string;
        occurredAt: Date;
    }[],
): readonly WorkflowAttemptSnapshot[] {
    const attempts = new Map<number, WorkflowAttemptSnapshot>();
    for (const event of events) {
        const prefix = "workflow.activity.";
        const suffix = ".v1";
        if (!event.type.startsWith(prefix) || !event.type.endsWith(suffix)) continue;
        const status = event.type.slice(prefix.length, -suffix.length);
        const payload = parseJson<{
            attempt?: unknown;
            owner?: unknown;
            leaseExpiresAt?: unknown;
            error?: unknown;
        }>(event.payloadJson);
        const number = payload?.attempt;
        if (!Number.isSafeInteger(number) || (number as number) <= 0) continue;
        const attemptNumber = number as number;
        const occurredAt = event.occurredAt.toISOString();
        const owner = typeof payload?.owner === "string" && payload.owner.length > 0
            ? payload.owner
            : "unknown";
        const leaseExpiresAt = typeof payload?.leaseExpiresAt === "string"
            ? payload.leaseExpiresAt
            : occurredAt;
        let projection = attempts.get(attemptNumber);
        if (!projection) {
            projection = {
                id: `${jobId}:attempt:${attemptNumber}`,
                jobId,
                number: attemptNumber,
                workerId: owner,
                workerInstanceId: owner,
                ownerEpoch: 0,
                ownerSessionId: null,
                status: "leased",
                leaseAcquiredAt: occurredAt,
                leaseExpiresAt,
                lastHeartbeatAt: null,
                finishedAt: null,
                error: null,
            };
            attempts.set(attemptNumber, projection);
        }
        if (status === "leased") {
            projection.status = "leased";
            projection.workerId = owner;
            projection.workerInstanceId = owner;
            projection.leaseExpiresAt = leaseExpiresAt;
            projection.leaseAcquiredAt = occurredAt;
            projection.finishedAt = null;
        } else {
            projection.status = status === "succeeded"
                ? "succeeded"
                : status === "cancelled"
                    ? "cancelled"
                    : status === "released"
                        ? "lease_lost"
                        : "failed";
            projection.finishedAt = occurredAt;
            const error = typeof payload?.error === "string" ? payload.error : null;
            projection.error = error === null
                ? projection.error
                : {
                    kind: status === "retry_wait"
                        ? "retryable"
                        : status === "cancelled"
                            ? "aborted"
                            : status === "released"
                                ? "unknown"
                                : "terminal",
                    code: null,
                    message: error,
                    retryable: status === "retry_wait",
                    occurredAt,
                    detailsRef: null,
                };
        }
    }
    return [...attempts.values()].sort((left, right) => left.number - right.number);
}

export function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "P2002";
}

/**
 * Story subtype writes go through the managed registry (ORG-013). Existing
 * unknown values stay readable; they just cannot be written again.
 */
export function assertStorySubtype(kind: StoryKind, subtype: string | null): void {
    const check = checkStorySubtype(kind, subtype);
    if (check.ok) {
        return;
    }
    switch (check.reason) {
        case "empty":
            throw new StorySubtypeInvalidError("Story subtype must not be empty.");
        case "unregistered":
            throw new StorySubtypeInvalidError(`Unknown Story subtype: ${subtype}`);
        case "kind_mismatch":
            throw new StorySubtypeInvalidError(
                `Story subtype ${subtype} belongs to ${check.registration?.kind ?? "another kind"}, not ${kind}.`,
            );
        case "not_active":
            throw new StorySubtypeInvalidError(
                `Story subtype ${subtype} is ${check.registration?.status ?? "inactive"} and cannot be assigned.`,
            );
    }
}


export async function assertJobLease(
    tx: Prisma.TransactionClient,
    runId: string,
    lease: JobLease,
): Promise<void> {
    const job = await tx.job.findFirst({
        where: {
            id: lease.jobId,
            runId,
            leaseToken: lease.leaseToken,
            status: "leased",
        },
    });
    if (!job) {
        throw new Error("Job lease lost.");
    }
}
export async function assertWorkflowActionFence(
    tx: Prisma.TransactionClient,
    fence: HostActionExecutionFence,
    workflowRunId: string,
): Promise<void> {
    if (fence.workflowRunId !== workflowRunId) {
        throw new Error("Workflow action fence Run identity mismatch.");
    }
    const now = new Date();
    const run = await tx.workflowRun.findFirst({
        where: {
            id: workflowRunId,
            runLeaseToken: fence.runLeaseToken,
            runLeaseExpiresAt: { gt: now },
            status: { notIn: ["completed", "failed", "cancelled"] },
        },
    });
    if (!run || run.kernelRevision !== fence.kernelRevision) {
        throw new Error("Workflow Run fence lost or Kernel revision changed.");
    }
    const job = await tx.job.findFirst({
        where: {
            id: fence.jobId,
            workflowRunId,
            kind: "workflow-activity",
            status: "leased",
            attempts: fence.attempt,
            leaseToken: fence.jobLeaseToken,
            leaseExpiresAt: { gt: now },
        },
    });
    if (!job) {
        throw new Error("Workflow Activity Job fence lost.");
    }
    const payload = parseJson<Record<string, unknown>>(job.payloadJson);
    const activity = payload?.activity;
    const activityRecord = typeof activity === "object"
        && activity !== null
        && !Array.isArray(activity)
        ? activity as Record<string, unknown>
        : null;
    if (!activityRecord
        || activityRecord.key !== fence.activity.key
        || activityRecord.path !== fence.activity.path
        || activityRecord.seq !== fence.activity.seq
        || activityRecord.kind !== fence.activity.kind
        || activityRecord.fingerprint !== fence.activity.fingerprint) {
        throw new Error("Workflow Activity identity changed under fence.");
    }
}

export async function appendDomainEvent(
    tx: Prisma.TransactionClient,
    input: {
        type: string;
        aggregateType?: string;
        aggregateId?: string;
        runId?: string | null;
        workflowRunId?: string | null;
        idempotencyKey?: string | null;
        payload: unknown;
    },
): Promise<void> {
    const data = {
        eventId: randomUUID(),
        type: input.type,
        version: "v1",
        payloadJson: JSON.stringify(input.payload),
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        runId: input.runId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
    };
    if (input.workflowRunId && input.idempotencyKey) {
        const existing = await tx.domainEvent.findFirst({
            where: {
                workflowRunId: input.workflowRunId,
                idempotencyKey: input.idempotencyKey,
            },
        });
        if (existing) {
            if (
                existing.type !== data.type
                || existing.version !== data.version
                || existing.payloadJson !== data.payloadJson
            ) {
                throw new Error(`Workflow domain event ${input.idempotencyKey} conflicts with existing payload.`);
            }
            return;
        }
    }
    try {
        await tx.domainEvent.create({ data });
    } catch (error) {
        if (!isUniqueConstraintError(error) || !input.workflowRunId || !input.idempotencyKey) {
            throw error;
        }
        const winner = await tx.domainEvent.findFirst({
            where: {
                workflowRunId: input.workflowRunId,
                idempotencyKey: input.idempotencyKey,
            },
        });
        if (!winner) throw error;
        if (
            winner.type !== data.type
            || winner.version !== data.version
            || winner.payloadJson !== data.payloadJson
        ) {
            throw new Error(`Workflow domain event ${input.idempotencyKey} conflicts with existing payload.`);
        }
    }
}

export function parseJson<T>(value: string | null): T | null {
    if (!value) {
        return null;
    }
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

export function sourceActivationRequestHash(input: SourceActivationCommand & {
    sourceId: string;
    idempotencyKey: string;
}): string {
    return `sha256:${createHash("sha256")
        .update(JSON.stringify({
            sourceId: input.sourceId,
            enabled: input.enabled,
            baseRevisionId: input.baseRevisionId,
        }))
        .digest("hex")}`;
}

export function exactTemporalValue(date: Date | null): TemporalValue | null {
    return date
        ? {
            exact: date.toISOString(),
            exactPrecision: "second",
            fallback: null,
        }
        : null;
}

export function parseCursor(cursor: string | undefined): number {
    const value = Number.parseInt(cursor ?? "0", 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Comma-separated id list from a query string; blanks are dropped. */
export function parseIdList(value: string | undefined): string[] {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

export function savedViewData(
    name: string,
    conditions: {
        text?: string | null;
        sourceId?: string | null;
        publishedAfter?: string | null;
        publishedBefore?: string | null;
        labelIds?: readonly string[] | null;
        topicIds?: readonly string[] | null;
    },
): {
    name: string;
    text: string | null;
    sourceId: string | null;
    publishedAfter: string | null;
    publishedBefore: string | null;
    labelIdsJson: string;
    topicIdsJson: string;
} {
    return {
        name: name.trim(),
        text: conditions.text?.trim() || null,
        sourceId: conditions.sourceId?.trim() || null,
        publishedAfter: conditions.publishedAfter ?? null,
        publishedBefore: conditions.publishedBefore ?? null,
        labelIdsJson: JSON.stringify(conditions.labelIds ?? []),
        topicIdsJson: JSON.stringify(conditions.topicIds ?? []),
    };
}

export function toSavedView(row: {
    id: string;
    name: string;
    text: string | null;
    sourceId: string | null;
    publishedAfter: string | null;
    publishedBefore: string | null;
    labelIdsJson: string;
    topicIdsJson: string;
    createdAt: Date;
    updatedAt: Date;
}): SavedView {
    return {
        id: row.id,
        name: row.name,
        text: row.text,
        sourceId: row.sourceId,
        publishedAfter: row.publishedAfter,
        publishedBefore: row.publishedBefore,
        labelIds: parseJson<string[]>(row.labelIdsJson) ?? [],
        topicIds: parseJson<string[]>(row.topicIdsJson) ?? [],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function toBoardBlock(row: {
    id: string;
    sectionId: string;
    type: string;
    configJson: string;
    position: number;
    visible: boolean;
    createdAt: Date;
    updatedAt: Date;
}): BoardBlock {
    const parsed = parseJson<unknown>(row.configJson);
    const config = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    return {
        id: row.id,
        sectionId: row.sectionId,
        type: row.type,
        config,
        position: row.position,
        visible: row.visible,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/**
 * Validate one block config against the contracts whitelist for its type and
 * serialize it for storage. ZodError intentionally propagates: the API funnel
 * maps it to a 400, and reaching here from storage means the API check was
 * skipped (a bug, not a client condition).
 */
export function stringifyBlockConfig(type: string, config: Record<string, unknown>): string {
    const schema = blockConfigSchemaFor(type);
    if (!schema) {
        throw new Error(`Unknown board block type: ${type}`);
    }
    return JSON.stringify(schema.parse(config));
}

export function toSpotlightPlacement(row: {
    id: string;
    boardId: string;
    targetType: string;
    targetId: string;
    source: string;
    reason: string | null;
    actorJson: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}, targetTitle: string | null): SpotlightPlacement {
    return {
        id: row.id,
        boardId: row.boardId,
        targetType: row.targetType,
        targetId: row.targetId,
        source: row.source,
        reason: row.reason,
        actor: row.actorJson == null ? null : parseJson<string>(row.actorJson),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        targetTitle,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function readPayloadSourceId(payloadJson: string | null): string | null {
    if (!payloadJson) {
        return null;
    }
    try {
        const payload = JSON.parse(payloadJson) as {
            sourceId?: unknown;
        };
        return typeof payload.sourceId === "string" && payload.sourceId
            ? payload.sourceId
            : null;
    } catch {
        return null;
    }
}
