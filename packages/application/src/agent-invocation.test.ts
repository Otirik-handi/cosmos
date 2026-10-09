import { describe, expect, it } from "vitest";

import {
    ActionExecutionError,
    ActionRegistry,
    createAgentInvocationAction,
    FakeAgentInvocationAdapter,
    getAgentInvocationDefinition,
} from "./index.js";

const input = {
    provider: "fake",
    model: "test-model",
    messages: [{ role: "user" as const, content: "Summarize this." }],
    tools: [],
    budget: {
        maxDurationMs: 5_000,
        maxToolCalls: 0,
        maxOutputTokens: 128,
    },
    metadata: { runId: "run-1" },
};

const output = {
    content: "A short result.",
    toolCalls: [],
    usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    provider: "fake",
    model: "test-model",
    finishReason: "stop" as const,
    metadata: {},
};

const context = {
    idempotencyKey: "agent-1",
    signal: new AbortController().signal,
};

describe("Agent Invocation Action", () => {
    it("exposes the versioned trusted-worker definition", () => {
        expect(getAgentInvocationDefinition()).toMatchObject({
            ref: "agent.invoke@1",
            kind: "agent",
            executionPlacement: "trusted_worker",
            capabilities: ["agent:invoke"],
        });
    });

    it("dispatches a Fake Adapter through ActionRegistry", async () => {
        const registry = new ActionRegistry([
            createAgentInvocationAction(new FakeAgentInvocationAdapter({
                kind: "success",
                output,
            })),
        ]);

        await expect(registry.dispatch("agent.invoke@1", input, context)).resolves.toEqual(output);
    });

    it("maps controlled adapter errors without creating a fallback result", async () => {
        const registry = new ActionRegistry([
            createAgentInvocationAction(new FakeAgentInvocationAdapter({
                kind: "error",
                code: "dependency_unavailable",
                message: "No fake provider configured.",
                retryable: true,
            })),
        ]);

        await expect(registry.dispatch("agent.invoke@1", input, context)).rejects.toEqual(
            new ActionExecutionError("dependency_unavailable", "No fake provider configured.", true),
        );
    });

    it("rejects a cancelled invocation before the adapter produces output", async () => {
        const controller = new AbortController();
        controller.abort();
        const registry = new ActionRegistry([
            createAgentInvocationAction(new FakeAgentInvocationAdapter({
                kind: "success",
                output,
            })),
        ]);

        await expect(registry.dispatch("agent.invoke@1", input, {
            ...context,
            signal: controller.signal,
        })).rejects.toMatchObject({
            name: "ActionExecutionError",
            code: "cancelled",
            retryable: false,
        });
    });
});
