/** 采集 Worker 循环。 */

import {
    RunFinalizationError,
} from "./errors.js";
import {
    IngestionService,
} from "./ingestion-service.js";
import type {
    ClaimedJob, CompleteJobInput, IngestionWorkerOptions, WorkerJobResult,
} from "./ingestion-service.js";
import {
    normalizeFailure, readConfigProbeCommand, readOptionalSourceId, readSourceId,
    retryDelayMs,
} from "./internals.js";
import {
    resolveLogger,
} from "./logger.js";
import type {
    LoggerPort,
} from "./logger.js";
import type {
    CosmosRepository,
} from "./repository-port.js";

export class IngestionWorker {
    private readonly now: () => Date;
    private readonly logger: LoggerPort;

    constructor(
        private readonly repository: CosmosRepository,
        private readonly ingestion: IngestionService,
        private readonly options: IngestionWorkerOptions,
    ) {
        this.now = options.now ?? (() => new Date());
        this.logger = resolveLogger(options.logger);
    }

    async pollOnce(): Promise<WorkerJobResult | null> {
        if (this.options.schedule !== false) {
            await this.queueScheduledSources();
        }
        const job = await this.repository.claimNextJob({
            owner: this.options.owner,
            leaseMs: this.options.leaseMs,
            acceptedKinds: ["source-ingest", "source-probe", "source-config-probe"],
        });
        if (!job) {
            return null;
        }
        const sourceId = readOptionalSourceId(job.payload);
        const logger = this.logger.child({
            jobId: job.id,
            ...(job.runId ? { runId: job.runId } : {}),
            ...(sourceId ? { sourceId } : {}),
        });
        logger.info("job.claimed", {
            kind: job.kind,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
        });

        const leaseHeartbeatMs = Math.max(
            1_000,
            Math.floor(this.options.leaseMs / 3),
        );
        const leaseHeartbeat = setInterval(() => {
            void (async () => {
                const renewed = await logger.withContext(
                    {
                        jobId: job.id,
                        ...(job.runId ? { runId: job.runId } : {}),
                        ...(sourceId ? { sourceId } : {}),
                    },
                    () => this.repository.renewJobLease({
                        jobId: job.id,
                        leaseToken: job.leaseToken,
                        leaseMs: this.options.leaseMs,
                    }),
                );
                if (!renewed) {
                    logger.warn("job.lease_lost", {
                        kind: job.kind,
                    });
                    return;
                }
                logger.debug("job.lease_renewed", {
                    kind: job.kind,
                });
            })().catch((error) => {
                logger.error("job.lease_renew_failed", {
                    kind: job.kind,
                }, error);
            });
        }, leaseHeartbeatMs);
        try {
            if (job.kind !== "source-ingest" || !job.runId) {
                if (job.kind === "source-probe" && !job.runId && this.options.probe) {
                    const result = await logger.withContext(
                        {
                            jobId: job.id,
                            ...(sourceId ? { sourceId } : {}),
                        },
                        () => this.options.probe!.runSource(
                            readSourceId(job.payload),
                        ),
                    );
                    const completed = await this.completeClaimedJob(job, logger, {
                        status: "succeeded",
                        result,
                    });
                    if (completed) {
                        logger.info("job.completed", {
                            kind: job.kind,
                            status: "succeeded",
                            attempts: job.attempts,
                        });
                    }
                    return completed
                        ? {
                            jobId: job.id,
                            runId: null,
                            status: "succeeded",
                            attempts: job.attempts,
                        }
                        : null;
                }
                if (job.kind === "source-config-probe" && !job.runId && this.options.configProbe) {
                    const command = readConfigProbeCommand(job.payload);
                    const result = await logger.withContext(
                        { jobId: job.id },
                        () => this.options.configProbe!.run(command),
                    );
                    const completed = await this.completeClaimedJob(job, logger, {
                        status: "succeeded",
                        result,
                    });
                    if (completed) {
                        logger.info("job.completed", {
                            kind: job.kind,
                            status: "succeeded",
                            attempts: job.attempts,
                        });
                    }
                    return completed
                        ? {
                            jobId: job.id,
                            runId: null,
                            status: "succeeded",
                            attempts: job.attempts,
                        }
                        : null;
                }
                const completed = await this.completeClaimedJob(job, logger, {
                    status: "failed_terminal",
                    error: `Unsupported job: ${job.kind}`,
                });
                if (!completed) {
                    return null;
                }
                logger.error("job.failed_terminal", {
                    kind: job.kind,
                    status: "failed_terminal",
                    attempts: job.attempts,
                    errorCode: "unsupported_job",
                });
                return {
                    jobId: job.id,
                    runId: job.runId,
                    status: "failed_terminal",
                    attempts: job.attempts,
                };
            }

            const result = await logger.withContext(
                {
                    jobId: job.id,
                    runId: job.runId,
                    ...(sourceId ? { sourceId } : {}),
                },
                () => this.ingestion.runExistingRunWithLease(job.runId!, {
                    jobId: job.id,
                    leaseToken: job.leaseToken,
                }),
            );
            if (result.run.status === "succeeded") {
                const completed = await this.completeClaimedJob(job, logger, {
                    status: "succeeded",
                });
                if (completed) {
                    logger.info("job.completed", {
                        kind: job.kind,
                        status: "succeeded",
                        attempts: job.attempts,
                    });
                }
                return completed
                    ? {
                        jobId: job.id,
                        runId: job.runId,
                        status: "succeeded",
                        attempts: job.attempts,
                    }
                    : null;
            }

            return this.finishFailedJob(job, {
                message: result.run.error ?? "Ingest failed.",
                code: result.errorCode ?? null,
                retryable: result.retryable ?? true,
            });
        } catch (error) {
            if (error instanceof RunFinalizationError) {
                logger.error("job.run_completion_failed", {
                    kind: job.kind,
                    status: "unknown",
                    attempts: job.attempts,
                }, error);
                return null;
            }
            return this.finishFailedJob(
                job,
                error instanceof Error ? error.message : String(error),
            );
        } finally {
            clearInterval(leaseHeartbeat);
        }
    }

    async queueScheduledSources(): Promise<void> {
        const now = this.now();
        const triggers = await this.repository.listScheduleTriggers();
        for (const trigger of triggers) {
            const interval = trigger.intervalMs;
            const lastRunAt = trigger.lastRunAt
                ? Date.parse(trigger.lastRunAt)
                : Number.NEGATIVE_INFINITY;
            if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < interval) {
                continue;
            }
            const bucket = Math.floor(now.getTime() / interval);
            try {
                const run = await this.repository.createQueuedRun({
                    sourceId: trigger.sourceId,
                    triggerKind: "schedule",
                    idempotencyKey: `schedule:${trigger.sourceId}:${bucket}`,
                });
                this.logger.child({
                    runId: run.id,
                    sourceId: trigger.sourceId,
                }).info("run.queued", {
                    triggerKind: "schedule",
                    status: run.status,
                });
            } catch (error) {
                this.logger.child({
                    sourceId: trigger.sourceId,
                }).error("run.queue_failed", {
                    triggerKind: "schedule",
                }, error);
                throw error;
            }
        }
    }

    private async completeClaimedJob(
        job: ClaimedJob,
        logger: LoggerPort,
        input: Omit<CompleteJobInput, "jobId" | "leaseToken">,
    ): Promise<boolean> {
        const sourceId = readOptionalSourceId(job.payload);
        try {
            const completed = await logger.withContext(
                {
                    jobId: job.id,
                    ...(job.runId ? { runId: job.runId } : {}),
                    ...(sourceId ? { sourceId } : {}),
                },
                () => this.repository.completeJob({
                    jobId: job.id,
                    leaseToken: job.leaseToken,
                    ...input,
                }),
            );
            if (!completed) {
                logger.warn("job.completion_rejected", {
                    kind: job.kind,
                    status: input.status,
                    attempts: job.attempts,
                });
            }
            return completed;
        } catch (error) {
            logger.error("job.completion_failed", {
                kind: job.kind,
                status: input.status,
                attempts: job.attempts,
            }, error);
            return false;
        }
    }

    private async finishFailedJob(
        job: ClaimedJob,
        error: unknown,
    ): Promise<WorkerJobResult | null> {
        const failure = normalizeFailure(error);
        const message = failure.message;
        const errorCode = failure.code;
        const terminal = job.attempts >= job.maxAttempts
            || !failure.retryable;
        const sourceId = readOptionalSourceId(job.payload);
        const logger = this.logger.child({
            jobId: job.id,
            ...(job.runId ? { runId: job.runId } : {}),
            ...(sourceId ? { sourceId } : {}),
        });
        if (!terminal && job.runId) {
            try {
                await logger.withContext(
                    {
                        jobId: job.id,
                        runId: job.runId,
                        ...(sourceId ? { sourceId } : {}),
                    },
                    () => this.repository.resetRunForRetry({
                        runId: job.runId!,
                        error: message,
                        lease: {
                            jobId: job.id,
                            leaseToken: job.leaseToken,
                        },
                    }),
                );
            } catch (resetError) {
                logger.error("job.retry_reset_failed", {
                    attempts: job.attempts,
                    maxAttempts: job.maxAttempts,
                    errorCode,
                }, resetError);
                return null;
            }
        }
        const retryDelay = terminal
            ? undefined
            : retryDelayMs(job.attempts);
        const completed = await this.completeClaimedJob(job, logger, {
            status: terminal ? "failed_terminal" : "retry_wait",
            error: message,
            errorCode,
            retryDelayMs: retryDelay,
        });
        if (completed) {
            logger[terminal ? "error" : "warn"](
                terminal ? "job.failed_terminal" : "job.retry_scheduled",
                {
                    status: terminal ? "failed_terminal" : "retry_wait",
                    attempts: job.attempts,
                    maxAttempts: job.maxAttempts,
                    errorCode,
                    retryDelayMs: retryDelay,
                },
                error,
            );
        }
        return completed
            ? {
                jobId: job.id,
                runId: job.runId,
                status: terminal ? "failed_terminal" : "retry_wait",
                attempts: job.attempts,
            }
            : null;
    }
}
