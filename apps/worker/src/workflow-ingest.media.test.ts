import { afterEach, describe, expect, it } from "vitest";
import {
    createMediaAcquirer,
    mediaDownloadCapability,
    type IngestConnector,
} from "../../../packages/application/src/index.js";
import type { NormalizedIngestItem } from "../../../packages/domain/src/index.js";

import {
    createIngestActions,
    createIngestWorkflowDefinition,
} from "../../../packages/application/src/workflow-ingest.js";
import { IngestWorkflowControlService } from "../../../packages/application/src/workflow-control.js";
import { createWorkflowHost } from "./workflow-host.js";
import {
    cleanupTemporaryRoots,
    createFixtureSource,
    drainWorkflow,
    withRepository,
} from "./workflow-ingest.fixtures.js";

afterEach(cleanupTemporaryRoots);

describe("Worker Ingest Workflow composition", () => {
    it("does not re-acquire media when a later run sees unchanged items", async () => {
        await withRepository("workflow-media-skip", async (repository) => {
            const source = await createFixtureSource(repository, "Media skip workflow");
            const item: NormalizedIngestItem = {
                externalId: "media-skip-1",
                title: "Media skip item",
                summary: null,
                contentText: "Unchanged media body",
                webUrl: "https://example.test/media-skip",
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "media-skip-1" },
                rawPayload: "<item>media-skip</item>",
                assets: [{
                    kind: "image",
                    sourceUrl: "https://media.example.test/a.png",
                    status: "metadata_only",
                    mimeType: null,
                    byteSize: null,
                    content: null,
                }],
            };
            const fetched: string[] = [];
            const connector: IngestConnector = {
                id: "rss",
                description: "Media skip workflow connector",
                configVersion: "v1",
                capabilities: [mediaDownloadCapability],
                validate: () => undefined,
                fetchItems: async () => ({
                    items: [item],
                    nextCursor: null,
                }),
            };
            const mediaAcquirer = createMediaAcquirer({
                fetch: async (input) => {
                    fetched.push(String(input));
                    return new Response(
                        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                        { status: 200, headers: { "content-type": "image/png" } },
                    );
                },
                resolveHost: async () => ["93.184.216.34"],
            });
            const composition = createWorkflowHost({
                prisma: repository.prisma,
                blobs: repository.blobs,
                definitions: [createIngestWorkflowDefinition()],
                actions: createIngestActions({
                    resolveConnector: () => connector,
                    blobs: repository.blobs,
                    domain: repository,
                    unchangedItems: repository,
                    mediaAcquirer,
                }),
                owner: "media-skip-worker",
                leaseMs: 60_000,
            });
            const control = new IngestWorkflowControlService({
                store: composition.store,
                getSourceExecutionSnapshot: async (sourceId) => (
                    await repository.getSource(sourceId) ?? null
                ),
                getCheckpointSnapshot: (sourceId) => repository.getCheckpointSnapshot(sourceId),
            });

            const firstRun = await control.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "media-skip-run-1",
            });
            await expect(drainWorkflow(composition, firstRun.runId)).resolves.toMatchObject({
                status: "completed",
            });
            // Enqueue only after the first Run finished: the point of the case is
            // a later Run observing persisted content, not two racing Runs.
            const secondRun = await control.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "media-skip-run-2",
            });
            await expect(drainWorkflow(composition, secondRun.runId)).resolves.toMatchObject({
                status: "completed",
            });

            expect(fetched).toHaveLength(1);
            const entries = await repository.entries({ sourceId: source.id, limit: 10 });
            expect(entries.items).toHaveLength(1);
            expect(entries.items[0]?.revisionCount).toBe(1);
            expect(entries.items[0]?.observationCount).toBe(2);
        });
    });

    it("honours the plan's media policy frozen into the run snapshot", async () => {
        await withRepository("workflow-media-policy", async (repository) => {
            const created = await repository.createSource({
                name: "Media policy workflow",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            // 媒体预算归计划（ADR-0023 决策 2）：策略从计划端点写入，再入队固化到执行快照。
            await repository.updateCollectionPlan(created.planId, {
                enabled: true,
                mediaPolicy: { images: "metadata_only" },
                baseRevisionId: created.planRevisionId,
            });
            const source = await repository.getSource(created.id) as NonNullable<
                Awaited<ReturnType<typeof repository.getSource>>
            >;
            expect(source.mediaPolicy).toEqual({ images: "metadata_only" });
            const item: NormalizedIngestItem = {
                externalId: "media-policy-1",
                title: "Media policy item",
                summary: null,
                contentText: "Body with one image candidate",
                webUrl: "https://example.test/media-policy",
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "media-policy-1" },
                rawPayload: "<item>media-policy</item>",
                assets: [{
                    kind: "image",
                    sourceUrl: "https://media.example.test/a.png",
                    status: "metadata_only",
                    mimeType: null,
                    byteSize: null,
                    content: null,
                }],
            };
            const fetched: string[] = [];
            const connector: IngestConnector = {
                id: "rss",
                description: "Media policy workflow connector",
                configVersion: "v1",
                capabilities: [mediaDownloadCapability],
                validate: () => undefined,
                fetchItems: async () => ({
                    items: [item],
                    nextCursor: null,
                }),
            };
            const mediaAcquirer = createMediaAcquirer({
                fetch: async (input) => {
                    fetched.push(String(input));
                    return new Response(
                        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                        { status: 200, headers: { "content-type": "image/png" } },
                    );
                },
                resolveHost: async () => ["93.184.216.34"],
            });
            const composition = createWorkflowHost({
                prisma: repository.prisma,
                blobs: repository.blobs,
                definitions: [createIngestWorkflowDefinition()],
                actions: createIngestActions({
                    resolveConnector: () => connector,
                    blobs: repository.blobs,
                    domain: repository,
                    unchangedItems: repository,
                    mediaAcquirer,
                }),
                owner: "media-policy-worker",
                leaseMs: 60_000,
            });
            const control = new IngestWorkflowControlService({
                store: composition.store,
                getSourceExecutionSnapshot: async (sourceId) => (
                    await repository.getSource(sourceId) ?? null
                ),
                getCheckpointSnapshot: (sourceId) => repository.getCheckpointSnapshot(sourceId),
            });

            const run = await control.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "media-policy-run-1",
            });
            await expect(drainWorkflow(composition, run.runId)).resolves.toMatchObject({
                status: "completed",
            });

            // images: metadata_only leaves the connector output untouched.
            expect(fetched).toEqual([]);
            const fetchJob = await repository.prisma.job.findFirst({
                where: { workflowRunId: run.runId, kind: "workflow-activity" },
                orderBy: { createdAt: "asc" },
            });
            expect(fetchJob?.resultJson).toBeTruthy();
            const fetchResult = JSON.parse(fetchJob!.resultJson!) as {
                items?: Array<{ assets?: Array<{ status?: string; blobRef?: unknown }> }>;
            };
            expect(fetchResult.items?.[0]?.assets?.[0]).toMatchObject({
                status: "metadata_only",
                blobRef: null,
            });
        });
    });

    it("retries degraded media on the next run without creating a new revision", async () => {
        await withRepository("workflow-media-retry", async (repository) => {
            const created = await repository.createSource({
                name: "Media retry workflow",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            await repository.updateCollectionPlan(created.planId, {
                enabled: true,
                baseRevisionId: created.planRevisionId,
            });
            const source = await repository.getSource(created.id) as NonNullable<
                Awaited<ReturnType<typeof repository.getSource>>
            >;
            const item: NormalizedIngestItem = {
                externalId: "media-retry-1",
                title: "Media retry item",
                summary: null,
                contentText: "Body with one flaky image candidate",
                webUrl: "https://example.test/media-retry",
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "media-retry-1" },
                rawPayload: "<item>media-retry</item>",
                assets: [{
                    kind: "image",
                    sourceUrl: "https://media.example.test/flaky.png",
                    status: "metadata_only",
                    mimeType: null,
                    byteSize: null,
                    content: null,
                }],
            };
            const connector: IngestConnector = {
                id: "rss",
                description: "Media retry workflow connector",
                configVersion: "v1",
                capabilities: [mediaDownloadCapability],
                validate: () => undefined,
                fetchItems: async () => ({ items: [item], nextCursor: null }),
            };
            let downloads = 0;
            const mediaAcquirer = createMediaAcquirer({
                fetch: async () => {
                    downloads += 1;
                    if (downloads === 1) {
                        throw new Error("temporary network failure");
                    }
                    return new Response(
                        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                        { status: 200, headers: { "content-type": "image/png" } },
                    );
                },
                resolveHost: async () => ["93.184.216.34"],
            });
            const composition = createWorkflowHost({
                prisma: repository.prisma,
                blobs: repository.blobs,
                definitions: [createIngestWorkflowDefinition()],
                actions: createIngestActions({
                    resolveConnector: () => connector,
                    blobs: repository.blobs,
                    domain: repository,
                    unchangedItems: repository,
                    mediaAcquirer,
                    mediaRetrier: mediaAcquirer,
                    retryCandidates: repository,
                }),
                owner: "media-retry-worker",
                leaseMs: 60_000,
            });
            const control = new IngestWorkflowControlService({
                store: composition.store,
                getSourceExecutionSnapshot: async (sourceId) => (
                    await repository.getSource(sourceId) ?? null
                ),
                getCheckpointSnapshot: (sourceId) => repository.getCheckpointSnapshot(sourceId),
            });

            const firstRun = await control.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "media-retry-run-1",
            });
            await expect(drainWorkflow(composition, firstRun.runId)).resolves.toMatchObject({
                status: "completed",
            });
            const degraded = await repository.prisma.asset.findFirstOrThrow({
                where: { entryRevision: { entry: { sourceInstanceId: source.id } } },
            });
            expect(degraded).toMatchObject({
                status: "failed",
                errorCode: "network",
                attemptCount: 1,
            });

            // Second run: the item is unchanged, so only the retry step touches it.
            const secondRun = await control.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "media-retry-run-2",
            });
            await expect(drainWorkflow(composition, secondRun.runId)).resolves.toMatchObject({
                status: "completed",
            });
            const recovered = await repository.prisma.asset.findUniqueOrThrow({
                where: { id: degraded.id },
            });
            expect(recovered).toMatchObject({
                status: "saved",
                errorCode: null,
                errorMessage: null,
                attemptCount: 2,
            });
            expect(recovered.storageKey).toMatch(/^sha256\//);
            expect(downloads).toBe(2);
            expect(await repository.prisma.entryRevision.count({
                where: { entry: { sourceInstanceId: source.id } },
            })).toBe(1);
            expect(await repository.prisma.domainEvent.count({
                where: { type: "media.retry.attempted.v1" },
            })).toBe(1);
        });
    });
});
