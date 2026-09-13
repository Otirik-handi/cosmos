import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { z, ZodError } from "zod";
import { WorkflowHostError, ConnectionNotFoundError, type WorkflowEnvelope } from "@cosmos/application";
import { idempotencyKeySchema, type RunStatus, type SourceSnapshot } from "@cosmos/contracts";
import "reflect-metadata";

export const productRunSchema = z.object({
    sourceId: z.string().nullable().optional(),
    triggerKind: z.enum(["manual", "schedule"]).optional(),
    itemCount: z.number().int().nonnegative().optional(),
    createdEntryCount: z.number().int().nonnegative().optional(),
    revisedEntryCount: z.number().int().nonnegative().optional(),
    error: z.string().nullable().optional(),
}).passthrough();

export function validationError(error: unknown): never {
    if (error instanceof ZodError) {
        throw new BadRequestException({
            code: "validation_failed",
            message: "Request validation failed.",
            details: error.flatten(),
            retryable: false,
        });
    }
    throw error;
}

export function requireIdempotencyKey(rawHeader?: string): string {
    const parsed = idempotencyKeySchema.safeParse(rawHeader ?? "");
    if (!parsed.success) {
        throw new BadRequestException({
            code: "validation_failed",
            message: "Idempotency-Key must be 1-300 characters.",
            retryable: false,
        });
    }
    return parsed.data;
}

/**
 * Single error funnel for the Source write endpoints: schema issues become
 * validation failures, storage not-found/conflict codes map to their HTTP
 * contracts. Anything else reaching this funnel is a server-side failure
 * (storage down, migration missing, bug) and must surface as a 500 instead
 * of masquerading as an invalid client request.
 */
export function sourceCommandError(error: unknown): never {
    if (error instanceof ZodError) validationError(error);
    if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
    }
    if (error instanceof Error && "code" in error && error.code === "not_found") {
        throw new NotFoundException({ code: "not_found", message: error.message, retryable: false });
    }
    if (error instanceof Error && "code" in error && error.code === "conflict") {
        throw new ConflictException({ code: "conflict", message: error.message, retryable: false });
    }
    if (error instanceof Error && "code" in error && error.code === "validation") {
        throw new BadRequestException({ code: "validation_failed", message: error.message, retryable: false });
    }
    throw new InternalServerErrorException({
        code: "internal_error",
        message: error instanceof Error ? error.message : "Source command failed.",
        retryable: false,
    });
}

/**
 * Error funnel for the Run control endpoints. `WorkflowHostError` codes map to
 * their HTTP contracts; anything else is a server-side failure and stays a 500.
 */
export function runControlError(error: unknown): never {
    if (error instanceof ZodError) validationError(error);
    if (error instanceof WorkflowHostError) {
        switch (error.code) {
            case "not_found":
                throw new NotFoundException({ code: "not_found", message: error.message, retryable: false });
            case "conflict":
                throw new ConflictException({ code: "conflict", message: error.message, retryable: false });
            case "invalid_state":
                throw new BadRequestException({ code: "invalid_state", message: error.message, retryable: false });
            default:
                throw new InternalServerErrorException({
                    code: "internal_error",
                    message: error.message,
                    retryable: false,
                });
        }
    }
    throw error;
}

/**
 * Error funnel for the Connection endpoints. ConnectionNotFoundError maps to
 * 404; anything else reaching here is a server-side failure and stays a 500.
 */
export function connectionError(error: unknown): never {
    if (error instanceof ZodError) validationError(error);
    if (error instanceof ConnectionNotFoundError) {
        throw new NotFoundException({ code: "not_found", message: error.message, retryable: false });
    }
    throw error;
}

export function clampLimit(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "20", 10);
    if (!Number.isFinite(parsed)) {
        return 20;
    }
    return Math.min(Math.max(parsed, 1), 100);
}

export function parseEventCursor(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "0", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function catalogPage<T>(items: readonly T[]): { items: T[]; nextCursor: null; snapshotAt: string } {
    return {
        items: [...items],
        nextCursor: null,
        snapshotAt: new Date().toISOString(),
    };
}

export function parsePositiveInteger(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new BadRequestException({
            code: "validation_failed",
            message: "Version must be a positive integer.",
            retryable: false,
        });
    }
    return parsed;
}

export function toPublicSource(source: SourceSnapshot) {
    const config: Record<string, unknown> = {};
    if (typeof source.config.feedUrl === "string") config.feedUrl = source.config.feedUrl;
    // Per-source media policy (ADR-0014); absent means "follow the default".
    if (source.config.media !== undefined) {
        config.media = source.config.media;
    }
    if (source.kind === "bilibili") {
        for (const key of ["mode", "limit", "profile", "schemaVersion"] as const) {
            const value = source.config[key];
            if (value !== undefined) config[key] = value;
        }
    }
    return {
        id: source.id,
        name: source.name,
        sourceDefinitionRef: source.sourceDefinitionRef,
        operationId: source.operationId,
        connectorId: source.connectorId,
        kind: source.kind,
        config,
        enabled: source.enabled,
        revisionId: source.revisionId,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        lastRunAt: source.lastRunAt,
        lastError: source.lastError,
        connectionId: source.connectionId ?? null,
        scheduleIntervalMs: source.scheduleIntervalMs ?? null,
    };
}

export function toProductWorkflowRunStatus(status: WorkflowEnvelope["status"]): RunStatus {
    switch (status) {
        case "queued":
            return "queued";
        case "running":
        case "waiting":
            return "running";
        case "completed":
            return "succeeded";
        case "failed":
            return "failed";
        case "cancelled":
            return "cancelled";
    }
}

export function toPublicWorkflowRun(envelope: WorkflowEnvelope) {
    const parsedProductRun = productRunSchema.safeParse(envelope.productRun);
    const productRun = parsedProductRun.success ? parsedProductRun.data : {};
    const triggerKind = productRun.triggerKind ?? "manual";
    return {
        id: envelope.runId,
        sourceId: productRun.sourceId ?? null,
        triggerKind,
        status: toProductWorkflowRunStatus(envelope.status),
        createdAt: envelope.createdAt,
        startedAt: envelope.startedAt,
        finishedAt: envelope.finishedAt,
        itemCount: productRun.itemCount ?? 0,
        createdEntryCount: productRun.createdEntryCount ?? 0,
        revisedEntryCount: productRun.revisedEntryCount ?? 0,
        error: productRun.error ?? null,
    };
}
