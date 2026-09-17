import { type EntryDetail } from "@cosmos/contracts";
import {
    isSymmetricEntryRelationType,
    normalizeEntryRelationEndpoints,
    type EntryRelationType,
} from "@cosmos/domain";
import { EntryNotFoundError, EntryRelationConflictError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryEntityLinks } from "./entity-links.js";

/**
 * Cross-source duplicate/syndication relations between two Entries (ADR-0022).
 * They hang on the Entry content identity, not on Story membership, so
 * `mergeStories`/`splitStory` never touch this table.
 */
export class PrismaCosmosRepositoryEntryRelations extends PrismaCosmosRepositoryEntityLinks {
    async linkEntryRelation(input: {
        fromEntryId: string;
        toEntryId: string;
        relationType: EntryRelationType;
        producer?: string | null;
        producerVersion?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntryDetail | null> {
        if (input.fromEntryId === input.toEntryId) {
            throw new EntryRelationConflictError(
                `An Entry cannot be related to itself: ${input.fromEntryId}`,
            );
        }
        await this.requireEntries(input.fromEntryId, input.toEntryId);
        const endpoints = normalizeEntryRelationEndpoints(input);
        const producer = input.producer?.trim() || "human";
        const actorJson = input.actor == null ? null : JSON.stringify(input.actor);
        await this.prisma.$transaction(async (tx) => {
            // One unordered pair keeps exactly one current meaning, so the
            // lookup must not assume the stored direction: a symmetric write
            // normalizes onto the existing row, a directed one may contradict it
            // (ADR-0022 decision 2/3).
            const existing = await tx.entryRelation.findFirst({
                where: {
                    OR: [
                        { fromEntryId: input.fromEntryId, toEntryId: input.toEntryId },
                        { fromEntryId: input.toEntryId, toEntryId: input.fromEntryId },
                    ],
                },
            });
            if (existing) {
                const reverses = existing.fromEntryId !== endpoints.fromEntryId
                    || existing.toEntryId !== endpoints.toEntryId;
                if (reverses
                    && !isSymmetricEntryRelationType(existing.relationType)
                    && !isSymmetricEntryRelationType(input.relationType)) {
                    throw new EntryRelationConflictError(
                        `Entry ${input.fromEntryId} and ${input.toEntryId} already have the opposite `
                        + `direction stored ("${existing.relationType}"); remove it first.`,
                    );
                }
                const unchanged = !reverses
                    && existing.relationType === input.relationType
                    && existing.producer === producer
                    && existing.producerVersion === (input.producerVersion ?? null)
                    && existing.confidence === (input.confidence ?? 1)
                    && existing.evidence === (input.evidence ?? null)
                    && existing.actorJson === actorJson
                    && existing.reason === (input.reason ?? null);
                if (unchanged) {
                    return;
                }
                await tx.entryRelation.update({
                    where: { id: existing.id },
                    data: {
                        fromEntryId: endpoints.fromEntryId,
                        toEntryId: endpoints.toEntryId,
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
                await tx.entryRelation.create({
                    data: {
                        fromEntryId: endpoints.fromEntryId,
                        toEntryId: endpoints.toEntryId,
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
                type: "entry.relation_linked.v1",
                aggregateType: "Entry",
                aggregateId: input.fromEntryId,
                payload: {
                    fromEntryId: endpoints.fromEntryId,
                    toEntryId: endpoints.toEntryId,
                    relationType: input.relationType,
                    producer,
                    confidence: input.confidence ?? 1,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.entry(input.fromEntryId);
    }

    async unlinkEntryRelation(input: {
        fromEntryId: string;
        toEntryId: string;
        actor?: string | null;
        reason?: string | null;
    }): Promise<EntryDetail | null> {
        if (input.fromEntryId === input.toEntryId) {
            throw new EntryRelationConflictError(
                `An Entry cannot be related to itself: ${input.fromEntryId}`,
            );
        }
        await this.requireEntries(input.fromEntryId, input.toEntryId);
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.entryRelation.findFirst({
                where: {
                    OR: [
                        { fromEntryId: input.fromEntryId, toEntryId: input.toEntryId },
                        { fromEntryId: input.toEntryId, toEntryId: input.fromEntryId },
                    ],
                },
            });
            if (!existing) {
                return;
            }
            await tx.entryRelation.delete({ where: { id: existing.id } });
            await appendDomainEvent(tx, {
                type: "entry.relation_unlinked.v1",
                aggregateType: "Entry",
                aggregateId: input.fromEntryId,
                payload: {
                    fromEntryId: existing.fromEntryId,
                    toEntryId: existing.toEntryId,
                    relationType: existing.relationType,
                    actor: input.actor ?? null,
                    reason: input.reason ?? null,
                },
            });
        });
        return this.entry(input.fromEntryId);
    }

    /** Both endpoints must exist; the missing one is reported by id. */
    private async requireEntries(...entryIds: readonly string[]): Promise<void> {
        const found = await this.prisma.entry.findMany({
            where: { id: { in: [...entryIds] } },
            select: { id: true },
        });
        if (found.length === entryIds.length) {
            return;
        }
        const known = new Set(found.map((entry) => entry.id));
        throw new EntryNotFoundError(entryIds.find((id) => !known.has(id))!);
    }
}
