import {
    modelProviderSnapshotSchema, modelProviderOperationSnapshotSchema,
    type ModelProviderSnapshot, type ModelProviderOperationSnapshot,
} from "@cosmos/contracts";
import { z } from "zod";

export type { ModelProviderOperationSnapshot } from "@cosmos/contracts";
const identifier = z.string().min(1).max(200).refine((value) => value === value.trim() && !/[\x00-\x1f\x7f]/.test(value));
export interface ModelProviderQueryRepository {
    list(input: { limit: number; cursor?: string }): Promise<unknown[]>;
    get(id: string): Promise<unknown | null>;
    operation(where: { id: string } | { idempotencyKey: string }): Promise<unknown | null>;
}
function fail(code: "invalid_input" | "not_found" | "dependency_unavailable"): never {
    throw Object.assign(new Error("Model configuration query failed."), { code });
}
function id(value: string): string {
    const parsed = identifier.safeParse(value);
    return parsed.success ? parsed.data : fail("invalid_input");
}
export class ModelProviderQuery {
    constructor(private readonly repository: ModelProviderQueryRepository) {}

    async list(input: { limit?: number; cursor?: string } = {}): Promise<{ items: ModelProviderSnapshot[]; nextCursor: string | null }> {
        const limit = input.limit ?? 50;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("invalid_input");
        const cursor = input.cursor === undefined ? undefined : id(input.cursor);
        const rows = await this.safe(async () => {
            const values = await this.repository.list({ limit: limit + 1, ...(cursor ? { cursor } : {}) });
            return values.map((value) => modelProviderSnapshotSchema.parse(value));
        });
        const items = rows.slice(0, limit);
        return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
    }
    async get(providerId: string): Promise<ModelProviderSnapshot> {
        const provider = id(providerId);
        const value = await this.safe(async () => {
            const row = await this.repository.get(provider);
            return row === null ? null : modelProviderSnapshotSchema.parse(row);
        });
        return value ?? fail("not_found");
    }
    async operation(operationId: string): Promise<ModelProviderOperationSnapshot> {
        return this.receipt({ id: id(operationId) });
    }
    async operationByKey(key: string): Promise<ModelProviderOperationSnapshot> {
        return this.receipt({ idempotencyKey: id(key) });
    }
    private async receipt(where: { id: string } | { idempotencyKey: string }): Promise<ModelProviderOperationSnapshot> {
        const value = await this.safe(async () => {
            const row = await this.repository.operation(where);
            return row === null ? null : modelProviderOperationSnapshotSchema.parse(row);
        });
        return value ?? fail("not_found");
    }
    private async safe<T>(use: () => Promise<T>): Promise<T> {
        try { return await use(); } catch { return fail("dependency_unavailable"); }
    }
}
