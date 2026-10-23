import { expect, it } from "vitest";
import type { ProviderCredentialOperation } from "@cosmos/application";
import { ModelProviderCredentials, ModelProviderQuery } from "@cosmos/application";
import { PrismaModelProviderQueryRepository } from "./model-provider-query-repository.js";
import { PrismaProviderCredentialRepository } from "./model-provider-credential-repository.js";

it("classifies an absent recovery receipt as not_found without leaking Prisma errors", async () => {
    const transaction = { modelConfigurationOperation: { findUnique: async () => null, findUniqueOrThrow: async () => { throw Object.assign(new Error("Synthetic missing record."), { code: "P2025" }); } } };
    const client = { $transaction: async (use: (tx: unknown) => Promise<unknown>) => use(transaction) };
    const repository = new PrismaProviderCredentialRepository(client as unknown as ConstructorParameters<typeof PrismaProviderCredentialRepository>[0]);
    await expect(repository.recover("missing")).rejects.toMatchObject({ code: "not_found" });
});

it.each(["version_conflict", "operation_in_progress"])("persists %s through compensation, recovery and safe queries", async (code) => {
    let row: ProviderCredentialOperation & { kind: string; errorCode: string | null } = {
        id: "operation", providerId: "provider", generation: 1, state: "pending", phase: "registered",
        newSecretRef: "synthetic:new", oldSecretRef: "synthetic:old", resourceVersion: null, kind: "update", errorCode: null,
    };
    const transaction = {
        modelConfigurationOperation: {
            findUnique: async () => ({ ...row }), findUniqueOrThrow: async () => ({ ...row }),
            update: async ({ data }: { data: { generation?: { increment: number }; state?: ProviderCredentialOperation["state"]; errorCode?: string | null } }) => {
                row = { ...row, ...data, generation: row.generation + (data.generation?.increment ?? 0) };
                return { ...row };
            },
        },
        modelProvider: { findUnique: async () => ({ pendingOperationId: row.id }), count: async () => 0, updateMany: async () => ({ count: 1 }) },
    };
    const client = { $transaction: async (use: (tx: unknown) => Promise<unknown>) => use(transaction) };
    const repository = new PrismaProviderCredentialRepository(client as unknown as ConstructorParameters<typeof PrismaProviderCredentialRepository>[0]);
    repository.findByKey = async () => row;
    let deleteFails = true;
    const service = new ModelProviderCredentials({ repository, operationId: () => row.id,
        lock: async (_id, use) => use(), secrets: { put: async () => {}, delete: async () => { if (deleteFails) throw new Error("synthetic"); return true; } } });
    const recovered = await repository.recover(row.id, code as "version_conflict" | "operation_in_progress");
    expect(recovered.errorCode).toBe(code);
    expect(await service.retry(row.id)).toMatchObject({ state: "cleanup_pending", errorCode: code });
    expect(row).toMatchObject({ state: "cleanup_pending", phase: "registered", errorCode: code });
    const pendingQuery = new ModelProviderQuery(new PrismaModelProviderQueryRepository({
        modelProvider: { findMany: async () => [] },
        modelConfigurationOperation: { findMany: async () => [], findUnique: async () => ({ id: row.id, kind: row.kind, providerId: row.providerId, state: row.state, errorCode: row.errorCode, resourceVersion: row.resourceVersion }) },
    }));
    expect(await pendingQuery.operation(row.id)).toMatchObject({ state: "cleanup_pending", errorCode: code });
    expect(await pendingQuery.operationByKey("key")).toEqual(await pendingQuery.operation(row.id));
    deleteFails = false;
    const failed = await service.retry(row.id);
    expect(failed).toMatchObject({ state: "failed", errorCode: code });
    expect(await service.retry(row.id)).toEqual(failed);
    expect(await service.save({ idempotencyKey: "key", providerId: "provider", command: { expectedVersion: 1, name: "Unused" } })).toMatchObject({ ...failed, replayed: true });
    const queryRepository = new PrismaModelProviderQueryRepository({
        modelProvider: { findMany: async () => [] },
        modelConfigurationOperation: { findMany: async () => [], findUnique: async () => ({ id: row.id, kind: row.kind, providerId: row.providerId, state: row.state, errorCode: row.errorCode, resourceVersion: row.resourceVersion }) },
    });
    const query = new ModelProviderQuery(queryRepository);
    expect(await query.operation(row.id)).toMatchObject({ state: "failed", errorCode: code });
    expect(await query.operationByKey("key")).toEqual(await query.operation(row.id));
});

it.each([null, "cleanup_pending", "operation_in_progress"])("preserves published history with prior error %s during recovery", async (errorCode) => {
    const row = { id: "operation", providerId: "provider", generation: 1, state: "pending", phase: "published",
        newSecretRef: "synthetic:new", oldSecretRef: null, resourceVersion: 2, errorCode };
    let updateData: unknown;
    const transaction = { modelConfigurationOperation: { findUnique: async () => row,
        update: async ({ data }: { data: { generation: { increment: number } } }) => {
            updateData = data;
            return { ...row, generation: row.generation + data.generation.increment };
        } } };
    const client = { $transaction: async (use: (tx: unknown) => Promise<unknown>) => use(transaction) };
    const repository = new PrismaProviderCredentialRepository(client as unknown as ConstructorParameters<typeof PrismaProviderCredentialRepository>[0]);
    expect(await repository.recover(row.id, "version_conflict")).toMatchObject({ phase: "published", errorCode, resourceVersion: 2 });
    expect(updateData).toEqual({ generation: { increment: 1 } });
});
