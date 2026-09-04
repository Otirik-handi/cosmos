import { readVerifiedBlob } from "@cosmos/blob-store";
import { z } from "zod";
import {
    ingestTriggerKindSchema,
    libraryIngestInputSchema,
    libraryIngestOutputSchema,
    normalizedIngestItemSchema,
    sourceCheckpointInputSchema,
    sourceCheckpointOutputSchema,
    sourceExecutionSnapshotSchema,
    sourceFetchInputSchema,
    sourceFetchOutputSchema,
    type ActionDefinition,
    type IngestTriggerKind,
    type LibraryIngestOutput,
    type NormalizedIngestItemContract,
    type SourceCheckpointOutput,
    type SourceFetchOutput,
} from "@cosmos/contracts";
import type { NormalizedIngestItem } from "@cosmos/domain";
import {
    type JsonValue,
    type WorkflowDefinition,
} from "@notnotype/nb-workflow";
import {
    ActionExecutionError,
    type ActionExecutionContext,
    type HostActionExecutionContext,
    type HostActionExecutionFence,
    type RegisteredAction,
} from "./action.js";
import { ConnectorExecutionError } from "./index.js";
import {
    mediaDownloadCapability,
    type MediaAcquirer,
} from "./media-acquisition.js";
import type {
    ConnectorResolver,
    IngestConnector,
    LoggerPort,
    PersistIngestItemResult,
} from "./index.js";

export const ingestWorkflowReference = "cosmos.ingest@1" as const;
export const ingestFetchActionReference = "source.fetch@1" as const;
export const ingestPersistActionReference = "library.ingest@1" as const;
export const ingestCheckpointActionReference = "source.checkpoint@1" as const;

export { ingestWorkflowManifestHash } from "./workflow-control.js";
import { ingestWorkflowManifestHash } from "./workflow-control.js";
export const ingestFetchActionManifestHash = "builtin:source.fetch@1:source-snapshot-v1";
export const ingestPersistActionManifestHash = "builtin:library.ingest@1";
export const ingestCheckpointActionManifestHash = "builtin:source.checkpoint@1:cas-v1";

export const ingestWorkflowInputSchema = z.object({
    source: sourceExecutionSnapshotSchema,
    cursor: z.string().nullable(),
    checkpointRevision: z.number().int().nonnegative(),
    triggerKind: ingestTriggerKindSchema,
});
export type IngestWorkflowInput = z.infer<typeof ingestWorkflowInputSchema>;

export interface IngestWorkflowOutput {
    itemCount: number;
    createdEntryCount: number;
    revisedEntryCount: number;
    duplicateObservationCount: number;
    nextCursor: string | null;
    checkpointRevision: number;
    checkpointCommitted: boolean;
}

export interface WorkflowBlobStore {
    put(
        content: Uint8Array,
        options?: { mimeType?: string | null },
    ): Promise<{
        key: string;
        hash: string;
        byteSize: number;
        mimeType: string | null;
    }>;
    read(key: string): Promise<Uint8Array>;
}

export interface WorkflowIngestDomainPort {
    persistWorkflowIngestItem(input: {
        sourceId: string;
        workflowRunId: string;
        triggerKind: IngestTriggerKind;
        item: NormalizedIngestItem;
        fence: HostActionExecutionFence;
        idempotencyKey: string;
    }): Promise<PersistIngestItemResult>;
    setWorkflowIngestCheckpoint(input: {
        sourceId: string;
        workflowRunId: string;
        cursor: string | null;
        expectedRevision: number;
        itemCount: number;
        fence: HostActionExecutionFence;
        idempotencyKey: string;
    }): Promise<SourceCheckpointOutput>;
}

export interface IngestActionOptions {
    resolveConnector: ConnectorResolver;
    blobs: WorkflowBlobStore;
    domain: WorkflowIngestDomainPort;
    mediaAcquirer?: MediaAcquirer;
    logger?: LoggerPort;
}

export const ingestRequiredActionReferences = [
    ingestFetchActionReference,
    ingestPersistActionReference,
    ingestCheckpointActionReference,
] as const;

export type IngestWorkflowDefinition = WorkflowDefinition<JsonValue, JsonValue> & {
    inputSchema: typeof ingestWorkflowInputSchema;
    requiredActionRefs: typeof ingestRequiredActionReferences;
};

export function createIngestWorkflowDefinition(): IngestWorkflowDefinition {
    return {
        key: "cosmos.ingest",
        version: "1",
        manifestHash: ingestWorkflowManifestHash,
        requires: {
            durability: "durable",
            processRestart: true,
            concurrentExecution: true,
            multiWorker: true,
            leases: true,
            externalReceipts: true,
            valueReferences: true,
        },
        inputSchema: ingestWorkflowInputSchema,
        requiredActionRefs: ingestRequiredActionReferences,
        run: async (workflow, rawInput) => {
            const input = ingestWorkflowInputSchema.parse(rawInput);
            const page = await workflow.callAction<SourceFetchOutput>(
                ingestFetchActionReference,
                asJson({ source: input.source, cursor: input.cursor }),
                { key: "source.fetch" },
            );
            let createdEntryCount = 0;
            let revisedEntryCount = 0;
            let duplicateObservationCount = 0;
            for (const [index, item] of page.items.entries()) {
                const result = await workflow.callAction<LibraryIngestOutput>(
                    ingestPersistActionReference,
                    asJson({
                        sourceId: input.source.id,
                        triggerKind: input.triggerKind,
                        item,
                    }),
                    { key: `library.ingest:${index}` },
                );
                if (result.createdEntry) createdEntryCount += 1;
                if (result.revisedEntry) revisedEntryCount += 1;
                if (result.duplicateObservation) duplicateObservationCount += 1;
            }
            const checkpoint = await workflow.callAction<SourceCheckpointOutput>(
                ingestCheckpointActionReference,
                asJson({
                    sourceId: input.source.id,
                    cursor: page.nextCursor,
                    expectedRevision: input.checkpointRevision,
                    itemCount: page.items.length,
                }),
                { key: "source.checkpoint" },
            );
            await workflow.checkpoint(asJson({
                sourceId: input.source.id,
                nextCursor: checkpoint.cursor,
                checkpointRevision: checkpoint.revision,
                checkpointCommitted: checkpoint.committed,
                itemCount: page.items.length,
            }), { key: "ingest-page" });
            await workflow.emit({
                type: "ingest.page.persisted",
                version: "v1",
                payload: asJson({
                    sourceId: input.source.id,
                    triggerKind: input.triggerKind,
                    itemCount: page.items.length,
                    nextCursor: checkpoint.cursor,
                    checkpointRevision: checkpoint.revision,
                    checkpointCommitted: checkpoint.committed,
                }),
            }, { key: "ingest.page.persisted" });
            return asJson({
                itemCount: page.items.length,
                createdEntryCount,
                revisedEntryCount,
                duplicateObservationCount,
                nextCursor: checkpoint.cursor,
                checkpointRevision: checkpoint.revision,
                checkpointCommitted: checkpoint.committed,
            });
        },
    };
}

export function createIngestActions(options: IngestActionOptions): readonly RegisteredAction[] {
    const sourceFetch: ActionDefinition = {
        ref: ingestFetchActionReference,
        manifestHash: ingestFetchActionManifestHash,
        kind: "connector",
        description: "Fetch one immutable source snapshot page.",
        capabilities: ["source:read"],
        executionPlacement: "trusted_worker",
        inputSchema: sourceFetchInputSchema,
        outputSchema: sourceFetchOutputSchema,
        execution: {
            idempotent: true,
            supportsCancellation: false,
            timeoutMs: null,
            retryPolicy: {
                maxAttempts: 3,
                backoffMs: 1_000,
                retryableErrors: ["dependency_unavailable", "timeout", "rate_limited"],
            },
        },
    };
    const libraryIngest: ActionDefinition = {
        ref: ingestPersistActionReference,
        manifestHash: ingestPersistActionManifestHash,
        kind: "library",
        description: "Persist one normalized item under the dual host fence.",
        capabilities: ["library:write"],
        executionPlacement: "host",
        inputSchema: libraryIngestInputSchema,
        outputSchema: libraryIngestOutputSchema,
        execution: {
            idempotent: true,
            supportsCancellation: true,
            timeoutMs: null,
            retryPolicy: {
                maxAttempts: 3,
                backoffMs: 1_000,
            },
        },
    };
    const checkpoint: ActionDefinition = {
        ref: ingestCheckpointActionReference,
        manifestHash: ingestCheckpointActionManifestHash,
        kind: "control",
        description: "Commit a source cursor with revision CAS.",
        capabilities: ["source:checkpoint"],
        executionPlacement: "host",
        inputSchema: sourceCheckpointInputSchema,
        outputSchema: sourceCheckpointOutputSchema,
        execution: {
            idempotent: true,
            supportsCancellation: true,
            timeoutMs: null,
            retryPolicy: {
                maxAttempts: 3,
                backoffMs: 1_000,
            },
        },
    };
    return [
        {
            definition: sourceFetch,
            handler: async (input: unknown, context: ActionExecutionContext) => {
                const parsed = sourceFetchInputSchema.parse(input);
                const source = {
                    ...parsed.source,
                    lastRunAt: null,
                    lastError: null,
                };
                let connector: IngestConnector;
                try {
                    connector = options.resolveConnector(source);
                } catch (error) {
                    throw mapConnectorError(error, source.kind, "validate");
                }
                try {
                    connector.validate(source);
                } catch (error) {
                    throw mapConnectorError(error, connector.id, "validate");
                }
                let page: Awaited<ReturnType<IngestConnector["fetchItems"]>>;
                try {
                    page = await connector.fetchItems({
                        source,
                        cursor: parsed.cursor,
                        idempotencyKey: context.idempotencyKey,
                        signal: context.signal,
                    });
                } catch (error) {
                    throw mapConnectorError(error, connector.id, "fetch");
                }
                let acquiredItems = page.items;
                if (
                    connector.capabilities.includes(mediaDownloadCapability)
                    && options.mediaAcquirer
                ) {
                    acquiredItems = await options.mediaAcquirer.acquireItems(
                        page.items,
                        { signal: context.signal },
                    );
                }
                try {
                    const items = await Promise.all(acquiredItems.map((item) => toJsonItem(item, options.blobs)));
                    return sourceFetchOutputSchema.parse({
                        items,
                        nextCursor: page.nextCursor,
                    });
                } catch (error) {
                    throw mapConnectorError(error, connector.id, "payload");
                }
            },
        },
        {
            definition: libraryIngest,
            handler: async (input: unknown, context: ActionExecutionContext) => {
                const parsed = libraryIngestInputSchema.parse(input);
                const hostContext = requireHostContext(context);
                const item = await fromJsonItem(parsed.item, options.blobs);
                return libraryIngestOutputSchema.parse(await options.domain.persistWorkflowIngestItem({
                    sourceId: parsed.sourceId,
                    workflowRunId: hostContext.fence.workflowRunId,
                    triggerKind: parsed.triggerKind,
                    item,
                    fence: hostContext.fence,
                    idempotencyKey: context.idempotencyKey,
                }));
            },
        },
        {
            definition: checkpoint,
            handler: async (input: unknown, context: ActionExecutionContext) => {
                const parsed = sourceCheckpointInputSchema.parse(input);
                const hostContext = requireHostContext(context);
                return sourceCheckpointOutputSchema.parse(await options.domain.setWorkflowIngestCheckpoint({
                    sourceId: parsed.sourceId,
                    workflowRunId: hostContext.fence.workflowRunId,
                    cursor: parsed.cursor,
                    expectedRevision: parsed.expectedRevision,
                    itemCount: parsed.itemCount,
                    fence: hostContext.fence,
                    idempotencyKey: context.idempotencyKey,
                }));
            },
        },
    ];
}


function requireHostContext(context: ActionExecutionContext): HostActionExecutionContext {
    if (!("fence" in context)) {
        throw new ActionExecutionError(
            "invalid_input",
            "Host ingest Action requires a dual lease fence.",
            false,
        );
    }
    return context as HostActionExecutionContext;
}

async function toJsonItem(
    item: NormalizedIngestItem,
    blobs: WorkflowBlobStore,
): Promise<NormalizedIngestItemContract> {
    const assets = await Promise.all(item.assets.map(async (asset) => {
        if (!asset.content || asset.status !== "saved") {
            return {
                kind: asset.kind,
                sourceUrl: asset.sourceUrl,
                status: asset.status,
                mimeType: asset.mimeType,
                byteSize: asset.byteSize,
                blobRef: null,
                errorMessage: asset.errorMessage ?? null,
            };
        }
        const stored = await blobs.put(asset.content, {
            mimeType: asset.mimeType ?? "application/octet-stream",
        });
        return {
            kind: asset.kind,
            sourceUrl: asset.sourceUrl,
            status: asset.status,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize ?? stored.byteSize,
            blobRef: {
                key: stored.key,
                hash: stored.hash,
                byteSize: stored.byteSize,
                mediaType: stored.mimeType ?? asset.mimeType ?? "application/octet-stream",
            },
            errorMessage: null,
        };
    }));
    return normalizedIngestItemSchema.parse({
        ...(item.externalId === undefined ? {} : { externalId: item.externalId }),
        title: item.title,
        summary: item.summary,
        contentText: item.contentText,
        webUrl: item.webUrl,
        kind: item.kind,
        publisher: item.publisher,
        metrics: item.metrics,
        publishedAt: item.publishedAt,
        ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
        sourceLocator: item.sourceLocator,
        rawPayload: item.rawPayload,
        ...(item.rawPayloadMimeType === undefined ? {} : { rawPayloadMimeType: item.rawPayloadMimeType }),
        assets,
    });
}

async function fromJsonItem(
    item: NormalizedIngestItemContract,
    blobs: WorkflowBlobStore,
): Promise<NormalizedIngestItem> {
    return {
        ...item,
        assets: await Promise.all(item.assets.map(async (asset) => ({
            kind: asset.kind,
            sourceUrl: asset.sourceUrl,
            status: asset.status,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            errorMessage: asset.errorMessage ?? null,
            content: asset.blobRef
                ? await readVerifiedBlobAsActionError(blobs, asset.blobRef)
                : null,
        }))),
    };

}
async function readVerifiedBlobAsActionError(
    blobs: WorkflowBlobStore,
    reference: { key: string; hash: string; byteSize: number; mediaType: string },
): Promise<Uint8Array> {
    try {
        return await readVerifiedBlob(blobs, reference);
    } catch (error) {
        throw new ActionExecutionError(
            "malformed_payload",
            error instanceof Error ? error.message : `BlobRef integrity check failed for ${reference.key}.`,
            false,
            { cause: error },
        );
    }
}

function mapConnectorError(
    error: unknown,
    connectorId: string,
    phase: "validate" | "fetch" | "payload",
): ActionExecutionError {
    if (error instanceof ActionExecutionError) return error;
    if (error instanceof ConnectorExecutionError) {
        return new ActionExecutionError(error.code, error.message, error.retryable, { cause: error });
    }
    if (phase === "payload" || isMalformedConnectorPayload(error)) {
        return new ActionExecutionError(
            "malformed_payload",
            `Connector ${connectorId} returned a malformed payload.`,
            false,
            { cause: error },
        );
    }
    if (phase === "fetch") {
        return new ActionExecutionError(
            "dependency_unavailable",
            `Connector ${connectorId} could not fetch the source.`,
            true,
            { cause: error },
        );
    }
    return new ActionExecutionError(
        "invalid_configuration",
        `Connector ${connectorId} rejected the source configuration.`,
        false,
        { cause: error },
    );
}

function isMalformedConnectorPayload(error: unknown): boolean {
    if (error instanceof SyntaxError) return true;
    if (typeof error !== "object" || error === null || !("name" in error)) return false;
    return error.name === "ZodError" || error.name === "XMLParserError";
}

function readWorkflowInput(value: JsonValue): IngestWorkflowInput | null {
    const parsed = ingestWorkflowInputSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

function asJson(value: unknown): JsonValue {
    return value as JsonValue;
}
