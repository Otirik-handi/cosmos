import { ActionExecutionError, ActionRegistry } from "@cosmos/application";
import type { ConnectionInstance } from "@cosmos/contracts";
import type { PiAiClient } from "@cosmos/agent-pi-ai";
import { describe, expect, it, vi } from "vitest";
import { createWorkerAgentAction } from "./agent-action.js";
import type { WorkerAgentConfig } from "./config.js";

const config: WorkerAgentConfig = {
    provider: "jijiapi",
    model: "gpt-6-luna",
    api: "openai-completions",
    baseUrl: "https://api-slb.jiji.cc/v1",
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    connectionId: "connection-1",
};

const input = {
    provider: "jijiapi",
    model: "gpt-6-luna",
    messages: [{ role: "user" as const, content: "Say hello in one word." }],
    tools: [],
    budget: { maxDurationMs: 30_000, maxToolCalls: 0, maxOutputTokens: 64 },
    metadata: {},
};

const context = { idempotencyKey: "agent-smoke-test", signal: new AbortController().signal };
const connection: ConnectionInstance = {
    id: "connection-1",
    name: "Test provider credential",
    connectorId: "custom-auth",
    account: null,
    scopeJson: null,
    configJson: null,
    status: "active",
    secretRef: "opaque-secret-ref",
    lastError: null,
    lastCheckedAt: null,
    modelId: null,
    version: 1,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
};
type PiAiCompleteOptions = Parameters<PiAiClient["complete"]>[2];
type PiAiRequestContext = Parameters<PiAiClient["complete"]>[1];

function client(complete: PiAiClient["complete"]): PiAiClient {
    return { getModel: () => ({}) as never, complete };
}

function response(): Awaited<ReturnType<PiAiClient["complete"]>> {
    return {
        role: "assistant",
        content: [{ type: "text", text: "Hello." }],
        api: "openai-completions",
        provider: "jijiapi",
        model: "gpt-6-luna",
        usage: {
            input: 10,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 12,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
    };
}

describe("Worker Agent Action composition", () => {
    it("reloads credentials for each invocation and rejects a subsequently revoked connection", async () => {
        const getConnection = vi.fn().mockResolvedValue(connection);
        const read = vi.fn().mockResolvedValueOnce("first-synthetic-key").mockResolvedValueOnce("rotated-synthetic-key");
        const used: Array<string | undefined> = [];
        const complete = vi.fn<PiAiClient["complete"]>(async (_model, _context, options) => {
            used.push(options.apiKey);
            return response();
        });
        const registry = new ActionRegistry([createWorkerAgentAction(config, {
            connections: { getConnection },
            secrets: { read, put: vi.fn(), delete: vi.fn() },
            client: client(complete),
        })]);
        await registry.dispatch("agent.invoke@1", input, context);
        await registry.dispatch("agent.invoke@1", input, context);
        getConnection.mockResolvedValue({ ...connection, status: "revoked" });
        await expect(registry.dispatch("agent.invoke@1", input, context))
            .rejects.toMatchObject({ code: "authentication_required" });
        expect(getConnection).toHaveBeenCalledTimes(3);
        expect(read).toHaveBeenCalledTimes(2);
        expect(used).toEqual(["first-synthetic-key", "rotated-synthetic-key"]);
        expect(complete).toHaveBeenCalledTimes(2);
    });

    it("sanitizes SecretStore failures and never calls the SDK", async () => {
        const complete = vi.fn();
        const registry = new ActionRegistry([createWorkerAgentAction(config, {
            connections: { getConnection: vi.fn().mockResolvedValue(connection) },
            secrets: { read: vi.fn().mockRejectedValue(new Error("synthetic-sensitive-detail")), put: vi.fn(), delete: vi.fn() },
            client: client(complete),
        })]);
        const error: unknown = await registry.dispatch("agent.invoke@1", input, context).catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(ActionExecutionError);
        expect(error).toMatchObject({ code: "authentication_required", retryable: false });
        expect(String(error)).not.toContain("synthetic-sensitive-detail");
        expect(JSON.stringify(error)).not.toContain("synthetic-sensitive-detail");
        expect(complete).not.toHaveBeenCalled();
    });

    it.each(["connection", "secret"] as const)("stops when cancelled during %s lookup", async (stage) => {
        const controller = new AbortController();
        const complete = vi.fn();
        const getConnection = vi.fn(async () => {
            if (stage === "connection") controller.abort();
            return connection;
        });
        const read = vi.fn(async () => {
            controller.abort();
            return "synthetic-key";
        });
        const registry = new ActionRegistry([createWorkerAgentAction(config, {
            connections: { getConnection },
            secrets: { read, put: vi.fn(), delete: vi.fn() },
            client: client(complete),
        })]);
        await expect(registry.dispatch("agent.invoke@1", input, { ...context, signal: controller.signal }))
            .rejects.toMatchObject({ code: "cancelled" });
        expect(read).toHaveBeenCalledTimes(stage === "connection" ? 0 : 1);
        expect(complete).not.toHaveBeenCalled();
    });
    it("reads the configured connection SecretRef and only passes its value to pi-ai", async () => {
        let usedCredential: string | undefined;
        let request: { options: PiAiCompleteOptions; context: PiAiRequestContext } | undefined;
        const fakeClient = client(async (_model, requestContext, options) => {
            usedCredential = options.apiKey;
            request = { context: requestContext, options };
            return response();
        });
        const getConnection = vi.fn().mockResolvedValue(connection);
        const read = vi.fn().mockResolvedValue("test-secret");
        const action = createWorkerAgentAction(config, {
            connections: { getConnection },
            secrets: { read, put: vi.fn(), delete: vi.fn() },
            client: fakeClient,
        });
        const registry = new ActionRegistry([action]);
        const output = await registry.dispatch("agent.invoke@1", input, context);

        expect(output).toMatchObject({ content: "Hello.", provider: "jijiapi", model: "gpt-6-luna" });
        expect(usedCredential).toBe("test-secret");
        expect(request?.options.maxTokens).toBe(64);
        expect(getConnection).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledWith("opaque-secret-ref");
        expect(JSON.stringify(output)).not.toContain("test-secret");
    });

    it.each([
        null,
        { ...connection, status: "revoked" as const },
        { ...connection, secretRef: null },
    ])("fails closed for an invalid configured connection", async (configuredConnection) => {
        const complete = vi.fn();
        const read = vi.fn();
        const action = createWorkerAgentAction(config, {
            connections: { getConnection: vi.fn().mockResolvedValue(configuredConnection) },
            secrets: { read, put: vi.fn(), delete: vi.fn() },
            client: client(complete),
        });
        const registry = new ActionRegistry([action]);

        await expect(registry.dispatch("agent.invoke@1", input, context)).rejects.toMatchObject({
            name: "ActionExecutionError",
            code: "authentication_required",
        });
        expect(read).not.toHaveBeenCalled();
        expect(complete).not.toHaveBeenCalled();
    });

    it("rejects a repository result for a different Connection ID", async () => {
        const complete = vi.fn();
        const read = vi.fn();
        const action = createWorkerAgentAction(config, {
            connections: { getConnection: vi.fn().mockResolvedValue({ ...connection, id: "different-id" }) },
            secrets: { read, put: vi.fn(), delete: vi.fn() },
            client: client(complete),
        });

        await expect(new ActionRegistry([action]).dispatch("agent.invoke@1", input, context))
            .rejects.toMatchObject({ code: "authentication_required" });
        expect(read).not.toHaveBeenCalled();
        expect(complete).not.toHaveBeenCalled();
    });

    it("does not call pi-ai when the SecretStore has no value", async () => {
        const complete = vi.fn();
        const action = createWorkerAgentAction(config, {
            connections: { getConnection: vi.fn().mockResolvedValue(connection) },
            secrets: { read: vi.fn().mockResolvedValue(null), put: vi.fn(), delete: vi.fn() },
            client: client(complete),
        });
        const registry = new ActionRegistry([action]);

        await expect(registry.dispatch("agent.invoke@1", input, context)).rejects.toMatchObject({
            code: "authentication_required",
        });
        expect(complete).not.toHaveBeenCalled();
    });

    it("does not load the connection when invocation was already cancelled", async () => {
        const cancelled = new AbortController();
        cancelled.abort();
        const getConnection = vi.fn();
        const action = createWorkerAgentAction(config, {
            connections: { getConnection },
            secrets: { read: vi.fn(), put: vi.fn(), delete: vi.fn() },
            client: client(vi.fn()),
        });
        const registry = new ActionRegistry([action]);

        await expect(registry.dispatch("agent.invoke@1", input, { ...context, signal: cancelled.signal }))
            .rejects.toMatchObject({ code: "cancelled" });
        expect(getConnection).not.toHaveBeenCalled();
    });
});
