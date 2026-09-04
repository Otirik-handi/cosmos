import { describe, expect, it, vi } from "vitest";

import type { SourceSnapshot } from "@cosmos/contracts";
import type { Logger } from "@cosmos/logging";

import { createScheduleQueue, type ScheduledRunQueue } from "./scheduling.js";

function makeSource(overrides: Partial<SourceSnapshot>): SourceSnapshot {
    return {
        id: "source-1",
        name: "Fixture RSS",
        sourceDefinitionRef: "source.fixture-rss@1",
        operationId: "fetch",
        connectorId: "fixture-rss",
        kind: "fixture-rss",
        config: {},
        enabled: true,
        revisionId: "source-1:1",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        lastRunAt: null,
        lastError: null,
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
    it("queues only enabled sources whose schedule interval has elapsed", async () => {
        const queue = makeQueue(async () => ({ runId: "run-1", status: "queued" }));
        const logger = makeLogger();
        const tick = createScheduleQueue({
            listSources: async () => [
                // Due: never ran.
                makeSource({ id: "due", config: { scheduleIntervalMs: 60_000 } }),
                // Not due: ran 10s ago with a 60s interval.
                makeSource({
                    id: "not-due",
                    config: { scheduleIntervalMs: 60_000 },
                    lastRunAt: new Date(NOW.getTime() - 10_000).toISOString(),
                }),
                // Disabled sources never participate, even when overdue.
                makeSource({
                    id: "disabled-scheduled",
                    enabled: false,
                    config: { scheduleIntervalMs: 60_000 },
                }),
                makeSource({
                    id: "disabled-untimed",
                    enabled: false,
                    config: {},
                }),
                // Enabled but manual-only.
                makeSource({ id: "untimed", config: {} }),
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
            listSources: async () => [
                makeSource({
                    id: "due-again",
                    config: { scheduleIntervalMs: 60_000 },
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

    it("queues due Bilibili and AI HOT sources for scheduled ingestion", async () => {
        const queue = makeQueue(async () => ({ runId: "run-1", status: "queued" }));
        const logger = makeLogger();
        const tick = createScheduleQueue({
            listSources: async () => [
                makeSource({
                    id: "bilibili-hot",
                    name: "Scheduled Bilibili Hot",
                    sourceDefinitionRef: "source.bilibili@1",
                    connectorId: "bilibili",
                    kind: "bilibili",
                    config: {
                        schemaVersion: 1,
                        mode: "hot",
                        limit: 20,
                        scheduleIntervalMs: 60_000,
                    },
                }),
                makeSource({
                    id: "aihot",
                    name: "Scheduled AI HOT",
                    sourceDefinitionRef: "source.aihot@1",
                    connectorId: "aihot",
                    kind: "aihot",
                    config: {
                        schemaVersion: 1,
                        scheduleIntervalMs: 120_000,
                    },
                }),
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

    it("continues queuing later sources when one source fails to enqueue", async () => {
        const queue = makeQueue(async (input) => {
            if (input.sourceId === "broken") {
                throw new Error("idempotency conflict");
            }
            return { runId: "run-1", status: "queued" };
        });
        const logger = makeLogger();
        const tick = createScheduleQueue({
            listSources: async () => [
                makeSource({ id: "broken", config: { scheduleIntervalMs: 60_000 } }),
                makeSource({ id: "healthy", config: { scheduleIntervalMs: 60_000 } }),
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
