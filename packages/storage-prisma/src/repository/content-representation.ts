import { bindContentBlocks, type ContentAssetBinding, type ContentDraft } from "@cosmos/application";
import { contentRepresentationSchema } from "@cosmos/contracts";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

/** Asset IDs must come from the same transaction and source revision. */
export async function persistInitialContentRepresentation(
    tx: Prisma.TransactionClient,
    entryRevisionId: string,
    draft: ContentDraft,
    assets: readonly ContentAssetBinding[],
): Promise<void> {
    const representation = contentRepresentationSchema.parse({
        id: randomUUID(),
        entryRevisionId,
        representationVersion: 1,
        parserVersion: draft.parserVersion,
        status: draft.status,
        blocks: bindContentBlocks(draft.blocks, assets),
        contentText: draft.contentText,
        qualitySignals: draft.qualitySignals,
        supersedesRepresentationId: null,
        createdAt: new Date().toISOString(),
    });
    await tx.contentRepresentation.create({
        data: {
            id: representation.id,
            entryRevisionId,
            representationVersion: representation.representationVersion,
            parserVersion: representation.parserVersion,
            status: representation.status,
            blocksJson: JSON.stringify(representation.blocks),
            contentText: representation.contentText,
            qualitySignalsJson: JSON.stringify(representation.qualitySignals),
            createdAt: new Date(representation.createdAt),
        },
    });
    await tx.entryRevision.update({
        where: { id: entryRevisionId },
        data: { currentRepresentationId: representation.id },
    });
}
