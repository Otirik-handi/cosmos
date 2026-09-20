/** Connector 端口、租约、错误码与解析器。 */

import type {
    JsonValue,
} from "@notnotype/nb-workflow";
import type {
    SourceSnapshot,
} from "@cosmos/contracts";
import type {
    NormalizedIngestItem,
} from "@cosmos/domain";
import type {
    ConnectorStateEntry,
} from "./connector-state-store.js";

export interface JobLease {
    jobId: string;
    leaseToken: string;
}

export interface IngestConnector {
    /**
     * Phase 1B runtime boundary for one business source kind.
     *
     * A connector validates a configured SourceInstance, reads its external
     * provider, and returns normalized items. It does not persist domain data.
     * Future SourceOperation entries can refine this boundary without making
     * the connector a database-facing object.
     */
    id: string;
    description: string;
    configVersion: string;
    capabilities: readonly string[];
    validate(source: SourceSnapshot): void;
    fetchItems(input: {
        source: SourceSnapshot;
        cursor: string | null;
        idempotencyKey?: string;
        signal?: AbortSignal;
        /**
         * 已按来源命名空间限定的非秘密状态句柄（ADR-0017/0018）。命名空间、版本与并发由宿主
         * 决定，连接器只看到 get/put；宿主没有接状态存储时（legacy 采集路径）为 undefined，
         * 连接器必须退化成无状态抓取，不能假定它一定存在。
         */
        state?: ConnectorStateHandle;
    }): Promise<{
        items: readonly NormalizedIngestItem[];
        nextCursor: string | null;
    }>;
}

/** 命名空间已固定、只剩键的连接器状态视图。 */
export interface ConnectorStateHandle {
    get(key: string): Promise<ConnectorStateEntry | null>;
    put(key: string, value: JsonValue, expectedVersion: number | null): Promise<{ version: number }>;
}

export type ConnectorErrorCode =
    | "dependency_unavailable"
    | "authentication_required"
    | "timeout"
    | "rate_limited"
    | "malformed_payload"
    | "unsupported_version"
    | "invalid_configuration";

export class ConnectorExecutionError extends Error {
    constructor(
        readonly code: ConnectorErrorCode,
        message: string,
        readonly retryable = true,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = "ConnectorExecutionError";
    }
}

export type ConnectorResolver = (
    source: SourceSnapshot,
) => IngestConnector;

/**
 * Runtime composition boundary for business-source collectors.
 *
 * API and Worker use the same registry. The registry key is a stable
 * business source kind; implementation details such as OpenCLI remain inside
 * the connector.
 */
