import type { ConnectorDescriptor } from "@cosmos/contracts";

export interface ManifestHash {
    algorithm: string;
    value: string;
}

export interface JsonSchemaRef {
    id: string;
    version: number;
    hash: ManifestHash;
    schema?: Record<string, unknown>;
}

export interface SourceOperationManifest {
    operationId: string;
    inputSchema: JsonSchemaRef;
    outputSchema: JsonSchemaRef;
    externalKey: string;
    discoveryContext: string;
    media: "none" | "download" | "metadata_only";
    stateStoreNamespace: string | null;
}

export interface SourceAuthManifest {
    kind: "none" | "oauth" | "cookie" | "secret_ref" | "external";
    label: string | null;
    secretRefRequired: boolean;
}

export interface SourceDefinitionManifest {
    id: string;
    version: number;
    ref: string;
    provider: string;
    connectorId: string;
    displayName: string;
    description: string | null;
    manifestHash: ManifestHash;
    status: "enabled" | "disabled" | "unavailable" | "incompatible";
    operationIds: readonly string[];
    capabilities: readonly string[];
    configurationSchema: JsonSchemaRef;
    auth: SourceAuthManifest;
    operations: readonly SourceOperationManifest[];
}

export interface WorkflowDefinitionManifest {
    id: string;
    version: number;
    ref: string;
    kind: "ingest" | "knowledge" | "research" | "maintenance" | "delivery" | "interaction" | "custom";
    provider: string;
    manifestHash: ManifestHash;
    status: "enabled" | "disabled" | "unavailable" | "incompatible";
    requiredActionRefs: readonly string[];
    requiredBackendCapabilities: Readonly<Record<string, boolean>>;
    inputSchema: JsonSchemaRef;
    outputSchema: JsonSchemaRef;
}

export interface ActionDefinitionManifest {
    id: string;
    version: number;
    ref: string;
    provider: string;
    manifestHash: ManifestHash;
    effectMode: "none" | "external";
    executionPlacement: "host" | "trusted_worker" | "remote_worker";
    requiredCapabilities: readonly string[];
    status: "enabled" | "disabled" | "unavailable" | "incompatible";
    inputSchema: JsonSchemaRef;
    outputSchema: JsonSchemaRef;
}
export interface CatalogPort {
    listSourceDefinitions(): readonly SourceDefinitionManifest[];
    getSourceDefinition(id: string, version?: number): SourceDefinitionManifest | null;
    getSourceDefinitionByRef(ref: string): SourceDefinitionManifest | null;
    listWorkflowDefinitions(): readonly WorkflowDefinitionManifest[];
    getWorkflowDefinition(id: string, version: number): WorkflowDefinitionManifest | null;
    listActionDefinitions(): readonly ActionDefinitionManifest[];
    getActionDefinition(id: string, version: number): ActionDefinitionManifest | null;
    listConnectors(): readonly ConnectorDescriptor[];
}

export class StaticCatalog implements CatalogPort {
    private readonly sourceDefinitions: readonly SourceDefinitionManifest[];
    private readonly workflowDefinitions: readonly WorkflowDefinitionManifest[];
    private readonly actionDefinitions: readonly ActionDefinitionManifest[];
    private readonly connectors: readonly ConnectorDescriptor[];

    /**
     * catalog 是进程级共享单例（API 的 `cosmosCatalog`、Worker 的 manifest evidence 都读它），
     * 读接口按值返回：调用方拿到的是副本，改不动共享的 manifest、schema 与 capability。
     */
    private copySourceDefinition(item: SourceDefinitionManifest): SourceDefinitionManifest {
        return {
            ...item,
            operationIds: [...item.operationIds],
            capabilities: [...item.capabilities],
            operations: item.operations.map((operation) => ({ ...operation })),
            auth: { ...item.auth },
        };
    }

    constructor(input: {
        sourceDefinitions: readonly SourceDefinitionManifest[];
        workflowDefinitions: readonly WorkflowDefinitionManifest[];
        actionDefinitions: readonly ActionDefinitionManifest[];
        connectors: readonly ConnectorDescriptor[];
    }) {
        this.sourceDefinitions = input.sourceDefinitions.map((item) => this.copySourceDefinition(item));
        this.workflowDefinitions = input.workflowDefinitions.map((item) => ({
            ...item,
            requiredActionRefs: [...item.requiredActionRefs],
        }));
        this.actionDefinitions = input.actionDefinitions.map((item) => ({
            ...item,
            requiredCapabilities: [...item.requiredCapabilities],
        }));
        this.connectors = input.connectors.map((item) => ({
            ...item,
            capabilities: [...item.capabilities],
        }));
    }

    listSourceDefinitions(): readonly SourceDefinitionManifest[] {
        return this.sourceDefinitions.map((item) => this.copySourceDefinition(item));
    }

    getSourceDefinition(id: string, version?: number): SourceDefinitionManifest | null {
        const found = this.sourceDefinitions.find(
            (item) => item.id === id && (version === undefined || item.version === version),
        );
        return found ? this.copySourceDefinition(found) : null;
    }

    getSourceDefinitionByRef(ref: string): SourceDefinitionManifest | null {
        const found = this.sourceDefinitions.find((item) => item.ref === ref);
        return found ? this.copySourceDefinition(found) : null;
    }

    listWorkflowDefinitions(): readonly WorkflowDefinitionManifest[] {
        return this.workflowDefinitions.map((item) => ({
            ...item,
            requiredActionRefs: [...item.requiredActionRefs],
        }));
    }

    getWorkflowDefinition(id: string, version: number): WorkflowDefinitionManifest | null {
        const found = this.workflowDefinitions.find(
            (item) => item.id === id && item.version === version,
        );
        return found ? { ...found, requiredActionRefs: [...found.requiredActionRefs] } : null;
    }

    listActionDefinitions(): readonly ActionDefinitionManifest[] {
        return this.actionDefinitions.map((item) => ({
            ...item,
            requiredCapabilities: [...item.requiredCapabilities],
        }));
    }

    getActionDefinition(id: string, version: number): ActionDefinitionManifest | null {
        const found = this.actionDefinitions.find(
            (item) => item.id === id && item.version === version,
        );
        return found ? { ...found, requiredCapabilities: [...found.requiredCapabilities] } : null;
    }

    listConnectors(): readonly ConnectorDescriptor[] {
        return this.connectors.map((item) => ({ ...item, capabilities: [...item.capabilities] }));
    }
}

const builtinSchema = (id: string, schema: Record<string, unknown>): JsonSchemaRef => ({
    id,
    version: 1,
    hash: { algorithm: "builtin", value: id },
    schema,
});

const builtinHash = (value: string): ManifestHash => ({
    algorithm: "builtin",
    value,
});

const sourceOperation = (
    ref: string,
    externalKey: string,
    media: SourceOperationManifest["media"],
    /**
     * 连接器状态命名空间模板（ADR-0018）：`{id}` 由宿主替换成**采集计划 id**
     * （ADR-0023 决策 2）。模板不带前缀——计划 id 本身已经形如 `plan:<sourceId>`，
     * 再加一层前缀会得到 `plan:plan:<sourceId>`。
     */
    stateStoreNamespace: string | null = "{id}",
): SourceOperationManifest => ({
    operationId: "fetch",
    inputSchema: builtinSchema(`${ref}.fetch.input@1`, { type: "object" }),
    outputSchema: builtinSchema(`${ref}.fetch.output@1`, { type: "object" }),
    externalKey,
    discoveryContext: "",
    media,
    stateStoreNamespace,
});

const noAuth: SourceAuthManifest = { kind: "none", label: null, secretRefRequired: false };
const externalAuth: SourceAuthManifest = { kind: "external", label: "OpenCLI 浏览器登录态", secretRefRequired: false };

export function createBuiltinManifestCatalog(): StaticCatalog {
    const sourceDefinitions: readonly SourceDefinitionManifest[] = [
        {
            id: "rss",
            version: 1,
            ref: "source.rss@1",
            provider: "cosmos",
            connectorId: "rss",
            displayName: "RSS",
            description: "Fetch one RSS or Atom feed page.",
            manifestHash: builtinHash("builtin:source.rss@1"),
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor"],
            configurationSchema: builtinSchema("source.rss.config@1", {
                type: "object",
                properties: {
                    feedUrl: { type: "string", format: "uri" },
                },
                required: ["feedUrl"],
                additionalProperties: false,
            }),
            auth: noAuth,
            operations: [sourceOperation("source.rss", "url", "download")],
        },
        {
            id: "fixture-rss",
            version: 1,
            ref: "source.fixture-rss@1",
            provider: "cosmos",
            connectorId: "fixture-rss",
            displayName: "Fixture RSS",
            description: "Read a configured fixture feed in a trusted workspace.",
            manifestHash: builtinHash("builtin:source.fixture-rss@1"),
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor"],
            configurationSchema: builtinSchema("source.fixture-rss.config@1", {
                type: "object",
                properties: {},
                additionalProperties: false,
            }),
            auth: noAuth,
            operations: [sourceOperation("source.fixture-rss", "url", "metadata_only")],
        },
        {
            id: "bilibili",
            version: 1,
            ref: "source.bilibili@1",
            provider: "cosmos",
            connectorId: "bilibili",
            displayName: "Bilibili",
            description: "Read Bilibili data through a trusted OpenCLI profile.",
            manifestHash: builtinHash("builtin:source.bilibili@1"),
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor", "external:opencli"],
            configurationSchema: builtinSchema("source.bilibili.config@1", {
                type: "object",
                properties: { mode: { enum: ["hot", "feed"] }, profile: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
                required: ["mode"],
                additionalProperties: false,
            }),
            auth: externalAuth,
            operations: [sourceOperation("source.bilibili", "url", "metadata_only")],
        },
        {
            id: "aihot",
            version: 1,
            ref: "source.aihot@1",
            provider: "cosmos",
            connectorId: "aihot",
            displayName: "AI HOT",
            description: "Fetch the AI HOT JSON feed.",
            manifestHash: builtinHash("builtin:source.aihot@1"),
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor"],
            configurationSchema: builtinSchema("source.aihot.config@1", {
                type: "object",
                properties: {},
                additionalProperties: false,
            }),
            auth: noAuth,
            operations: [sourceOperation("source.aihot", "url", "metadata_only")],
        },
    ];

    const workflowInput = builtinSchema("cosmos.ingest.input@1", {
        type: "object",
        required: ["source", "cursor", "checkpointRevision", "triggerKind"],
    });
    const workflowOutput = builtinSchema("cosmos.ingest.output@1", {
        type: "object",
        required: ["itemCount", "nextCursor", "checkpointRevision", "checkpointCommitted"],
    });
    const cleanupInput = builtinSchema("cosmos.media-cleanup.input@1", {
        type: "object",
        required: ["sourceId", "dryRun"],
    });
    const cleanupOutput = builtinSchema("cosmos.media-cleanup.output@1", {
        type: "object",
        required: ["dryRun", "candidateCount", "cleanedCount"],
    });
    const workflowDefinitions: readonly WorkflowDefinitionManifest[] = [{
        id: "cosmos.ingest",
        version: 1,
        ref: "cosmos.ingest@1",
        kind: "ingest",
        provider: "cosmos",
        manifestHash: builtinHash("builtin:cosmos.ingest@1:source-snapshot-v2"),
        status: "enabled",
        requiredActionRefs: [
            "source.fetch@1",
            "library.ingest@1",
            "media.retry.fetch@1",
            "media.retry.apply@1",
            "collection-plan.checkpoint@1",
        ],
        requiredBackendCapabilities: {
            processRestart: true,
            multiWorker: true,
            leases: true,
            externalReceipts: true,
            valueReferences: true,
        },
        inputSchema: workflowInput,
        outputSchema: workflowOutput,
    }, {
        id: "cosmos.media-cleanup",
        version: 1,
        ref: "cosmos.media-cleanup@1",
        kind: "maintenance",
        provider: "cosmos",
        manifestHash: builtinHash("builtin:cosmos.media-cleanup@1"),
        status: "enabled",
        requiredActionRefs: ["media.cleanup@1"],
        requiredBackendCapabilities: {
            processRestart: true,
            multiWorker: true,
            leases: true,
            externalReceipts: true,
            valueReferences: true,
        },
        inputSchema: cleanupInput,
        outputSchema: cleanupOutput,
    }];
    const actionDefinitions: readonly ActionDefinitionManifest[] = [
        {
            id: "source.fetch",
            version: 1,
            ref: "source.fetch@1",
            provider: "cosmos",
            manifestHash: builtinHash("builtin:source.fetch@1:source-snapshot-v1"),
            effectMode: "external",
            executionPlacement: "trusted_worker",
            requiredCapabilities: ["source:read"],
            status: "enabled",
            inputSchema: builtinSchema("source.fetch.input@1", { type: "object" }),
            outputSchema: builtinSchema("source.fetch.output@1", { type: "object" }),
        },
        {
            id: "library.ingest",
            version: 1,
            ref: "library.ingest@1",
            provider: "cosmos",
            manifestHash: builtinHash("builtin:library.ingest@1"),
            effectMode: "none",
            executionPlacement: "host",
            requiredCapabilities: ["library:write"],
            status: "enabled",
            inputSchema: builtinSchema("library.ingest.input@1", { type: "object" }),
            outputSchema: builtinSchema("library.ingest.output@1", { type: "object" }),
        },
        {
            id: "media.retry.fetch",
            version: 1,
            ref: "media.retry.fetch@1",
            provider: "cosmos",
            manifestHash: builtinHash("builtin:media.retry.fetch@1"),
            effectMode: "external",
            executionPlacement: "trusted_worker",
            requiredCapabilities: ["source:read"],
            status: "enabled",
            inputSchema: builtinSchema("media.retry.fetch.input@1", { type: "object" }),
            outputSchema: builtinSchema("media.retry.fetch.output@1", { type: "object" }),
        },
        {
            id: "media.retry.apply",
            version: 1,
            ref: "media.retry.apply@1",
            provider: "cosmos",
            manifestHash: builtinHash("builtin:media.retry.apply@1"),
            effectMode: "none",
            executionPlacement: "host",
            requiredCapabilities: ["library:write"],
            status: "enabled",
            inputSchema: builtinSchema("media.retry.apply.input@1", { type: "object" }),
            outputSchema: builtinSchema("media.retry.apply.output@1", { type: "object" }),
        },
        {
            id: "collection-plan.checkpoint",
            version: 1,
            ref: "collection-plan.checkpoint@1",
            provider: "cosmos",
            manifestHash: builtinHash("builtin:collection-plan.checkpoint@1:cas-v1"),
            effectMode: "none",
            executionPlacement: "host",
            requiredCapabilities: ["source:checkpoint"],
            status: "enabled",
            inputSchema: builtinSchema("collection-plan.checkpoint.input@1", { type: "object" }),
            outputSchema: builtinSchema("collection-plan.checkpoint.output@1", { type: "object" }),
        },
    ];

    const connectors: readonly ConnectorDescriptor[] = sourceDefinitions.map((item) => ({
        id: item.connectorId,
        description: item.description ?? item.displayName,
        capabilities: [...item.capabilities],
        configVersion: `${item.ref}`,
    }));

    return new StaticCatalog({
        sourceDefinitions,
        workflowDefinitions,
        actionDefinitions,
        connectors,
    });
}
