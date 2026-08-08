import { hostname } from "node:os";

import {
    ConnectorProbeService,
    IngestionService,
    IngestionWorker,
} from "@cosmos/application";
import { createLogger } from "@cosmos/logging";
import { createBuiltInConnectorRegistry } from "@cosmos/plugin-collectors";
import {
    PrismaCosmosRepository,
} from "@cosmos/storage-prisma";

const intervalMs = Number(process.env.COSMOS_WORKER_POLL_MS ?? "30000");
const leaseMs = Number(process.env.COSMOS_WORKER_LEASE_MS ?? "120000");
const version = process.env.COSMOS_VERSION ?? "0.1.0";
const instanceId = `${hostname()}:${process.pid}`;
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
let shuttingDown = false;

async function heartbeat(status: "starting" | "ready" | "stopped"): Promise<void> {
    await repository.touchWorkerHeartbeat({
        instanceId,
        status,
        version,
    });
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
    const worker = new IngestionWorker(repository, ingestion, {
        owner: instanceId,
        leaseMs,
        probe,
        logger,
    });
    logger.info("worker.started", {
        intervalMs,
        leaseMs,
        mode: process.env.NODE_ENV ?? "development",
    });
    await heartbeat("ready");

    const poll = async (): Promise<void> => {
        try {
            const result = await worker.pollOnce();
            if (result) {
                logger.info("worker.job_finished", {
                    jobId: result.jobId,
                    runId: result.runId,
                    status: result.status,
                    attempts: result.attempts,
                });
            }
        } catch (error) {
            logger.error("worker.poll_failed", {}, error);
        }
        void heartbeat("ready").catch((error) => {
            logger.error("worker.heartbeat_failed", {}, error);
        });
    };

    await poll();
    const timer = setInterval(() => {
        void poll();
        logger.debug("worker.heartbeat", {
            at: new Date().toISOString(),
        });
    }, intervalMs);

    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
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

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void bootstrap().catch(async (error) => {
    logger.error("worker.failed", {}, error);
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
