import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { FileSecretStore } from "./secret-store.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileSecretStore", () => {
    it("stores, reads and deletes a secret by opaque ref", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-secret-store-"));
        roots.push(root);
        const store = new FileSecretStore({ root: join(root, "secrets") });

        await expect(store.read("missing")).resolves.toBeNull();

        await store.put("secret-1", "token-value");
        await expect(store.read("secret-1")).resolves.toBe("token-value");

        await expect(store.delete("secret-1")).resolves.toBe(true);
        await expect(store.read("secret-1")).resolves.toBeNull();
        await expect(store.delete("secret-1")).resolves.toBe(false);
    });

    it("accepts the product ref shape with a colon", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-secret-store-"));
        roots.push(root);
        const store = new FileSecretStore({ root: join(root, "secrets") });

        // 产品侧写入的 ref 形态就是 `secret:<id>`；冒号是名字的一部分，不是路径分隔。
        await store.put("secret:conn-1", "token-value");
        await expect(store.read("secret:conn-1")).resolves.toBe("token-value");
        await expect(store.delete("secret:conn-1")).resolves.toBe(true);
    });

    it("rejects a secret ref that escapes the root", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-secret-store-"));
        roots.push(root);
        const store = new FileSecretStore({ root: join(root, "secrets") });

        await expect(store.put("../escape", "x")).rejects.toThrow(/escapes/);
        await expect(store.put(join(root, "absolute"), "x")).rejects.toThrow(/escapes/);
        await expect(store.put("", "x")).rejects.toThrow(/must not be empty/);
    });
});
