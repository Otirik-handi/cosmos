import type { WorkflowBlobStore } from "./workflow-ingest.js";

export async function toBlobRef(
    content: Uint8Array,
    mimeType: string | null,
    blobs: WorkflowBlobStore,
): Promise<{ key: string; hash: string; byteSize: number; mediaType: string }> {
    const stored = await blobs.put(content, {
        mimeType: mimeType ?? "application/octet-stream",
    });
    return {
        key: stored.key,
        hash: stored.hash,
        byteSize: stored.byteSize,
        mediaType: stored.mimeType ?? mimeType ?? "application/octet-stream",
    };
}
