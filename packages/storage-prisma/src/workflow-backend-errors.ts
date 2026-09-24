export class WorkflowStateIntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WorkflowStateIntegrityError";
    }
}

export function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
