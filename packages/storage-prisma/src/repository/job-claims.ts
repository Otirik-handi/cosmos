import { randomUUID } from "node:crypto";
import { type JobLease, type WorkflowAttemptSnapshot } from "@cosmos/application";
import { type Prisma } from "@prisma/client";
import { appendDomainEvent, assertJobLease, readPayloadSourceId } from "./repository-internals.js";
import { PrismaCosmosRepositoryRuns } from "./runs.js";

export class PrismaCosmosRepositoryJobClaims extends PrismaCosmosRepositoryRuns {
    async getWorkflowAttempt(attemptId: string): Promise<WorkflowAttemptSnapshot | null> {
        const marker = ":attempt:";
        const markerIndex = attemptId.lastIndexOf(marker);
        if (markerIndex <= 0) return null;
        const jobId = attemptId.slice(0, markerIndex);
        const number = Number.parseInt(attemptId.slice(markerIndex + marker.length), 10);
        if (!Number.isSafeInteger(number) || number <= 0) return null;
        const attempt = (await this.listWorkflowAttempts(jobId)).find((item) => item.number === number);
        return attempt ?? null;
    }

    async getCheckpoint(sourceId: string): Promise<string | null> {
        const checkpoint = await this.prisma.checkpoint.findUnique({
            where: { sourceInstanceId: sourceId },
        });
        return checkpoint?.cursor ?? null;
    }

    async getCheckpointSnapshot(sourceId: string): Promise<{
        cursor: string | null;
        revision: number;
    }> {
        const checkpoint = await this.prisma.checkpoint.findUnique({
            where: { sourceInstanceId: sourceId },
        });
        return {
            cursor: checkpoint?.cursor ?? null,
            revision: checkpoint?.revision ?? 0,
        };
    }

    async claimNextJob(input: {
        owner: string;
        leaseMs: number;
        acceptedKinds: readonly string[];
    }) {
        if (input.acceptedKinds.length === 0) {
            return null;
        }
        const now = new Date();
        try {
            return await this.prisma.$transaction(async (tx) => {
            const candidate = await tx.job.findFirst({
                where: {
                    kind: { in: [...input.acceptedKinds] },
                    OR: [
                        {
                            status: { in: ["queued", "retry_wait"] },
                            OR: [
                                { nextAttemptAt: null },
                                { nextAttemptAt: { lte: now } },
                            ],
                        },
                        {
                            status: "leased",
                            leaseExpiresAt: { lte: now },
                        },
                    ],
                },
                orderBy: { createdAt: "asc" },
            });
            if (!candidate) {
                return null;
            }

            if (candidate.attempts >= candidate.maxAttempts) {
                const sourceId = readPayloadSourceId(candidate.payloadJson);
                await tx.job.update({
                    where: { id: candidate.id },
                    data: {
                        status: "failed_terminal",
                        errorMessage: "Job exceeded its maximum attempts.",
                        leaseOwner: null,
                        leaseToken: null,
                        leaseExpiresAt: null,
                    },
                });
                if (candidate.runId) {
                    await tx.run.update({
                        where: { id: candidate.runId },
                        data: {
                            status: "failed",
                            finishedAt: now,
                            errorMessage: "Job exceeded its maximum attempts.",
                        },
                    });
                }
                await appendDomainEvent(tx, {
                    type: "job.failed_terminal.v1",
                    aggregateType: "Job",
                    aggregateId: candidate.id,
                    runId: candidate.runId,
                    payload: {
                        jobId: candidate.id,
                        runId: candidate.runId,
                        reason: "max_attempts",
                    },
                });
                this.logger?.error("job.failed_terminal", {
                    jobId: candidate.id,
                    runId: candidate.runId,
                    ...(sourceId ? { sourceId } : {}),
                    attempts: candidate.attempts,
                    maxAttempts: candidate.maxAttempts,
                    errorCode: "max_attempts",
                });
                return null;
            }

            const leaseToken = randomUUID();
            const leaseGuard = candidate.status === "leased"
                ? {
                    leaseToken: candidate.leaseToken,
                    leaseExpiresAt: candidate.leaseExpiresAt,
                }
                : {};
            const updated = await tx.job.updateMany({
                where: {
                    id: candidate.id,
                    status: candidate.status,
                    ...leaseGuard,
                },
                data: {
                    status: "leased",
                    attempts: { increment: 1 },
                    leaseOwner: input.owner,
                    leaseToken,
                    leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
                    nextAttemptAt: null,
                },
            });
            if (updated.count !== 1) {
                const sourceId = readPayloadSourceId(candidate.payloadJson);
                this.logger?.debug("job.claim_rejected", {
                    jobId: candidate.id,
                    ...(candidate.runId ? { runId: candidate.runId } : {}),
                    ...(sourceId ? { sourceId } : {}),
                    owner: input.owner,
                    status: candidate.status,
                    reason: "lease_competition",
                });
                return null;
            }
            await appendDomainEvent(tx, {
                type: "job.leased.v1",
                aggregateType: "Job",
                aggregateId: candidate.id,
                runId: candidate.runId,
                payload: {
                    jobId: candidate.id,
                    runId: candidate.runId,
                    owner: input.owner,
                    attempts: candidate.attempts + 1,
                },
            });
            return {
                id: candidate.id,
                runId: candidate.runId,
                kind: candidate.kind,
                leaseToken,
                attempts: candidate.attempts + 1,
                maxAttempts: candidate.maxAttempts,
                payload: candidate.payloadJson
                    ? JSON.parse(candidate.payloadJson) as unknown
                    : null,
            };
            });
        } catch (error) {
            this.logger?.error("storage.job.claim.failed", {
                owner: input.owner,
            }, error);
            throw error;
        }
    }

    async renewJobLease(input: {
        jobId: string;
        leaseToken: string;
        leaseMs: number;
    }): Promise<boolean> {
        try {
            const result = await this.prisma.job.updateMany({
                where: {
                    id: input.jobId,
                    leaseToken: input.leaseToken,
                    status: "leased",
                },
                data: {
                    leaseExpiresAt: new Date(Date.now() + input.leaseMs),
                },
            });
            return result.count === 1;
        } catch (error) {
            this.logger?.error("storage.job.lease_renew.failed", {
                jobId: input.jobId,
            }, error);
            throw error;
        }
    }

    async completeJob(input: {
        jobId: string;
        leaseToken: string;
        status: "succeeded" | "retry_wait" | "failed_terminal";
        error?: string | null;
        errorCode?: string | null;
        result?: unknown;
        retryDelayMs?: number;
    }): Promise<boolean> {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const job = await tx.job.findFirst({
                    where: {
                        id: input.jobId,
                        leaseToken: input.leaseToken,
                        status: "leased",
                    },
                });
                if (!job) {
                    return false;
                }
                await tx.job.update({
                    where: { id: input.jobId },
                    data: {
                        status: input.status,
                        errorMessage: input.error ?? null,
                        errorCode: input.errorCode ?? null,
                        resultJson: input.result === undefined
                            ? undefined
                            : JSON.stringify(input.result),
                        leaseExpiresAt: null,
                        leaseOwner: null,
                        leaseToken: null,
                        nextAttemptAt: input.status === "retry_wait"
                            ? new Date(Date.now() + (input.retryDelayMs ?? 30_000))
                            : null,
                    },
                });
                await appendDomainEvent(tx, {
                    type: `job.${input.status}.v1`,
                    aggregateType: "Job",
                    aggregateId: input.jobId,
                    runId: job.runId,
                    payload: {
                        jobId: input.jobId,
                        runId: job.runId,
                        status: input.status,
                        error: input.error ?? null,
                        errorCode: input.errorCode ?? null,
                        result: input.result ?? null,
                    },
                });
                return true;
            });
        } catch (error) {
            this.logger?.error("storage.job.complete.failed", {
                jobId: input.jobId,
                status: input.status,
                errorCode: input.errorCode ?? null,
            }, error);
            throw error;
        }
    }

    async resetRunForRetry(input: {
        runId: string;
        error?: string | null;
        lease?: JobLease;
    }) {
        const now = new Date();
        let run: Prisma.RunGetPayload<{}>;
        try {
            run = await this.prisma.$transaction(async (tx) => {
                if (input.lease) {
                    await assertJobLease(tx, input.runId, input.lease);
                }
                const updated = await tx.run.update({
                    where: { id: input.runId },
                    data: {
                        status: "queued",
                        startedAt: null,
                        finishedAt: null,
                        errorMessage: input.error ?? null,
                    },
                });
                await tx.step.updateMany({
                    where: { runId: input.runId },
                    data: {
                        status: "queued",
                        startedAt: null,
                        finishedAt: null,
                        errorMessage: input.error ?? null,
                    },
                });
                await appendDomainEvent(tx, {
                    type: "run.retry_wait.v1",
                    aggregateType: "Run",
                    aggregateId: input.runId,
                    runId: input.runId,
                    payload: {
                        runId: input.runId,
                        error: input.error ?? null,
                        at: now.toISOString(),
                    },
                });
                return updated;
            });
        } catch (error) {
            this.logger?.error("storage.run.retry_reset.failed", {
                runId: input.runId,
                ...(input.lease ? { jobId: input.lease.jobId } : {}),
            }, error);
            throw error;
        }
        return this.toRunSnapshot(run);
    }

    async touchWorkerHeartbeat(input: {
        instanceId: string;
        status: "starting" | "ready" | "stopped";
        version: string;
    }): Promise<void> {
        try {
            await this.prisma.workerHeartbeat.upsert({
                where: { instanceId: input.instanceId },
                create: {
                    instanceId: input.instanceId,
                    status: input.status,
                    version: input.version,
                    lastSeenAt: new Date(),
                    stoppedAt: input.status === "stopped" ? new Date() : null,
                },
                update: {
                    status: input.status,
                    version: input.version,
                    lastSeenAt: new Date(),
                    stoppedAt: input.status === "stopped" ? new Date() : null,
                },
            });
        } catch (error) {
            this.logger?.error("storage.worker_heartbeat.failed", {
                instanceId: input.instanceId,
                status: input.status,
            }, error);
            throw error;
        }
    }

}
