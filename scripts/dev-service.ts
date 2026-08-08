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
const services = {
    api: "apps/api",
    worker: "apps/worker",
} as const;
const service = process.argv[2] as keyof typeof services | undefined;

if (!service || !(service in services)) {
    throw new Error("Usage: bun run scripts/dev-service.ts <api|worker>");
}

let shuttingDown = false;
let child: ChildProcess | undefined;

function stop(exitCode: number): void {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    if (!child?.pid) {
        process.exit(exitCode);
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
            // The child may already have exited.
        }
    } else {
        child.kill("SIGTERM");
    }
    process.exit(exitCode);
}

async function start(): Promise<void> {
    const baseEnvironment = createWorkspaceDevEnvironment(rootDirectory);
    const environment = service === "api"
        ? withApiPortEnvironment(
            baseEnvironment,
            await findAvailablePort(
                Number(baseEnvironment.COSMOS_API_PORT ?? "4310"),
                baseEnvironment.COSMOS_API_HOST ?? "127.0.0.1",
            ),
        )
        : baseEnvironment;

    const configuredPort = Number(baseEnvironment.COSMOS_API_PORT ?? "4310");
    const selectedPort = Number(environment.COSMOS_API_PORT ?? "4310");
    if (service === "api" && selectedPort !== configuredPort) {
        console.warn(
            `[dev:${service}] API port ${configuredPort} is occupied; `
            + `using ${selectedPort}.`,
        );
    }

    child = spawn(
        process.execPath,
        ["run", "--cwd", services[service], "dev"],
        {
            cwd: rootDirectory,
            env: environment,
            stdio: "inherit",
        },
    );

    child.on("exit", (code) => {
        if (!shuttingDown) {
            process.exit(code ?? 1);
        }
    });
}

void start().catch((error) => {
    console.error(
        `[dev:${service}] failed to start: ${
            error instanceof Error ? error.message : String(error)
        }`,
    );
    process.exitCode = 1;
});

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
process.once("exit", () => {
    if (!shuttingDown && child?.pid) {
        try {
            child.kill();
        } catch {
            // The child may already have exited.
        }
    }
});
