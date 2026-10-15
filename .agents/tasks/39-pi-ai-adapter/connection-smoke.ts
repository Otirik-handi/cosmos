import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import type { Readable } from "node:stream";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { ActionRegistry, type LoggerPort } from "@cosmos/application";
import type { PiAiClient } from "@cosmos/agent-pi-ai";
import { agentInvocationOutputSchema } from "@cosmos/contracts";
import { PrismaCosmosRepository } from "@cosmos/storage-prisma";
import { resolvePrismaCliPath } from "../../../packages/storage-prisma/src/prisma-cli.js";
import { createWorkerAgentAction } from "../../../apps/worker/src/agent-action.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const snapshotPath = "packages/storage-prisma/prisma";
const provider = "jijiapi";
const model = "gpt-6-luna";
const secretRef = "secret:task39-connection-smoke";
export const SNAPSHOT_COMMIT = "f66c33135351af38460fff73d311863dc7b4ef47";
export const SYNTHETIC_CREDENTIAL = "task39-synthetic-offline-only";
export const ISOLATION_PARENT = join(repositoryRoot, ".agent/tmp");
export const ROOT_PREFIX = "task39-offline-";

// This helper is retained for a separately approved real-terminal acceptance step.
export function validateRunnerInvocation(input: {
    args: readonly string[];
    environment: NodeJS.ProcessEnv;
    inputIsTTY: boolean;
    outputIsTTY: boolean;
}): void {
    if (input.args.length !== 0) throw new Error("This runner accepts no command-line arguments.");
    if (input.environment.COSMOS_TEST_API_KEY !== undefined || input.environment.COSMOS_AGENT_API_KEY !== undefined) {
        throw new Error("Credential environment variables are not accepted by this runner.");
    }
    if (!input.inputIsTTY || !input.outputIsTTY) {
        throw new Error("A real interactive terminal is required; no credential was read.");
    }
}

export async function readCredentialWithoutEcho(input: Readable & {
    isTTY?: boolean;
    setRawMode?: (enabled: boolean) => void;
}, outputIsTTY: boolean): Promise<string> {
    if (!input.isTTY || !outputIsTTY || typeof input.setRawMode !== "function") {
        throw new Error("A real interactive terminal is required; no credential was read.");
    }
    input.setRawMode(true);
    input.resume();
    const chunks: string[] = [];
    let onData: ((chunk: Buffer) => void) | undefined;
    let onEnd: (() => void) | undefined;
    try {
        return await new Promise<string>((resolveCredential, reject) => {
            onData = (chunk: Buffer) => {
                for (const character of chunk.toString("utf8")) {
                    if (character === "\u0003") {
                        reject(new Error("Credential entry cancelled."));
                        return;
                    }
                    if (character === "\r" || character === "\n") {
                        resolveCredential(chunks.join(""));
                        return;
                    }
                    if (character === "\u007f" || character === "\b") chunks.pop();
                    else chunks.push(character);
                }
            };
            onEnd = () => reject(new Error("Credential input ended before submission."));
            input.on("data", onData);
            input.once("end", onEnd);
        });
    } finally {
        if (onData) input.off("data", onData);
        if (onEnd) input.off("end", onEnd);
        input.setRawMode(false);
        input.pause();
        chunks.fill("");
    }
}

// File descriptors avoid the Windows sandbox's named-pipe subprocess boundary.
function runToFile(command: string, args: string[], output: string, cwd: string, env?: NodeJS.ProcessEnv): void {
    const descriptor = openSync(output, "w");
    try {
        const result = spawnSync(command, args, { cwd, env, stdio: ["ignore", descriptor, "ignore"] });
        if (result.error || result.status !== 0) throw new Error("Isolated subprocess failed; details suppressed.");
    } finally {
        closeSync(descriptor);
    }
}

export async function exportFrozenSnapshot(root: string): Promise<{
    schemaPath: string;
    manifest: Array<{ path: string; sha256: string }>;
}> {
    const listing = join(root, "snapshot-paths.txt");
    runToFile("git", ["ls-tree", "-r", "--name-only", SNAPSHOT_COMMIT, snapshotPath], listing, repositoryRoot);
    const paths = (await readFile(listing, "utf8")).trim().split(/\r?\n/);
    if (paths.filter((path) => path.endsWith("/migration.sql")).length !== 37) {
        throw new Error("Frozen migration count changed.");
    }
    const manifest: Array<{ path: string; sha256: string }> = [];
    for (const path of paths) {
        if (!path.startsWith(`${snapshotPath}/`) || path.includes("..")) throw new Error("Invalid snapshot path.");
        const destination = join(root, "schema-snapshot", path);
        await mkdir(dirname(destination), { recursive: true });
        runToFile("git", ["show", `${SNAPSHOT_COMMIT}:${path}`], destination, repositoryRoot);
        manifest.push({ path, sha256: createHash("sha256").update(await readFile(destination)).digest("hex") });
    }
    await writeFile(join(root, "snapshot-manifest.json"), JSON.stringify({ commit: SNAPSHOT_COMMIT, files: manifest }, null, 4));
    return { schemaPath: join(root, "schema-snapshot", snapshotPath, "schema.prisma"), manifest };
}

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

export async function dispatchInvocation(repository: PrismaCosmosRepository, connectionId: string, client?: PiAiClient,
    baseUrl = "https://task39.invalid/v1", credential = SYNTHETIC_CREDENTIAL) {
    let secretReads = 0;
    const action = createWorkerAgentAction({
        provider, model, api: "openai-completions", baseUrl,
        contextWindow: 262_144, maxOutputTokens: 64, connectionId,
    }, {
        connections: repository,
        secrets: {
            put: (ref, value) => repository.secrets.put(ref, value),
            delete: (ref) => repository.secrets.delete(ref),
            read: (ref) => { secretReads += 1; return repository.secrets.read(ref); },
        },
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

async function prepareDatabase(root: string) {
    const { schemaPath, manifest } = await exportFrozenSnapshot(root);
    const databaseUrl = `file:${join(root, "cosmos.sqlite").replaceAll("\\", "/")}`;
    // No inherited credentials or ambient DATABASE_URL reach the migration process.
    runToFile(process.execPath, [resolvePrismaCliPath(), "migrate", "deploy", "--schema", schemaPath],
        join(root, "migration.log"), root, {
            PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root,
            DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1",
        });
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
        const migrations = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
            'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
        );
        const expected = manifest.filter((item) => item.path.endsWith("/migration.sql"))
            .map((item) => item.path.split("/").at(-2));
        if (JSON.stringify(migrations.map((item) => item.migration_name)) !== JSON.stringify(expected)) {
            throw new Error("Deployed migrations do not match the frozen manifest.");
        }
        return { databaseUrl, migrationCount: migrations.length };
    } finally { await prisma.$disconnect(); }
}

export async function runOfflineSmoke() {
    await mkdir(ISOLATION_PARENT, { recursive: true });
    const root = await mkdtemp(join(ISOLATION_PARENT, ROOT_PREFIX));
    process.stdout.write(JSON.stringify({ mode: "offline", isolatedRoot: root, retained: true }) + "\n");
    const { databaseUrl, migrationCount } = await prepareDatabase(root);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const logs: unknown[] = [];
    const logger: LoggerPort = {
        child: () => logger, withContext: (_context, callback) => callback(),
        debug: (event, fields) => { logs.push({ event, fields }); },
        info: (event, fields) => { logs.push({ event, fields }); },
        warn: (event, fields) => { logs.push({ event, fields }); },
        error: (event, fields) => { logs.push({ event, fields }); },
    };
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

// The standalone CLI owns these globals only until its single SDK invocation settles.
export async function withBoundedProviderTransport<T>(use: () => Promise<T>, transport = globalThis.fetch,
    onSend: () => void = () => undefined, onResponse: (response: Response) => void = () => undefined): Promise<T> {
    const previousFetch = globalThis.fetch;
    const previousLog = process.env.OPENAI_LOG;
    let sent = false;
    process.env.OPENAI_LOG = "off";
    globalThis.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (sent || url !== "https://api-slb.jiji.cc/v1/chat/completions" || method.toUpperCase() !== "POST") {
            throw new Error("Task 39 transport rejected the request.");
        }
        sent = true;
        onSend();
        const response = await transport(input, { ...init, redirect: "error" });
        onResponse(response);
        return response;
    };
    try { return await use(); }
    finally {
        globalThis.fetch = previousFetch;
        if (previousLog === undefined) delete process.env.OPENAI_LOG;
        else process.env.OPENAI_LOG = previousLog;
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
    if (dirname(resolved) !== parent || !resolved.startsWith(join(parent, "task39-real-"))) {
        throw new Error("Only the prepared Task 39 real root is accepted.");
    }
    const plan = JSON.parse(await readFile(join(resolved, "request-plan.json"), "utf8")) as unknown;
    if (JSON.stringify(plan) !== JSON.stringify(requestPlan(resolved))) throw new Error("Request plan changed.");
    return resolved;
}

type DiagnosticStage = "credential_input" | "database_initialize" | "connection_create" |
    "secret_write" | "dispatch" | "result_write" | "secret_delete" | "disconnect";
type SafeFailureCategory = "aborted" | "authentication_required" | "rate_limited" | "timeout" |
    "dependency_unavailable" | "malformed_payload" | "operation_failed";

function safeFailureCategory(error: unknown): SafeFailureCategory {
    if (error instanceof Error && error.name === "AbortError") return "aborted";
    if (typeof error === "object" && error !== null && "code" in error) {
        const code = error.code;
        if (code === "authentication_required" || code === "rate_limited" || code === "timeout" ||
            code === "dependency_unavailable" || code === "malformed_payload") return code;
    }
    return "operation_failed";
}

export function createSafeDiagnostics() {
    const record = { version: 1, status: "running" as "running" | "completed" | "failed",
        stage: "credential_input" as DiagnosticStage, transportSends: 0,
        response: { returned: false, status: null as number | null },
        firstFailure: null as null | { stage: DiagnosticStage; category: SafeFailureCategory },
        cleanup: { secretDelete: "not_started", disconnect: "not_started" } };
    return {
        record,
        async step<T>(stage: DiagnosticStage, use: () => Promise<T>): Promise<T> {
            record.stage = stage;
            try { return await use(); }
            catch (error) {
                // Only fixed categories cross the diagnostic boundary; never serialize the error.
                record.firstFailure ??= { stage, category: safeFailureCategory(error) };
                record.status = "failed";
                throw error;
            }
        },
    };
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
            if (!value.trim()) throw new Error("Empty credential.");
            return value;
        });
        process.stdout.write("\n");
        let logEvents = 0;
        const logger: LoggerPort = { child: () => logger, withContext: (_context, callback) => callback(),
            debug: () => { logEvents += 1; }, info: () => { logEvents += 1; },
            warn: () => { logEvents += 1; }, error: () => { logEvents += 1; } };
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
        const result = { status: "completed", mode: "real", isolatedRoot: prepared, ...summary, logEvents,
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
    throw new Error("Expected no arguments, prepare-real, or real <prepared-root>; credentials are never arguments.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runCli(process.argv.slice(2)).then((result) => process.stdout.write(JSON.stringify(result) + "\n")).catch(() => {
        process.stderr.write("Task 39 smoke failed; details suppressed; isolated root retained; do not retry a real attempt.\n");
        process.exitCode = 1;
    });
}
