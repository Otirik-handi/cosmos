import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
    ConnectorExecutionError,
    ConnectorProbeService,
    IngestionService,
    IngestionWorker,
    type LoggerPort,
    type IngestConnector,
} from "@cosmos/application";
import type { SourceSnapshot } from "@cosmos/contracts";
import type { NormalizedIngestItem } from "@cosmos/domain";

import {
    PrismaCosmosRepository,
    resolveStorageRoots,
} from "./index.js";

const temporaryRoots: string[] = [];

function captureLogger(): {
    logger: LoggerPort;
    records: Array<Record<string, unknown>>;
} {
    const records: Array<Record<string, unknown>> = [];
    const logger: LoggerPort = {
        child: () => logger,
        withContext: (_context, callback) => callback(),
        debug: (event, fields = {}) => {
            records.push({ ...fields, event, level: "debug" });
        },
        info: (event, fields = {}) => {
            records.push({ ...fields, event, level: "info" });
        },
        warn: (event, fields = {}) => {
            records.push({ ...fields, event, level: "warn" });
        },
        error: (event, fields = {}) => {
            records.push({ ...fields, event, level: "error" });
        },
    };
    return { logger, records };
}

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
});

describe("PrismaCosmosRepository", () => {
    it("anchors relative data roots to the workspace root", () => {
        const workspaceRoot = resolve(tmpdir(), "cosmos-workspace-root");
        const roots = resolveStorageRoots(".cosmos", workspaceRoot);

        expect(roots.dataRoot).toBe(join(workspaceRoot, ".cosmos"));
        expect(roots.databasePath).toBe(join(
            workspaceRoot,
            ".cosmos",
            "cosmos.sqlite",
        ));
    });

    it("persists observations, revisions, assets, Story projections and FTS results", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-storage-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Test fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            const pages: readonly NormalizedIngestItem[] = [
            {
                externalId: "stable-1",
                title: "Original title",
                summary: "Summary",
                contentText: "Original body",
                webUrl: null,
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: {
                    exact: "2026-08-08T00:00:00.000Z",
                    exactPrecision: "second",
                    fallback: null,
                },
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "stable-1" },
                rawPayload: "<item>original</item>",
                assets: [{
                    kind: "image",
                    sourceUrl: "https://example.test/image.png",
                    status: "saved",
                    mimeType: "image/png",
                    byteSize: 5,
                    content: new TextEncoder().encode("image"),
                }],
            },
            {
                title: "URL-free title",
                summary: null,
                contentText: "URL-free body",
                webUrl: null,
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "url-free" },
                rawPayload: "<item>url-free</item>",
                assets: [{
                    kind: "attachment",
                    sourceUrl: null,
                    status: "metadata_only",
                    mimeType: "application/octet-stream",
                    byteSize: null,
                    content: null,
                }],
            },
            ];
            let pageIndex = 0;
            const connector: IngestConnector = {
            id: "test-fixture",
            description: "Test fixture",
            configVersion: "v1",
            capabilities: ["test"],
            validate: () => undefined,
            async fetchItems() {
                const revised = pageIndex++ > 0
                    ? pages.map((item) => item.externalId === "stable-1"
                        ? { ...item, contentText: "Revised body", rawPayload: "<item>revised</item>" }
                        : item)
                    : pages;
                return {
                    items: revised,
                    nextCursor: String(pageIndex),
                };
            },
            };
            const service = new IngestionService(repository, () => connector);

            const first = await service.runSource(source.id);
            const second = await service.runSource(source.id);

            expect(first.createdEntryCount).toBe(2);
            expect(first.revisedEntryCount).toBe(0);
            expect(second.createdEntryCount).toBe(0);
            expect(second.revisedEntryCount).toBe(1);
            expect(second.duplicateObservationCount).toBe(1);

            const feed = await repository.feed({ limit: 20 });
            expect(feed.items).toHaveLength(2);

            const entries = await repository.entries({
                sourceId: source.id,
                limit: 20,
            });
            expect(entries.items).toHaveLength(2);
            expect(entries.items.some((item) => item.revisionCount === 2)).toBe(true);
            expect(entries.items.every((item) => item.observationCount >= 2)).toBe(true);

            const search = await repository.search({
                text: "Revised",
                limit: 20,
            });
            expect(search.items).toHaveLength(1);

            const filtered = await repository.search({
                sourceId: source.id,
                publishedAfter: "2026-08-08T00:00:00.000Z",
                publishedBefore: "2026-08-08T23:59:59.999Z",
                limit: 1,
            });
            expect(filtered.items).toHaveLength(1);
            expect(filtered.nextCursor).toBeNull();

            const firstPage = await repository.search({
                sourceId: source.id,
                limit: 1,
            });
            expect(firstPage.nextCursor).toBe("1");
            const secondPage = await repository.search({
                sourceId: source.id,
                cursor: firstPage.nextCursor ?? undefined,
                limit: 1,
            });
            expect(secondPage.items).toHaveLength(1);
            expect(secondPage.nextCursor).toBeNull();

            const stories = await Promise.all(
                feed.items.map((item) => repository.story(item.storyId)),
            );
            const revisedStory = stories.find((item) => item?.entry.revisions.length === 2);
            expect(revisedStory?.entry.observations.length).toBe(2);

            const savedAsset = stories
                .flatMap((story) => story?.entry.revisions ?? [])
                .flatMap((revision) => revision.assets)
                .find((asset) => asset.status === "saved");
            expect(savedAsset).toBeDefined();
            const asset = await repository.readAsset(savedAsset!.id);
            expect(new TextDecoder().decode(asset!.content)).toBe("image");
        } finally {
            await repository.close();
        }
    });

    it("refreshes metrics without creating a revision and keeps publisher ids nullable", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-metrics-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Metrics fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            let likes = 1;
            let exactPublishedAt = false;
            const connector: IngestConnector = {
                id: "metrics-test",
                description: "Metrics test",
                configVersion: "v1",
                capabilities: ["test"],
                validate: () => undefined,
                async fetchItems() {
                    return {
                        items: [{
                            externalId: "metrics-item",
                            title: "Metrics item",
                            summary: null,
                            contentText: "Stable body",
                            webUrl: null,
                            kind: "video",
                            publisher: {
                                platformId: null,
                                name: "Author without id",
                                handle: null,
                                profileUrl: null,
                                kind: "unknown",
                                metrics: null,
                            },
                            metrics: {
                                values: { likes },
                                raw: { likes: String(likes) },
                                reliability: "high",
                                capturedAt: "2026-08-10T00:00:00.000Z",
                            },
                            publishedAt: exactPublishedAt
                                ? {
                                    exact: "2026-08-10T00:00:00.000Z",
                                    exactPrecision: "second",
                                    fallback: null,
                                }
                                : {
                                    exact: null,
                                    exactPrecision: null,
                                    fallback: {
                                        raw: "今天",
                                        lowerBound: "2026-08-10T00:00:00.000Z",
                                        precision: "day",
                                        timezone: "UTC",
                                        confidence: "inferred",
                                    },
                                },
                            updatedAt: null,
                            sourceLocator: {
                                provider: "metrics-test",
                            },
                            rawPayload: JSON.stringify({ likes }),
                            assets: [],
                        }],
                        nextCursor: null,
                    };
                },
            };
            const service = new IngestionService(repository, () => connector);

            const first = await service.runSource(source.id);
            likes = 2;
            exactPublishedAt = true;
            const second = await service.runSource(source.id);

            expect(first.createdEntryCount).toBe(1);
            expect(second.revisedEntryCount).toBe(0);
            expect(second.duplicateObservationCount).toBe(1);

            const entries = await repository.entries({
                sourceId: source.id,
                limit: 20,
            });
            expect(entries.items[0]).toMatchObject({
                contentKind: "video",
                publisher: {
                    platformId: null,
                    name: "Author without id",
                },
                metrics: {
                    values: { likes: 2 },
                },
            });

            const detail = await repository.entry(entries.items[0]!.id);
            expect(detail?.revisions).toHaveLength(1);
            expect(detail?.revisions[0]?.publishedAt).toMatchObject({
                exact: "2026-08-10T00:00:00.000Z",
                fallback: null,
            });
            expect((await repository.feed({ limit: 20 })).items[0]?.storyKind)
                .toBe("media");
        } finally {
            await repository.close();
        }
    });

    it("deduplicates queued commands, takes over expired leases, and rejects stale completion", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-job-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Queue fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            const first = await repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "manual-command-1",
            });
            const duplicate = await repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "manual-command-1",
            });

            expect(duplicate.id).toBe(first.id);

            const originalLease = await repository.claimNextJob({
                owner: "worker-a",
                leaseMs: -1,
                acceptedKinds: ["source-ingest", "source-probe"],
            });
            expect(originalLease?.attempts).toBe(1);

            const takeover = await repository.claimNextJob({
                owner: "worker-b",
                leaseMs: 60_000,
                acceptedKinds: ["source-ingest", "source-probe"],
            });
            expect(takeover?.attempts).toBe(2);

            expect(await repository.completeJob({
                jobId: originalLease!.id,
                leaseToken: originalLease!.leaseToken,
                status: "succeeded",
            })).toBe(false);
            expect(await repository.completeJob({
                jobId: takeover!.id,
                leaseToken: takeover!.leaseToken,
                status: "retry_wait",
                error: "transient",
                retryDelayMs: 0,
            })).toBe(true);

            const retry = await repository.claimNextJob({
                owner: "worker-b",
                leaseMs: 60_000,
                acceptedKinds: ["source-ingest", "source-probe"],
            });
            expect(retry?.attempts).toBe(3);
            expect(await repository.completeJob({
                jobId: retry!.id,
                leaseToken: retry!.leaseToken,
                status: "succeeded",
            })).toBe(true);

            expect(await repository.latestEventSequence()).toBeGreaterThan(0);
            expect((await repository.events({
                afterSequence: 0,
                limit: 100,
            })).some((event) => event.type === "job.succeeded.v1")).toBe(true);
        } finally {
            await repository.close();
        }
    });

    it("keeps workflow activity jobs out of legacy claims", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-accepted-kinds-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Accepted kinds fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            await repository.prisma.job.create({
                data: {
                    kind: "workflow-activity",
                    status: "queued",
                    payloadJson: JSON.stringify({ runId: "workflow-run-1" }),
                    idempotencyKey: "workflow-activity-1",
                },
            });
            const run = await repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "manual",
            });

            await expect(repository.claimNextJob({
                owner: "legacy-worker",
                leaseMs: 60_000,
                acceptedKinds: [],
            })).resolves.toBeNull();
            const claimed = await repository.claimNextJob({
                owner: "legacy-worker",
                leaseMs: 60_000,
                acceptedKinds: ["source-ingest", "source-probe"],
            });

            expect(claimed?.kind).toBe("source-ingest");
            expect(claimed?.runId).toBe(run.id);
            expect(await repository.getJob((await repository.prisma.job.findUniqueOrThrow({
                where: { idempotencyKey: "workflow-activity-1" },
                select: { id: true },
            })).id)).toMatchObject({
                kind: "workflow-activity",
                status: "queued",
            });
        } finally {
            await repository.close();
        }
    });

    it("logs claim competition and terminal attempts with source correlation", async () => {
        const { logger, records } = captureLogger();
        const candidate = {
            id: "job-logging",
            runId: "run-logging",
            kind: "source-ingest",
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            leaseToken: null,
            leaseExpiresAt: null,
            payloadJson: JSON.stringify({ sourceId: "source-logging" }),
        };
        const prisma = {
            $transaction: async (
                callback: (transaction: unknown) => unknown,
            ) => callback({
                job: {
                    findFirst: async () => candidate,
                    updateMany: async () => ({ count: 0 }),
                    update: async () => candidate,
                },
                run: {
                    update: async () => undefined,
                },
                domainEvent: {
                    create: async () => undefined,
                },
            }),
        };
        const repository = new PrismaCosmosRepository({
            prisma: prisma as never,
            logger,
        });

        await expect(repository.claimNextJob({
            owner: "worker-logging",
            leaseMs: 5_000,
            acceptedKinds: ["source-ingest", "source-probe"],
        })).resolves.toBeNull();
        candidate.attempts = candidate.maxAttempts;
        await expect(repository.claimNextJob({
            owner: "worker-logging",
            leaseMs: 5_000,
            acceptedKinds: ["source-ingest", "source-probe"],
        })).resolves.toBeNull();

        expect(records).toContainEqual(expect.objectContaining({
            event: "job.claim_rejected",
            level: "debug",
            jobId: "job-logging",
            runId: "run-logging",
            sourceId: "source-logging",
            reason: "lease_competition",
        }));
        expect(records).toContainEqual(expect.objectContaining({
            event: "job.failed_terminal",
            level: "error",
            jobId: "job-logging",
            runId: "run-logging",
            sourceId: "source-logging",
            errorCode: "max_attempts",
        }));
    });

    it("logs both storage health query and heartbeat failures", async () => {
        const queryFailure = captureLogger();
        const queryFailingRepository = new PrismaCosmosRepository({
            prisma: {
                $queryRawUnsafe: async () => {
                    throw new Error("database unavailable");
                },
            } as never,
            logger: queryFailure.logger,
        });
        await expect(queryFailingRepository.health()).resolves.toMatchObject({
            storageStatus: "failed",
        });
        expect(queryFailure.records).toContainEqual(expect.objectContaining({
            event: "storage.health.failed",
            stage: "query",
        }));

        const heartbeatFailure = captureLogger();
        const heartbeatFailingRepository = new PrismaCosmosRepository({
            prisma: {
                $queryRawUnsafe: async () => 1,
                workerHeartbeat: {
                    findFirst: async () => {
                        throw new Error("heartbeat unavailable");
                    },
                },
            } as never,
            logger: heartbeatFailure.logger,
        });
        await expect(heartbeatFailingRepository.health()).resolves.toMatchObject({
            storageStatus: "failed",
        });
        expect(heartbeatFailure.records).toContainEqual(expect.objectContaining({
            event: "storage.health.failed",
            stage: "worker_heartbeat",
        }));
    });

    it("lets the persistent worker consume a queued source run end to end", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-worker-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Worker fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            const run = await repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "manual",
            });
            const connector: IngestConnector = {
                id: "worker-test",
                description: "Worker test",
                configVersion: "v1",
                capabilities: ["test"],
                validate: () => undefined,
                async fetchItems() {
                    return {
                        items: [{
                            externalId: "worker-item",
                            title: "Worker item",
                            summary: "From worker",
                            contentText: "Persisted by worker",
                            webUrl: null,
                            kind: "article",
                            publisher: null,
                            metrics: null,
                            publishedAt: null,
                            updatedAt: null,
                            sourceLocator: { provider: "test" },
                            rawPayload: "<item>worker</item>",
                            assets: [],
                        }],
                        nextCursor: "worker-cursor",
                    };
                },
            };
            const ingestion = new IngestionService(
                repository,
                () => connector,
            );
            const worker = new IngestionWorker(repository, ingestion, {
                owner: "worker-test",
                leaseMs: 60_000,
            });

            const result = await worker.pollOnce();

            expect(result?.status).toBe("succeeded");
            expect((await repository.getRun(run.id))?.status).toBe("succeeded");
            expect((await repository.feed({ limit: 20 })).items).toHaveLength(1);
            expect(await repository.getCheckpoint(source.id)).toBe("worker-cursor");
        } finally {
            await repository.close();
        }
    });

    it("runs source probes in a worker without persisting entries or checkpoints", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-probe-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Probe fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            const job = await repository.createProbeJob({
                sourceId: source.id,
                idempotencyKey: "probe-command-1",
            });
            const connector: IngestConnector = {
                id: "probe-test",
                description: "Probe test",
                configVersion: "v1",
                capabilities: ["test"],
                validate: () => undefined,
                async fetchItems() {
                    return {
                        items: [{
                            externalId: "probe-item",
                            title: "Probe item",
                            summary: null,
                            contentText: "Should not be persisted",
                            webUrl: null,
                            kind: "article",
                            publisher: null,
                            metrics: null,
                            publishedAt: null,
                            updatedAt: null,
                            sourceLocator: { provider: "probe-test" },
                            rawPayload: "{}",
                            assets: [],
                        }],
                        nextCursor: "probe-cursor",
                    };
                },
            };
            const probe = new ConnectorProbeService(
                repository,
                () => connector,
            );
            const worker = new IngestionWorker(
                repository,
                new IngestionService(repository, () => connector),
                {
                    owner: "probe-worker",
                    leaseMs: 60_000,
                    probe,
                },
            );

            const result = await worker.pollOnce();

            expect(result?.status).toBe("succeeded");
            expect((await repository.getJob(job.id))?.result).toMatchObject({
                sourceId: source.id,
                connectorId: "probe-test",
                itemCount: 1,
                nextCursorAvailable: true,
            });
            expect((await repository.entries({ limit: 20 })).items).toHaveLength(0);
            expect(await repository.getCheckpoint(source.id)).toBeNull();
        } finally {
            await repository.close();
        }
    });

    it("does not retry non-retryable connector failures", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-failure-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Auth fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            const run = await repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "auth-failure-1",
            });
            const connector: IngestConnector = {
                id: "auth-failure",
                description: "Auth failure",
                configVersion: "v1",
                capabilities: ["test"],
                validate: () => undefined,
                async fetchItems() {
                    throw new ConnectorExecutionError(
                        "authentication_required",
                        "Login is required.",
                        false,
                    );
                },
            };
            const worker = new IngestionWorker(
                repository,
                new IngestionService(repository, () => connector),
                {
                    owner: "auth-failure-worker",
                    leaseMs: 60_000,
                },
            );

            const result = await worker.pollOnce();
            const events = await repository.events({
                afterSequence: 0,
                limit: 100,
            });
            const leasedEvent = events.find((event) => event.type === "job.leased.v1");
            const jobId = leasedEvent
                && typeof (leasedEvent.payload as { jobId?: unknown }).jobId === "string"
                ? (leasedEvent.payload as { jobId: string }).jobId
                : null;
            const job = jobId ? await repository.getJob(jobId) : null;

            expect(result?.status).toBe("failed_terminal");
            expect((await repository.getRun(run.id))?.status).toBe("failed");
            expect(job?.errorCode).toBe("authentication_required");
        } finally {
            await repository.close();
        }
    });

    it("queues a scheduled source once per interval bucket", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-schedule-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Scheduled fixture",
                kind: "fixture-rss",
                config: {
                    scheduleIntervalMs: 60_000,
                },
                enabled: true,
            });
            const connector: IngestConnector = {
                id: "schedule-test",
                description: "Schedule test",
                configVersion: "v1",
                capabilities: ["test"],
                validate: () => undefined,
                async fetchItems() {
                    return {
                        items: [],
                        nextCursor: "schedule-cursor",
                    };
                },
            };
            const worker = new IngestionWorker(
                repository,
                new IngestionService(repository, () => connector),
                {
                    owner: "schedule-worker",
                    leaseMs: 60_000,
                    now: () => new Date("2026-08-08T00:00:00.000Z"),
                },
            );

            await worker.queueScheduledSources();
            await worker.queueScheduledSources();
            const result = await worker.pollOnce();

            expect(result?.status).toBe("succeeded");
            expect(await repository.getCheckpoint(source.id)).toBe("schedule-cursor");
        } finally {
            await repository.close();
        }
    });
    it("commits Workflow checkpoint revisions only under the current dual fence", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-workflow-checkpoint-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);
        const repository = new PrismaCosmosRepository({ dataRoot: root });
        const workflowRunId = "workflow-checkpoint-run";
        const jobId = "workflow-checkpoint-job";
        await repository.prisma.workflowRun.create({
            data: {
                id: workflowRunId,
                stateJson: JSON.stringify({ runId: workflowRunId, status: "running", revision: 1 }),
                kernelRevision: 1,
                status: "running",
                resumeRequired: false,
                definitionKey: "cosmos.ingest",
                definitionVersion: "1",
                manifestHash: "builtin:cosmos.ingest@1:source-snapshot-v1",
                idempotencyKey: "workflow-checkpoint-command",
                inputSnapshotJson: "{}",
                productRunJson: "{}",
                runLeaseOwner: "worker-checkpoint",
                runLeaseToken: "run-fence",
                runLeaseExpiresAt: new Date(Date.now() + 60_000),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        });
        await repository.prisma.sourceInstance.create({
            data: { id: "source-checkpoint", name: "Checkpoint", kind: "fixture-rss", configJson: "{}" },
        });
        await repository.prisma.job.create({
            data: {
                id: jobId,
                workflowRunId,
                kind: "workflow-activity",
                status: "leased",
                idempotencyKey: "workflow-checkpoint-job-key",
                attempts: 1,
                maxAttempts: 3,
                payloadJson: JSON.stringify({
                    activity: {
                        key: "source.checkpoint",
                        path: "root",
                        seq: 0,
                        kind: "action",
                        fingerprint: "sha256:checkpoint",
                    },
                }),
                leaseOwner: "worker-checkpoint",
                leaseToken: "job-fence",
                leaseExpiresAt: new Date(Date.now() + 60_000),
                workflowKernelRevision: 1,
            },
        });
        try {
            await expect(repository.setWorkflowIngestCheckpoint({
                sourceId: "source-checkpoint",
                workflowRunId,
                cursor: "cursor-1",
                expectedRevision: 0,
                itemCount: 0,
                fence: {
                    workflowRunId,
                    kernelRevision: 1,
                    activity: {
                        key: "source.checkpoint",
                        path: "root",
                        seq: 0,
                        kind: "action",
                        fingerprint: "sha256:checkpoint",
                    },
                    jobId,
                    attempt: 1,
                    jobLeaseToken: "job-fence",
                    runLeaseToken: "run-fence",
                },
                idempotencyKey: "workflow-checkpoint-action-key",
            })).resolves.toEqual({
                sourceId: "source-checkpoint",
                cursor: "cursor-1",
                revision: 1,
                committed: true,
            });
            await expect(repository.getCheckpointSnapshot("source-checkpoint"))
                .resolves.toEqual({ cursor: "cursor-1", revision: 1 });
        } finally {
            await repository.close();
        }
    });
});

function prepareDatabase(root: string): void {
    const schema = resolve(
        process.cwd(),
        "packages/storage-prisma/prisma/schema.prisma",
    );
    const prismaCli = resolve(
        process.cwd(),
        "packages/storage-prisma/node_modules/prisma/build/index.js",
    );
    const databaseUrl = `file:${resolve(root, "cosmos.sqlite").replaceAll("\\", "/")}`;
    writeFileSync(resolve(root, "cosmos.sqlite"), new Uint8Array());
    execFileSync(process.execPath, [
        prismaCli,
        "db",
        "push",
        "--schema",
        schema,
        "--skip-generate",
    ], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
        },
        stdio: "ignore",
    });
}
