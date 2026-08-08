import {
    protocolVersion,
    type CreateSourceCommand,
    type FeedPage,
    type HealthResponse,
    type IngestResult,
    type EntryDetail,
    type RevisionDetail,
    type RunSnapshot,
    type SearchPage,
    type SearchQuery,
    type SourceSnapshot,
    type StoryDetail,
} from "@cosmos/contracts";
import type { NormalizedIngestItem } from "@cosmos/domain";

export interface PersistIngestItemResult {
    createdEntry: boolean;
    revisedEntry: boolean;
    duplicateObservation: boolean;
}

export interface RepositoryHealth {
    storageStatus: HealthResponse["storageStatus"];
    migrationStatus: HealthResponse["migrationStatus"];
    workerStatus: HealthResponse["workerStatus"];
}

export interface CosmosRepository {
    createSource(input: CreateSourceCommand): Promise<SourceSnapshot>;
    listSources(): Promise<readonly SourceSnapshot[]>;
    getSource(sourceId: string): Promise<SourceSnapshot | null>;
    setSourceEnabled(sourceId: string, enabled: boolean): Promise<SourceSnapshot>;
    createRun(input: {
        sourceId: string;
        triggerKind: "manual" | "schedule";
    }): Promise<RunSnapshot>;
    createQueuedRun(input: {
        sourceId: string;
        triggerKind: "manual" | "schedule";
        idempotencyKey?: string;
    }): Promise<RunSnapshot>;
    startRun(runId: string, lease?: JobLease): Promise<RunSnapshot>;
    getRun(runId: string): Promise<RunSnapshot | null>;
    getCheckpoint(sourceId: string): Promise<string | null>;
    claimNextJob(input: {
        owner: string;
        leaseMs: number;
    }): Promise<{
        id: string;
        runId: string | null;
        kind: string;
        leaseToken: string;
        attempts: number;
        maxAttempts: number;
    } | null>;
    renewJobLease(input: {
        jobId: string;
        leaseToken: string;
        leaseMs: number;
    }): Promise<boolean>;
    completeJob(input: {
        jobId: string;
        leaseToken: string;
        status: "succeeded" | "retry_wait" | "failed_terminal";
        error?: string | null;
        retryDelayMs?: number;
    }): Promise<boolean>;
    resetRunForRetry(input: {
        runId: string;
        error?: string | null;
        lease?: JobLease;
    }): Promise<RunSnapshot>;
    persistIngestItem(input: {
        sourceId: string;
        runId: string;
        item: NormalizedIngestItem;
    }): Promise<PersistIngestItemResult>;
    setCheckpoint(sourceId: string, cursor: string | null): Promise<void>;
    completeRun(input: {
        runId: string;
        status: "succeeded" | "failed" | "cancelled";
        error?: string | null;
        lease?: JobLease;
    }): Promise<RunSnapshot>;
    feed(input: {
        cursor?: string;
        limit: number;
    }): Promise<FeedPage>;
    search(input: SearchQuery): Promise<SearchPage>;
    story(storyId: string): Promise<StoryDetail | null>;
    entry(entryId: string): Promise<EntryDetail | null>;
    revision(revisionId: string): Promise<RevisionDetail | null>;
    events(input: {
        afterSequence: number;
        limit: number;
    }): Promise<readonly {
        id: string;
        type: string;
        version: string;
        occurredAt: string;
        payload: unknown;
    }[]>;
    latestEventSequence(): Promise<number>;
    readAsset(assetId: string): Promise<{
        content: Uint8Array;
        mimeType: string;
    } | null>;
    touchWorkerHeartbeat(input: {
        instanceId: string;
        status: "starting" | "ready" | "stopped";
        version: string;
    }): Promise<void>;
    health(): Promise<RepositoryHealth>;
}

export interface JobLease {
    jobId: string;
    leaseToken: string;
}

export interface IngestConnector {
    id: string;
    fetchItems(input: {
        source: SourceSnapshot;
        cursor: string | null;
    }): Promise<{
        items: readonly NormalizedIngestItem[];
        nextCursor: string | null;
    }>;
}

export type ConnectorResolver = (
    source: SourceSnapshot,
) => IngestConnector;

export class IngestionService {
    constructor(
        private readonly repository: CosmosRepository,
        private readonly resolveConnector: ConnectorResolver,
    ) {}

    async runSource(sourceId: string): Promise<IngestResult> {
        const source = await this.repository.getSource(sourceId);
        if (!source) {
            throw new Error(`Source not found: ${sourceId}`);
        }

        const run = await this.repository.createRun({
            sourceId,
            triggerKind: "manual",
        });
        return this.executeRun(run.id, source);
    }

    async runExistingRun(runId: string): Promise<IngestResult> {
        return this.runExistingRunWithLease(runId);
    }

    async runExistingRunWithLease(
        runId: string,
        lease?: JobLease,
    ): Promise<IngestResult> {
        const run = await this.repository.getRun(runId);
        if (!run || !run.sourceId) {
            throw new Error(`Run not found: ${runId}`);
        }
        const source = await this.repository.getSource(run.sourceId);
        if (!source) {
            throw new Error(`Source not found: ${run.sourceId}`);
        }
        await this.repository.startRun(runId, lease);
        return this.executeRun(runId, source, lease);
    }

    private async executeRun(
        runId: string,
        source: SourceSnapshot,
        lease?: JobLease,
    ): Promise<IngestResult> {
        let createdEntryCount = 0;
        let revisedEntryCount = 0;
        let duplicateObservationCount = 0;

        try {
            const page = await this.resolveConnector(source).fetchItems({
                source,
                cursor: await this.repository.getCheckpoint(source.id),
            });

            for (const item of page.items) {
                const result = await this.repository.persistIngestItem({
                    sourceId: source.id,
                    runId,
                    item,
                });
                if (result.createdEntry) {
                    createdEntryCount += 1;
                }
                if (result.revisedEntry) {
                    revisedEntryCount += 1;
                }
                if (result.duplicateObservation) {
                    duplicateObservationCount += 1;
                }
            }

            await this.repository.setCheckpoint(source.id, page.nextCursor);
            const completedRun = await this.repository.completeRun({
                runId,
                status: "succeeded",
                lease,
            });

            return {
                run: {
                    ...completedRun,
                    itemCount: page.items.length,
                    createdEntryCount,
                    revisedEntryCount,
                },
                createdEntryCount,
                revisedEntryCount,
                duplicateObservationCount,
            };
        } catch (error) {
            const completedRun = await this.repository.completeRun({
                runId,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
                lease,
            });
            return {
                run: {
                    ...completedRun,
                    itemCount: 0,
                    createdEntryCount,
                    revisedEntryCount,
                },
                createdEntryCount,
                revisedEntryCount,
                duplicateObservationCount,
            };
        }
    }
}

export interface IngestionWorkerOptions {
    owner: string;
    leaseMs: number;
    pollIntervalMs?: number;
    now?: () => Date;
}

export interface WorkerJobResult {
    jobId: string;
    runId: string | null;
    status: "succeeded" | "retry_wait" | "failed_terminal";
    attempts: number;
}

export class IngestionWorker {
    private readonly now: () => Date;

    constructor(
        private readonly repository: CosmosRepository,
        private readonly ingestion: IngestionService,
        private readonly options: IngestionWorkerOptions,
    ) {
        this.now = options.now ?? (() => new Date());
    }

    async pollOnce(): Promise<WorkerJobResult | null> {
        await this.queueScheduledSources();
        const job = await this.repository.claimNextJob({
            owner: this.options.owner,
            leaseMs: this.options.leaseMs,
        });
        if (!job) {
            return null;
        }

        const leaseHeartbeatMs = Math.max(
            1_000,
            Math.floor(this.options.leaseMs / 3),
        );
        const leaseHeartbeat = setInterval(() => {
            void this.repository.renewJobLease({
                jobId: job.id,
                leaseToken: job.leaseToken,
                leaseMs: this.options.leaseMs,
            });
        }, leaseHeartbeatMs);
        try {
            if (job.kind !== "source-ingest" || !job.runId) {
                const completed = await this.repository.completeJob({
                    jobId: job.id,
                    leaseToken: job.leaseToken,
                    status: "failed_terminal",
                    error: `Unsupported job: ${job.kind}`,
                });
                if (!completed) {
                    return null;
                }
                return {
                    jobId: job.id,
                    runId: job.runId,
                    status: "failed_terminal",
                    attempts: job.attempts,
                };
            }

            const result = await this.ingestion.runExistingRunWithLease(job.runId, {
                jobId: job.id,
                leaseToken: job.leaseToken,
            });
            if (result.run.status === "succeeded") {
                const completed = await this.repository.completeJob({
                    jobId: job.id,
                    leaseToken: job.leaseToken,
                    status: "succeeded",
                });
                return completed
                    ? {
                        jobId: job.id,
                        runId: job.runId,
                        status: "succeeded",
                        attempts: job.attempts,
                    }
                    : null;
            }

            return this.finishFailedJob(job, result.run.error);
        } catch (error) {
            return this.finishFailedJob(
                job,
                error instanceof Error ? error.message : String(error),
            );
        } finally {
            clearInterval(leaseHeartbeat);
        }
    }

    async queueScheduledSources(): Promise<void> {
        const now = this.now();
        const sources = await this.repository.listSources();
        for (const source of sources) {
            if (!source.enabled || !source.config.scheduleIntervalMs) {
                continue;
            }
            const interval = source.config.scheduleIntervalMs;
            const lastRunAt = source.lastRunAt
                ? Date.parse(source.lastRunAt)
                : Number.NEGATIVE_INFINITY;
            if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < interval) {
                continue;
            }
            const bucket = Math.floor(now.getTime() / interval);
            await this.repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "schedule",
                idempotencyKey: `schedule:${source.id}:${bucket}`,
            });
        }
    }

    private async finishFailedJob(
        job: {
            id: string;
            runId: string | null;
            leaseToken: string;
            attempts: number;
            maxAttempts: number;
        },
        error: string | null | undefined,
    ): Promise<WorkerJobResult | null> {
        const terminal = job.attempts >= job.maxAttempts;
        if (!terminal && job.runId) {
            try {
                await this.repository.resetRunForRetry({
                    runId: job.runId,
                    error: error ?? null,
                    lease: {
                        jobId: job.id,
                        leaseToken: job.leaseToken,
                    },
                });
            } catch {
                return null;
            }
        }
        const completed = await this.repository.completeJob({
            jobId: job.id,
            leaseToken: job.leaseToken,
            status: terminal ? "failed_terminal" : "retry_wait",
            error: error ?? null,
            retryDelayMs: terminal
                ? undefined
                : retryDelayMs(job.attempts),
        });
        return completed
            ? {
                jobId: job.id,
                runId: job.runId,
                status: terminal ? "failed_terminal" : "retry_wait",
                attempts: job.attempts,
            }
            : null;
    }
}

function retryDelayMs(attempt: number): number {
    return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export function createHealthSnapshot(input: {
    version: string;
    workerStatus?: HealthResponse["workerStatus"];
    storageStatus?: HealthResponse["storageStatus"];
    migrationStatus?: HealthResponse["migrationStatus"];
    now?: Date;
}): HealthResponse {
    return {
        status: "ok",
        service: "cosmos-api",
        version: input.version,
        protocolVersion,
        workerStatus: input.workerStatus ?? "unknown",
        storageStatus: input.storageStatus ?? "unknown",
        migrationStatus: input.migrationStatus ?? "unknown",
        timestamp: (input.now ?? new Date()).toISOString(),
    };
}
