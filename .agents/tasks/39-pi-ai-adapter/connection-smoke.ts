import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
    ActionRegistry, ActionExecutionError, createAgentInvocationAction,
    type AgentInvocationContext, type RegisteredAction,
} from "@cosmos/application";
import {
    PiAiAgentInvocationAdapter, createPiAiOpenAICompletionsModel,
    type PiAiClient, type PiAiCredentialResolver,
} from "@cosmos/agent-pi-ai";
import { agentInvocationOutputSchema, type ConnectionInstance } from "@cosmos/contracts";
import { PrismaCosmosRepository } from "@cosmos/storage-prisma";
import {
    ISOLATION_PARENT, ROOT_PREFIX, SNAPSHOT_COMMIT, SYNTHETIC_CREDENTIAL,
    assertUsableCredential, createCountingLogger, createSafeDiagnostics, model, prepareDatabase, provider,
    readCredentialWithoutEcho, secretRef, validateRunnerInvocation, withBoundedProviderTransport,
} from "./connection-smoke-harness.js";
import {
    prepareRealSmokeV2, runOfflineV2Smoke, runRealSmokeV2,
} from "./connection-smoke-v2.js";

// 隔离、终端与诊断边界在 harness 里；`@1` 与 `@2` 的请求计划、造数和 runner 各自成文件，
// 这样两套验收互不改写对方的计划字节，也各自留在体积警戒线内。

export * from "./connection-smoke-harness.js";
export * from "./connection-smoke-v2.js";

export function createOfflineClient(): PiAiClient {
    return {
        getModel: () => { throw new Error("Offline smoke requires an injected model."); },
        complete: async (configuredModel, context, options) => {
            if (options.apiKey !== SYNTHETIC_CREDENTIAL || options.maxTokens !== 64 ||
                context.messages.length !== 1 || context.messages[0]?.role !== "user") {
                throw new Error("Offline SDK request did not satisfy its contract.");
            }
            return {
                role: "assistant", content: [{ type: "text", text: "OK" }],
                api: "openai-completions", provider: configuredModel.provider, model: configuredModel.id,
                usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                stopReason: "stop", timestamp: Date.now(),
            };
        },
    };
}

/**
 * `agent.invoke@1` 的连接绑定装配。Worker 已不再注册 `@1`（模型与凭证改由调用时的
 * Connection 解析），这里保留一份等价装配只为让这次真实验收仍可复现：凭证按次从
 * SecretStore 读取，连接缺失、非活动、无 SecretRef、provider 不匹配或读取失败都
 * fail closed。装配留在验收脚本里，不再作为生产注册路径存在。
 */
export function createTask39AgentAction(dependencies: {
    connections: { getConnection(connectionId: string): Promise<ConnectionInstance | null> };
    secrets: { readonly read: (secretRef: string) => Promise<string | null> };
    config: { baseUrl: string; connectionId: string };
    client?: PiAiClient;
}): RegisteredAction {
    const credentials: PiAiCredentialResolver = {
        withCredential: async <T>(
            invokedProvider: string,
            context: AgentInvocationContext,
            use: (credential: string) => Promise<T>,
        ): Promise<T> => {
            if (context.signal.aborted) throw cancelled();
            const connection = await dependencies.connections.getConnection(dependencies.config.connectionId);
            if (context.signal.aborted) throw cancelled();
            if (!connection || connection.id !== dependencies.config.connectionId ||
                connection.status !== "active" || !connection.secretRef) {
                throw new ActionExecutionError("authentication_required",
                    "The configured Agent connection is missing, inactive, or has no credential.", false);
            }
            if (invokedProvider !== provider) {
                throw new ActionExecutionError("authentication_required",
                    "The configured Agent connection does not match this provider invocation.", false);
            }
            let credential: string | null;
            try {
                credential = await dependencies.secrets.read(connection.secretRef);
            } catch {
                if (context.signal.aborted) throw cancelled();
                throw new ActionExecutionError("authentication_required",
                    "The configured Agent connection credential could not be loaded.", false);
            }
            if (context.signal.aborted) throw cancelled();
            if (credential === null || credential.trim().length === 0) {
                throw new ActionExecutionError("authentication_required",
                    "The configured Agent connection has no stored credential.", false);
            }
            try {
                return await use(credential);
            } finally {
                credential = null;
            }
        },
    };
    return createAgentInvocationAction(new PiAiAgentInvocationAdapter({
        credentials,
        model: createPiAiOpenAICompletionsModel({
            provider, model, name: model, baseUrl: dependencies.config.baseUrl,
            contextWindow: 262_144, maxTokens: 64,
        }),
        client: dependencies.client,
    }));
}

function cancelled(): ActionExecutionError {
    return new ActionExecutionError("cancelled", "Agent invocation was cancelled.", false);
}

export async function dispatchInvocation(repository: PrismaCosmosRepository, connectionId: string, client?: PiAiClient,
    baseUrl = "https://task39.invalid/v1", credential = SYNTHETIC_CREDENTIAL) {
    let secretReads = 0;
    const action = createTask39AgentAction({
        connections: repository,
        secrets: { read: (ref) => { secretReads += 1; return repository.secrets.read(ref); } },
        config: { baseUrl, connectionId },
        client,
    });
    const output = agentInvocationOutputSchema.parse(await new ActionRegistry([action]).dispatch("agent.invoke@1", {
        provider, model, messages: [{ role: "user", content: "Reply with exactly: OK" }], tools: [],
        budget: { maxDurationMs: 300_000, maxToolCalls: 0, maxOutputTokens: 64 }, metadata: {},
    }, { idempotencyKey: "task39-offline", signal: AbortSignal.timeout(305_000) }));
    if (JSON.stringify(output).includes(credential)) throw new Error("Credential detected in output.");
    return { provider: output.provider, model: output.model, usage: output.usage,
        outputMatchesExpected: output.content === "OK", credentialAbsentFromOutput: true, secretReads };
}

export async function runOfflineSmoke() {
    await mkdir(ISOLATION_PARENT, { recursive: true });
    const root = await mkdtemp(join(ISOLATION_PARENT, ROOT_PREFIX));
    process.stdout.write(JSON.stringify({ mode: "offline", isolatedRoot: root, retained: true }) + "\n");
    const { databaseUrl, migrationCount } = await prepareDatabase(root);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const logs: unknown[] = [];
    const logger = createCountingLogger(logs);
    const repository = new PrismaCosmosRepository({ dataRoot: root, prisma, logger });
    try {
        await repository.initialize();
        const connection = await repository.createConnection({
            name: "Task 39 offline verification", connectorId: "task39-synthetic-auth", secretRef,
        });
        await repository.secrets.put(secretRef, SYNTHETIC_CREDENTIAL);
        const summary = await dispatchInvocation(repository, connection.id, createOfflineClient());
        await repository.secrets.delete(secretRef);
        let missingSecretRejected = false;
        try { await dispatchInvocation(repository, connection.id, createOfflineClient()); }
        catch (error: unknown) {
            missingSecretRejected = error instanceof Error && "code" in error && error.code === "authentication_required";
        }
        if (!missingSecretRejected) throw new Error("Missing Secret did not fail closed.");
        const result = { status: "completed", mode: "offline", isolatedRoot: root, snapshotCommit: SNAPSHOT_COMMIT,
            migrationCount, ...summary, missingSecretRejected, retained: true };
        await repository.close();
        if (JSON.stringify(logs).includes(SYNTHETIC_CREDENTIAL)) throw new Error("Credential detected in logs.");
        await writeFile(join(root, "application.log.json"), JSON.stringify(logs, null, 4));
        await writeFile(join(root, "result.json"), JSON.stringify(result, null, 4));
        return result;
    } finally {
        await prisma.$disconnect();
    }
}

export function requestPlan(root: string) {
    return { mode: "real", isolatedRoot: root, snapshotCommit: SNAPSHOT_COMMIT,
        provider, model, api: "openai-completions", baseUrl: "https://api-slb.jiji.cc/v1",
        messages: [{ role: "user", content: "Reply with exactly: OK" }], tools: [], metadata: {},
        budget: { maxDurationMs: 300_000, maxToolCalls: 0, maxOutputTokens: 64 },
        idempotencyKey: "task39-offline", maxDispatches: 1, maxTransportSends: 1,
        redirect: "error", sdkLogLevel: "off", automaticDirectoryCleanup: false };
}

export async function prepareRealSmoke() {
    await mkdir(ISOLATION_PARENT, { recursive: true });
    const root = await mkdtemp(join(ISOLATION_PARENT, "task39-real-"));
    const database = await prepareDatabase(root);
    await writeFile(join(root, "request-plan.json"), JSON.stringify(requestPlan(root), null, 4), { flag: "wx" });
    return { status: "prepared-no-request", isolatedRoot: root, ...database, plan: requestPlan(root) };
}

export async function validatePreparedRoot(root: string): Promise<string> {
    const resolved = await realpath(root);
    const parent = await realpath(ISOLATION_PARENT);
    // `task39-real-` also prefixes the `@2` roots (`task39-real-v2-`), so the narrower prefix
    // has to be excluded here rather than relying on a missing plan file to fail closed.
    if (dirname(resolved) !== parent || !/^task39-real-(?!v2-)/.test(basename(resolved))) {
        throw new Error("Only the prepared Task 39 real root is accepted.");
    }
    const plan = JSON.parse(await readFile(join(resolved, "request-plan.json"), "utf8")) as unknown;
    if (JSON.stringify(plan) !== JSON.stringify(requestPlan(resolved))) throw new Error("Request plan changed.");
    return resolved;
}

export async function runRealSmoke(root: string) {
    // These checks precede any credential prompt, filesystem writes, or SDK request.
    validateRunnerInvocation({ args: [], environment: process.env,
        inputIsTTY: process.stdin.isTTY === true, outputIsTTY: process.stdout.isTTY === true });
    const prepared = await validatePreparedRoot(root);
    process.stdout.write(JSON.stringify(requestPlan(prepared)) + "\n");
    process.stdout.write("Only after separate approval for this exact request, type APPROVED (input hidden): ");
    if (await readCredentialWithoutEcho(process.stdin, true) !== "APPROVED") {
        throw new Error("Request confirmation missing.");
    }
    await writeFile(join(prepared, "attempted.json"), JSON.stringify({ attemptedAt: new Date().toISOString() }), { flag: "wx" });
    process.stdout.write("\nProvider credential (input hidden): ");
    const diagnostics = createSafeDiagnostics();
    let credential = "";
    let prisma: PrismaClient | undefined;
    let repository: PrismaCosmosRepository | undefined;
    try {
        credential = await diagnostics.step("credential_input", async () => {
            const value = await readCredentialWithoutEcho(process.stdin, true);
            // A stray trailing space or newline makes the Authorization header invalid; the
            // provider then answers 400 and the diagnostic only shows a status code.
            return assertUsableCredential(value.trim());
        });
        process.stdout.write("\n");
        const logger = createCountingLogger();
        repository = await diagnostics.step("database_initialize", async () => {
            prisma = new PrismaClient({ datasources: { db: {
                url: `file:${join(prepared, "cosmos.sqlite").replaceAll("\\", "/")}`,
            } } });
            const instance = new PrismaCosmosRepository({ dataRoot: prepared, prisma, logger });
            repository = instance;
            await instance.initialize();
            return instance;
        });
        const activeRepository = repository;
        const connection = await diagnostics.step("connection_create", () => activeRepository.createConnection({
            name: "Task 39 one-time real verification", connectorId: "task39-provider-auth", secretRef,
        }));
        await diagnostics.step("secret_write", () => activeRepository.secrets.put(secretRef, credential));
        let responseStatus: number | null = null;
        let responseReturned = false;
        const summary = await diagnostics.step("dispatch", () => withBoundedProviderTransport(() =>
            dispatchInvocation(activeRepository, connection.id, undefined, requestPlan(prepared).baseUrl, credential),
            globalThis.fetch, () => { diagnostics.record.transportSends += 1; }, (response) => {
                responseReturned = true;
                responseStatus = response.status;
                diagnostics.record.response = { returned: true, status: response.status };
            }));
        const result = { status: "completed", mode: "real", isolatedRoot: prepared, ...summary, logEvents: logger.count(),
            responseStatus, responseReturned, providerBodyRecorded: false, retained: true };
        await diagnostics.step("result_write", () => writeFile(join(prepared, "result.json"), JSON.stringify(result, null, 4)));
        diagnostics.record.status = "completed";
        return result;
    } finally {
        credential = "";
        // Cleanup failures are independent evidence and must not erase the first failure.
        if (repository) {
            try {
                await diagnostics.step("secret_delete", () => repository!.secrets.delete(secretRef));
                diagnostics.record.cleanup.secretDelete = "completed";
            } catch { diagnostics.record.cleanup.secretDelete = "failed"; }
        }
        if (prisma) {
            try {
                await diagnostics.step("disconnect", () => prisma!.$disconnect());
                diagnostics.record.cleanup.disconnect = "completed";
            } catch { diagnostics.record.cleanup.disconnect = "failed"; }
        }
        const text = JSON.stringify(diagnostics.record);
        // Fixed-schema console fallback remains available if the diagnostic file cannot be written.
        try { await writeFile(join(prepared, "diagnostic.json"), text, { flag: "wx" }); }
        catch { process.stderr.write("Task 39 diagnostic file unavailable.\n"); }
        process.stderr.write(text + "\n");
        if (diagnostics.record.status === "failed") process.exitCode = 1;
    }
}

export async function runCli(args: readonly string[]) {
    if (args.length === 0) return runOfflineSmoke();
    if (args.length === 1 && args[0] === "prepare-real") return prepareRealSmoke();
    if (args.length === 2 && args[0] === "real") return runRealSmoke(args[1]!);
    if (args.length === 1 && args[0] === "offline-v2") return runOfflineV2Smoke();
    if (args.length === 1 && args[0] === "prepare-real-v2") return prepareRealSmokeV2();
    if (args.length === 2 && args[0] === "real-v2") return runRealSmokeV2(args[1]!);
    throw new Error("Expected no arguments, prepare-real, real <prepared-root>, offline-v2, " +
        "prepare-real-v2, or real-v2 <prepared-root>; credentials are never arguments.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runCli(process.argv.slice(2)).then((result) => process.stdout.write(JSON.stringify(result) + "\n")).catch(() => {
        process.stderr.write("Task 39 smoke failed; details suppressed; isolated root retained; do not retry a real attempt.\n");
        process.exitCode = 1;
    });
}
