import type { RetryPolicy } from "@cosmos/contracts";
import { DeferredActivityCompletionConflictError, DeferredActivityLateCompletionError, DeferredActivityNotFoundError, NonJsonValueError, UuidIdGenerator, WorkflowBackendConflictError, WorkflowRunNotFoundError, WorkflowRunner } from "@notnotype/nb-workflow";
import type { JsonValue } from "@notnotype/nb-workflow";
import { ActionExecutionError, ActionRegistry } from "./action.js";
import type { LoggerPort } from "./logger.js";
import { WorkflowHostError } from "./workflow-host.js";
import { errorMessage } from "./workflow-runtime-support.js";
import type { WorkflowRunnerLike } from "./workflow-host-runtime-types.js";

export function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (typeof value !== "object") {
        return false;
    }
    return Object.values(value).every(isJsonValue);
}

export function actionErrorDetails(error: unknown): {
    code: string | null;
    message: string;
    retryable: boolean;
} {
    if (error instanceof ActionExecutionError) {
        return {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
        };
    }
    if (typeof error === "object" && error !== null) {
        const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown };
        return {
            code: typeof candidate.code === "string" ? candidate.code : null,
            message: typeof candidate.message === "string" ? candidate.message : String(error),
            retryable: candidate.retryable === true,
        };
    }
    return { code: null, message: String(error), retryable: false };
}

export function isCancellationError(error: unknown, signal: AbortSignal): boolean {
    if (signal.aborted) return true;
    if (typeof error !== "object" || error === null) return false;
    const candidate = error as { name?: unknown; code?: unknown };
    return candidate.name === "AbortError" || candidate.code === "ABORT_ERR"
        || candidate.code === "cancelled";
}

export function isRetryAllowed(policy: RetryPolicy | undefined, code: string | null): boolean {
    const allowed = policy?.retryableErrors;
    return allowed === undefined || (code !== null && allowed.some((candidate) => candidate === code));
}

export function isKernelTerminalError(error: unknown): boolean {
    if (error instanceof DeferredActivityCompletionConflictError
        || error instanceof DeferredActivityLateCompletionError
        || error instanceof DeferredActivityNotFoundError
        || error instanceof WorkflowRunNotFoundError
        || error instanceof NonJsonValueError) {
        return true;
    }
    if (error instanceof WorkflowBackendConflictError) return false;
    if (error instanceof WorkflowHostError) {
        return error.code === "conflict"
            || error.code === "not_found"
            || error.code === "serialization"
            || error.code === "invalid_state";
    }
    if (error instanceof TypeError || error instanceof SyntaxError) return true;
    if (typeof error === "object" && error !== null) {
        const candidate = error as { name?: unknown; code?: unknown };
        if (candidate.name === "ZodError" || candidate.name === "ValidationError") return true;
        if (typeof candidate.code === "string") {
            return candidate.code === "validation_error"
                || candidate.code === "invalid_input"
                || candidate.code === "invalid_state"
                || candidate.code.startsWith("invalid_");
        }
    }
    return false;
}

export interface HeartbeatHandle {
    readonly lost: Promise<void>;
    readonly wasLost: boolean;
    stop(): Promise<void>;
}

export function createHeartbeat(
    intervalMs: number,
    heartbeat: () => Promise<boolean>,
    onLost: (error?: unknown) => void,
): HeartbeatHandle {
    return createCombinedHeartbeat(intervalMs, [heartbeat], onLost);
}

export function createCombinedHeartbeat(
    intervalMs: number,
    heartbeats: readonly (() => Promise<boolean>)[],
    onLost: (error?: unknown) => void,
): HeartbeatHandle {
    let stopped = false;
    let lost = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const inFlight = new Set<Promise<void>>();
    let lose: (() => void) | undefined;
    const lostPromise = new Promise<void>((resolve) => {
        lose = resolve;
    });

    const beat = (): void => {
        if (stopped || lost) return;
        const pending = Promise.all(heartbeats.map((heartbeat) => heartbeat()))
            .then((results) => {
                if (stopped || lost) return;
                if (results.some((result) => !result)) {
                    lost = true;
                    onLost();
                    lose?.();
                }
            })
            .catch((error: unknown) => {
                if (stopped || lost) return;
                lost = true;
                onLost(error);
                lose?.();
            })
            .finally(() => {
                inFlight.delete(pending);
            });
        inFlight.add(pending);
    };

    if (intervalMs > 0) {
        timer = setInterval(beat, intervalMs);
        const maybeUnref = timer as unknown as { unref?: () => void };
        maybeUnref.unref?.();
    }

    return {
        get wasLost() {
            return lost;
        },
        lost: lostPromise,
        async stop(): Promise<void> {
            stopped = true;
            clearInterval(timer);
            await Promise.allSettled([...inFlight]);
        },
    };
}

export async function raceWithLease<T>(
    execution: Promise<T>,
    leaseLost: Promise<void>,
    error: WorkflowHostError,
    signal?: AbortSignal,
): Promise<T> {
    // A runner may not observe AbortSignal (rerun() in Kernel 0.2.0 has no
    // signal parameter), so the lane must stop waiting as soon as a lease or
    // process shutdown is known stale. A rejection handler prevents a late
    // runner error from becoming an unhandled rejection after the race settles.
    execution.catch(() => undefined);
    const aborted = signal === undefined
        ? new Promise<never>(() => undefined)
        : new Promise<never>((_, reject) => {
            if (signal.aborted) {
                reject(signal.reason ?? new Error("Workflow runtime aborted."));
                return;
            }
            signal.addEventListener("abort", () => {
                reject(signal.reason ?? new Error("Workflow runtime aborted."));
            }, { once: true });
        });
    return Promise.race([
        execution,
        leaseLost.then(() => {
            throw error;
        }),
        aborted,
    ]);
}

export function abortRunner(
    runner: WorkflowRunnerLike | undefined,
    runId: string,
    signal: AbortSignal,
    logger: LoggerPort,
): void {
    if (!runner) return;
    const candidate = runner as unknown as {
        abort?: (runId: string, signal?: AbortSignal) => void | Promise<void>;
        stop?: (runId: string, signal?: AbortSignal) => void | Promise<void>;
        interrupt?: (runId: string, signal?: AbortSignal) => void | Promise<void>;
    };
    const stopper = candidate.abort ?? candidate.stop ?? candidate.interrupt;
    if (!stopper) return;
    Promise.resolve(stopper.call(runner, runId, signal)).catch((error) => {
        logger.warn("workflow_runner_abort_failed", { runId, error: errorMessage(error) });
    });
}
