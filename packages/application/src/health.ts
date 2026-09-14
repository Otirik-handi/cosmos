/** 健康快照装配。 */

import {
    protocolVersion, type HealthResponse,
} from "@cosmos/contracts";

export function createHealthSnapshot(input: {
    version: string;
    workerStatus?: HealthResponse["workerStatus"];
    storageStatus?: HealthResponse["storageStatus"];
    migrationStatus?: HealthResponse["migrationStatus"];
    now?: Date;
}): HealthResponse {
    return {
        status: "ok",
        service: "cosmos-api",
        version: input.version,
        protocolVersion,
        workerStatus: input.workerStatus ?? "unknown",
        storageStatus: input.storageStatus ?? "unknown",
        migrationStatus: input.migrationStatus ?? "unknown",
        timestamp: (input.now ?? new Date()).toISOString(),
    };
}
