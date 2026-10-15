import { hostname } from "node:os";

export interface WorkerAgentConfig {
    provider: string;
    model: string;
    api: "openai-completions";
    baseUrl: string;
    contextWindow: number;
    maxOutputTokens: number;
    connectionId: string;
}

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
    agent: WorkerAgentConfig | null;
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
        agent: parseWorkerAgentConfig(environment),
    };
}

function parseWorkerAgentConfig(environment: NodeJS.ProcessEnv): WorkerAgentConfig | null {
    if (environment.COSMOS_AGENT_ENABLED !== "true") return null;

    const api = environment.COSMOS_AGENT_API?.trim();
    const provider = environment.COSMOS_AGENT_PROVIDER?.trim();
    const model = environment.COSMOS_AGENT_MODEL?.trim();
    const baseUrl = environment.COSMOS_AGENT_BASE_URL?.trim();
    const connectionId = environment.COSMOS_AGENT_CONNECTION_ID?.trim();
    const contextWindow = parseRequiredPositiveInteger(
        environment.COSMOS_AGENT_CONTEXT_WINDOW,
        "COSMOS_AGENT_CONTEXT_WINDOW",
    );
    const maxOutputTokens = parseRequiredPositiveInteger(
        environment.COSMOS_AGENT_MAX_OUTPUT_TOKENS,
        "COSMOS_AGENT_MAX_OUTPUT_TOKENS",
    );

    if (!provider || !model || !baseUrl || !connectionId || api !== "openai-completions") {
        throw new Error(
            "COSMOS_AGENT_PROVIDER, COSMOS_AGENT_MODEL, COSMOS_AGENT_API=openai-completions, COSMOS_AGENT_BASE_URL, COSMOS_AGENT_CONTEXT_WINDOW, COSMOS_AGENT_MAX_OUTPUT_TOKENS, and COSMOS_AGENT_CONNECTION_ID are required when COSMOS_AGENT_ENABLED=true.",
        );
    }
    let endpoint: URL;
    try {
        endpoint = new URL(baseUrl);
    } catch {
        throw new Error("COSMOS_AGENT_BASE_URL must be a valid HTTP(S) URL.");
    }
    if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
        throw new Error("COSMOS_AGENT_BASE_URL must be a valid HTTP(S) URL.");
    }
    if (maxOutputTokens > contextWindow) {
        throw new Error("COSMOS_AGENT_MAX_OUTPUT_TOKENS must not exceed COSMOS_AGENT_CONTEXT_WINDOW.");
    }
    return {
        provider,
        model,
        api,
        baseUrl: endpoint.toString().replace(/\/$/, ""),
        contextWindow,
        maxOutputTokens,
        connectionId,
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

function parseRequiredPositiveInteger(raw: string | undefined, name: string): number {
    if (raw === undefined || raw.trim() === "") {
        throw new Error(`${name} is required when COSMOS_AGENT_ENABLED=true.`);
    }
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
