import {
    applyMigrations,
    assertLogsRedacted,
    createIsolatedStackRoot,
    disposeIsolatedStack,
    environmentForStack,
    findAvailablePort,
    formatProcessFailure,
    readStructuredLogs,
    repositoryRoot,
    spawnService,
    stopManagedProcess,
    waitForCondition,
    waitForHttp,
    type IsolatedStackRoot,
    type ManagedProcess,
} from "./helpers.js";

const kind = process.argv[2];
const source = sourceConfiguration(kind);
const stack = await createIsolatedStackRoot(`real-${kind ?? "source"}`);
let api: ManagedProcess | undefined;
let worker: ManagedProcess | undefined;

try {
    applyMigrations(stack.dataRoot);
    const apiPort = await findAvailablePort(4310);
    const environment = environmentForStack(process.env, stack, {
        NODE_ENV: "test",
        COSMOS_API_HOST: "127.0.0.1",
        COSMOS_API_PORT: String(apiPort),
        COSMOS_WORKSPACE_ROOT: repositoryRoot,
        COSMOS_WORKFLOW_HOST_ENABLED: "true",
        COSMOS_WORKER_ADMIN_ENABLED: "false",
        COSMOS_WORKER_POLL_MS: "100",
        COSMOS_WORKER_LEASE_MS: "30000",
        COSMOS_WORKER_SHUTDOWN_DEADLINE_MS: "5000",
        ...(source.environment ?? {}),
    });
    api = spawnService({
        name: `real-${kind}-api`,
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/api/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    await waitForHttp(`http://127.0.0.1:${apiPort}/readyz`, 200, 30_000);
    worker = spawnService({
        name: `real-${kind}-worker`,
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/worker/dist/main.js"],
        cwd: repositoryRoot,
        env: environment,
    });
    await waitForCondition(
        "real-source Worker heartbeat",
        async () => {
            const result = await requestJson(
                `http://127.0.0.1:${apiPort}/api/v1/health`,
            );
            return (
                result.status === 200 &&
                isRecord(result.body) &&
                result.body.workerStatus === "ready"
            );
        },
        30_000,
        200,
    );

    const created = await requestJson(
        `http://127.0.0.1:${apiPort}/api/v1/sources`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(source.command),
        },
    );
    if (created.status !== 201)
        throw new Error(
            `Real ${kind} source creation returned HTTP ${created.status}.`,
        );
    const sourceId = readString(created.body, "id");
    const queued = await requestJson(
        `http://127.0.0.1:${apiPort}/api/v1/sources/${sourceId}/runs`,
        {
            method: "POST",
            headers: { "idempotency-key": `real-${kind}-${Date.now()}` },
        },
    );
    if (queued.status !== 201)
        throw new Error(
            `Real ${kind} Run enqueue returned HTTP ${queued.status}.`,
        );
    const runId = readString(queued.body, "id");

    let completed: Record<string, unknown> | null = null;
    await waitForCondition(
        `real ${kind} Run completion`,
        async () => {
            const result = await requestJson(
                `http://127.0.0.1:${apiPort}/api/v1/runs/${runId}`,
            );
            if (result.status !== 200 || !isRecord(result.body)) return false;
            completed = result.body;
            return (
                result.body.status === "succeeded" ||
                result.body.status === "failed"
            );
        },
        180_000,
        500,
    );
    if (!completed || completed.status !== "succeeded") {
        throw new Error(
            `Real ${kind} Run did not succeed: ${JSON.stringify(completed)}.`,
        );
    }
    const itemCount = Number(completed.itemCount ?? 0);
    if (!Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > 100) {
        throw new Error(
            `Real ${kind} item count exceeded bounded acceptance: ${itemCount}.`,
        );
    }
    const records = await readStructuredLogs(stack.logRoot);
    assertLogsRedacted(records);
    process.stdout.write(
        `Real ${kind} acceptance passed: Run ${runId}, bounded item count ${itemCount}.\n`,
    );
} catch (error) {
    await stopManagedProcess(worker, "force").catch(() => undefined);
    await stopManagedProcess(api, "force").catch(() => undefined);
    throw new Error(
        [
            error instanceof Error ? error.message : String(error),
            api ? formatProcessFailure(api) : "",
            worker ? formatProcessFailure(worker) : "",
        ]
            .filter(Boolean)
            .join("\n"),
    );
} finally {
    await stopManagedProcess(worker, "graceful").catch(() => undefined);
    await stopManagedProcess(api, "graceful").catch(() => undefined);
    await disposeIsolatedStack(stack.root);
}

type SourceConfiguration = {
    command: {
        name: string;
        kind: string;
        config: Record<string, unknown>;
        enabled: true;
    };
    environment?: NodeJS.ProcessEnv;
};

function sourceConfiguration(value: string | undefined): SourceConfiguration {
    switch (value) {
        case "rss": {
            const feedUrl = requiredEnvironment("COSMOS_REAL_RSS_URL");
            return {
                command: {
                    name: "Explicit real RSS",
                    kind: "rss",
                    config: { feedUrl },
                    enabled: true,
                },
            };
        }
        case "aihot":
            requireNetworkPermission();
            return {
                command: {
                    name: "Explicit AI HOT",
                    kind: "aihot",
                    config: { schemaVersion: 1 },
                    enabled: true,
                },
                environment: { COSMOS_ALLOW_REAL_NETWORK: "true" },
            };
        case "bilibili": {
            requireNetworkPermission();
            const openCliPath = requiredEnvironment("COSMOS_OPENCLI_PATH");
            const profile = requiredEnvironment("OPENCLI_PROFILE");
            return {
                command: {
                    name: "Explicit Bilibili",
                    kind: "bilibili",
                    config: {
                        mode: "feed",
                        profile,
                        limit: 20,
                        schemaVersion: 1,
                    },
                    enabled: true,
                },
                environment: {
                    COSMOS_OPENCLI_PATH: openCliPath,
                    OPENCLI_PROFILE: profile,
                    COSMOS_ALLOW_REAL_NETWORK: "true",
                },
            };
        }
        default:
            throw new Error(
                "Usage: bun run scripts/e2e/real-source.ts <rss|aihot|bilibili>.",
            );
    }
}

function requiredEnvironment(name: string): string {
    const value = process.env[name]?.trim();
    if (!value)
        throw new Error(`Explicit real-source acceptance requires ${name}.`);
    return value;
}

function requireNetworkPermission(): void {
    if (process.env.COSMOS_ALLOW_REAL_NETWORK !== "true") {
        throw new Error(
            "Explicit real-source acceptance requires COSMOS_ALLOW_REAL_NETWORK=true.",
        );
    }
}

function requestJson(
    url: string,
    init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
    return fetch(url, init).then(async (response) => {
        const text = await response.text();
        let body: unknown = null;
        if (text) {
            try {
                body = JSON.parse(text) as unknown;
            } catch {
                body = text;
            }
        }
        return { status: response.status, body };
    });
}

function readString(value: unknown, key: string): string {
    if (
        !isRecord(value) ||
        typeof value[key] !== "string" ||
        value[key].length === 0
    ) {
        throw new Error(`Expected ${key} in response.`);
    }
    return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
