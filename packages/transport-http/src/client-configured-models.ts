import {
    configuredModelPageSchema,
    configuredModelSnapshotSchema,
    createConfiguredModelCommandSchema,
    updateConfiguredModelCommandSchema,
    type ConfiguredModelPage,
    type ConfiguredModelSnapshot,
    type CreateConfiguredModelCommand,
    type UpdateConfiguredModelCommand,
} from "@cosmos/contracts";
import { z } from "zod";
import { ProviderModelsClient } from "./client-provider-models.js";

export class ConfiguredModelsClient extends ProviderModelsClient {
    async listConfiguredModels(providerId: string): Promise<ConfiguredModelPage> {
        return this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}/models`, {
            schema: configuredModelPageSchema,
        });
    }

    async getConfiguredModel(providerId: string, modelId: string): Promise<ConfiguredModelSnapshot> {
        return this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, {
            schema: configuredModelSnapshotSchema,
        });
    }

    async createConfiguredModel(providerId: string, input: CreateConfiguredModelCommand, idempotencyKey: string): Promise<ConfiguredModelSnapshot> {
        const payload = createConfiguredModelCommandSchema.parse(input);
        return this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}/models`, {
            method: "POST", headers: { "idempotency-key": idempotencyKey }, body: payload,
            schema: configuredModelSnapshotSchema,
        });
    }

    async updateConfiguredModel(providerId: string, modelId: string, input: UpdateConfiguredModelCommand, idempotencyKey: string): Promise<ConfiguredModelSnapshot> {
        const payload = updateConfiguredModelCommandSchema.parse(input);
        return this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, {
            method: "PATCH", headers: { "idempotency-key": idempotencyKey }, body: payload,
            schema: configuredModelSnapshotSchema,
        });
    }

    async deleteConfiguredModel(providerId: string, modelId: string, expectedVersion: number, idempotencyKey: string): Promise<void> {
        await this.request(`/api/v1/model-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, {
            method: "DELETE",
            headers: { "idempotency-key": idempotencyKey },
            body: { expectedVersion },
            schema: z.unknown(),
        });
    }
}
