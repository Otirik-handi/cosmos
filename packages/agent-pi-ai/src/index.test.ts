import { ActionExecutionError } from "@cosmos/application";
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, ProviderStreamOptions } from "@mariozechner/pi-ai";
import {
    createPiAiOpenAICompletionsModel,
    createPiAiOpenAIResponsesModel,
    PiAiAgentInvocationAdapter,
    type PiAiClient,
} from "./index.js";

const input = {
    provider: "openai",
    model: "gpt-test",
    messages: [
        { role: "system" as const, content: "Be concise." },
        { role: "user" as const, content: "Hello" },
    ],
    tools: [{ name: "lookup", description: "Look up a value", inputSchema: { type: "object" } }],
    budget: { maxDurationMs: 100, maxToolCalls: 1, maxOutputTokens: 64 },
    metadata: {},
};

const context = { idempotencyKey: "agent-1", signal: new AbortController().signal };

function response(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
    return {
        role: "assistant",
        content: [
            { type: "text", text: "Hello back" },
            { type: "toolCall", id: "call-1", name: "lookup", arguments: { key: "value" } },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-test",
        usage: {
            input: 4,
            output: 3,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 7,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
        ...overrides,
    };
}

function client(complete: PiAiClient["complete"]): PiAiClient {
    return { getModel: () => ({}) as never, complete };
}

describe("PiAiAgentInvocationAdapter", () => {
    it("constructs an OpenAI Chat Completions-compatible custom model", () => {
        expect(createPiAiOpenAICompletionsModel({
            provider: "jijiapi",
            model: "gpt-6-luna",
            name: "gpt-6-luna",
            baseUrl: "https://api-slb.jiji.cc/v1",
            contextWindow: 262_144,
            maxTokens: 32_768,
        })).toMatchObject({
            id: "gpt-6-luna",
            provider: "jijiapi",
            api: "openai-completions",
            baseUrl: "https://api-slb.jiji.cc/v1",
            contextWindow: 262_144,
            maxTokens: 32_768,
        });
    });

    it("constructs an OpenAI Responses-compatible custom model", () => {
        expect(createPiAiOpenAIResponsesModel({
            provider: "jijiapi",
            model: "gpt-6-luna",
            name: "gpt-6-luna",
            baseUrl: "https://api.example.test/v1",
            contextWindow: 262_144,
            maxTokens: 32_768,
        })).toMatchObject({
            id: "gpt-6-luna",
            provider: "jijiapi",
            api: "openai-responses",
            baseUrl: "https://api.example.test/v1",
            contextWindow: 262_144,
            maxTokens: 32_768,
        });
    });

    it("passes a Responses model to the injected SDK client without protocol fallback", async () => {
        let selectedApi: string | undefined;
        const responsesModel = createPiAiOpenAIResponsesModel({
            provider: "jijiapi",
            model: "gpt-6-luna",
            name: "gpt-6-luna",
            baseUrl: "https://api.example.test/v1",
            contextWindow: 262_144,
            maxTokens: 32_768,
        });
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: { withCredential: async (_provider, _context, use) => use("synthetic") },
            client: client(async (model) => {
                selectedApi = model.api;
                return response({
                    api: model.api as AssistantMessage["api"],
                    provider: model.provider,
                    model: model.id,
                });
            }),
            model: responsesModel,
        });

        await expect(adapter.invoke({
            ...input,
            provider: "jijiapi",
            model: "gpt-6-luna",
        }, context)).resolves.toMatchObject({ provider: "jijiapi", model: "gpt-6-luna" });
        expect(selectedApi).toBe("openai-responses");
    });

    it("maps a pi-ai completion into the provider-neutral result", async () => {
        let request: { context: Context; options: ProviderStreamOptions } | undefined;
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: { withCredential: async (_provider, _context, use) => use("secret-value") },
            client: client(async (_model, context, options) => {
                request = { context, options };
                return response();
            }),
        });

        await expect(adapter.invoke(input, context)).resolves.toMatchObject({
            content: "Hello back",
            toolCalls: [{ name: "lookup", arguments: { key: "value" } }],
            usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
            provider: "openai",
            model: "gpt-test",
            finishReason: "tool_call",
        });
        expect(request?.context.systemPrompt).toBe("Be concise.");
        expect(request?.context.messages).toHaveLength(1);
        expect(request?.context.tools?.[0]?.name).toBe("lookup");
        expect(request?.options.apiKey).toBe("secret-value");
        expect(request?.options.maxTokens).toBe(64);
    });

    it("keeps the credential callback open only while the SDK call is active", async () => {
        let callbackOpen = false;
        let callbackClosed = false;
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: {
                withCredential: async (_provider, _context, use) => {
                    callbackOpen = true;
                    try {
                        return await use("secret-value");
                    } finally {
                        callbackOpen = false;
                        callbackClosed = true;
                    }
                },
            },
            client: client(async () => {
                expect(callbackOpen).toBe(true);
                return response();
            }),
        });

        await adapter.invoke(input, context);
        expect(callbackOpen).toBe(false);
        expect(callbackClosed).toBe(true);
    });

    it("checks the local deadline again after credential resolution", async () => {
        let suppliedCredential = false;
        let sdkCalled = false;
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: {
                withCredential: async (_provider, _context, use) => {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    suppliedCredential = true;
                    return use("secret-value");
                },
            },
            client: client(async () => {
                sdkCalled = true;
                return response();
            }),
        });

        await expect(adapter.invoke({
            ...input,
            budget: { ...input.budget, maxDurationMs: 1 },
        }, context)).rejects.toMatchObject({ code: "timeout" });
        expect(suppliedCredential).toBe(true);
        expect(sdkCalled).toBe(false);
    });

    it("rejects a request routed to a different configured provider or model", async () => {
        const complete = vi.fn();
        const model = createPiAiOpenAICompletionsModel({
            provider: "configured-provider",
            model: "configured-model",
            name: "configured-model",
            baseUrl: "https://example.test/v1",
            contextWindow: 128_000,
            maxTokens: 16_000,
        });
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: { withCredential: vi.fn() },
            client: client(complete),
            model,
        });

        await expect(adapter.invoke(input, context)).rejects.toMatchObject({
            code: "invalid_input",
            retryable: false,
        });
        expect(complete).not.toHaveBeenCalled();
    });

    it("rejects a per-call output budget above the configured profile cap", async () => {
        const complete = vi.fn();
        const model = createPiAiOpenAICompletionsModel({
            provider: "openai",
            model: "gpt-test",
            name: "gpt-test",
            baseUrl: "https://example.test/v1",
            contextWindow: 128_000,
            maxTokens: 32,
        });
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: { withCredential: vi.fn() },
            client: client(complete),
            model,
        });

        await expect(adapter.invoke(input, context)).rejects.toMatchObject({ code: "budget_exhausted" });
        expect(complete).not.toHaveBeenCalled();
    });

    it("does not invoke pi-ai when credential resolution fails", async () => {
        const complete = vi.fn();
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: {
                withCredential: async () => {
                    throw new ActionExecutionError("authentication_required", "unavailable", false);
                },
            },
            client: client(complete),
        });

        await expect(adapter.invoke(input, context)).rejects.toMatchObject({
            code: "authentication_required",
            retryable: false,
        });
        expect(complete).not.toHaveBeenCalled();
    });

    it.each([
        [401, "authentication_required", false],
        [429, "rate_limited", true],
        [503, "dependency_unavailable", true],
    ] as const)("maps provider status %s", async (status, code, retryable) => {
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: { withCredential: async (_provider, _context, use) => use("secret-value") },
            client: client(async () => {
                throw Object.assign(new Error("provider request failed"), { status });
            }),
        });

        await expect(adapter.invoke(input, context)).rejects.toMatchObject({
            name: "ActionExecutionError",
            code,
            retryable,
        });
    });

    it("maps an aborted request and deadline separately", async () => {
        const cancelled = new AbortController();
        cancelled.abort();
        const adapter = new PiAiAgentInvocationAdapter({
            credentials: { withCredential: async (_provider, _context, use) => use("secret-value") },
            client: client(async () => response()),
        });
        await expect(adapter.invoke(input, { ...context, signal: cancelled.signal })).rejects.toMatchObject({
            code: "cancelled",
            retryable: false,
        });

        const timeoutAdapter = new PiAiAgentInvocationAdapter({
            credentials: { withCredential: async (_provider, _context, use) => use("secret-value") },
            client: client(async (_model, _context, options) => {
                await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve(), { once: true }));
                throw Object.assign(new Error("aborted"), { name: "AbortError" });
            }),
        });
        await expect(timeoutAdapter.invoke(input, context)).rejects.toMatchObject({
            code: "timeout",
            retryable: true,
        });
    });
});
