/** 包内共享 helper:文件读取、失败归类与重试延时;不经入口导出。 */

import {
    connectionProbeJobPayloadSchema, sourceConfigProbeJobPayloadSchema, type SourceConfigProbeCommand,
} from "@cosmos/contracts";

import {
    ConnectorExecutionError,
} from "./connector-ports.js";

export function retryDelayMs(attempt: number): number {
    return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export function readSourceId(payload: unknown): string {
    if (
        !payload
        || typeof payload !== "object"
        || typeof (payload as { sourceId?: unknown }).sourceId !== "string"
        || !(payload as { sourceId: string }).sourceId
    ) {
        throw new Error("Source probe job is missing sourceId.");
    }
    return (payload as { sourceId: string }).sourceId;
}

export function readConfigProbeCommand(payload: unknown): SourceConfigProbeCommand {
    const parsed = sourceConfigProbeJobPayloadSchema.safeParse(payload);
    if (!parsed.success) {
        throw new Error("Source config probe job is missing a valid configProbe command.");
    }
    return parsed.data.configProbe;
}

export function readConnectionProbeConnectionId(payload: unknown): string {
    const parsed = connectionProbeJobPayloadSchema.safeParse(payload);
    if (!parsed.success) {
        throw new Error("Connection probe job is missing a valid connectionId.");
    }
    return parsed.data.connectionId;
}

export function readOptionalSourceId(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }
    const sourceId = (payload as { sourceId?: unknown }).sourceId;
    return typeof sourceId === "string" && sourceId
        ? sourceId
        : null;
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function normalizeFailure(error: unknown): {
    message: string;
    code: string | null;
    retryable: boolean;
} {
    if (error instanceof ConnectorExecutionError) {
        return {
            message: error.message,
            code: error.code,
            retryable: error.retryable,
        };
    }
    if (error && typeof error === "object") {
        const candidate = error as {
            message?: unknown;
            code?: unknown;
            retryable?: unknown;
        };
        return {
            message: typeof candidate.message === "string"
                ? candidate.message
                : String(error),
            code: typeof candidate.code === "string"
                ? candidate.code
                : null,
            retryable: candidate.retryable !== false,
        };
    }
    return {
        message: String(error),
        code: null,
        retryable: true,
    };
}
