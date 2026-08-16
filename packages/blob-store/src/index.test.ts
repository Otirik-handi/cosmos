import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
    BlobIntegrityError,
    createBlobStoreConfig,
    FileBlobStore,
    readVerifiedBlob,
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

        const content = new TextEncoder().encode("hello");
        const stored = await store.put(content, {
            mimeType: "text/plain",
        });

        expect(stored.key).toMatch(/^sha256\/[a-f0-9]{2}\/[a-f0-9]{62}$/);
        expect(stored.hash).toBe("sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        expect(new TextDecoder().decode(await store.read(stored.key))).toBe("hello");
        expect(await store.exists(stored.key)).toBe(true);
        expect(new TextDecoder().decode(await readVerifiedBlob(store, {
            key: stored.key,
            hash: stored.hash,
            byteSize: stored.byteSize,
            mediaType: stored.mimeType ?? "application/octet-stream",
        }))).toBe("hello");

        await expect(readVerifiedBlob(store, {
            key: stored.key,
            hash: "sha256:bad",
            byteSize: stored.byteSize,
            mediaType: "text/plain",
        })).rejects.toBeInstanceOf(BlobIntegrityError);
    });

    it("rejects blob keys outside the configured root", () => {
        const config = createBlobStoreConfig("C:/cosmos-test/blobs");

        expect(() => resolveBlobKey(config, "../secrets.txt")).toThrow(
            "Blob key escapes",
        );
    });
});
