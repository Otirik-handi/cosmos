import {
    ActionExecutionError,
    createAgentInvocationV2Action,
    type AgentModelConnectionResolver,
    type RegisteredAction,
    type SecretStorePort,
} from "@cosmos/application";
import {
    PiAiAgentInvocationV2Adapter,
    defaultPiAiClient,
    type PiAiClientV2,
} from "@cosmos/agent-pi-ai";

/**
 * `agent.invoke@2` 的 Worker 装配：模型与凭证都来自连接解析，不再需要启动时固定的
 * Agent 配置。
 *
 * 这里始终注册 Action——与 @1 不同，@2 没有"Worker 没配 Agent 所以不可用"的状态：
 * 是否能用由调用时那条连接是否可用决定。没配 Provider 的用户收到的是连接不可用，
 * 而不是"这个 Worker 不支持"。
 */
export function createWorkerAgentInvocationV2Action(dependencies: {
    connections: AgentModelConnectionResolver;
    secrets: SecretStorePort;
    client?: PiAiClientV2;
}): RegisteredAction {
    return createAgentInvocationV2Action(new PiAiAgentInvocationV2Adapter({
        connections: dependencies.connections,
        secrets: {
            read: async (secretRef) => {
                try {
                    return await dependencies.secrets.read(secretRef);
                } catch {
                    // 存储层读取失败对调用方与"没有凭证"是同一种可恢复状态：换一条连接或
                    // 重新保存凭证即可，不需要区分内部错误类型。
                    throw new ActionExecutionError(
                        "authentication_required",
                        "The selected model connection credential could not be loaded.",
                        false,
                    );
                }
            },
        },
        client: dependencies.client ?? defaultPiAiClient,
    }));
}
