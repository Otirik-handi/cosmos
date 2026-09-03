import type { SourceSnapshot } from "@cosmos/contracts";
import type { Logger } from "@cosmos/logging";

/** The slice of `IngestWorkflowControlService` the schedule tick depends on. */
export interface ScheduledRunQueue {
    enqueue(input: {
        sourceId: string;
        triggerKind: "schedule";
        idempotencyKey: string;
    }): Promise<{ runId: string; status: string }>;
}

export interface ScheduleQueueOptions {
    listSources: () => Promise<readonly SourceSnapshot[]>;
    queue: ScheduledRunQueue;
    logger: Logger;
}

/**
 * Only enabled sources with a `scheduleIntervalMs` participate in scheduled
 * dispatch: a disabled source must never queue a Run just because time
 * passed, and a source without a schedule is manual-only. The idempotency
 * key buckets the current instant by the source's own interval, so Worker
 * restarts and overlapping ticks cannot double-queue the same window.
 */
export function createScheduleQueue(
    options: ScheduleQueueOptions,
): (now?: Date) => Promise<void> {
    return async (now = new Date()): Promise<void> => {
        const sources = await options.listSources();
        for (const source of sources) {
            if (!source.enabled || !source.config.scheduleIntervalMs) continue;
            const interval = source.config.scheduleIntervalMs;
            const lastRunAt = source.lastRunAt
                ? Date.parse(source.lastRunAt)
                : Number.NEGATIVE_INFINITY;
            if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < interval) continue;
            const bucket = Math.floor(now.getTime() / interval);
            try {
                const envelope = await options.queue.enqueue({
                    sourceId: source.id,
                    triggerKind: "schedule",
                    idempotencyKey: `schedule:${source.id}:${bucket}`,
                });
                options.logger.child({
                    runId: envelope.runId,
                    sourceId: source.id,
                }).info("workflow.run.queued", {
                    triggerKind: "schedule",
                    status: envelope.status,
                });
            } catch (error) {
                // One broken source must not prevent another source or any
                // downstream lane from being polled in this cycle.
                options.logger.child({ sourceId: source.id }).error("workflow.run.queue_failed", {
                    triggerKind: "schedule",
                }, error);
            }
        }
    };
}
