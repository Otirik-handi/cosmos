import {
    createSourceCommandSchema,
    jobSnapshotSchema,
    mediaCleanupCommandSchema,
    mediaCleanupRunSnapshotSchema,
    runSnapshotSchema,
    cancelRunCommandSchema,
    recoverRunCommandSchema,
    rerunRunCommandSchema,
    runControlResultSchema,
    sourceActivationCommandSchema,
    sourceConfigProbeCommandSchema,
    sourceConfigProbeJobSnapshotSchema,
    sourceSnapshotSchema,
    connectionInstanceSchema,
    createConnectionCommandSchema,
    updateConnectionCommandSchema,
    type CreateSourceCommand,
    type JobSnapshot,
    type RunSnapshot,
    type CancelRunCommand,
    type RecoverRunCommand,
    type RunControlResult,
    type SourceActivationCommand,
    type SourceConfigProbeCommand,
    type SourceConfigProbeJobSnapshot,
    type SourceSnapshot,
    type ConnectionInstance,
    type CreateConnectionCommand,
    type UpdateConnectionCommand,
    type MediaCleanupCommand,
    type MediaCleanupRunSnapshot,
    type UpdateSourceCommand,
    userOrganizationAckSchema,
    type UserOrganizationAck,
} from "@cosmos/contracts";

import { PlatformClient } from "./client-platform.js";
import type {
    CosmosEventSource,
    HttpCosmosClientOptions,
} from "./types.js";
import { CosmosTransportError } from "./types.js";
export class SourcesClient extends PlatformClient {
    async createSourceConfigProbe(
        input: SourceConfigProbeCommand,
        idempotencyKey?: string,
    ): Promise<SourceConfigProbeJobSnapshot> {
        const payload = sourceConfigProbeCommandSchema.parse(input);
        return this.request("/api/v1/source-config-probes", {
            method: "POST",
            headers: idempotencyKey
                ? { "idempotency-key": idempotencyKey }
                : undefined,
            body: payload,
            schema: sourceConfigProbeJobSnapshotSchema,
        });
    }

    async getSourceConfigProbe(jobId: string): Promise<SourceConfigProbeJobSnapshot> {
        return this.request(`/api/v1/source-config-probes/${encodeURIComponent(jobId)}`, {
            schema: sourceConfigProbeJobSnapshotSchema,
        });
    }

    async createMediaCleanup(
        input: MediaCleanupCommand,
        idempotencyKey: string,
    ): Promise<MediaCleanupRunSnapshot> {
        const payload = mediaCleanupCommandSchema.parse(input);
        return this.request("/api/v1/media-cleanups", {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
            body: payload,
            schema: mediaCleanupRunSnapshotSchema,
        });
    }

    async getMediaCleanup(runId: string): Promise<MediaCleanupRunSnapshot> {
        return this.request(`/api/v1/media-cleanups/${encodeURIComponent(runId)}`, {
            schema: mediaCleanupRunSnapshotSchema,
        });
    }

    async listSources(): Promise<readonly SourceSnapshot[]> {
        return this.request("/api/v1/sources", {
            schema: sourceSnapshotSchema.array(),
        });
    }

    async getSource(sourceId: string): Promise<SourceSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}`, {
            schema: sourceSnapshotSchema,
        });
    }

    async createSource(input: CreateSourceCommand): Promise<SourceSnapshot> {
        const payload = createSourceCommandSchema.parse(input);
        return this.request("/api/v1/sources", {
            method: "POST",
            body: payload,
            schema: sourceSnapshotSchema,
        });
    }

    async updateSource(
        sourceId: string,
        input: UpdateSourceCommand,
    ): Promise<SourceSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}`, {
            method: "PATCH",
            body: input,
            schema: sourceSnapshotSchema,
        });
    }

    async listConnections(): Promise<readonly ConnectionInstance[]> {
        return this.request("/api/v1/connections", {
            schema: connectionInstanceSchema.array(),
        });
    }

    async getConnection(connectionId: string): Promise<ConnectionInstance> {
        return this.request(`/api/v1/connections/${encodeURIComponent(connectionId)}`, {
            schema: connectionInstanceSchema,
        });
    }

    async createConnection(input: CreateConnectionCommand): Promise<ConnectionInstance> {
        const payload = createConnectionCommandSchema.parse(input);
        return this.request("/api/v1/connections", {
            method: "POST",
            body: payload,
            schema: connectionInstanceSchema,
        });
    }

    async updateConnection(
        connectionId: string,
        input: UpdateConnectionCommand,
    ): Promise<ConnectionInstance> {
        const payload = updateConnectionCommandSchema.parse(input);
        return this.request(`/api/v1/connections/${encodeURIComponent(connectionId)}`, {
            method: "PATCH",
            body: payload,
            schema: connectionInstanceSchema,
        });
    }

    async deleteConnection(connectionId: string): Promise<UserOrganizationAck> {
        return this.request(`/api/v1/connections/${encodeURIComponent(connectionId)}/removals`, {
            method: "POST",
            schema: userOrganizationAckSchema,
        });
    }

    async activateSource(
        sourceId: string,
        input: SourceActivationCommand,
        idempotencyKey: string,
    ): Promise<SourceSnapshot> {
        const payload = sourceActivationCommandSchema.parse(input);
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/activation-commands`, {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
            body: payload,
            schema: sourceSnapshotSchema,
        });
    }

    async testSource(sourceId: string, idempotencyKey?: string): Promise<JobSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/test`, {
            method: "POST",
            headers: idempotencyKey
                ? { "idempotency-key": idempotencyKey }
                : undefined,
            schema: jobSnapshotSchema,
        });
    }

    async triggerSource(
        sourceId: string,
        options: { idempotencyKey?: string } = {},
    ): Promise<RunSnapshot> {
        return this.request(`/api/v1/sources/${encodeURIComponent(sourceId)}/runs`, {
            method: "POST",
            headers: options.idempotencyKey
                ? { "idempotency-key": options.idempotencyKey }
                : undefined,
            schema: runSnapshotSchema,
        });
    }

    async cancelRun(runId: string, input: CancelRunCommand = {}): Promise<RunControlResult> {
        const payload = cancelRunCommandSchema.parse(input);
        return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/cancellations`, {
            method: "POST",
            body: payload,
            schema: runControlResultSchema,
        });
    }

    async recoverRun(runId: string, input: RecoverRunCommand = {}): Promise<RunControlResult> {
        const payload = recoverRunCommandSchema.parse(input);
        return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/recoveries`, {
            method: "POST",
            body: payload,
            schema: runControlResultSchema,
        });
    }

    async rerunRun(runId: string, options: { idempotencyKey?: string } = {}): Promise<RunControlResult> {
        const payload = rerunRunCommandSchema.parse({});
        return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/re-runs`, {
            method: "POST",
            headers: options.idempotencyKey
                ? { "idempotency-key": options.idempotencyKey }
                : undefined,
            body: payload,
            schema: runControlResultSchema,
        });
    }
}
