import type { ComponentHealth, ComponentStatus, FailureSnapshot, WorkerLaneStatus, WorkerReadinessSnapshot } from "./types.js";

export function defaultComponents(
    checkedAt: string,
    ready: boolean,
): WorkerReadinessSnapshot["components"] {
    const status: ComponentStatus = ready ? "ready" : "unknown";
    const component = (): ComponentHealth => ({ status, checkedAt });
    return {
        migration: component(),
        taskStore: component(),
        definitionCatalog: component(),
        actionRegistry: component(),
        connectorRegistry: component(),
        valueStore: component(),
    };
}

export function sanitizeComponents(
    supplied: Partial<WorkerReadinessSnapshot["components"]>,
): Partial<WorkerReadinessSnapshot["components"]> {
    const safe: Partial<WorkerReadinessSnapshot["components"]> = {};
    if (supplied.migration) safe.migration = sanitizeComponent(supplied.migration);
    if (supplied.taskStore) safe.taskStore = sanitizeComponent(supplied.taskStore);
    if (supplied.gatewaySession) safe.gatewaySession = sanitizeComponent(supplied.gatewaySession);
    if (supplied.definitionCatalog) safe.definitionCatalog = sanitizeComponent(supplied.definitionCatalog);
    if (supplied.actionRegistry) safe.actionRegistry = sanitizeComponent(supplied.actionRegistry);
    if (supplied.connectorRegistry) safe.connectorRegistry = sanitizeComponent(supplied.connectorRegistry);
    if (supplied.valueStore) safe.valueStore = sanitizeComponent(supplied.valueStore);
    return safe;
}

export function sanitizeComponent(component: ComponentHealth): ComponentHealth {
    return {
        status: component.status,
        checkedAt: component.checkedAt,
        ...(component.code === undefined || component.code === null ? {} : { code: publicFailureMessage(new Error(component.code)) }),
        ...(component.message === undefined || component.message === null ? {} : { message: publicFailureMessage(new Error(component.message)) }),
    };
}

export function failureComponent(failure: FailureSnapshot, checkedAt: string): ComponentHealth {
    return {
        status: "unavailable",
        checkedAt,
        code: failure.code,
        message: failure.message,
    };
}

export function publicFailureMessage(error: unknown): string {
    if (!(error instanceof Error)) return "Worker operation failed.";
    return error.message
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
        .replace(/(?:[A-Za-z]:[\\/]|\/)(?:[^\s"'<>]+[\\/])*[^\s"'<>]*/g, "[path]")
        .replace(/(?:token|secret|password)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500) || "Worker operation failed.";
}

export function toFailure(error: unknown, now: Date): FailureSnapshot {
    return failureSnapshot(
        "terminal",
        "worker_error",
        publicFailureMessage(error),
        false,
        now,
    );
}

export function failureSnapshot(
    kind: FailureSnapshot["kind"],
    code: string,
    message: string,
    retryable: boolean,
    now: Date,
): FailureSnapshot {
    return {
        kind,
        code,
        message: message.replace(/\s+/g, " ").trim().slice(0, 500),
        retryable,
        occurredAt: now.toISOString(),
        detailsRef: null,
    };
}

export function metricLabel(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
}
