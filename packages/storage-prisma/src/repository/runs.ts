import { randomUUID } from "node:crypto";
import { type JobSnapshot, type SourceConfigProbeCommand } from "@cosmos/contracts";
import { type CosmosRepository, type JobLease } from "@cosmos/application";
import { type Prisma } from "@prisma/client";
import { appendDomainEvent, assertJobLease } from "./repository-internals.js";
import { PrismaCosmosRepositorySources } from "./sources.js";

export class PrismaCosmosRepositoryRuns extends PrismaCosmosRepositorySources {
    async createRun(input: {
        sourceId: string;
        triggerKind: "manual" | "schedule";
    }): Promise<Awaited<ReturnType<CosmosRepository["getRun"]>> extends infer T
        ? Exclude<T, null>
        : never> {
        const now = new Date();
        try {
            const run = await this.prisma.$transaction(async (tx) => {
            const created = await tx.run.create({
                data: {
                    sourceInstanceId: input.sourceId,
                    triggerKind: input.triggerKind,
                    status: "running",
                    startedAt: now,
                },
            });
            const step = await tx.step.create({
                data: {
                    runId: created.id,
                    position: 0,
                    kind: "ingest",
                    status: "running",
                    startedAt: now,
                },
            });
            await tx.job.create({
                data: {
                    runId: created.id,
                    stepId: step.id,
                    kind: "source-ingest",
                    status: "leased",
                    payloadJson: JSON.stringify({ sourceId: input.sourceId }),
                    idempotencyKey: `run:${created.id}:ingest`,
                    attempts: 1,
                    leaseOwner: "synchronous-ingest",
                    leaseToken: randomUUID(),
                    leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
                },
            });
            await appendDomainEvent(tx, {
                type: "run.queued.v1",
                aggregateType: "Run",
                aggregateId: created.id,
                runId: created.id,
                payload: { runId: created.id, sourceId: input.sourceId },
            });
            return created;
            });
            return this.toRunSnapshot(run);
        } catch (error) {
            this.logger?.error("storage.run.create.failed", {
                sourceId: input.sourceId,
                triggerKind: input.triggerKind,
            }, error);
            throw error;
        }
    }

    async createQueuedRun(input: {
        sourceId: string;
        triggerKind: "manual" | "schedule";
        idempotencyKey?: string;
    }) {
        try {
            const run = await this.prisma.$transaction(async (tx) => {
            if (input.idempotencyKey) {
                const existingJob = await tx.job.findUnique({
                    where: { idempotencyKey: input.idempotencyKey },
                    include: { run: true },
                });
                if (existingJob?.run) {
                    return existingJob.run;
                }
            }

            const created = await tx.run.create({
                data: {
                    sourceInstanceId: input.sourceId,
                    triggerKind: input.triggerKind,
                    status: "queued",
                },
            });
            const step = await tx.step.create({
                data: {
                    runId: created.id,
                    position: 0,
                    kind: "ingest",
                    status: "queued",
                },
            });
            await tx.job.create({
                data: {
                    runId: created.id,
                    stepId: step.id,
                    kind: "source-ingest",
                    status: "queued",
                    payloadJson: JSON.stringify({ sourceId: input.sourceId }),
                    idempotencyKey: input.idempotencyKey ?? `run:${created.id}:ingest`,
                },
            });
            await appendDomainEvent(tx, {
                type: "run.queued.v1",
                aggregateType: "Run",
                aggregateId: created.id,
                runId: created.id,
                payload: { runId: created.id, sourceId: input.sourceId },
            });
            return created;
            });
            return this.toRunSnapshot(run);
        } catch (error) {
            this.logger?.error("storage.run.queue.failed", {
                sourceId: input.sourceId,
                triggerKind: input.triggerKind,
            }, error);
            throw error;
        }
    }

    async createProbeJob(input: {
        sourceId: string;
        idempotencyKey?: string;
    }): Promise<JobSnapshot> {
        try {
            const job = await this.prisma.$transaction(async (tx) => {
            if (input.idempotencyKey) {
                const existing = await tx.job.findUnique({
                    where: { idempotencyKey: input.idempotencyKey },
                });
                if (existing) {
                    return existing;
                }
            }

            const created = await tx.job.create({
                data: {
                    kind: "source-probe",
                    status: "queued",
                    payloadJson: JSON.stringify({ sourceId: input.sourceId }),
                    idempotencyKey: input.idempotencyKey
                        ?? `probe:${input.sourceId}:${randomUUID()}`,
                },
            });
            await appendDomainEvent(tx, {
                type: "job.queued.v1",
                aggregateType: "Job",
                aggregateId: created.id,
                payload: {
                    jobId: created.id,
                    kind: created.kind,
                    sourceId: input.sourceId,
                },
            });
            return created;
            });
            return this.toJobSnapshot(job);
        } catch (error) {
            this.logger?.error("storage.job.queue.failed", {
                sourceId: input.sourceId,
                kind: "source-probe",
            }, error);
            throw error;
        }
    }

    async createConfigProbeJob(input: {
        command: SourceConfigProbeCommand;
        idempotencyKey?: string;
    }): Promise<JobSnapshot> {
        try {
            const job = await this.prisma.$transaction(async (tx) => {
                if (input.idempotencyKey) {
                    const existing = await tx.job.findUnique({
                        where: { idempotencyKey: input.idempotencyKey },
                    });
                    if (existing) {
                        return existing;
                    }
                }

                const created = await tx.job.create({
                    data: {
                        kind: "source-config-probe",
                        status: "queued",
                        payloadJson: JSON.stringify({ configProbe: input.command }),
                        idempotencyKey: input.idempotencyKey
                            ?? `config-probe:${randomUUID()}`,
                    },
                });
                await appendDomainEvent(tx, {
                    type: "job.queued.v1",
                    aggregateType: "Job",
                    aggregateId: created.id,
                    payload: {
                        jobId: created.id,
                        kind: created.kind,
                        sourceId: null,
                    },
                });
                return created;
            });
            return this.toJobSnapshot(job);
        } catch (error) {
            this.logger?.error("storage.job.queue.failed", {
                kind: "source-config-probe",
            }, error);
            throw error;
        }
    }

    async startRun(runId: string, lease?: JobLease) {
        const now = new Date();
        let run: Prisma.RunGetPayload<{}>;
        try {
            run = await this.prisma.$transaction(async (tx) => {
                if (lease) {
                    await assertJobLease(tx, runId, lease);
                }
                const updated = await tx.run.update({
                    where: { id: runId },
                    data: {
                        status: "running",
                        startedAt: now,
                        finishedAt: null,
                    },
                });
                await tx.step.updateMany({
                    where: { runId },
                    data: {
                        status: "running",
                        attempts: { increment: 1 },
                        startedAt: now,
                        finishedAt: null,
                    },
                });
                await appendDomainEvent(tx, {
                    type: "run.started.v1",
                    aggregateType: "Run",
                    aggregateId: runId,
                    runId,
                    payload: { runId },
                });
                return updated;
            });
        } catch (error) {
            this.logger?.error("storage.run.start.failed", {
                runId,
                ...(lease ? { jobId: lease.jobId } : {}),
            }, error);
            throw error;
        }
        return this.toRunSnapshot(run);
    }

    async getJob(jobId: string): Promise<JobSnapshot | null> {
        const job = await this.prisma.job.findUnique({
            where: { id: jobId },
        });
        return job ? this.toJobSnapshot(job) : null;
    }

    async latestEventSequence(): Promise<number> {
        const result = await this.prisma.domainEvent.aggregate({
            _max: { sequence: true },
        });
        return result._max.sequence ?? 0;
    }

}
