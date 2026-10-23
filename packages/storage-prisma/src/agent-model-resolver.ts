import { MODEL_CONNECTION_CONNECTOR_ID } from "@cosmos/contracts";
import type { AgentModelConnectionResolver, AgentModelConnectionSnapshot } from "@cosmos/application";

/**
 * 一次读取返回连接、模型与 Provider 的同一时刻快照。
 *
 * 分三次查（连接 → 模型 → Provider）会读到三个时刻的状态：用户刚把连接换到别的模型时，
 * 可能出现"用新模型的预算、旧服务商的地址"这种混合结果，然后把请求发到错误的地址。
 */
const connectionSelect = {
    id: true,
    connectorId: true,
    status: true,
    modelId: true,
    model: {
        select: {
            modelId: true,
            name: true,
            contextWindow: true,
            maxOutputTokens: true,
            provider: { select: { id: true, api: true, baseUrl: true, state: true, secretRef: true } },
        },
    },
} as const;

interface ResolvedRow {
    id: string;
    connectorId: string;
    status: string;
    modelId: string | null;
    model: {
        modelId: string;
        name: string;
        contextWindow: number;
        maxOutputTokens: number;
        provider: { id: string; api: string; baseUrl: string; state: string; secretRef: string | null };
    } | null;
}

interface ResolverClient {
    connectionInstance: {
        findUnique(input: { where: { id: string }; select: typeof connectionSelect }): Promise<ResolvedRow | null>;
    };
}

/**
 * 把持久化行翻译成调用所需的配置；任何一项不满足就返回 `null`。
 *
 * 不在这里抛具体错误：调用方（Worker）需要区分"连接不可用"与"上游失败"，
 * 但两者对用户都是"这次调用没发出去"，由 Action 层给出固定的错误码。
 */
export class PrismaAgentModelConnectionResolver implements AgentModelConnectionResolver {
    constructor(private readonly client: ResolverClient) {}

    async resolve(connectionId: string): Promise<AgentModelConnectionSnapshot | null> {
        const row = await this.client.connectionInstance.findUnique({
            where: { id: connectionId },
            select: connectionSelect,
        });
        if (row === null || row.status !== "active" || row.connectorId !== MODEL_CONNECTION_CONNECTOR_ID) return null;
        if (row.modelId === null || row.model === null) return null;
        const provider = row.model.provider;
        // Provider 处于 deleting 时它的 key 可能已在清理；此时发请求只会得到 401。
        if (provider.state !== "active" || provider.secretRef === null) return null;
        if (provider.api !== "openai-completions" && provider.api !== "openai-responses") return null;
        return {
            connectionId: row.id,
            providerId: provider.id,
            api: provider.api,
            baseUrl: provider.baseUrl,
            modelId: row.model.modelId,
            modelName: row.model.name,
            contextWindow: row.model.contextWindow,
            maxOutputTokens: row.model.maxOutputTokens,
            secretRef: provider.secretRef,
        };
    }
}
