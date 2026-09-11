import { type EntityDetail } from "@cosmos/contracts";
import { parseJson } from "./repository-internals.js";
import { PrismaCosmosRepositoryBase } from "./base.js";

export class PrismaCosmosRepositoryHelpers1 extends PrismaCosmosRepositoryBase {
    async entity(entityId: string): Promise<EntityDetail | null> {
        return this.toEntityDetail(entityId);
    }

    protected async toEntityDetail(entityId: string): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: entityId },
            include: {
                currentRevision: true,
                aliases: {
                    orderBy: { name: "asc" },
                },
                storyLinks: true,
                fromRelations: true,
                toRelations: true,
            },
        });
        if (!entity || !entity.currentRevision) {
            return null;
        }
        const relations = [
            ...entity.fromRelations.map((relation) => ({
                fromEntityId: relation.fromEntityId,
                relationType: relation.relationType,
                toEntityId: relation.toEntityId,
                producer: relation.producer,
                producerVersion: relation.producerVersion,
                confidence: relation.confidence,
                evidence: relation.evidence,
                actor: relation.actorJson == null ? null : parseJson<string>(relation.actorJson),
                reason: relation.reason,
            })),
            ...entity.toRelations.map((relation) => ({
                fromEntityId: relation.fromEntityId,
                relationType: relation.relationType,
                toEntityId: relation.toEntityId,
                producer: relation.producer,
                producerVersion: relation.producerVersion,
                confidence: relation.confidence,
                evidence: relation.evidence,
                actor: relation.actorJson == null ? null : parseJson<string>(relation.actorJson),
                reason: relation.reason,
            })),
        ];
        return {
            entity: {
                id: entity.id,
                revisionId: entity.currentRevision.id,
                type: entity.currentRevision.type,
                name: entity.currentRevision.name,
            },
            aliases: entity.aliases.map((alias) => alias.name),
            stories: entity.storyLinks.map((link) => ({
                storyId: link.storyId,
                producer: link.producer,
                producerVersion: link.producerVersion,
                confidence: link.confidence,
                evidence: link.evidence,
                actor: link.actorJson == null ? null : parseJson<string>(link.actorJson),
                reason: link.reason,
            })),
            relations,
        };
    }

    // ---------------------------------------------------------------------
    // User organization v1 (ADR-0009): Label + Collection + Favorite
    // ---------------------------------------------------------------------

    protected toAssetSnapshot(asset: {
        id: string;
        kind: string;
        status: string;
        sourceUrl: string | null;
        storageKey: string | null;
        mimeType: string | null;
        byteSize: number | null;
        errorMessage?: string | null;
        errorCode?: string | null;
        attemptCount?: number;
    }) {
        return {
            id: asset.id,
            kind: asset.kind,
            status: asset.status as "saved" | "metadata_only" | "skipped" | "failed",
            sourceUrl: asset.sourceUrl,
            storageKey: asset.storageKey,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            errorMessage: asset.errorMessage ?? null,
            errorCode: asset.errorCode ?? null,
            attemptCount: asset.attemptCount ?? 0,
        };
    }
}
