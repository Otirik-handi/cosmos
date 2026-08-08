import { hostname } from "node:os";

import {
    IngestionService,
    IngestionWorker,
    type IngestConnector,
} from "@cosmos/application";
import {
    createFixtureRssConnector,
    createRssConnector,
} from "@cosmos/plugin-rss";
import type { SourceSnapshot } from "@cosmos/contracts";
import { PrismaCosmosRepository } from "@cosmos/storage-prisma";

const intervalMs = Number(process.env.COSMOS_WORKER_POLL_MS ?? "30000");
const leaseMs = Number(process.env.COSMOS_WORKER_LEASE_MS ?? "120000");
const version = process.env.COSMOS_VERSION ?? "0.1.0";
const instanceId = `${hostname()}:${process.pid}`;
const repository = new PrismaCosmosRepository();
let shuttingDown = false;

function log(event: string, details: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({
        event,
        service: "cosmos-worker",
        instanceId,
        ...details,
    }));
}

async function heartbeat(status: "starting" | "ready" | "stopped"): Promise<void> {
    await repository.touchWorkerHeartbeat({
        instanceId,
        status,
        version,
    });
}

function workspaceRoot(): string {
    return process.env.COSMOS_WORKSPACE_ROOT ?? process.cwd();
}

function resolveConnector(source: SourceSnapshot): IngestConnector {
    if (source.kind === "rss") {
        return createRssConnector();
    }
    return createFixtureRssConnector({
        rootDirectory: workspaceRoot(),
    });
}

async function bootstrap(): Promise<void> {
    await repository.initialize();
    await heartbeat("starting");
    const ingestion = new IngestionService(
        repository,
        (source) => resolveConnector(source),
    );
    const worker = new IngestionWorker(repository, ingestion, {
        owner: instanceId,
        leaseMs,
    });
    log("worker.started", {
        intervalMs,
        leaseMs,
        mode: process.env.NODE_ENV ?? "development",
    });
    await heartbeat("ready");

    const poll = async (): Promise<void> => {
        try {
            const result = await worker.pollOnce();
            if (result) {
                log("worker.job_finished", {
                    jobId: result.jobId,
                    runId: result.runId,
                    status: result.status,
                    attempts: result.attempts,
                });
            }
        } catch (error) {
            log("worker.poll_failed", {
                message: error instanceof Error ? error.message : String(error),
            });
        }
        void heartbeat("ready").catch((error) => {
            log("worker.heartbeat_failed", {
                message: error instanceof Error ? error.message : String(error),
            });
        });
    };

    await poll();
    const timer = setInterval(() => {
        void poll();
        log("worker.heartbeat", {
            at: new Date().toISOString(),
        });
    }, intervalMs);

    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        clearInterval(timer);
        await heartbeat("stopped");
        await repository.close();
        log("worker.stopped", { signal });
        process.exit(0);
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void bootstrap().catch(async (error) => {
    log("worker.failed", {
        message: error instanceof Error ? error.message : String(error),
    });
    await repository.close().catch(() => undefined);
    process.exitCode = 1;
});
