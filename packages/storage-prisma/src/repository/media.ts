import { type IngestTriggerKind, type SourceCheckpointOutput, type MediaCleanupReport, mediaCleanupReportSchema, retryableAssetErrorCodes } from "@cosmos/contracts";
import { deriveExternalKey, fingerprintEntryRevision, type NormalizedIngestItem } from "@cosmos/domain";
import { type HostActionExecutionFence, type JobLease, type MediaRetryCandidate, type MediaRetryOutcome, type PersistIngestItemResult } from "@cosmos/application";
import { FileBlobStore } from "@cosmos/blob-store";
import { type Prisma } from "@prisma/client";
import { appendDomainEvent, assertJobLease, assertWorkflowActionFence, parseJson } from "./repository-internals.js";
import { PrismaCosmosRepositoryJobClaims } from "./job-claims.js";

export class PrismaCosmosRepositoryMedia extends PrismaCosmosRepositoryJobClaims {
    async listContentUnchangedItems(input: {
        sourceId: string;
        items: readonly NormalizedIngestItem[];
    }): Promise<readonly boolean[]> {
        if (input.items.length === 0) {
            return [];
        }
        const externalKeys = input.items.map((item) => deriveExternalKey(item));
        const contentFingerprints = input.items.map((item) => fingerprintEntryRevision({
            title: item.title,
            summary: item.summary,
            contentText: item.contentText,
            webUrl: item.webUrl,
            kind: item.kind,
            publisher: item.publisher,
        }));
        const existing = await this.prisma.entry.findMany({
            where: {
                sourceInstanceId: input.sourceId,
                canonicalExternalId: { in: externalKeys },
            },
            select: {
                canonicalExternalId: true,
                currentRevision: {
                    select: { contentFingerprint: true },
                },
            },
        });
        const byExternalKey = new Map(
            existing.map((entry) => [entry.canonicalExternalId, entry.currentRevision]),
        );
        return contentFingerprints.map((fingerprint, index) => (
            byExternalKey.get(externalKeys[index])?.contentFingerprint === fingerprint
        ));
    }

    async listRetryableMediaAssets(input: {
        sourceId: string;
        maxAttempts: number;
        limit?: number;
    }): Promise<readonly MediaRetryCandidate[]> {
        if (input.maxAttempts <= 0) {
            return [];
        }
        const limit = input.limit ?? 50;
        const entries = await this.prisma.entry.findMany({
            where: {
                sourceInstanceId: input.sourceId,
                currentRevisionId: { not: null },
            },
            select: {
                currentRevision: {
                    select: {
                        assets: {
                            where: {
                                status: { in: ["failed", "skipped"] },
                                sourceUrl: { not: null },
                                errorCode: { in: [...retryableAssetErrorCodes] },
                                attemptCount: { lt: input.maxAttempts },
                                OR: [
                                    { kind: "image" },
                                    {
                                        kind: "enclosure",
                                        mimeType: { startsWith: "image/" },
                                    },
                                ],
                            },
                            select: {
                                id: true,
                                sourceUrl: true,
                                kind: true,
                                mimeType: true,
                                attemptCount: true,
                            },
                            orderBy: { createdAt: "asc" },
                        },
                    },
                },
            },
        });
        const candidates: MediaRetryCandidate[] = [];
        for (const entry of entries) {
            for (const asset of entry.currentRevision?.assets ?? []) {
                if (!asset.sourceUrl) {
                    continue;
                }
                candidates.push({
                    assetId: asset.id,
                    sourceUrl: asset.sourceUrl,
                    kind: asset.kind,
                    mimeType: asset.mimeType,
                    attemptCount: asset.attemptCount,
                });
                if (candidates.length >= limit) {
                    return candidates;
                }
            }
        }
        return candidates;
    }

    async applyMediaRetryOutcome(input: {
        workflowRunId: string;
        fence: HostActionExecutionFence;
        outcome: MediaRetryOutcome;
        expectedAttemptCount: number;
    }): Promise<boolean> {
        const { outcome } = input;
        let stored: Awaited<ReturnType<FileBlobStore["put"]>> | null = null;
        if (outcome.status === "saved") {
            try {
                stored = await this.blobs.put(outcome.content, {
                    mimeType: outcome.mimeType,
                });
            } catch (error) {
                this.logger?.error("storage.blob.put.failed", {
                    workflowRunId: input.workflowRunId,
                    kind: "media_retry",
                    assetId: outcome.assetId,
                    byteSize: outcome.content.byteLength,
                }, error);
                throw error;
            }
        }
        return this.prisma.$transaction(async (tx) => {
            await assertWorkflowActionFence(tx, input.fence, input.workflowRunId);
            // `(id, attemptCount)` is the CAS: a concurrent retry of the same
            // Asset (or a newer one that already incremented) makes this a no-op
            // instead of a second write (ADR-0015 decision 4).
            const updated = await tx.asset.updateMany({
                where: { id: outcome.assetId, attemptCount: input.expectedAttemptCount },
                data: outcome.status === "saved"
                    ? {
                        status: "saved",
                        storageKey: stored?.key ?? null,
                        byteSize: stored?.byteSize ?? null,
                        mimeType: outcome.mimeType,
                        errorMessage: null,
                        errorCode: null,
                        attemptCount: input.expectedAttemptCount + 1,
                        lastAttemptAt: new Date(),
                    }
                    : {
                        status: outcome.status,
                        storageKey: null,
                        byteSize: null,
                        errorMessage: outcome.errorMessage,
                        errorCode: outcome.errorCode,
                        attemptCount: input.expectedAttemptCount + 1,
                        lastAttemptAt: new Date(),
                    },
            });
            if (updated.count === 0) {
                return false;
            }
            await appendDomainEvent(tx, {
                type: "media.retry.attempted.v1",
                aggregateType: "Asset",
                aggregateId: outcome.assetId,
                workflowRunId: input.workflowRunId,
                payload: {
                    assetId: outcome.assetId,
                    status: outcome.status,
                    attemptCount: input.expectedAttemptCount + 1,
                    ...(outcome.status === "saved"
                        ? { byteSize: stored?.byteSize ?? 0 }
                        : { errorCode: outcome.errorCode }),
                },
            });
            return true;
        });
    }

    async runMediaCleanup(input: {
        workflowRunId: string;
        fence: HostActionExecutionFence;
        sourceId: string | null;
        dryRun: boolean;
    }): Promise<MediaCleanupReport> {
        const startedAt = new Date();
        const candidates = await this.listRetentionCleanupCandidates({
            sourceId: input.sourceId,
            now: startedAt,
        });
        let cleanedCount = 0;
        let cleanedBytes = 0;
        let sharedKeyCount = 0;
        if (!input.dryRun) {
            for (const candidate of candidates) {
                const outcome = await this.prisma.$transaction(async (tx) => {
                    await assertWorkflowActionFence(tx, input.fence, input.workflowRunId);
                    const updated = await tx.asset.updateMany({
                        where: {
                            id: candidate.assetId,
                            status: "saved",
                            storageKey: candidate.storageKey,
                        },
                        data: {
                            status: "metadata_only",
                            storageKey: null,
                            byteSize: null,
                            errorCode: "retention_expired",
                            errorMessage: `已按保留期清理（保留 ${candidate.retentionDays} 天）`,
                        },
                    });
                    if (updated.count === 0) {
                        return null;
                    }
                    // Content-addressed blobs are deduplicated; only the last
                    // referencing Asset may remove the bytes (decision 9).
                    const shared = await tx.asset.count({
                        where: {
                            storageKey: candidate.storageKey,
                            id: { not: candidate.assetId },
                        },
                    });
                    return { shared: shared > 0 };
                });
                if (!outcome) {
                    continue;
                }
                cleanedCount += 1;
                if (outcome.shared) {
                    sharedKeyCount += 1;
                    continue;
                }
                cleanedBytes += candidate.byteSize ?? 0;
                try {
                    await this.blobs.delete(candidate.storageKey);
                } catch (error) {
                    this.logger?.warn("storage.blob.delete.failed", {
                        workflowRunId: input.workflowRunId,
                        assetId: candidate.assetId,
                        reason: error instanceof Error ? error.message : "unknown",
                    });
                }
            }
        }
        const report: MediaCleanupReport = {
            dryRun: input.dryRun,
            sourceId: input.sourceId,
            candidateCount: candidates.length,
            candidateBytes: candidates.reduce(
                (sum, candidate) => sum + (candidate.byteSize ?? 0),
                0,
            ),
            cleanedCount,
            cleanedBytes,
            sharedKeyCount,
            samples: candidates.slice(0, 20).map((candidate) => ({
                assetId: candidate.assetId,
                sourceId: candidate.sourceId,
                sourceName: candidate.sourceName,
                title: candidate.title,
                byteSize: candidate.byteSize,
                createdAt: candidate.createdAt,
                expiredAt: candidate.expiredAt,
            })),
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
        };
        await this.prisma.$transaction(async (tx) => {
            await assertWorkflowActionFence(tx, input.fence, input.workflowRunId);
            await appendDomainEvent(tx, {
                type: "media.cleanup.completed.v1",
                aggregateType: "WorkflowRun",
                aggregateId: input.workflowRunId,
                workflowRunId: input.workflowRunId,
                payload: report,
            });
        });
        return report;
    }

    async getMediaCleanupReport(runId: string): Promise<MediaCleanupReport | null> {
        const event = await this.prisma.domainEvent.findFirst({
            where: {
                type: "media.cleanup.completed.v1",
                aggregateType: "WorkflowRun",
                aggregateId: runId,
            },
            orderBy: { sequence: "desc" },
        });
        if (!event) {
            return null;
        }
        const parsed = mediaCleanupReportSchema.safeParse(parseJson(event.payloadJson));
        return parsed.success ? parsed.data : null;
    }

    async persistWorkflowIngestItem(input: {        sourceId: string;
        workflowRunId: string;
        triggerKind: IngestTriggerKind;
        item: NormalizedIngestItem;
        fence: HostActionExecutionFence;
        idempotencyKey: string;
    }): Promise<PersistIngestItemResult> {
        return this.persistIngestItemInternal({
            sourceId: input.sourceId,
            runId: null,
            workflowRunId: input.workflowRunId,
            triggerKind: input.triggerKind,
            item: input.item,
            fence: input.fence,
            ingestCommandId: input.idempotencyKey,
        });
    }

    async persistIngestItem(input: {
        sourceId: string;
        runId: string;
        item: NormalizedIngestItem;
    }): Promise<PersistIngestItemResult> {
        const startedAt = Date.now();
        try {
            const result = await this.persistIngestItemInternal(input);
            this.logger?.debug("storage.persist_ingest.completed", {
                sourceId: input.sourceId,
                runId: input.runId,
                createdEntry: result.createdEntry,
                revisedEntry: result.revisedEntry,
                duplicateObservation: result.duplicateObservation,
                durationMs: Date.now() - startedAt,
            });
            return result;
        } catch (error) {
            this.logger?.error("storage.persist_ingest.failed", {
                sourceId: input.sourceId,
                runId: input.runId,
                durationMs: Date.now() - startedAt,
            }, error);
            throw error;
        }
    }

    async setWorkflowIngestCheckpoint(input: {
        sourceId: string;
        workflowRunId: string;
        cursor: string | null;
        expectedRevision: number;
        itemCount: number;
        fence: HostActionExecutionFence;
        idempotencyKey: string;
    }): Promise<SourceCheckpointOutput> {
        return this.prisma.$transaction(async (tx) => {
            await assertWorkflowActionFence(tx, input.fence, input.workflowRunId);
            const existingEvent = await tx.domainEvent.findFirst({
                where: {
                    workflowRunId: input.workflowRunId,
                    idempotencyKey: input.idempotencyKey,
                },
            });
            if (existingEvent) {
                const payload = parseJson<{ sourceId?: string; cursor?: string | null; revision?: number; committed?: boolean }>(existingEvent.payloadJson);
                if (payload?.sourceId !== input.sourceId) {
                    throw new Error("Checkpoint idempotency key conflicts with another source.");
                }
                return {
                    sourceId: input.sourceId,
                    cursor: payload.cursor ?? null,
                    revision: payload.revision ?? input.expectedRevision,
                    committed: payload.committed === true,
                };
            }
            const checkpoint = await tx.checkpoint.findUnique({
                where: { sourceInstanceId: input.sourceId },
            });
            const currentRevision = checkpoint?.revision ?? 0;
            const currentCursor = checkpoint?.cursor ?? null;
            if (currentRevision !== input.expectedRevision) {
                await appendDomainEvent(tx, {
                    type: "source.checkpoint.superseded.v1",
                    workflowRunId: input.workflowRunId,
                    idempotencyKey: input.idempotencyKey,
                    payload: {
                        sourceId: input.sourceId,
                        cursor: currentCursor,
                        revision: currentRevision,
                        committed: false,
                    },
                });
                return {
                    sourceId: input.sourceId,
                    cursor: currentCursor,
                    revision: currentRevision,
                    committed: false,
                };
            }
            const nextRevision = currentRevision + 1;
            if (checkpoint) {
                const updated = await tx.checkpoint.updateMany({
                    where: {
                        sourceInstanceId: input.sourceId,
                        revision: input.expectedRevision,
                    },
                    data: {
                        cursor: input.cursor,
                        revision: nextRevision,
                        workflowRunId: input.workflowRunId,
                    },
                });
                if (updated.count !== 1) {
                    throw new Error("Checkpoint revision CAS lost.");
                }
            } else if (input.expectedRevision !== 0) {
                throw new Error("Checkpoint revision CAS expected a missing revision 0 row.");
            } else {
                await tx.checkpoint.create({
                    data: {
                        sourceInstanceId: input.sourceId,
                        cursor: input.cursor,
                        revision: nextRevision,
                        workflowRunId: input.workflowRunId,
                    },
                });
            }
            await appendDomainEvent(tx, {
                type: "source.checkpoint.committed.v1",
                workflowRunId: input.workflowRunId,
                idempotencyKey: input.idempotencyKey,
                payload: {
                    sourceId: input.sourceId,
                    cursor: input.cursor,
                    revision: nextRevision,
                    itemCount: input.itemCount,
                    committed: true,
                },
            });
            return {
                sourceId: input.sourceId,
                cursor: input.cursor,
                revision: nextRevision,
                committed: true,
            };
        });
    }

    async setCheckpoint(sourceId: string, cursor: string | null): Promise<void> {
        try {
            await this.prisma.checkpoint.upsert({
                where: { sourceInstanceId: sourceId },
                create: {
                    sourceInstanceId: sourceId,
                    cursor,
                },
                update: { cursor },
            });
        } catch (error) {
            this.logger?.error("storage.checkpoint.failed", {
                sourceId,
            }, error);
            throw error;
        }
    }

    async completeRun(input: {
        runId: string;
        status: "succeeded" | "failed" | "cancelled";
        error?: string | null;
        lease?: JobLease;
    }) {
        const now = new Date();
        let run: Prisma.RunGetPayload<{}>;
        try {
            run = await this.prisma.$transaction(async (tx) => {
                if (input.lease) {
                    await assertJobLease(tx, input.runId, input.lease);
                }
                const updated = await tx.run.update({
                    where: { id: input.runId },
                    data: {
                        status: input.status,
                        finishedAt: now,
                        errorMessage: input.error ?? null,
                    },
                });
                await tx.step.updateMany({
                    where: { runId: input.runId },
                    data: {
                        status: input.status,
                        finishedAt: now,
                        errorMessage: input.error ?? null,
                    },
                });
                if (!input.lease) {
                    await tx.job.updateMany({
                        where: { runId: input.runId },
                        data: {
                            status: input.status === "succeeded"
                                ? "succeeded"
                                : input.status === "cancelled"
                                    ? "cancelled"
                                    : "failed_terminal",
                            leaseExpiresAt: null,
                            leaseOwner: null,
                            leaseToken: null,
                        },
                    });
                }
                await appendDomainEvent(tx, {
                    type: `run.${input.status}.v1`,
                    aggregateType: "Run",
                    aggregateId: input.runId,
                    runId: input.runId,
                    payload: {
                        runId: input.runId,
                        status: input.status,
                        error: input.error ?? null,
                    },
                });
                return updated;
            });
        } catch (error) {
            this.logger?.error("storage.run.complete.failed", {
                runId: input.runId,
                status: input.status,
                ...(input.lease ? { jobId: input.lease.jobId } : {}),
            }, error);
            throw error;
        }
        return this.toRunSnapshot(run);
    }

    async readAsset(assetId: string): Promise<{
        content: Uint8Array;
        mimeType: string;
    } | null> {
        try {
            const asset = await this.prisma.asset.findUnique({
                where: { id: assetId },
            });
            if (!asset?.storageKey) {
                return null;
            }
            return {
                content: await this.blobs.read(asset.storageKey),
                mimeType: asset.mimeType ?? "application/octet-stream",
            };
        } catch (error) {
            this.logger?.error("storage.asset_read.failed", {
                assetId,
            }, error);
            throw error;
        }
    }

}
