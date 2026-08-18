import { describe, expect, it, vi } from "vitest";

import type { LoggerPort } from "@cosmos/application";
import { WorkerAdminService } from "@cosmos/worker-admin";
import { WorkerRuntime, type WorkerRuntimeOptions } from "./runtime.js";

const logger: LoggerPort = {
    child: () => logger,
    withContext: (_context, callback) => callback(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

function runtimeOptions(overrides: Partial<WorkerRuntimeOptions> = {}): WorkerRuntimeOptions {
    return {
        repository: { close: vi.fn(async () => undefined) } as never,
        workflowHost: null,
        workflowControl: null,
        worker: { pollOnce: vi.fn(async () => null) } as never,
        workerAdminServer: null,
        logger,
        closeLogger: vi.fn(async () => undefined),
        config: {
            pollMs: 10_000,
            leaseMs: 5_000,
            shutdownDeadlineMs: 100,
            version: "test",
            workerId: "worker-test",
            workflowHostEnabled: false,
            workerAdminEnabled: false,
            workerAdminHost: "127.0.0.1",
            workerAdminPort: 0,
            workerAdminToken: null,
        },
        instanceId: "instance-test",
        heartbeat: vi.fn(async () => undefined),
        queueScheduledWorkflowSources: vi.fn(async () => undefined),
        ...overrides,
    };
}

function workflowHost(overrides: Record<string, unknown> = {}) {
    return {
        store: {
            listRunsForRecovery: vi.fn(async () => []),
        },
        runLane: { pollOnce: vi.fn(async () => null), abortActive: vi.fn() },
        activityWorker: { pollOnce: vi.fn(async () => null), abortActive: vi.fn() },
        completionDispatcher: { pollOnce: vi.fn(async () => null), abortActive: vi.fn() },
        ...overrides,
    } as never;
}

describe("WorkerRuntime", () => {
    it("runs the initial poll once and rejects a second start", async () => {
        const options = runtimeOptions();
        const runtime = new WorkerRuntime(options);

        await runtime.start();
        expect(options.worker.pollOnce).toHaveBeenCalledTimes(1);
        await expect(runtime.start()).rejects.toThrow("already started");
        await runtime.requestShutdown("test");
    });

    it("keeps later lanes running when an earlier workflow lane fails", async () => {
        const activityPoll = vi.fn(async () => null);
        const completionPoll = vi.fn(async () => null);
        const legacyPoll = vi.fn(async () => null);
        const options = runtimeOptions({
            workflowHost: workflowHost({
                runLane: { pollOnce: vi.fn(async () => { throw new Error("run failed"); }), abortActive: vi.fn() },
                activityWorker: { pollOnce: activityPoll, abortActive: vi.fn() },
                completionDispatcher: { pollOnce: completionPoll, abortActive: vi.fn() },
            }),
            workflowControl: {} as never,
            worker: { pollOnce: legacyPoll } as never,
        });
        const runtime = new WorkerRuntime(options);

        await runtime.pollOnce();

        expect(activityPoll).toHaveBeenCalledTimes(1);
        expect(completionPoll).toHaveBeenCalledTimes(1);
        expect(legacyPoll).toHaveBeenCalledTimes(1);
        await runtime.requestShutdown("test");
    });

    it("prioritizes a recoverable Run before scanning the normal Run lane", async () => {
        const recovered = { runId: "recovered-run" };
        const pollOnce = vi.fn(async (_input?: { runId?: string }) => null);
        const options = runtimeOptions({
            workflowHost: workflowHost({
                store: { listRunsForRecovery: vi.fn(async () => [recovered]) },
                runLane: { pollOnce, abortActive: vi.fn() },
            }),
            workflowControl: {} as never,
        });
        const runtime = new WorkerRuntime(options);

        await runtime.pollOnce();

        expect(pollOnce).toHaveBeenCalledWith({ runId: "recovered-run" });
        await runtime.requestShutdown("test");
    });

    it("waits for an in-flight poll before closing resources", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const pollOnce = vi.fn(() => gate);
        const repository = { close: vi.fn(async () => undefined) };
        const options = runtimeOptions({
            repository: repository as never,
            worker: { pollOnce } as never,
            config: { ...runtimeOptions().config, shutdownDeadlineMs: 1_000 },
        });
        const runtime = new WorkerRuntime(options);
        const poll = runtime.pollOnce();
        await vi.waitFor(() => expect(pollOnce).toHaveBeenCalledTimes(1));
        const shutdown = runtime.requestShutdown("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(repository.close).not.toHaveBeenCalled();
        release();
        await poll;
        await expect(shutdown).resolves.toMatchObject({ status: "succeeded", resourcesClosed: true });
        expect(repository.close).toHaveBeenCalledTimes(1);
    });

    it("reports a timed out shutdown and aborts all workflow lanes", async () => {
        const abortRun = vi.fn();
        const abortActivity = vi.fn();
        const abortCompletion = vi.fn();
        const options = runtimeOptions({
            workflowHost: workflowHost({
                runLane: { pollOnce: vi.fn(() => new Promise(() => undefined)), abortActive: abortRun },
                activityWorker: { pollOnce: vi.fn(async () => null), abortActive: abortActivity },
                completionDispatcher: { pollOnce: vi.fn(async () => null), abortActive: abortCompletion },
            }),
            workflowControl: {} as never,
            config: { ...runtimeOptions().config, shutdownDeadlineMs: 5 },
        });
        const runtime = new WorkerRuntime(options);
        const poll = runtime.pollOnce();
        await vi.waitFor(() => expect(options.workflowHost?.runLane.pollOnce).toHaveBeenCalled());

        const result = await runtime.requestShutdown("deadline");

        expect(result).toMatchObject({ status: "timed_out", resourcesClosed: false });
        expect(abortRun).toHaveBeenCalledTimes(1);
        expect(abortActivity).toHaveBeenCalledTimes(1);
        expect(abortCompletion).toHaveBeenCalledTimes(1);
        void poll;
    });

    it("waits for registered Admin attempts before successful drain", async () => {
        const service = new WorkerAdminService({
            workerId: "worker-test",
            instanceId: "instance-test",
            version: "test",
        });
        service.markReady();
        service.registerAttempt({
            attemptId: "attempt-1",
            jobId: "job-1",
            runId: "run-1",
            actionRef: "demo.action@1",
            lane: "workflow-activity",
            slot: 0,
            startedAt: new Date().toISOString(),
            leaseExpiresAt: new Date(Date.now() + 10_000).toISOString(),
            cancellationRequested: false,
        });
        const options = runtimeOptions({
            workerAdminServer: {
                service,
                close: vi.fn(async () => undefined),
            } as never,
            activeAttemptCount: () => service.status().activeAttemptCount,
            config: { ...runtimeOptions().config, shutdownDeadlineMs: 50 },
        });
        const runtime = new WorkerRuntime(options);
        const shutdown = runtime.requestShutdown("drain");
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(options.repository.close).not.toHaveBeenCalled();
        service.finishAttempt("attempt-1");
        await expect(shutdown).resolves.toMatchObject({ status: "succeeded" });
    });
});
