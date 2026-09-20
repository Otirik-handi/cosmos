import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { SecretStorePort } from "@cosmos/application";

export interface FileSecretStoreConfig {
    root: string;
}

/**
 * 解析不透明 SecretRef 对应的文件路径，并拒绝逃出 SecretStore 根的引用。
 *
 * 不能用「含 `:` 就拒绝」来判断逃逸：产品侧写入的 ref 形态是 `secret:conn-1`
 * （API 与仓储测试都用这个形态），冒号只是名字的一部分。逃逸改由 `isAbsolute`
 * 与「解析后仍在根内」判断——它同时覆盖 `../` 与 Windows 盘符绝对路径。
 */
function resolveSecretPath(config: FileSecretStoreConfig, secretRef: string): string {
    const resolvedRoot = resolve(config.root);
    if (secretRef.length === 0) {
        throw new Error("Secret ref must not be empty.");
    }
    const resolvedPath = resolve(resolvedRoot, secretRef);
    const relativePath = relative(resolvedRoot, resolvedPath);

    if (
        isAbsolute(secretRef)
        || relativePath === ""
        || relativePath.startsWith("..")
        || isAbsolute(relativePath)
    ) {
        throw new Error("Secret ref escapes the configured SecretStore root.");
    }

    return resolvedPath;
}

/**
 * First SecretStore backend (ADR-0017 decision 2): a restricted-permission plain
 * file per opaque SecretRef, under the reserved `secretRoot`. Not encrypted —
 * v1 targets a single local user (OPS-007); encryption-at-rest is a Revisit Gate.
 * `mode: 0o600` is honored on POSIX and is a no-op on Windows (best effort).
 */
export class FileSecretStore implements SecretStorePort {
    constructor(private readonly config: FileSecretStoreConfig) {}

    async put(secretRef: string, value: string): Promise<void> {
        const path = resolveSecretPath(this.config, secretRef);
        await mkdir(resolve(this.config.root), { recursive: true });
        await writeFile(path, value, { mode: 0o600 });
    }

    async read(secretRef: string): Promise<string | null> {
        try {
            return await readFile(resolveSecretPath(this.config, secretRef), "utf8");
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }

    async delete(secretRef: string): Promise<boolean> {
        try {
            await unlink(resolveSecretPath(this.config, secretRef));
            return true;
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return false;
            }
            throw error;
        }
    }
}
