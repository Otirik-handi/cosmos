import { ActionExecutionError, type AgentModelConnectionSnapshot } from "@cosmos/application";
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, ProviderStreamOptions } from "@mariozechner/pi-ai";

import { PiAiAgentInvocationV2Adapter, type PiAiSecretReader } from "./invocation-v2.js";

const input = {
    connectionId: "connection-agent",
    messages: [
        { role: "system" as const, content: "Be concise." },
        { role: "user" as const, content: "Hello" },
    ],
    tools: [],
    budget: { maxDurationMs: 1_000, maxToolCalls: 0, maxOutputTokens: 4_096 },
    metadata: {},
};

const context = { idempotencyKey: "agent-v2-1", signal: new AbortController().signal };

function connection(overrides: Partial<AgentModelConnectionSnapshot> = {}): AgentModelConnectionSnapshot {
    return {
        connectionId: "connection-agent",
        providerId: "provider-agent",
        api: "openai-completions",
        baseUrl: "https://agent.example.invalid/v1",
        modelId: "namespace/agent-model",
        modelName: "Synthetic Agent Model",
        contextWindow: 8_192,
        maxOutputTokens: 1_024,
        secretRef: "secret:provider-agent",
        ...overrides,
    };
}

function response(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
    return {
        role: "assistant",
        content: [{ type: "text", text: "Hello back" }],
        api: "openai-completions",
        provider: "provider-agent",
        model: "namespace/agent-model",
        usage: {
            input: 4,
            output: 3,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 7,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
        ...overrides,
    };
}

function adapter(options: {
    resolved?: AgentModelConnectionSnapshot | null;
    resolve?: (connectionId: string) => Promise<AgentModelConnectionSnapshot | null>;
    secret?: string | null;
    complete?: (model: never, context: never, options: ProviderStreamOptions) => Promise<AssistantMessage>;
}) {
    const complete = vi.fn(options.complete ?? (async () => response()));
    const secrets: PiAiSecretReader = { read: async () => (options.secret === undefined ? "sk-test" : options.secret) };
    return {
        complete,
        instance: new PiAiAgentInvocationV2Adapter({
            connections: {
                resolve: options.resolve ?? (async () => (options.resolved === undefined ? connection() : options.resolved)),
            },
            secrets,
            client: { complete: complete as never },
        }),
    };
}

describe("PiAiAgentInvocationV2Adapter", () => {
    it("builds the model from the resolved connection instead of the call", async () => {
        const { instance, complete } = adapter({
            resolved: connection({ api: "openai-responses", modelId: "namespace/other" }),
        });

        await expect(instance.invoke(input, context)).resolves.toMatchObject({
            content: "Hello back",
            provider: "provider-agent",
            model: "namespace/other",
        });
        expect(complete.mock.calls[0]?.[0]).toMatchObject({
            id: "namespace/other",
            api: "openai-responses",
            baseUrl: "https://agent.example.invalid/v1",
        });
        expect(complete.mock.calls[0]?.[2]).toMatchObject({ apiKey: "sk-test" });
    });

    it("caps the output budget at the model limit but never raises it", async () => {
        const { instance, complete } = adapter({ resolved: connection({ maxOutputTokens: 256 }) });

        await instance.invoke(input, context);
        expect(complete.mock.calls[0]?.[2]).toMatchObject({ maxTokens: 256 });
    });

    it("refuses an unavailable connection or a missing credential without calling the provider", async () => {
        const unavailable = adapter({ resolved: null });
        await expect(unavailable.instance.invoke(input, context))
            .rejects.toMatchObject({ code: "authentication_required" });

        const noSecret = adapter({ secret: "   " });
        await expect(noSecret.instance.invoke(input, context))
            .rejects.toMatchObject({ code: "authentication_required" });

        expect(unavailable.complete).not.toHaveBeenCalled();
        expect(noSecret.complete).not.toHaveBeenCalled();
    });

    it("resolves the connection on every call so a switch takes effect immediately", async () => {
        let current = connection();
        const resolve = vi.fn(async () => current);
        const { instance } = adapter({ resolve });

        await instance.invoke(input, context);
        current = connection({ modelId: "namespace/switched" });
        await expect(instance.invoke(input, context)).resolves.toMatchObject({ model: "namespace/switched" });
        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it("maps a provider failure to a controlled error and honours cancellation", async () => {
        const failing = adapter({ complete: async () => { throw new Error("Provider returned 500"); } });
        await expect(failing.instance.invoke(input, context))
            .rejects.toBeInstanceOf(ActionExecutionError);

        const controller = new AbortController();
        controller.abort();
        const cancelled = adapter({});
        await expect(cancelled.instance.invoke(input, { ...context, signal: controller.signal }))
            .rejects.toMatchObject({ code: "cancelled" });
        expect(cancelled.complete).not.toHaveBeenCalled();
    });
});
