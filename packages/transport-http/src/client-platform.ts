import {
    connectorDescriptorSchema,
    healthResponseSchema,
    jobSnapshotSchema,
    runSnapshotSchema,
    sourceDefinitionPageSchema,
    storageStatsSchema,
    backupSnapshotSchema,
    type ConnectorDescriptor,
    type HealthResponse,
    type JobSnapshot,
    type RunSnapshot,
    type SourceDefinitionManifest,
    type StorageStats,
    type BackupSnapshot,
    userOrganizationAckSchema,
    type UserOrganizationAck,
} from "@cosmos/contracts";

import { HttpCosmosClientBase } from "./client-base.js";
import type {
    CosmosEventSource,
    HttpCosmosClientOptions,
} from "./types.js";
import { CosmosTransportError } from "./types.js";
export class PlatformClient extends HttpCosmosClientBase {
    async health(): Promise<HealthResponse> {
        return this.request("/api/v1/health", {
            schema: healthResponseSchema,
        });
    }

    async listConnectors(): Promise<readonly ConnectorDescriptor[]> {
        return this.request("/api/v1/connectors", {
            schema: connectorDescriptorSchema.array(),
        });
    }

    async listSourceDefinitions(): Promise<readonly SourceDefinitionManifest[]> {
        const page = await this.request("/api/v1/source-definitions", {
            schema: sourceDefinitionPageSchema,
        });
        return page.items;
    }

    async storageStats(): Promise<StorageStats> {
        return this.request("/api/v1/storage-stats", {
            schema: storageStatsSchema,
        });
    }

    async listBackups(): Promise<readonly BackupSnapshot[]> {
        return this.request("/api/v1/backups", {
            schema: backupSnapshotSchema.array(),
        });
    }

    async createBackup(): Promise<BackupSnapshot> {
        return this.request("/api/v1/backups", {
            method: "POST",
            schema: backupSnapshotSchema,
        });
    }

    async restoreBackup(backupId: string): Promise<UserOrganizationAck> {
        return this.request(`/api/v1/backups/${encodeURIComponent(backupId)}/restores`, {
            method: "POST",
            schema: userOrganizationAckSchema,
        });
    }

    async listRuns(options: { sourceId?: string; limit?: number } = {}): Promise<readonly RunSnapshot[]> {
        const params = new URLSearchParams();
        if (options.sourceId) {
            params.set("sourceId", options.sourceId);
        }
        if (options.limit) {
            params.set("limit", String(options.limit));
        }
        return this.request(`/api/v1/runs${params.size > 0 ? `?${params.toString()}` : ""}`, {
            schema: runSnapshotSchema.array(),
        });
    }

    async getJob(jobId: string): Promise<JobSnapshot> {
        return this.request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
            schema: jobSnapshotSchema,
        });
    }
}
