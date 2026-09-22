import {
    applyMigrations,
    assertLogsRedacted,
    assertRunSucceeded,
    boundedItemCount,
    createIsolatedStackRoot,
    disposeIsolatedStack,
    environmentForStack,
    expectJsonObject,
    findAvailablePort,
    formatProcessFailure,
    isRecord,
    readString,
    readStructuredLogs,
    repositoryRoot,
    requestJson,
    spawnService,
    stopManagedProcess,
    waitForCondition,
    waitForHttp,
    waitForTerminalRun,
    type ManagedProcess,
} from "./helpers.js";
import { runBilibiliDualPlanAcceptance } from "./real-bilibili-plans.js";

type SourceCommand = {
    name: string;
    sourceDefinitionRef: string;
    operationId: "fetch";
    config: Record<string, unknown>;
};

/**
 * 真实来源验收有两种形态：单来源（rss / aihot / bilibili-hot）只证明一条链路能抓，
 * 双计划（bilibili）是 Task 33 的验收——同一连接下的 hot 与 feed 两个计划。
 */
type Acceptance =
    | { mode: "single"; environment: NodeJS.ProcessEnv; command: SourceCommand }
    | { mode: "dual-plan"; environment: NodeJS.ProcessEnv; profile: string };

const kind = process.argv[2];
const acceptance = resolveAcceptance(kind);
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
        ...acceptance.environment,
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

    const summary = acceptance.mode === "dual-plan"
        ? await runBilibiliDualPlanAcceptance({
            apiPort,
            stack,
            profile: acceptance.profile,
        })
        : await runSingleSourceAcceptance({
            kind,
            apiPort,
            command: acceptance.command,
        });

    const records = await readStructuredLogs(stack.logRoot);
    assertLogsRedacted(records);
    process.stdout.write(`${summary}\n`);
} catch (error) {
    if (worker) await stopManagedProcess(worker, "force").catch(() => undefined);
    if (api) await stopManagedProcess(api, "force").catch(() => undefined);
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
    if (worker) await stopManagedProcess(worker, "graceful").catch(() => undefined);
    if (api) await stopManagedProcess(api, "graceful").catch(() => undefined);
    await disposeIsolatedStack(stack.root);
}

async function runSingleSourceAcceptance(input: {
    kind: string | undefined;
    apiPort: number;
    command: SourceCommand;
}): Promise<string> {
    const apiBaseUrl = `http://127.0.0.1:${input.apiPort}/api/v1`;
    const created = expectJsonObject(
        await requestJson(`${apiBaseUrl}/sources`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input.command),
        }),
        201,
        `Real ${input.kind} source creation`,
    );
    const sourceId = readString(created, "id");
    // 启用状态归计划（ADR-0023 决策 2）：写入口是计划端点，CAS 用计划的 revision。
    expectJsonObject(
        await requestJson(
            `${apiBaseUrl}/collection-plans/${encodeURIComponent(readString(created, "planId"))}`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    enabled: true,
                    baseRevisionId: readString(created, "planRevisionId"),
                }),
            },
        ),
        200,
        `Real ${input.kind} plan activation`,
    );
    const queued = expectJsonObject(
        await requestJson(
            `${apiBaseUrl}/sources/${sourceId}/runs`,
            {
                method: "POST",
                headers: { "idempotency-key": `real-${input.kind}-${Date.now()}` },
            },
        ),
        201,
        `Real ${input.kind} Run enqueue`,
    );
    const runId = readString(queued, "id");
    const label = `real ${input.kind}`;
    const terminal = await waitForTerminalRun(apiBaseUrl, runId, label);
    assertRunSucceeded(label, runId, terminal);
    const itemCount = boundedItemCount(label, terminal);
    return `Real ${input.kind} acceptance passed: Run ${runId}, bounded item count ${itemCount}.`;
}

function resolveAcceptance(value: string | undefined): Acceptance {
    switch (value) {
        case "rss": {
            const feedUrl = requiredEnvironment("COSMOS_REAL_RSS_URL");
            return {
                mode: "single",
                environment: {},
                command: {
                    name: "Explicit real RSS",
                    sourceDefinitionRef: "source.rss@1",
                    operationId: "fetch",
                    config: { feedUrl },
                },
            };
        }
        case "aihot":
            requireNetworkPermission();
            return {
                mode: "single",
                environment: { COSMOS_ALLOW_REAL_NETWORK: "true" },
                command: {
                    name: "Explicit AI HOT",
                    sourceDefinitionRef: "source.aihot@1",
                    operationId: "fetch",
                    config: {},
                },
            };
        case "bilibili-hot": {
            requireNetworkPermission();
            const openCliPath = requiredEnvironment("COSMOS_OPENCLI_PATH");
            const profile = requiredEnvironment("OPENCLI_PROFILE");
            return {
                mode: "single",
                environment: openCliEnvironment(openCliPath, profile),
                command: {
                    name: "Explicit Bilibili Hot",
                    sourceDefinitionRef: "source.bilibili@1",
                    operationId: "fetch",
                    config: { mode: "hot", profile, limit: 20 },
                },
            };
        }
        case "bilibili": {
            requireNetworkPermission();
            const openCliPath = requiredEnvironment("COSMOS_OPENCLI_PATH");
            const profile = requiredEnvironment("OPENCLI_PROFILE");
            return {
                mode: "dual-plan",
                environment: openCliEnvironment(openCliPath, profile),
                profile,
            };
        }
        default:
            throw new Error(
                "Usage: bun run scripts/e2e/real-source.ts <rss|aihot|bilibili|bilibili-hot>.",
            );
    }
}

function openCliEnvironment(openCliPath: string, profile: string): NodeJS.ProcessEnv {
    return {
        COSMOS_OPENCLI_PATH: openCliPath,
        OPENCLI_PROFILE: profile,
        COSMOS_ALLOW_REAL_NETWORK: "true",
    };
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
