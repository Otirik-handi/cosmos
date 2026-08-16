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
import { createWorkerAdminServer } from "@cosmos/worker-admin";
import type { ComponentHealth, WorkerAdminServer } from "@cosmos/worker-admin";
import { createWorkflowHost } from "./workflow-host.js";

const intervalMs = Number(process.env.COSMOS_WORKER_POLL_MS ?? "30000");
const leaseMs = Number(process.env.COSMOS_WORKER_LEASE_MS ?? "120000");
const version = process.env.COSMOS_VERSION ?? "0.1.0";
const workerId = process.env.COSMOS_WORKER_ID?.trim() || hostname();
const instanceId = `${hostname()}:${process.pid}`;
const workflowHostEnabled = process.env.COSMOS_WORKFLOW_HOST_ENABLED !== "false";
const workerAdminEnabled = process.env.COSMOS_WORKER_ADMIN_ENABLED !== "false";
const workerAdminHost = process.env.COSMOS_WORKER_ADMIN_HOST ?? "127.0.0.1";
const workerAdminPort = Number(process.env.COSMOS_WORKER_ADMIN_PORT ?? "9091");
const workerAdminToken = process.env.COSMOS_WORKER_ADMIN_TOKEN?.trim() || null;
const logger = createLogger({
    service: "cosmos-worker",
    fileName: "worker",
    instanceId,
});
const repository = new PrismaCosmosRepository({ logger });
const connectors = createBuiltInConnectorRegistry({
    workspaceRoot: process.env.COSMOS_WORKSPACE_ROOT ?? process.cwd(),
    logger,
});
let workerAdminServer: WorkerAdminServer | null = null;
let shuttingDown = false;

async function heartbeat(status: "starting" | "ready" | "stopped"): Promise<void> {
    await repository.touchWorkerHeartbeat({
        instanceId,
        status,
        version,
    });
    workerAdminServer?.service.markHeartbeat();
}


async function queueScheduledWorkflowSources(
    control: IngestWorkflowControlService,
    now = new Date(),
): Promise<void> {
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
            logger.child({ sourceId: source.id }).error("workflow.run.queue_failed", {
                triggerKind: "schedule",
            }, error);
            throw error;
        }
    }
}

async function bootstrap(): Promise<void> {
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
    const workflowHost = workflowHostEnabled
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
            workerId,
            leaseMs,
            logger,
        })
        : null;
    const workflowControl = workflowHost
        ? new IngestWorkflowControlService({
            store: workflowHost.store,
            getSourceExecutionSnapshot: async (sourceId) => {
                const source = await repository.getSource(sourceId);
                if (!source) return null;
                return {
                    id: source.id,
                    name: source.name,
                    kind: source.kind,
                    config: source.config,
                    enabled: source.enabled,
                    createdAt: source.createdAt,
                    updatedAt: source.updatedAt,
                };
            },
            getCheckpointSnapshot: (sourceId) => repository.getCheckpointSnapshot(sourceId),
        })
        : null;
    const worker = new IngestionWorker(repository, ingestion, {
        owner: instanceId,
        leaseMs,
        probe,
        schedule: workflowHost === null,
        logger,
    });
    const catalog = createBuiltinManifestCatalog();
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
    logger.info("worker.started", {
        intervalMs,
        leaseMs,
        mode: process.env.NODE_ENV ?? "development",
        workflowHostEnabled,
        workflowActionRefs: workflowHost?.actions.descriptors().map((descriptor) => descriptor.ref) ?? [],
    });
    await heartbeat("ready");

    let polling = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const pollLane = async <T>(lane: string, operation: () => Promise<T>): Promise<T | null> => {
        if (workerAdminServer && !workerAdminServer.service.beginPoll(lane)) return null;
        let failed = false;
        let failure: unknown;
        try {
            return await operation();
        } catch (error) {
            failed = true;
            failure = error;
            throw error;
        } finally {
            workerAdminServer?.service.endPoll(lane, failed ? failure : undefined);
        }
    };
    const poll = async (): Promise<void> => {
        if (polling || shuttingDown) return;
        if (workerAdminServer && !workerAdminServer.service.canAcceptWork()) return;
        polling = true;
        try {
            if (workflowHost && workflowControl) {
                const run = await pollLane("workflow-run", async () => {
                    await queueScheduledWorkflowSources(workflowControl);
                    return workflowHost.runLane.pollOnce();
                });
                const activity = await pollLane("workflow-activity", () => workflowHost.activityWorker.pollOnce());
                const completion = await pollLane(
                    "workflow-completion",
                    () => workflowHost.completionDispatcher.pollOnce(),
                );
                if (run) workerAdminServer?.service.recordClaim("workflow-run");
                if (activity?.accepted) workerAdminServer?.service.recordClaim("workflow-activity");
                if (completion) workerAdminServer?.service.recordClaim("workflow-completion");
                if (run || activity || completion) {
                    logger.info("workflow.lanes.polled", {
                        runStatus: run?.status ?? null,
                        activityAccepted: activity?.accepted ?? null,
                        completionStatus: completion?.status ?? null,
                    });
                }
            }
            const result = await pollLane("legacy", () => worker.pollOnce());
            if (result) {
                logger.info("worker.job_finished", {
                    jobId: result.jobId,
                    runId: result.runId,
                    status: result.status,
                    attempts: result.attempts,
                });
                workerAdminServer?.service.recordClaim("legacy");
            }
        } catch (error) {
            logger.error("worker.poll_failed", {}, error);
        } finally {
            polling = false;
        }
        void heartbeat("ready").catch((error) => {
            logger.error("worker.heartbeat_failed", {}, error);
        });
    };

    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        clearInterval(timer);
        let shutdownFailed = false;
        try {
            await heartbeat("stopped");
        } catch (error) {
            shutdownFailed = true;
            logger.error("worker.stop_failed", {
                signal,
                stage: "heartbeat.stopped",
            }, error);
        }
        try {
            await workerAdminServer?.close();
        } catch (error) {
            shutdownFailed = true;
            logger.error("worker.stop_failed", {
                signal,
                stage: "admin.close",
            }, error);
        }
        workerAdminServer?.service.markStopped();
        try {
            await repository.close();
        } catch (error) {
            shutdownFailed = true;
            logger.error("worker.stop_failed", {
                signal,
                stage: "repository.close",
            }, error);
        }
        logger.info("worker.stopped", {
            signal,
            status: shutdownFailed ? "degraded" : "ok",
        });
        await logger.close().catch(() => {
            shutdownFailed = true;
        });
        process.exit(shutdownFailed ? 1 : 0);
    };

    if (workerAdminEnabled) {
        workerAdminServer = createWorkerAdminServer({
            workerId,
            instanceId,
            version,
            mode: "direct",
            host: workerAdminHost,
            port: normalizeAdminPort(workerAdminPort),
            authorize: workerAdminToken
                ? (request) => request.headers.authorization === `Bearer ${workerAdminToken}`
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
            limits: {
                maxConcurrency: workflowHost ? 4 : 1,
            },
            onDrain: () => shutdown("ADMIN_DRAIN"),
        });
        await workerAdminServer.start();
        logger.info("worker.admin.started", {
            host: workerAdminHost,
            port: normalizeAdminPort(workerAdminPort),
        });
        workerAdminServer.service.markReady();
    }

    await poll();
    timer = setInterval(() => {
        void poll();
        logger.debug("worker.heartbeat", {
            at: new Date().toISOString(),
        });
    }, intervalMs);

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
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

function normalizeAdminPort(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
        throw new Error("COSMOS_WORKER_ADMIN_PORT must be an integer between 0 and 65535.");
    }
    return value;
}

void bootstrap().catch(async (error) => {
    logger.error("worker.failed", {}, error);
    workerAdminServer?.service.markStopped();
    try {
        await workerAdminServer?.close();
    } catch (cleanupError) {
        logger.error("worker.stop_failed", {
            stage: "bootstrap.admin.close",
        }, cleanupError);
    }
    try {
        await repository.close();
    } catch (cleanupError) {
        logger.error("worker.stop_failed", {
            stage: "bootstrap.repository.close",
        }, cleanupError);
    }
    await logger.close();
    process.exitCode = 1;
});
