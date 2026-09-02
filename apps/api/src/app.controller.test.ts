import { afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from "@nestjs/common";

import { WorkflowHostConflictError } from "@cosmos/application";
import { AppController } from "./app.controller.js";
describe("AppController workflow conflicts", () => {
    it("maps an idempotency identity conflict to HTTP 409", async () => {
        const repository = {
            getSource: vi.fn().mockResolvedValue({
                id: "source-1",
                name: "Fixture",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                connectorId: "fixture-rss",
                kind: "fixture-rss",
                config: {},
                enabled: true,
                revisionId: "source-1:1",
                createdAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
                lastRunAt: null,
                lastError: null,
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

describe("AppController source run gating", () => {
    function sourceFixture(enabled: boolean) {
        return {
            id: "source-1",
            name: "Fixture",
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            connectorId: "fixture-rss",
            kind: "fixture-rss",
            config: {},
            enabled,
            revisionId: "source-1:1",
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
            lastRunAt: null,
            lastError: null,
        };
    }

    it("rejects a manual run for a disabled source", async () => {
        const repository = { getSource: vi.fn().mockResolvedValue(sourceFixture(false)) };
        const workflowControl = { enqueue: vi.fn() };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            workflowControl as never,
        );

        const error = await controller.runSource("source-1").catch((value) => value);

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toMatchObject({ code: "conflict", retryable: false });
        expect(workflowControl.enqueue).not.toHaveBeenCalled();
    });

    it("rejects an oversized idempotency key before queueing a run", async () => {
        const repository = { getSource: vi.fn().mockResolvedValue(sourceFixture(true)) };
        const workflowControl = { enqueue: vi.fn() };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            workflowControl as never,
        );

        const error = await controller.runSource("source-1", "k".repeat(301)).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        expect(workflowControl.enqueue).not.toHaveBeenCalled();
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
                sourceDefinitionRef: "source.aihot@1",
                operationId: "fetch",
                connectorId: "aihot",
                kind: "aihot",
                config: {},
                enabled: true,
                revisionId: "source-1:1",
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
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                connectorId: "fixture-rss",
                kind: "fixture-rss",
                config: {},
                enabled: true,
                revisionId: "source-1:1",
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

describe("AppController source config probes", () => {
    const probeCommand = {
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        config: { feedUrl: "https://example.test/feed.xml" },
    };
    const probeJob = {
        id: "probe-job-1",
        kind: "source-config-probe",
        sourceId: null,
        runId: null,
        status: "queued",
        attempts: 0,
        maxAttempts: 3,
        errorCode: null,
        error: null,
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
        result: null,
    };

    function probeController(repository: Record<string, unknown>, sourceProbe: Record<string, unknown>) {
        return new AppController(
            repository as never,
            sourceProbe as never,
        );
    }

    it("queues a config probe job after synchronous validation", async () => {
        const createConfigProbeJob = vi.fn().mockResolvedValue(probeJob);
        const validate = vi.fn();
        const controller = probeController(
            { createConfigProbeJob },
            { validate },
        );

        await expect(controller.createSourceConfigProbe(probeCommand, "probe-key-1")).resolves.toBe(probeJob);
        expect(validate).toHaveBeenCalledWith(probeCommand);
        expect(createConfigProbeJob).toHaveBeenCalledWith({
            command: probeCommand,
            idempotencyKey: "probe-key-1",
        });
    });

    it("generates an idempotency key when the header is absent", async () => {
        const createConfigProbeJob = vi.fn().mockResolvedValue(probeJob);
        const controller = probeController(
            { createConfigProbeJob },
            { validate: vi.fn() },
        );

        await controller.createSourceConfigProbe(probeCommand);
        const call = createConfigProbeJob.mock.calls[0][0] as { idempotencyKey?: string };
        expect(call.idempotencyKey).toMatch(/^config-probe:/);
    });

    it("rejects invalid config payloads with 400 before creating a job", async () => {
        const createConfigProbeJob = vi.fn();
        const controller = probeController(
            { createConfigProbeJob },
            { validate: vi.fn() },
        );

        const error = await controller.createSourceConfigProbe({
            ...probeCommand,
            sourceDefinitionRef: "source.rss@latest",
        }).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(createConfigProbeJob).not.toHaveBeenCalled();
    });

    it("rejects configs the validator refuses with 400 before creating a job", async () => {
        const createConfigProbeJob = vi.fn();
        const controller = probeController(
            { createConfigProbeJob },
            { validate: () => { throw new Error("Source definition is not available: source.rss@1"); } },
        );

        const error = await controller.createSourceConfigProbe(probeCommand).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        expect(createConfigProbeJob).not.toHaveBeenCalled();
    });

    it("rejects idempotency keys outside the 1-300 budget", async () => {
        const controller = probeController(
            { createConfigProbeJob: vi.fn() },
            { validate: vi.fn() },
        );

        const error = await controller.createSourceConfigProbe(probeCommand, "x".repeat(301)).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ message: "Idempotency-Key must be 1-300 characters." });
    });

    it("maps repository failures after validation to a 500 instead of a validation 400", async () => {
        const controller = probeController(
            {
                createConfigProbeJob: vi.fn()
                    .mockRejectedValue(new Error("The table `main.Job` does not exist in the current database.")),
            },
            { validate: vi.fn() },
        );

        const error = await controller.createSourceConfigProbe(probeCommand).catch((value) => value);

        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect(error.getResponse()).toMatchObject({ code: "internal_error" });
    });

    it("returns the probe job on the dedicated route and 404s other job kinds", async () => {
        const controller = probeController(
            {
                getJob: vi.fn()
                    .mockResolvedValueOnce(probeJob)
                    .mockResolvedValueOnce({ ...probeJob, kind: "source-probe" })
                    .mockResolvedValueOnce(null),
            },
            { validate: vi.fn() },
        );

        await expect(controller.sourceConfigProbe("probe-job-1")).resolves.toBe(probeJob);
        await expect(controller.sourceConfigProbe("other-job")).rejects.toThrow(NotFoundException);
        await expect(controller.sourceConfigProbe("missing-job")).rejects.toThrow(NotFoundException);
    });
});
