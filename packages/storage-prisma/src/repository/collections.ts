import { type CollectionList, type CollectionSummary, type FavoriteList } from "@cosmos/contracts";
import { type FavoriteTargetType } from "@cosmos/domain";
import { CollectionNotFoundError, StoryNotFoundError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryLabels } from "./labels.js";

export class PrismaCosmosRepositoryCollections extends PrismaCosmosRepositoryLabels {
    async createCollection(input: {
        name: string;
        description?: string | null;
    }): Promise<CollectionSummary> {
        const name = input.name.trim();
        const description = input.description?.trim() || null;
        const collection = await this.prisma.$transaction(async (tx) => {
            const created = await tx.collection.create({
                data: { name, description },
            });
            await appendDomainEvent(tx, {
                type: "collection.created.v1",
                aggregateType: "Collection",
                aggregateId: created.id,
                payload: { collectionId: created.id, name, description },
            });
            return created;
        });
        return {
            id: collection.id,
            name: collection.name,
            description: collection.description,
            itemCount: 0,
            createdAt: collection.createdAt.toISOString(),
            updatedAt: collection.updatedAt.toISOString(),
        };
    }

    async updateCollection(input: {
        collectionId: string;
        name: string;
        description?: string | null;
    }): Promise<CollectionSummary> {
        const existing = await this.prisma.collection.findUnique({
            where: { id: input.collectionId },
            select: { id: true },
        });
        if (!existing) {
            throw new CollectionNotFoundError(input.collectionId);
        }
        const name = input.name.trim();
        const description = input.description?.trim() || null;
        await this.prisma.$transaction(async (tx) => {
            await tx.collection.update({
                where: { id: input.collectionId },
                data: { name, description },
            });
            await appendDomainEvent(tx, {
                type: "collection.updated.v1",
                aggregateType: "Collection",
                aggregateId: input.collectionId,
                payload: { collectionId: input.collectionId, name, description },
            });
        });
        const summary = await this.loadCollectionSummary(input.collectionId);
        if (!summary) {
            throw new CollectionNotFoundError(input.collectionId);
        }
        return summary;
    }

    async deleteCollection(collectionId: string): Promise<void> {
        const collection = await this.prisma.collection.findUnique({
            where: { id: collectionId },
            select: { id: true },
        });
        if (!collection) {
            throw new CollectionNotFoundError(collectionId);
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.collection.delete({ where: { id: collectionId } });
            await appendDomainEvent(tx, {
                type: "collection.deleted.v1",
                aggregateType: "Collection",
                aggregateId: collectionId,
                payload: { collectionId },
            });
        });
    }

    async listCollections(input: { storyId?: string } = {}): Promise<CollectionList> {
        let memberCollectionIds: Set<string> | null = null;
        if (input.storyId) {
            const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
            if (!canonicalStoryId) {
                throw new StoryNotFoundError(input.storyId);
            }
            const memberships = await this.prisma.collectionItem.findMany({
                where: { storyId: canonicalStoryId },
                select: { collectionId: true },
            });
            memberCollectionIds = new Set(memberships.map((membership) => membership.collectionId));
        }
        const rows = await this.prisma.collection.findMany({
            orderBy: { createdAt: "asc" },
            include: {
                _count: { select: { items: true } },
            },
        });
        return {
            items: rows.map((collection) => ({
                id: collection.id,
                name: collection.name,
                description: collection.description,
                itemCount: collection._count.items,
                ...(memberCollectionIds === null
                    ? {}
                    : { containsStory: memberCollectionIds.has(collection.id) }),
                createdAt: collection.createdAt.toISOString(),
                updatedAt: collection.updatedAt.toISOString(),
            })),
        };
    }

    async addCollectionItem(input: {
        collectionId: string;
        storyId: string;
    }): Promise<void> {
        const collection = await this.prisma.collection.findUnique({
            where: { id: input.collectionId },
            select: { id: true },
        });
        if (!collection) {
            throw new CollectionNotFoundError(input.collectionId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.collectionItem.findUnique({
                where: {
                    collectionId_storyId: {
                        collectionId: input.collectionId,
                        storyId: canonicalStoryId,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            await tx.collectionItem.create({
                data: {
                    collectionId: input.collectionId,
                    storyId: canonicalStoryId,
                },
            });
            await appendDomainEvent(tx, {
                type: "collection.item_added.v1",
                aggregateType: "Collection",
                aggregateId: input.collectionId,
                payload: {
                    collectionId: input.collectionId,
                    storyId: canonicalStoryId,
                },
            });
        });
    }

    async removeCollectionItem(input: {
        collectionId: string;
        storyId: string;
    }): Promise<void> {
        const collection = await this.prisma.collection.findUnique({
            where: { id: input.collectionId },
            select: { id: true },
        });
        if (!collection) {
            throw new CollectionNotFoundError(input.collectionId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.collectionItem.findUnique({
                where: {
                    collectionId_storyId: {
                        collectionId: input.collectionId,
                        storyId: canonicalStoryId,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.collectionItem.delete({ where: { id: existing.id } });
            await appendDomainEvent(tx, {
                type: "collection.item_removed.v1",
                aggregateType: "Collection",
                aggregateId: input.collectionId,
                payload: {
                    collectionId: input.collectionId,
                    storyId: canonicalStoryId,
                },
            });
        });
    }

    async setFavorite(input: {
        targetType: FavoriteTargetType;
        targetId: string;
    }): Promise<void> {
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.favorite.findUnique({
                where: {
                    targetType_targetId: {
                        targetType: input.targetType,
                        targetId,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            await tx.favorite.create({
                data: {
                    targetType: input.targetType,
                    targetId,
                },
            });
            await appendDomainEvent(tx, {
                type: "favorite.set.v1",
                aggregateType: input.targetType === "entry" ? "Entry" : "Story",
                aggregateId: targetId,
                payload: {
                    targetType: input.targetType,
                    targetId,
                },
            });
        });
    }

    async unsetFavorite(input: {
        targetType: FavoriteTargetType;
        targetId: string;
    }): Promise<void> {
        const targetId = await this.resolveTargetTargetId(input.targetType, input.targetId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.favorite.findUnique({
                where: {
                    targetType_targetId: {
                        targetType: input.targetType,
                        targetId,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.favorite.delete({ where: { id: existing.id } });
            await appendDomainEvent(tx, {
                type: "favorite.unset.v1",
                aggregateType: input.targetType === "entry" ? "Entry" : "Story",
                aggregateId: targetId,
                payload: {
                    targetType: input.targetType,
                    targetId,
                },
            });
        });
    }

    async listFavorites(): Promise<FavoriteList> {
        const rows = await this.prisma.favorite.findMany({
            orderBy: { createdAt: "desc" },
        });
        return {
            items: rows.map((favorite) => ({
                targetType: favorite.targetType as "story" | "entry",
                targetId: favorite.targetId,
                createdAt: favorite.createdAt.toISOString(),
            })),
        };
    }

}
