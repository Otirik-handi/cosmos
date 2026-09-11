import { randomUUID } from "node:crypto";
import { jobKindSchema, sourceKindSchema, sourceConfigSchema, type ConnectionInstance, type FeedItem, type JobSnapshot, type IngestTriggerKind, type SourceSnapshot, type Annotation } from "@cosmos/contracts";
import { deriveExternalKey, fingerprintEntryRevision, fingerprintStoryRevision, projectEntryToStory, temporalProjection, type FavoriteTargetType, type NormalizedIngestItem, type TargetType } from "@cosmos/domain";
import { EntryNotFoundError, StoryNotFoundError, TopicNotFoundError, type HostActionExecutionFence, type PersistIngestItemResult } from "@cosmos/application";
import { FileBlobStore } from "@cosmos/blob-store";
import { type Prisma } from "@prisma/client";
import { appendDomainEvent, assertWorkflowActionFence, parseJson } from "./repository-internals.js";
import { PrismaCosmosRepositoryHelpers3 } from "./helpers-3.js";

export class PrismaCosmosRepositoryHelpers4 extends PrismaCosmosRepositoryHelpers3 {
    protected async persistIngestItemInternal(input: {
        sourceId: string;
        runId: string | null;
        workflowRunId?: string;
        triggerKind?: IngestTriggerKind;
        fence?: HostActionExecutionFence;
        ingestCommandId?: string;
        item: NormalizedIngestItem;
    }): Promise<PersistIngestItemResult> {
        const externalKey = deriveExternalKey(input.item);
        const contentFingerprint = fingerprintEntryRevision({
            title: input.item.title,
            summary: input.item.summary,
            contentText: input.item.contentText,
            webUrl: input.item.webUrl,
            kind: input.item.kind,
            publisher: input.item.publisher,
        });
        const publishedAtJson = input.item.publishedAt
            ? JSON.stringify(input.item.publishedAt)
            : null;
        const updatedAtJson = input.item.updatedAt
            ? JSON.stringify(input.item.updatedAt)
            : null;
        const sourcePublishedAt = temporalProjection(input.item.publishedAt);
        const sourcePublishedAtDate = sourcePublishedAt
            ? new Date(sourcePublishedAt)
            : null;
        const publisherJson = input.item.publisher
            ? JSON.stringify(input.item.publisher)
            : null;
        const metricsJson = input.item.metrics
            ? JSON.stringify(input.item.metrics)
            : null;
        let rawPayload: Awaited<ReturnType<FileBlobStore["put"]>>;
        try {
            rawPayload = await this.blobs.put(
                new TextEncoder().encode(input.item.rawPayload),
                {
                    mimeType: input.item.rawPayloadMimeType
                        ?? "application/octet-stream",
                },
            );
        } catch (error) {
            this.logger?.error("storage.blob.put.failed", {
                sourceId: input.sourceId,
                runId: input.runId,
                kind: "raw_payload",
                byteSize: Buffer.byteLength(input.item.rawPayload, "utf8"),
            }, error);
            throw error;
        }
        const storedAssets = await Promise.all(input.item.assets.map(async (asset, index) => {
            if (!asset.content || asset.status !== "saved") {
                return {
                    ...asset,
                    storageKey: null,
                };
            }
            let stored: Awaited<ReturnType<FileBlobStore["put"]>>;
            try {
                stored = await this.blobs.put(asset.content, {
                    mimeType: asset.mimeType,
                });
            } catch (error) {
                this.logger?.error("storage.blob.put.failed", {
                    sourceId: input.sourceId,
                    runId: input.runId,
                    kind: "asset",
                    assetKind: asset.kind,
                    assetIndex: index,
                    byteSize: asset.content.byteLength,
                }, error);
                throw error;
            }
            return {
                ...asset,
                storageKey: stored.key,
                byteSize: stored.byteSize,
            };
        }));

        return this.prisma.$transaction(async (tx) => {
            if (input.fence && input.workflowRunId) {
                await assertWorkflowActionFence(tx, input.fence, input.workflowRunId);
            }
            const existingByCommand = input.ingestCommandId
                ? await tx.observation.findUnique({
                    where: { ingestCommandId: input.ingestCommandId },
                })
                : null;
            if (existingByCommand) {
                const savedResult = parseJson<PersistIngestItemResult>(existingByCommand.ingestResultJson);
                return savedResult ?? {
                    createdEntry: false,
                    revisedEntry: false,
                    duplicateObservation: true,
                };
            }
            const existingObservation = input.runId === null
                ? null
                : await tx.observation.findFirst({
                    where: {
                        sourceInstanceId: input.sourceId,
                        runId: input.runId,
                        externalKey,
                    },
                });
            if (existingObservation) {
                return {
                    createdEntry: false,
                    revisedEntry: false,
                    duplicateObservation: true,
                };
            }

            const existingEntry = await tx.entry.findUnique({
                where: {
                    sourceInstanceId_canonicalExternalId: {
                        sourceInstanceId: input.sourceId,
                        canonicalExternalId: externalKey,
                    },
                },
                include: {
                    currentRevision: true,
                },
            });
            const observation = await tx.observation.create({
                data: {
                    sourceInstanceId: input.sourceId,
                    runId: input.runId,
                    workflowRunId: input.workflowRunId ?? null,
                    ingestCommandId: input.ingestCommandId ?? null,
                    ingestResultJson: null,
                    entryId: existingEntry?.id,
                    externalId: input.item.externalId ?? null,
                    externalKey: externalKey,
                    externalRevision: contentFingerprint,
                    eventKind: existingEntry ? "update" : "create",
                    sourceLocatorJson: JSON.stringify(input.item.sourceLocator),
                    discoveryContextJson: JSON.stringify({
                        kind: input.triggerKind ?? "manual",
                    }),
                    webUrl: input.item.webUrl,
                    payloadBlobKey: rawPayload.key,
                    title: input.item.title,
                    contentText: input.item.contentText,
                    contentFingerprint,
                    contentKind: input.item.kind,
                    publisherJson,
                    metricsJson,
                    publishedAtJson,
                    updatedAtJson,
                    sourcePublishedAt: sourcePublishedAtDate,
                },
            });

            if (
                existingEntry?.currentRevision?.contentFingerprint === contentFingerprint
            ) {
                const revisionUpdate: {
                    publishedAtJson?: string;
                    updatedAtJson?: string;
                    sourcePublishedAt?: Date;
                } = {};
                if (
                    sourcePublishedAtDate
                    && existingEntry.currentRevision.sourcePublishedAt?.getTime()
                        !== sourcePublishedAtDate.getTime()
                ) {
                    revisionUpdate.publishedAtJson = publishedAtJson ?? undefined;
                    revisionUpdate.sourcePublishedAt = sourcePublishedAtDate;
                }
                if (
                    updatedAtJson
                    && existingEntry.currentRevision.updatedAtJson !== updatedAtJson
                ) {
                    revisionUpdate.updatedAtJson = updatedAtJson;
                }
                if (Object.keys(revisionUpdate).length > 0) {
                    await tx.entryRevision.update({
                        where: { id: existingEntry.currentRevision.id },
                        data: revisionUpdate,
                    });
                }
                if (metricsJson) {
                    await tx.entry.update({
                        where: { id: existingEntry.id },
                        data: { metricsJson },
                    });
                }
                if (input.runId) {
                    await tx.run.update({
                        where: { id: input.runId },
                        data: {
                            itemCount: { increment: 1 },
                            duplicateObservationCount: { increment: 1 },
                        },
                    });
                }
                return {
                    createdEntry: false,
                    revisedEntry: false,
                    duplicateObservation: true,
                };
            }

            const entry = existingEntry ?? await tx.entry.create({
                data: {
                    sourceInstanceId: input.sourceId,
                    canonicalExternalId: externalKey,
                },
            });
            if (!existingEntry) {
                await tx.observation.update({
                    where: { id: observation.id },
                    data: { entryId: entry.id },
                });
            }
            const revisionNumber = (existingEntry?.currentRevision?.revision ?? 0) + 1;
            const revision = await tx.entryRevision.create({
                data: {
                    entryId: entry.id,
                    revision: revisionNumber,
                    title: input.item.title,
                    summary: input.item.summary,
                    contentText: input.item.contentText,
                    contentFingerprint,
                    contentKind: input.item.kind,
                    publisherJson,
                    publishedAtJson,
                    updatedAtJson,
                    webUrl: input.item.webUrl,
                    sourcePublishedAt: sourcePublishedAtDate,
                },
            });

            const storyProjection = projectEntryToStory({
                entryId: entry.id,
                revisionId: revision.id,
                title: input.item.title,
                summary: input.item.summary,
                contentKind: input.item.kind,
            });
            const storyId = existingEntry?.storyId ?? storyProjection.id;
            await tx.story.upsert({
                where: { id: storyId },
                create: {
                    id: storyId,
                    kind: storyProjection.kind,
                },
                update: {
                    kind: storyProjection.kind,
                },
            });
            const storyFingerprint = fingerprintStoryRevision({
                title: input.item.title,
                summary: input.item.summary,
                kind: storyProjection.kind,
                subtype: storyProjection.subtype,
            });
            const storyWithCurrent = await tx.story.findUnique({
                where: { id: storyId },
                include: { currentRevision: true },
            });
            const storyCurrentFingerprint = storyWithCurrent?.currentRevision?.fingerprint ?? null;
            if (storyCurrentFingerprint !== storyFingerprint) {
                const latestStoryRevision = await tx.storyRevision.findFirst({
                    where: { storyId },
                    orderBy: { revision: "desc" },
                    select: { revision: true },
                });
                const storyRevision = await tx.storyRevision.create({
                    data: {
                        story: {
                            connect: { id: storyId },
                        },
                        revision: (latestStoryRevision?.revision ?? 0) + 1,
                        fingerprint: storyFingerprint,
                        title: input.item.title,
                        summary: input.item.summary,
                    },
                });
                await tx.story.update({
                    where: { id: storyId },
                    data: {
                        currentRevisionId: storyRevision.id,
                    },
                });
            }

            await tx.entry.update({
                where: { id: entry.id },
                data: {
                    storyId,
                    currentRevisionId: revision.id,
                    ...(metricsJson ? { metricsJson } : {}),
                },
            });

            for (const asset of storedAssets) {
                await tx.asset.create({
                    data: {
                        entryRevisionId: revision.id,
                        kind: asset.kind,
                        status: asset.status,
                        sourceUrl: asset.sourceUrl,
                        storageKey: asset.storageKey,
                        mimeType: asset.mimeType,
                        byteSize: asset.byteSize,
                        errorMessage: asset.errorMessage ?? null,
                        errorCode: asset.errorCode ?? null,
                        attemptCount: asset.attemptCount ?? 0,
                    },
                });
            }

            await tx.$executeRawUnsafe(
                "DELETE FROM entry_search WHERE entry_id = ?",
                entry.id,
            );
            await tx.$executeRawUnsafe(
                "INSERT INTO entry_search (entry_id, title, content_text) VALUES (?, ?, ?)",
                entry.id,
                input.item.title,
                input.item.contentText,
            );
            await tx.domainEvent.create({
                data: {
                    eventId: randomUUID(),
                    type: existingEntry ? "entry.revised.v1" : "entry.created.v1",
                    version: "v1",
                    payloadJson: JSON.stringify({
                        observationId: observation.id,
                        entryId: entry.id,
                        revisionId: revision.id,
                        storyId,
                    }),
                    aggregateType: "Entry",
                    aggregateId: entry.id,
                    runId: input.runId,
                    workflowRunId: input.workflowRunId ?? null,
                },
            });
            await appendDomainEvent(tx, {
                type: "feed.updated.v1",
                aggregateType: "Feed",
                aggregateId: storyId,
                runId: input.runId,
                workflowRunId: input.workflowRunId,
                payload: {
                    storyId,
                    entryId: entry.id,
                    revisionId: revision.id,
                },
            });
            const result: PersistIngestItemResult = {
                createdEntry: !existingEntry,
                revisedEntry: Boolean(existingEntry),
                duplicateObservation: false,
            };
            if (input.ingestCommandId) {
                await tx.observation.update({
                    where: { id: observation.id },
                    data: { ingestResultJson: JSON.stringify(result) },
                });
            }
            if (input.runId) {
                await tx.run.update({
                    where: { id: input.runId },
                    data: {
                        itemCount: { increment: 1 },
                        createdEntryCount: existingEntry
                            ? undefined
                            : { increment: 1 },
                        revisedEntryCount: existingEntry
                            ? { increment: 1 }
                            : undefined,
                    },
                });
            }
            return result;
        });
    }

    protected toAnnotation(row: {
        id: string;
        targetType: string;
        targetId: string;
        targetRevisionId: string | null;
        quote: string | null;
        body: string;
        evidence: string | null;
        actorJson: string | null;
        createdAt: Date;
        updatedAt: Date;
    }): Annotation {
        return {
            id: row.id,
            targetType: row.targetType,
            targetId: row.targetId,
            targetRevisionId: row.targetRevisionId,
            quote: row.quote,
            body: row.body,
            evidence: row.evidence,
            actor: row.actorJson == null ? null : parseJson<string>(row.actorJson),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }

    protected async resolveTargetTargetId(
        targetType: TargetType | FavoriteTargetType,
        targetId: string,
    ): Promise<string> {
        switch (targetType) {
            case "story": {
                const canonical = await this.resolveCanonicalStoryId(targetId);
                if (!canonical) {
                    throw new StoryNotFoundError(targetId);
                }
                return canonical;
            }
            case "entry": {
                const entry = await this.prisma.entry.findUnique({
                    where: { id: targetId },
                    select: { id: true },
                });
                if (!entry) {
                    throw new EntryNotFoundError(targetId);
                }
                return targetId;
            }
            case "topic": {
                const topic = await this.prisma.topic.findUnique({
                    where: { id: targetId },
                    select: { id: true },
                });
                if (!topic) {
                    throw new TopicNotFoundError(targetId);
                }
                return targetId;
            }
        }
        throw new Error(`Unknown target type: ${String(targetType)}`);
    }

    protected async toSourceSnapshot(
        source: Prisma.SourceInstanceGetPayload<{}>,
        // Transaction-scoped reads let activation freeze the exact post-write
        // projection it will replay later.
        db: Prisma.TransactionClient = this.prisma,
    ): Promise<SourceSnapshot> {
        const [latestRun, latestWorkflowRun] = await Promise.all([
            db.run.findFirst({
                where: { sourceInstanceId: source.id },
                orderBy: { createdAt: "desc" },
            }),
            db.workflowRun.findFirst({
                where: { sourceInstanceId: source.id },
                orderBy: { createdAt: "desc" },
            }),
        ]);
        const legacyProjection = latestRun
            ? {
                at: latestRun.finishedAt ?? latestRun.createdAt,
                error: latestRun.errorMessage,
            }
            : null;
        const workflowProjection = latestWorkflowRun
            ? {
                at: latestWorkflowRun.finishedAt ?? latestWorkflowRun.createdAt,
                error: latestWorkflowRun.errorMessage,
            }
            : null;
        const latest = legacyProjection && workflowProjection
            ? legacyProjection.at >= workflowProjection.at ? legacyProjection : workflowProjection
            : legacyProjection ?? workflowProjection;
        const manifest = this.catalog.getSourceDefinitionByRef(source.sourceDefinitionRef);
        if (!manifest || manifest.id !== source.kind || !manifest.operationIds.includes(source.operationId)) {
            throw new Error(`Source definition mapping is invalid: ${source.sourceDefinitionRef}`);
        }
        const trigger = await db.triggerBinding.findUnique({ where: { sourceId: source.id } });
        const triggerConfig = trigger ? JSON.parse(trigger.configJson) as { intervalMs?: number } : null;
        return {
            id: source.id,
            name: source.name,
            sourceDefinitionRef: manifest.ref,
            operationId: source.operationId,
            connectorId: manifest.connectorId,
            kind: manifest.id,
            config: sourceConfigSchema.parse(JSON.parse(source.configJson)),
            enabled: source.enabled,
            revisionId: `${source.id}:${source.revision}`,
            createdAt: source.createdAt.toISOString(),
            updatedAt: source.updatedAt.toISOString(),
            lastRunAt: latest?.at.toISOString() ?? null,
            lastError: latest?.error ?? null,
            connectionId: source.connectionId,
            scheduleIntervalMs: typeof triggerConfig?.intervalMs === "number" ? triggerConfig.intervalMs : null,
        };
    }

    protected toConnectionSnapshot(connection: Prisma.ConnectionInstanceGetPayload<{}>): ConnectionInstance {
        return {
            id: connection.id,
            name: connection.name,
            connectorId: connection.connectorId,
            account: connection.account,
            scopeJson: connection.scopeJson,
            status: connection.status as ConnectionInstance["status"],
            secretRef: connection.secretRef,
            lastError: connection.lastError,
            createdAt: connection.createdAt.toISOString(),
            updatedAt: connection.updatedAt.toISOString(),
        };
    }

    protected toJobSnapshot(job: Prisma.JobGetPayload<{}>): JobSnapshot {
        const payload = job.payloadJson
            ? JSON.parse(job.payloadJson) as { sourceId?: unknown }
            : null;
        const sourceId = typeof payload?.sourceId === "string"
            ? payload.sourceId
            : null;

        return {
            id: job.id,
            kind: jobKindSchema.parse(job.kind),
            sourceId,
            runId: job.runId,
            status: job.status as JobSnapshot["status"],
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            errorCode: job.errorCode,
            error: job.errorMessage,
            createdAt: job.createdAt.toISOString(),
            updatedAt: job.updatedAt.toISOString(),
            result: job.resultJson
                ? JSON.parse(job.resultJson) as unknown
                : null,
        };
    }

    protected toFeedItemFromSearchRow(row: {
        entryId: string;
        storyId: string;
        storyKind: string;
        title: string;
        summary: string | null;
        sourceId: string;
        sourceName: string;
        sourceKind: string;
        revisionId: string;
        publishedAt: string | null;
    }): Omit<FeedItem, "assets"> {
        return {
            storyId: row.storyId,
            storyKind: row.storyKind as "event" | "document" | "media" | "thread",
            title: row.title,
            summary: row.summary,
            entryId: row.entryId,
            sourceId: row.sourceId,
            sourceName: row.sourceName,
            sourceKind: sourceKindSchema.parse(row.sourceKind),
            revisionId: row.revisionId,
            publishedAt: row.publishedAt
                ? new Date(row.publishedAt).toISOString()
                : null,
        };
    }

}
