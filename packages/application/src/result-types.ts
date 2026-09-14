/** 仓储与采集用例的读模型结果类型。 */

import type {
    HealthResponse,
} from "@cosmos/contracts";

export interface PersistIngestItemResult {
    createdEntry: boolean;
    revisedEntry: boolean;
    duplicateObservation: boolean;
}

/** One saved Asset whose per-source retention window has expired. */
export interface MediaCleanupCandidate {
    assetId: string;
    storageKey: string;
    byteSize: number | null;
    sourceId: string;
    sourceName: string | null;
    title: string | null;
    createdAt: string;
    expiredAt: string;
    retentionDays: number;
}

export interface WorkflowAttemptSnapshot {
    id: string;
    jobId: string;
    number: number;
    workerId: string;
    workerInstanceId: string;
    ownerEpoch: number;
    ownerSessionId: string | null;
    status: "leased" | "succeeded" | "failed" | "lease_lost" | "cancelled" | "uncertain";
    leaseAcquiredAt: string;
    leaseExpiresAt: string;
    lastHeartbeatAt: string | null;
    finishedAt: string | null;
    error: {
        kind: "aborted" | "retryable" | "terminal" | "unknown";
        code: string | null;
        message: string;
        retryable: boolean;
        occurredAt: string | null;
        detailsRef: null;
    } | null;
}

export interface RepositoryHealth {
    storageStatus: HealthResponse["storageStatus"];
    migrationStatus: HealthResponse["migrationStatus"];
    workerStatus: HealthResponse["workerStatus"];
}
