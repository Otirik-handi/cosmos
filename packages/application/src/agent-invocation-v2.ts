import {
    agentInvocationOutputSchema,
    agentInvocationV2InputSchema,
    type ActionDefinition,
    type AgentInvocationOutput,
    type AgentInvocationV2Input,
} from "@cosmos/contracts";

import {
    type ActionExecutionContext,
    type RegisteredAction,
} from "./action.js";
import type { AgentInvocationContext } from "./agent-invocation.js";

/**
 * 一次调用真正要用的模型配置：连接、模型与 Provider 必须来自同一次读取。
 *
 * 分开读会让"用户刚换了模型、缓存里还是旧地址"变成一次发往旧服务商的请求；
 * 因此读取方（`AgentModelConnectionResolver`）负责一次取齐，适配器只消费结果。
 */
export interface AgentModelConnectionSnapshot {
    connectionId: string;
    providerId: string;
    api: "openai-completions" | "openai-responses";
    baseUrl: string;
    modelId: string;
    modelName: string;
    contextWindow: number;
    maxOutputTokens: number;
    secretRef: string;
}

/**
 * 解析连接指向的模型配置。返回 `null` 表示这个连接当前不可用于调用
 * （不存在、已撤销、没有选模型、Provider 正在删除或没有凭证）。
 */
export interface AgentModelConnectionResolver {
    resolve(connectionId: string): Promise<AgentModelConnectionSnapshot | null>;
}

/** `agent.invoke@2` 的运行时边界：输入只有连接 ID，其余由服务端解析。 */
export interface AgentInvocationV2Port {
    invoke(
        input: AgentInvocationV2Input,
        context: AgentInvocationContext,
    ): Promise<AgentInvocationOutput>;
}

/**
 * 与 @1 相同的执行策略：Host 层面的重试与"一次 Action 里 SDK 发送几次"是两件事，
 * 适配器仍然每次调用只发送一次；这里不因为换成 @2 就放宽或收紧重试。
 */
const agentInvocationV2Definition: ActionDefinition = {
    ref: "agent.invoke@2",
    kind: "agent",
    description: "Invoke the model configured on a model connection.",
    capabilities: ["agent:invoke"],
    executionPlacement: "trusted_worker",
    inputSchema: agentInvocationV2InputSchema,
    outputSchema: agentInvocationOutputSchema,
    execution: {
        idempotent: false,
        supportsCancellation: true,
        timeoutMs: null,
        retryPolicy: {
            maxAttempts: 2,
            backoffMs: 1_000,
            retryableErrors: ["dependency_unavailable", "timeout", "rate_limited"],
        },
    },
};

/** Builds the connection-scoped Agent Action without creating a second runtime. */
export function createAgentInvocationV2Action(
    port: AgentInvocationV2Port,
): RegisteredAction {
    return {
        definition: agentInvocationV2Definition,
        handler: async (input: unknown, context: ActionExecutionContext) => {
            const parsedInput = agentInvocationV2InputSchema.parse(input);
            const output = await port.invoke(parsedInput, context);
            return agentInvocationOutputSchema.parse(output);
        },
    };
}

export function getAgentInvocationV2Definition(): ActionDefinition {
    return agentInvocationV2Definition;
}
