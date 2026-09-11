import { canonicalJson } from "@notnotype/nb-workflow";
import { WorkflowHostConflictError, WorkflowHostError, type CreateWorkflowEnvelopeInput, type WorkflowEnvelope } from "@cosmos/application";
import { createWorkflowEnvelopeMarker, isWorkflowEnvelopeMarker } from "../workflow-backend.js";
import { PrismaWorkflowHostStoreBase } from "./base.js";
import { type WorkflowRunRow, encodeJson, isUniqueConstraintError, parseJson, requireNonEmptyString } from "./internals-core.js";
import { assertEnvelopeIdentity, normalizeEnvelopeInput, toEnvelope } from "./internals-activity.js";
import { appendWorkflowRunQueuedEvent } from "./internals-events-lease.js";

export class PrismaWorkflowHostEnvelopeStore extends PrismaWorkflowHostStoreBase {
    async createWorkflowEnvelope(
        input: CreateWorkflowEnvelopeInput,
    ): Promise<WorkflowEnvelope> {
        const normalized = normalizeEnvelopeInput(input);
        const inputSnapshotJson = encodeJson(
            normalized.inputSnapshot,
            "workflow input snapshot",
        );
        const productRunJson = encodeJson(
            normalized.productRun,
            "product run snapshot",
        );

        try {
            return await this.prisma.$transaction(async (tx) => {
                if (normalized.idempotencyKey !== null) {
                    const byKey = await tx.workflowRun.findUnique({
                        where: { idempotencyKey: normalized.idempotencyKey },
                    });
                    if (byKey) {
                        return assertEnvelopeIdentity(
                            byKey as WorkflowRunRow,
                            normalized,
                            inputSnapshotJson,
                            productRunJson,
                        );
                    }
                }

                const byId = await tx.workflowRun.findUnique({
                    where: { id: normalized.runId },
                });
                if (byId) {
                    if (
                        normalized.idempotencyKey !== null
                        && byId.idempotencyKey === normalized.idempotencyKey
                    ) {
                        return assertEnvelopeIdentity(
                            byId as WorkflowRunRow,
                            normalized,
                            inputSnapshotJson,
                            productRunJson,
                        );
                    }
                    throw new WorkflowHostConflictError(
                        `Workflow run ${normalized.runId} already exists.`,
                    );
                }

                const now = normalized.createdAt;
                const row = await tx.workflowRun.create({
                    data: {
                        id: normalized.runId,
                        stateJson: canonicalJson(
                            createWorkflowEnvelopeMarker(normalized.runId),
                        ),
                        kernelRevision: 0,
                        status: "queued",
                        resumeRequired: false,
                        sourceInstanceId: normalized.sourceId,
                        errorMessage: null,
                        definitionKey: normalized.definition.key,
                        definitionVersion: normalized.definition.version,
                        manifestHash: normalized.definition.manifestHash,
                        idempotencyKey: normalized.idempotencyKey,
                        inputSnapshotJson,
                        productRunJson,
                        runLeaseOwner: null,
                        runLeaseToken: null,
                        runLeaseExpiresAt: null,
                        startedAt: null,
                        finishedAt: null,
                        createdAt: now,
                        updatedAt: now,
                    },
                });
                await appendWorkflowRunQueuedEvent(tx, {
                    workflowRunId: row.id,
                    productRun: normalized.productRun,
                });
                return toEnvelope(row as WorkflowRunRow);
            });
        } catch (error) {
            if (!isUniqueConstraintError(error)) {
                throw error;
            }

            // A concurrent creator may win either the id or idempotency-key
            // unique constraint. Re-read the durable winner and apply the same
            // identity check instead of returning a possibly different run.
            if (normalized.idempotencyKey !== null) {
                const winner = await this.prisma.workflowRun.findUnique({
                    where: { idempotencyKey: normalized.idempotencyKey },
                });
                if (winner) {
                    return assertEnvelopeIdentity(
                        winner as WorkflowRunRow,
                        normalized,
                        inputSnapshotJson,
                        productRunJson,
                    );
                }
            }
            const winner = await this.prisma.workflowRun.findUnique({
                where: { id: normalized.runId },
            });
            if (winner) {
                throw new WorkflowHostConflictError(
                    `Workflow run ${normalized.runId} already exists.`,
                    { cause: error },
                );
            }
            throw new WorkflowHostError(
                "unavailable",
                "Workflow envelope creation lost its unique-key race without a durable winner.",
                { cause: error },
            );
        }
    }
    async findWorkflowEnvelopeByIdempotencyKey(
        idempotencyKey: string,
    ): Promise<WorkflowEnvelope | null> {
        const row = await this.prisma.workflowRun.findUnique({
            where: { idempotencyKey: requireNonEmptyString(idempotencyKey, "idempotencyKey") },
        });
        return row ? toEnvelope(row as WorkflowRunRow) : null;
    }

    async hasWorkflowKernelState(runId: string): Promise<boolean> {
        const row = await this.prisma.workflowRun.findUnique({
            where: { id: requireNonEmptyString(runId, "runId") },
            select: { id: true, stateJson: true },
        });
        if (!row) return false;
        const parsed = parseJson(row.stateJson, `Workflow run ${row.id} state`);
        return !isWorkflowEnvelopeMarker(parsed, row.id);
    }

    /** Load both envelope-only rows and adopted Kernel rows. */
    async loadWorkflowEnvelope(runId: string): Promise<WorkflowEnvelope | null> {
        const row = await this.prisma.workflowRun.findUnique({
            where: { id: requireNonEmptyString(runId, "runId") },
        });
        return row ? toEnvelope(row as WorkflowRunRow) : null;
    }

}
