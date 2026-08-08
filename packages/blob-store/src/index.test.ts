import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
    createBlobStoreConfig,
    FileBlobStore,
    resolveBlobKey,
} from "./index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
});

describe("FileBlobStore", () => {
    it("stores content under a content-addressed key and reads it back", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-blob-test-"));
        temporaryRoots.push(root);
        const store = new FileBlobStore(createBlobStoreConfig(root));

        const stored = await store.put(new TextEncoder().encode("hello"), {
            mimeType: "text/plain",
        });

        expect(stored.key).toMatch(/^sha256\/[a-f0-9]{2}\/[a-f0-9]{62}$/);
        expect(new TextDecoder().decode(await store.read(stored.key))).toBe("hello");
        expect(await store.exists(stored.key)).toBe(true);
    });

    it("rejects blob keys outside the configured root", () => {
        const config = createBlobStoreConfig("C:/cosmos-test/blobs");

        expect(() => resolveBlobKey(config, "../secrets.txt")).toThrow(
            "Blob key escapes",
        );
    });
});
