import { randomUUID } from "node:crypto";
import { ContentCommandError, bindContentBlocks, type ContentAssetBinding, type ContentRebuildRepository } from "@cosmos/application";
import { contentRepresentationSchema } from "@cosmos/contracts";
import type { PrismaClient } from "@prisma/client";
import { selectContentRepresentation } from "./representation-selection.js";
import { appendDomainEvent } from "./repository-internals.js";

interface ContentInputReader {
    read(key: string): Promise<Uint8Array>;
}

export class PrismaContentRebuildRepository implements ContentRebuildRepository {
    constructor(private readonly prisma: PrismaClient, private readonly blobs: ContentInputReader) {}

    async readRebuildSource(entryRevisionId: string) {
        const revision = await this.prisma.entryRevision.findUnique({
            where: { id: entryRevisionId },
            include: { evidenceObservation: true },
        });
        if (!revision) return null;
        const key = revision.evidenceObservation?.contentSourceBlobKey;
        const source: unknown = key ? JSON.parse(new TextDecoder().decode(await this.blobs.read(key))) : null;
        return { currentRepresentationId: revision.currentRepresentationId, locked: revision.representationLocked, source };
    }

    async commitRebuild(input: Parameters<ContentRebuildRepository["commitRebuild"]>[0]) {
        return this.prisma.$transaction(async (tx) => {
            const revision = await tx.entryRevision.findUniqueOrThrow({
                where: { id: input.entryRevisionId }, include: { assets: true },
            });
            if (revision.currentRepresentationId !== input.expectedCurrentId || revision.representationLocked !== input.expectedLocked) {
                throw new ContentCommandError("conflict", "Content representation selection conflict");
            }
            const latest = await tx.contentRepresentation.findFirst({
                where: { entryRevisionId: revision.id }, orderBy: { representationVersion: "desc" },
            });
            const assets = revision.assets.flatMap<ContentAssetBinding>((asset) => {
                if (!asset.sourceUrl || (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio")) return [];
                return [{ id: asset.id, kind: asset.kind, sourceUrl: asset.sourceUrl }];
            });
            const representation = contentRepresentationSchema.parse({
                id: randomUUID(), entryRevisionId: revision.id,
                representationVersion: (latest?.representationVersion ?? 0) + 1,
                parserVersion: input.draft.parserVersion, status: input.draft.status,
                blocks: bindContentBlocks(input.draft.blocks, assets), contentText: input.draft.contentText,
                qualitySignals: input.draft.qualitySignals, createdAt: new Date().toISOString(),
                supersedesRepresentationId: latest?.id ?? null,
            });
            await tx.contentRepresentation.create({ data: {
                id: representation.id, entryRevisionId: revision.id,
                representationVersion: representation.representationVersion,
                parserVersion: representation.parserVersion, status: representation.status,
                blocksJson: JSON.stringify(representation.blocks), contentText: representation.contentText,
                qualitySignalsJson: JSON.stringify(representation.qualitySignals),
                supersedesRepresentationId: representation.supersedesRepresentationId,
            } });
            const promoted = await selectContentRepresentation(tx, {
                entryRevisionId: revision.id, representationId: representation.id,
                expectedCurrentId: input.expectedCurrentId, mode: "automatic",
                systemRecommended: true, actorId: input.actorId,
            });
            await appendDomainEvent(tx, {
                type: "content.representation.rebuilt", aggregateType: "EntryRevision", aggregateId: revision.id,
                payload: { actorId: input.actorId, representationId: representation.id, representationVersion: representation.representationVersion, promoted },
            });
            return { representationId: representation.id, representationVersion: representation.representationVersion, promoted };
        });
    }
}
