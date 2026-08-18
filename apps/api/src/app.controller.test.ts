import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";

import { WorkflowHostConflictError } from "@cosmos/application";
import { AppController } from "./app.controller.js";
describe("AppController workflow conflicts", () => {
    it("maps an idempotency identity conflict to HTTP 409", async () => {
        const repository = {
            getSource: vi.fn().mockResolvedValue({
                id: "source-1",
                name: "Fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            }),
        };
        const workflowControl = {
            enqueue: vi.fn().mockRejectedValue(
                new WorkflowHostConflictError("Idempotency key already belongs to another source run."),
            ),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            workflowControl as never,
        );

        const error = await controller.runSource("source-1", "run-key").catch((value) => value);

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getStatus()).toBe(409);
        expect(error.getResponse()).toMatchObject({
            code: "conflict",
            retryable: false,
        });
    });
});

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

    it("projects attempts without exposing lease tokens", async () => {
        const attempt = {
            id: "job-1:attempt:1",
            jobId: "job-1",
            number: 1,
            workerId: "worker-1",
            workerInstanceId: "worker-1",
            ownerEpoch: 0,
            ownerSessionId: null,
            status: "succeeded" as const,
            leaseAcquiredAt: "2026-08-08T00:00:00.000Z",
            leaseExpiresAt: "2026-08-08T00:01:00.000Z",
            lastHeartbeatAt: null,
            finishedAt: "2026-08-08T00:00:01.000Z",
            error: null,
        };
        const repository = {
            listWorkflowAttempts: vi.fn().mockResolvedValue([attempt]),
            getWorkflowAttempt: vi.fn().mockResolvedValue(attempt),
        };
        const controller = new AppController(repository as never, {} as never);

        const page = await controller.attempts("job-1");
        expect(page.items).toEqual([attempt]);
        expect(page).toMatchObject({ nextCursor: null });
        expect(page.items[0]).not.toHaveProperty("leaseToken");
        await expect(controller.attempt("job-1:attempt:1")).resolves.toEqual(attempt);
    });
});

describe("AppController WorkflowRun projection", () => {
    it("maps internal waiting and completed states to the Product Run contract", async () => {
        const store = {
            loadWorkflowEnvelope: vi.fn(),
        };
        const controller = new AppController(
            {} as never,
            {} as never,
            undefined,
            undefined,
            store as never,
        );
        const base = {
            runId: "workflow-run-1",
            idempotencyKey: "run-1",
            definition: {
                key: "cosmos.ingest",
                version: "1",
                manifestHash: "builtin:ingest",
            },
            inputSnapshot: {},
            productRun: {
                sourceId: "source-1",
                triggerKind: "manual",
            },
            resumeRequired: false,
            createdAt: "2026-08-16T00:00:00.000Z",
            updatedAt: "2026-08-16T00:00:01.000Z",
            startedAt: "2026-08-16T00:00:00.100Z",
            finishedAt: null,
        };
        store.loadWorkflowEnvelope.mockResolvedValue({ ...base, status: "waiting" });
        await expect(controller.run("workflow-run-1")).resolves.toMatchObject({ status: "running" });
        store.loadWorkflowEnvelope.mockResolvedValue({
            ...base,
            status: "completed",
            finishedAt: "2026-08-16T00:00:01.000Z",
        });
        await expect(controller.run("workflow-run-1")).resolves.toMatchObject({
            status: "succeeded",
            finishedAt: "2026-08-16T00:00:01.000Z",
        });
    });
});
