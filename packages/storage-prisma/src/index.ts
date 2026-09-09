import { createHash, randomUUID } from "node:crypto";
import {
    join,
    relative,
    resolve,
} from "node:path";

import {
    contentKindSchema,
    jobKindSchema,
    sourceKindSchema,
    sourceConfigSchema,
    type CreateSourceCommand,
    type ContentMetrics,
    type EntryDetail,
    type EntryPage,
    type FeedItem,
    type FeedPage,
    type HealthResponse,
    type JobSnapshot,
    type SearchPage,
    type SearchQuery,
    type RevisionDetail,
    type IngestTriggerKind,
    type SourceActivationCommand,
    type SourceCheckpointOutput,
    type SourceConfigProbeCommand,
    type Publisher,
    type SourceSnapshot,
    type StoryDetail,
    type TemporalValue,
    type TopicDetail,
    type TopicPage,
    type TopicSummary,
    type UpdateSourceCommand,
    type EntityDetail,
    type EntityPage,
    type LabelDetail,
    type LabelItem,
    type LabelList,
    type LabelRef,
    type CollectionDetail,
    type CollectionList,
    type CollectionSummary,
    type FavoriteList,
    type Annotation,
    type AnnotationList,
    type SavedView,
    type SavedViewList,
    type BoardBlock,
    type BoardDetail,
    type BoardList,
    type SpotlightPlacement,
    type SpotlightPlacementList,
    blockConfigSchemaFor,
} from "@cosmos/contracts";
import {
    deriveExternalKey,
    entityRelationTypes,
    entityTypes,
    fingerprintEntityRevision,
    fingerprintEntryRevision,
    fingerprintStoryRevision,
    fingerprintTopicRevision,
    projectEntryToStory,
    temporalProjection,
    type BlockType,
    type EntityRelationType,
    type EntityType,
    type FavoriteTargetType,
    type NormalizedIngestItem,
    type SpotlightTargetType,
    type TargetType,
    type TopicMemberRole,
} from "@cosmos/domain";
import {
    createBuiltinManifestCatalog,
    EntityNotFoundError,
    EntityRelationConflictError,
    EntityRevisionConflictError,
    EntryNotFoundError,
    AnnotationNotFoundError,
    SavedViewNotFoundError,
    CollectionNotFoundError,
    BoardBlockNotFoundError,
    BoardNameConflictError,
    BoardNotFoundError,
    BoardSectionNotFoundError,
    SpotlightPlacementNotFoundError,
    LabelConflictError,
    LabelNotFoundError,
    SourceNotFoundError,
    SourceRevisionConflictError,
    StoryMergeConflictError,
    StoryNotFoundError,
    StoryRevisionConflictError,
    TopicMergeConflictError,
    TopicMembershipNotFoundError,
    TopicNotFoundError,
    TopicRevisionConflictError,
    type CatalogPort,
    type CosmosRepository,
    type HostActionExecutionFence,
    type JobLease,
    type LoggerPort,
    type PersistIngestItemResult,
    type RepositoryHealth,
    type WorkflowAttemptSnapshot,
} from "@cosmos/application";
import { FileBlobStore } from "@cosmos/blob-store";
import { PrismaClient, type Prisma } from "@prisma/client";
import { workflowRunError } from "./workflow-run-projection.js";

export interface StorageRoots {
    dataRoot: string;
    databasePath: string;
    databaseUrl: string;
    blobRoot: string;
    artifactRoot: string;
    cacheRoot: string;
    logRoot: string;
    secretRoot: string;
}

export function resolveStorageRoots(
    dataRoot = process.env.COSMOS_DATA_ROOT?.trim() || ".cosmos",
    workspaceRoot = process.env.COSMOS_WORKSPACE_ROOT ?? process.cwd(),
): StorageRoots {
    const root = resolve(workspaceRoot, dataRoot);
    const databasePath = join(root, "cosmos.sqlite");

    return {
        dataRoot: root,
        databasePath,
        databaseUrl: `file:${databasePath.replaceAll("\\", "/")}`,
        blobRoot: join(root, "blobs"),
        artifactRoot: join(root, "artifacts"),
        cacheRoot: join(root, "cache"),
        logRoot: join(root, "logs"),
        secretRoot: join(root, "secrets"),
    };
}

export function createPrismaClient(
    dataRoot = process.env.COSMOS_DATA_ROOT?.trim() || ".cosmos",
): PrismaClient {
    const roots = resolveStorageRoots(dataRoot);

    return new PrismaClient({
        datasources: {
            db: {
                url: process.env.DATABASE_URL || roots.databaseUrl,
            },
        },
    });
}

export function resolveContainedPath(root: string, child: string): string {
    const resolvedRoot = resolve(root);
    const resolvedChild = resolve(resolvedRoot, child);
    const childRelativeToRoot = relative(resolvedRoot, resolvedChild);

    if (
        childRelativeToRoot.startsWith("..") ||
        childRelativeToRoot.includes(":") ||
        resolve(resolvedRoot, childRelativeToRoot) !== resolvedChild
    ) {
        throw new Error("Path escapes the configured storage root.");
    }

    return resolvedChild;
}

function parseSourceRevisionId(sourceId: string, revisionId: string): number {
    const prefix = `${sourceId}:`;
    if (!revisionId.startsWith(prefix) || revisionId.length === prefix.length) {
        throw new SourceRevisionConflictError(sourceId);
    }
    const rawRevision = revisionId.slice(prefix.length);
    if (!/^[1-9][0-9]*$/.test(rawRevision)) {
        throw new SourceRevisionConflictError(sourceId);
    }
    const revision = Number(rawRevision);
    if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new SourceRevisionConflictError(sourceId);
    }
    return revision;
}

export class PrismaCosmosRepository implements CosmosRepository {
    readonly roots: StorageRoots;
    readonly prisma: PrismaClient;
    readonly blobs: FileBlobStore;
    private readonly logger?: LoggerPort;
    private readonly catalog: CatalogPort;

    constructor(options: {
        dataRoot?: string;
        prisma?: PrismaClient;
        blobs?: FileBlobStore;
        logger?: LoggerPort;
        catalog?: CatalogPort;
    } = {}) {
        this.roots = resolveStorageRoots(options.dataRoot);
        this.prisma = options.prisma ?? createPrismaClient(this.roots.dataRoot);
        this.blobs = options.blobs ?? new FileBlobStore({
            root: this.roots.blobRoot,
        });
        this.logger = options.logger;
        this.catalog = options.catalog ?? createBuiltinManifestCatalog();
    }

    async initialize(): Promise<void> {
        const startedAt = Date.now();
        this.logger?.info("storage.initialize.started");
        try {
            await this.prisma.$connect();
            await this.prisma.$executeRawUnsafe(`
                CREATE VIRTUAL TABLE IF NOT EXISTS entry_search USING fts5(
                    entry_id UNINDEXED,
                    title,
                    content_text,
                    tokenize = 'unicode61'
                )
            `);
            this.logger?.info("storage.initialize.completed", {
                durationMs: Date.now() - startedAt,
            });
        } catch (error) {
            this.logger?.error("storage.initialize.failed", {
                durationMs: Date.now() - startedAt,
            }, error);
            throw error;
        }
    }

    async close(): Promise<void> {
        this.logger?.debug("storage.close.started");
        try {
            await this.prisma.$disconnect();
            this.logger?.debug("storage.close.completed");
        } catch (error) {
            this.logger?.error("storage.close.failed", {}, error);
            throw error;
        }
    }

    async createSource(input: CreateSourceCommand): Promise<SourceSnapshot> {
        const manifest = this.catalog.getSourceDefinitionByRef(input.sourceDefinitionRef);
        if (!manifest || manifest.status !== "enabled" || !manifest.operationIds.includes(input.operationId)) {
            throw new Error(`Source definition is not available: ${input.sourceDefinitionRef}`);
        }
        const source = await this.prisma.sourceInstance.create({
            data: {
                name: input.name,
                kind: manifest.id,
                sourceDefinitionRef: manifest.ref,
                operationId: input.operationId,
                configJson: JSON.stringify(input.config),
                enabled: false,
                revision: 1,
            },
        });
        return this.toSourceSnapshot(source);
    }

    async listSources(): Promise<readonly SourceSnapshot[]> {
        const sources = await this.prisma.sourceInstance.findMany({
            orderBy: { createdAt: "asc" },
        });
        return Promise.all(sources.map((source) => this.toSourceSnapshot(source)));
    }

    async getSource(sourceId: string): Promise<SourceSnapshot | null> {
        const source = await this.prisma.sourceInstance.findUnique({
            where: { id: sourceId },
        });
        return source ? this.toSourceSnapshot(source) : null;
    }

    async updateSource(sourceId: string, input: UpdateSourceCommand): Promise<SourceSnapshot> {
        const expectedRevision = parseSourceRevisionId(sourceId, input.baseRevisionId);
        const current = await this.prisma.sourceInstance.findUnique({ where: { id: sourceId } });
        if (!current) throw new SourceNotFoundError(sourceId);
        const updated = await this.prisma.sourceInstance.updateMany({
            where: { id: sourceId, revision: expectedRevision },
            data: {
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.config !== undefined ? { configJson: JSON.stringify(input.config) } : {}),
                revision: { increment: 1 },
            },
        });
        if (updated.count !== 1) throw new SourceRevisionConflictError(sourceId);
        return this.toSourceSnapshot(await this.prisma.sourceInstance.findUniqueOrThrow({ where: { id: sourceId } }));
    }

    async activateSource(input: SourceActivationCommand & {
        sourceId: string;
        idempotencyKey: string;
    }): Promise<SourceSnapshot> {
        const expectedRevision = parseSourceRevisionId(input.sourceId, input.baseRevisionId);
        const requestHash = sourceActivationRequestHash(input);
        let source: Prisma.SourceInstanceGetPayload<{}>;
        try {
            const outcome = await this.prisma.$transaction(async (tx): Promise<{
                snapshot: SourceSnapshot | null;
            }> => {
                const existing = await tx.sourceActivationCommand.findUnique({
                    where: { idempotencyKey: input.idempotencyKey },
                });
                if (existing) {
                    if (existing.sourceInstanceId !== input.sourceId || existing.requestHash !== requestHash) {
                        throw new SourceRevisionConflictError(input.sourceId);
                    }
                    // Replay returns the recorded first-result snapshot so the
                    // response stays stable even when later PATCHes moved the
                    // source forward. Rows created before that column existed
                    // fall back to a fresh read.
                    return {
                        snapshot: existing.resultSnapshotJson
                            ? JSON.parse(existing.resultSnapshotJson) as SourceSnapshot
                            : null,
                    };
                }

                const current = await tx.sourceInstance.findUnique({ where: { id: input.sourceId } });
                if (!current) throw new SourceNotFoundError(input.sourceId);
                // CAS guard for every fresh command, including no-op intents:
                // a stale baseRevisionId must conflict instead of recording.
                if (current.revision !== expectedRevision) {
                    throw new SourceRevisionConflictError(input.sourceId);
                }

                const resultRevision = current.enabled === input.enabled
                    ? expectedRevision
                    : expectedRevision + 1;
                if (resultRevision !== expectedRevision) {
                    const updated = await tx.sourceInstance.updateMany({
                        where: { id: input.sourceId, revision: expectedRevision },
                        data: { enabled: input.enabled, revision: resultRevision },
                    });
                    if (updated.count !== 1) throw new SourceRevisionConflictError(input.sourceId);
                }
                const resultRow = await tx.sourceInstance.findUniqueOrThrow({ where: { id: input.sourceId } });
                const snapshot = await this.toSourceSnapshot(resultRow, tx);
                await tx.sourceActivationCommand.create({
                    data: {
                        id: randomUUID(),
                        sourceInstanceId: input.sourceId,
                        idempotencyKey: input.idempotencyKey,
                        requestHash,
                        enabled: input.enabled,
                        baseRevisionId: input.baseRevisionId,
                        resultRevision,
                        resultSnapshotJson: JSON.stringify(snapshot),
                    },
                });
                return { snapshot };
            });
            if (outcome.snapshot) return outcome.snapshot;
            source = await this.prisma.sourceInstance.findUniqueOrThrow({ where: { id: input.sourceId } });
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;
            const existing = await this.prisma.sourceActivationCommand.findUnique({
                where: { idempotencyKey: input.idempotencyKey },
            });
            if (!existing || existing.sourceInstanceId !== input.sourceId || existing.requestHash !== requestHash) {
                throw new SourceRevisionConflictError(input.sourceId);
            }
            if (existing.resultSnapshotJson) {
                return JSON.parse(existing.resultSnapshotJson) as SourceSnapshot;
            }
            source = await this.prisma.sourceInstance.findUniqueOrThrow({ where: { id: input.sourceId } });
        }
        return this.toSourceSnapshot(source);
    }

    async createRun(input: {
        sourceId: string;
        triggerKind: "manual" | "schedule";
    }): Promise<Awaited<ReturnType<CosmosRepository["getRun"]>> extends infer T
        ? Exclude<T, null>
        : never> {
        const now = new Date();
        try {
            const run = await this.prisma.$transaction(async (tx) => {
            const created = await tx.run.create({
                data: {
                    sourceInstanceId: input.sourceId,
                    triggerKind: input.triggerKind,
                    status: "running",
                    startedAt: now,
                },
            });
            const step = await tx.step.create({
                data: {
                    runId: created.id,
                    position: 0,
                    kind: "ingest",
                    status: "running",
                    startedAt: now,
                },
            });
            await tx.job.create({
                data: {
                    runId: created.id,
                    stepId: step.id,
                    kind: "source-ingest",
                    status: "leased",
                    payloadJson: JSON.stringify({ sourceId: input.sourceId }),
                    idempotencyKey: `run:${created.id}:ingest`,
                    attempts: 1,
                    leaseOwner: "synchronous-ingest",
                    leaseToken: randomUUID(),
                    leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
                },
            });
            await appendDomainEvent(tx, {
                type: "run.queued.v1",
                aggregateType: "Run",
                aggregateId: created.id,
                runId: created.id,
                payload: { runId: created.id, sourceId: input.sourceId },
            });
            return created;
            });
            return this.toRunSnapshot(run);
        } catch (error) {
            this.logger?.error("storage.run.create.failed", {
                sourceId: input.sourceId,
                triggerKind: input.triggerKind,
            }, error);
            throw error;
        }
    }

    async createQueuedRun(input: {
        sourceId: string;
        triggerKind: "manual" | "schedule";
        idempotencyKey?: string;
    }) {
        try {
            const run = await this.prisma.$transaction(async (tx) => {
            if (input.idempotencyKey) {
                const existingJob = await tx.job.findUnique({
                    where: { idempotencyKey: input.idempotencyKey },
                    include: { run: true },
                });
                if (existingJob?.run) {
                    return existingJob.run;
                }
            }

            const created = await tx.run.create({
                data: {
                    sourceInstanceId: input.sourceId,
                    triggerKind: input.triggerKind,
                    status: "queued",
                },
            });
            const step = await tx.step.create({
                data: {
                    runId: created.id,
                    position: 0,
                    kind: "ingest",
                    status: "queued",
                },
            });
            await tx.job.create({
                data: {
                    runId: created.id,
                    stepId: step.id,
                    kind: "source-ingest",
                    status: "queued",
                    payloadJson: JSON.stringify({ sourceId: input.sourceId }),
                    idempotencyKey: input.idempotencyKey ?? `run:${created.id}:ingest`,
                },
            });
            await appendDomainEvent(tx, {
                type: "run.queued.v1",
                aggregateType: "Run",
                aggregateId: created.id,
                runId: created.id,
                payload: { runId: created.id, sourceId: input.sourceId },
            });
            return created;
            });
            return this.toRunSnapshot(run);
        } catch (error) {
            this.logger?.error("storage.run.queue.failed", {
                sourceId: input.sourceId,
                triggerKind: input.triggerKind,
            }, error);
            throw error;
        }
    }

    async createProbeJob(input: {
        sourceId: string;
        idempotencyKey?: string;
    }): Promise<JobSnapshot> {
        try {
            const job = await this.prisma.$transaction(async (tx) => {
            if (input.idempotencyKey) {
                const existing = await tx.job.findUnique({
                    where: { idempotencyKey: input.idempotencyKey },
                });
                if (existing) {
                    return existing;
                }
            }

            const created = await tx.job.create({
                data: {
                    kind: "source-probe",
                    status: "queued",
                    payloadJson: JSON.stringify({ sourceId: input.sourceId }),
                    idempotencyKey: input.idempotencyKey
                        ?? `probe:${input.sourceId}:${randomUUID()}`,
                },
            });
            await appendDomainEvent(tx, {
                type: "job.queued.v1",
                aggregateType: "Job",
                aggregateId: created.id,
                payload: {
                    jobId: created.id,
                    kind: created.kind,
                    sourceId: input.sourceId,
                },
            });
            return created;
            });
            return this.toJobSnapshot(job);
        } catch (error) {
            this.logger?.error("storage.job.queue.failed", {
                sourceId: input.sourceId,
                kind: "source-probe",
            }, error);
            throw error;
        }
    }

    async createConfigProbeJob(input: {
        command: SourceConfigProbeCommand;
        idempotencyKey?: string;
    }): Promise<JobSnapshot> {
        try {
            const job = await this.prisma.$transaction(async (tx) => {
                if (input.idempotencyKey) {
                    const existing = await tx.job.findUnique({
                        where: { idempotencyKey: input.idempotencyKey },
                    });
                    if (existing) {
                        return existing;
                    }
                }

                const created = await tx.job.create({
                    data: {
                        kind: "source-config-probe",
                        status: "queued",
                        payloadJson: JSON.stringify({ configProbe: input.command }),
                        idempotencyKey: input.idempotencyKey
                            ?? `config-probe:${randomUUID()}`,
                    },
                });
                await appendDomainEvent(tx, {
                    type: "job.queued.v1",
                    aggregateType: "Job",
                    aggregateId: created.id,
                    payload: {
                        jobId: created.id,
                        kind: created.kind,
                        sourceId: null,
                    },
                });
                return created;
            });
            return this.toJobSnapshot(job);
        } catch (error) {
            this.logger?.error("storage.job.queue.failed", {
                kind: "source-config-probe",
            }, error);
            throw error;
        }
    }

    async startRun(runId: string, lease?: JobLease) {
        const now = new Date();
        let run: Prisma.RunGetPayload<{}>;
        try {
            run = await this.prisma.$transaction(async (tx) => {
                if (lease) {
                    await assertJobLease(tx, runId, lease);
                }
                const updated = await tx.run.update({
                    where: { id: runId },
                    data: {
                        status: "running",
                        startedAt: now,
                        finishedAt: null,
                    },
                });
                await tx.step.updateMany({
                    where: { runId },
                    data: {
                        status: "running",
                        attempts: { increment: 1 },
                        startedAt: now,
                        finishedAt: null,
                    },
                });
                await appendDomainEvent(tx, {
                    type: "run.started.v1",
                    aggregateType: "Run",
                    aggregateId: runId,
                    runId,
                    payload: { runId },
                });
                return updated;
            });
        } catch (error) {
            this.logger?.error("storage.run.start.failed", {
                runId,
                ...(lease ? { jobId: lease.jobId } : {}),
            }, error);
            throw error;
        }
        return this.toRunSnapshot(run);
    }

    async getRun(runId: string) {
        const run = await this.prisma.run.findUnique({
            where: { id: runId },
        });
        return run ? this.toRunSnapshot(run) : null;
    }

    async getJob(jobId: string): Promise<JobSnapshot | null> {
        const job = await this.prisma.job.findUnique({
            where: { id: jobId },
        });
        return job ? this.toJobSnapshot(job) : null;
    }

    async listWorkflowAttempts(jobId: string): Promise<readonly WorkflowAttemptSnapshot[]> {
        const normalizedJobId = jobId.trim();
        if (!normalizedJobId) return [];
        const events = await this.prisma.domainEvent.findMany({
            where: {
                aggregateType: "WorkflowActivityJob",
                aggregateId: normalizedJobId,
            },
            orderBy: { sequence: "asc" },
            take: 1_000,
        });
        return projectWorkflowAttempts(normalizedJobId, events);
    }

    async getWorkflowAttempt(attemptId: string): Promise<WorkflowAttemptSnapshot | null> {
        const marker = ":attempt:";
        const markerIndex = attemptId.lastIndexOf(marker);
        if (markerIndex <= 0) return null;
        const jobId = attemptId.slice(0, markerIndex);
        const number = Number.parseInt(attemptId.slice(markerIndex + marker.length), 10);
        if (!Number.isSafeInteger(number) || number <= 0) return null;
        const attempt = (await this.listWorkflowAttempts(jobId)).find((item) => item.number === number);
        return attempt ?? null;
    }

    async getCheckpoint(sourceId: string): Promise<string | null> {
        const checkpoint = await this.prisma.checkpoint.findUnique({
            where: { sourceInstanceId: sourceId },
        });
        return checkpoint?.cursor ?? null;
    }

    async getCheckpointSnapshot(sourceId: string): Promise<{
        cursor: string | null;
        revision: number;
    }> {
        const checkpoint = await this.prisma.checkpoint.findUnique({
            where: { sourceInstanceId: sourceId },
        });
        return {
            cursor: checkpoint?.cursor ?? null,
            revision: checkpoint?.revision ?? 0,
        };
    }

    async claimNextJob(input: {
        owner: string;
        leaseMs: number;
        acceptedKinds: readonly string[];
    }) {
        if (input.acceptedKinds.length === 0) {
            return null;
        }
        const now = new Date();
        try {
            return await this.prisma.$transaction(async (tx) => {
            const candidate = await tx.job.findFirst({
                where: {
                    kind: { in: [...input.acceptedKinds] },
                    OR: [
                        {
                            status: { in: ["queued", "retry_wait"] },
                            OR: [
                                { nextAttemptAt: null },
                                { nextAttemptAt: { lte: now } },
                            ],
                        },
                        {
                            status: "leased",
                            leaseExpiresAt: { lte: now },
                        },
                    ],
                },
                orderBy: { createdAt: "asc" },
            });
            if (!candidate) {
                return null;
            }

            if (candidate.attempts >= candidate.maxAttempts) {
                const sourceId = readPayloadSourceId(candidate.payloadJson);
                await tx.job.update({
                    where: { id: candidate.id },
                    data: {
                        status: "failed_terminal",
                        errorMessage: "Job exceeded its maximum attempts.",
                        leaseOwner: null,
                        leaseToken: null,
                        leaseExpiresAt: null,
                    },
                });
                if (candidate.runId) {
                    await tx.run.update({
                        where: { id: candidate.runId },
                        data: {
                            status: "failed",
                            finishedAt: now,
                            errorMessage: "Job exceeded its maximum attempts.",
                        },
                    });
                }
                await appendDomainEvent(tx, {
                    type: "job.failed_terminal.v1",
                    aggregateType: "Job",
                    aggregateId: candidate.id,
                    runId: candidate.runId,
                    payload: {
                        jobId: candidate.id,
                        runId: candidate.runId,
                        reason: "max_attempts",
                    },
                });
                this.logger?.error("job.failed_terminal", {
                    jobId: candidate.id,
                    runId: candidate.runId,
                    ...(sourceId ? { sourceId } : {}),
                    attempts: candidate.attempts,
                    maxAttempts: candidate.maxAttempts,
                    errorCode: "max_attempts",
                });
                return null;
            }

            const leaseToken = randomUUID();
            const leaseGuard = candidate.status === "leased"
                ? {
                    leaseToken: candidate.leaseToken,
                    leaseExpiresAt: candidate.leaseExpiresAt,
                }
                : {};
            const updated = await tx.job.updateMany({
                where: {
                    id: candidate.id,
                    status: candidate.status,
                    ...leaseGuard,
                },
                data: {
                    status: "leased",
                    attempts: { increment: 1 },
                    leaseOwner: input.owner,
                    leaseToken,
                    leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
                    nextAttemptAt: null,
                },
            });
            if (updated.count !== 1) {
                const sourceId = readPayloadSourceId(candidate.payloadJson);
                this.logger?.debug("job.claim_rejected", {
                    jobId: candidate.id,
                    ...(candidate.runId ? { runId: candidate.runId } : {}),
                    ...(sourceId ? { sourceId } : {}),
                    owner: input.owner,
                    status: candidate.status,
                    reason: "lease_competition",
                });
                return null;
            }
            await appendDomainEvent(tx, {
                type: "job.leased.v1",
                aggregateType: "Job",
                aggregateId: candidate.id,
                runId: candidate.runId,
                payload: {
                    jobId: candidate.id,
                    runId: candidate.runId,
                    owner: input.owner,
                    attempts: candidate.attempts + 1,
                },
            });
            return {
                id: candidate.id,
                runId: candidate.runId,
                kind: candidate.kind,
                leaseToken,
                attempts: candidate.attempts + 1,
                maxAttempts: candidate.maxAttempts,
                payload: candidate.payloadJson
                    ? JSON.parse(candidate.payloadJson) as unknown
                    : null,
            };
            });
        } catch (error) {
            this.logger?.error("storage.job.claim.failed", {
                owner: input.owner,
            }, error);
            throw error;
        }
    }

    async renewJobLease(input: {
        jobId: string;
        leaseToken: string;
        leaseMs: number;
    }): Promise<boolean> {
        try {
            const result = await this.prisma.job.updateMany({
                where: {
                    id: input.jobId,
                    leaseToken: input.leaseToken,
                    status: "leased",
                },
                data: {
                    leaseExpiresAt: new Date(Date.now() + input.leaseMs),
                },
            });
            return result.count === 1;
        } catch (error) {
            this.logger?.error("storage.job.lease_renew.failed", {
                jobId: input.jobId,
            }, error);
            throw error;
        }
    }

    async completeJob(input: {
        jobId: string;
        leaseToken: string;
        status: "succeeded" | "retry_wait" | "failed_terminal";
        error?: string | null;
        errorCode?: string | null;
        result?: unknown;
        retryDelayMs?: number;
    }): Promise<boolean> {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const job = await tx.job.findFirst({
                    where: {
                        id: input.jobId,
                        leaseToken: input.leaseToken,
                        status: "leased",
                    },
                });
                if (!job) {
                    return false;
                }
                await tx.job.update({
                    where: { id: input.jobId },
                    data: {
                        status: input.status,
                        errorMessage: input.error ?? null,
                        errorCode: input.errorCode ?? null,
                        resultJson: input.result === undefined
                            ? undefined
                            : JSON.stringify(input.result),
                        leaseExpiresAt: null,
                        leaseOwner: null,
                        leaseToken: null,
                        nextAttemptAt: input.status === "retry_wait"
                            ? new Date(Date.now() + (input.retryDelayMs ?? 30_000))
                            : null,
                    },
                });
                await appendDomainEvent(tx, {
                    type: `job.${input.status}.v1`,
                    aggregateType: "Job",
                    aggregateId: input.jobId,
                    runId: job.runId,
                    payload: {
                        jobId: input.jobId,
                        runId: job.runId,
                        status: input.status,
                        error: input.error ?? null,
                        errorCode: input.errorCode ?? null,
                        result: input.result ?? null,
                    },
                });
                return true;
            });
        } catch (error) {
            this.logger?.error("storage.job.complete.failed", {
                jobId: input.jobId,
                status: input.status,
                errorCode: input.errorCode ?? null,
            }, error);
            throw error;
        }
    }

    async resetRunForRetry(input: {
        runId: string;
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
                        status: "queued",
                        startedAt: null,
                        finishedAt: null,
                        errorMessage: input.error ?? null,
                    },
                });
                await tx.step.updateMany({
                    where: { runId: input.runId },
                    data: {
                        status: "queued",
                        startedAt: null,
                        finishedAt: null,
                        errorMessage: input.error ?? null,
                    },
                });
                await appendDomainEvent(tx, {
                    type: "run.retry_wait.v1",
                    aggregateType: "Run",
                    aggregateId: input.runId,
                    runId: input.runId,
                    payload: {
                        runId: input.runId,
                        error: input.error ?? null,
                        at: now.toISOString(),
                    },
                });
                return updated;
            });
        } catch (error) {
            this.logger?.error("storage.run.retry_reset.failed", {
                runId: input.runId,
                ...(input.lease ? { jobId: input.lease.jobId } : {}),
            }, error);
            throw error;
        }
        return this.toRunSnapshot(run);
    }

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

    async persistWorkflowIngestItem(input: {
        sourceId: string;
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

    private async persistIngestItemInternal(input: {
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

    async feed(input: {
        cursor?: string;
        limit: number;
    }): Promise<FeedPage> {
        const offset = parseCursor(input.cursor);
        const entries = await this.prisma.entry.findMany({
            orderBy: { updatedAt: "desc" },
            skip: offset,
            take: input.limit + 1,
            include: this.entryInclude(),
        });
        const hasNext = entries.length > input.limit;
        const items = entries.slice(0, input.limit).map((entry) => this.toFeedItem(entry));

        return {
            items,
            nextCursor: hasNext ? String(offset + input.limit) : null,
        };
    }

    async search(input: SearchQuery): Promise<SearchPage> {
        const parsed = {
            text: input.text?.trim() ?? "",
            sourceId: input.sourceId,
            publishedAfter: input.publishedAfter
                ? new Date(input.publishedAfter)
                : null,
            publishedBefore: input.publishedBefore
                ? new Date(input.publishedBefore)
                : null,
            cursor: parseCursor(input.cursor),
            limit: Number(input.limit ?? 20),
            labelIds: parseIdList(input.labelIds),
            topicIds: parseIdList(input.topicIds),
        };
        if (
            (parsed.publishedAfter && Number.isNaN(parsed.publishedAfter.getTime()))
            || (parsed.publishedBefore && Number.isNaN(parsed.publishedBefore.getTime()))
        ) {
            throw new Error("Search date filters must be valid ISO timestamps.");
        }

        const conditions: string[] = [];
        const parameters: unknown[] = [];
        if (parsed.text) {
            conditions.push("entry_search MATCH ?");
            parameters.push(parsed.text);
        }
        if (parsed.sourceId) {
            conditions.push("e.sourceInstanceId = ?");
            parameters.push(parsed.sourceId);
        }
        if (parsed.publishedAfter) {
            conditions.push("r.sourcePublishedAt >= ?");
            parameters.push(parsed.publishedAfter.getTime());
        }
        if (parsed.publishedBefore) {
            conditions.push("r.sourcePublishedAt <= ?");
            parameters.push(parsed.publishedBefore.getTime());
        }
        // Saved View filters (ADR-0009 decision 5): any-of semantics on
        // Story-level labels / active Topic membership.
        if (parsed.labelIds.length > 0) {
            conditions.push(
                `EXISTS (SELECT 1 FROM LabelAssignment la WHERE la.targetType = 'story' AND la.targetId = e.storyId AND la.labelId IN (${parsed.labelIds.map(() => "?").join(", ")}))`,
            );
            parameters.push(...parsed.labelIds);
        }
        if (parsed.topicIds.length > 0) {
            conditions.push(
                `EXISTS (SELECT 1 FROM TopicMembership tm JOIN TopicMembershipRevision tmr ON tmr.id = tm.currentRevisionId WHERE tm.storyId = e.storyId AND tmr.tombstone = 0 AND tm.topicId IN (${parsed.topicIds.map(() => "?").join(", ")}))`,
            );
            parameters.push(...parsed.topicIds);
        }
        const fromClause = parsed.text
            ? "FROM entry_search JOIN Entry e ON e.id = entry_search.entry_id"
            : "FROM Entry e";
        const rankSelect = parsed.text ? "bm25(entry_search)" : "0.0";
        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(" AND ")}`
            : "";
        const orderClause = parsed.text
            ? "ORDER BY rank ASC, e.updatedAt DESC"
            : "ORDER BY e.updatedAt DESC";
        parameters.push(parsed.limit + 1, parsed.cursor);
        const rows = await this.prisma.$queryRawUnsafe<Array<{
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
            rank: number;
        }>>(
            `
                SELECT
                    e.id AS entryId,
                    e.storyId AS storyId,
                    story.kind AS storyKind,
                    r.title AS title,
                    r.summary AS summary,
                    s.id AS sourceId,
                    s.name AS sourceName,
                    s.kind AS sourceKind,
                    r.id AS revisionId,
                    r.sourcePublishedAt AS publishedAt,
                    ${rankSelect} AS rank
                ${fromClause}
                JOIN EntryRevision r ON r.id = e.currentRevisionId
                JOIN SourceInstance s ON s.id = e.sourceInstanceId
                JOIN Story story ON story.id = e.storyId
                ${whereClause}
                ${orderClause}
                LIMIT ? OFFSET ?
            `,
            ...parameters,
        );
        const hasNext = rows.length > parsed.limit;
        const items = await Promise.all(
            rows.slice(0, parsed.limit).map(async (row) => ({
                ...this.toFeedItemFromSearchRow(row),
                assets: await this.assetsForRevision(row.revisionId),
                rank: row.rank,
            })),
        );

        return {
            items,
            nextCursor: hasNext ? String(parsed.cursor + parsed.limit) : null,
        };
    }

    async entries(input: {
        sourceId?: string;
        cursor?: string;
        limit: number;
    }): Promise<EntryPage> {
        const offset = parseCursor(input.cursor);
        const entries = await this.prisma.entry.findMany({
            where: {
                currentRevisionId: { not: null },
                sourceInstanceId: input.sourceId,
            },
            orderBy: { updatedAt: "desc" },
            skip: offset,
            take: input.limit + 1,
            include: {
                sourceInstance: true,
                currentRevision: {
                    include: { assets: true },
                },
                _count: {
                    select: {
                        observations: true,
                        revisions: true,
                    },
                },
            },
        });
        const hasNext = entries.length > input.limit;
        const items = entries.slice(0, input.limit).flatMap((entry) => {
            if (!entry.currentRevision) {
                return [];
            }
            return [{
                id: entry.id,
                sourceId: entry.sourceInstance.id,
                sourceName: entry.sourceInstance.name,
                sourceKind: sourceKindSchema.parse(entry.sourceInstance.kind),
                storyId: entry.storyId,
                currentRevisionId: entry.currentRevision.id,
                title: entry.currentRevision.title,
                summary: entry.currentRevision.summary,
                webUrl: entry.currentRevision.webUrl,
                contentKind: contentKindSchema.parse(entry.currentRevision.contentKind),
                publisher: parseJson<Publisher>(entry.currentRevision.publisherJson),
                metrics: parseJson<ContentMetrics>(entry.metricsJson),
                publishedAt: entry.currentRevision.sourcePublishedAt?.toISOString() ?? null,
                updatedAt: entry.updatedAt.toISOString(),
                revisionCount: entry._count.revisions,
                observationCount: entry._count.observations,
                assets: entry.currentRevision.assets.map((asset) => this.toAssetSnapshot(asset)),
            }];
        });

        return {
            items,
            nextCursor: hasNext ? String(offset + input.limit) : null,
        };
    }

    private async resolveCanonicalStoryId(storyId: string): Promise<string | null> {
        const alias = await this.prisma.storyAlias.findUnique({
            where: { id: storyId },
            select: { canonicalStoryId: true },
        });
        if (alias) {
            return alias.canonicalStoryId;
        }
        const story = await this.prisma.story.findUnique({
            where: { id: storyId },
            select: { id: true },
        });
        return story?.id ?? null;
    }

    async moveEntryToStory(input: {
        entryId: string;
        storyId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        const entry = await this.prisma.entry.findUnique({
            where: { id: input.entryId },
            select: { id: true, storyId: true },
        });
        if (!entry) {
            return null;
        }
        if (entry.storyId === canonicalStoryId) {
            return this.story(canonicalStoryId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.entry.update({
                where: { id: entry.id },
                data: { storyId: canonicalStoryId },
            });
            await appendDomainEvent(tx, {
                type: "story.entry_moved.v1",
                aggregateType: "Story",
                aggregateId: canonicalStoryId,
                payload: {
                    entryId: entry.id,
                    fromStoryId: entry.storyId ?? null,
                    toStoryId: canonicalStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.story(canonicalStoryId);
    }

    async updateStoryRevision(input: {
        storyId: string;
        baseRevisionId: string;
        title: string;
        summary: string | null;
        kind: "event" | "document" | "media" | "thread";
        subtype: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        const story = await this.prisma.story.findUnique({
            where: { id: canonicalStoryId },
            include: { currentRevision: true },
        });
        if (!story) {
            throw new StoryNotFoundError(input.storyId);
        }
        if (!story.currentRevision || story.currentRevision.id !== input.baseRevisionId) {
            throw new StoryRevisionConflictError(input.storyId);
        }
        const fingerprint = fingerprintStoryRevision({
            title: input.title,
            summary: input.summary,
            kind: input.kind,
            subtype: input.subtype,
        });
        if (story.currentRevision.fingerprint === fingerprint) {
            return this.story(canonicalStoryId);
        }
        await this.prisma.$transaction(async (tx) => {
            const latest = await tx.storyRevision.findFirst({
                where: { storyId: canonicalStoryId },
                orderBy: { revision: "desc" },
                select: { revision: true },
            });
            const created = await tx.storyRevision.create({
                data: {
                    story: { connect: { id: canonicalStoryId } },
                    revision: (latest?.revision ?? 0) + 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    title: input.title,
                    summary: input.summary,
                },
            });
            await tx.story.update({
                where: { id: canonicalStoryId },
                data: { currentRevisionId: created.id },
            });
            await appendDomainEvent(tx, {
                type: "story.revision_created.v1",
                aggregateType: "Story",
                aggregateId: canonicalStoryId,
                payload: {
                    storyId: canonicalStoryId,
                    baseRevisionId: input.baseRevisionId,
                    revision: created.revision,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.story(canonicalStoryId);
    }

    async mergeStories(input: {
        canonicalStoryId: string;
        obsoleteStoryIds: readonly string[];
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.canonicalStoryId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.canonicalStoryId);
        }
        const obsoleteStoryIds = [...new Set(input.obsoleteStoryIds)];
        if (obsoleteStoryIds.includes(canonicalStoryId)) {
            throw new StoryMergeConflictError(`Cannot merge Story into itself: ${canonicalStoryId}`);
        }
        for (const obsoleteStoryId of obsoleteStoryIds) {
            const resolvedObsolete = await this.resolveCanonicalStoryId(obsoleteStoryId);
            if (!resolvedObsolete) {
                throw new StoryNotFoundError(obsoleteStoryId);
            }
            if (resolvedObsolete !== obsoleteStoryId) {
                throw new StoryMergeConflictError(`Story is already merged: ${obsoleteStoryId}`);
            }
        }
        await this.prisma.$transaction(async (tx) => {
            for (const obsoleteStoryId of obsoleteStoryIds) {
                await tx.entry.updateMany({
                    where: { storyId: obsoleteStoryId },
                    data: { storyId: canonicalStoryId },
                });
                // Topic memberships point at a Story id; a merged-away Story must
                // not leave duplicate memberships behind on its alias id. Migrate
                // them to the canonical Story, collapsing to one per (topic, story)
                // (ADR-0007 decision 4).
                const obsoleteMemberships = await tx.topicMembership.findMany({
                    where: { storyId: obsoleteStoryId },
                });
                for (const membership of obsoleteMemberships) {
                    const existing = await tx.topicMembership.findUnique({
                        where: {
                            topicId_storyId: {
                                topicId: membership.topicId,
                                storyId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.topicMembership.update({
                            where: { id: membership.id },
                            data: { storyId: canonicalStoryId },
                        });
                    } else {
                        await tx.topicMembership.delete({
                            where: { id: membership.id },
                        });
                        await appendDomainEvent(tx, {
                            type: "topic.membership_merged.v1",
                            aggregateType: "Topic",
                            aggregateId: membership.topicId,
                            payload: {
                                topicId: membership.topicId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                // Story↔Entity links point at the same Story id space and must
                // follow the merge to the canonical Story, collapsing to one per
                // (story, entity) (ADR-0008 decision 3).
                const obsoleteStoryEntities = await tx.storyEntity.findMany({
                    where: { storyId: obsoleteStoryId },
                });
                for (const link of obsoleteStoryEntities) {
                    const existing = await tx.storyEntity.findUnique({
                        where: {
                            storyId_entityId: {
                                storyId: canonicalStoryId,
                                entityId: link.entityId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.storyEntity.update({
                            where: { id: link.id },
                            data: { storyId: canonicalStoryId },
                        });
                    } else {
                        await tx.storyEntity.delete({
                            where: { id: link.id },
                        });
                        await appendDomainEvent(tx, {
                            type: "story_entity.merged.v1",
                            aggregateType: "Entity",
                            aggregateId: link.entityId,
                            payload: {
                                entityId: link.entityId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                // User-organization state keyed by Story id follows the same
                // merge: Collections keep at most one (collection, story) member,
                // a Story favorite collapses to one row, and label assignments
                // move to the canonical Story unless the label is already there
                // (ADR-0009 decisions 3 and the merge symmetric to ADR-0007/0008).
                const obsoleteCollectionItems = await tx.collectionItem.findMany({
                    where: { storyId: obsoleteStoryId },
                });
                for (const item of obsoleteCollectionItems) {
                    const existing = await tx.collectionItem.findUnique({
                        where: {
                            collectionId_storyId: {
                                collectionId: item.collectionId,
                                storyId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.collectionItem.update({
                            where: { id: item.id },
                            data: { storyId: canonicalStoryId },
                        });
                    } else {
                        await tx.collectionItem.delete({ where: { id: item.id } });
                        await appendDomainEvent(tx, {
                            type: "collection.item_merged.v1",
                            aggregateType: "Collection",
                            aggregateId: item.collectionId,
                            payload: {
                                collectionId: item.collectionId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                const obsoleteFavorites = await tx.favorite.findMany({
                    where: { targetType: "story", targetId: obsoleteStoryId },
                });
                for (const favorite of obsoleteFavorites) {
                    const existing = await tx.favorite.findUnique({
                        where: {
                            targetType_targetId: {
                                targetType: "story",
                                targetId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.favorite.update({
                            where: { id: favorite.id },
                            data: { targetId: canonicalStoryId },
                        });
                    } else {
                        await tx.favorite.delete({ where: { id: favorite.id } });
                        await appendDomainEvent(tx, {
                            type: "favorite.merged.v1",
                            aggregateType: "Story",
                            aggregateId: canonicalStoryId,
                            payload: {
                                targetType: "story",
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                const obsoleteStoryLabels = await tx.labelAssignment.findMany({
                    where: { targetType: "story", targetId: obsoleteStoryId },
                });
                for (const assignment of obsoleteStoryLabels) {
                    const existing = await tx.labelAssignment.findUnique({
                        where: {
                            labelId_targetType_targetId: {
                                labelId: assignment.labelId,
                                targetType: "story",
                                targetId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.labelAssignment.update({
                            where: { id: assignment.id },
                            data: { targetId: canonicalStoryId },
                        });
                    } else {
                        await tx.labelAssignment.delete({ where: { id: assignment.id } });
                        await appendDomainEvent(tx, {
                            type: "label.assignment_merged.v1",
                            aggregateType: "Label",
                            aggregateId: assignment.labelId,
                            payload: {
                                labelId: assignment.labelId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                // Annotations have no per-target uniqueness, so they only need
                // their targetId re-pointed to the canonical Story (ADR-0009).
                const obsoleteStoryAnnotations = await tx.annotation.findMany({
                    where: { targetType: "story", targetId: obsoleteStoryId },
                });
                for (const annotation of obsoleteStoryAnnotations) {
                    await tx.annotation.update({
                        where: { id: annotation.id },
                        data: { targetId: canonicalStoryId },
                    });
                }
                // Spotlight placements are keyed by (board, targetType, targetId):
                // move them to the canonical Story, dropping a placement that
                // would collide on the same board (ADR-0010 decision 3).
                const obsoletePlacements = await tx.spotlightPlacement.findMany({
                    where: { targetType: "story", targetId: obsoleteStoryId },
                });
                for (const placement of obsoletePlacements) {
                    const existing = await tx.spotlightPlacement.findUnique({
                        where: {
                            boardId_targetType_targetId: {
                                boardId: placement.boardId,
                                targetType: "story",
                                targetId: canonicalStoryId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.spotlightPlacement.update({
                            where: { id: placement.id },
                            data: { targetId: canonicalStoryId },
                        });
                    } else {
                        await tx.spotlightPlacement.delete({ where: { id: placement.id } });
                        await appendDomainEvent(tx, {
                            type: "spotlight.placement_merged.v1",
                            aggregateType: "Story",
                            aggregateId: canonicalStoryId,
                            payload: {
                                placementId: placement.id,
                                boardId: placement.boardId,
                                obsoleteStoryId,
                                canonicalStoryId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                await tx.storyAlias.create({
                    data: { id: obsoleteStoryId, canonicalStoryId },
                });
                await appendDomainEvent(tx, {
                    type: "story.merged.v1",
                    aggregateType: "Story",
                    aggregateId: canonicalStoryId,
                    payload: {
                        obsoleteStoryId,
                        canonicalStoryId,
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                    },
                });
            }
        });
        return this.story(canonicalStoryId);
    }

    async story(storyId: string): Promise<StoryDetail | null> {
        const canonicalId = await this.resolveCanonicalStoryId(storyId);
        if (!canonicalId) {
            return null;
        }
        const story = await this.prisma.story.findUnique({
            where: { id: canonicalId },
            include: {
                currentRevision: true,
                storyEntities: {
                    include: {
                        entity: {
                            include: { currentRevision: true },
                        },
                    },
                },
                entries: {
                    orderBy: { updatedAt: "desc" },
                    include: {
                        sourceInstance: true,
                        currentRevision: {
                            include: { assets: true },
                        },
                        revisions: {
                            orderBy: { revision: "desc" },
                            include: { assets: true },
                        },
                        observations: {
                            orderBy: { capturedAt: "desc" },
                        },
                    },
                },
            },
        });
        if (!story || !story.currentRevision || story.entries.length === 0 || !story.entries[0].currentRevision) {
            return null;
        }
        const toEntryDetail = (entry: (typeof story.entries)[number]): EntryDetail => ({
            id: entry.id,
            sourceId: entry.sourceInstance.id,
            sourceName: entry.sourceInstance.name,
            sourceKind: sourceKindSchema.parse(entry.sourceInstance.kind),
            currentRevisionId: entry.currentRevision!.id,
            metrics: parseJson<ContentMetrics>(entry.metricsJson),
            revisions: entry.revisions.map((revision) => ({
                id: revision.id,
                revision: revision.revision,
                title: revision.title,
                summary: revision.summary,
                contentText: revision.contentText,
                webUrl: revision.webUrl,
                contentKind: contentKindSchema.parse(revision.contentKind),
                publisher: parseJson<Publisher>(revision.publisherJson),
                publishedAt: parseJson<TemporalValue>(revision.publishedAtJson)
                    ?? exactTemporalValue(revision.sourcePublishedAt),
                updatedAt: parseJson<TemporalValue>(revision.updatedAtJson),
                sourcePublishedAt: revision.sourcePublishedAt?.toISOString() ?? null,
                createdAt: revision.createdAt.toISOString(),
                assets: revision.assets.map((asset) => this.toAssetSnapshot(asset)),
            })),
            observations: entry.observations.map((observation) => ({
                id: observation.id,
                externalId: observation.externalId,
                externalKey: observation.externalKey,
                eventKind: observation.eventKind as "create" | "update" | "delete" | "snapshot",
                webUrl: observation.webUrl,
                capturedAt: observation.capturedAt.toISOString(),
                sourcePublishedAt: observation.sourcePublishedAt?.toISOString() ?? null,
            })),
        });
        const entries = story.entries
            .filter((entry) => entry.currentRevision !== null)
            .map(toEntryDetail);
        const entities = story.storyEntities
            .filter((link) => link.entity.currentRevision !== null)
            .map((link) => ({
                entityId: link.entityId,
                name: link.entity.currentRevision!.name,
                type: link.entity.currentRevision!.type,
                producer: link.producer,
                producerVersion: link.producerVersion,
                confidence: link.confidence,
                evidence: link.evidence,
                actor: link.actorJson == null ? null : parseJson<string>(link.actorJson),
                reason: link.reason,
            }));
        // User-organization state for this Story: attached labels and the
        // lightweight favorite flag (ADR-0009). Queried separately because
        // LabelAssignment/Favorite carry polymorphic targets, not Story FKs.
        const [labelAssignments, favorite] = await Promise.all([
            this.prisma.labelAssignment.findMany({
                where: { targetType: "story", targetId: canonicalId },
                include: { label: { select: { id: true, name: true } } },
            }),
            this.prisma.favorite.findUnique({
                where: {
                    targetType_targetId: { targetType: "story", targetId: canonicalId },
                },
                select: { id: true },
            }),
        ]);
        return {
            story: {
                id: story.id,
                kind: story.kind as "event" | "document" | "media" | "thread",
                subtype: story.subtype,
                revisionId: story.currentRevision.id,
                title: story.currentRevision.title,
                summary: story.currentRevision.summary,
            },
            entry: entries[0],
            entries,
            entities,
            labels: labelAssignments.map((assignment) => ({
                id: assignment.label.id,
                name: assignment.label.name,
            })),
            favorited: favorite !== null,
        };
    }

    private async resolveCanonicalTopicId(topicId: string): Promise<string | null> {
        const alias = await this.prisma.topicAlias.findUnique({
            where: { id: topicId },
            select: { canonicalTopicId: true },
        });
        if (alias) {
            return alias.canonicalTopicId;
        }
        const topic = await this.prisma.topic.findUnique({
            where: { id: topicId },
            select: { id: true },
        });
        return topic?.id ?? null;
    }

    private async toTopicDetail(topicId: string): Promise<TopicDetail | null> {
        const topic = await this.prisma.topic.findUnique({
            where: { id: topicId },
            include: {
                currentRevision: true,
                memberships: {
                    include: { currentRevision: true },
                },
            },
        });
        if (!topic || !topic.currentRevision) {
            return null;
        }
        const members = topic.memberships
            .filter((membership) => membership.currentRevision !== null)
            .map((membership) => ({
                storyId: membership.storyId,
                role: membership.currentRevision!.role,
                reason: membership.currentRevision!.reason,
                actor: membership.currentRevision!.actorJson == null
                    ? null
                    : parseJson<string>(membership.currentRevision!.actorJson),
                revision: membership.currentRevision!.revision,
                removed: membership.currentRevision!.tombstone,
            }));
        return {
            topic: {
                id: topic.id,
                revisionId: topic.currentRevision.id,
                title: topic.currentRevision.title,
                purpose: topic.currentRevision.purpose,
                scope: topic.currentRevision.scope,
            },
            members,
        };
    }

    private findTopicMembership(
        tx: Prisma.TransactionClient,
        topicId: string,
        storyId: string,
    ) {
        return tx.topicMembership.findUnique({
            where: { topicId_storyId: { topicId, storyId } },
            include: { currentRevision: true },
        });
    }

    private async appendMembershipRevision(
        tx: Prisma.TransactionClient,
        input: {
            membershipId: string;
            role: string;
            reason: string | null;
            actor: string | null;
            tombstone: boolean;
        },
    ): Promise<void> {
        const latest = await tx.topicMembershipRevision.findFirst({
            where: { membershipId: input.membershipId },
            orderBy: { revision: "desc" },
            select: { revision: true },
        });
        const created = await tx.topicMembershipRevision.create({
            data: {
                membershipId: input.membershipId,
                revision: (latest?.revision ?? 0) + 1,
                role: input.role,
                reason: input.reason,
                actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                tombstone: input.tombstone,
            },
        });
        await tx.topicMembership.update({
            where: { id: input.membershipId },
            data: { currentRevisionId: created.id },
        });
    }

    async createTopic(input: {
        title: string;
        purpose: string;
        scope: string | null;
        seedStoryId?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null> {
        let canonicalSeedStoryId: string | null = null;
        if (input.seedStoryId) {
            canonicalSeedStoryId = await this.resolveCanonicalStoryId(input.seedStoryId);
            if (!canonicalSeedStoryId) {
                throw new StoryNotFoundError(input.seedStoryId);
            }
        }
        const fingerprint = fingerprintTopicRevision({
            title: input.title,
            purpose: input.purpose,
            scope: input.scope,
        });
        const topicId = await this.prisma.$transaction(async (tx) => {
            const topic = await tx.topic.create({ data: {} });
            const revision = await tx.topicRevision.create({
                data: {
                    topicId: topic.id,
                    revision: 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    title: input.title,
                    purpose: input.purpose,
                    scope: input.scope,
                },
            });
            await tx.topic.update({
                where: { id: topic.id },
                data: { currentRevisionId: revision.id },
            });
            if (canonicalSeedStoryId) {
                const membership = await tx.topicMembership.create({
                    data: { topicId: topic.id, storyId: canonicalSeedStoryId },
                });
                await this.appendMembershipRevision(tx, {
                    membershipId: membership.id,
                    role: "core",
                    reason: "seed",
                    actor: input.actor ?? null,
                    tombstone: false,
                });
            }
            await appendDomainEvent(tx, {
                type: "topic.created.v1",
                aggregateType: "Topic",
                aggregateId: topic.id,
                payload: {
                    topicId: topic.id,
                    seedStoryId: canonicalSeedStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
            return topic.id;
        });
        return this.toTopicDetail(topicId);
    }

    async updateTopic(input: {
        topicId: string;
        baseRevisionId: string;
        title: string;
        purpose: string;
        scope: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const topic = await this.prisma.topic.findUnique({
            where: { id: canonicalTopicId },
            include: { currentRevision: true },
        });
        if (!topic) {
            throw new TopicNotFoundError(input.topicId);
        }
        if (!topic.currentRevision || topic.currentRevision.id !== input.baseRevisionId) {
            throw new TopicRevisionConflictError(input.topicId);
        }
        const fingerprint = fingerprintTopicRevision({
            title: input.title,
            purpose: input.purpose,
            scope: input.scope,
        });
        if (topic.currentRevision.fingerprint === fingerprint) {
            return this.toTopicDetail(canonicalTopicId);
        }
        await this.prisma.$transaction(async (tx) => {
            const latest = await tx.topicRevision.findFirst({
                where: { topicId: canonicalTopicId },
                orderBy: { revision: "desc" },
                select: { revision: true },
            });
            const created = await tx.topicRevision.create({
                data: {
                    topicId: canonicalTopicId,
                    revision: (latest?.revision ?? 0) + 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    title: input.title,
                    purpose: input.purpose,
                    scope: input.scope,
                },
            });
            await tx.topic.update({
                where: { id: canonicalTopicId },
                data: { currentRevisionId: created.id },
            });
            await appendDomainEvent(tx, {
                type: "topic.revision_created.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    baseRevisionId: input.baseRevisionId,
                    revision: created.revision,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async mergeTopics(input: {
        canonicalTopicId: string;
        obsoleteTopicIds: readonly string[];
        actor?: string | null;
        reason?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.canonicalTopicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.canonicalTopicId);
        }
        const obsoleteTopicIds = [...new Set(input.obsoleteTopicIds)];
        if (obsoleteTopicIds.includes(canonicalTopicId)) {
            throw new TopicMergeConflictError(`Cannot merge Topic into itself: ${canonicalTopicId}`);
        }
        for (const obsoleteTopicId of obsoleteTopicIds) {
            const resolved = await this.resolveCanonicalTopicId(obsoleteTopicId);
            if (!resolved) {
                throw new TopicNotFoundError(obsoleteTopicId);
            }
            if (resolved !== obsoleteTopicId) {
                throw new TopicMergeConflictError(`Topic is already merged: ${obsoleteTopicId}`);
            }
        }
        await this.prisma.$transaction(async (tx) => {
            for (const obsoleteTopicId of obsoleteTopicIds) {
                const obsoleteMemberships = await tx.topicMembership.findMany({
                    where: { topicId: obsoleteTopicId },
                });
                for (const membership of obsoleteMemberships) {
                    const existing = await this.findTopicMembership(
                        tx,
                        canonicalTopicId,
                        membership.storyId,
                    );
                    if (!existing) {
                        await tx.topicMembership.update({
                            where: { id: membership.id },
                            data: { topicId: canonicalTopicId },
                        });
                    } else {
                        await tx.topicMembership.delete({
                            where: { id: membership.id },
                        });
                        await appendDomainEvent(tx, {
                            type: "topic.membership_merged.v1",
                            aggregateType: "Topic",
                            aggregateId: canonicalTopicId,
                            payload: {
                                obsoleteTopicId,
                                canonicalTopicId,
                                storyId: membership.storyId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                // Spotlight placements keyed by Topic id follow the merge and
                // collapse on a same-board collision (ADR-0010 decision 3).
                const obsoletePlacements = await tx.spotlightPlacement.findMany({
                    where: { targetType: "topic", targetId: obsoleteTopicId },
                });
                for (const placement of obsoletePlacements) {
                    const existing = await tx.spotlightPlacement.findUnique({
                        where: {
                            boardId_targetType_targetId: {
                                boardId: placement.boardId,
                                targetType: "topic",
                                targetId: canonicalTopicId,
                            },
                        },
                    });
                    if (!existing) {
                        await tx.spotlightPlacement.update({
                            where: { id: placement.id },
                            data: { targetId: canonicalTopicId },
                        });
                    } else {
                        await tx.spotlightPlacement.delete({ where: { id: placement.id } });
                        await appendDomainEvent(tx, {
                            type: "spotlight.placement_merged.v1",
                            aggregateType: "Topic",
                            aggregateId: canonicalTopicId,
                            payload: {
                                placementId: placement.id,
                                boardId: placement.boardId,
                                obsoleteTopicId,
                                canonicalTopicId,
                                actor: input.actor ?? null,
                                reason: input.reason ?? null,
                            },
                        });
                    }
                }
                await tx.topicAlias.create({
                    data: { id: obsoleteTopicId, canonicalTopicId },
                });
                await appendDomainEvent(tx, {
                    type: "topic.merged.v1",
                    aggregateType: "Topic",
                    aggregateId: canonicalTopicId,
                    payload: {
                        obsoleteTopicId,
                        canonicalTopicId,
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                    },
                });
            }
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async topic(topicId: string): Promise<TopicDetail | null> {
        const canonicalId = await this.resolveCanonicalTopicId(topicId);
        if (!canonicalId) {
            return null;
        }
        return this.toTopicDetail(canonicalId);
    }

    async listTopics(input: {
        cursor?: string;
        limit: number;
    }): Promise<TopicPage> {
        const parsed = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
        const offset = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        const topics = await this.prisma.topic.findMany({
            orderBy: { updatedAt: "desc" },
            skip: offset,
            take: input.limit + 1,
            include: {
                currentRevision: true,
                memberships: { include: { currentRevision: true } },
            },
        });
        const hasNext = topics.length > input.limit;
        const page = hasNext ? topics.slice(0, input.limit) : topics;
        const items: TopicSummary[] = page.map((topic) => ({
            id: topic.id,
            revisionId: topic.currentRevision?.id ?? "",
            title: topic.currentRevision?.title ?? "",
            purpose: topic.currentRevision?.purpose ?? "",
            scope: topic.currentRevision?.scope ?? null,
            memberCount: topic.memberships.filter((membership) => {
                return membership.currentRevision !== null
                    && !membership.currentRevision.tombstone;
            }).length,
            updatedAt: topic.updatedAt.toISOString(),
        }));
        return {
            items,
            nextCursor: hasNext ? String(offset + input.limit) : null,
        };
    }

    async addTopicMember(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const membership = await this.findTopicMembership(
                tx,
                canonicalTopicId,
                canonicalStoryId,
            );
            if (!membership) {
                const created = await tx.topicMembership.create({
                    data: { topicId: canonicalTopicId, storyId: canonicalStoryId },
                });
                await this.appendMembershipRevision(tx, {
                    membershipId: created.id,
                    role: input.role,
                    reason: input.reason ?? null,
                    actor: input.actor ?? null,
                    tombstone: false,
                });
                await appendDomainEvent(tx, {
                    type: "topic.member_added.v1",
                    aggregateType: "Topic",
                    aggregateId: canonicalTopicId,
                    payload: {
                        topicId: canonicalTopicId,
                        storyId: canonicalStoryId,
                        role: input.role,
                        actor: input.actor ?? null,
                        reason: input.reason ?? null,
                    },
                });
                return;
            }
            if (membership.currentRevision && !membership.currentRevision.tombstone) {
                // Already an active member; role changes go through update-role.
                return;
            }
            await this.appendMembershipRevision(tx, {
                membershipId: membership.id,
                role: input.role,
                reason: input.reason ?? null,
                actor: input.actor ?? null,
                tombstone: false,
            });
            await appendDomainEvent(tx, {
                type: "topic.member_added.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    storyId: canonicalStoryId,
                    role: input.role,
                    restored: true,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async updateTopicMemberRole(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const membership = await this.findTopicMembership(
                tx,
                canonicalTopicId,
                canonicalStoryId,
            );
            if (!membership || !membership.currentRevision || membership.currentRevision.tombstone) {
                throw new TopicMembershipNotFoundError(
                    `Topic member not found or removed: ${input.topicId}/${input.storyId}`,
                );
            }
            if (membership.currentRevision.role === input.role) {
                return;
            }
            await this.appendMembershipRevision(tx, {
                membershipId: membership.id,
                role: input.role,
                reason: input.reason ?? null,
                actor: input.actor ?? null,
                tombstone: false,
            });
            await appendDomainEvent(tx, {
                type: "topic.member_role_updated.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    storyId: canonicalStoryId,
                    role: input.role,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async removeTopicMember(input: {
        topicId: string;
        storyId: string;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const membership = await this.findTopicMembership(
                tx,
                canonicalTopicId,
                canonicalStoryId,
            );
            if (!membership || !membership.currentRevision) {
                throw new TopicMembershipNotFoundError(
                    `Topic member not found: ${input.topicId}/${input.storyId}`,
                );
            }
            if (membership.currentRevision.tombstone) {
                return;
            }
            await this.appendMembershipRevision(tx, {
                membershipId: membership.id,
                role: membership.currentRevision.role,
                reason: input.reason ?? null,
                actor: input.actor ?? null,
                tombstone: true,
            });
            await appendDomainEvent(tx, {
                type: "topic.member_removed.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    storyId: canonicalStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async restoreTopicMember(input: {
        topicId: string;
        storyId: string;
        role: TopicMemberRole;
        reason?: string | null;
        actor?: string | null;
    }): Promise<TopicDetail | null> {
        const canonicalTopicId = await this.resolveCanonicalTopicId(input.topicId);
        if (!canonicalTopicId) {
            throw new TopicNotFoundError(input.topicId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const membership = await this.findTopicMembership(
                tx,
                canonicalTopicId,
                canonicalStoryId,
            );
            if (!membership || !membership.currentRevision) {
                throw new TopicMembershipNotFoundError(
                    `Topic member not found: ${input.topicId}/${input.storyId}`,
                );
            }
            if (!membership.currentRevision.tombstone) {
                return;
            }
            await this.appendMembershipRevision(tx, {
                membershipId: membership.id,
                role: input.role,
                reason: input.reason ?? null,
                actor: input.actor ?? null,
                tombstone: false,
            });
            await appendDomainEvent(tx, {
                type: "topic.member_restored.v1",
                aggregateType: "Topic",
                aggregateId: canonicalTopicId,
                payload: {
                    topicId: canonicalTopicId,
                    storyId: canonicalStoryId,
                    role: input.role,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toTopicDetail(canonicalTopicId);
    }

    async createEntity(input: {
        name: string;
        type: EntityType;
        alias?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        if (!(entityTypes as readonly string[]).includes(input.type)) {
            throw new EntityRevisionConflictError(`Unknown entity type: ${input.type}`);
        }
        const aliasName = input.alias?.trim() || null;
        const fingerprint = fingerprintEntityRevision({
            name: input.name,
            type: input.type,
        });
        const entityId = await this.prisma.$transaction(async (tx) => {
            const entity = await tx.entity.create({ data: { type: input.type } });
            const revision = await tx.entityRevision.create({
                data: {
                    entityId: entity.id,
                    revision: 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    name: input.name,
                    type: input.type,
                },
            });
            await tx.entity.update({
                where: { id: entity.id },
                data: { currentRevisionId: revision.id },
            });
            if (aliasName) {
                await tx.entityAlias.create({
                    data: { entityId: entity.id, name: aliasName },
                });
            }
            await appendDomainEvent(tx, {
                type: "entity.created.v1",
                aggregateType: "Entity",
                aggregateId: entity.id,
                payload: {
                    entityId: entity.id,
                    name: input.name,
                    type: input.type,
                    alias: aliasName,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
            return entity.id;
        });
        return this.toEntityDetail(entityId);
    }

    async updateEntity(input: {
        entityId: string;
        baseRevisionId: string;
        name: string;
        type: EntityType;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            include: { currentRevision: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        if (!entity.currentRevision || entity.currentRevision.id !== input.baseRevisionId) {
            throw new EntityRevisionConflictError(input.entityId);
        }
        const fingerprint = fingerprintEntityRevision({
            name: input.name,
            type: input.type,
        });
        if (entity.currentRevision.fingerprint === fingerprint) {
            return this.toEntityDetail(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const latest = await tx.entityRevision.findFirst({
                where: { entityId: input.entityId },
                orderBy: { revision: "desc" },
                select: { revision: true },
            });
            const created = await tx.entityRevision.create({
                data: {
                    entityId: input.entityId,
                    revision: (latest?.revision ?? 0) + 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    name: input.name,
                    type: input.type,
                },
            });
            await tx.entity.update({
                where: { id: input.entityId },
                data: { currentRevisionId: created.id },
            });
            await appendDomainEvent(tx, {
                type: "entity.revision_created.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    baseRevisionId: input.baseRevisionId,
                    revision: created.revision,
                    name: input.name,
                    type: input.type,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async addEntityAlias(input: {
        entityId: string;
        name: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entityAlias.findUnique({
                where: { entityId_name: { entityId: input.entityId, name: input.name } },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            await tx.entityAlias.create({
                data: { entityId: input.entityId, name: input.name },
            });
            await appendDomainEvent(tx, {
                type: "entity.alias_added.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    name: input.name,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async removeEntityAlias(input: {
        entityId: string;
        name: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entityAlias.findUnique({
                where: { entityId_name: { entityId: input.entityId, name: input.name } },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.entityAlias.delete({
                where: { id: existing.id },
            });
            await appendDomainEvent(tx, {
                type: "entity.alias_removed.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    name: input.name,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async linkStoryEntity(input: {
        storyId: string;
        entityId: string;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.storyEntity.findUnique({
                where: {
                    storyId_entityId: {
                        storyId: canonicalStoryId,
                        entityId: input.entityId,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            const producer = input.producer?.trim() || "human";
            await tx.storyEntity.create({
                data: {
                    storyId: canonicalStoryId,
                    entityId: input.entityId,
                    producer,
                    producerVersion: input.producerVersion ?? null,
                    confidence: input.confidence ?? 1,
                    evidence: input.evidence ?? null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                },
            });
            await appendDomainEvent(tx, {
                type: "entity.story_linked.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    storyId: canonicalStoryId,
                    producer,
                    confidence: input.confidence ?? 1,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async unlinkStoryEntity(input: {
        storyId: string;
        entityId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.storyEntity.findUnique({
                where: {
                    storyId_entityId: {
                        storyId: canonicalStoryId,
                        entityId: input.entityId,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.storyEntity.delete({
                where: { id: existing.id },
            });
            await appendDomainEvent(tx, {
                type: "entity.story_unlinked.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    storyId: canonicalStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async createEntityRelation(input: {
        fromEntityId: string;
        toEntityId: string;
        relationType: EntityRelationType;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        if (!(entityRelationTypes as readonly string[]).includes(input.relationType)) {
            throw new EntityRelationConflictError(`Unknown relation type: ${input.relationType}`);
        }
        if (input.fromEntityId === input.toEntityId) {
            throw new EntityRelationConflictError(
                `Entity relation must be between distinct entities: ${input.fromEntityId}`,
            );
        }
        const entities = await this.prisma.entity.findMany({
            where: { id: { in: [input.fromEntityId, input.toEntityId] } },
            select: { id: true },
        });
        if (entities.length !== 2) {
            const found = new Set(entities.map((entity) => entity.id));
            const missing = [input.fromEntityId, input.toEntityId]
                .find((id) => !found.has(id))!;
            throw new EntityNotFoundError(missing);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entityRelation.findUnique({
                where: {
                    fromEntityId_toEntityId_relationType: {
                        fromEntityId: input.fromEntityId,
                        toEntityId: input.toEntityId,
                        relationType: input.relationType,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            const producer = input.producer?.trim() || "human";
            await tx.entityRelation.create({
                data: {
                    fromEntityId: input.fromEntityId,
                    toEntityId: input.toEntityId,
                    relationType: input.relationType,
                    producer,
                    producerVersion: input.producerVersion ?? null,
                    confidence: input.confidence ?? 1,
                    evidence: input.evidence ?? null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                },
            });
            await appendDomainEvent(tx, {
                type: "entity.relation_created.v1",
                aggregateType: "Entity",
                aggregateId: input.fromEntityId,
                payload: {
                    fromEntityId: input.fromEntityId,
                    toEntityId: input.toEntityId,
                    relationType: input.relationType,
                    producer,
                    confidence: input.confidence ?? 1,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.fromEntityId);
    }

    async removeEntityRelation(input: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.fromEntityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.fromEntityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entityRelation.findUnique({
                where: {
                    fromEntityId_toEntityId_relationType: {
                        fromEntityId: input.fromEntityId,
                        toEntityId: input.toEntityId,
                        relationType: input.relationType,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.entityRelation.delete({
                where: { id: existing.id },
            });
            await appendDomainEvent(tx, {
                type: "entity.relation_removed.v1",
                aggregateType: "Entity",
                aggregateId: input.fromEntityId,
                payload: {
                    fromEntityId: input.fromEntityId,
                    toEntityId: input.toEntityId,
                    relationType: input.relationType,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.fromEntityId);
    }

    async entity(entityId: string): Promise<EntityDetail | null> {
        return this.toEntityDetail(entityId);
    }

    async listEntities(input: {
        cursor?: string;
        limit: number;
    }): Promise<EntityPage> {
        const parsed = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
        const offset = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        const entities = await this.prisma.entity.findMany({
            orderBy: { updatedAt: "desc" },
            skip: offset,
            take: input.limit + 1,
            include: {
                currentRevision: true,
                storyLinks: { select: { id: true } },
                fromRelations: { select: { id: true } },
                toRelations: { select: { id: true } },
            },
        });
        const hasNext = entities.length > input.limit;
        const page = hasNext ? entities.slice(0, input.limit) : entities;
        const items: EntityPage["items"] = page.map((entity) => ({
            id: entity.id,
            revisionId: entity.currentRevision?.id ?? "",
            type: entity.currentRevision?.type ?? "",
            name: entity.currentRevision?.name ?? "",
            storyCount: entity.storyLinks.length,
            relationCount: entity.fromRelations.length + entity.toRelations.length,
            updatedAt: entity.updatedAt.toISOString(),
        }));
        return {
            items,
            nextCursor: hasNext ? String(offset + input.limit) : null,
        };
    }

    private async toEntityDetail(entityId: string): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: entityId },
            include: {
                currentRevision: true,
                aliases: {
                    orderBy: { name: "asc" },
                },
                storyLinks: true,
                fromRelations: true,
                toRelations: true,
            },
        });
        if (!entity || !entity.currentRevision) {
            return null;
        }
        const relations = [
            ...entity.fromRelations.map((relation) => ({
                fromEntityId: relation.fromEntityId,
                relationType: relation.relationType,
                toEntityId: relation.toEntityId,
                producer: relation.producer,
                producerVersion: relation.producerVersion,
                confidence: relation.confidence,
                evidence: relation.evidence,
                actor: relation.actorJson == null ? null : parseJson<string>(relation.actorJson),
                reason: relation.reason,
            })),
            ...entity.toRelations.map((relation) => ({
                fromEntityId: relation.fromEntityId,
                relationType: relation.relationType,
                toEntityId: relation.toEntityId,
                producer: relation.producer,
                producerVersion: relation.producerVersion,
                confidence: relation.confidence,
                evidence: relation.evidence,
                actor: relation.actorJson == null ? null : parseJson<string>(relation.actorJson),
                reason: relation.reason,
            })),
        ];
        return {
            entity: {
                id: entity.id,
                revisionId: entity.currentRevision.id,
                type: entity.currentRevision.type,
                name: entity.currentRevision.name,
            },
            aliases: entity.aliases.map((alias) => alias.name),
            stories: entity.storyLinks.map((link) => ({
                storyId: link.storyId,
                producer: link.producer,
                producerVersion: link.producerVersion,
                confidence: link.confidence,
                evidence: link.evidence,
                actor: link.actorJson == null ? null : parseJson<string>(link.actorJson),
                reason: link.reason,
            })),
            relations,
        };
    }

    // ---------------------------------------------------------------------
    // User organization v1 (ADR-0009): Label + Collection + Favorite
    // ---------------------------------------------------------------------

    async createLabel(input: { name: string }): Promise<LabelItem> {
        const name = input.name.trim();
        const label = await this.prisma.$transaction(async (tx) => {
            try {
                const created = await tx.label.create({ data: { name } });
                await appendDomainEvent(tx, {
                    type: "label.created.v1",
                    aggregateType: "Label",
                    aggregateId: created.id,
                    payload: { labelId: created.id, name },
                });
                return created;
            } catch (error) {
                if (isUniqueConstraintError(error)) {
                    throw new LabelConflictError(`Label already exists: ${name}`);
                }
                throw error;
            }
        });
        return {
            id: label.id,
            name: label.name,
            assignedCount: 0,
            createdAt: label.createdAt.toISOString(),
            updatedAt: label.updatedAt.toISOString(),
        };
    }

    async listLabels(): Promise<LabelList> {
        const rows = await this.prisma.label.findMany({
            orderBy: { name: "asc" },
            include: {
                _count: { select: { assignments: true } },
            },
        });
        return {
            items: rows.map((label) => ({
                id: label.id,
                name: label.name,
                assignedCount: label._count.assignments,
                createdAt: label.createdAt.toISOString(),
                updatedAt: label.updatedAt.toISOString(),
            })),
        };
    }

    async label(labelId: string): Promise<LabelDetail | null> {
        const label = await this.prisma.label.findUnique({
            where: { id: labelId },
        });
        if (!label) {
            return null;
        }
        const assignments = await this.prisma.labelAssignment.findMany({
            where: { labelId },
            orderBy: { createdAt: "asc" },
        });
        const group = (type: string) => assignments
            .filter((assignment) => assignment.targetType === type)
            .map((assignment) => assignment.targetId);
        const [storyIds, entryIds, topicIds] = [
            group("story"),
            group("entry"),
            group("topic"),
        ];
        const [stories, entries, topics] = await Promise.all([
            this.prisma.story.findMany({
                where: { id: { in: storyIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
            this.prisma.entry.findMany({
                where: { id: { in: entryIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
            this.prisma.topic.findMany({
                where: { id: { in: topicIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
        ]);
        const storyTitles = new Map(stories.map((story) => [story.id, story.currentRevision?.title ?? ""]));
        const entryTitles = new Map(entries.map((entry) => [entry.id, entry.currentRevision?.title ?? ""]));
        const topicTitles = new Map(topics.map((topic) => [topic.id, topic.currentRevision?.title ?? ""]));
        return {
            id: label.id,
            name: label.name,
            createdAt: label.createdAt.toISOString(),
            updatedAt: label.updatedAt.toISOString(),
            assignedStories: storyIds.map((id) => ({ id, title: storyTitles.get(id) ?? "" })),
            assignedEntries: entryIds.map((id) => ({ id, title: entryTitles.get(id) ?? "" })),
            assignedTopics: topicIds.map((id) => ({ id, title: topicTitles.get(id) ?? "" })),
        };
    }

    async deleteLabel(labelId: string): Promise<void> {
        const label = await this.prisma.label.findUnique({
            where: { id: labelId },
            select: { id: true },
        });
        if (!label) {
            throw new LabelNotFoundError(labelId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.label.delete({ where: { id: labelId } });
            await appendDomainEvent(tx, {
                type: "label.deleted.v1",
                aggregateType: "Label",
                aggregateId: labelId,
                payload: { labelId },
            });
        });
    }

    async attachLabel(input: {
        labelId: string;
        targetType: TargetType;
        targetId: string;
    }): Promise<void> {
        const label = await this.prisma.label.findUnique({
            where: { id: input.labelId },
            select: { id: true },
        });
        if (!label) {
            throw new LabelNotFoundError(input.labelId);
        }
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.labelAssignment.findUnique({
                where: {
                    labelId_targetType_targetId: {
                        labelId: input.labelId,
                        targetType: input.targetType,
                        targetId,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            await tx.labelAssignment.create({
                data: {
                    labelId: input.labelId,
                    targetType: input.targetType,
                    targetId,
                },
            });
            await appendDomainEvent(tx, {
                type: "label.assigned.v1",
                aggregateType: "Label",
                aggregateId: input.labelId,
                payload: {
                    labelId: input.labelId,
                    targetType: input.targetType,
                    targetId,
                },
            });
        });
    }

    async detachLabel(input: {
        labelId: string;
        targetType: TargetType;
        targetId: string;
    }): Promise<void> {
        const label = await this.prisma.label.findUnique({
            where: { id: input.labelId },
            select: { id: true },
        });
        if (!label) {
            throw new LabelNotFoundError(input.labelId);
        }
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.labelAssignment.findUnique({
                where: {
                    labelId_targetType_targetId: {
                        labelId: input.labelId,
                        targetType: input.targetType,
                        targetId,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.labelAssignment.delete({ where: { id: existing.id } });
            await appendDomainEvent(tx, {
                type: "label.unassigned.v1",
                aggregateType: "Label",
                aggregateId: input.labelId,
                payload: {
                    labelId: input.labelId,
                    targetType: input.targetType,
                    targetId,
                },
            });
        });
    }

    async createCollection(input: {
        name: string;
        description?: string | null;
    }): Promise<CollectionSummary> {
        const name = input.name.trim();
        const description = input.description?.trim() || null;
        const collection = await this.prisma.$transaction(async (tx) => {
            const created = await tx.collection.create({
                data: { name, description },
            });
            await appendDomainEvent(tx, {
                type: "collection.created.v1",
                aggregateType: "Collection",
                aggregateId: created.id,
                payload: { collectionId: created.id, name, description },
            });
            return created;
        });
        return {
            id: collection.id,
            name: collection.name,
            description: collection.description,
            itemCount: 0,
            createdAt: collection.createdAt.toISOString(),
            updatedAt: collection.updatedAt.toISOString(),
        };
    }

    async updateCollection(input: {
        collectionId: string;
        name: string;
        description?: string | null;
    }): Promise<CollectionSummary> {
        const existing = await this.prisma.collection.findUnique({
            where: { id: input.collectionId },
            select: { id: true },
        });
        if (!existing) {
            throw new CollectionNotFoundError(input.collectionId);
        }
        const name = input.name.trim();
        const description = input.description?.trim() || null;
        await this.prisma.$transaction(async (tx) => {
            await tx.collection.update({
                where: { id: input.collectionId },
                data: { name, description },
            });
            await appendDomainEvent(tx, {
                type: "collection.updated.v1",
                aggregateType: "Collection",
                aggregateId: input.collectionId,
                payload: { collectionId: input.collectionId, name, description },
            });
        });
        const summary = await this.loadCollectionSummary(input.collectionId);
        if (!summary) {
            throw new CollectionNotFoundError(input.collectionId);
        }
        return summary;
    }

    async deleteCollection(collectionId: string): Promise<void> {
        const collection = await this.prisma.collection.findUnique({
            where: { id: collectionId },
            select: { id: true },
        });
        if (!collection) {
            throw new CollectionNotFoundError(collectionId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.collection.delete({ where: { id: collectionId } });
            await appendDomainEvent(tx, {
                type: "collection.deleted.v1",
                aggregateType: "Collection",
                aggregateId: collectionId,
                payload: { collectionId },
            });
        });
    }

    async listCollections(input: { storyId?: string } = {}): Promise<CollectionList> {
        let memberCollectionIds: Set<string> | null = null;
        if (input.storyId) {
            const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
            if (!canonicalStoryId) {
                throw new StoryNotFoundError(input.storyId);
            }
            const memberships = await this.prisma.collectionItem.findMany({
                where: { storyId: canonicalStoryId },
                select: { collectionId: true },
            });
            memberCollectionIds = new Set(memberships.map((membership) => membership.collectionId));
        }
        const rows = await this.prisma.collection.findMany({
            orderBy: { createdAt: "asc" },
            include: {
                _count: { select: { items: true } },
            },
        });
        return {
            items: rows.map((collection) => ({
                id: collection.id,
                name: collection.name,
                description: collection.description,
                itemCount: collection._count.items,
                ...(memberCollectionIds === null
                    ? {}
                    : { containsStory: memberCollectionIds.has(collection.id) }),
                createdAt: collection.createdAt.toISOString(),
                updatedAt: collection.updatedAt.toISOString(),
            })),
        };
    }

    async collection(collectionId: string): Promise<CollectionDetail | null> {
        const collection = await this.prisma.collection.findUnique({
            where: { id: collectionId },
        });
        if (!collection) {
            return null;
        }
        const items = await this.prisma.collectionItem.findMany({
            where: { collectionId },
            orderBy: { createdAt: "asc" },
            include: {
                story: {
                    include: { currentRevision: { select: { title: true } } },
                },
            },
        });
        return {
            id: collection.id,
            name: collection.name,
            description: collection.description,
            createdAt: collection.createdAt.toISOString(),
            updatedAt: collection.updatedAt.toISOString(),
            stories: items.map((item) => ({
                storyId: item.storyId,
                title: item.story.currentRevision?.title ?? "",
                addedAt: item.createdAt.toISOString(),
            })),
        };
    }

    async addCollectionItem(input: {
        collectionId: string;
        storyId: string;
    }): Promise<void> {
        const collection = await this.prisma.collection.findUnique({
            where: { id: input.collectionId },
            select: { id: true },
        });
        if (!collection) {
            throw new CollectionNotFoundError(input.collectionId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.collectionItem.findUnique({
                where: {
                    collectionId_storyId: {
                        collectionId: input.collectionId,
                        storyId: canonicalStoryId,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            await tx.collectionItem.create({
                data: {
                    collectionId: input.collectionId,
                    storyId: canonicalStoryId,
                },
            });
            await appendDomainEvent(tx, {
                type: "collection.item_added.v1",
                aggregateType: "Collection",
                aggregateId: input.collectionId,
                payload: {
                    collectionId: input.collectionId,
                    storyId: canonicalStoryId,
                },
            });
        });
    }

    async removeCollectionItem(input: {
        collectionId: string;
        storyId: string;
    }): Promise<void> {
        const collection = await this.prisma.collection.findUnique({
            where: { id: input.collectionId },
            select: { id: true },
        });
        if (!collection) {
            throw new CollectionNotFoundError(input.collectionId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.collectionItem.findUnique({
                where: {
                    collectionId_storyId: {
                        collectionId: input.collectionId,
                        storyId: canonicalStoryId,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.collectionItem.delete({ where: { id: existing.id } });
            await appendDomainEvent(tx, {
                type: "collection.item_removed.v1",
                aggregateType: "Collection",
                aggregateId: input.collectionId,
                payload: {
                    collectionId: input.collectionId,
                    storyId: canonicalStoryId,
                },
            });
        });
    }

    async setFavorite(input: {
        targetType: FavoriteTargetType;
        targetId: string;
    }): Promise<void> {
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.favorite.findUnique({
                where: {
                    targetType_targetId: {
                        targetType: input.targetType,
                        targetId,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            await tx.favorite.create({
                data: {
                    targetType: input.targetType,
                    targetId,
                },
            });
            await appendDomainEvent(tx, {
                type: "favorite.set.v1",
                aggregateType: input.targetType === "entry" ? "Entry" : "Story",
                aggregateId: targetId,
                payload: {
                    targetType: input.targetType,
                    targetId,
                },
            });
        });
    }

    async unsetFavorite(input: {
        targetType: FavoriteTargetType;
        targetId: string;
    }): Promise<void> {
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.favorite.findUnique({
                where: {
                    targetType_targetId: {
                        targetType: input.targetType,
                        targetId,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.favorite.delete({ where: { id: existing.id } });
            await appendDomainEvent(tx, {
                type: "favorite.unset.v1",
                aggregateType: input.targetType === "entry" ? "Entry" : "Story",
                aggregateId: targetId,
                payload: {
                    targetType: input.targetType,
                    targetId,
                },
            });
        });
    }

    async listFavorites(): Promise<FavoriteList> {
        const rows = await this.prisma.favorite.findMany({
            orderBy: { createdAt: "desc" },
        });
        return {
            items: rows.map((favorite) => ({
                targetType: favorite.targetType as "story" | "entry",
                targetId: favorite.targetId,
                createdAt: favorite.createdAt.toISOString(),
            })),
        };
    }

    async createAnnotation(input: {
        targetType: TargetType;
        targetId: string;
        body: string;
        quote?: string | null;
        evidence?: string | null;
        actor?: string | null;
    }): Promise<Annotation> {
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        // An annotation captures the target revision it was written against, so
        // a later target update does not silently re-point the note (ADR-0009
        // decision 4). Story targets use their current StoryRevision.
        const targetRevisionId = input.targetType === "story"
            ? (await this.prisma.story.findUnique({
                where: { id: targetId },
                select: { currentRevisionId: true },
            }))?.currentRevisionId ?? null
            : null;
        const annotation = await this.prisma.$transaction(async (tx) => {
            const created = await tx.annotation.create({
                data: {
                    targetType: input.targetType,
                    targetId,
                    targetRevisionId,
                    quote: input.quote?.trim() || null,
                    body: input.body,
                    evidence: input.evidence?.trim() || null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                },
            });
            await appendDomainEvent(tx, {
                type: "annotation.created.v1",
                aggregateType: "Annotation",
                aggregateId: created.id,
                payload: {
                    annotationId: created.id,
                    targetType: input.targetType,
                    targetId,
                    targetRevisionId,
                },
            });
            return created;
        });
        return this.toAnnotation(annotation);
    }

    async updateAnnotation(input: {
        annotationId: string;
        body: string;
        quote?: string | null;
        evidence?: string | null;
        actor?: string | null;
    }): Promise<Annotation | null> {
        const existing = await this.prisma.annotation.findUnique({
            where: { id: input.annotationId },
        });
        if (!existing) {
            throw new AnnotationNotFoundError(input.annotationId);
        }
        const annotation = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.annotation.update({
                where: { id: input.annotationId },
                data: {
                    body: input.body,
                    quote: input.quote?.trim() || null,
                    evidence: input.evidence?.trim() || null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                },
            });
            await appendDomainEvent(tx, {
                type: "annotation.updated.v1",
                aggregateType: "Annotation",
                aggregateId: input.annotationId,
                payload: {
                    annotationId: input.annotationId,
                    targetType: existing.targetType,
                    targetId: existing.targetId,
                },
            });
            return updated;
        });
        return this.toAnnotation(annotation);
    }

    async deleteAnnotation(annotationId: string): Promise<void> {
        const existing = await this.prisma.annotation.findUnique({
            where: { id: annotationId },
            select: { id: true, targetType: true, targetId: true },
        });
        if (!existing) {
            throw new AnnotationNotFoundError(annotationId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.annotation.delete({ where: { id: annotationId } });
            await appendDomainEvent(tx, {
                type: "annotation.deleted.v1",
                aggregateType: "Annotation",
                aggregateId: annotationId,
                payload: {
                    annotationId,
                    targetType: existing.targetType,
                    targetId: existing.targetId,
                },
            });
        });
    }

    async listAnnotations(input: {
        targetType: TargetType;
        targetId: string;
    }): Promise<AnnotationList> {
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        const rows = await this.prisma.annotation.findMany({
            where: { targetType: input.targetType, targetId },
            orderBy: { createdAt: "asc" },
        });
        return { items: rows.map((row) => this.toAnnotation(row)) };
    }

    private toAnnotation(row: {
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

    async createSavedView(input: {
        name: string;
        conditions: {
            text?: string | null;
            sourceId?: string | null;
            publishedAfter?: string | null;
            publishedBefore?: string | null;
            labelIds?: readonly string[] | null;
            topicIds?: readonly string[] | null;
        };
    }): Promise<SavedView> {
        const data = savedViewData(input.name, input.conditions);
        const created = await this.prisma.$transaction(async (tx) => {
            const row = await tx.savedView.create({ data });
            await appendDomainEvent(tx, {
                type: "saved_view.created.v1",
                aggregateType: "SavedView",
                aggregateId: row.id,
                payload: { savedViewId: row.id, name: row.name },
            });
            return row;
        });
        return toSavedView(created);
    }

    async updateSavedView(input: {
        savedViewId: string;
        name: string;
        conditions: {
            text?: string | null;
            sourceId?: string | null;
            publishedAfter?: string | null;
            publishedBefore?: string | null;
            labelIds?: readonly string[] | null;
            topicIds?: readonly string[] | null;
        };
    }): Promise<SavedView | null> {
        const existing = await this.prisma.savedView.findUnique({
            where: { id: input.savedViewId },
            select: { id: true },
        });
        if (!existing) {
            throw new SavedViewNotFoundError(input.savedViewId);
        }
        const data = savedViewData(input.name, input.conditions);
        const updated = await this.prisma.$transaction(async (tx) => {
            const row = await tx.savedView.update({
                where: { id: input.savedViewId },
                data,
            });
            await appendDomainEvent(tx, {
                type: "saved_view.updated.v1",
                aggregateType: "SavedView",
                aggregateId: input.savedViewId,
                payload: { savedViewId: input.savedViewId, name: row.name },
            });
            return row;
        });
        return toSavedView(updated);
    }

    async deleteSavedView(savedViewId: string): Promise<void> {
        const existing = await this.prisma.savedView.findUnique({
            where: { id: savedViewId },
            select: { id: true },
        });
        if (!existing) {
            throw new SavedViewNotFoundError(savedViewId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.savedView.delete({ where: { id: savedViewId } });
            await appendDomainEvent(tx, {
                type: "saved_view.deleted.v1",
                aggregateType: "SavedView",
                aggregateId: savedViewId,
                payload: { savedViewId },
            });
        });
    }

    async listSavedViews(): Promise<SavedViewList> {
        const rows = await this.prisma.savedView.findMany({
            orderBy: { createdAt: "asc" },
        });
        return { items: rows.map((row) => toSavedView(row)) };
    }

    // ------------------------------------------------------------------
    // Configurable dashboard (ADR-0010). Block config is validated against
    // the contracts whitelist at this boundary too: the API already rejects
    // mismatches as 400s, so a ZodError escaping from here means a bug.
    // ------------------------------------------------------------------

    async listBoards(): Promise<BoardList> {
        const boards = await this.prisma.board.findMany({
            orderBy: { createdAt: "asc" },
            include: { _count: { select: { sections: true } } },
        });
        return {
            items: boards.map((board) => ({
                id: board.id,
                name: board.name,
                description: board.description,
                sectionCount: board._count.sections,
                createdAt: board.createdAt.toISOString(),
                updatedAt: board.updatedAt.toISOString(),
            })),
        };
    }

    async getBoard(boardId: string): Promise<BoardDetail | null> {
        return this.loadBoardDetail(boardId);
    }

    async createBoard(input: {
        name: string;
        description?: string | null;
    }): Promise<BoardDetail> {
        const created = await this.prisma.$transaction(async (tx) => {
            const row = await tx.board.create({
                data: { name: input.name, description: input.description ?? null },
            });
            await appendDomainEvent(tx, {
                type: "board.created.v1",
                aggregateType: "Board",
                aggregateId: row.id,
                payload: { boardId: row.id, name: row.name },
            });
            return row;
        }).catch((error) => {
            if (isUniqueConstraintError(error)) {
                throw new BoardNameConflictError(input.name);
            }
            throw error;
        });
        return this.requireBoardDetail(created.id);
    }

    async updateBoard(input: {
        boardId: string;
        name: string;
        description?: string | null;
    }): Promise<BoardDetail> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.board.findUnique({
                where: { id: input.boardId },
                select: { id: true },
            });
            if (!existing) {
                throw new BoardNotFoundError(input.boardId);
            }
            await tx.board.update({
                where: { id: input.boardId },
                data: { name: input.name, description: input.description ?? null },
            });
            await appendDomainEvent(tx, {
                type: "board.updated.v1",
                aggregateType: "Board",
                aggregateId: input.boardId,
                payload: { boardId: input.boardId, name: input.name },
            });
        }).catch((error) => {
            if (isUniqueConstraintError(error)) {
                throw new BoardNameConflictError(input.name);
            }
            throw error;
        });
        return this.requireBoardDetail(input.boardId);
    }

    async deleteBoard(boardId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.board.findUnique({
                where: { id: boardId },
                select: { id: true },
            });
            if (!existing) {
                throw new BoardNotFoundError(boardId);
            }
            // Cascade removes sections and blocks; content objects are not
            // referenced by FK, so nothing user-owned is deleted (ADR-0010).
            await tx.board.delete({ where: { id: boardId } });
            await appendDomainEvent(tx, {
                type: "board.deleted.v1",
                aggregateType: "Board",
                aggregateId: boardId,
                payload: { boardId },
            });
        });
    }

    async createSection(input: {
        boardId: string;
        title: string;
        position?: number | null;
    }): Promise<BoardDetail> {
        await this.prisma.$transaction(async (tx) => {
            const board = await tx.board.findUnique({
                where: { id: input.boardId },
                select: { id: true },
            });
            if (!board) {
                throw new BoardNotFoundError(input.boardId);
            }
            const last = await tx.boardSection.aggregate({
                where: { boardId: input.boardId },
                _max: { position: true },
            });
            const position = input.position ?? (last._max.position ?? -1) + 1;
            await tx.boardSection.updateMany({
                where: { boardId: input.boardId, position: { gte: position } },
                data: { position: { increment: 1 } },
            });
            const row = await tx.boardSection.create({
                data: { boardId: input.boardId, title: input.title, position },
            });
            await appendDomainEvent(tx, {
                type: "board.section.created.v1",
                aggregateType: "BoardSection",
                aggregateId: row.id,
                payload: { boardId: input.boardId, sectionId: row.id, title: row.title },
            });
        });
        return this.requireBoardDetail(input.boardId);
    }

    async updateSection(input: {
        sectionId: string;
        title: string;
        position?: number | null;
    }): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardSection.findUnique({
                where: { id: input.sectionId },
                select: { boardId: true, position: true },
            });
            if (!existing) {
                throw new BoardSectionNotFoundError(input.sectionId);
            }
            if (input.position != null && input.position !== existing.position) {
                // Re-sequence the board in memory and write back only changed
                // rows, same shape as moveBlock.
                const sections = await tx.boardSection.findMany({
                    where: { boardId: existing.boardId },
                    orderBy: { position: "asc" },
                });
                const others = sections.filter((section) => section.id !== input.sectionId);
                const insertAt = Math.min(Math.max(input.position, 0), others.length);
                const positionById = new Map(others.map((section) => [section.id, section.position]));
                const orderedIds = others.map((section) => section.id);
                orderedIds.splice(insertAt, 0, input.sectionId);
                for (const [index, id] of orderedIds.entries()) {
                    if (id === input.sectionId) {
                        await tx.boardSection.update({
                            where: { id },
                            data: { position: index },
                        });
                        continue;
                    }
                    if (positionById.get(id) !== index) {
                        await tx.boardSection.update({
                            where: { id },
                            data: { position: index },
                        });
                    }
                }
            }
            await tx.boardSection.update({
                where: { id: input.sectionId },
                data: { title: input.title },
            });
            await appendDomainEvent(tx, {
                type: "board.section.updated.v1",
                aggregateType: "BoardSection",
                aggregateId: input.sectionId,
                payload: { sectionId: input.sectionId, title: input.title },
            });
            return existing.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async deleteSection(sectionId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardSection.findUnique({
                where: { id: sectionId },
                select: { id: true },
            });
            if (!existing) {
                throw new BoardSectionNotFoundError(sectionId);
            }
            await tx.boardSection.delete({ where: { id: sectionId } });
            await appendDomainEvent(tx, {
                type: "board.section.deleted.v1",
                aggregateType: "BoardSection",
                aggregateId: sectionId,
                payload: { sectionId },
            });
        });
    }

    async createBlock(input: {
        sectionId: string;
        type: BlockType;
        config: Record<string, unknown>;
        position?: number | null;
    }): Promise<BoardDetail> {
        const configJson = stringifyBlockConfig(input.type, input.config);
        const boardId = await this.prisma.$transaction(async (tx) => {
            const section = await tx.boardSection.findUnique({
                where: { id: input.sectionId },
                select: { boardId: true },
            });
            if (!section) {
                throw new BoardSectionNotFoundError(input.sectionId);
            }
            const last = await tx.boardBlock.aggregate({
                where: { sectionId: input.sectionId },
                _max: { position: true },
            });
            const position = input.position ?? (last._max.position ?? -1) + 1;
            await tx.boardBlock.updateMany({
                where: { sectionId: input.sectionId, position: { gte: position } },
                data: { position: { increment: 1 } },
            });
            const row = await tx.boardBlock.create({
                data: {
                    sectionId: input.sectionId,
                    type: input.type,
                    configJson,
                    position,
                },
            });
            await appendDomainEvent(tx, {
                type: "board.block.created.v1",
                aggregateType: "BoardBlock",
                aggregateId: row.id,
                payload: {
                    sectionId: input.sectionId,
                    blockId: row.id,
                    blockType: input.type,
                },
            });
            return section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async updateBlockConfig(input: {
        blockId: string;
        config: Record<string, unknown>;
    }): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardBlock.findUnique({
                where: { id: input.blockId },
                select: { type: true, section: { select: { boardId: true } } },
            });
            if (!existing) {
                throw new BoardBlockNotFoundError(input.blockId);
            }
            const configJson = stringifyBlockConfig(existing.type, input.config);
            await tx.boardBlock.update({
                where: { id: input.blockId },
                data: { configJson },
            });
            await appendDomainEvent(tx, {
                type: "board.block.config_updated.v1",
                aggregateType: "BoardBlock",
                aggregateId: input.blockId,
                payload: { blockId: input.blockId, blockType: existing.type },
            });
            return existing.section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async moveBlock(input: {
        blockId: string;
        sectionId?: string | null;
        position: number;
    }): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardBlock.findUnique({
                where: { id: input.blockId },
                select: { sectionId: true, section: { select: { boardId: true } } },
            });
            if (!existing) {
                throw new BoardBlockNotFoundError(input.blockId);
            }
            const targetSectionId = input.sectionId ?? existing.sectionId;
            if (input.sectionId != null && input.sectionId !== existing.sectionId) {
                const targetSection = await tx.boardSection.findUnique({
                    where: { id: input.sectionId },
                    select: { id: true },
                });
                if (!targetSection) {
                    throw new BoardSectionNotFoundError(input.sectionId);
                }
            }
            // Re-sequence the target section in memory (boards are small) and
            // write back only changed positions.
            const targetBlocks = await tx.boardBlock.findMany({
                where: { sectionId: targetSectionId },
                orderBy: { position: "asc" },
            });
            const others = targetBlocks.filter((block) => block.id !== input.blockId);
            const insertAt = Math.min(Math.max(input.position, 0), others.length);
            const positionById = new Map(others.map((block) => [block.id, block.position]));
            const orderedIds = others.map((block) => block.id);
            orderedIds.splice(insertAt, 0, input.blockId);
            for (const [index, id] of orderedIds.entries()) {
                if (id === input.blockId) {
                    await tx.boardBlock.update({
                        where: { id },
                        data: { sectionId: targetSectionId, position: index },
                    });
                    continue;
                }
                if (positionById.get(id) !== index) {
                    await tx.boardBlock.update({
                        where: { id },
                        data: { position: index },
                    });
                }
            }
            if (existing.sectionId !== targetSectionId) {
                const remaining = await tx.boardBlock.findMany({
                    where: { sectionId: existing.sectionId },
                    orderBy: { position: "asc" },
                });
                for (const [index, block] of remaining.entries()) {
                    if (block.position !== index) {
                        await tx.boardBlock.update({
                            where: { id: block.id },
                            data: { position: index },
                        });
                    }
                }
            }
            await appendDomainEvent(tx, {
                type: "board.block.moved.v1",
                aggregateType: "BoardBlock",
                aggregateId: input.blockId,
                payload: {
                    blockId: input.blockId,
                    sectionId: targetSectionId,
                    position: insertAt,
                },
            });
            return existing.section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async setBlockVisibility(input: {
        blockId: string;
        visible: boolean;
    }): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardBlock.findUnique({
                where: { id: input.blockId },
                select: { section: { select: { boardId: true } } },
            });
            if (!existing) {
                throw new BoardBlockNotFoundError(input.blockId);
            }
            // Hidden ≠ deleted: the row stays so the block can be restored.
            await tx.boardBlock.update({
                where: { id: input.blockId },
                data: { visible: input.visible },
            });
            await appendDomainEvent(tx, {
                type: "board.block.visibility_updated.v1",
                aggregateType: "BoardBlock",
                aggregateId: input.blockId,
                payload: { blockId: input.blockId, visible: input.visible },
            });
            return existing.section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async duplicateBlock(blockId: string): Promise<BoardDetail> {
        const boardId = await this.prisma.$transaction(async (tx) => {
            const original = await tx.boardBlock.findUnique({
                where: { id: blockId },
                select: {
                    position: true,
                    sectionId: true,
                    type: true,
                    configJson: true,
                    section: { select: { boardId: true } },
                },
            });
            if (!original) {
                throw new BoardBlockNotFoundError(blockId);
            }
            // Free the slot right after the original, then copy into it.
            await tx.boardBlock.updateMany({
                where: { sectionId: original.sectionId, position: { gte: original.position + 1 } },
                data: { position: { increment: 1 } },
            });
            const row = await tx.boardBlock.create({
                data: {
                    sectionId: original.sectionId,
                    type: original.type,
                    configJson: original.configJson,
                    position: original.position + 1,
                },
            });
            await appendDomainEvent(tx, {
                type: "board.block.duplicated.v1",
                aggregateType: "BoardBlock",
                aggregateId: row.id,
                payload: {
                    sourceBlockId: blockId,
                    blockId: row.id,
                    blockType: original.type,
                },
            });
            return original.section.boardId;
        });
        return this.requireBoardDetail(boardId);
    }

    async deleteBlock(blockId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.boardBlock.findUnique({
                where: { id: blockId },
                select: { id: true },
            });
            if (!existing) {
                throw new BoardBlockNotFoundError(blockId);
            }
            await tx.boardBlock.delete({ where: { id: blockId } });
            await appendDomainEvent(tx, {
                type: "board.block.deleted.v1",
                aggregateType: "BoardBlock",
                aggregateId: blockId,
                payload: { blockId },
            });
        });
    }

    async listSpotlightPlacements(query: {
        boardId?: string | null;
    } = {}): Promise<SpotlightPlacementList> {
        const rows = await this.prisma.spotlightPlacement.findMany({
            where: query.boardId ? { boardId: query.boardId } : undefined,
            orderBy: { createdAt: "asc" },
        });
        const storyIds = rows
            .filter((row) => row.targetType === "story")
            .map((row) => row.targetId);
        const topicIds = rows
            .filter((row) => row.targetType === "topic")
            .map((row) => row.targetId);
        const [stories, topics] = await Promise.all([
            this.prisma.story.findMany({
                where: { id: { in: storyIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
            this.prisma.topic.findMany({
                where: { id: { in: topicIds } },
                include: { currentRevision: { select: { title: true } } },
            }),
        ]);
        const storyTitles = new Map(
            stories.map((story) => [story.id, story.currentRevision?.title ?? null]),
        );
        const topicTitles = new Map(
            topics.map((topic) => [topic.id, topic.currentRevision?.title ?? null]),
        );
        return {
            items: rows.map((row) => toSpotlightPlacement(row, row.targetType === "story"
                ? storyTitles.get(row.targetId) ?? null
                : row.targetType === "topic"
                    ? topicTitles.get(row.targetId) ?? null
                    : null)),
        };
    }

    async createSpotlightPlacement(input: {
        boardId: string;
        targetType: SpotlightTargetType;
        targetId: string;
        reason?: string | null;
        actor?: string | null;
    }): Promise<SpotlightPlacement> {
        const canonicalTargetId = input.targetType === "story"
            ? await this.resolveCanonicalStoryId(input.targetId)
            : await this.resolveCanonicalTopicId(input.targetId);
        if (!canonicalTargetId) {
            throw input.targetType === "story"
                ? new StoryNotFoundError(input.targetId)
                : new TopicNotFoundError(input.targetId);
        }
        const row = await this.prisma.$transaction(async (tx) => {
            const board = await tx.board.findUnique({
                where: { id: input.boardId },
                select: { id: true },
            });
            if (!board) {
                throw new BoardNotFoundError(input.boardId);
            }
            const existing = await tx.spotlightPlacement.findUnique({
                where: {
                    boardId_targetType_targetId: {
                        boardId: input.boardId,
                        targetType: input.targetType,
                        targetId: canonicalTargetId,
                    },
                },
            });
            // Pinning the same target on the same board is an idempotent no-op.
            if (existing) {
                return existing;
            }
            const created = await tx.spotlightPlacement.create({
                data: {
                    boardId: input.boardId,
                    targetType: input.targetType,
                    targetId: canonicalTargetId,
                    source: "manual",
                    reason: input.reason ?? null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                },
            });
            await appendDomainEvent(tx, {
                type: "spotlight.placement_created.v1",
                aggregateType: "SpotlightPlacement",
                aggregateId: created.id,
                payload: {
                    placementId: created.id,
                    boardId: created.boardId,
                    targetType: created.targetType,
                    targetId: created.targetId,
                },
            });
            return created;
        });
        const targetTitle = await this.loadSpotlightTargetTitle(
            row.targetType,
            row.targetId,
        );
        return toSpotlightPlacement(row, targetTitle);
    }

    async deleteSpotlightPlacement(placementId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.spotlightPlacement.findUnique({
                where: { id: placementId },
                select: { id: true },
            });
            if (!existing) {
                throw new SpotlightPlacementNotFoundError(placementId);
            }
            await tx.spotlightPlacement.delete({ where: { id: placementId } });
            await appendDomainEvent(tx, {
                type: "spotlight.placement_deleted.v1",
                aggregateType: "SpotlightPlacement",
                aggregateId: placementId,
                payload: { placementId },
            });
        });
    }

    private async loadSpotlightTargetTitle(
        targetType: string,
        targetId: string,
    ): Promise<string | null> {
        if (targetType === "story") {
            const story = await this.prisma.story.findUnique({
                where: { id: targetId },
                include: { currentRevision: { select: { title: true } } },
            });
            return story?.currentRevision?.title ?? null;
        }
        if (targetType === "topic") {
            const topic = await this.prisma.topic.findUnique({
                where: { id: targetId },
                include: { currentRevision: { select: { title: true } } },
            });
            return topic?.currentRevision?.title ?? null;
        }
        return null;
    }

    async ensureDefaultBoard(): Promise<BoardDetail> {
        const existing = await this.prisma.board.findFirst({
            orderBy: { createdAt: "asc" },
            select: { id: true },
        });
        if (existing) {
            return this.requireBoardDetail(existing.id);
        }
        const created = await this.prisma.$transaction(async (tx) => {
            const board = await tx.board.create({
                data: {
                    name: "默认看板",
                    description: "预置看板：热点、精华、信息流",
                },
            });
            const hotSection = await tx.boardSection.create({
                data: { boardId: board.id, title: "热点", position: 0 },
            });
            await tx.boardBlock.create({
                data: { sectionId: hotSection.id, type: "spotlight", configJson: "{}", position: 0 },
            });
            const curationSection = await tx.boardSection.create({
                data: { boardId: board.id, title: "精华", position: 1 },
            });
            await tx.boardBlock.create({
                data: { sectionId: curationSection.id, type: "topic-list", configJson: "{}", position: 0 },
            });
            const feedSection = await tx.boardSection.create({
                data: { boardId: board.id, title: "信息流", position: 2 },
            });
            await tx.boardBlock.create({
                data: { sectionId: feedSection.id, type: "feed", configJson: "{}", position: 0 },
            });
            // Source health stays visible after the sidebar moved into blocks:
            // it is operational, not content, so it sits below the feed.
            await tx.boardBlock.create({
                data: { sectionId: feedSection.id, type: "source-health", configJson: "{}", position: 1 },
            });
            await appendDomainEvent(tx, {
                type: "board.seeded.v1",
                aggregateType: "Board",
                aggregateId: board.id,
                payload: { boardId: board.id, name: board.name },
            });
            return board;
        }).catch(async (error) => {
            // Concurrent seed: the unique board name resolves the race; fall
            // back to whichever board won.
            if (isUniqueConstraintError(error)) {
                const winner = await this.prisma.board.findFirst({
                    orderBy: { createdAt: "asc" },
                    select: { id: true },
                });
                if (winner) {
                    return winner;
                }
            }
            throw error;
        });
        return this.requireBoardDetail(created.id);
    }

    private async loadBoardDetail(boardId: string): Promise<BoardDetail | null> {
        const board = await this.prisma.board.findUnique({
            where: { id: boardId },
            include: {
                sections: {
                    orderBy: { position: "asc" },
                    include: {
                        blocks: { orderBy: { position: "asc" } },
                    },
                },
            },
        });
        if (!board) {
            return null;
        }
        return {
            id: board.id,
            name: board.name,
            description: board.description,
            sections: board.sections.map((section) => ({
                id: section.id,
                boardId: section.boardId,
                title: section.title,
                position: section.position,
                blocks: section.blocks.map(toBoardBlock),
                createdAt: section.createdAt.toISOString(),
                updatedAt: section.updatedAt.toISOString(),
            })),
            createdAt: board.createdAt.toISOString(),
            updatedAt: board.updatedAt.toISOString(),
        };
    }

    private async requireBoardDetail(boardId: string): Promise<BoardDetail> {
        const detail = await this.loadBoardDetail(boardId);
        if (!detail) {
            throw new BoardNotFoundError(boardId);
        }
        return detail;
    }

    private async loadCollectionSummary(collectionId: string): Promise<CollectionSummary | null> {        const row = await this.prisma.collection.findUnique({
            where: { id: collectionId },
            include: {
                _count: { select: { items: true } },
            },
        });
        if (!row) {
            return null;
        }
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            itemCount: row._count.items,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }

    private async resolveTargetTargetId(
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

    async entry(entryId: string): Promise<EntryDetail | null> {
        const entry = await this.prisma.entry.findUnique({
            where: { id: entryId },
            include: {
                sourceInstance: true,
                currentRevision: {
                    include: { assets: true },
                },
                revisions: {
                    orderBy: { revision: "desc" },
                    include: { assets: true },
                },
                observations: {
                    orderBy: { capturedAt: "desc" },
                },
            },
        });
        if (!entry || !entry.currentRevision) {
            return null;
        }
        return {
            id: entry.id,
            sourceId: entry.sourceInstance.id,
            sourceName: entry.sourceInstance.name,
            sourceKind: sourceKindSchema.parse(entry.sourceInstance.kind),
            currentRevisionId: entry.currentRevision.id,
            metrics: parseJson<ContentMetrics>(entry.metricsJson),
            revisions: entry.revisions.map((revision) => ({
                id: revision.id,
                revision: revision.revision,
                title: revision.title,
                summary: revision.summary,
                contentText: revision.contentText,
                webUrl: revision.webUrl,
                contentKind: contentKindSchema.parse(revision.contentKind),
                publisher: parseJson<Publisher>(revision.publisherJson),
                publishedAt: parseJson<TemporalValue>(revision.publishedAtJson)
                    ?? exactTemporalValue(revision.sourcePublishedAt),
                updatedAt: parseJson<TemporalValue>(revision.updatedAtJson),
                sourcePublishedAt: revision.sourcePublishedAt?.toISOString() ?? null,
                createdAt: revision.createdAt.toISOString(),
                assets: revision.assets.map((asset) => this.toAssetSnapshot(asset)),
            })),
            observations: entry.observations.map((observation) => ({
                id: observation.id,
                externalId: observation.externalId,
                externalKey: observation.externalKey,
                eventKind: observation.eventKind as "create" | "update" | "delete" | "snapshot",
                webUrl: observation.webUrl,
                capturedAt: observation.capturedAt.toISOString(),
                sourcePublishedAt: observation.sourcePublishedAt?.toISOString() ?? null,
            })),
        };
    }

    async revision(revisionId: string): Promise<RevisionDetail | null> {
        const revision = await this.prisma.entryRevision.findUnique({
            where: { id: revisionId },
            include: {
                entry: {
                    include: {
                        sourceInstance: true,
                    },
                },
                assets: true,
            },
        });
        if (!revision) {
            return null;
        }
        return {
            id: revision.id,
            entryId: revision.entryId,
            sourceId: revision.entry.sourceInstance.id,
            sourceName: revision.entry.sourceInstance.name,
            sourceKind: sourceKindSchema.parse(revision.entry.sourceInstance.kind),
            revision: revision.revision,
            title: revision.title,
            summary: revision.summary,
            contentText: revision.contentText,
            webUrl: revision.webUrl,
            contentKind: contentKindSchema.parse(revision.contentKind),
            publisher: parseJson<Publisher>(revision.publisherJson),
            publishedAt: parseJson<TemporalValue>(revision.publishedAtJson)
                ?? exactTemporalValue(revision.sourcePublishedAt),
            updatedAt: parseJson<TemporalValue>(revision.updatedAtJson),
            sourcePublishedAt: revision.sourcePublishedAt?.toISOString() ?? null,
            createdAt: revision.createdAt.toISOString(),
            assets: revision.assets.map((asset) => this.toAssetSnapshot(asset)),
        };
    }

    async events(input: {
        afterSequence: number;
        limit: number;
    }) {
        const events = await this.prisma.domainEvent.findMany({
            where: {
                sequence: {
                    gt: input.afterSequence,
                },
            },
            orderBy: { sequence: "asc" },
            take: input.limit,
        });
        return events.map((event) => ({
            id: String(event.sequence),
            type: event.type,
            version: event.version,
            occurredAt: event.occurredAt.toISOString(),
            payload: JSON.parse(event.payloadJson) as unknown,
        }));
    }

    async latestEventSequence(): Promise<number> {
        const result = await this.prisma.domainEvent.aggregate({
            _max: { sequence: true },
        });
        return result._max.sequence ?? 0;
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

    async touchWorkerHeartbeat(input: {
        instanceId: string;
        status: "starting" | "ready" | "stopped";
        version: string;
    }): Promise<void> {
        try {
            await this.prisma.workerHeartbeat.upsert({
                where: { instanceId: input.instanceId },
                create: {
                    instanceId: input.instanceId,
                    status: input.status,
                    version: input.version,
                    lastSeenAt: new Date(),
                    stoppedAt: input.status === "stopped" ? new Date() : null,
                },
                update: {
                    status: input.status,
                    version: input.version,
                    lastSeenAt: new Date(),
                    stoppedAt: input.status === "stopped" ? new Date() : null,
                },
            });
        } catch (error) {
            this.logger?.error("storage.worker_heartbeat.failed", {
                instanceId: input.instanceId,
                status: input.status,
            }, error);
            throw error;
        }
    }

    async health(): Promise<RepositoryHealth> {
        try {
            await this.prisma.$queryRawUnsafe("SELECT 1");
        } catch (error) {
            this.logger?.error("storage.health.failed", {
                stage: "query",
            }, error);
            return {
                storageStatus: "failed",
                migrationStatus: "failed",
                workerStatus: "unknown",
            };
        }

        let heartbeat;
        try {
            heartbeat = await this.prisma.workerHeartbeat.findFirst({
                orderBy: { lastSeenAt: "desc" },
            });
        } catch (error) {
            this.logger?.error("storage.health.failed", {
                stage: "worker_heartbeat",
            }, error);
            return {
                storageStatus: "failed",
                migrationStatus: "ready",
                workerStatus: "unknown",
            };
        }
        const workerStatus: HealthResponse["workerStatus"] = !heartbeat
            ? "unknown"
            : heartbeat.status === "stopped"
                ? "stopped"
                : heartbeat.lastSeenAt.getTime() > Date.now() - 90_000
                    ? heartbeat.status as HealthResponse["workerStatus"]
                    : "stopped";

        return {
            storageStatus: "ready",
            migrationStatus: "ready",
            workerStatus,
        };
    }

    private async toSourceSnapshot(
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
        };
    }

    private toRunSnapshot(run: Prisma.RunGetPayload<{}>) {
        return {
            id: run.id,
            sourceId: run.sourceInstanceId,
            triggerKind: run.triggerKind as "manual" | "schedule",
            status: run.status as "queued" | "running" | "succeeded" | "failed" | "cancelled",
            createdAt: run.createdAt.toISOString(),
            startedAt: run.startedAt?.toISOString() ?? null,
            finishedAt: run.finishedAt?.toISOString() ?? null,
            itemCount: run.itemCount,
            createdEntryCount: run.createdEntryCount,
            revisedEntryCount: run.revisedEntryCount,
            error: run.errorMessage,
        };
    }

    private toJobSnapshot(job: Prisma.JobGetPayload<{}>): JobSnapshot {
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

    private entryInclude() {
        return {
            sourceInstance: true,
            story: {
                include: {
                    currentRevision: true,
                },
            },
            currentRevision: {
                include: { assets: true },
            },
        } satisfies Prisma.EntryInclude;
    }

    private toFeedItem(
        entry: Prisma.EntryGetPayload<{ include: ReturnType<PrismaCosmosRepository["entryInclude"]> }>,
    ): FeedItem {
        if (!entry.currentRevision || !entry.story?.currentRevision) {
            throw new Error(`Entry ${entry.id} is missing its current projection.`);
        }
        return {
            storyId: entry.story.id,
            storyKind: entry.story.kind as "event" | "document" | "media" | "thread",
            title: entry.story.currentRevision.title,
            summary: entry.story.currentRevision.summary,
            entryId: entry.id,
            sourceId: entry.sourceInstance.id,
            sourceName: entry.sourceInstance.name,
            sourceKind: sourceKindSchema.parse(entry.sourceInstance.kind),
            revisionId: entry.currentRevision.id,
            publishedAt: entry.currentRevision.sourcePublishedAt?.toISOString() ?? null,
            assets: entry.currentRevision.assets.map((asset) => this.toAssetSnapshot(asset)),
        };
    }

    private toFeedItemFromSearchRow(row: {
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

    private async assetsForRevision(revisionId: string) {
        const assets = await this.prisma.asset.findMany({
            where: { entryRevisionId: revisionId },
        });
        return assets.map((asset) => this.toAssetSnapshot(asset));
    }

    private toAssetSnapshot(asset: {
        id: string;
        kind: string;
        status: string;
        sourceUrl: string | null;
        storageKey: string | null;
        mimeType: string | null;
        byteSize: number | null;
        errorMessage?: string | null;
    }) {
        return {
            id: asset.id,
            kind: asset.kind,
            status: asset.status as "saved" | "metadata_only" | "skipped" | "failed",
            sourceUrl: asset.sourceUrl,
            storageKey: asset.storageKey,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            errorMessage: asset.errorMessage ?? null,
        };
    }
}
function projectWorkflowAttempts(
    jobId: string,
    events: readonly {
        type: string;
        payloadJson: string;
        occurredAt: Date;
    }[],
): readonly WorkflowAttemptSnapshot[] {
    const attempts = new Map<number, WorkflowAttemptSnapshot>();
    for (const event of events) {
        const prefix = "workflow.activity.";
        const suffix = ".v1";
        if (!event.type.startsWith(prefix) || !event.type.endsWith(suffix)) continue;
        const status = event.type.slice(prefix.length, -suffix.length);
        const payload = parseJson<{
            attempt?: unknown;
            owner?: unknown;
            leaseExpiresAt?: unknown;
            error?: unknown;
        }>(event.payloadJson);
        const number = payload?.attempt;
        if (!Number.isSafeInteger(number) || (number as number) <= 0) continue;
        const attemptNumber = number as number;
        const occurredAt = event.occurredAt.toISOString();
        const owner = typeof payload?.owner === "string" && payload.owner.length > 0
            ? payload.owner
            : "unknown";
        const leaseExpiresAt = typeof payload?.leaseExpiresAt === "string"
            ? payload.leaseExpiresAt
            : occurredAt;
        let projection = attempts.get(attemptNumber);
        if (!projection) {
            projection = {
                id: `${jobId}:attempt:${attemptNumber}`,
                jobId,
                number: attemptNumber,
                workerId: owner,
                workerInstanceId: owner,
                ownerEpoch: 0,
                ownerSessionId: null,
                status: "leased",
                leaseAcquiredAt: occurredAt,
                leaseExpiresAt,
                lastHeartbeatAt: null,
                finishedAt: null,
                error: null,
            };
            attempts.set(attemptNumber, projection);
        }
        if (status === "leased") {
            projection.status = "leased";
            projection.workerId = owner;
            projection.workerInstanceId = owner;
            projection.leaseExpiresAt = leaseExpiresAt;
            projection.leaseAcquiredAt = occurredAt;
            projection.finishedAt = null;
        } else {
            projection.status = status === "succeeded"
                ? "succeeded"
                : status === "cancelled"
                    ? "cancelled"
                    : status === "released"
                        ? "lease_lost"
                        : "failed";
            projection.finishedAt = occurredAt;
            const error = typeof payload?.error === "string" ? payload.error : null;
            projection.error = error === null
                ? projection.error
                : {
                    kind: status === "retry_wait"
                        ? "retryable"
                        : status === "cancelled"
                            ? "aborted"
                            : status === "released"
                                ? "unknown"
                                : "terminal",
                    code: null,
                    message: error,
                    retryable: status === "retry_wait",
                    occurredAt,
                    detailsRef: null,
                };
        }
    }
    return [...attempts.values()].sort((left, right) => left.number - right.number);
}

function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "P2002";
}

export { PrismaWorkflowBackend } from "./workflow-backend.js";
export { PrismaWorkflowHostStore } from "./workflow-host-store.js";
export { PrismaWorkflowEventSink } from "./workflow-event-sink.js";

async function assertJobLease(
    tx: Prisma.TransactionClient,
    runId: string,
    lease: JobLease,
): Promise<void> {
    const job = await tx.job.findFirst({
        where: {
            id: lease.jobId,
            runId,
            leaseToken: lease.leaseToken,
            status: "leased",
        },
    });
    if (!job) {
        throw new Error("Job lease lost.");
    }
}
async function assertWorkflowActionFence(
    tx: Prisma.TransactionClient,
    fence: HostActionExecutionFence,
    workflowRunId: string,
): Promise<void> {
    if (fence.workflowRunId !== workflowRunId) {
        throw new Error("Workflow action fence Run identity mismatch.");
    }
    const now = new Date();
    const run = await tx.workflowRun.findFirst({
        where: {
            id: workflowRunId,
            runLeaseToken: fence.runLeaseToken,
            runLeaseExpiresAt: { gt: now },
            status: { notIn: ["completed", "failed", "cancelled"] },
        },
    });
    if (!run || run.kernelRevision !== fence.kernelRevision) {
        throw new Error("Workflow Run fence lost or Kernel revision changed.");
    }
    const job = await tx.job.findFirst({
        where: {
            id: fence.jobId,
            workflowRunId,
            kind: "workflow-activity",
            status: "leased",
            attempts: fence.attempt,
            leaseToken: fence.jobLeaseToken,
            leaseExpiresAt: { gt: now },
        },
    });
    if (!job) {
        throw new Error("Workflow Activity Job fence lost.");
    }
    const payload = parseJson<Record<string, unknown>>(job.payloadJson);
    const activity = payload?.activity;
    const activityRecord = typeof activity === "object"
        && activity !== null
        && !Array.isArray(activity)
        ? activity as Record<string, unknown>
        : null;
    if (!activityRecord
        || activityRecord.key !== fence.activity.key
        || activityRecord.path !== fence.activity.path
        || activityRecord.seq !== fence.activity.seq
        || activityRecord.kind !== fence.activity.kind
        || activityRecord.fingerprint !== fence.activity.fingerprint) {
        throw new Error("Workflow Activity identity changed under fence.");
    }
}

async function appendDomainEvent(
    tx: Prisma.TransactionClient,
    input: {
        type: string;
        aggregateType?: string;
        aggregateId?: string;
        runId?: string | null;
        workflowRunId?: string | null;
        idempotencyKey?: string | null;
        payload: unknown;
    },
): Promise<void> {
    const data = {
        eventId: randomUUID(),
        type: input.type,
        version: "v1",
        payloadJson: JSON.stringify(input.payload),
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        runId: input.runId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
    };
    if (input.workflowRunId && input.idempotencyKey) {
        const existing = await tx.domainEvent.findFirst({
            where: {
                workflowRunId: input.workflowRunId,
                idempotencyKey: input.idempotencyKey,
            },
        });
        if (existing) {
            if (
                existing.type !== data.type
                || existing.version !== data.version
                || existing.payloadJson !== data.payloadJson
            ) {
                throw new Error(`Workflow domain event ${input.idempotencyKey} conflicts with existing payload.`);
            }
            return;
        }
    }
    try {
        await tx.domainEvent.create({ data });
    } catch (error) {
        if (!isUniqueConstraintError(error) || !input.workflowRunId || !input.idempotencyKey) {
            throw error;
        }
        const winner = await tx.domainEvent.findFirst({
            where: {
                workflowRunId: input.workflowRunId,
                idempotencyKey: input.idempotencyKey,
            },
        });
        if (!winner) throw error;
        if (
            winner.type !== data.type
            || winner.version !== data.version
            || winner.payloadJson !== data.payloadJson
        ) {
            throw new Error(`Workflow domain event ${input.idempotencyKey} conflicts with existing payload.`);
        }
    }
}

function parseJson<T>(value: string | null): T | null {
    if (!value) {
        return null;
    }
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

function sourceActivationRequestHash(input: SourceActivationCommand & {
    sourceId: string;
    idempotencyKey: string;
}): string {
    return `sha256:${createHash("sha256")
        .update(JSON.stringify({
            sourceId: input.sourceId,
            enabled: input.enabled,
            baseRevisionId: input.baseRevisionId,
        }))
        .digest("hex")}`;
}

function exactTemporalValue(date: Date | null): TemporalValue | null {
    return date
        ? {
            exact: date.toISOString(),
            exactPrecision: "second",
            fallback: null,
        }
        : null;
}

function parseCursor(cursor: string | undefined): number {
    const value = Number.parseInt(cursor ?? "0", 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Comma-separated id list from a query string; blanks are dropped. */
function parseIdList(value: string | undefined): string[] {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function savedViewData(
    name: string,
    conditions: {
        text?: string | null;
        sourceId?: string | null;
        publishedAfter?: string | null;
        publishedBefore?: string | null;
        labelIds?: readonly string[] | null;
        topicIds?: readonly string[] | null;
    },
): {
    name: string;
    text: string | null;
    sourceId: string | null;
    publishedAfter: string | null;
    publishedBefore: string | null;
    labelIdsJson: string;
    topicIdsJson: string;
} {
    return {
        name: name.trim(),
        text: conditions.text?.trim() || null,
        sourceId: conditions.sourceId?.trim() || null,
        publishedAfter: conditions.publishedAfter ?? null,
        publishedBefore: conditions.publishedBefore ?? null,
        labelIdsJson: JSON.stringify(conditions.labelIds ?? []),
        topicIdsJson: JSON.stringify(conditions.topicIds ?? []),
    };
}

function toSavedView(row: {
    id: string;
    name: string;
    text: string | null;
    sourceId: string | null;
    publishedAfter: string | null;
    publishedBefore: string | null;
    labelIdsJson: string;
    topicIdsJson: string;
    createdAt: Date;
    updatedAt: Date;
}): SavedView {
    return {
        id: row.id,
        name: row.name,
        text: row.text,
        sourceId: row.sourceId,
        publishedAfter: row.publishedAfter,
        publishedBefore: row.publishedBefore,
        labelIds: parseJson<string[]>(row.labelIdsJson) ?? [],
        topicIds: parseJson<string[]>(row.topicIdsJson) ?? [],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function toBoardBlock(row: {
    id: string;
    sectionId: string;
    type: string;
    configJson: string;
    position: number;
    visible: boolean;
    createdAt: Date;
    updatedAt: Date;
}): BoardBlock {
    const parsed = parseJson<unknown>(row.configJson);
    const config = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    return {
        id: row.id,
        sectionId: row.sectionId,
        type: row.type,
        config,
        position: row.position,
        visible: row.visible,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/**
 * Validate one block config against the contracts whitelist for its type and
 * serialize it for storage. ZodError intentionally propagates: the API funnel
 * maps it to a 400, and reaching here from storage means the API check was
 * skipped (a bug, not a client condition).
 */
function stringifyBlockConfig(type: string, config: Record<string, unknown>): string {
    const schema = blockConfigSchemaFor(type);
    if (!schema) {
        throw new Error(`Unknown board block type: ${type}`);
    }
    return JSON.stringify(schema.parse(config));
}

function toSpotlightPlacement(row: {
    id: string;
    boardId: string;
    targetType: string;
    targetId: string;
    source: string;
    reason: string | null;
    actorJson: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}, targetTitle: string | null): SpotlightPlacement {
    return {
        id: row.id,
        boardId: row.boardId,
        targetType: row.targetType,
        targetId: row.targetId,
        source: row.source,
        reason: row.reason,
        actor: row.actorJson == null ? null : parseJson<string>(row.actorJson),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        targetTitle,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function readPayloadSourceId(payloadJson: string | null): string | null {
    if (!payloadJson) {
        return null;
    }
    try {
        const payload = JSON.parse(payloadJson) as {
            sourceId?: unknown;
        };
        return typeof payload.sourceId === "string" && payload.sourceId
            ? payload.sourceId
            : null;
    } catch {
        return null;
    }
}
