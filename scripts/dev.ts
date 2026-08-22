import {
    execFileSync,
    spawn,
    type ChildProcess,
} from "node:child_process";
import { fileURLToPath } from "node:url";

import { createWorkspaceDevEnvironment } from "./dev-env.js";
import {
    findAvailablePort,
    withApiPortEnvironment,
} from "./dev-port.js";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const children: ChildProcess[] = [];
let shuttingDown = false;

function stopChild(child: ChildProcess): void {
    if (!child.pid) {
        return;
    }

    if (process.platform === "win32") {
        try {
            execFileSync("taskkill", [
                "/pid",
                String(child.pid),
                "/t",
                "/f",
            ], {
                stdio: "ignore",
            });
        } catch {
            // The child may already have exited while the process tree was being closed.
        }
        return;
    }

    child.kill("SIGTERM");
}

function stopAll(exitCode: number): void {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    for (const child of children) {
        stopChild(child);
    }
    process.exit(exitCode);
}

async function start(): Promise<void> {
    const baseEnvironment = createWorkspaceDevEnvironment(rootDirectory);

    const apiHost = baseEnvironment.COSMOS_API_HOST ?? "127.0.0.1";
    const adminHost = baseEnvironment.COSMOS_WORKER_ADMIN_HOST ?? "127.0.0.1";
    const selectedPorts = new Set<number>();

    // Worker Admin 合同允许端口 0（动态分配）；API/Web 需要确定值供 rewrite/参数使用。
    async function resolveServicePort(
        preferred: number,
        host: string,
        label: string,
    ): Promise<number> {
        if (preferred === 0 && label === "COSMOS_WORKER_ADMIN_PORT") {
            return 0;
        }
        const port = await findAvailablePort(preferred, host, 50, label, selectedPorts);
        selectedPorts.add(port);
        return port;
    }

    const apiPreferred = Number(baseEnvironment.COSMOS_API_PORT ?? "4310");
    const adminPreferred = Number(baseEnvironment.COSMOS_WORKER_ADMIN_PORT ?? "9091");
    const webPreferred = Number(baseEnvironment.COSMOS_WEB_PORT ?? "3000");

    const apiPort = await resolveServicePort(apiPreferred, apiHost, "COSMOS_API_PORT");
    const adminPort = await resolveServicePort(
        adminPreferred,
        adminHost,
        "COSMOS_WORKER_ADMIN_PORT",
    );
    const webPort = await resolveServicePort(webPreferred, "127.0.0.1", "COSMOS_WEB_PORT");

    for (const [name, preferred, selected] of [
        ["API", apiPreferred, apiPort],
        ["Worker Admin", adminPreferred, adminPort],
        ["Web", webPreferred, webPort],
    ] as const) {
        if (preferred !== selected) {
            console.warn(`[dev] ${name} port ${preferred} is occupied; using ${selected}.`);
        }
    }

    const environment: NodeJS.ProcessEnv = {
        ...withApiPortEnvironment(baseEnvironment, apiPort),
        COSMOS_WEB_PORT: String(webPort),
        COSMOS_WORKER_ADMIN_HOST: adminHost,
        COSMOS_WORKER_ADMIN_PORT: String(adminPort),
    };

    for (const [name, directory] of [
        ["web", "apps/web"],
        ["api", "apps/api"],
        ["worker", "apps/worker"],
    ] as const) {
        const extraArgs = name === "web"
            ? ["--", "--port", String(webPort)]
            : [];
        const child = spawn(
            process.execPath,
            ["run", "--cwd", directory, "dev", ...extraArgs],
            {
                cwd: rootDirectory,
                env: environment,
                stdio: "inherit",
            },
        );
        children.push(child);
        child.on("exit", (code) => {
            if (!shuttingDown && code !== 0) {
                console.error(`[dev] ${name} exited with code ${code ?? "unknown"}`);
                stopAll(code ?? 1);
            }
        });
    }
}

void start().catch((error) => {
    console.error(
        `[dev] failed to select an API port: ${
            error instanceof Error ? error.message : String(error)
        }`,
    );
    process.exitCode = 1;
});

process.once("SIGINT", () => stopAll(0));
process.once("SIGTERM", () => stopAll(0));
process.once("exit", () => {
    for (const child of children) {
        stopChild(child);
    }
});
