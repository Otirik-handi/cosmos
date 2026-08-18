import type {
    IngestionWorker,
    LoggerPort,
    WorkflowActivityWorkerResult,
    WorkflowCompletionDispatcherResult,
    WorkflowRunLaneResult,
} from "@cosmos/application";
import type { IngestWorkflowControlService } from "@cosmos/application/workflow-control";
import type { PrismaCosmosRepository } from "@cosmos/storage-prisma";
import type { WorkerAdminServer } from "@cosmos/worker-admin";
import type { WorkflowHostComposition } from "./workflow-host.js";
import type { WorkerRuntimeConfig } from "./config.js";

export interface WorkerShutdownResult {
    reason: string;
    status: "succeeded" | "timed_out" | "failed";
    resourcesClosed: boolean;
}

export interface WorkerRuntimeOptions {
    repository: PrismaCosmosRepository;
    workflowHost: WorkflowHostComposition | null;
    workflowControl: IngestWorkflowControlService | null;
    worker: IngestionWorker;
    workerAdminServer: WorkerAdminServer | null;
    logger: LoggerPort;
    closeLogger: () => Promise<void>;
    config: WorkerRuntimeConfig;
    instanceId: string;
    heartbeat: (status: "starting" | "ready" | "stopped") => Promise<void>;
    queueScheduledWorkflowSources: () => Promise<void>;
    activeAttemptCount?: () => number;
}

type PollResult = {
    run: WorkflowRunLaneResult | null;
    activity: WorkflowActivityWorkerResult | null;
    completion: WorkflowCompletionDispatcherResult | null;
    legacy: Awaited<ReturnType<IngestionWorker["pollOnce"]>>;
};

export class WorkerRuntime {
    private polling = false;
    private started = false;
    private shuttingDown = false;
    private timer: ReturnType<typeof setInterval> | undefined;
    private currentPoll: Promise<void> | null = null;
    private shutdownPromise: Promise<WorkerShutdownResult> | null = null;

    constructor(private readonly options: WorkerRuntimeOptions) {}

    async start(): Promise<void> {
        if (this.started) {
            throw new Error("WorkerRuntime has already started.");
        }
        this.started = true;
        await this.pollOnce();
        if (this.shuttingDown) return;
        this.timer = setInterval(() => {
            void this.pollOnce();
        }, this.options.config.pollMs);
    }
    async pollOnce(): Promise<void> {
        if (this.polling || this.shuttingDown) return;
        const operation = this.runPoll();
        this.currentPoll = operation;
        await operation;
    }

    async requestShutdown(reason: string): Promise<WorkerShutdownResult> {
        if (this.shutdownPromise) return this.shutdownPromise;
        this.shuttingDown = true;
        clearInterval(this.timer);
        this.timer = undefined;
        this.shutdownPromise = this.finishShutdown(reason, false);
        return this.shutdownPromise;
    }

    async forceShutdown(reason: string): Promise<WorkerShutdownResult> {
        if (this.shutdownPromise) return this.shutdownPromise;
        this.shuttingDown = true;
        clearInterval(this.timer);
        this.timer = undefined;
        this.abortActive(reason);
        this.options.logger.error("worker.shutdown.timed_out", {
            reason,
            activeAttempts: this.options.activeAttemptCount?.() ?? 0,
        });
        this.shutdownPromise = this.finishShutdown(reason, true);
        return this.shutdownPromise;
    }

    private async runPoll(): Promise<void> {
        this.polling = true;
        try {
            const result: PollResult = {
                run: null,
                activity: null,
                completion: null,
                legacy: null,
            };
            if (this.options.workflowHost && this.options.workflowControl) {
                await this.runLane("workflow-schedule", async () => {
                    try {
                        await this.options.queueScheduledWorkflowSources();
                    } catch (error) {
                        this.options.logger.error("workflow.run.schedule_failed", {}, error);
                    }
                }, false);
                result.run = await this.runLane(
                    "workflow-run",
                    async () => {
                        const recovered = await this.options.workflowHost!.store.listRunsForRecovery({ limit: 1 });
                        return recovered[0]
                            ? this.options.workflowHost!.runLane.pollOnce({ runId: recovered[0].runId })
                            : this.options.workflowHost!.runLane.pollOnce();
                    },
                ) as WorkflowRunLaneResult | null;
                result.activity = await this.runLane(
                    "workflow-activity",
                    () => this.options.workflowHost!.activityWorker.pollOnce(),
                ) as WorkflowActivityWorkerResult | null;
                result.completion = await this.runLane(
                    "workflow-completion",
                    () => this.options.workflowHost!.completionDispatcher.pollOnce(),
                ) as WorkflowCompletionDispatcherResult | null;
                if (result.run) this.options.workerAdminServer?.service.recordClaim("workflow-run");
                if (result.activity?.accepted) this.options.workerAdminServer?.service.recordClaim("workflow-activity");
                if (result.completion) this.options.workerAdminServer?.service.recordClaim("workflow-completion");
            }
            result.legacy = await this.runLane("legacy", () => this.options.worker.pollOnce());
            if (result.legacy) this.options.workerAdminServer?.service.recordClaim("legacy");
            if (result.run || result.activity || result.completion || result.legacy) {
                this.options.logger.info("worker.poll.completed", {
                    runStatus: result.run?.status ?? null,
                    activityAccepted: result.activity?.accepted ?? null,
                    completionStatus: result.completion?.status ?? null,
                    legacyStatus: result.legacy?.status ?? null,
                });
            }
        } finally {
            this.polling = false;
            this.currentPoll = null;
            void this.options.heartbeat("ready").catch((error) => {
                this.options.logger.error("worker.heartbeat_failed", {}, error);
            });
        }
    }

    private async runLane<T>(
        lane: string,
        operation: () => Promise<T>,
        track = true,
    ): Promise<T | null> {
        const service = this.options.workerAdminServer?.service;
        if (track && service && !service.beginPoll(lane)) return null;
        let failure: unknown;
        try {
            return await operation();
        } catch (error) {
            failure = error;
            this.options.logger.error("worker.lane_failed", { lane }, error);
            return null;
        } finally {
            if (track) service?.endPoll(lane, failure);
        }
    }

    private async finishShutdown(
        reason: string,
        forced: boolean,
    ): Promise<WorkerShutdownResult> {
        if (!forced) {
            const settled = await this.waitForWork(this.options.config.shutdownDeadlineMs);
            if (!settled) {
                this.abortActive(reason);
                return this.finishShutdown(reason, true);
            }
        }

        let failed = false;
        try {
            await this.options.heartbeat("stopped");
        } catch (error) {
            failed = true;
            this.options.logger.error("worker.stop_failed", { reason, stage: "heartbeat.stopped" }, error);
        }
        try {
            await this.options.workerAdminServer?.close();
        } catch (error) {
            failed = true;
            this.options.logger.error("worker.stop_failed", { reason, stage: "admin.close" }, error);
        }
        this.options.workerAdminServer?.service.markStopped();
        try {
            await this.options.repository.close();
        } catch (error) {
            failed = true;
            this.options.logger.error("worker.stop_failed", { reason, stage: "repository.close" }, error);
        }
        try {
            await this.options.closeLogger();
        } catch (error) {
            failed = true;
            this.options.logger.error("worker.stop_failed", { reason, stage: "logger.close" }, error);
        }
        return {
            reason,
            status: forced ? "timed_out" : failed ? "failed" : "succeeded",
            resourcesClosed: !failed && !forced,
        };
    }

    private async waitForWork(deadlineMs: number): Promise<boolean> {
        const deadline = Date.now() + deadlineMs;
        while (this.currentPoll || this.polling || (this.options.activeAttemptCount?.() ?? 0) > 0) {
            if (Date.now() >= deadline) return false;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return true;
    }

    private abortActive(reason: string): void {
        const error = new Error(`Worker runtime shutdown requested: ${reason}`);
        this.options.workflowHost?.runLane.abortActive(error);
        this.options.workflowHost?.activityWorker.abortActive(error);
        this.options.workflowHost?.completionDispatcher.abortActive(error);
    }
}
