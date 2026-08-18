import { execFileSync } from "node:child_process";

import {
    applyMigrations,
    createIsolatedStackRoot,
    delay,
    disposeIsolatedStack,
    environmentForStack,
    findAvailablePort,
    formatProcessFailure,
    repositoryRoot,
    spawnService,
    stopManagedProcess,
    waitForHttp,
    type IsolatedStackRoot,
    type ManagedProcess,
} from "./helpers.js";

const webPort = readPort(process.env.COSMOS_E2E_WEB_PORT ?? process.argv[2] ?? "4173");
let stack: IsolatedStackRoot | null = null;
let api: ManagedProcess | null = null;
let worker: ManagedProcess | null = null;
let web: ManagedProcess | null = null;
let stopping = false;

async function main(): Promise<void> {
    stack = await createIsolatedStackRoot("browser-stack");
    applyMigrations(stack.dataRoot);
    const apiPort = await findAvailablePort(4310);
    const baseEnvironment = environmentForStack(process.env, stack, {
        NODE_ENV: "test",
        COSMOS_WORKSPACE_ROOT: repositoryRoot,
        COSMOS_WORKFLOW_HOST_ENABLED: "true",
        COSMOS_WORKER_ADMIN_ENABLED: "false",
        COSMOS_WORKER_POLL_MS: "50",
        COSMOS_WORKER_LEASE_MS: "30000",
        COSMOS_WORKER_SHUTDOWN_DEADLINE_MS: "5000",
        COSMOS_API_HOST: "127.0.0.1",
        COSMOS_API_PORT: String(apiPort),
        COSMOS_API_URL: `http://127.0.0.1:${apiPort}`,
        NEXT_PUBLIC_COSMOS_API_URL: "",
        COSMOS_LOG_OUTPUT: "both",
    });
    execFileSync(process.env.BUN_BINARY?.trim() || "bun", ["run", "build:web"], {
        cwd: repositoryRoot,
        env: baseEnvironment,
        stdio: "inherit",
    });
    api = spawnService({
        name: "browser-stack-api",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/api/dist/main.js"],
        cwd: repositoryRoot,
        env: baseEnvironment,
    });
    await waitForHttp(`http://127.0.0.1:${apiPort}/readyz`, 200, 30_000);

    worker = spawnService({
        name: "browser-stack-worker",
        command: process.env.NODE_BINARY?.trim() || "node",
        args: ["apps/worker/dist/main.js"],
        cwd: repositoryRoot,
        env: baseEnvironment,
    });
    await waitForHttp(`http://127.0.0.1:${apiPort}/api/v1/health`, 200, 30_000);

    web = spawnService({
        name: "browser-stack-web",
        command: process.env.BUN_BINARY?.trim() || "bun",
        args: ["run", "--cwd", "apps/web", "start", "--", "-H", "127.0.0.1", "-p", String(webPort)],
        cwd: repositoryRoot,
        env: {
            ...baseEnvironment,
            COSMOS_API_URL: `http://127.0.0.1:${apiPort}`,
            NEXT_PUBLIC_COSMOS_API_URL: "",
        },
    });
    await waitForHttp(`http://127.0.0.1:${webPort}`, 200, 60_000);
    process.stdout.write(`WEB_STACK_READY http://127.0.0.1:${webPort}\n`);

    await Promise.race([
        web.exited,
        api.exited,
        worker.exited,
    ]).then(async () => {
        if (!stopping) {
            throw new Error([
                web ? formatProcessFailure(web) : "",
                api ? formatProcessFailure(api) : "",
                worker ? formatProcessFailure(worker) : "",
            ].filter(Boolean).join("\n"));
        }
    });
}

async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await stopManagedProcess(web, "graceful").catch(() => undefined);
    await stopManagedProcess(worker, "force").catch(() => undefined);
    await stopManagedProcess(api, "force").catch(() => undefined);
    if (stack) await disposeIsolatedStack(stack.root).catch(() => undefined);
}

function readPort(raw: string): number {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
        throw new Error(`Invalid browser Web port: ${raw}`);
    }
    return value;
}

process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));

void main()
    .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (stopping) await delay(0);
    });
