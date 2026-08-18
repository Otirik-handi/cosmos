import { hostname } from "node:os";

export interface WorkerRuntimeConfig {
    pollMs: number;
    leaseMs: number;
    shutdownDeadlineMs: number;
    version: string;
    workerId: string;
    workflowHostEnabled: boolean;
    workerAdminEnabled: boolean;
    workerAdminHost: string;
    workerAdminPort: number;
    workerAdminToken: string | null;
}

export function parseWorkerRuntimeConfig(
    environment: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeConfig {
    return {
        pollMs: parsePositiveInteger(
            environment.COSMOS_WORKER_POLL_MS,
            30_000,
            "COSMOS_WORKER_POLL_MS",
        ),
        leaseMs: parsePositiveInteger(
            environment.COSMOS_WORKER_LEASE_MS,
            120_000,
            "COSMOS_WORKER_LEASE_MS",
        ),
        shutdownDeadlineMs: parseShutdownDeadline(
            environment.COSMOS_WORKER_SHUTDOWN_DEADLINE_MS,
        ),
        version: environment.COSMOS_VERSION?.trim() || "0.1.0",
        workerId: environment.COSMOS_WORKER_ID?.trim() || hostname(),
        workflowHostEnabled: environment.COSMOS_WORKFLOW_HOST_ENABLED !== "false",
        workerAdminEnabled: environment.COSMOS_WORKER_ADMIN_ENABLED !== "false",
        workerAdminHost: environment.COSMOS_WORKER_ADMIN_HOST?.trim() || "127.0.0.1",
        workerAdminPort: normalizeAdminPort(
            environment.COSMOS_WORKER_ADMIN_PORT === undefined
                ? 9091
                : Number(environment.COSMOS_WORKER_ADMIN_PORT),
        ),
        workerAdminToken: environment.COSMOS_WORKER_ADMIN_TOKEN?.trim() || null,
    };
}

export function normalizeAdminPort(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
        throw new Error("COSMOS_WORKER_ADMIN_PORT must be an integer between 0 and 65535.");
    }
    return value;
}

function parsePositiveInteger(
    raw: string | undefined,
    fallback: number,
    name: "COSMOS_WORKER_POLL_MS" | "COSMOS_WORKER_LEASE_MS",
): number {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return value;
}

function parseShutdownDeadline(raw: string | undefined): number {
    if (raw === undefined) return 30_000;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000) {
        throw new Error(
            "COSMOS_WORKER_SHUTDOWN_DEADLINE_MS must be an integer between 0 and 86400000.",
        );
    }
    return value;
}
