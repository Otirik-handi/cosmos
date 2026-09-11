import { type EntityDetail, type EntityPage } from "@cosmos/contracts";
import { entityTypes, fingerprintEntityRevision, type EntityType } from "@cosmos/domain";
import { EntityNotFoundError, EntityRevisionConflictError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryTopics } from "./topics.js";

export class PrismaCosmosRepositoryEntities extends PrismaCosmosRepositoryTopics {
    async createEntity(input: {
        name: string;
        type: EntityType;
        alias?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        if (!(entityTypes as readonly string[]).includes(input.type)) {
            throw new EntityRevisionConflictError(`Unknown entity type: ${input.type}`);
        }
        const aliasName = input.alias?.trim() || null;
        const fingerprint = fingerprintEntityRevision({
            name: input.name,
            type: input.type,
        });
        const entityId = await this.prisma.$transaction(async (tx) => {
            const entity = await tx.entity.create({ data: { type: input.type } });
            const revision = await tx.entityRevision.create({
                data: {
                    entityId: entity.id,
                    revision: 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    name: input.name,
                    type: input.type,
                },
            });
            await tx.entity.update({
                where: { id: entity.id },
                data: { currentRevisionId: revision.id },
            });
            if (aliasName) {
                await tx.entityAlias.create({
                    data: { entityId: entity.id, name: aliasName },
                });
            }
            await appendDomainEvent(tx, {
                type: "entity.created.v1",
                aggregateType: "Entity",
                aggregateId: entity.id,
                payload: {
                    entityId: entity.id,
                    name: input.name,
                    type: input.type,
                    alias: aliasName,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
            return entity.id;
        });
        return this.toEntityDetail(entityId);
    }

    async updateEntity(input: {
        entityId: string;
        baseRevisionId: string;
        name: string;
        type: EntityType;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            include: { currentRevision: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        if (!entity.currentRevision || entity.currentRevision.id !== input.baseRevisionId) {
            throw new EntityRevisionConflictError(input.entityId);
        }
        const fingerprint = fingerprintEntityRevision({
            name: input.name,
            type: input.type,
        });
        if (entity.currentRevision.fingerprint === fingerprint) {
            return this.toEntityDetail(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const latest = await tx.entityRevision.findFirst({
                where: { entityId: input.entityId },
                orderBy: { revision: "desc" },
                select: { revision: true },
            });
            const created = await tx.entityRevision.create({
                data: {
                    entityId: input.entityId,
                    revision: (latest?.revision ?? 0) + 1,
                    fingerprint,
                    actorJson: input.actor == null ? null : JSON.stringify(input.actor),
                    reason: input.reason ?? null,
                    name: input.name,
                    type: input.type,
                },
            });
            await tx.entity.update({
                where: { id: input.entityId },
                data: { currentRevisionId: created.id },
            });
            await appendDomainEvent(tx, {
                type: "entity.revision_created.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    baseRevisionId: input.baseRevisionId,
                    revision: created.revision,
                    name: input.name,
                    type: input.type,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async addEntityAlias(input: {
        entityId: string;
        name: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entityAlias.findUnique({
                where: { entityId_name: { entityId: input.entityId, name: input.name } },
                select: { id: true },
            });
            if (existing) {
                return;
            }
            await tx.entityAlias.create({
                data: { entityId: input.entityId, name: input.name },
            });
            await appendDomainEvent(tx, {
                type: "entity.alias_added.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    name: input.name,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async removeEntityAlias(input: {
        entityId: string;
        name: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntityDetail | null> {
        const entity = await this.prisma.entity.findUnique({
            where: { id: input.entityId },
            select: { id: true },
        });
        if (!entity) {
            throw new EntityNotFoundError(input.entityId);
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entityAlias.findUnique({
                where: { entityId_name: { entityId: input.entityId, name: input.name } },
                select: { id: true },
            });
            if (!existing) {
                return;
            }
            await tx.entityAlias.delete({
                where: { id: existing.id },
            });
            await appendDomainEvent(tx, {
                type: "entity.alias_removed.v1",
                aggregateType: "Entity",
                aggregateId: input.entityId,
                payload: {
                    entityId: input.entityId,
                    name: input.name,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.toEntityDetail(input.entityId);
    }

    async listEntities(input: {
        cursor?: string;
        limit: number;
    }): Promise<EntityPage> {
        const parsed = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
        const offset = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        const entities = await this.prisma.entity.findMany({
            orderBy: { updatedAt: "desc" },
            skip: offset,
            take: input.limit + 1,
            include: {
                currentRevision: true,
                storyLinks: { select: { id: true } },
                fromRelations: { select: { id: true } },
                toRelations: { select: { id: true } },
            },
        });
        const hasNext = entities.length > input.limit;
        const page = hasNext ? entities.slice(0, input.limit) : entities;
        const items: EntityPage["items"] = page.map((entity) => ({
            id: entity.id,
            revisionId: entity.currentRevision?.id ?? "",
            type: entity.currentRevision?.type ?? "",
            name: entity.currentRevision?.name ?? "",
            storyCount: entity.storyLinks.length,
            relationCount: entity.fromRelations.length + entity.toRelations.length,
            updatedAt: entity.updatedAt.toISOString(),
        }));
        return {
            items,
            nextCursor: hasNext ? String(offset + input.limit) : null,
        };
    }

}
