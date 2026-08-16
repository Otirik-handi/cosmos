import { createHash } from "node:crypto";

export interface BlobRefLike {
    key: string;
    hash: string;
    byteSize: number;
    mediaType: string;
}

export class BlobRefNotFoundError extends Error {
    constructor(readonly key: string, options?: { cause?: unknown }) {
        super(`BlobRef target was not found: ${key}`, options);
        this.name = "BlobRefNotFoundError";
    }
}

export class BlobIntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlobIntegrityError";
    }
}

export async function readVerifiedBlob(
    blobs: Pick<{ read(key: string): Promise<Uint8Array> }, "read">,
    reference: BlobRefLike,
): Promise<Uint8Array> {
    let content: Uint8Array;
    try {
        content = await blobs.read(reference.key);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            throw new BlobRefNotFoundError(reference.key, { cause: error });
        }
        throw error;
    }

    const digest = createHash("sha256").update(content).digest("hex");
    const hash = `sha256:${digest}`;
    const expectedKey = `sha256/${digest.slice(0, 2)}/${digest.slice(2)}`;
    if (
        reference.hash !== hash
        || reference.key !== expectedKey
        || reference.byteSize !== content.byteLength
    ) {
        throw new BlobIntegrityError(`BlobRef integrity check failed for ${reference.key}.`);
    }
    return content;
}
