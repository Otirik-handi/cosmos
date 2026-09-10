import type { Logger } from "@cosmos/logging";

/** The slice of `IngestWorkflowControlService` the schedule tick depends on. */
export interface ScheduledRunQueue {
    enqueue(input: {
        sourceId: string;
        triggerKind: "schedule";
        idempotencyKey: string;
    }): Promise<{ runId: string; status: string }>;
}

export interface ScheduleTrigger {
    sourceId: string;
    intervalMs: number;
    lastRunAt: string | null;
}

export interface ScheduleQueueOptions {
    listScheduleTriggers: () => Promise<readonly ScheduleTrigger[]>;
    queue: ScheduledRunQueue;
    logger: Logger;
}

/**
 * Enabled schedule trigger bindings (ADR-0018) drive scheduled dispatch: a
 * disabled source or a source without a schedule trigger must never queue a Run
 * just because time passed. The idempotency key buckets the current instant by
 * the source's own interval, so Worker restarts and overlapping ticks cannot
 * double-queue the same window.
 */
export function createScheduleQueue(
    options: ScheduleQueueOptions,
): (now?: Date) => Promise<void> {
    return async (now = new Date()): Promise<void> => {
        const triggers = await options.listScheduleTriggers();
        for (const trigger of triggers) {
            const interval = trigger.intervalMs;
            const lastRunAt = trigger.lastRunAt
                ? Date.parse(trigger.lastRunAt)
                : Number.NEGATIVE_INFINITY;
            if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < interval) continue;
            const bucket = Math.floor(now.getTime() / interval);
            try {
                const envelope = await options.queue.enqueue({
                    sourceId: trigger.sourceId,
                    triggerKind: "schedule",
                    idempotencyKey: `schedule:${trigger.sourceId}:${bucket}`,
                });
                options.logger.child({
                    runId: envelope.runId,
                    sourceId: trigger.sourceId,
                }).info("workflow.run.queued", {
                    triggerKind: "schedule",
                    status: envelope.status,
                });
            } catch (error) {
                // One broken source must not prevent another source or any
                // downstream lane from being polled in this cycle.
                options.logger.child({ sourceId: trigger.sourceId }).error("workflow.run.queue_failed", {
                    triggerKind: "schedule",
                }, error);
            }
        }
    };
}
