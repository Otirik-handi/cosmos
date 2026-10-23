import { access, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withModelConfigurationLock } from "./model-configuration-lock.js";

const [root, participant, operationId, mode] = process.argv.slice(2);
if (!root || !participant || !operationId || !["hold", "once"].includes(mode ?? "")) {
    throw new Error("Invalid synthetic lock fixture invocation.");
}
async function emit(event: string): Promise<void> {
    const destination = join(root!, `${participant}.${event}`);
    await writeFile(`${destination}.pending`, event);
    await rename(`${destination}.pending`, destination);
}
async function released(): Promise<boolean> {
    try { await access(join(root!, `${participant}.release`)); return true; }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
    }
}
try {
    await withModelConfigurationLock(root, operationId, async () => {
        await emit("acquired");
        if (mode === "hold") {
            while (!await released()) await new Promise((resolve) => setTimeout(resolve, 20));
        }
    });
    await emit("done");
} catch (error) {
    if (error instanceof Error && error.message === "Model configuration operation is busy.") {
        await emit("busy");
    } else {
        await emit("failed");
        process.exitCode = 1;
    }
}
