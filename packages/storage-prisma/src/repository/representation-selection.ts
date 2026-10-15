import { shouldPromoteRepresentation, validateRepresentationRollback } from "@cosmos/application";
import type { ContentRepresentation } from "@cosmos/domain";
import type { Prisma } from "@prisma/client";
import { appendDomainEvent } from "./repository-internals.js";

type Candidate = Pick<ContentRepresentation, "id" | "entryRevisionId" | "status">;

function candidate(row: { id: string; entryRevisionId: string; status: string }): Candidate {
    if (row.status !== "complete" && row.status !== "partial" && row.status !== "failed") {
        throw new Error("Invalid persisted content representation status");
    }
    return { id: row.id, entryRevisionId: row.entryRevisionId, status: row.status };
}

/** Call inside the same transaction as version creation; stale selections must roll back. */
export async function selectContentRepresentation(
    tx: Prisma.TransactionClient,
    input: {
        entryRevisionId: string;
        representationId: string;
        expectedCurrentId: string | null;
        mode: "automatic" | "rollback";
        systemRecommended: boolean;
        actorId: string;
    },
): Promise<boolean> {
    const revision = await tx.entryRevision.findUniqueOrThrow({
        where: { id: input.entryRevisionId },
        include: { currentRepresentation: true },
    });
    if (revision.currentRepresentationId !== input.expectedCurrentId) {
        throw new Error("Content representation selection conflict");
    }
    const target = candidate(await tx.contentRepresentation.findUniqueOrThrow({
        where: { id: input.representationId },
    }));
    if (target.entryRevisionId !== revision.id) {
        throw new Error("Content representation belongs to another source revision");
    }
    if (input.mode === "rollback") {
        validateRepresentationRollback(revision.id, target);
    } else if (!shouldPromoteRepresentation({
        current: revision.currentRepresentation ? candidate(revision.currentRepresentation) : null,
        candidate: target,
        locked: revision.representationLocked,
        systemRecommended: input.systemRecommended,
    })) {
        return false;
    }
    if (target.id === revision.currentRepresentationId) return false;
    const updated = await tx.entryRevision.updateMany({
        where: {
            id: revision.id,
            currentRepresentationId: input.expectedCurrentId,
            representationLocked: revision.representationLocked,
        },
        data: {
            currentRepresentationId: target.id,
            representationLocked: input.mode === "rollback" ? true : revision.representationLocked,
        },
    });
    if (updated.count !== 1) throw new Error("Content representation selection conflict");
    await appendDomainEvent(tx, {
        type: "content.representation.selected",
        aggregateType: "EntryRevision",
        aggregateId: revision.id,
        payload: {
            actorId: input.actorId,
            mode: input.mode,
            previousRepresentationId: input.expectedCurrentId,
            representationId: target.id,
        },
    });
    return true;
}
