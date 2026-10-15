import {
    complete,
    getModel,
    type AssistantMessage,
    type Context,
    type Model,
    type ProviderStreamOptions,
} from "@mariozechner/pi-ai";
import {
    ActionExecutionError,
    type AgentInvocationContext,
    type AgentInvocationPort,
} from "@cosmos/application";
import {
    agentInvocationOutputSchema,
    type AgentInvocationInput,
    type AgentInvocationOutput,
} from "@cosmos/contracts";

export type PiModel = Model<string & {}>;

export interface PiAiOpenAICompletionsModelConfig {
    provider: string;
    model: string;
    name: string;
    baseUrl: string;
    contextWindow: number;
    maxTokens: number;
}

export function createPiAiOpenAICompletionsModel(
    config: PiAiOpenAICompletionsModelConfig,
): Model<"openai-completions"> {
    return {
        id: config.model,
        name: config.name,
        api: "openai-completions",
        provider: config.provider,
        baseUrl: config.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.contextWindow,
        maxTokens: config.maxTokens,
    };
}

export interface PiAiCredentialResolver {
    withCredential<T>(
        provider: string,
        context: AgentInvocationContext,
        use: (credential: string) => Promise<T>,
    ): Promise<T>;
}

export interface PiAiClient {
    getModel(provider: string, model: string): PiModel;
    complete(
        model: PiModel,
        context: Context,
        options: ProviderStreamOptions,
    ): Promise<AssistantMessage>;
}

export const defaultPiAiClient: PiAiClient = {
    getModel: (provider, model) => getModel(provider as never, model as never) as PiModel,
    complete: (model, context, options) => complete(model, context, options),
};

export interface PiAiAgentInvocationAdapterOptions {
    credentials: PiAiCredentialResolver;
    client?: PiAiClient;
    model?: Model<"openai-completions">;
}

export class PiAiAgentInvocationAdapter implements AgentInvocationPort {
    private readonly client: PiAiClient;

    constructor(private readonly options: PiAiAgentInvocationAdapterOptions) {
        this.client = options.client ?? defaultPiAiClient;
    }

    async invoke(
        input: AgentInvocationInput,
        context: AgentInvocationContext,
    ): Promise<AgentInvocationOutput> {
        if (context.signal.aborted) {
            throw new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
        }
        if (this.options.model &&
            (this.options.model.provider !== input.provider || this.options.model.id !== input.model)) {
            throw new ActionExecutionError(
                "invalid_input",
                "Agent invocation provider and model must match the configured Worker profile.",
                false,
            );
        }
        if (this.options.model && input.budget.maxOutputTokens > this.options.model.maxTokens) {
            throw new ActionExecutionError(
                "budget_exhausted",
                "Agent invocation output budget exceeds the configured Worker profile limit.",
                false,
            );
        }

        const controller = new AbortController();
        const abort = () => controller.abort();
        context.signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(() => controller.abort(), input.budget.maxDurationMs);

        try {
            return await this.options.credentials.withCredential(
                input.provider,
                { ...context, signal: controller.signal },
                async (credential) => {
                    if (controller.signal.aborted) {
                        throw new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
                    }
                    const response = await this.client.complete(
                        this.options.model ?? this.client.getModel(input.provider, input.model),
                        toPiContext(input),
                        {
                            apiKey: credential,
                            maxTokens: input.budget.maxOutputTokens,
                            signal: controller.signal,
                            metadata: { idempotencyKey: context.idempotencyKey },
                        },
                    );
                    if (controller.signal.aborted) {
                        throw new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
                    }
                    return mapResponse(response, input);
                },
            );
        } catch (error) {
            if (context.signal.aborted) {
                throw new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
            }
            if (controller.signal.aborted) {
                throw new ActionExecutionError("timeout", "Agent invocation timed out.", true);
            }
            if (error instanceof ActionExecutionError) {
                throw error;
            }
            throw mapPiAiError(error, input.provider);
        } finally {
            clearTimeout(timeout);
            context.signal.removeEventListener("abort", abort);
        }
    }
}

function toPiContext(input: AgentInvocationInput): Context {
    const system = input.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
    const messages = input.messages
        .filter((message) => message.role !== "system")
        .map((message) => {
            if (message.role === "assistant") {
                return {
                    role: "assistant" as const,
                    content: [{ type: "text" as const, text: message.content }],
                    api: "openai-completions" as const,
                    provider: input.provider,
                    model: input.model,
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                    },
                    stopReason: "stop" as const,
                    timestamp: Date.now(),
                };
            }
            return {
                role: "user" as const,
                content: message.role === "tool" ? `[tool] ${message.content}` : message.content,
                timestamp: Date.now(),
            };
        });

    return {
        ...(system ? { systemPrompt: system } : {}),
        messages,
        tools: input.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as never,
        })),
    };
}

function mapResponse(response: AssistantMessage, input: AgentInvocationInput): AgentInvocationOutput {
    const content = response.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");
    const toolCalls = response.content
        .filter((part): part is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => part.type === "toolCall")
        .map((part) => ({ name: part.name, arguments: part.arguments }));
    const finishReason = response.stopReason === "toolUse"
        ? "tool_call"
        : response.stopReason === "length"
            ? "length"
            : response.stopReason === "aborted"
                ? "cancelled"
                : response.stopReason === "stop"
                    ? "stop"
                    : null;

    if (finishReason === null || response.usage.input < 0 || response.usage.output < 0) {
        throw new ActionExecutionError("malformed_payload", "pi-ai returned an unsupported response.", false);
    }

    try {
        return agentInvocationOutputSchema.parse({
            content,
            toolCalls,
            usage: {
                inputTokens: response.usage.input,
                outputTokens: response.usage.output,
                totalTokens: response.usage.totalTokens,
            },
            provider: response.provider || input.provider,
            model: response.model || input.model,
            finishReason,
            metadata: {},
        });
    } catch (error) {
        throw new ActionExecutionError("malformed_payload", "pi-ai returned an invalid response.", false, { cause: error });
    }
}

function mapPiAiError(error: unknown, provider: string): ActionExecutionError {
    const message = error instanceof Error ? error.message : "pi-ai request failed.";
    const value = error as { status?: number; code?: string; name?: string };
    if (value.name === "AbortError" || value.code === "ABORT_ERR") {
        return new ActionExecutionError("timeout", "Agent invocation timed out.", true);
    }
    if (value.status === 401 || value.status === 403 || /auth|api key|credential/i.test(message)) {
        return new ActionExecutionError("authentication_required", `Provider ${provider} rejected credentials.`, false);
    }
    if (value.status === 429 || /rate.?limit|too many requests/i.test(message)) {
        return new ActionExecutionError("rate_limited", `Provider ${provider} rate limited the request.`, true);
    }
    if (/budget|token limit|context length/i.test(message)) {
        return new ActionExecutionError("budget_exhausted", `Provider ${provider} rejected the request budget.`, false);
    }
    return new ActionExecutionError("dependency_unavailable", `Provider ${provider} is unavailable.`, true);
}
