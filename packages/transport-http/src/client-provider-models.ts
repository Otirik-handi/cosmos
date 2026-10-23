import {
    createModelProviderCommandSchema,
    modelProviderOperationSnapshotSchema,
    modelProviderPageSchema,
    modelProviderSnapshotSchema,
    providerModelDiscoverySnapshotSchema,
    updateModelProviderCommandSchema,
    type CreateModelProviderCommand,
    type ModelProviderOperationSnapshot,
    type ModelProviderPage,
    type ModelProviderSnapshot,
    type ProviderModelDiscoverySnapshot,
    type UpdateModelProviderCommand,
} from "@cosmos/contracts";
import { z } from "zod";

import { BoardClient } from "./client-board.js";

function providerWriteSchema(status: number) {
    if (status === 202) return modelProviderOperationSnapshotSchema;
    if (status === 201) return modelProviderSnapshotSchema;
    throw new Error(`Unexpected model provider write status: ${status}.`);
}

export class ProviderModelsClient extends BoardClient {
    async listModelProviders(input: { limit?: number; cursor?: string } = {}): Promise<ModelProviderPage> {
        const params = new URLSearchParams();
        if (input.limit !== undefined) params.set("limit", String(input.limit));
        if (input.cursor !== undefined) params.set("cursor", input.cursor);
        const query = params.toString();
        return this.request(`/api/v1/model-providers${query ? `?${query}` : ""}`, {
            schema: modelProviderPageSchema,
        });
    }

    async getModelProvider(providerId: string): Promise<ModelProviderSnapshot> {
        return this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}`, {
            schema: modelProviderSnapshotSchema,
        });
    }

    async createModelProvider(input: CreateModelProviderCommand, idempotencyKey: string): Promise<ModelProviderSnapshot | ModelProviderOperationSnapshot> {
        const payload = createModelProviderCommandSchema.parse(input);
        return this.request("/api/v1/model-providers", {
            method: "POST", headers: { "idempotency-key": idempotencyKey }, body: payload,
            schema: modelProviderSnapshotSchema,
            schemaForStatus: providerWriteSchema,
        }) as Promise<ModelProviderSnapshot | ModelProviderOperationSnapshot>;
    }

    async updateModelProvider(providerId: string, input: UpdateModelProviderCommand, idempotencyKey: string): Promise<ModelProviderSnapshot | ModelProviderOperationSnapshot> {
        const payload = updateModelProviderCommandSchema.parse(input);
        return this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}`, {
            method: "PATCH", headers: { "idempotency-key": idempotencyKey }, body: payload,
            schema: modelProviderSnapshotSchema,
            schemaForStatus: providerWriteSchema,
        }) as Promise<ModelProviderSnapshot | ModelProviderOperationSnapshot>;
    }

    /** 删除是同步的：204 表示 Provider 及其模型已删，凭证清理失败不影响结果。 */
    async deleteModelProvider(providerId: string, expectedVersion: number, idempotencyKey: string): Promise<void> {
        await this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}`, {
            method: "DELETE", headers: { "idempotency-key": idempotencyKey },
            body: { expectedVersion },
            schema: z.unknown(),
        });
    }

    async getModelConfigurationOperation(operationId: string): Promise<ModelProviderOperationSnapshot> {
        return this.request(`/api/v1/model-configuration-operations/${encodeURIComponent(operationId)}`, {
            schema: modelProviderOperationSnapshotSchema,
        });
    }

    async getModelConfigurationOperationByKey(idempotencyKey: string): Promise<ModelProviderOperationSnapshot> {
        return this.request(`/api/v1/model-configuration-operations/by-key/${encodeURIComponent(idempotencyKey)}`, {
            schema: modelProviderOperationSnapshotSchema,
        });
    }

    async retryModelConfigurationOperation(operationId: string): Promise<ModelProviderOperationSnapshot> {
        return this.request(`/api/v1/model-configuration-operations/${encodeURIComponent(operationId)}/retries`, {
            method: "POST",
            body: {},
            schema: modelProviderOperationSnapshotSchema,
        });
    }

    /** 发现是同步只读调用：失败也返回已完成的快照，调用方只看 `status`/`errorCode`，不重试。 */
    async discoverProviderModels(providerId: string, expectedProviderVersion: number): Promise<ProviderModelDiscoverySnapshot> {
        return this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}/discoveries`, {
            method: "POST",
            body: { expectedProviderVersion },
            schema: providerModelDiscoverySnapshotSchema,
        });
    }
}
