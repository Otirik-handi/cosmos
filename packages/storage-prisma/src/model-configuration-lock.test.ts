import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { closeSync, existsSync, openSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { withModelConfigurationLock } from "./model-configuration-lock.js";

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const temporaryParent = join(repositoryRoot, ".agent/tmp");
const fixture = fileURLToPath(new URL("./model-configuration-lock.fixture.ts", import.meta.url));
if (process.release.name !== "node" || process.versions.bun !== undefined) {
    throw new Error("Run this suite with Node-hosted Vitest to verify the Node/Bun matrix.");
}
const runtimes = [
    { name: "node", executable: process.execPath,
        prefix: ["--import", pathToFileURL(require.resolve("tsx/esm")).href] },
    { name: "bun", executable: resolveBun(), prefix: [] as string[] },
];
function resolveBun(): string {
    const filename = process.platform === "win32" ? "bun.exe" : "bun";
    const candidates = [join(dirname(process.execPath), "node_modules/bun/bin", filename),
        ...(process.env.PATH ?? "").split(delimiter).map((directory) => join(directory, filename))];
    const candidate = candidates.find((path) => existsSync(path));
    if (!candidate) throw new Error("Bun executable is required for the approved lock tests.");
    return candidate;
}
async function createRoot(): Promise<string> {
    await mkdir(temporaryParent, { recursive: true });
    const root = await mkdtemp(join(temporaryParent, "task39-model-lock-"));
    console.info(`Retained synthetic lock root: ${root}`);
    return root;
}
async function exists(path: string): Promise<boolean> {
    try { await access(path); return true; }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
    }
}
async function waitFor(root: string, id: string, event: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!await exists(join(root, `${id}.${event}`))) {
        if (await exists(join(root, `${id}.failed`)) || Date.now() > deadline) {
            throw new Error(`Synthetic lock handshake failed: ${id}/${event}; inspect ${root}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}
function participant(root: string, id: string, operationId: string,
    runtime: typeof runtimes[number], mode: "hold" | "once") {
    const environment: NodeJS.ProcessEnv = { HOME: root, USERPROFILE: root, TEMP: root, TMP: root };
    for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
        if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    const log = openSync(join(root, `${id}.log`), "wx");
    let child: ChildProcess;
    try {
        child = spawn(runtime.executable, [...runtime.prefix, fixture, root, id, operationId, mode],
            { cwd: root, env: environment, stdio: ["ignore", log, log] });
    } finally { closeSync(log); }
    const exited = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code));
    });
    return { child, exited };
}
async function stop(process: ReturnType<typeof participant>): Promise<void> {
    if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill();
    await process.exited;
}

describe("model configuration operation lock", () => {
    it("rejects invalid operation IDs before creating paths", async () => {
        const root = await createRoot();
        for (const id of ["../escape", "", "CON", "a/b", "a\\b", `${randomUUID()}\n`]) {
            await expect(withModelConfigurationLock(root, id, async () => undefined))
                .rejects.toThrow("Invalid model configuration operation ID.");
        }
        expect(await readdir(root)).toEqual([]);
    });

    it("serializes independent handles, preserves the file, and releases after errors", async () => {
        const root = await createRoot();
        const id = randomUUID();
        await expect(withModelConfigurationLock(root, id, async () => {
            await expect(withModelConfigurationLock(root, id, async () => undefined))
                .rejects.toMatchObject({ code: "operation_in_progress", message: "Model configuration operation is busy." });
            expect(await withModelConfigurationLock(root, randomUUID(), async () => 7)).toBe(7);
            throw new Error("synthetic_callback_failure");
        })).rejects.toThrow("synthetic_callback_failure");
        const directory = join(root, "model-configuration-locks");
        const before = await readdir(directory);
        expect(before).toHaveLength(2);
        const path = join(directory, `${id}.lock`);
        const identity = await stat(path);
        expect(await withModelConfigurationLock(root, id, async () => "released")).toBe("released");
        expect(await readdir(directory)).toEqual(before);
        expect((await stat(path)).ino).toBe(identity.ino);
        expect(await readFile(path, "utf8")).toBe("");
    });

    it("retains ownership while a cancelled caller's callback is still pending", async () => {
        const root = await createRoot();
        const id = randomUUID();
        let finish!: () => void;
        let entered!: () => void;
        const pending = new Promise<void>((resolve) => { finish = resolve; });
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const operation = withModelConfigurationLock(root, id, async () => {
            entered();
            await pending;
            await writeFile(join(root, "synthetic.txt"), "synthetic-only");
        });
        try {
            await started;
            const controller = new AbortController();
            const cancellation = new Promise<never>((_, reject) => {
                controller.signal.addEventListener("abort", () => reject(new Error("caller_cancelled")), { once: true });
            });
            const caller = Promise.race([operation, cancellation]);
            controller.abort();
            await expect(caller).rejects.toThrow("caller_cancelled");
            await expect(withModelConfigurationLock(root, id, async () => undefined))
                .rejects.toMatchObject({ code: "operation_in_progress", message: "Model configuration operation is busy." });
        } finally { finish(); await operation; }
        await withModelConfigurationLock(root, id, async () => undefined);
        expect(await readFile(join(root, "synthetic.txt"), "utf8")).toBe("synthetic-only");
    });

    for (const ownerRuntime of runtimes) for (const contenderRuntime of runtimes) {
        it(`${ownerRuntime.name} owner / ${contenderRuntime.name} contender: contention, release, exit recovery`, async () => {
            const root = await createRoot();
            const id = randomUUID();
            const children: ReturnType<typeof participant>[] = [];
            const start = (label: string, operation: string, runtime: typeof runtimes[number], mode: "hold" | "once") => {
                const child = participant(root, label, operation, runtime, mode);
                children.push(child);
                return child;
            };
            try {
                const owner = start("owner", id, ownerRuntime, "hold");
                await waitFor(root, "owner", "acquired");
                const blocked = start("blocked", id, contenderRuntime, "once");
                await waitFor(root, "blocked", "busy");
                expect(await blocked.exited).toBe(0);
                const separate = start("separate", randomUUID(), contenderRuntime, "once");
                await waitFor(root, "separate", "done");
                expect(await separate.exited).toBe(0);
                await writeFile(join(root, "owner.release"), "release");
                await waitFor(root, "owner", "done");
                expect(await owner.exited).toBe(0);
                const next = start("next", id, contenderRuntime, "once");
                await waitFor(root, "next", "done");
                expect(await next.exited).toBe(0);
                const doomed = start("doomed", id, ownerRuntime, "hold");
                await waitFor(root, "doomed", "acquired");
                await stop(doomed);
                const recovered = start("recovered", id, contenderRuntime, "once");
                await waitFor(root, "recovered", "done");
                expect(await recovered.exited).toBe(0);
            } finally { await Promise.all(children.map(stop)); }
        });
    }
});
