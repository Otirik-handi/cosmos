import {MODEL_CONNECTION_CONNECTOR_ID, type ConnectionInstance} from "@cosmos/contracts";
import {CosmosTransportError, type HttpCosmosClient} from "@cosmos/transport-http";

import {ConnectionPanel} from "@/components/cosmos/connection-panel";
import {ModelProviderPanel} from "@/components/cosmos/model-provider-panel";
import {ProviderModelsSection} from "@/components/cosmos/provider-models-section";
import {ToastHost, ToastProvider} from "@/components/ui/toast";

import {optionProp} from "./registry/shared";
import type {LabProps} from "./types";

/**
 * 模型页的夹具（Proposal connection-credential-entry-v1）：一个服务商、两个模型，
 * 发现返回三个候选，其中一个是已配置模型——界面上它应当显示成「已添加」而不是可再添加。
 *
 * 夹具不假装任何真实外呼：`discoverProviderModels` 只回一份固定快照。
 *
 * 独立成文件是因为 `product-fixtures.tsx` 已到 50 KB 红线（单文件治理口径），
 * 模型这组夹具与其余产品夹具没有共享状态。
 */
const fixtureTimestamp = "2026-01-01T00:00:00.000Z";

const modelLabProvider = {
    id: "provider-deepseek",
    name: "我的 DeepSeek",
    api: "openai-completions" as const,
    baseUrl: "https://api.deepseek.example/v1",
    version: 2,
    state: "active" as const,
    credentialState: "configured" as const,
    createdAt: fixtureTimestamp,
    updatedAt: fixtureTimestamp,
};

const modelLabModels = [
    {
        id: "model-chat",
        providerId: modelLabProvider.id,
        modelId: "deepseek-chat",
        name: "DeepSeek Chat",
        contextWindow: 65_536,
        maxOutputTokens: 8_192,
        version: 1,
    },
    {
        id: "model-reasoner",
        providerId: modelLabProvider.id,
        modelId: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        contextWindow: 65_536,
        maxOutputTokens: 8_192,
        version: 1,
    },
];

const modelDiscoveryLabSnapshot = {
    id: "discovery-lab",
    providerId: modelLabProvider.id,
    providerVersion: modelLabProvider.version,
    status: "succeeded" as const,
    candidates: [
        {modelId: "deepseek-chat", name: "DeepSeek Chat"},
        {modelId: "deepseek-coder", name: "DeepSeek Coder"},
        {modelId: "deepseek-reasoner", name: "DeepSeek Reasoner"},
    ],
    errorCode: null,
    createdAt: fixtureTimestamp,
    updatedAt: fixtureTimestamp,
};

/** 实验室里 Provider 面板用到的客户端能力：只有这几个方法会被面板调用。 */
const modelPanelLabMethods = {
    listModelProviders: async () => ({items: [modelLabProvider], nextCursor: null}),
    listConfiguredModels: async () => ({items: modelLabModels, nextCursor: null}),
    discoverProviderModels: async () => modelDiscoveryLabSnapshot,
    createModelProvider: async () => modelLabProvider,
    updateModelProvider: async () => modelLabProvider,
    createConfiguredModel: async () => modelLabModels[0],
    deleteConfiguredModel: async () => {},
    deleteModelProvider: async () => {},
    // 编辑框会 join 连接列表来提示「改动会影响谁」；实验室给一条引用 chat 的模型连接。
    listConnections: async () => [{
        id: "connection-deepseek-agent",
        name: "DeepSeek 助手",
        connectorId: "cosmos.agent",
        status: "active" as const,
        modelId: modelLabModels[0]!.id,
        version: 1,
        createdAt: fixtureTimestamp,
        updatedAt: fixtureTimestamp,
    }],
};

const modelPanelLabClient = modelPanelLabMethods as unknown as HttpCosmosClient;

/**
 * 被连接引用时的删除：服务端返回 409 `in_use`，界面必须把原因留在列表上方，
 * 而不是弹一个几秒就消失的提示。真实判定在服务端事务里，这里只复现契约。
 */
const modelPanelConflictClient = {
    ...modelPanelLabMethods,
    deleteModelProvider: async () => {
        throw new CosmosTransportError(409, {
            code: "in_use",
            message: "Model configuration write rejected.",
            retryable: false,
        });
    },
} as unknown as HttpCosmosClient;

export function renderModelProviderPanelLab(props: LabProps) {
    const state = optionProp(props, "state", "populated", ["populated", "conflict", "empty"] as const);
    const client = state === "empty"
        ? ({
            listModelProviders: async () => ({items: [], nextCursor: null}),
        } as unknown as HttpCosmosClient)
        : state === "conflict"
            ? modelPanelConflictClient
            : modelPanelLabClient;
    // 面板无条件调用 useToast()，而 /dev/components 不在 (shell)/(reading) 路由组里，
    // 没有祖先 Provider；缺它会抛「must be used within <Toast.Provider>」并让整个预览台不渲染
    // （实测 toHaveCount(0)，不是渲染出空面板）。
    return (
        <ToastProvider>
            <ModelProviderPanel client={client} />
            <ToastHost />
        </ToastProvider>
    );
}

const modelConnectionLabConnections: ConnectionInstance[] = [
    {
        id: "connection-model-unset",
        name: "未选模型的连接",
        connectorId: MODEL_CONNECTION_CONNECTOR_ID,
        account: null,
        scopeJson: null,
        configJson: null,
        status: "active",
        // 模型连接的凭证属于 Provider（API 0009）：连接自己带 secretRef 就是所有权越界。
        secretRef: null,
        lastError: null,
        lastCheckedAt: null,
        modelId: null,
        version: 1,
        createdAt: fixtureTimestamp,
        updatedAt: fixtureTimestamp,
    },
    {
        id: "connection-model-selected",
        name: "已选模型的连接",
        connectorId: MODEL_CONNECTION_CONNECTOR_ID,
        account: null,
        scopeJson: null,
        configJson: null,
        status: "active",
        secretRef: null,
        lastError: null,
        lastCheckedAt: null,
        modelId: modelLabModels[0]!.id,
        version: 1,
        createdAt: fixtureTimestamp,
        updatedAt: fixtureTimestamp,
    },
    {
        id: "connection-model-missing",
        name: "模型已删除的连接",
        connectorId: MODEL_CONNECTION_CONNECTOR_ID,
        account: null,
        scopeJson: null,
        configJson: null,
        status: "active",
        secretRef: null,
        lastError: null,
        lastCheckedAt: null,
        // 指向一个列表里不存在的模型：模型被删后连接不能假装还配着。
        modelId: "model-removed",
        version: 1,
        createdAt: fixtureTimestamp,
        updatedAt: fixtureTimestamp,
    },
];

/**
 * 模型连接场景的客户端。保存换选后面板会重新读列表，所以状态必须可写、且每次读取返回
 * 新数组（引用相同会让 `setConnections` 认为没变化）。模块级单例是刻意的：面板的加载
 * effect 依赖 `client` 引用，每次渲染换新对象会无限重取；整页刷新会重新加载模块，用例之间
 * 不会互相污染。
 */
const modelConnectionLabClient = {
    listConnections: async () => [...modelConnectionLabConnections],
    listSourceDefinitions: async () => [],
    listModelProviders: async () => ({items: [modelLabProvider], nextCursor: null}),
    listConfiguredModels: async () => ({items: modelLabModels, nextCursor: null}),
    updateConnection: async (
        connectionId: string,
        input: {
            expectedVersion?: number;
            modelId?: string | null;
            status?: ConnectionInstance["status"];
            lastError?: string | null;
        },
    ) => {
        const index = modelConnectionLabConnections.findIndex((item) => item.id === connectionId);
        const current = modelConnectionLabConnections[index];
        if (current === undefined) {
            throw new CosmosTransportError(404, {
                code: "not_found",
                message: "Connection not found.",
                retryable: false,
            });
        }
        // 换选带期望版本：面板据此在并发覆盖时显示版本冲突，而不是静默成功。
        if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
            throw new CosmosTransportError(409, {
                code: "version_conflict",
                message: "Connection was updated.",
                retryable: false,
            });
        }
        const updated: ConnectionInstance = {
            ...current,
            ...(input.modelId === undefined ? {} : {modelId: input.modelId}),
            ...(input.status === undefined ? {} : {status: input.status}),
            ...(input.lastError === undefined ? {} : {lastError: input.lastError}),
            version: current.version + 1,
            updatedAt: fixtureTimestamp,
        };
        modelConnectionLabConnections[index] = updated;
        return updated;
    },
} as unknown as HttpCosmosClient;

/** 连接面板的模型态：同一份列表里三种模型连接（未选、已选、指向已删模型）。 */
export function renderConnectionPanelModelLab() {
    return <ConnectionPanel client={modelConnectionLabClient} />;
}

export function renderProviderModelsSectionLab(props: LabProps) {
    const state = optionProp(props, "state", "populated", ["populated", "empty"] as const);
    const client = state === "empty"
        ? ({
            listConfiguredModels: async () => ({items: [], nextCursor: null}),
            discoverProviderModels: async () => ({
                ...modelDiscoveryLabSnapshot,
                status: "succeeded" as const,
                candidates: [],
            }),
        } as unknown as HttpCosmosClient)
        : modelPanelLabClient;
    return <ProviderModelsSection client={client} provider={modelLabProvider} />;
}
