import { type StoryDetail, type EntityDetail } from "@cosmos/contracts";
import { entityRelationTypes, type EntityRelationType, type EntryStoryRelationType } from "@cosmos/domain";
import { EntityNotFoundError, EntityRelationConflictError, EntryNotFoundError, EntryStoryLinkConflictError, StoryNotFoundError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryEntities } from "./entities.js";

export class PrismaCosmosRepositoryEntityLinks extends PrismaCosmosRepositoryEntities {
    async linkStoryEntity(input: {
        storyId: string;
        entityId: string;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.storyEntity.findUnique({
                where: {
                    storyId_entityId: {
                        storyId: canonicalStoryId,
                        entityId: input.entityId,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            const producer = input.producer?.trim() || "human";
            await tx.storyEntity.create({
                data: {
                    storyId: canonicalStoryId,
                    entityId: input.entityId,
                    producer,
                    producerVersion: input.producerVersion ?? null,
                    confidence: input.confidence ?? 1,
                    evidence: input.evidence ?? null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                },
            });
            await appendDomainEvent(tx, {
                type: "entity.story_linked.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    storyId: canonicalStoryId,
                    producer,
                    confidence: input.confidence ?? 1,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async unlinkStoryEntity(input: {
        storyId: string;
        entityId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.storyEntity.findUnique({
                where: {
                    storyId_entityId: {
                        storyId: canonicalStoryId,
                        entityId: input.entityId,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.storyEntity.delete({
                where: { id: existing.id },
            });
            await appendDomainEvent(tx, {
                type: "entity.story_unlinked.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    storyId: canonicalStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async linkEntryStory(input: {
        entryId: string;
        storyId: string;
        relationType: EntryStoryRelationType;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const entry = await this.prisma.entry.findUnique({
            where: { id: input.entryId },
            select: { id: true, storyId: true },
        });
        if (!entry) {
            throw new EntryNotFoundError(input.entryId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        const primaryStoryId = entry.storyId == null
            ? null
            : await this.resolveCanonicalStoryId(entry.storyId);
        if (primaryStoryId === canonicalStoryId) {
            throw new EntryStoryLinkConflictError(input.entryId, canonicalStoryId);
        }
        const producer = input.producer?.trim() || "human";
        const actorJson = input.actor == null ? null : JSON.stringify(input.actor);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entryStoryLink.findUnique({
                where: {
                    entryId_storyId: {
                        entryId: input.entryId,
                        storyId: canonicalStoryId,
                    },
                },
            });
            // One pair keeps exactly one meaning: re-linking overwrites the
            // relation type and provenance, and an identical replay is a no-op
            // (ADR-0011 decision 1).
            if (existing) {
                const unchanged = existing.relationType === input.relationType
                    && existing.producer === producer
                    && existing.producerVersion === (input.producerVersion ?? null)
                    && existing.confidence === (input.confidence ?? 1)
                    && existing.evidence === (input.evidence ?? null)
                    && existing.actorJson === actorJson
                    && existing.reason === (input.reason ?? null);
                if (unchanged) {
                    return;
                }
                await tx.entryStoryLink.update({
                    where: { id: existing.id },
                    data: {
                        relationType: input.relationType,
                        producer,
                        producerVersion: input.producerVersion ?? null,
                        confidence: input.confidence ?? 1,
                        evidence: input.evidence ?? null,
                        actorJson,
                        reason: input.reason ?? null,
                    },
                });
            } else {
                await tx.entryStoryLink.create({
                    data: {
                        entryId: input.entryId,
                        storyId: canonicalStoryId,
                        relationType: input.relationType,
                        producer,
                        producerVersion: input.producerVersion ?? null,
                        confidence: input.confidence ?? 1,
                        evidence: input.evidence ?? null,
                        actorJson,
                        reason: input.reason ?? null,
                    },
                });
            }
            await appendDomainEvent(tx, {
                type: "entry.story_linked.v1",
                aggregateType: "Entry",
                aggregateId: input.entryId,
                payload: {
                    entryId: input.entryId,
                    storyId: canonicalStoryId,
                    relationType: input.relationType,
                    producer,
                    confidence: input.confidence ?? 1,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.story(canonicalStoryId);
    }

    async unlinkEntryStory(input: {
        entryId: string;
        storyId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<StoryDetail | null> {
        const entry = await this.prisma.entry.findUnique({
            where: { id: input.entryId },
            select: { id: true },
        });
        if (!entry) {
            throw new EntryNotFoundError(input.entryId);
        }
        const canonicalStoryId = await this.resolveCanonicalStoryId(input.storyId);
        if (!canonicalStoryId) {
            throw new StoryNotFoundError(input.storyId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entryStoryLink.findUnique({
                where: {
                    entryId_storyId: {
                        entryId: input.entryId,
                        storyId: canonicalStoryId,
                    },
                },
            });
            if (!existing) {
                return;
            }
            await tx.entryStoryLink.delete({ where: { id: existing.id } });
            await appendDomainEvent(tx, {
                type: "entry.story_unlinked.v1",
                aggregateType: "Entry",
                aggregateId: input.entryId,
                payload: {
                    entryId: input.entryId,
                    storyId: canonicalStoryId,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.story(canonicalStoryId);
    }

    async createEntityRelation(input: {
        fromEntityId: string;
        toEntityId: string;
        relationType: EntityRelationType;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        if (!(entityRelationTypes as readonly string[]).includes(input.relationType)) {
            throw new EntityRelationConflictError(`Unknown relation type: ${input.relationType}`);
        }
        if (input.fromEntityId === input.toEntityId) {
            throw new EntityRelationConflictError(
                `Entity relation must be between distinct entities: ${input.fromEntityId}`,
            );
        }
        const entities = await this.prisma.entity.findMany({
            where: { id: { in: [input.fromEntityId, input.toEntityId] } },
            select: { id: true },
        });
        if (entities.length !== 2) {
            const found = new Set(entities.map((entity) => entity.id));
            const missing = [input.fromEntityId, input.toEntityId]
                .find((id) => !found.has(id))!;
            throw new EntityNotFoundError(missing);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entityRelation.findUnique({
                where: {
                    fromEntityId_toEntityId_relationType: {
                        fromEntityId: input.fromEntityId,
                        toEntityId: input.toEntityId,
                        relationType: input.relationType,
                    },
                },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            const producer = input.producer?.trim() || "human";
            await tx.entityRelation.create({
                data: {
                    fromEntityId: input.fromEntityId,
                    toEntityId: input.toEntityId,
                    relationType: input.relationType,
                    producer,
                    producerVersion: input.producerVersion ?? null,
                    confidence: input.confidence ?? 1,
                    evidence: input.evidence ?? null,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                },
            });
            await appendDomainEvent(tx, {
                type: "entity.relation_created.v1",
                aggregateType: "Entity",
                aggregateId: input.fromEntityId,
                payload: {
                    fromEntityId: input.fromEntityId,
                    toEntityId: input.toEntityId,
                    relationType: input.relationType,
                    producer,
                    confidence: input.confidence ?? 1,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.fromEntityId);
    }

    async removeEntityRelation(input: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.fromEntityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.fromEntityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entityRelation.findUnique({
                where: {
                    fromEntityId_toEntityId_relationType: {
                        fromEntityId: input.fromEntityId,
                        toEntityId: input.toEntityId,
                        relationType: input.relationType,
                    },
                },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.entityRelation.delete({
                where: { id: existing.id },
            });
            await appendDomainEvent(tx, {
                type: "entity.relation_removed.v1",
                aggregateType: "Entity",
                aggregateId: input.fromEntityId,
                payload: {
                    fromEntityId: input.fromEntityId,
                    toEntityId: input.toEntityId,
                    relationType: input.relationType,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.fromEntityId);
    }

}
