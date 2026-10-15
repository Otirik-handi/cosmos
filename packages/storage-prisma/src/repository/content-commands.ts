import { ContentCommandError, type ContentSelectionCommand, type ContentSelectionRepository, type ContentSelectionState } from "@cosmos/application";
import type { PrismaClient } from "@prisma/client";
import { appendDomainEvent } from "./repository-internals.js";

export class PrismaContentSelectionRepository implements ContentSelectionRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async readSelection(command: ContentSelectionCommand): Promise<ContentSelectionState | null> {
        return this.prisma.$transaction(async (tx) => {
            const revision = await tx.entryRevision.findUnique({ where: { id: command.entryRevisionId } });
            if (!revision) return null;
            const target = command.representationId === undefined ? null : await tx.contentRepresentation.findUnique({
                where: { id: command.representationId },
            });
            if (target && target.status !== "complete" && target.status !== "partial" && target.status !== "failed") {
                throw new ContentCommandError("conflict", "Invalid persisted content representation status");
            }
            return {
                entryRevisionId: revision.id,
                currentRepresentationId: revision.currentRepresentationId,
                locked: revision.representationLocked,
                target: target ? {
                    id: target.id, entryRevisionId: target.entryRevisionId,
                    status: target.status as "complete" | "partial" | "failed",
                } : null,
            };
        });
    }

    async commitSelection(input: Parameters<ContentSelectionRepository["commitSelection"]>[0]) {
        return this.prisma.$transaction(async (tx) => {
            const { command } = input;
            if (input.currentRepresentationId !== null) {
                const target = await tx.contentRepresentation.findUnique({ where: { id: input.currentRepresentationId } });
                if (!target || target.entryRevisionId !== command.entryRevisionId || (command.operation === "rollback" && target.status === "failed")) {
                    throw new ContentCommandError("conflict", "Invalid content representation selection target");
                }
            }
            const changed = input.currentRepresentationId !== command.expectedCurrentId || input.locked !== command.expectedLocked;
            const updated = await tx.entryRevision.updateMany({
                where: { id: command.entryRevisionId, currentRepresentationId: command.expectedCurrentId, representationLocked: command.expectedLocked },
                data: { currentRepresentationId: input.currentRepresentationId, representationLocked: input.locked },
            });
            if (updated.count !== 1) throw new ContentCommandError("conflict", "Content representation selection conflict");
            if (changed) await appendDomainEvent(tx, {
                type: "content.representation.selected", aggregateType: "EntryRevision", aggregateId: command.entryRevisionId,
                payload: {
                    actorId: input.actorId, mode: command.operation,
                    previousRepresentationId: command.expectedCurrentId, representationId: input.currentRepresentationId,
                    previousLocked: command.expectedLocked, locked: input.locked,
                },
            });
            return { currentRepresentationId: input.currentRepresentationId, locked: input.locked, changed };
        });
    }
}
