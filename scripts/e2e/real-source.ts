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
    operationId: "fetch" | "search";
    config: Record<string, unknown>;
};

/**
 * 真实来源验收有两种形态：单来源（rss / aihot / bilibili-hot / bilibili-search）只证明一条
 * 链路能抓，双计划（bilibili）是 Task 33 的验收——同一连接下的 hot 与 feed 两个计划。
 */
type Acceptance =
    | {
        mode: "single";
        environment: NodeJS.ProcessEnv;
        command: SourceCommand;
        /**
         * 期望来源落库并在公开投影里回读到的 `operationId`（EXT-006）：第二个 operation
         * 必须真的被持久化、而且它的配置字段不能被投影丢掉。
         */
        expectOperationId?: string;
    }
    | { mode: "dual-plan"; environment: NodeJS.ProcessEnv; profile: string };

const kind = process.argv[2];
/**
 * `--via-entry`（切片 7）：不手动触发，而是把 Webhook 入口当成「用户自己的自动化」调用它。
 * 这正是 ADR-0024 决定 6 的 v1 消费者——验收它跑得通真实来源，而不是只跑通假数据。
 */
const viaEntry = process.argv.includes("--via-entry");
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
            viaEntry,
            expectOperationId: acceptance.expectOperationId,
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
    viaEntry: boolean;
    expectOperationId?: string;
}): Promise<string> {
    const apiBaseUrl = `http://127.0.0.1:${input.apiPort}/api/v1`;
    const apiOrigin = `http://127.0.0.1:${input.apiPort}`;
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
    const planId = readString(created, "planId");
    if (input.expectOperationId !== undefined) {
        await assertPersistedOperation(apiBaseUrl, input.kind, sourceId, input);
    }
    // 启用状态归计划（ADR-0023 决策 2）：写入口是计划端点，CAS 用计划的 revision。
    expectJsonObject(
        await requestJson(
            `${apiBaseUrl}/collection-plans/${encodeURIComponent(planId)}`,
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
    const triggered = input.viaEntry
        ? await triggerThroughEntry(apiOrigin, apiBaseUrl, planId)
        : {
            run: expectJsonObject(
                await requestJson(
                    `${apiBaseUrl}/sources/${sourceId}/runs`,
                    {
                        method: "POST",
                        headers: { "idempotency-key": `real-${input.kind}-${Date.now()}` },
                    },
                ),
                201,
                `Real ${input.kind} Run enqueue`,
            ),
            eventId: null as string | null,
        };
    const runId = readString(triggered.run, "id");
    const label = input.viaEntry ? `real ${input.kind} via webhook entry` : `real ${input.kind}`;
    const terminal = await waitForTerminalRun(apiBaseUrl, runId, label);
    assertRunSucceeded(label, runId, terminal);
    const itemCount = boundedItemCount(label, terminal);
    if (triggered.eventId !== null) {
        // 触发证据必须能回答「谁触发的、哪一次」：入口触发的 Run 少了它就不算闭合 AUT-004。
        const detail = expectJsonObject(
            await requestJson(`${apiBaseUrl}/runs/${encodeURIComponent(runId)}`),
            200,
            `${label} Run detail`,
        );
        if (readString(detail, "triggerKind") !== "webhook") {
            throw new Error(`${label}: expected triggerKind=webhook, got ${String(detail.triggerKind)}.`);
        }
        const evidence = detail.triggerEvidence;
        if (!isRecord(evidence) || evidence.externalEventId !== triggered.eventId) {
            throw new Error(`${label}: trigger evidence is missing or does not match the delivered event.`);
        }
        return `Real ${input.kind} acceptance through the webhook entry passed: Run ${runId}, bounded item count ${itemCount}, event ${triggered.eventId}.`;
    }
    return `Real ${input.kind} acceptance passed: Run ${runId}, bounded item count ${itemCount}.`;
}

/**
 * 第二个 operation 的真实消费者（EXT-006）：读回来的来源必须仍是那个 operation，而且
 * 公开投影必须带上它声明的配置字段——按 connectorId 白名单化的投影会把 `query` 丢掉，
 * 这条断言就是那个缺口的守卫。
 */
async function assertPersistedOperation(
    apiBaseUrl: string,
    kind: string | undefined,
    sourceId: string,
    input: { command: SourceCommand; expectOperationId: string },
): Promise<void> {
    const persisted = expectJsonObject(
        await requestJson(`${apiBaseUrl}/sources/${encodeURIComponent(sourceId)}`),
        200,
        `Real ${kind} source read-back`,
    );
    const operationId = readString(persisted, "operationId");
    if (operationId !== input.expectOperationId) {
        throw new Error(
            `Real ${kind}: expected operationId=${input.expectOperationId}, got ${operationId}.`,
        );
    }
    const config = persisted.config;
    if (!isRecord(config)) {
        throw new Error(`Real ${kind}: the public source projection has no config object.`);
    }
    for (const [key, value] of Object.entries(input.command.config)) {
        if (config[key] !== value) {
            throw new Error(
                `Real ${kind}: the public projection dropped ${key} of operation ${input.expectOperationId} (got ${JSON.stringify(config)}).`,
            );
        }
    }
}

/**
 * 切片 7 的消费者形态：生成入口 → 用凭证与事件标识调用它（模拟用户的脚本/定时任务）→
 * 拿回 queued Run。入口不在 `/api/v1` 下，所以这里用 API 的根地址。
 */
async function triggerThroughEntry(
    apiOrigin: string,
    apiBaseUrl: string,
    planId: string,
): Promise<{ run: Record<string, unknown>; eventId: string }> {
    const entry = expectJsonObject(
        await requestJson(
            `${apiBaseUrl}/collection-plans/${encodeURIComponent(planId)}/webhook-entry`,
            { method: "POST" },
        ),
        201,
        "Webhook entry creation",
    );
    const eventId = `real-entry-${Date.now()}`;
    const accepted = expectJsonObject(
        await requestJson(`${apiOrigin}${readString(entry, "entryPath")}`, {
            method: "POST",
            headers: {
                "x-cosmos-credential": readString(entry, "credential"),
                "x-cosmos-event-id": eventId,
            },
        }),
        202,
        "Webhook entry acceptance",
    );
    return { run: accepted, eventId };
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
                    config: { mode: "hot", limit: 20 },
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
        case "bilibili-search": {
            requireNetworkPermission();
            const openCliPath = requiredEnvironment("COSMOS_OPENCLI_PATH");
            // 搜索匿名可用（EXT-006）：只给可执行文件路径，**不给** profile——这条验收同时
            // 证明第二个 operation 不需要登录态，也不该被要求绑连接。
            return {
                mode: "single",
                environment: {
                    COSMOS_OPENCLI_PATH: openCliPath,
                    COSMOS_ALLOW_REAL_NETWORK: "true",
                },
                command: {
                    name: "Explicit Bilibili Search",
                    sourceDefinitionRef: "source.bilibili@1",
                    operationId: "search",
                    config: {
                        query: process.env.COSMOS_REAL_BILIBILI_QUERY?.trim() || "宇宙",
                        limit: 20,
                    },
                },
                expectOperationId: "search",
            };
        }
        default:
            throw new Error(
                "Usage: bun run scripts/e2e/real-source.ts <rss|aihot|bilibili|bilibili-hot|bilibili-search>.",
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
