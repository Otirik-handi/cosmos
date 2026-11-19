import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkflowHostCompositionOptions } from "./workflow-host.js";
import { ActionRegistry, createStoryDeepReadWorkflowDefinition } from "@cosmos/application";

const state = vi.hoisted(() => ({ host: vi.fn(), start: vi.fn(async () => undefined), enabled: true,
    publish: vi.fn(async () => { throw new Error("publication is not part of registration"); }) }));
vi.mock("@cosmos/application/workflow-ingest", async () => import("../../../packages/application/src/workflow-ingest.js"));
vi.mock("@cosmos/application/media-cleanup", async () => import("../../../packages/application/src/media-cleanup.js"));
vi.mock("@cosmos/application/workflow-control", async () => import("../../../packages/application/src/workflow-control.js"));
vi.mock("@cosmos/logging", () => ({ createLogger: () => ({ info: vi.fn(), debug: vi.fn(), close: vi.fn(async () => undefined) }) }));
vi.mock("@cosmos/plugin-collectors", () => ({ createBuiltInConnectorRegistry: () => ({ resolve: vi.fn(), resolveByConnectorId: vi.fn() }) }));
vi.mock("@cosmos/storage-prisma", () => ({
    PrismaCosmosRepository: class {
        prisma = {}; blobs = {}; secrets = {}; publishStoryDeepReadRevision = state.publish;
        initialize = vi.fn(async () => undefined); touchWorkerHeartbeat = vi.fn(async () => undefined);
        close = vi.fn(async () => undefined);
    },
    PrismaConnectorStateStore: class {}, PrismaStoryAgentCandidateRepository: class {}, PrismaStoryAgentFailureCodeReader: class {},
    PrismaAgentModelResolver: class {}, PrismaSystemConfigRepository: class {},
}));
vi.mock("./config.js", () => ({ parseWorkerRuntimeConfig: () => ({ workflowHostEnabled: state.enabled,
    workerAdminEnabled: false, workerId: "registration-test", leaseMs: 60000, pollMs: 1000, version: "test" }) }));
vi.mock("./workflow-host.js", () => ({ createWorkflowHost: (options: WorkflowHostCompositionOptions) => {
    state.host(options); return { store: {}, actions: new ActionRegistry(options.actions) };
} }));
vi.mock("./runtime.js", () => ({ WorkerRuntime: class { start = state.start; } }));
vi.mock("./scheduling.js", () => ({ createScheduleQueue: () => vi.fn(async () => undefined) }));
vi.mock("./agent-action-v2.js", async () => {
    const application = await import("@cosmos/application");
    return { createWorkerAgentInvocationV2Action: () => application.createAgentInvocationV2Action({
        invoke: async () => { throw new Error("No provider call during registration"); },
    }) };
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("registers deep read and fenced publication alongside the existing Story Agent only in the host branch", async () => {
    vi.stubEnv("COSMOS_DATA_ROOT", resolve(".agent/tmp/task43-s2a-worker-registration"));
    vi.spyOn(process, "once").mockReturnValue(process);
    await import("./main.js");
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledOnce());
    const options: WorkflowHostCompositionOptions = state.host.mock.calls[0]![0];
    expect(options.definitions.map((definition) => definition.key)).toEqual(expect.arrayContaining([
        "cosmos.story-agent", "cosmos.story-deep-read", "cosmos.ingest", "cosmos.media-cleanup",
    ]));
    const actions = new ActionRegistry(options.actions);
    expect(actions.resolve("artifact.publish@1").definition).toMatchObject({ executionPlacement: "host", kind: "artifact",
        execution: { retryPolicy: { maxAttempts: 1 } } });
    expect(actions.resolve("story.agent-candidate.save@1")).toBeDefined();
    expect(actions.resolve("agent.invoke@2")).toBeDefined();
    expect(createStoryDeepReadWorkflowDefinition().requiredActionRefs.every((ref) => actions.resolve(ref))).toBe(true);
    expect(state.publish).not.toHaveBeenCalled();
    vi.resetModules(); state.host.mockClear(); state.start.mockClear(); state.enabled = false;
    await import("./main.js");
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledOnce());
    expect(state.host).not.toHaveBeenCalled();
});
