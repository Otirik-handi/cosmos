import { z } from "zod";

import {
    ingestTriggerEvidenceSchema,
    ingestTriggerKindSchema,
    sourceExecutionSnapshotSchema,
    type IngestTriggerEvidence,
    type IngestTriggerKind,
} from "@cosmos/contracts";
import {
    UuidIdGenerator,
    type IdGenerator,
    type JsonValue,
} from "@notnotype/nb-workflow";
import {
    WorkflowHostConflictError,
    WorkflowHostError,
    type WorkflowEnvelope,
    type WorkflowHostStore,
} from "./workflow-host.js";

export const ingestWorkflowDefinitionReference = "cosmos.ingest@1" as const;
/**
 * Bumped to v2 when the media retry step joined the ingest body: a Run created
 * under v1 must not resume into a different definition (ADR-0015 decision 1).
 */
export const ingestWorkflowManifestHash = "builtin:cosmos.ingest@1:source-snapshot-v2";

export const ingestWorkflowInputSnapshotSchema = z.object({
    source: sourceExecutionSnapshotSchema,
    cursor: z.string().nullable(),
    checkpointRevision: z.number().int().nonnegative(),
    triggerKind: ingestTriggerKindSchema,
    /** 触发原因（AUT-004）。manual/schedule 的既有快照没有这个键。 */
    triggerEvidence: ingestTriggerEvidenceSchema.optional(),
}).superRefine((snapshot, context) => {
    // ADR-0024 决定 4：webhook 触发的验收条件就是「每次触发保存原因」，缺证据的
    // webhook Run 无法审计，所以在入队边界就拒绝，而不是留到读投影时才发现。
    if (snapshot.triggerKind === "webhook" && !snapshot.triggerEvidence) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["triggerEvidence"],
            message: "A webhook-triggered Run requires trigger evidence.",
        });
    }
});
export type IngestWorkflowInputSnapshot = z.infer<typeof ingestWorkflowInputSnapshotSchema>;

export interface IngestWorkflowControlOptions {
    store: WorkflowHostStore;
    getSourceExecutionSnapshot(sourceId: string): Promise<IngestWorkflowInputSnapshot["source"] | null>;
    getCheckpointSnapshot(planId: string): Promise<{ cursor: string | null; revision: number }>;
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
        triggerEvidence?: IngestTriggerEvidence;
    }): Promise<WorkflowEnvelope> {
        const sourceId = input.sourceId.trim();
        const idempotencyKey = input.idempotencyKey.trim();
        const triggerKind = ingestTriggerKindSchema.parse(input.triggerKind);
        const triggerEvidence = input.triggerEvidence === undefined
            ? undefined
            : ingestTriggerEvidenceSchema.parse(input.triggerEvidence);
        if (!sourceId || !idempotencyKey) {
            throw new Error("Workflow ingest enqueue requires sourceId and Idempotency-Key.");
        }
        const existing = await this.options.store.findWorkflowEnvelopeByIdempotencyKey?.(idempotencyKey);
        if (existing) {
            const existingInput = ingestWorkflowInputSnapshotSchema.safeParse(existing.inputSnapshot);
            if (!existingInput.success
                || existingInput.data.source.id !== sourceId
                || existingInput.data.triggerKind !== triggerKind) {
                throw new WorkflowHostConflictError(
                    `Idempotency key ${idempotencyKey} conflicts with another source run.`,
                );
            }
            return existing;
        }
        const source = await this.options.getSourceExecutionSnapshot(sourceId);
        if (!source) throw new Error(`Source not found: ${sourceId}`);
        // 计划身份从执行快照取，不由调用方另传一份：两者若不一致，入队记录的归属会与
        // 运行期实际用的计划（checkpoint、连接器状态命名空间）对不上。
        const planId = source.planId;
        const checkpoint = await this.options.getCheckpointSnapshot(planId);
        const inputSnapshot = ingestWorkflowInputSnapshotSchema.parse({
            source,
            cursor: checkpoint.cursor,
            checkpointRevision: checkpoint.revision,
            triggerKind,
            ...(triggerEvidence ? { triggerEvidence } : {}),
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
                planId,
                sourceId,
                triggerKind,
                idempotencyKey,
                ...(triggerEvidence ? { triggerEvidence } : {}),
            }),
            sourceId,
            planId,
        });
    }

    /**
     * Re-run a terminal ingest Run (RUN-004 / ADR-0016 decision 2): enqueue a
     * fresh Run for the same source with a new idempotency key. Reused results
     * are the already-committed library rows (idempotency dedup by external
     * key); the new side effect is a fetch + ingest from the source's *current*
     * checkpoint, never the failed Run's stale cursor.
     */
    async rerun(input: { runId: string; idempotencyKey: string }): Promise<WorkflowEnvelope> {
        const runId = input.runId.trim();
        const idempotencyKey = input.idempotencyKey.trim();
        if (!runId || !idempotencyKey) {
            throw new Error("Workflow rerun requires runId and Idempotency-Key.");
        }
        const envelope = await this.options.store.loadWorkflowEnvelope(runId);
        if (!envelope) {
            throw new WorkflowHostError("not_found", `Run not found: ${runId}`);
        }
        if (["completed", "failed", "cancelled"].includes(envelope.status)) {
            const parsed = ingestWorkflowInputSnapshotSchema.safeParse(envelope.inputSnapshot);
            if (!parsed.success) {
                throw new WorkflowHostError(
                    "invalid_state",
                    `Run ${runId} is not an ingest run and cannot be re-run.`,
                );
            }
            return this.enqueue({
                sourceId: parsed.data.source.id,
                triggerKind: "manual",
                idempotencyKey,
            });
        }
        throw new WorkflowHostConflictError(
            `Run ${runId} is not terminal (${envelope.status}); cancel it before re-running.`,
        );
    }
}

function asJson(value: unknown): JsonValue {
    return value as JsonValue;
}
