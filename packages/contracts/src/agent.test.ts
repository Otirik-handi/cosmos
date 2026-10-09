import { describe, expect, it } from "vitest";

import {
    agentInvocationInputSchema,
    agentInvocationOutputSchema,
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
