import { AsyncLocalStorage } from "node:async_hooks";

import { describe, expect, it } from "vitest";

import type {
    RunSnapshot,
    SourceSnapshot,
    SourceProbeResult,
} from "@cosmos/contracts";

import {
    ConnectorRegistry,
    ConnectorProbeService,
    IngestionService,
    IngestionWorker,
    type CosmosRepository,
    type IngestConnector,
    type LoggerContext,
    type LoggerPort,
} from "./index.js";

function captureLogger(): {
    logger: LoggerPort;
    records: Array<Record<string, unknown>>;
} {
    const storage = new AsyncLocalStorage<LoggerContext>();
    const records: Array<Record<string, unknown>> = [];
    const create = (localContext: LoggerContext = {}): LoggerPort => ({
        child(context) {
            return create({ ...localContext, ...context });
        },
        withContext<T>(
            context: LoggerContext,
            callback: () => T | Promise<T>,
        ): T | Promise<T> {
            return storage.run({
                ...storage.getStore(),
                ...localContext,
                ...context,
            }, callback);
        },
        debug(event, fields = {}) {
            records.push({
                ...storage.getStore(),
                ...localContext,
                ...fields,
                event,
                level: "debug",
            });
        },
        info(event, fields = {}) {
            records.push({
                ...storage.getStore(),
                ...localContext,
                ...fields,
                event,
                level: "info",
            });
        },
        warn(event, fields = {}) {
            records.push({
                ...storage.getStore(),
                ...localContext,
                ...fields,
                event,
                level: "warn",
            });
        },
        error(event, fields = {}, error) {
            records.push({
                ...storage.getStore(),
                ...localContext,
                ...fields,
                event,
                level: "error",
                ...(error ? { error: String(error) } : {}),
            });
        },
    });
    return {
        logger: create(),
        records,
    };
}

function source(input: Partial<SourceSnapshot> = {}): SourceSnapshot {
    return {
        id: "source-1",
        name: "Bilibili",
        kind: "bilibili",
        config: { mode: "hot", limit: 5 },
        enabled: true,
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
        lastRunAt: null,
        lastError: null,
        ...input,
    };
}

describe("ConnectorRegistry", () => {
    it("resolves by business source kind and describes config version", () => {
        const connector: IngestConnector = {
            id: "bilibili",
            description: "Bilibili",
            configVersion: "v1",
            capabilities: ["opencli"],
            validate: () => undefined,
            async fetchItems() {
                return { items: [], nextCursor: null };
            },
        };
        const registry = new ConnectorRegistry([connector]);

        expect(registry.resolve(source())).toBe(connector);
        expect(registry.descriptors()).toEqual([{
            id: "bilibili",
            description: "Bilibili",
            capabilities: ["opencli"],
            configVersion: "v1",
        }]);
    });
});

describe("ConnectorProbeService", () => {
    it("fetches a sample without writing an observation or checkpoint", async () => {
        const probeResult: SourceProbeResult = {
            sourceId: "source-1",
            connectorId: "bilibili",
            itemCount: 2,
            nextCursorAvailable: true,
            checkedAt: "2026-08-08T00:00:00.000Z",
        };
        const connector: IngestConnector = {
            id: "bilibili",
            description: "Bilibili",
            configVersion: "v1",
            capabilities: [],
            validate: () => undefined,
            async fetchItems(input) {
                expect(input.cursor).toBeNull();
                return {
                    items: [{
                        externalId: "bvid-1",
                        title: "Title",
                        summary: null,
                        contentText: "Content",
                        webUrl: null,
                        sourcePublishedAt: null,
                        sourceLocator: {},
                        rawPayload: "{}",
                        assets: [],
                    }, {
                        externalId: "bvid-2",
                        title: "Title 2",
                        summary: null,
                        contentText: "Content 2",
                        webUrl: null,
                        sourcePublishedAt: null,
                        sourceLocator: {},
                        rawPayload: "{}",
                        assets: [],
                    }],
                    nextCursor: "must-not-be-persisted",
                };
            },
        };
        const repository = {
            getSource: async () => source(),
        } as unknown as CosmosRepository;
        const service = new ConnectorProbeService(
            repository,
            () => connector,
            () => probeResult.checkedAt,
        );

        await expect(service.runSource(source().id)).resolves.toEqual(probeResult);
    });

    it("logs source lookup failures with the probe source context", async () => {
        const { logger, records } = captureLogger();
        const service = new ConnectorProbeService(
            {
                getSource: async () => {
                    throw new Error("repository unavailable");
                },
            },
            () => {
                throw new Error("connector should not resolve");
            },
            undefined,
            logger,
        );

        await expect(service.runSource("source-lookup-failure"))
            .rejects.toThrow("repository unavailable");
        expect(records).toContainEqual(expect.objectContaining({
            event: "connector.probe.failed",
            level: "error",
            sourceId: "source-lookup-failure",
            stage: "prepare",
        }));
    });
});

describe("runtime logging context", () => {
    it("propagates Run, Job, Source and Connector ids into connector work", async () => {
        const { logger, records } = captureLogger();
        const connector: IngestConnector = {
            id: "bilibili",
            description: "Bilibili",
            configVersion: "v1",
            capabilities: [],
            validate: () => undefined,
            async fetchItems() {
                logger.info("connector.inside");
                return { items: [], nextCursor: null };
            },
        };
        const run: RunSnapshot = {
            id: "run-1",
            sourceId: "source-1",
            triggerKind: "manual",
            status: "queued",
            createdAt: "2026-08-08T00:00:00.000Z",
            startedAt: null,
            finishedAt: null,
            itemCount: 0,
            createdEntryCount: 0,
            revisedEntryCount: 0,
            error: null,
        };
        const repository = {
            getRun: async () => run,
            getSource: async () => source(),
            startRun: async () => ({ ...run, status: "running" }),
            getCheckpoint: async () => null,
            persistIngestItem: async () => ({
                createdEntry: false,
                revisedEntry: false,
                duplicateObservation: true,
            }),
            setCheckpoint: async () => undefined,
            completeRun: async () => ({ ...run, status: "succeeded" }),
        } as unknown as CosmosRepository;
        const service = new IngestionService(
            repository,
            () => connector,
            logger,
        );

        await service.runExistingRunWithLease("run-1", {
            jobId: "job-1",
            leaseToken: "lease-1",
        });

        const record = records
            .find((item) => item.event === "connector.inside");
        expect(record).toMatchObject({
            runId: "run-1",
            jobId: "job-1",
            sourceId: "source-1",
            connectorId: "bilibili",
        });
    });

    it("records rejected and failed Job completion without claiming success", async () => {
        const rejectedCapture = captureLogger();
        const rejectedRepository = {
            listSources: async () => [],
            claimNextJob: async () => ({
                id: "job-1",
                runId: null,
                kind: "source-probe",
                leaseToken: "lease-1",
                attempts: 1,
                maxAttempts: 3,
                payload: { sourceId: "source-1" },
            }),
            completeJob: async () => false,
        } as unknown as CosmosRepository;
        const rejectedWorker = new IngestionWorker(
            rejectedRepository,
            {} as IngestionService,
            {
                owner: "worker-1",
                leaseMs: 60_000,
                probe: {
                    runSource: async () => ({
                        sourceId: "source-1",
                        connectorId: "bilibili",
                        itemCount: 0,
                        nextCursorAvailable: false,
                        checkedAt: "2026-08-08T00:00:00.000Z",
                    }),
                } as unknown as ConnectorProbeService,
                logger: rejectedCapture.logger,
            },
        );

        await expect(rejectedWorker.pollOnce()).resolves.toBeNull();
        expect(rejectedCapture.records.some((record) => (
            record.event === "job.completion_rejected"
        ))).toBe(true);

        const failedCapture = captureLogger();
        const failedRepository = {
            listSources: async () => [],
            claimNextJob: async () => ({
                id: "job-2",
                runId: null,
                kind: "source-probe",
                leaseToken: "lease-2",
                attempts: 1,
                maxAttempts: 3,
                payload: { sourceId: "source-1" },
            }),
            completeJob: async () => {
                throw new Error("database unavailable");
            },
        } as unknown as CosmosRepository;
        const failedWorker = new IngestionWorker(
            failedRepository,
            {} as IngestionService,
            {
                owner: "worker-1",
                leaseMs: 60_000,
                probe: {
                    runSource: async () => ({
                        sourceId: "source-1",
                        connectorId: "bilibili",
                        itemCount: 0,
                        nextCursorAvailable: false,
                        checkedAt: "2026-08-08T00:00:00.000Z",
                    }),
                } as unknown as ConnectorProbeService,
                logger: failedCapture.logger,
            },
        );

        await expect(failedWorker.pollOnce()).resolves.toBeNull();
        expect(failedCapture.records.some((record) => (
            record.event === "job.completion_failed"
        ))).toBe(true);
    });
});
