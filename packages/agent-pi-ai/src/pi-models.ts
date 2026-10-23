import { ActionExecutionError } from "@cosmos/application";
import type { Model } from "@mariozechner/pi-ai";

/**
 * 两种显式协议的模型构造与协议错误映射。
 *
 * 单独成文件是为了让 `index.ts` 与 `invocation-v2.ts` 都只依赖这里：@2 的适配器需要
 * 这两个构造器和错误映射，如果它反过来从 `index.ts` 导入，包入口又会导出 @2 的适配器，
 * 形成循环——ESM 下循环里的类会先拿到 `undefined`，失败点是运行时的 "not a constructor"。
 */
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

export function createPiAiOpenAIResponsesModel(
    config: PiAiOpenAICompletionsModelConfig,
): Model<"openai-responses"> {
    return {
        id: config.model,
        name: config.name,
        api: "openai-responses",
        provider: config.provider,
        baseUrl: config.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.contextWindow,
        maxTokens: config.maxTokens,
    };
}

export function mapPiAiError(error: unknown, provider: string): ActionExecutionError {
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
