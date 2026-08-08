import {
    execFileSync,
    spawn,
    type ChildProcess,
} from "node:child_process";
import { fileURLToPath } from "node:url";

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

for (const [name, directory] of [
    ["web", "apps/web"],
    ["api", "apps/api"],
    ["worker", "apps/worker"],
] as const) {
    const child = spawn(process.execPath, ["run", "--cwd", directory, "dev"], {
        cwd: rootDirectory,
        env: {
            ...process.env,
            COSMOS_WORKSPACE_ROOT: rootDirectory,
        },
        stdio: "inherit",
    });

    children.push(child);
    child.on("exit", (code) => {
        if (!shuttingDown && code !== 0) {
            console.error(`[dev] ${name} exited with code ${code ?? "unknown"}`);
            stopAll(code ?? 1);
        }
    });
}

process.once("SIGINT", () => stopAll(0));
process.once("SIGTERM", () => stopAll(0));
process.once("exit", () => {
    for (const child of children) {
        stopChild(child);
    }
});
