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

/** 抽屉的归属（ADR-0026）：今天只有采集计划会写状态，所以归属就是计划。 */
export interface ConnectorStateOwner {
    planId: string;
}

/**
 * `conflict` 表示这个抽屉已经登记给另一个计划：实现保留首个登记，调用方记一条日志即可
 * ——状态写入本来就允许失败降级，为归属冲突让采集失败不划算（ADR-0026）。
 */
export type ConnectorStateNamespaceRegistration = "registered" | "conflict";

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

    /**
     * 登记命名空间归属（ADR-0026）：宿主准备状态句柄时调用一次，让「这个抽屉属于谁」
     * 成为数据，而不是每次反查计划表 + 解析 manifest 模板。登记是尽力而为的元数据，
     * 调用方失败时只记日志，不能让采集失败。
     */
    registerNamespace(
        namespace: string,
        owner: ConnectorStateOwner,
    ): Promise<ConnectorStateNamespaceRegistration>;
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
