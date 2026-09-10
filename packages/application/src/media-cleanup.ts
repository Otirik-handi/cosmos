import { z } from "zod";
import {
    mediaCleanupReportSchema,
    type MediaCleanupReport,
    type ActionDefinition,
} from "@cosmos/contracts";
import {
    UuidIdGenerator,
    type IdGenerator,
    type JsonValue,
    type WorkflowDefinition,
} from "@notnotype/nb-workflow";
import {
    type ActionExecutionContext,
    type HostActionExecutionContext,
    type RegisteredAction,
} from "./action.js";
import {
    WorkflowHostConflictError,
    type WorkflowEnvelope,
    type WorkflowHostStore,
} from "./workflow-host.js";
import type { CosmosRepository, LoggerPort } from "./index.js";

/**
 * Explicit retention cleanup as a maintenance Run (ADR-0015 decisions 7/10).
 * The API only creates the Run and reads the report; the Worker owns blob
 * deletion and the Asset degradation inside one fenced host Action.
 */
export const mediaCleanupWorkflowReference = "cosmos.media-cleanup@1" as const;
export const mediaCleanupActionReference = "media.cleanup@1" as const;
export const mediaCleanupWorkflowManifestHash = "builtin:cosmos.media-cleanup@1";
export const mediaCleanupActionManifestHash = "builtin:media.cleanup@1";

export const mediaCleanupWorkflowInputSchema = z.object({
    sourceId: z.string().trim().min(1).nullable(),
    dryRun: z.boolean(),
});
export type MediaCleanupWorkflowInput = z.infer<typeof mediaCleanupWorkflowInputSchema>;

const mediaCleanupActionInputSchema = z.object({
    sourceId: z.string().trim().min(1).nullable(),
    dryRun: z.boolean(),
}).strict();

export const mediaCleanupRequiredActionReferences = [mediaCleanupActionReference] as const;

export type MediaCleanupWorkflowDefinition = WorkflowDefinition<JsonValue, JsonValue> & {
    inputSchema: typeof mediaCleanupWorkflowInputSchema;
    requiredActionRefs: typeof mediaCleanupRequiredActionReferences;
};

export function createMediaCleanupWorkflowDefinition(): MediaCleanupWorkflowDefinition {
    return {
        key: "cosmos.media-cleanup",
        version: "1",
        manifestHash: mediaCleanupWorkflowManifestHash,
        requires: {
            durability: "durable",
            processRestart: true,
            concurrentExecution: true,
            multiWorker: true,
            leases: true,
            externalReceipts: true,
            valueReferences: true,
        },
        inputSchema: mediaCleanupWorkflowInputSchema,
        requiredActionRefs: mediaCleanupRequiredActionReferences,
        run: async (workflow, rawInput) => {
            const input = mediaCleanupWorkflowInputSchema.parse(rawInput);
            const report = await workflow.callAction<MediaCleanupReport>(
                mediaCleanupActionReference,
                asJson({ sourceId: input.sourceId, dryRun: input.dryRun }),
                { key: "media.cleanup" },
            );
            return asJson(report);
        },
    };
}

export interface MediaCleanupActionOptions {
    domain: Pick<CosmosRepository, "runMediaCleanup">;
    logger?: LoggerPort;
}

export function createMediaCleanupActions(
    options: MediaCleanupActionOptions,
): readonly RegisteredAction[] {
    const definition: ActionDefinition = {
        ref: mediaCleanupActionReference,
        manifestHash: mediaCleanupActionManifestHash,
        kind: "library",
        description: "Delete expired media bytes and degrade the Asset rows.",
        capabilities: ["library:write"],
        executionPlacement: "host",
        inputSchema: mediaCleanupActionInputSchema,
        outputSchema: mediaCleanupReportSchema,
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
    return [{
        definition,
        handler: async (input: unknown, context: ActionExecutionContext) => {
            const parsed = mediaCleanupActionInputSchema.parse(input);
            const hostContext = context as HostActionExecutionContext;
            if (!("fence" in hostContext)) {
                throw new Error("media.cleanup@1 requires a host execution fence.");
            }
            const report = await options.domain.runMediaCleanup({
                workflowRunId: hostContext.fence.workflowRunId,
                fence: hostContext.fence,
                sourceId: parsed.sourceId,
                dryRun: parsed.dryRun,
            });
            options.logger?.info("media.cleanup.completed", {
                runId: hostContext.fence.workflowRunId,
                sourceId: parsed.sourceId,
                dryRun: parsed.dryRun,
                candidateCount: report.candidateCount,
                cleanedCount: report.cleanedCount,
                cleanedBytes: report.cleanedBytes,
                sharedKeyCount: report.sharedKeyCount,
            });
            return report;
        },
    }];
}

export interface MediaCleanupWorkflowControlOptions {
    store: WorkflowHostStore;
    ids?: IdGenerator;
}

export class MediaCleanupWorkflowControlService {
    private readonly ids: IdGenerator;

    constructor(private readonly options: MediaCleanupWorkflowControlOptions) {
        this.ids = options.ids ?? new UuidIdGenerator();
    }

    async enqueue(input: {
        sourceId?: string | null;
        dryRun?: boolean;
        idempotencyKey: string;
    }): Promise<WorkflowEnvelope> {
        const idempotencyKey = input.idempotencyKey.trim();
        if (!idempotencyKey) {
            throw new Error("Media cleanup enqueue requires an Idempotency-Key.");
        }
        const inputSnapshot = mediaCleanupWorkflowInputSchema.parse({
            sourceId: input.sourceId ?? null,
            dryRun: input.dryRun ?? true,
        });
        const existing = await this.options.store.findWorkflowEnvelopeByIdempotencyKey?.(
            idempotencyKey,
        );
        if (existing) {
            const existingInput = mediaCleanupWorkflowInputSchema.safeParse(existing.inputSnapshot);
            if (!existingInput.success
                || existingInput.data.sourceId !== inputSnapshot.sourceId
                || existingInput.data.dryRun !== inputSnapshot.dryRun) {
                throw new WorkflowHostConflictError(
                    `Idempotency key ${idempotencyKey} conflicts with another media cleanup.`,
                );
            }
            return existing;
        }
        return this.options.store.createWorkflowEnvelope({
            runId: this.ids.nextId("run"),
            idempotencyKey,
            definition: {
                key: "cosmos.media-cleanup",
                version: "1",
                manifestHash: mediaCleanupWorkflowManifestHash,
            },
            inputSnapshot: asJson(inputSnapshot),
            productRun: asJson({
                status: "queued",
                sourceId: inputSnapshot.sourceId,
                dryRun: inputSnapshot.dryRun,
                idempotencyKey,
            }),
            sourceId: inputSnapshot.sourceId,
        });
    }
}

function asJson(value: unknown): JsonValue {
    return value as JsonValue;
}
