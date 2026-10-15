import { validateRepresentationRollback } from "./representation-policy.js";

export interface ContentSelectionState {
    entryRevisionId: string;
    currentRepresentationId: string | null;
    locked: boolean;
    target: { id: string; entryRevisionId: string; status: "complete" | "partial" | "failed" } | null;
}

export interface ContentSelectionCommand {
    entryRevisionId: string;
    expectedCurrentId: string | null;
    expectedLocked: boolean;
    operation: "lock" | "unlock" | "rollback";
    representationId?: string;
}

export interface ContentCommandAuthority {
    actorId: string;
    canManageRepresentations: boolean;
}

export class ContentCommandError extends Error {
    constructor(readonly code: "access_denied" | "not_found" | "conflict" | "invalid_command", message: string) {
        super(message);
    }
}

export interface ContentSelectionRepository {
    readSelection(command: ContentSelectionCommand): Promise<ContentSelectionState | null>;
    commitSelection(input: {
        command: ContentSelectionCommand;
        actorId: string;
        currentRepresentationId: string | null;
        locked: boolean;
    }): Promise<{ currentRepresentationId: string | null; locked: boolean; changed: boolean }>;
}

/** The host grants management authority; request bodies cannot supply an actor or permission. */
export class ContentCommands {
    constructor(private readonly repository: ContentSelectionRepository) {}

    async select(command: ContentSelectionCommand, authority: ContentCommandAuthority) {
        if (!authority.canManageRepresentations || !authority.actorId.trim()) {
            throw new ContentCommandError("access_denied", "Content representation management denied");
        }
        if (!command.entryRevisionId || !["lock", "unlock", "rollback"].includes(command.operation)
            || typeof command.expectedLocked !== "boolean"
            || (command.expectedCurrentId !== null && (typeof command.expectedCurrentId !== "string" || !command.expectedCurrentId))
            || (command.operation === "rollback" ? !command.representationId : command.representationId !== undefined)) {
            throw new ContentCommandError("invalid_command", "Invalid content selection command");
        }
        const state = await this.repository.readSelection(command);
        if (!state) throw new ContentCommandError("not_found", "Content source revision not found");
        if (state.entryRevisionId !== command.entryRevisionId) {
            throw new ContentCommandError("conflict", "Content source revision mismatch");
        }
        if (state.currentRepresentationId !== command.expectedCurrentId || state.locked !== command.expectedLocked) {
            throw new ContentCommandError("conflict", "Content representation selection conflict");
        }
        let currentRepresentationId = state.currentRepresentationId;
        let locked = command.operation === "lock";
        if (command.operation === "rollback") {
            if (!state.target || state.target.id !== command.representationId) {
                throw new ContentCommandError("not_found", "Content representation not found");
            }
            try { validateRepresentationRollback(command.entryRevisionId, state.target); }
            catch (error) {
                throw new ContentCommandError("conflict", error instanceof Error ? error.message : "Invalid rollback target");
            }
            currentRepresentationId = state.target.id;
            locked = true;
        }
        return this.repository.commitSelection({ command, actorId: authority.actorId, currentRepresentationId, locked });
    }
}
