import { describe, expect, it, vi } from "vitest";

import type { Logger } from "@cosmos/logging";

import {
    createScheduleQueue,
    type ScheduledRunQueue,
    type ScheduleTrigger,
} from "./scheduling.js";

function makeTrigger(overrides: Partial<ScheduleTrigger>): ScheduleTrigger {
    return {
        sourceId: "source-1",
        intervalMs: 60_000,
        lastRunAt: null,
        ...overrides,
    };
}

function makeLogger(): Logger & { events: string[] } {
    const events: string[] = [];
    const logger: Logger = {
        child: () => logger,
        withContext: (_context, callback) => callback(),
        debug: () => undefined,
        info: (event) => {
            events.push(event);
        },
        warn: () => undefined,
        error: (event) => {
            events.push(event);
        },
        close: async () => undefined,
    };
    return Object.assign(logger, { events });
}

function makeQueue(
    onEnqueue: ScheduledRunQueue["enqueue"],
): ScheduledRunQueue & { calls: Parameters<ScheduledRunQueue["enqueue"]>[0][] } {
    const calls: Parameters<ScheduledRunQueue["enqueue"]>[0][] = [];
    return Object.assign({
        enqueue: vi.fn(async (input: Parameters<ScheduledRunQueue["enqueue"]>[0]) => {
            calls.push(input);
            return onEnqueue(input);
        }),
    } satisfies ScheduledRunQueue, { calls });
}

const NOW = new Date("2026-09-03T12:00:00.000Z");

describe("createScheduleQueue", () => {
    it("queues only schedule triggers whose interval has elapsed", async () => {
        const queue = makeQueue(async () => ({ runId: "run-1", status: "queued" }));
        const logger = makeLogger();
        const tick = createScheduleQueue({
            listScheduleTriggers: async () => [
                // Due: never ran.
                makeTrigger({ sourceId: "due", intervalMs: 60_000 }),
                // Not due: ran 10s ago with a 60s interval.
                makeTrigger({
                    sourceId: "not-due",
                    intervalMs: 60_000,
                    lastRunAt: new Date(NOW.getTime() - 10_000).toISOString(),
                }),
            ],
            queue,
            logger,
        });

        await tick(NOW);

        expect(queue.calls).toHaveLength(1);
        expect(queue.calls[0]).toEqual({
            sourceId: "due",
            triggerKind: "schedule",
            idempotencyKey: `schedule:due:${Math.floor(NOW.getTime() / 60_000)}`,
        });
    });

    it("queues again once the interval has elapsed after the last run", async () => {
        const queue = makeQueue(async () => ({ runId: "run-1", status: "queued" }));
        const logger = makeLogger();
        const tick = createScheduleQueue({
            listScheduleTriggers: async () => [
                makeTrigger({
                    sourceId: "due-again",
                    intervalMs: 60_000,
                    lastRunAt: new Date(NOW.getTime() - 61_000).toISOString(),
                }),
            ],
            queue,
            logger,
        });

        await tick(NOW);

        expect(queue.calls).toHaveLength(1);
        expect(queue.calls[0]?.sourceId).toBe("due-again");
    });

    it("queues due Bilibili and AI HOT triggers for scheduled ingestion", async () => {
        const queue = makeQueue(async () => ({ runId: "run-1", status: "queued" }));
        const logger = makeLogger();
        const tick = createScheduleQueue({
            listScheduleTriggers: async () => [
                makeTrigger({ sourceId: "bilibili-hot", intervalMs: 60_000 }),
                makeTrigger({ sourceId: "aihot", intervalMs: 120_000 }),
            ],
            queue,
            logger,
        });

        await tick(NOW);

        expect(queue.calls).toEqual([
            {
                sourceId: "bilibili-hot",
                triggerKind: "schedule",
                idempotencyKey: `schedule:bilibili-hot:${Math.floor(NOW.getTime() / 60_000)}`,
            },
            {
                sourceId: "aihot",
                triggerKind: "schedule",
                idempotencyKey: `schedule:aihot:${Math.floor(NOW.getTime() / 120_000)}`,
            },
        ]);
        expect(logger.events).toEqual([
            "workflow.run.queued",
            "workflow.run.queued",
        ]);
    });

    it("continues queuing later triggers when one source fails to enqueue", async () => {
        const queue = makeQueue(async (input) => {
            if (input.sourceId === "broken") {
                throw new Error("idempotency conflict");
            }
            return { runId: "run-1", status: "queued" };
        });
        const logger = makeLogger();
        const tick = createScheduleQueue({
            listScheduleTriggers: async () => [
                makeTrigger({ sourceId: "broken", intervalMs: 60_000 }),
                makeTrigger({ sourceId: "healthy", intervalMs: 60_000 }),
            ],
            queue,
            logger,
        });

        await tick(NOW);

        expect(queue.calls.map((call) => call.sourceId)).toEqual(["broken", "healthy"]);
        expect(logger.events).toContain("workflow.run.queue_failed");
        expect(logger.events).toContain("workflow.run.queued");
    });
});
