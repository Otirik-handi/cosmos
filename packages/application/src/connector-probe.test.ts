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
} from "./connector-registry.js";
import {
    ConnectorProbeService,
    SourceConfigProbeService,
} from "./connector-probe.js";
import {
    createBuiltinManifestCatalog,
} from "./catalog.js";
import {
    IngestionService,
} from "./ingestion-service.js";
import {
    IngestionWorker,
} from "./ingestion-worker.js";
import type {
    CosmosRepository,
} from "./repository-port.js";
import type {
    IngestConnector,
} from "./connector-ports.js";
import type {
    LoggerContext,
    LoggerPort,
} from "./logger.js";

import { captureLogger, source } from "./test-support.js";

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
                        kind: "video",
                        publisher: null,
                        metrics: null,
                        publishedAt: null,
                        updatedAt: null,
                        sourceLocator: {},
                        rawPayload: "{}",
                        assets: [],
                    }, {
                        externalId: "bvid-2",
                        title: "Title 2",
                        summary: null,
                        contentText: "Content 2",
                        webUrl: null,
                        kind: "video",
                        publisher: null,
                        metrics: null,
                        publishedAt: null,
                        updatedAt: null,
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

describe("SourceConfigProbeService", () => {
    const probeCommand = {
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        config: { feedUrl: "https://example.test/feed.xml" },
    } as const;

    function rssConnectorFixture(items: Array<{ title: string }>): {
        connector: IngestConnector;
        seenSources: SourceSnapshot[];
    } {
        const seenSources: SourceSnapshot[] = [];
        const connector: IngestConnector = {
            id: "rss",
            description: "RSS",
            configVersion: "source.rss@1",
            capabilities: ["source:read"],
            validate: (source) => {
                seenSources.push(source);
            },
            async fetchItems(input) {
                seenSources.push(input.source);
                expect(input.cursor).toBeNull();
                return {
                    items: items.map((item, index) => ({
                        externalId: `probe-item-${index}`,
                        title: item.title,
                        summary: null,
                        contentText: "Should not be persisted",
                        webUrl: null,
                        kind: "article" as const,
                        publisher: null,
                        metrics: null,
                        publishedAt: null,
                        updatedAt: null,
                        sourceLocator: { provider: "rss" },
                        rawPayload: "{}",
                        assets: [],
                    })),
                    nextCursor: "probe-cursor",
                };
            },
        };
        return { connector, seenSources };
    }

    it("resolves the connector from the manifest and returns capped sample titles", async () => {
        const { connector, seenSources } = rssConnectorFixture([
            { title: "Alpha" },
            { title: "Beta" },
            { title: "Gamma" },
            { title: "Delta" },
        ]);
        const service = new SourceConfigProbeService(
            createBuiltinManifestCatalog(),
            new ConnectorRegistry([connector]),
            () => "2026-08-24T00:00:00.000Z",
        );

        await expect(service.run(probeCommand)).resolves.toEqual({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            itemCount: 4,
            nextCursorAvailable: true,
            sampleTitles: ["Alpha", "Beta", "Gamma"],
            checkedAt: "2026-08-24T00:00:00.000Z",
            durationMs: expect.any(Number),
        });
        // The connector received a transient, disabled snapshot derived from
        // the manifest identity chain, not a persisted source row.
        for (const seen of seenSources) {
            expect(seen).toMatchObject({
                id: "config-probe",
                connectorId: "rss",
                kind: "rss",
                enabled: false,
                config: probeCommand.config,
            });
        }
    });

    it("rejects unknown source definition refs before touching a connector", async () => {
        const service = new SourceConfigProbeService(
            createBuiltinManifestCatalog(),
            new ConnectorRegistry([]),
        );

        await expect(service.run({
            sourceDefinitionRef: "source.unknown@1",
            operationId: "fetch",
            config: {},
        })).rejects.toThrow("Source definition is not available: source.unknown@1");
    });

    it("rejects configs that violate the canonical schema at the prepare stage", async () => {
        const { logger, records } = captureLogger();
        const service = new SourceConfigProbeService(
            createBuiltinManifestCatalog(),
            new ConnectorRegistry([]),
            undefined,
            logger,
        );

        await expect(service.run({
            ...probeCommand,
            config: { feedUrl: "file:///etc/passwd" },
        })).rejects.toThrow();
        expect(records).toContainEqual(expect.objectContaining({
            event: "connector.config_probe.failed",
            level: "error",
            stage: "prepare",
        }));
    });

    it("logs fetch failures without persisting anything", async () => {
        const { logger, records } = captureLogger();
        const connector: IngestConnector = {
            id: "rss",
            description: "RSS",
            configVersion: "source.rss@1",
            capabilities: ["source:read"],
            validate: () => undefined,
            async fetchItems() {
                throw new Error("feed unavailable");
            },
        };
        const service = new SourceConfigProbeService(
            createBuiltinManifestCatalog(),
            new ConnectorRegistry([connector]),
            undefined,
            logger,
        );

        await expect(service.run(probeCommand)).rejects.toThrow("feed unavailable");
        expect(records).toContainEqual(expect.objectContaining({
            event: "connector.fetch.failed",
            level: "error",
            connectorId: "rss",
        }));
    });
});

describe("SourceConfigProbeService worker dispatch", () => {
    it("dispatches source-config-probe jobs with the parsed command", async () => {
        const capture = captureLogger();
        const command: SourceConfigProbeCommand = {
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: { feedUrl: "https://example.test/feed.xml" },
        };
        const receivedCommands: SourceConfigProbeCommand[] = [];
        const configProbe = {
            run: async (input: SourceConfigProbeCommand) => {
                receivedCommands.push(input);
                return {
                    sourceDefinitionRef: input.sourceDefinitionRef,
                    operationId: input.operationId,
                    connectorId: "rss",
                    itemCount: 1,
                    nextCursorAvailable: false,
                    sampleTitles: ["Alpha"],
                    checkedAt: "2026-08-24T00:00:00.000Z",
                    durationMs: 10,
                };
            },
        };
        const repository = {
            listSources: async () => [],
            listScheduleTriggers: async () => [],
            claimNextJob: async ({ acceptedKinds }: { acceptedKinds: readonly string[] }) => {
                expect(acceptedKinds).toEqual(["source-ingest", "source-probe", "source-config-probe"]);
                return {
                    id: "job-3",
                    runId: null,
                    kind: "source-config-probe",
                    leaseToken: "lease-3",
                    attempts: 1,
                    maxAttempts: 3,
                    payload: { configProbe: command },
                };
            },
            completeJob: async () => true,
        } as unknown as CosmosRepository;
        const worker = new IngestionWorker(
            repository,
            {} as IngestionService,
            {
                owner: "worker-1",
                leaseMs: 60_000,
                configProbe: configProbe as never,
                logger: capture.logger,
            },
        );

        await expect(worker.pollOnce()).resolves.toEqual({
            jobId: "job-3",
            runId: null,
            status: "succeeded",
            attempts: 1,
        });
        expect(receivedCommands).toEqual([command]);
        expect(capture.records).toContainEqual(expect.objectContaining({
            event: "job.completed",
            kind: "source-config-probe",
            status: "succeeded",
        }));
    });

    it("fails a config probe job terminally when no probe service is wired", async () => {
        const capture = captureLogger();
        const repository = {
            listSources: async () => [],
            listScheduleTriggers: async () => [],
            claimNextJob: async () => ({
                id: "job-4",
                runId: null,
                kind: "source-config-probe",
                leaseToken: "lease-4",
                attempts: 1,
                maxAttempts: 3,
                payload: { configProbe: {} },
            }),
            completeJob: async () => true,
        } as unknown as CosmosRepository;
        const worker = new IngestionWorker(
            repository,
            {} as IngestionService,
            { owner: "worker-1", leaseMs: 60_000, logger: capture.logger },
        );

        await expect(worker.pollOnce()).resolves.toEqual({
            jobId: "job-4",
            runId: null,
            status: "failed_terminal",
            attempts: 1,
        });
    });
});
