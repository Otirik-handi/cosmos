import {
    connectorDescriptorSchema,
    connectorStateExportSchema,
    connectorStateImportResultSchema,
    connectorStateNamespaceSummarySchema,
    healthResponseSchema,
    jobListSchema,
    jobSnapshotSchema,
    runSnapshotSchema,
    sourceDefinitionPageSchema,
    storageStatsSchema,
    backupSnapshotSchema,
    userDataExportSchema,
    type ConnectorDescriptor,
    type ConnectorStateExport,
    type ConnectorStateExportScope,
    type ConnectorStateImportResult,
    type ConnectorStateNamespaceSummary,
    type HealthResponse,
    type JobSnapshot,
    type RunSnapshot,
    type SourceDefinitionManifest,
    type StorageStats,
    type BackupSnapshot,
    type UserDataExport,
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

    /** 用户数据导出（LIB-008 / OPS-004）；存储面板据此生成下载文件。 */
    async exportUserData(): Promise<UserDataExport> {
        return this.request("/api/v1/exports/user-data", {
            schema: userDataExportSchema,
        });
    }

    /** 抽屉清单（ING-012 / ADR-0026）：归属来自登记表，未归属的标出来。 */
    async listConnectorStateNamespaces(): Promise<readonly ConnectorStateNamespaceSummary[]> {
        return this.request("/api/v1/connector-state/namespaces", {
            schema: connectorStateNamespaceSummarySchema.array(),
        });
    }

    /** 导出连接器状态（ING-012）；范围四选一，缺省是全部已归属。 */
    async exportConnectorState(
        scope: ConnectorStateExportScope = { kind: "attributed" },
    ): Promise<ConnectorStateExport> {
        const params = new URLSearchParams();
        switch (scope.kind) {
            case "namespace":
                params.set("namespace", scope.namespace);
                break;
            case "plan":
                params.set("planId", scope.planId);
                break;
            case "connection":
                params.set("connectionId", scope.connectionId);
                break;
            case "source":
                params.set("sourceId", scope.sourceId);
                break;
            case "attributed":
                break;
        }
        return this.request(
            `/api/v1/exports/connector-state${params.size > 0 ? `?${params.toString()}` : ""}`,
            { schema: connectorStateExportSchema },
        );
    }

    /** 导入连接器状态（ADR-0026）；默认只补缺失，显式 overwrite 才覆盖本地较新的状态。 */
    async importConnectorState(input: {
        mode?: "skip-existing" | "overwrite";
        targetNamespace?: string;
        export: ConnectorStateExport;
    }): Promise<ConnectorStateImportResult> {
        return this.request("/api/v1/imports/connector-state", {
            method: "POST",
            body: input,
            schema: connectorStateImportResultSchema,
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

    /** 某个 Run 的 Job 列表（OPS-002）：产品面据此展示状态、重试次数与错误。 */
    async listRunJobs(runId: string): Promise<readonly JobSnapshot[]> {
        const page = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/jobs`, {
            schema: jobListSchema,
        });
        return page.items;
    }
}
