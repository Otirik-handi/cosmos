import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { IngestConnector } from "../../../packages/application/src/index.js";
import type { NormalizedIngestItem } from "../../../packages/domain/src/index.js";

import {
    createIngestActions,
    createIngestWorkflowDefinition,
} from "../../../packages/application/src/workflow-ingest.js";
import { IngestWorkflowControlService } from "../../../packages/application/src/workflow-control.js";
import { PrismaCosmosRepository } from "@cosmos/storage-prisma";

import { createWorkflowHost } from "./workflow-host.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
});

describe("Worker Ingest Workflow composition", () => {
    it("keeps durable ingest parity across idempotency, snapshots, revisions and projections", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-workflow-ingest-parity-"));
        temporaryRoots.push(root);
        prepareDatabase(root);
        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await repository.createSource({
                name: "Workflow fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            const otherSource = await repository.createSource({
                name: "Other workflow fixture",
                kind: "fixture-rss",
                config: {},
                enabled: true,
            });
            const imageV1 = new TextEncoder().encode("workflow-image-v1");
            const imageV2 = new TextEncoder().encode("workflow-image-v2");
            const firstPage: readonly NormalizedIngestItem[] = [{
                externalId: "workflow-item-1",
                title: "Workflow item",
                summary: "A durable workflow item.",
                contentText: "Workflow original content.",
                webUrl: "https://example.test/workflow-item-1",
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "workflow-item-1" },
                rawPayload: "<item id=\"workflow-item-1\" version=\"1\" />",
                assets: [
                    {
                        kind: "image",
                        sourceUrl: "https://example.test/workflow-image-v1.png",
                        status: "saved",
                        mimeType: "image/png",
                        byteSize: imageV1.byteLength,
                        content: imageV1,
                    },
                    {
                        kind: "attachment",
                        sourceUrl: null,
                        status: "metadata_only",
                        mimeType: "application/pdf",
                        byteSize: 123,
                        content: null,
                    },
                ],
            }, {
                title: "URL-free workflow item",
                summary: null,
                contentText: "URL-free workflow body.",
                webUrl: null,
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "url-free" },
                rawPayload: "<item locator=\"url-free\" />",
                assets: [],
            }];
            const secondPage: readonly NormalizedIngestItem[] = [{
                externalId: "workflow-item-1",
                title: "Workflow item revised",
                summary: "The revised durable workflow item.",
                contentText: "Workflow revised content.",
                webUrl: "https://example.test/workflow-item-1",
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "workflow-item-1" },
                rawPayload: "<item id=\"workflow-item-1\" version=\"2\" />",
                assets: [
                    {
                        kind: "image",
                        sourceUrl: "https://example.test/workflow-image-v2.png",
                        status: "saved",
                        mimeType: "image/png",
                        byteSize: imageV2.byteLength,
                        content: imageV2,
                    },
                    {
                        kind: "attachment",
                        sourceUrl: null,
                        status: "metadata_only",
                        mimeType: "application/pdf",
                        byteSize: 456,
                        content: null,
                    },
                ],
            }, {
                title: "URL-free workflow item",
                summary: null,
                contentText: "URL-free workflow body.",
                webUrl: null,
                kind: "article",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "url-free" },
                rawPayload: "<item locator=\"url-free\" />",
                assets: [],
            }];
            let fetchCount = 0;
            const connectorCalls: Array<{
                name: string;
                enabled: boolean;
                config: unknown;
                cursor: string | null;
            }> = [];
            const connector: IngestConnector = {
                id: "fixture-rss",
                description: "Workflow fixture connector.",
                configVersion: "fixture-rss@1",
                capabilities: ["source:read"],
                validate: () => undefined,
                fetchItems: async ({ source: receivedSource, cursor }) => {
                    connectorCalls.push({
                        name: receivedSource.name,
                        enabled: receivedSource.enabled,
                        config: receivedSource.config,
                        cursor,
                    });
                    const page = fetchCount === 0
                        ? { items: firstPage, nextCursor: "cursor-1" }
                        : { items: secondPage, nextCursor: "cursor-2" };
                    fetchCount += 1;
                    return page;
                },
            };
            const createComposition = (owner: string) => createWorkflowHost({
                prisma: repository.prisma,
                blobs: repository.blobs,
                definitions: [createIngestWorkflowDefinition()],
                actions: createIngestActions({
                    resolveConnector: () => connector,
                    blobs: repository.blobs,
                    domain: repository,
                }),
                owner,
                leaseMs: 60_000,
            });
            const getSourceExecutionSnapshot = async (sourceId: string) => {
                const current = await repository.getSource(sourceId);
                if (!current) return null;
                return {
                    id: current.id,
                    name: current.name,
                    kind: current.kind,
                    config: current.config,
                    enabled: current.enabled,
                    createdAt: current.createdAt,
                    updatedAt: current.updatedAt,
                };
            };
            const composition = createComposition("workflow-parity-worker");
            const control = new IngestWorkflowControlService({
                store: composition.store,
                getSourceExecutionSnapshot,
                getCheckpointSnapshot: (sourceId) => repository.getCheckpointSnapshot(sourceId),
            });
            const firstRun = await control.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "workflow-parity-1",
            });
            expect(firstRun.inputSnapshot).toMatchObject({
                source: {
                    id: source.id,
                    name: "Workflow fixture",
                    config: {},
                    enabled: true,
                },
                cursor: null,
                checkpointRevision: 0,
            });
            await expect(control.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "workflow-parity-1",
            })).resolves.toEqual(firstRun);
            await expect(control.enqueue({
                sourceId: otherSource.id,
                triggerKind: "manual",
                idempotencyKey: "workflow-parity-1",
            })).rejects.toThrow("conflicts with another source run");

            await repository.prisma.sourceInstance.update({
                where: { id: source.id },
                data: {
                    name: "Mutated workflow fixture",
                    configJson: JSON.stringify({ fixturePath: "mutated-fixture.xml" }),
                    enabled: false,
                },
            });

            const firstCompleted = await drainWorkflow(composition, firstRun.runId);
            expect(firstCompleted.status).toBe("completed");
            expect(await repository.getCheckpointSnapshot(source.id)).toEqual({
                cursor: "cursor-1",
                revision: 1,
            });
            expect(connectorCalls[0]).toMatchObject({
                name: "Workflow fixture",
                enabled: true,
                config: {},
                cursor: null,
            });

            const firstRunReplay = await control.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "workflow-parity-1",
            });
            expect(firstRunReplay.runId).toBe(firstRun.runId);
            expect(connectorCalls).toHaveLength(1);

            const restartedComposition = createComposition("workflow-parity-worker-restarted");
            const restartedControl = new IngestWorkflowControlService({
                store: restartedComposition.store,
                getSourceExecutionSnapshot,
                getCheckpointSnapshot: (sourceId) => repository.getCheckpointSnapshot(sourceId),
            });
            const secondRun = await restartedControl.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "workflow-parity-2",
            });
            await expect(restartedControl.enqueue({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "workflow-parity-2",
            })).resolves.toEqual(secondRun);
            const secondCompleted = await drainWorkflow(restartedComposition, secondRun.runId);
            expect(secondCompleted.status).toBe("completed");
            expect(await repository.getCheckpointSnapshot(source.id)).toEqual({
                cursor: "cursor-2",
                revision: 2,
            });
            expect(connectorCalls).toHaveLength(2);
            expect(connectorCalls[1]).toMatchObject({
                name: "Mutated workflow fixture",
                enabled: false,
                config: { fixturePath: "mutated-fixture.xml" },
                cursor: "cursor-1",
            });

            const entries = await repository.entries({ sourceId: source.id, limit: 10 });
            expect(entries.items).toHaveLength(2);
            const revisedEntry = entries.items.find((item) => item.title === "Workflow item revised");
            const urlFreeEntry = entries.items.find((item) => item.title === "URL-free workflow item");
            if (!revisedEntry || !urlFreeEntry) {
                throw new Error("workflow parity entries were not projected");
            }
            expect(revisedEntry.revisionCount).toBe(2);
            expect(revisedEntry.observationCount).toBe(2);
            expect(revisedEntry.webUrl).toBe("https://example.test/workflow-item-1");
            expect(urlFreeEntry.revisionCount).toBe(1);
            expect(urlFreeEntry.observationCount).toBe(2);
            expect(urlFreeEntry.webUrl).toBeNull();

            const feed = await repository.feed({ limit: 10 });
            expect(feed.items).toHaveLength(2);
            const revisedFeed = feed.items.find((item) => item.entryId === revisedEntry.id);
            const urlFreeFeed = feed.items.find((item) => item.entryId === urlFreeEntry.id);
            expect(revisedFeed).toMatchObject({
                entryId: revisedEntry.id,
                revisionId: revisedEntry.currentRevisionId,
            });
            expect(urlFreeFeed).toMatchObject({
                entryId: urlFreeEntry.id,
                revisionId: urlFreeEntry.currentRevisionId,
                publishedAt: null,
            });
            expect(revisedFeed?.assets.map((asset) => asset.status).sort()).toEqual([
                "metadata_only",
                "saved",
            ]);
            expect(urlFreeFeed?.assets).toEqual([]);

            const revisedDetail = await repository.entry(revisedEntry.id);
            const urlFreeDetail = await repository.entry(urlFreeEntry.id);
            if (!revisedDetail || !urlFreeDetail) {
                throw new Error("workflow parity entry details were not persisted");
            }
            expect(revisedDetail.revisions).toHaveLength(2);
            expect(revisedDetail.observations).toHaveLength(2);
            expect(revisedDetail.observations.every((observation) => (
                observation.externalId === "workflow-item-1"
            ))).toBe(true);
            expect(urlFreeDetail.revisions).toHaveLength(1);
            expect(urlFreeDetail.observations).toHaveLength(2);
            expect(urlFreeDetail.observations.every((observation) => (
                observation.externalId === null
                && observation.webUrl === null
                && observation.externalKey.startsWith("fallback:")
            ))).toBe(true);
            expect(urlFreeDetail.revisions[0]?.webUrl).toBeNull();

            const originalRevision = revisedDetail.revisions.find((revision) => revision.revision === 1);
            const currentRevision = revisedDetail.revisions.find((revision) => revision.revision === 2);
            if (!originalRevision || !currentRevision) {
                throw new Error("workflow parity revision history was not retained");
            }
            expect(originalRevision.contentText).toBe("Workflow original content.");
            expect(currentRevision.contentText).toBe("Workflow revised content.");
            expect(originalRevision.assets.map((asset) => asset.status).sort()).toEqual([
                "metadata_only",
                "saved",
            ]);
            expect(currentRevision.assets.map((asset) => asset.status).sort()).toEqual([
                "metadata_only",
                "saved",
            ]);
            const originalSavedAsset = originalRevision.assets.find((asset) => asset.status === "saved");
            const currentSavedAsset = currentRevision.assets.find((asset) => asset.status === "saved");
            const currentMetadataAsset = currentRevision.assets.find((asset) => asset.status === "metadata_only");
            if (!originalSavedAsset || !currentSavedAsset || !currentMetadataAsset) {
                throw new Error("workflow parity assets were not persisted");
            }
            expect(originalSavedAsset.storageKey).not.toBeNull();
            expect(currentSavedAsset.storageKey).not.toBeNull();
            expect(currentMetadataAsset.storageKey).toBeNull();
            const originalAssetContent = await repository.readAsset(originalSavedAsset.id);
            const currentAssetContent = await repository.readAsset(currentSavedAsset.id);
            if (!originalAssetContent || !currentAssetContent) {
                throw new Error("workflow saved asset content was not readable");
            }
            expect(originalAssetContent.mimeType).toBe("image/png");
            expect(currentAssetContent.mimeType).toBe("image/png");
            expect(new TextDecoder().decode(originalAssetContent.content)).toBe("workflow-image-v1");
            expect(new TextDecoder().decode(currentAssetContent.content)).toBe("workflow-image-v2");
            await expect(repository.readAsset(currentMetadataAsset.id)).resolves.toBeNull();

            if (!revisedEntry.storyId) throw new Error("workflow parity story id missing");
            const story = await repository.story(revisedEntry.storyId);
            if (!story) throw new Error("workflow parity story was not projected");
            expect(story.story).toMatchObject({
                id: revisedEntry.storyId,
                title: "Workflow item revised",
            });
            expect(story.entry.id).toBe(revisedEntry.id);
            expect(story.entry.revisions).toHaveLength(2);
            expect(story.entry.observations).toHaveLength(2);

            const originalRevisionDetail = await repository.revision(originalRevision.id);
            const currentRevisionDetail = await repository.revision(currentRevision.id);
            expect(originalRevisionDetail).toMatchObject({
                id: originalRevision.id,
                entryId: revisedEntry.id,
                revision: 1,
                contentText: "Workflow original content.",
            });
            expect(currentRevisionDetail).toMatchObject({
                id: currentRevision.id,
                entryId: revisedEntry.id,
                revision: 2,
                contentText: "Workflow revised content.",
            });

            expect((await repository.search({
                text: "Workflow revised content",
                limit: 10,
            })).items.map((item) => item.entryId)).toEqual([revisedEntry.id]);
            expect((await repository.search({
                text: "Workflow original content",
                limit: 10,
            })).items).toHaveLength(0);
            expect((await repository.search({ text: "URL", limit: 10 })).items.map(
                (item) => item.entryId,
            )).toEqual([urlFreeEntry.id]);

            const events = await repository.events({ afterSequence: 0, limit: 500 });
            expect(events.filter((event) => event.type === "entry.created.v1")).toHaveLength(2);
            expect(events.filter((event) => event.type === "entry.revised.v1")).toHaveLength(1);
            expect(events.filter((event) => event.type === "feed.updated.v1")).toHaveLength(3);
            expect(events.filter((event) => event.type === "ingest.page.persisted")).toHaveLength(2);

            const activityJobs = await repository.prisma.job.findMany({
                where: { workflowRunId: firstRun.runId, kind: "workflow-activity" },
                orderBy: { createdAt: "asc" },
            });
            const sourceFetchJob = activityJobs.find((job) => {
                const payload = job.payloadJson ? JSON.parse(job.payloadJson) as {
                    reference?: unknown;
                } : null;
                return payload?.reference === "source.fetch@1";
            });
            expect(sourceFetchJob).toBeDefined();
            if (!sourceFetchJob?.resultJson) throw new Error("source.fetch result missing");
            const sourceFetchResult = JSON.parse(sourceFetchJob.resultJson) as {
                items?: Array<{
                    assets?: Array<{
                        status?: string;
                        blobRef?: { key?: string; hash?: string; byteSize?: number } | null;
                    }>;
                }>;
            };
            expect(sourceFetchResult.items?.[0]?.assets?.[0]?.status).toBe("saved");
            expect(sourceFetchResult.items?.[0]?.assets?.[0]?.blobRef).toMatchObject({
                key: expect.any(String),
                hash: expect.any(String),
                byteSize: imageV1.byteLength,
            });
            expect(sourceFetchResult.items?.[0]?.assets?.[1]).toMatchObject({
                status: "metadata_only",
                blobRef: null,
            });

            const firstJob = activityJobs.find((job) => {
                const payload = job.payloadJson ? JSON.parse(job.payloadJson) as {
                    reference?: unknown;
                } : null;
                return payload?.reference !== "source.fetch@1";
            });
            expect(firstJob).not.toBeUndefined();
            if (!firstJob) throw new Error("workflow activity job missing");
            const attempts = await repository.listWorkflowAttempts(firstJob.id);
            expect(attempts).toHaveLength(1);
            expect(attempts[0]).toMatchObject({
                jobId: firstJob.id,
                number: 1,
                status: "succeeded",
                workerId: "workflow-parity-worker",
            });
            expect(await repository.getWorkflowAttempt(attempts[0].id)).toEqual(attempts[0]);
        } finally {
            await repository.close();
        }
    }, 15_000);
});

async function drainWorkflow(
    composition: ReturnType<typeof createWorkflowHost>,
    runId: string,
) {
    for (let index = 0; index < 60; index += 1) {
        await composition.runLane.pollOnce();
        await composition.activityWorker.pollOnce();
        await composition.completionDispatcher.pollOnce();
        const current = await composition.store.loadWorkflowEnvelope(runId);
        if (!current) continue;
        if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
            return current;
        }
    }
    throw new Error(`Workflow ${runId} did not reach a terminal state.`);
}

function prepareDatabase(root: string): void {
    const schema = resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma");
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
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "ignore",
    });
}
