/** Connector 端口、租约、错误码与解析器。 */

import type {
    SourceSnapshot,
} from "@cosmos/contracts";
import type {
    NormalizedIngestItem,
} from "@cosmos/domain";

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
    }): Promise<{
        items: readonly NormalizedIngestItem[];
        nextCursor: string | null;
    }>;
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
