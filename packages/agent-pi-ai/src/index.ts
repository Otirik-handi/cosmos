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
import {
    createPiAiOpenAICompletionsModel,
    createPiAiOpenAIResponsesModel,
    mapPiAiError,
    type PiModel,
} from "./pi-models.js";

// 模型构造与协议错误映射由 `pi-models.ts` 拥有，@2 的适配器也从那里导入以避开循环。
export {
    createPiAiOpenAICompletionsModel,
    createPiAiOpenAIResponsesModel,
    mapPiAiError,
    type PiAiOpenAICompletionsModelConfig,
    type PiModel,
} from "./pi-models.js";

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
    model?: Model<"openai-completions"> | Model<"openai-responses">;
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

// agent.invoke@2 的适配器按连接解析模型，和上面的固定模型适配器共用同一套协议错误映射。
export {
    PiAiAgentInvocationV2Adapter,
    type PiAiAgentInvocationV2AdapterOptions,
    type PiAiClientV2,
    type PiAiSecretReader,
} from "./invocation-v2.js";
