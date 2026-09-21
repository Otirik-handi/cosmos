import { describe, expect, it, vi } from "vitest";

import type { Logger } from "@cosmos/logging";

import {
    createScheduleQueue,
    type ScheduledRunQueue,
    type ScheduleTrigger,
} from "./scheduling.js";

function makeTrigger(overrides: Partial<ScheduleTrigger> & { sourceId: string }): ScheduleTrigger {
    return {
        planId: `plan:${overrides.sourceId}`,
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
            idempotencyKey: `schedule:plan:due:${Math.floor(NOW.getTime() / 60_000)}`,
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
                idempotencyKey: `schedule:plan:bilibili-hot:${Math.floor(NOW.getTime() / 60_000)}`,
            },
            {
                sourceId: "aihot",
                triggerKind: "schedule",
                idempotencyKey: `schedule:plan:aihot:${Math.floor(NOW.getTime() / 120_000)}`,
            },
        ]);
        expect(logger.events).toEqual([
            "workflow.run.queued",
            "workflow.run.queued",
        ]);
    });

    it("同一连接下的两个计划各按自己的间隔入队，互不顶掉对方的窗口", async () => {
        const queue = makeQueue(async () => ({ runId: "run-1", status: "queued" }));
        const logger = makeLogger();
        const tick = createScheduleQueue({
            listScheduleTriggers: async () => [
                // 同一连接的两个计划：动态每 30 分钟、推荐流每 2 小时（AUT-010 验收场景）。
                makeTrigger({ sourceId: "feed", planId: "plan:feed", intervalMs: 1_800_000 }),
                makeTrigger({ sourceId: "hot", planId: "plan:hot", intervalMs: 7_200_000 }),
            ],
            queue,
            logger,
        });

        await tick(NOW);

        expect(queue.calls.map((call) => call.idempotencyKey)).toEqual([
            `schedule:plan:feed:${Math.floor(NOW.getTime() / 1_800_000)}`,
            `schedule:plan:hot:${Math.floor(NOW.getTime() / 7_200_000)}`,
        ]);
        // 计划身份由上面的幂等键承载：`enqueue` 不再接受调用方另传的 planId，
        // 而是从执行快照取（两个来源若不一致，入队归属会与运行期用的计划对不上）。
        expect(queue.calls.map((call) => call.sourceId)).toEqual(["feed", "hot"]);
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
