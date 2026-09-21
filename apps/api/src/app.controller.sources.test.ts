import {
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    BadRequestException,
    ConflictException,
    InternalServerErrorException,
    NotFoundException,
} from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { SourceNotFoundError } from "@cosmos/application";
describe("AppController source run gating", () => {    function sourceFixture(enabled: boolean) {
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

describe("AppController source removal (AUT-001)", () => {
    const sourceFixture = {
        id: "source-1",
        name: "Fixture",
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        connectorId: "rss",
        kind: "rss",
        config: { feedUrl: "https://example.test/feed.xml" },
        enabled: false,
        revisionId: "source-1:3",
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
        lastRunAt: null,
        lastError: null,
    };

    it("passes the removal command through with the idempotency key", async () => {
        const repository = { deleteSource: vi.fn().mockResolvedValue(sourceFixture) };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );

        const removed = await controller.deleteSource("source-1", {
            baseRevisionId: "source-1:2",
            actor: "user",
            reason: "不再关注",
        }, "removal-1");

        expect(repository.deleteSource).toHaveBeenCalledWith({
            sourceId: "source-1",
            baseRevisionId: "source-1:2",
            idempotencyKey: "removal-1",
            actor: "user",
            reason: "不再关注",
        });
        expect(removed).toMatchObject({ id: "source-1", revisionId: "source-1:3" });
    });

    it("rejects a removal without an idempotency key", async () => {
        const repository = { deleteSource: vi.fn() };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );

        const error = await controller
            .deleteSource("source-1", { baseRevisionId: "source-1:2" }, undefined)
            .catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        expect(repository.deleteSource).not.toHaveBeenCalled();
    });

    it("maps an unknown source to 404", async () => {
        const repository = {
            deleteSource: vi.fn().mockRejectedValue(new SourceNotFoundError("source-404")),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );

        const error = await controller
            .deleteSource("source-404", { baseRevisionId: "source-404:1" }, "removal-2")
            .catch((value) => value);

        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.getResponse()).toMatchObject({ code: "not_found" });
    });
});

describe("AppController source media policy projection", () => {
    it("projects the plan's media policy and the plan identity into the public source", async () => {
        const media = { images: "metadata_only", maxFileBytes: 2 * 1024 * 1024 } as const;
        const base = {
            id: "source-1",
            name: "Fixture",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            kind: "rss",
            config: { feedUrl: "https://example.test/feed.xml" },
            enabled: true,
            mediaPolicy: media,
            revisionId: "source-1:1",
            planId: "plan:source-1",
            planRevisionId: "plan:source-1:1",
            connectionId: null,
            scheduleIntervalMs: null,
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
            lastRunAt: null,
            lastError: null,
        };
        const repository = {
            getSource: vi.fn().mockResolvedValue(base),
            updateSource: vi.fn().mockResolvedValue({
                ...base,
                name: "Fixture renamed",
                revisionId: "source-1:2",
            }),
        };
        const controller = new AppController(
            repository as never,
            { validate: vi.fn() } as never,
        );

        const updated = await controller.updateSource("source-1", {
            baseRevisionId: "source-1:1",
            name: "Fixture renamed",
        });

        // 目标配置里不再有 media（1c-1c-b2），媒体预算作为计划派生的投影单独出现——
        // 白名单漏掉它会让产品面读到 undefined。
        expect(updated.config).toEqual({ feedUrl: "https://example.test/feed.xml" });
        expect(updated.mediaPolicy).toEqual(media);
        expect(updated.planId).toBe("plan:source-1");
        expect(updated.planRevisionId).toBe("plan:source-1:1");
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
