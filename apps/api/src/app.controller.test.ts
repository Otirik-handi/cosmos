import { afterEach, describe, expect, it, vi } from "vitest";

import { AppController } from "./app.controller.js";

describe("AppController SSE", () => {
    afterEach(() => {
        delete process.env.COSMOS_SSE_REPLAY_LIMIT;
    });

    it("requests a snapshot when the replay window cannot be filled", async () => {
        process.env.COSMOS_SSE_REPLAY_LIMIT = "1";
        const repository = {
            events: vi.fn().mockResolvedValue([
                {
                    id: "1",
                    type: "run.queued.v1",
                    version: "v1",
                    occurredAt: "2026-08-08T00:00:00.000Z",
                    payload: { runId: "run-1" },
                },
                {
                    id: "2",
                    type: "feed.updated.v1",
                    version: "v1",
                    occurredAt: "2026-08-08T00:00:01.000Z",
                    payload: { storyId: "story-1" },
                },
            ]),
            latestEventSequence: vi.fn().mockResolvedValue(2),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
        );
        const observable = controller.events(undefined, "0");

        const event = await new Promise<{ data: string }>((resolve) => {
            let subscription: { unsubscribe(): void };
            subscription = observable.subscribe({
                next: (value) => {
                    resolve(value as { data: string });
                    subscription.unsubscribe();
                },
            });
        });

        const payload = JSON.parse(event.data) as {
            type: string;
            payload: { latestEventId: string };
        };
        expect(payload.type).toBe("snapshot_required");
        expect(payload.payload.latestEventId).toBe("2");
    });
});

describe("AppController source probe", () => {
    it("queues a probe job without invoking a connector in the API process", async () => {
        const repository = {
            getSource: vi.fn().mockResolvedValue({
                id: "source-1",
                name: "AI HOT",
                kind: "aihot",
                config: {},
                enabled: true,
                createdAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
                lastRunAt: null,
                lastError: null,
            }),
            createProbeJob: vi.fn().mockResolvedValue({
                id: "job-1",
                kind: "source-probe",
                sourceId: "source-1",
                runId: null,
                status: "queued",
            }),
        };
        const logger = {
            info: vi.fn(),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
            logger as never,
        );

        const result = await controller.testSource("source-1", "probe-1");

        expect(result).toMatchObject({
            id: "job-1",
            kind: "source-probe",
            status: "queued",
        });
        expect(repository.createProbeJob).toHaveBeenCalledWith({
            sourceId: "source-1",
            idempotencyKey: "probe-1",
        });
        expect(logger.info).toHaveBeenCalledWith("job.queued", {
            jobId: "job-1",
            sourceId: "source-1",
            kind: "source-probe",
            status: "queued",
        });
    });

    it("bridges a queued Run to the request logger", async () => {
        const repository = {
            getSource: vi.fn().mockResolvedValue({
                id: "source-1",
                name: "Fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
                createdAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
                lastRunAt: null,
                lastError: null,
            }),
            createQueuedRun: vi.fn().mockResolvedValue({
                id: "run-1",
                sourceId: "source-1",
                triggerKind: "manual",
                status: "queued",
            }),
        };
        const logger = {
            info: vi.fn(),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
            logger as never,
        );

        await controller.runSource("source-1", "run-1");

        expect(logger.info).toHaveBeenCalledWith("run.queued", {
            runId: "run-1",
            sourceId: "source-1",
            triggerKind: "manual",
            status: "queued",
        });
    });
});
