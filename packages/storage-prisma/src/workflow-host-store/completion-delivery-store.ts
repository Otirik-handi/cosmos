import { randomUUID } from "node:crypto";
import { WorkflowHostError, type ClaimWorkflowCompletionInput, type DeadLetterWorkflowCompletionInput, type DeliverWorkflowCompletionInput, type HeartbeatWorkflowCompletionInput, type RequeueWorkflowCompletionInput, type WorkflowCompletionClaim } from "@cosmos/application";
import { PrismaWorkflowHostActivityStore } from "./activity-store.js";
import { type WorkflowCompletionRow, type WorkflowRunRow, assertValidDate, completionBackoffMs, parseIsoDate, parseJson, requireNonEmptyString, validateLeaseMs } from "./internals-core.js";
import { activityCompletionForState, normalizeRunLease, previousCompletionLeaseGuard, toCompletion } from "./internals-activity.js";
import { hasCurrentRunLease } from "./internals-events-lease.js";

export class PrismaWorkflowHostCompletionDeliveryStore extends PrismaWorkflowHostActivityStore {
    async heartbeatWorkflowCompletion(
        input: HeartbeatWorkflowCompletionInput,
    ): Promise<boolean> {
        validateLeaseMs(input.leaseMs);
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const result = await this.prisma.workflowCompletion.updateMany({
            where: {
                id: requireNonEmptyString(input.completionId, "completionId"),
                status: "leased",
                leaseOwner: requireNonEmptyString(input.owner, "owner"),
                leaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                leaseExpiresAt: { gt: now },
            },
            data: {
                leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
            },
        });
        return result.count === 1;
    }

    async claimWorkflowCompletion(
        input: ClaimWorkflowCompletionInput,
    ): Promise<WorkflowCompletionClaim | null> {
        validateLeaseMs(input.leaseMs);
        const owner = requireNonEmptyString(input.owner, "owner");
        const now = input.now ?? new Date();
        assertValidDate(now, "now");

        return this.prisma.$transaction(async (tx) => {
            const candidates = await tx.workflowCompletion.findMany({
                where: {
                    availableAt: { lte: now },
                    OR: [
                        { status: "queued" },
                        { status: "leased", leaseExpiresAt: { lte: now } },
                    ],
                },
                orderBy: [
                    { availableAt: "asc" },
                    { createdAt: "asc" },
                    { id: "asc" },
                ],
                take: 100,
            });
            for (const candidate of candidates) {
                const completionRow = candidate as WorkflowCompletionRow;
                const completion = toCompletion(completionRow);
                const leaseToken = randomUUID();
                const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
                const updated = await tx.workflowCompletion.updateMany({
                    where: {
                        id: candidate.id,
                        status: candidate.status,
                        ...previousCompletionLeaseGuard(completionRow),
                    },
                    data: {
                        status: "leased",
                        attempts: { increment: 1 },
                        leaseOwner: owner,
                        leaseToken,
                        leaseExpiresAt,
                    },
                });
                if (updated.count !== 1) continue;
                const claimed = await tx.workflowCompletion.findUnique({
                    where: { id: candidate.id },
                });
                if (!claimed) {
                    throw new WorkflowHostError(
                        "not_found",
                        `Workflow completion ${candidate.id} disappeared after claim.`,
                    );
                }
                const claimedRow = claimed as WorkflowCompletionRow;
                return {
                    ...completion,
                    status: "leased",
                    leaseOwner: owner,
                    leaseToken,
                    leaseExpiresAt: leaseExpiresAt.toISOString(),
                    attempts: claimedRow.attempts,
                    maxAttempts: claimedRow.maxAttempts,
                    updatedAt: claimedRow.updatedAt.toISOString(),
                } satisfies WorkflowCompletionClaim;
            }
            return null;
        });
    }

    async deliverWorkflowCompletion(
        input: DeliverWorkflowCompletionInput,
    ): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const completionId = requireNonEmptyString(input.completionId, "completionId");
        const owner = requireNonEmptyString(input.owner, "owner");
        const leaseToken = requireNonEmptyString(input.leaseToken, "leaseToken");
        const runLease = normalizeRunLease(input.runLease);

        return this.prisma.$transaction(async (tx) => {
            const completionRow = await tx.workflowCompletion.findFirst({
                where: {
                    id: completionId,
                    status: "leased",
                    leaseOwner: owner,
                    leaseToken,
                    leaseExpiresAt: { gt: now },
                    workflowRunId: runLease.runId,
                },
            });
            if (!completionRow) return false;
            const completion = toCompletion(completionRow as WorkflowCompletionRow);
            const run = await tx.workflowRun.findUnique({ where: { id: runLease.runId } });
            if (!run || !hasCurrentRunLease(run as WorkflowRunRow, runLease, now)) return false;
            const state = parseJson(run.stateJson, `Workflow run ${run.id} state`);
            const accepted = activityCompletionForState(
                state,
                completion.completion,
                run.kernelRevision,
            );
            if (!accepted) return false;
            const updated = await tx.workflowCompletion.updateMany({
                where: {
                    id: completionId,
                    status: "leased",
                    leaseOwner: owner,
                    leaseToken,
                    leaseExpiresAt: { gt: now },
                    workflowRunId: runLease.runId,
                },
                data: {
                    status: "delivered",
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                },
            });
            return updated.count === 1;
        });
    }
    async requeueWorkflowCompletion(
        input: RequeueWorkflowCompletionInput,
    ): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const requestedAt = input.availableAt === undefined
            ? new Date(now.getTime() + completionBackoffMs(1))
            : parseIsoDate(input.availableAt, "availableAt");
        const error = input.error === undefined || input.error === null
            ? null
            : String(input.error);
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.workflowCompletion.findUnique({
                where: { id: requireNonEmptyString(input.completionId, "completionId") },
            });
            if (!row) return false;
            const current = row as WorkflowCompletionRow;
            if (
                current.status !== "leased"
                || current.leaseOwner !== requireNonEmptyString(input.owner, "owner")
                || current.leaseToken !== requireNonEmptyString(input.leaseToken, "leaseToken")
                || !current.leaseExpiresAt
                || current.leaseExpiresAt.getTime() <= now.getTime()
            ) return false;
            if (current.attempts >= current.maxAttempts) {
                const terminal = await tx.workflowCompletion.updateMany({
                    where: {
                        id: current.id,
                        status: "leased",
                        leaseOwner: current.leaseOwner,
                        leaseToken: current.leaseToken,
                        leaseExpiresAt: { gt: now },
                    },
                    data: {
                        status: "dead_letter",
                        lastError: error ?? "Workflow completion exceeded maximum delivery attempts.",
                        leaseOwner: null,
                        leaseToken: null,
                        leaseExpiresAt: null,
                    },
                });
                return terminal.count === 1;
            }
            const updated = await tx.workflowCompletion.updateMany({
                where: {
                    id: current.id,
                    status: "leased",
                    leaseOwner: current.leaseOwner,
                    leaseToken: current.leaseToken,
                    leaseExpiresAt: { gt: now },
                },
                data: {
                    status: "queued",
                    availableAt: requestedAt,
                    lastError: error,
                    leaseOwner: null,
                    leaseToken: null,
                    leaseExpiresAt: null,
                },
            });
            return updated.count === 1;
        });
    }
    async deadLetterWorkflowCompletion(
        input: DeadLetterWorkflowCompletionInput,
    ): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const error = requireNonEmptyString(input.error, "error");
        const updated = await this.prisma.workflowCompletion.updateMany({
            where: {
                id: requireNonEmptyString(input.completionId, "completionId"),
                status: "leased",
                leaseOwner: requireNonEmptyString(input.owner, "owner"),
                leaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                leaseExpiresAt: { gt: now },
            },
            data: {
                status: "dead_letter",
                lastError: error,
                leaseOwner: null,
                leaseToken: null,
                leaseExpiresAt: null,
            },
        });
        return updated.count === 1;
    }

}
