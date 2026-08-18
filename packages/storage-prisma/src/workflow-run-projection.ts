export function workflowRunError(stateJson: string): string | null {
    try {
        const state: unknown = JSON.parse(stateJson);
        if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
        const error = (state as { error?: unknown }).error;
        return typeof error === "string" ? error : null;
    } catch {
        return null;
    }
}
