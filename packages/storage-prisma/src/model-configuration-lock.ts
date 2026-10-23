import { createRequire } from "node:module";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);

function loadNativeLock() {
    const native: unknown = require("fs-native-extensions");
    if (typeof native !== "object" || native === null
        || !("tryLock" in native) || typeof native.tryLock !== "function"
        || !("unlock" in native) || typeof native.unlock !== "function") {
        throw new Error("Native model configuration lock is unavailable.");
    }
    return { tryLock: native.tryLock, unlock: native.unlock };
}

/** The trusted storage root must be private to this installation, not caller input. */
export async function withModelConfigurationLock<T>(
    storageRoot: string,
    operationId: string,
    use: () => Promise<T>,
): Promise<T> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
        throw new Error("Invalid model configuration operation ID.");
    }
    const native = loadNativeLock();
    const directory = join(storageRoot, "model-configuration-locks");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // Never unlink or replace this file: competing handles must refer to one inode.
    const file = await open(join(directory, `${operationId.toLowerCase()}.lock`), "a+", 0o600);
    let acquired = false;
    try {
        const result: unknown = native.tryLock(file.fd, 0, 1);
        if (result === false) {
            throw Object.assign(new Error("Model configuration operation is busy."), { code: "operation_in_progress" });
        }
        if (result !== true) throw new Error("Native model configuration lock returned an invalid result.");
        acquired = true;
        // Do not race cancellation here: all callback-owned I/O must settle first.
        return await use();
    } finally {
        try {
            if (acquired) native.unlock(file.fd, 0, 1);
        } finally {
            await file.close();
        }
    }
}
