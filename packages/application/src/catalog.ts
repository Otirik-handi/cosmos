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

export interface SourceDefinitionManifest {
    id: string;
    version: number;
    ref: string;
    provider: string;
    displayName: string;
    description: string | null;
    manifestHash: ManifestHash;
    status: "enabled" | "disabled" | "unavailable" | "incompatible";
    operationIds: readonly string[];
    capabilities: readonly string[];
    configurationSchema: JsonSchemaRef;
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

    constructor(input: {
        sourceDefinitions: readonly SourceDefinitionManifest[];
        workflowDefinitions: readonly WorkflowDefinitionManifest[];
        actionDefinitions: readonly ActionDefinitionManifest[];
        connectors: readonly ConnectorDescriptor[];
    }) {
        this.sourceDefinitions = input.sourceDefinitions.map((item) => ({
            ...item,
            operationIds: [...item.operationIds],
            capabilities: [...item.capabilities],
        }));
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
        return this.sourceDefinitions;
    }

    getSourceDefinition(id: string, version?: number): SourceDefinitionManifest | null {
        return this.sourceDefinitions.find((item) => item.id === id && (version === undefined || item.version === version)) ?? null;
    }

    listWorkflowDefinitions(): readonly WorkflowDefinitionManifest[] {
        return this.workflowDefinitions;
    }

    getWorkflowDefinition(id: string, version: number): WorkflowDefinitionManifest | null {
        return this.workflowDefinitions.find((item) => item.id === id && item.version === version) ?? null;
    }

    listActionDefinitions(): readonly ActionDefinitionManifest[] {
        return this.actionDefinitions;
    }

    getActionDefinition(id: string, version: number): ActionDefinitionManifest | null {
        return this.actionDefinitions.find((item) => item.id === id && item.version === version) ?? null;
    }

    listConnectors(): readonly ConnectorDescriptor[] {
        return this.connectors;
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

export function createBuiltinManifestCatalog(): StaticCatalog {
    const sourceDefinitions: readonly SourceDefinitionManifest[] = [
        {
            id: "rss",
            version: 1,
            ref: "source.rss@1",
            provider: "cosmos",
            displayName: "RSS",
            description: "Fetch one RSS or Atom feed page.",
            manifestHash: builtinHash("builtin:source.rss@1"),
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor"],
            configurationSchema: builtinSchema("source.rss.config@1", {
                type: "object",
                properties: { feedUrl: { type: "string", format: "uri" }, scheduleIntervalMs: { type: "integer" } },
                required: ["feedUrl"],
                additionalProperties: false,
            }),
        },
        {
            id: "fixture-rss",
            version: 1,
            ref: "source.fixture-rss@1",
            provider: "cosmos",
            displayName: "Fixture RSS",
            description: "Read a configured fixture feed in a trusted workspace.",
            manifestHash: builtinHash("builtin:source.fixture-rss@1"),
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor"],
            configurationSchema: builtinSchema("source.fixture-rss.config@1", {
                type: "object",
                properties: { scheduleIntervalMs: { type: "integer" } },
                additionalProperties: false,
            }),
        },
        {
            id: "bilibili",
            version: 1,
            ref: "source.bilibili@1",
            provider: "cosmos",
            displayName: "Bilibili",
            description: "Read Bilibili data through a trusted OpenCLI profile.",
            manifestHash: builtinHash("builtin:source.bilibili@1"),
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor", "external:opencli"],
            configurationSchema: builtinSchema("source.bilibili.config@1", {
                type: "object",
                properties: { mode: { enum: ["hot", "feed"] }, profile: { type: "string" }, limit: { type: "integer" }, scheduleIntervalMs: { type: "integer" } },
                required: ["mode"],
                additionalProperties: false,
            }),
        },
        {
            id: "aihot",
            version: 1,
            ref: "source.aihot@1",
            provider: "cosmos",
            displayName: "AI HOT",
            description: "Fetch the AI HOT JSON feed.",
            manifestHash: builtinHash("builtin:source.aihot@1"),
            status: "enabled",
            operationIds: ["fetch"],
            capabilities: ["source:read", "cursor"],
            configurationSchema: builtinSchema("source.aihot.config@1", {
                type: "object",
                properties: { scheduleIntervalMs: { type: "integer" } },
                additionalProperties: false,
            }),
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
    const workflowDefinitions: readonly WorkflowDefinitionManifest[] = [{
        id: "cosmos.ingest",
        version: 1,
        ref: "cosmos.ingest@1",
        kind: "ingest",
        provider: "cosmos",
        manifestHash: builtinHash("builtin:cosmos.ingest@1:source-snapshot-v1"),
        status: "enabled",
        requiredActionRefs: ["source.fetch@1", "library.ingest@1", "source.checkpoint@1"],
        requiredBackendCapabilities: {
            processRestart: true,
            multiWorker: true,
            leases: true,
            externalReceipts: true,
            valueReferences: true,
        },
        inputSchema: workflowInput,
        outputSchema: workflowOutput,
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
            id: "source.checkpoint",
            version: 1,
            ref: "source.checkpoint@1",
            provider: "cosmos",
            manifestHash: builtinHash("builtin:source.checkpoint@1:cas-v1"),
            effectMode: "none",
            executionPlacement: "host",
            requiredCapabilities: ["source:checkpoint"],
            status: "enabled",
            inputSchema: builtinSchema("source.checkpoint.input@1", { type: "object" }),
            outputSchema: builtinSchema("source.checkpoint.output@1", { type: "object" }),
        },
    ];

    const connectors: readonly ConnectorDescriptor[] = sourceDefinitions.map((item) => ({
        id: item.id,
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
