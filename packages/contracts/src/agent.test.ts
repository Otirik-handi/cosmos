import { describe, expect, it } from "vitest";

import {
    agentInvocationInputSchema,
    agentInvocationOutputSchema,
    agentInvocationV2InputSchema,
} from "./index.js";

const input = {
    provider: "fake",
    model: "test-model",
    messages: [{ role: "user" as const, content: "Summarize this." }],
    budget: {
        maxDurationMs: 5_000,
        maxToolCalls: 2,
        maxOutputTokens: 128,
    },
};

const output = {
    content: "A short result.",
    toolCalls: [],
    usage: {
        inputTokens: 4,
        outputTokens: 3,
        totalTokens: 7,
    },
    provider: "fake",
    model: "test-model",
    finishReason: "stop" as const,
};

describe("Agent Invocation contracts", () => {
    it("parses JSON-safe input and applies empty defaults", () => {
        expect(agentInvocationInputSchema.parse(input)).toEqual({
            ...input,
            tools: [],
            metadata: {},
        });
    });

    it("rejects non-JSON values in metadata and tool arguments", () => {
        expect(() => agentInvocationInputSchema.parse({
            ...input,
            metadata: { signal: new AbortController().signal },
        })).toThrow(/JSON-safe/);
        expect(() => agentInvocationOutputSchema.parse({
            ...output,
            toolCalls: [{ name: "lookup", arguments: new Uint8Array([1]) }],
        })).toThrow(/JSON-safe/);
    });

    it("requires positive budgets and bounded usage counters", () => {
        expect(() => agentInvocationInputSchema.parse({
            ...input,
            budget: { ...input.budget, maxDurationMs: 0 },
        })).toThrow();
        expect(() => agentInvocationOutputSchema.parse({
            ...output,
            usage: { ...output.usage, outputTokens: -1 },
        })).toThrow();
    });

    it("keeps output provider metadata and finish reason explicit", () => {
        expect(agentInvocationOutputSchema.parse(output)).toEqual({
            ...output,
            metadata: {},
        });
        expect(() => agentInvocationOutputSchema.parse({
            ...output,
            finishReason: "unknown",
        })).toThrow();
    });
});

/**
 * `agent.invoke@2`（API 0009「Connection 与 invocation 版本」）：调用方只说"用哪个连接"，
 * 服务商、模型、地址和凭证都由服务端从已保存的配置解析。因此 @2 输入里出现
 * provider/model/baseUrl 任意一项都必须是错误，而不是被忽略——静默忽略会让调用方
 * 以为自己的选择生效了。
 */
describe("Agent Invocation v2 contracts", () => {
    const v2Input = {
        connectionId: "connection-1",
        messages: [{ role: "user" as const, content: "Summarize this." }],
        tools: [],
        budget: { maxDurationMs: 5_000, maxToolCalls: 2, maxOutputTokens: 128 },
        metadata: { trace: "t1" },
    };

    it("accepts a connection-scoped invocation and applies defaults", () => {
        expect(agentInvocationV2InputSchema.parse({ connectionId: v2Input.connectionId,
            messages: v2Input.messages, budget: v2Input.budget })).toEqual({
            connectionId: "connection-1", messages: v2Input.messages, tools: [], budget: v2Input.budget, metadata: {},
        });
    });

    it("rejects provider, model, address or credential fields", () => {
        for (const extra of [{ provider: "fake" }, { model: "test-model" },
            { baseUrl: "https://example.invalid/v1" }, { apiKey: "sk-x" }, { secretRef: "secret:1" }]) {
            expect(() => agentInvocationV2InputSchema.parse({ ...v2Input, ...extra })).toThrow();
        }
    });
});
