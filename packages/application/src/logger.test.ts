import { AsyncLocalStorage } from "node:async_hooks";

import { describe, expect, it } from "vitest";

import type {
    RunSnapshot,
    SourceConfigProbeCommand,
    SourceSnapshot,
    SourceProbeResult,
} from "@cosmos/contracts";

import {
    ConnectorRegistry,
    ConnectorProbeService,
    createBuiltinManifestCatalog,
    IngestionService,
    IngestionWorker,
    SourceConfigProbeService,
    type CosmosRepository,
    type IngestConnector,
    type LoggerContext,
    type LoggerPort,
} from "./index.js";

import { captureLogger, source } from "./test-support.js";

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
            listScheduleTriggers: async () => [],
            claimNextJob: async ({ acceptedKinds }: { acceptedKinds: readonly string[] }) => {
                expect(acceptedKinds).toEqual(["source-ingest", "source-probe", "source-config-probe"]);
                return {
                    id: "job-1",
                    runId: null,
                    kind: "source-probe",
                    leaseToken: "lease-1",
                    attempts: 1,
                    maxAttempts: 3,
                    payload: { sourceId: "source-1" },
                };
            },
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
            listScheduleTriggers: async () => [],
            claimNextJob: async ({ acceptedKinds }: { acceptedKinds: readonly string[] }) => {
                expect(acceptedKinds).toEqual(["source-ingest", "source-probe", "source-config-probe"]);
                return {
                    id: "job-2",
                    runId: null,
                    kind: "source-probe",
                    leaseToken: "lease-2",
                    attempts: 1,
                    maxAttempts: 3,
                    payload: { sourceId: "source-1" },
                };
            },
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
