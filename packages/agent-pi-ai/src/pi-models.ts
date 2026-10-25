import { ActionExecutionError } from "@cosmos/application";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";

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

/**
 * pi-ai 不抛 HTTP 错误：失败时它把 `errorMessage` 填成 `"<status> <message>"`（`stream`
 * 的 catch 分支），并以 `stopReason: "error"` 正常结束。忽略这一点会把 401/429/5xx 全部
 * 误报成 `malformed_payload`，既丢掉服务商的真实原因，又让本该重试的错误变成不可重试。
 */
export function mapPiAiResponseFailure(
    response: Pick<AssistantMessage, "stopReason" | "errorMessage">,
    provider: string,
): ActionExecutionError | null {
    if (response.stopReason !== "error") return null;
    const status = /^(\d{3})\b/.exec(response.errorMessage ?? "")?.[1];
    return mapPiAiError(
        { status: status === undefined ? undefined : Number(status), message: response.errorMessage },
        provider,
    );
}

export function mapPiAiError(error: unknown, provider: string): ActionExecutionError {
    const message = error instanceof Error ? error.message : "pi-ai request failed.";
    const value = error as { status?: number; code?: string; name?: string };
    if (value.name === "AbortError" || value.code === "ABORT_ERR") {
        return new ActionExecutionError("timeout", "Agent invocation timed out.", true);
    }
    // 具体原因优先于状态码：网关常用 400 报告「无效的 api key」或「上下文超长」，
    // 按状态码一刀切会把它们归类成配置错误，掩盖真正可操作的那一类。
    if (value.status === 401 || value.status === 403 || /auth|api key|credential/i.test(message)) {
        return new ActionExecutionError("authentication_required", `Provider ${provider} rejected credentials.`, false);
    }
    if (value.status === 429 || /rate.?limit|too many requests/i.test(message)) {
        return new ActionExecutionError("rate_limited", `Provider ${provider} rate limited the request.`, true);
    }
    if (/budget|token limit|context length/i.test(message)) {
        return new ActionExecutionError("budget_exhausted", `Provider ${provider} rejected the request budget.`, false);
    }
    // 400/404/422 是请求本身被拒（模型名、参数、消息类型不合法），重发同样的请求不会变好；
    // 归到可重试错误会白白多打一次真实请求。
    if (value.status === 400 || value.status === 422) {
        return new ActionExecutionError(
            "invalid_configuration", `Provider ${provider} rejected the request (HTTP ${value.status}).`, false,
        );
    }
    if (value.status === 404) {
        return new ActionExecutionError(
            "invalid_configuration", `Provider ${provider} does not expose this endpoint or model.`, false,
        );
    }
    return new ActionExecutionError("dependency_unavailable", `Provider ${provider} is unavailable.`, true);
}
