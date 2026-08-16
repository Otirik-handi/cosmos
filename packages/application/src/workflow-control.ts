import { z } from "zod";

import {
    ingestTriggerKindSchema,
    sourceExecutionSnapshotSchema,
    type IngestTriggerKind,
} from "@cosmos/contracts";
import {
    UuidIdGenerator,
    type IdGenerator,
    type JsonValue,
} from "@notnotype/nb-workflow";
import type { WorkflowEnvelope, WorkflowHostStore } from "./workflow-host.js";

export const ingestWorkflowDefinitionReference = "cosmos.ingest@1" as const;
export const ingestWorkflowManifestHash = "builtin:cosmos.ingest@1:source-snapshot-v1";

export const ingestWorkflowInputSnapshotSchema = z.object({
    source: sourceExecutionSnapshotSchema,
    cursor: z.string().nullable(),
    checkpointRevision: z.number().int().nonnegative(),
    triggerKind: ingestTriggerKindSchema,
});
export type IngestWorkflowInputSnapshot = z.infer<typeof ingestWorkflowInputSnapshotSchema>;

export interface IngestWorkflowControlOptions {
    store: WorkflowHostStore;
    getSourceExecutionSnapshot(sourceId: string): Promise<IngestWorkflowInputSnapshot["source"] | null>;
    getCheckpointSnapshot(sourceId: string): Promise<{ cursor: string | null; revision: number }>;
    ids?: IdGenerator;
}

export class IngestWorkflowControlService {
    private readonly ids: IdGenerator;

    constructor(private readonly options: IngestWorkflowControlOptions) {
        this.ids = options.ids ?? new UuidIdGenerator();
    }

    async enqueue(input: {
        sourceId: string;
        triggerKind: IngestTriggerKind;
        idempotencyKey: string;
    }): Promise<WorkflowEnvelope> {
        const sourceId = input.sourceId.trim();
        const idempotencyKey = input.idempotencyKey.trim();
        const triggerKind = ingestTriggerKindSchema.parse(input.triggerKind);
        if (!sourceId || !idempotencyKey) {
            throw new Error("Workflow ingest enqueue requires sourceId and Idempotency-Key.");
        }
        const existing = await this.options.store.findWorkflowEnvelopeByIdempotencyKey?.(idempotencyKey);
        if (existing) {
            const existingInput = ingestWorkflowInputSnapshotSchema.safeParse(existing.inputSnapshot);
            if (!existingInput.success
                || existingInput.data.source.id !== sourceId
                || existingInput.data.triggerKind !== triggerKind) {
                throw new Error(`Idempotency key ${idempotencyKey} conflicts with another source run.`);
            }
            return existing;
        }
        const source = await this.options.getSourceExecutionSnapshot(sourceId);
        if (!source) throw new Error(`Source not found: ${sourceId}`);
        const checkpoint = await this.options.getCheckpointSnapshot(sourceId);
        const inputSnapshot = ingestWorkflowInputSnapshotSchema.parse({
            source,
            cursor: checkpoint.cursor,
            checkpointRevision: checkpoint.revision,
            triggerKind,
        });
        return this.options.store.createWorkflowEnvelope({
            runId: this.ids.nextId("run"),
            idempotencyKey,
            definition: {
                key: "cosmos.ingest",
                version: "1",
                manifestHash: ingestWorkflowManifestHash,
            },
            inputSnapshot: asJson(inputSnapshot),
            productRun: asJson({
                status: "queued",
                sourceId,
                triggerKind,
                idempotencyKey,
            }),
        });
    }
}

function asJson(value: unknown): JsonValue {
    return value as JsonValue;
}
