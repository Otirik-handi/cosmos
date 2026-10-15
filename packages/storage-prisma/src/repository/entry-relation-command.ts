import type { Prisma } from "@prisma/client";
import { EntryNotFoundError, EntryRelationConflictError } from "@cosmos/application";
import { isSymmetricEntryRelationType, normalizeEntryRelationEndpoints, type EntryRelationType } from "@cosmos/domain";
import { appendDomainEvent } from "./repository-internals.js";

export interface EntryRelationCommand {
    fromEntryId: string;
    toEntryId: string;
    relationType: EntryRelationType;
    producer?: string | null;
    producerVersion?: string | null;
    confidence?: number | null;
    evidence?: string | null;
    actor?: string | null;
    reason?: string | null;
}

export async function writeEntryRelation(tx: Prisma.TransactionClient, input: EntryRelationCommand): Promise<void> {
    if (input.fromEntryId === input.toEntryId) {
        throw new EntryRelationConflictError(`An Entry cannot be related to itself: ${input.fromEntryId}`);
    }
    const entries = await tx.entry.findMany({
        where: { id: { in: [input.fromEntryId, input.toEntryId] } }, select: { id: true },
    });
    const known = new Set(entries.map((entry) => entry.id));
    for (const id of [input.fromEntryId, input.toEntryId]) {
        if (!known.has(id)) throw new EntryNotFoundError(id);
    }
    const endpoints = normalizeEntryRelationEndpoints(input);
    const producer = input.producer?.trim() || "human";
    const actorJson = input.actor == null ? null : JSON.stringify(input.actor);
    // ADR-0022 allows one meaning per unordered pair, including directed relations.
    const existing = await tx.entryRelation.findFirst({
        where: { OR: [
            { fromEntryId: input.fromEntryId, toEntryId: input.toEntryId },
            { fromEntryId: input.toEntryId, toEntryId: input.fromEntryId },
        ] },
    });
    const reverses = existing != null && (existing.fromEntryId !== endpoints.fromEntryId
        || existing.toEntryId !== endpoints.toEntryId);
    if (existing && reverses && !isSymmetricEntryRelationType(existing.relationType)
        && !isSymmetricEntryRelationType(input.relationType)) {
        throw new EntryRelationConflictError(
            `Entry ${input.fromEntryId} and ${input.toEntryId} already have the opposite `
            + `direction stored ("${existing.relationType}"); remove it first.`,
        );
    }
    const data = {
        fromEntryId: endpoints.fromEntryId, toEntryId: endpoints.toEntryId,
        relationType: input.relationType, producer, producerVersion: input.producerVersion ?? null,
        confidence: input.confidence ?? 1, evidence: input.evidence ?? null,
        actorJson, reason: input.reason ?? null,
    };
    if (existing && !reverses && existing.relationType === data.relationType
        && existing.producer === data.producer && existing.producerVersion === data.producerVersion
        && existing.confidence === data.confidence && existing.evidence === data.evidence
        && existing.actorJson === data.actorJson && existing.reason === data.reason) return;
    if (existing) {
        await tx.entryRelation.update({ where: { id: existing.id }, data });
    } else {
        await tx.entryRelation.create({ data });
    }
    await appendDomainEvent(tx, {
        type: "entry.relation_linked.v1", aggregateType: "Entry", aggregateId: input.fromEntryId,
        payload: { fromEntryId: endpoints.fromEntryId, toEntryId: endpoints.toEntryId,
            relationType: input.relationType, producer, confidence: data.confidence,
            actor: input.actor ?? null, reason: input.reason ?? null },
    });
}
