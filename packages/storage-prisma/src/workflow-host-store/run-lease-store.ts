import { randomUUID } from "node:crypto";
import { type ClaimWorkflowRunInput, type HeartbeatWorkflowRunInput, type ReleaseWorkflowRunInput, type WorkflowRunLease } from "@cosmos/application";
import { PrismaWorkflowHostEnvelopeStore } from "./envelope-store.js";
import { TERMINAL_RUN_STATUSES, type WorkflowRunRow, assertValidDate, invalidState, requireNonEmptyString, validateLeaseMs } from "./internals-core.js";
import { previousRunLeaseGuard } from "./internals-activity.js";

export class PrismaWorkflowHostRunLeaseStore extends PrismaWorkflowHostEnvelopeStore {
    async claimRun(input: ClaimWorkflowRunInput): Promise<WorkflowRunLease | null> {
        validateLeaseMs(input.leaseMs);
        const owner = requireNonEmptyString(input.owner, "owner");
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const purpose = input.purpose ?? "execution";
        const requestedRunId = input.runId === undefined
            ? undefined
            : requireNonEmptyString(input.runId, "runId");
        if (purpose !== "execution" && requestedRunId === undefined) {
            throw invalidState(`Run claim purpose ${purpose} requires a runId.`);
        }

        return this.prisma.$transaction(async (tx) => {
            const candidate = await tx.workflowRun.findFirst({
                where: purpose === "execution"
                    ? {
                        ...(requestedRunId ? { id: requestedRunId } : {}),
                        OR: [
                            { status: "queued" },
                            { status: "running" },
                            { status: "waiting", resumeRequired: true },
                        ],
                        AND: [{
                            OR: [
                                {
                                    runLeaseOwner: null,
                                    runLeaseToken: null,
                                    runLeaseExpiresAt: null,
                                },
                                { runLeaseExpiresAt: { lte: now } },
                            ],
                        }],
                    }
                    : {
                        id: requestedRunId!,
                        AND: [
                            {
                                OR: [
                                    { status: { notIn: [...TERMINAL_RUN_STATUSES] } },
                                    {
                                        status: { in: [...TERMINAL_RUN_STATUSES] },
                                        completions: {
                                            some: {
                                                status: "leased",
                                                leaseOwner: owner,
                                                leaseExpiresAt: { gt: now },
                                            },
                                        },
                                    },
                                ],
                            },
                            {
                                OR: [
                                    {
                                        runLeaseOwner: null,
                                        runLeaseToken: null,
                                        runLeaseExpiresAt: null,
                                    },
                                    { runLeaseExpiresAt: { lte: now } },
                                ],
                            },
                        ],
                    },
                orderBy: purpose === "execution"
                    ? [{ createdAt: "asc" }, { id: "asc" }]
                    : undefined,
            });
            if (!candidate && purpose !== "execution" && requestedRunId) {
                const existing = await tx.workflowRun.findUnique({
                    where: { id: requestedRunId },
                });
                if (
                    existing
                    && existing.runLeaseOwner === owner
                    && existing.runLeaseToken
                    && existing.runLeaseExpiresAt
                    && existing.runLeaseExpiresAt.getTime() > now.getTime()
                ) {
                    return {
                        runId: existing.id,
                        leaseToken: existing.runLeaseToken,
                        owner,
                        leaseExpiresAt: existing.runLeaseExpiresAt.toISOString(),
                    };
                }
                return null;
            }
            if (!candidate) {
                return null;
            }

            const leaseToken = randomUUID();
            const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
            const leaseGuard = previousRunLeaseGuard(candidate as WorkflowRunRow);
            const updated = await tx.workflowRun.updateMany({
                where: {
                    id: candidate.id,
                    status: candidate.status,
                    resumeRequired: candidate.resumeRequired,
                    ...leaseGuard,
                },
                data: purpose === "execution"
                    ? {
                        status: "running",
                        resumeRequired: candidate.resumeRequired,
                        runLeaseOwner: owner,
                        runLeaseToken: leaseToken,
                        runLeaseExpiresAt: leaseExpiresAt,
                        startedAt: candidate.startedAt ?? now,
                    }
                    : {
                        runLeaseOwner: owner,
                        runLeaseToken: leaseToken,
                        runLeaseExpiresAt: leaseExpiresAt,
                        startedAt: candidate.startedAt ?? now,
                    }
            });
            if (updated.count !== 1) {
                return null;
            }
            return {
                runId: candidate.id,
                leaseToken,
                owner,
                leaseExpiresAt: leaseExpiresAt.toISOString(),
            };
        });
    }

    async heartbeatRun(input: HeartbeatWorkflowRunInput): Promise<boolean> {
        validateLeaseMs(input.leaseMs);
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const result = await this.prisma.workflowRun.updateMany({
            where: {
                id: requireNonEmptyString(input.runId, "runId"),
                runLeaseOwner: requireNonEmptyString(input.owner, "owner"),
                runLeaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                runLeaseExpiresAt: { gt: now },
                status: { in: ["running", "waiting"] },
            },
            data: {
                runLeaseExpiresAt: new Date(now.getTime() + input.leaseMs),
            },
        });
        return result.count === 1;
    }

    async releaseRun(input: ReleaseWorkflowRunInput): Promise<boolean> {
        const now = input.now ?? new Date();
        assertValidDate(now, "now");
        const result = await this.prisma.workflowRun.updateMany({
            where: {
                id: requireNonEmptyString(input.runId, "runId"),
                runLeaseOwner: requireNonEmptyString(input.owner, "owner"),
                runLeaseToken: requireNonEmptyString(input.leaseToken, "leaseToken"),
                runLeaseExpiresAt: { gt: now },
            },
            data: {
                runLeaseOwner: null,
                runLeaseToken: null,
                runLeaseExpiresAt: null,
            },
        });
        return result.count === 1;
    }

}
