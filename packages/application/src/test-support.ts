import { AsyncLocalStorage } from "node:async_hooks";

import type { SourceSnapshot } from "@cosmos/contracts";

import type {
    LoggerContext,
    LoggerPort,
} from "./logger.js";

export function captureLogger(): {
    logger: LoggerPort;
    records: Array<Record<string, unknown>>;
} {
    const storage = new AsyncLocalStorage<LoggerContext>();
    const records: Array<Record<string, unknown>> = [];
    const create = (localContext: LoggerContext = {}): LoggerPort => ({
        child(context) {
            return create({ ...localContext, ...context });
        },
        withContext<T>(
            context: LoggerContext,
            callback: () => T | Promise<T>,
        ): T | Promise<T> {
            return storage.run({
                ...storage.getStore(),
                ...localContext,
                ...context,
            }, callback);
        },
        debug(event, fields = {}) {
            records.push({
                ...storage.getStore(),
                ...localContext,
                ...fields,
                event,
                level: "debug",
            });
        },
        info(event, fields = {}) {
            records.push({
                ...storage.getStore(),
                ...localContext,
                ...fields,
                event,
                level: "info",
            });
        },
        warn(event, fields = {}) {
            records.push({
                ...storage.getStore(),
                ...localContext,
                ...fields,
                event,
                level: "warn",
            });
        },
        error(event, fields = {}, error) {
            records.push({
                ...storage.getStore(),
                ...localContext,
                ...fields,
                event,
                level: "error",
                ...(error ? { error: String(error) } : {}),
            });
        },
    });
    return {
        logger: create(),
        records,
    };
}

export function source(input: Partial<SourceSnapshot> = {}): SourceSnapshot {
    return {
        id: "source-1",
        name: "Bilibili",
        sourceDefinitionRef: "source.bilibili@1",
        operationId: "fetch",
        connectorId: "bilibili",
        kind: "bilibili",
        config: { mode: "hot", limit: 5 },
        enabled: true,
        mediaPolicy: null,
        revisionId: "source-1:1",
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
        lastRunAt: null,
        lastError: null,
        planId: "plan:source-1",
        planRevisionId: "plan:source-1:1",
        connectionId: null,
        scheduleIntervalMs: null,
        ...input,
    };
}
