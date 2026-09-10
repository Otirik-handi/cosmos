import type { JsonValue } from "@notnotype/nb-workflow";

/**
 * Namespaced + versioned non-secret connector state (ADR-0017): cursor, ETag,
 * pagination token, rate state. Adapters may define their own state schema;
 * Cosmos owns the namespace, version, concurrency and recovery. Secret values
 * must never be written here (OPS-005/009).
 */
export interface ConnectorStateEntry {
    value: JsonValue;
    /** Monotonic CAS token; pass it back to `putState` to avoid lost updates. */
    version: number;
}

export interface ConnectorStateStorePort {
    getState(namespace: string, key: string): Promise<ConnectorStateEntry | null>;

    /**
     * Conditional write. `expectedVersion: null` means "expect absent" (create);
     * otherwise the write only succeeds when the current version matches, and the
     * returned version is the new (incremented) one. A mismatch is a conflict.
     */
    putState(
        namespace: string,
        key: string,
        value: JsonValue,
        expectedVersion: number | null,
    ): Promise<{ version: number }>;
}

export class ConnectorStateConflictError extends Error {
    constructor(namespace: string, key: string, expectedVersion: number | null) {
        super(
            expectedVersion === null
                ? `Connector state ${namespace}:${key} already exists.`
                : `Connector state ${namespace}:${key} version ${expectedVersion} is stale.`,
        );
        this.name = "ConnectorStateConflictError";
    }
}
