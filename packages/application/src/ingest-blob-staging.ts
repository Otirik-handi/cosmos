import type { NormalizedAssetInput, NormalizedIngestItem } from "@cosmos/domain";

export interface IngestBlobReference {
    key: string;
    byteSize: number;
}

export interface IngestBlobWriter {
    put(content: Uint8Array, options: { mimeType?: string | null }): Promise<IngestBlobReference>;
}

export interface StagedIngestBlobs {
    rawPayload: IngestBlobReference;
    contentSource?: IngestBlobReference;
    assets: readonly (NormalizedAssetInput & { storageKey: string | null })[];
}

/** Bytes are prepared before the database transaction; a shared key must never be deleted on rollback. */
export async function stageIngestBlobs(
    item: NormalizedIngestItem,
    blobs: IngestBlobWriter,
): Promise<StagedIngestBlobs> {
    const rawPayload = await blobs.put(new TextEncoder().encode(item.rawPayload), {
        mimeType: item.rawPayloadMimeType ?? "application/octet-stream",
    });
    const contentSource = item.contentSource
        ? await blobs.put(new TextEncoder().encode(JSON.stringify(item.contentSource)), { mimeType: "application/json" })
        : undefined;
    const assets = await Promise.all(item.assets.map(async (asset) => {
        if (asset.status !== "saved" || asset.content === null) {
            return { ...asset, storageKey: null };
        }
        const stored = await blobs.put(asset.content, { mimeType: asset.mimeType });
        return { ...asset, storageKey: stored.key, byteSize: stored.byteSize };
    }));
    return { rawPayload, contentSource, assets };
}
