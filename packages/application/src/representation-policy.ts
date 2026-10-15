import type { ContentRepresentation } from "@cosmos/domain";

type RepresentationCandidate = Pick<ContentRepresentation, "id" | "entryRevisionId" | "status">;

export interface RepresentationSelection {
    current: RepresentationCandidate | null;
    candidate: RepresentationCandidate;
    locked: boolean;
    systemRecommended: boolean;
}

const statusRank = { failed: 0, partial: 1, complete: 2 } as const;

/** Equal-status promotion needs an explicit recommendation; version order alone is not quality. */
export function shouldPromoteRepresentation(input: RepresentationSelection): boolean {
    if (input.current && input.current.entryRevisionId !== input.candidate.entryRevisionId) {
        throw new Error("Content representation belongs to another source revision");
    }
    if (input.locked || input.current?.id === input.candidate.id) return false;
    if (!input.current) return true;
    const difference = statusRank[input.candidate.status] - statusRank[input.current.status];
    return difference > 0 || (difference === 0 && input.systemRecommended);
}

export function validateRepresentationRollback(
    entryRevisionId: string,
    candidate: RepresentationCandidate,
): void {
    if (candidate.entryRevisionId !== entryRevisionId) {
        throw new Error("Content representation belongs to another source revision");
    }
    if (candidate.status === "failed") {
        throw new Error("Cannot roll back to an unusable content representation");
    }
}
