import { type EntryDetail } from "@cosmos/contracts";
import { type EntryRelationType } from "@cosmos/domain";
import { EntryNotFoundError, EntryRelationConflictError } from "@cosmos/application";
import { appendDomainEvent } from "./repository-internals.js";
import { PrismaCosmosRepositoryEntityLinks } from "./entity-links.js";
import { writeEntryRelation } from "./entry-relation-command.js";

/** Entry identity relations remain independent of Story membership (ADR-0022). */
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
        await this.prisma.$transaction((tx) => writeEntryRelation(tx, input));
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
