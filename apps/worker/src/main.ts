import { hostname } from "node:os";

import {
    ConnectorProbeService,
    createBuiltinManifestCatalog,
    IngestionService,
    IngestionWorker,
} from "@cosmos/application";
import {
    createIngestActions,
    createIngestWorkflowDefinition,
} from "@cosmos/application/workflow-ingest";
import { IngestWorkflowControlService } from "@cosmos/application/workflow-control";
import { createLogger } from "@cosmos/logging";
import { createBuiltInConnectorRegistry } from "@cosmos/plugin-collectors";
import { PrismaCosmosRepository } from "@cosmos/storage-prisma";
import { createWorkerAdminServer, type ComponentHealth, type WorkerAdminServer } from "@cosmos/worker-admin";
import { parseWorkerRuntimeConfig } from "./config.js";
import { WorkerRuntime } from "./runtime.js";
import { createProxyFetch, describeProxyConfig } from "./proxy-fetch.js";
import { createWorkflowHost } from "./workflow-host.js";

async function bootstrap(): Promise<void> {
    // Parse all untrusted numeric configuration before constructing any
    // repository, connector, durable host or Admin listener.
    const config = parseWorkerRuntimeConfig();
    const instanceId = `${hostname()}:${process.pid}`;
    const logger = createLogger({
        service: "cosmos-worker",
        fileName: "worker",
        instanceId,
    });
    const catalog = createBuiltinManifestCatalog();
    const repository = new PrismaCosmosRepository({ logger, catalog });
    const proxyConfig = describeProxyConfig(process.env);
    if (proxyConfig.enabled) {
        logger.info("network.proxy.enabled", {
            proxyHost: proxyConfig.proxyHost,
        });
    }
    const connectors = createBuiltInConnectorRegistry({
        workspaceRoot: process.env.COSMOS_WORKSPACE_ROOT ?? process.cwd(),
        logger,
        fetch: createProxyFetch(),
    });
    let workerAdminServer: WorkerAdminServer | null = null;
    let runtime: WorkerRuntime | null = null;

    const heartbeat = async (status: "starting" | "ready" | "stopped"): Promise<void> => {
        await repository.touchWorkerHeartbeat({
            instanceId,
            status,
            version: config.version,
        });
        workerAdminServer?.service.markHeartbeat();
    };

    const queueScheduledWorkflowSources = async (
        control: IngestWorkflowControlService,
        now = new Date(),
    ): Promise<void> => {
        const sources = await repository.listSources();
        for (const source of sources) {
            if (!source.enabled || !source.config.scheduleIntervalMs) continue;
            const interval = source.config.scheduleIntervalMs;
            const lastRunAt = source.lastRunAt
                ? Date.parse(source.lastRunAt)
                : Number.NEGATIVE_INFINITY;
            if (Number.isFinite(lastRunAt) && now.getTime() - lastRunAt < interval) continue;
            const bucket = Math.floor(now.getTime() / interval);
            try {
                const envelope = await control.enqueue({
                    sourceId: source.id,
                    triggerKind: "schedule",
                    idempotencyKey: `schedule:${source.id}:${bucket}`,
                });
                logger.child({
                    runId: envelope.runId,
                    sourceId: source.id,
                }).info("workflow.run.queued", {
                    triggerKind: "schedule",
                    status: envelope.status,
                });
            } catch (error) {
                // One broken source must not prevent another source or any
                // downstream lane from being polled in this cycle.
                logger.child({ sourceId: source.id }).error("workflow.run.queue_failed", {
                    triggerKind: "schedule",
                }, error);
            }
        }
    };

    try {
        await repository.initialize();
        await heartbeat("starting");
        const ingestion = new IngestionService(
            repository,
            (source) => connectors.resolve(source),
            logger,
        );
        const probe = new ConnectorProbeService(
            repository,
            (source) => connectors.resolve(source),
            undefined,
            logger,
        );
        const workflowHost = config.workflowHostEnabled
            ? createWorkflowHost({
                prisma: repository.prisma,
                blobs: repository.blobs,
                definitions: [createIngestWorkflowDefinition()],
                actions: createIngestActions({
                    resolveConnector: (source) => connectors.resolve(source),
                    blobs: repository.blobs,
                    domain: repository,
                    logger,
                }),
                owner: instanceId,
                workerId: config.workerId,
                leaseMs: config.leaseMs,
                logger,
                onAttemptStarted: (attempt) => workerAdminServer?.service.registerAttempt({
                    ...attempt,
                    lane: "workflow-activity",
                }),
                onAttemptFinished: (attemptId) => workerAdminServer?.service.finishAttempt(attemptId),
            })
            : null;
        const workflowControl = workflowHost
            ? new IngestWorkflowControlService({
                store: workflowHost.store,
                getSourceExecutionSnapshot: async (sourceId) => {
                    const source = await repository.getSource(sourceId);
                    return source ?? null;
                },
                getCheckpointSnapshot: (sourceId) => repository.getCheckpointSnapshot(sourceId),
            })
            : null;
        const worker = new IngestionWorker(repository, ingestion, {
            owner: instanceId,
            leaseMs: config.leaseMs,
            probe,
            schedule: workflowHost === null,
            logger,
        });
        const executableActionRefs = new Set(
            workflowHost?.actions.descriptors().map((descriptor) => descriptor.ref) ?? [],
        );
        const workflowEvidence = workflowHost
            ? catalog.listWorkflowDefinitions().map((definition) => ({
                ref: definition.ref,
                manifestHash: definition.manifestHash,
            }))
            : [];
        const actionEvidence = catalog.listActionDefinitions()
            .filter((definition) => executableActionRefs.has(definition.ref))
            .map((definition) => ({
                ref: definition.ref,
                manifestHash: definition.manifestHash,
                executionPlacements: [definition.executionPlacement],
            }));
        const connectorEvidence = catalog.listSourceDefinitions().map((definition) => ({
            ref: definition.ref,
            manifestHash: definition.manifestHash,
        }));
        const adminComponentHealth = async () => {
            const checkedAt = new Date().toISOString();
            const health = await repository.health();
            const storage = toWorkerComponentHealth(health.storageStatus, checkedAt);
            return {
                migration: toWorkerComponentHealth(health.migrationStatus, checkedAt),
                taskStore: storage,
                definitionCatalog: workflowHost
                    ? workerComponent("ready", checkedAt)
                    : workerComponent("disabled", checkedAt),
                actionRegistry: workflowHost
                    ? workerComponent("ready", checkedAt)
                    : workerComponent("disabled", checkedAt),
                connectorRegistry: workerComponent("ready", checkedAt),
                valueStore: storage,
            } satisfies Record<string, ComponentHealth>;
        };

        if (config.workerAdminEnabled) {
            workerAdminServer = createWorkerAdminServer({
                workerId: config.workerId,
                instanceId,
                version: config.version,
                mode: "direct",
                host: config.workerAdminHost,
                port: config.workerAdminPort,
                authorize: config.workerAdminToken
                    ? (request) => request.headers.authorization === `Bearer ${config.workerAdminToken}`
                    : undefined,
                lanes: workflowHost
                    ? [
                        { lane: "workflow-run" },
                        { lane: "workflow-activity" },
                        { lane: "workflow-completion" },
                        { lane: "legacy" },
                    ]
                    : [{ lane: "legacy" }],
                health: adminComponentHealth,
                genericCapabilities: workflowHost
                    ? ["source:read", "connector:execute", "workflow:execute", "library:write"]
                    : ["source:read", "connector:execute"],
                workflowEvidence,
                actionEvidence,
                connectorEvidence,
                limits: { maxConcurrency: workflowHost ? 4 : 1 },
                onDrain: async () => {
                    await runtime?.requestShutdown("ADMIN_DRAIN");
                },
                onDrainTimeout: async () => {
                    await runtime?.forceShutdown("ADMIN_DRAIN_TIMEOUT");
                },
            });
            await workerAdminServer.start();
            workerAdminServer.service.markReady();
            const address = workerAdminServer.server.address();
            const port = address && typeof address !== "string" ? address.port : config.workerAdminPort;
            logger.info("worker.admin.started", {
                host: config.workerAdminHost,
                port,
            });
        }

        runtime = new WorkerRuntime({
            repository,
            workflowHost,
            workflowControl,
            worker,
            workerAdminServer,
            logger,
            closeLogger: () => logger.close(),
            config,
            instanceId,
            heartbeat,
            queueScheduledWorkflowSources: workflowControl
                ? () => queueScheduledWorkflowSources(workflowControl!)
                : async () => undefined,
            activeAttemptCount: () => workerAdminServer?.service.status().activeAttemptCount ?? 0,
        });

        logger.info("worker.started", {
            intervalMs: config.pollMs,
            leaseMs: config.leaseMs,
            mode: process.env.NODE_ENV ?? "development",
            workflowHostEnabled: config.workflowHostEnabled,
            workflowActionRefs: workflowHost?.actions.descriptors().map((descriptor) => descriptor.ref) ?? [],
        });
        const stopForSignal = (reason: string): void => {
            void runtime?.requestShutdown(reason).then((result) => {
                process.exitCode = result.status === "succeeded" ? 0 : 1;
            });
        };
        process.once("SIGINT", () => stopForSignal("SIGINT"));
        process.once("SIGTERM", () => stopForSignal("SIGTERM"));
        await runtime.start();
    } catch (error) {
        workerAdminServer?.service.markStopped();
        await workerAdminServer?.close().catch(() => undefined);
        await repository.close().catch(() => undefined);
        await logger.close().catch(() => undefined);
        throw error;
    }
}

function workerComponent(status: ComponentHealth["status"], checkedAt: string): ComponentHealth {
    return { status, checkedAt };
}

function toWorkerComponentHealth(status: string, checkedAt: string): ComponentHealth {
    return workerComponent(
        status === "ready" ? "ready" : status === "failed" ? "unavailable" : "unknown",
        checkedAt,
    );
}

void bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
