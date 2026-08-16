import type { ActivityIdentity } from "@notnotype/nb-workflow";
import {
    actionDefinitionSchema,
    actionDescriptorSchema,
    actionErrorCodeSchema,
    actionRefSchema,
    parseActionRef,
    type ActionDefinition,
    type ActionDescriptor,
    type ActionErrorCode,
} from "@cosmos/contracts";

/** The public context available to trusted and remote Action handlers. */
export interface ActionExecutionContext {
    idempotencyKey: string;
    signal: AbortSignal;
}

/**
 * The persistence fence available only to host Action handlers.
 * Lease tokens never belong to a Job payload, Kernel state, manifest or log.
 */
export interface HostActionExecutionFence {
    workflowRunId: string;
    kernelRevision: number;
    activity: ActivityIdentity;
    jobId: string;
    attempt: number;
    jobLeaseToken: string;
    runLeaseToken: string;
}

/** Context passed to a host Action after both SQL fences are acquired. */
export interface HostActionExecutionContext extends ActionExecutionContext {
    fence: HostActionExecutionFence;
}

/** Executable Action implementation; lifecycle and persistence stay in the Host. */
export type ActionHandler = (
    input: unknown,
    context: ActionExecutionContext,
) => Promise<unknown>;

/** Host-only handler implementation; ordinary handlers cannot observe fences. */
export type HostActionHandler = (
    input: unknown,
    context: HostActionExecutionContext,
) => Promise<unknown>;

export interface RegisteredAction {
    definition: ActionDefinition;
    handler: ActionHandler | HostActionHandler;
}

export class ActionExecutionError extends Error {
    constructor(
        readonly code: ActionErrorCode,
        message: string,
        readonly retryable = true,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = "ActionExecutionError";
    }
}

/**
 * Process-local Action registry. It validates refs and schemas and dispatches
 * handlers; Job creation, lease ownership, retry scheduling and persistence
 * belong to the Workflow Host, not this class.
 */
export class ActionRegistry {
    private readonly actions = new Map<string, RegisteredAction>();

    constructor(actions: readonly RegisteredAction[] = []) {
        for (const action of actions) {
            this.register(action.definition, action.handler);
        }
    }

    register(definition: ActionDefinition, handler: HostActionHandler): this;
    register(definition: ActionDefinition, handler: ActionHandler): this;
    register(definition: ActionDefinition, handler: ActionHandler | HostActionHandler): this {
        if (typeof handler !== "function") {
            throw new TypeError("Action handler must be a function.");
        }
        const validatedDefinition = actionDefinitionSchema.parse(definition);
        if (this.actions.has(validatedDefinition.ref)) {
            throw new Error(`Duplicate action ref: ${validatedDefinition.ref}`);
        }
        this.actions.set(validatedDefinition.ref, {
            definition: validatedDefinition,
            handler,
        });
        return this;
    }

    resolve(ref: string): RegisteredAction {
        if (!actionRefSchema.safeParse(ref).success) {
            throw new ActionExecutionError(
                "invalid_action_ref",
                `Invalid action ref: ${ref}`,
                false,
            );
        }
        const action = this.actions.get(ref);
        if (!action) {
            throw new ActionExecutionError(
                "unknown_action",
                `Unknown action ref: ${ref}`,
                false,
            );
        }
        return action;
    }

    /** Validate, invoke and validate a trusted/remote Action. */
    async dispatch(
        ref: string,
        input: unknown,
        context: ActionExecutionContext,
    ): Promise<unknown> {
        const action = this.resolve(ref);
        assertPublicContext(context);
        if (action.definition.executionPlacement === "host") {
            throw new ActionExecutionError(
                "invalid_input",
                `Host action ${ref} requires a host execution fence.`,
                false,
            );
        }
        return this.dispatchResolved(action, ref, input, context);
    }

    /** Validate, invoke and validate a host Action under its SQL fence. */
    async dispatchHost(
        ref: string,
        input: unknown,
        context: ActionExecutionContext,
        fence: HostActionExecutionFence,
    ): Promise<unknown> {
        const action = this.resolve(ref);
        assertPublicContext(context);
        if (action.definition.executionPlacement !== "host") {
            throw new ActionExecutionError(
                "invalid_input",
                `Action ${ref} is not placed on the host.`,
                false,
            );
        }
        assertHostFence(fence, action.definition.ref);
        return this.dispatchResolved(action, ref, input, { ...context, fence });
    }

    descriptors(): readonly ActionDescriptor[] {
        return [...this.actions.values()]
            .sort((left, right) => left.definition.ref.localeCompare(right.definition.ref))
            .map(({ definition }) => {
                const { version } = parseActionRef(definition.ref);
                const descriptor = {
                    ref: definition.ref,
                    version,
                    ...(definition.manifestHash === undefined ? {} : { manifestHash: definition.manifestHash }),
                    kind: definition.kind,
                    description: definition.description,
                    capabilities: [...definition.capabilities],
                    executionPlacement: definition.executionPlacement,
                    idempotent: definition.execution.idempotent,
                    supportsCancellation: definition.execution.supportsCancellation,
                    timeoutMs: definition.execution.timeoutMs,
                    retryPolicy: definition.execution.retryPolicy
                        ? {
                            ...definition.execution.retryPolicy,
                            ...(definition.execution.retryPolicy.retryableErrors
                                ? {
                                    retryableErrors: [
                                        ...definition.execution.retryPolicy.retryableErrors,
                                    ],
                                }
                                : {}),
                        }
                        : null,
                } satisfies ActionDescriptor;
                return actionDescriptorSchema.parse(descriptor);
            });
    }

    private async dispatchResolved(
        action: RegisteredAction,
        ref: string,
        input: unknown,
        context: ActionExecutionContext | HostActionExecutionContext,
    ): Promise<unknown> {
        let parsedInput: unknown;
        try {
            parsedInput = action.definition.inputSchema.parse(input);
        } catch (cause) {
            throw new ActionExecutionError(
                "invalid_input",
                `Invalid input for action ${ref}`,
                false,
                { cause },
            );
        }

        let output: unknown;
        try {
            const handler = action.handler as (
                value: unknown,
                received: ActionExecutionContext | HostActionExecutionContext,
            ) => Promise<unknown>;
            output = await handler(parsedInput, context);
        } catch (error) {
            if (error instanceof ActionExecutionError) {
                throw error;
            }

            const code = readActionErrorCode(error);
            if (code !== null) {
                throw new ActionExecutionError(
                    code,
                    errorMessage(error),
                    readRetryable(error) ?? true,
                    { cause: error },
                );
            }

            throw new ActionExecutionError(
                "internal_error",
                `Action ${ref} failed`,
                false,
                { cause: error },
            );
        }

        try {
            return action.definition.outputSchema.parse(output);
        } catch (cause) {
            throw new ActionExecutionError(
                "malformed_payload",
                `Invalid output for action ${ref}`,
                false,
                { cause },
            );
        }
    }
}

function assertPublicContext(context: unknown): asserts context is ActionExecutionContext {
    if (!isActionExecutionContext(context)) {
        throw new ActionExecutionError(
            "invalid_input",
            "Action execution requires a non-empty idempotency key and AbortSignal.",
            false,
        );
    }
}

function assertHostFence(
    fence: unknown,
    ref: string,
): asserts fence is HostActionExecutionFence {
    if (!isHostActionExecutionFence(fence)) {
        throw new ActionExecutionError(
            "invalid_input",
            `Action ${ref} requires a complete host execution fence.`,
            false,
        );
    }
}

function isActionExecutionContext(
    value: unknown,
): value is ActionExecutionContext {
    if (typeof value !== "object" || value === null) return false;
    if (!("idempotencyKey" in value) || typeof value.idempotencyKey !== "string") return false;
    if (value.idempotencyKey.trim().length === 0) return false;
    if (!("signal" in value)) return false;
    return isAbortSignal(value.signal);
}

function isHostActionExecutionFence(
    value: unknown,
): value is HostActionExecutionFence {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<HostActionExecutionFence>;
    if (typeof candidate.workflowRunId !== "string" || candidate.workflowRunId.trim() === "") return false;
    if (!Number.isSafeInteger(candidate.kernelRevision) || (candidate.kernelRevision ?? 0) < 0) return false;
    if (typeof candidate.jobId !== "string" || candidate.jobId.trim() === "") return false;
    if (!Number.isSafeInteger(candidate.attempt) || (candidate.attempt ?? 0) <= 0) return false;
    if (typeof candidate.jobLeaseToken !== "string" || candidate.jobLeaseToken.trim() === "") return false;
    if (typeof candidate.runLeaseToken !== "string" || candidate.runLeaseToken.trim() === "") return false;
    const activity = candidate.activity;
    return typeof activity === "object"
        && activity !== null
        && typeof activity.key === "string"
        && activity.key.trim().length > 0
        && typeof activity.path === "string"
        && activity.path.trim().length > 0
        && Number.isSafeInteger(activity.seq)
        && activity.seq >= 0
        && typeof activity.kind === "string"
        && activity.kind.trim().length > 0
        && typeof activity.fingerprint === "string"
        && activity.fingerprint.trim().length > 0;
}

function isAbortSignal(value: unknown): value is AbortSignal {
    if (typeof value !== "object" || value === null) return false;
    if (!("aborted" in value) || typeof value.aborted !== "boolean") return false;
    if (!("addEventListener" in value) || typeof value.addEventListener !== "function") return false;
    return "removeEventListener" in value
        && typeof value.removeEventListener === "function";
}

function readActionErrorCode(error: unknown): ActionErrorCode | null {
    if (typeof error !== "object" || error === null || !("code" in error)) return null;
    const parsed = actionErrorCodeSchema.safeParse(error.code);
    return parsed.success ? parsed.data : null;
}

function readRetryable(error: unknown): boolean | null {
    if (typeof error !== "object" || error === null || !("retryable" in error)) return null;
    return typeof error.retryable === "boolean" ? error.retryable : null;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && error !== null && "message" in error) {
        return typeof error.message === "string" ? error.message : String(error);
    }
    return String(error);
}
