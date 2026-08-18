import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import type { LoggerPort } from "@cosmos/application";
import { WorkerRuntime, type WorkerRuntimeOptions } from "./runtime.js";

const logger: LoggerPort = {
    child: () => logger,
    withContext: (_context, callback) => callback(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

const runIdArbitrary = fc
    .string({ minLength: 1, maxLength: 32 })
    .filter((value) => value.trim().length > 0);

function optionsFor(recovered: readonly { runId: string }[], runPoll: ReturnType<typeof vi.fn>) {
    const activityPoll = vi.fn(async () => null);
    const completionPoll = vi.fn(async () => null);
    const legacyPoll = vi.fn(async () => null);
    const repository = { close: vi.fn(async () => undefined) };
    const options: WorkerRuntimeOptions = {
        repository: repository as never,
        workflowHost: {
            store: { listRunsForRecovery: vi.fn(async () => recovered) },
            runLane: { pollOnce: runPoll, abortActive: vi.fn() },
            activityWorker: { pollOnce: activityPoll, abortActive: vi.fn() },
            completionDispatcher: { pollOnce: completionPoll, abortActive: vi.fn() },
        } as never,
        workflowControl: {} as never,
        worker: { pollOnce: legacyPoll } as never,
        workerAdminServer: null,
        logger,
        closeLogger: vi.fn(async () => undefined),
        config: {
            pollMs: 10_000,
            leaseMs: 5_000,
            shutdownDeadlineMs: 100,
            version: "test",
            workerId: "worker-test",
            workflowHostEnabled: true,
            workerAdminEnabled: false,
            workerAdminHost: "127.0.0.1",
            workerAdminPort: 0,
            workerAdminToken: null,
        },
        instanceId: "instance-test",
        heartbeat: vi.fn(async () => undefined),
        queueScheduledWorkflowSources: vi.fn(async () => undefined),
    };
    return { options, activityPoll, completionPoll, legacyPoll };
}

describe("WorkerRuntime recovery properties", () => {
    it("targets the oldest available recovery candidate before normal scanning", async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(runIdArbitrary.map((runId) => ({ runId })), { minLength: 1, maxLength: 8 }),
                async (recovered) => {
                    const runPoll = vi.fn(async () => null);
                    const { options, activityPoll, completionPoll, legacyPoll } = optionsFor(recovered, runPoll);
                    const runtime = new WorkerRuntime(options);

                    await runtime.pollOnce();

                    expect(runPoll).toHaveBeenCalledWith({ runId: recovered[0].runId });
                    expect(activityPoll).toHaveBeenCalledTimes(1);
                    expect(completionPoll).toHaveBeenCalledTimes(1);
                    expect(legacyPoll).toHaveBeenCalledTimes(1);
                    await runtime.requestShutdown("property-test");
                },
            ),
            { numRuns: 100 },
        );
    });
});
