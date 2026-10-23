import type { PrismaClient, Prisma } from "@prisma/client";
import type {
    ProviderCredentialFields, ProviderCredentialOperation, ProviderCredentialRepository,
} from "@cosmos/application";

function conflict(code: "version_conflict" | "operation_in_progress" = "version_conflict"): never {
    throw Object.assign(new Error("Model provider operation conflict."), { code });
}

type Transaction = Prisma.TransactionClient;

export class PrismaProviderCredentialRepository implements ProviderCredentialRepository {
    constructor(private readonly client: PrismaClient) {}

    async findByKey(key: string): Promise<ProviderCredentialOperation | null> {
        const row = await this.client.modelConfigurationOperation.findUnique({ where: { idempotencyKey: key } });
        return row ? this.operation(row) : null;
    }

    async register(input: {
        id: string; idempotencyKey: string; providerId: string;
        fields: ProviderCredentialFields; replaceCredential: boolean;
    }): Promise<ProviderCredentialOperation> {
        try {
            return await this.client.$transaction(async (tx) => {
                const duplicate = await tx.modelConfigurationOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
                if (duplicate) return this.operation(duplicate);
                const current = await tx.modelProvider.findUnique({ where: { id: input.providerId } });
                const update = "expectedVersion" in input.fields;
                if ("expectedVersion" in input.fields) {
                    if (!current || current.version !== input.fields.expectedVersion) conflict();
                } else if (current !== null) conflict();
                if (current && (current.state !== "active" || current.pendingOperationId !== null)) conflict("operation_in_progress");
                const row = await tx.modelConfigurationOperation.create({ data: {
                    id: input.id, idempotencyKey: input.idempotencyKey, providerId: input.providerId,
                    kind: update ? "update" : "create", expectedVersion: current?.version ?? null,
                    newSecretRef: input.replaceCredential ? `model-provider:${input.id}` : null,
                    oldSecretRef: input.replaceCredential ? current?.secretRef ?? null : null,
                } });
                if (current) {
                    const changed = await tx.modelProvider.updateMany({
                        where: { id: current.id, version: current.version, state: "active", pendingOperationId: null },
                        data: { pendingOperationId: input.id },
                    });
                    if (changed.count !== 1) conflict();
                } else {
                    if (update || !("name" in input.fields) || !input.fields.name
                        || !input.fields.api || !input.fields.baseUrl || !input.replaceCredential) conflict();
                    await tx.modelProvider.create({ data: {
                        id: input.providerId, name: input.fields.name, api: input.fields.api,
                        baseUrl: input.fields.baseUrl, pendingOperationId: input.id,
                    } });
                }
                return this.operation(row);
            });
        } catch (error) {
            const winner = await this.findByKey(input.idempotencyKey);
            if (winner) return winner;
            throw error;
        }
    }

    async publish(operation: ProviderCredentialOperation, fields: ProviderCredentialFields): Promise<ProviderCredentialOperation> {
        return this.client.$transaction(async (tx) => {
            const row = await this.owned(tx, operation);
            const version = row.expectedVersion ?? 1;
            const changed = await tx.modelProvider.updateMany({
                where: { id: row.providerId, version, state: "active", pendingOperationId: row.id },
                data: {
                    ...(fields.name !== undefined ? { name: fields.name } : {}),
                    ...(fields.api !== undefined ? { api: fields.api } : {}),
                    ...(fields.baseUrl !== undefined ? { baseUrl: fields.baseUrl } : {}),
                    ...(row.newSecretRef ? { secretRef: row.newSecretRef } : {}),
                    ...(row.kind === "update" ? { version: { increment: 1 } } : {}),
                },
            });
            if (changed.count !== 1 || row.phase !== "registered") conflict();
            return this.operation(await tx.modelConfigurationOperation.update({ where: { id: row.id },
                data: { phase: "published", resourceVersion: row.kind === "update" ? version + 1 : version } }));
        });
    }

    async recover(id: string, publicationConflict?: "version_conflict" | "operation_in_progress"): Promise<ProviderCredentialOperation> {
        return this.client.$transaction(async (tx) => {
            const row = await tx.modelConfigurationOperation.findUnique({ where: { id } });
            if (!row) throw Object.assign(new Error("Model configuration operation not found."), { code: "not_found" });
            if (row.state === "completed" || row.state === "failed") return this.operation(row);
            return this.operation(await tx.modelConfigurationOperation.update({ where: { id },
                data: { generation: { increment: 1 },
                    ...(row.phase === "registered" && publicationConflict ? { errorCode: publicationConflict } : {}),
                } }));
        });
    }

    async canDelete(operation: ProviderCredentialOperation, ref: string): Promise<boolean> {
        return this.client.$transaction(async (tx) => {
            const row = await this.owned(tx, operation);
            if (ref !== (row.phase === "published" ? row.oldSecretRef : row.newSecretRef)) return false;
            return await tx.modelProvider.count({ where: { secretRef: ref } }) === 0;
        });
    }

    async finish(operation: ProviderCredentialOperation): Promise<ProviderCredentialOperation> {
        return this.settle(operation, "completed");
    }
    async fail(operation: ProviderCredentialOperation): Promise<ProviderCredentialOperation> {
        return this.settle(operation, "failed");
    }
    async cleanupPending(operation: ProviderCredentialOperation): Promise<ProviderCredentialOperation> {
        return this.client.$transaction(async (tx) => {
            const row = await this.owned(tx, operation);
            return this.operation(await tx.modelConfigurationOperation.update({ where: { id: operation.id },
                data: { state: "cleanup_pending", errorCode: row.errorCode === "version_conflict" || row.errorCode === "operation_in_progress"
                    ? row.errorCode : "cleanup_pending" } }));
        });
    }

    private async settle(operation: ProviderCredentialOperation, state: "completed" | "failed"): Promise<ProviderCredentialOperation> {
        return this.client.$transaction(async (tx) => {
            const row = await this.owned(tx, operation);
            if ((state === "completed") !== (row.phase === "published")) conflict();
            if (state === "failed" && row.kind === "create") {
                await tx.modelProvider.delete({ where: { id: row.providerId } });
            } else {
                const changed = await tx.modelProvider.updateMany({
                    where: { id: row.providerId, pendingOperationId: row.id }, data: { pendingOperationId: null },
                });
                if (changed.count !== 1) conflict();
            }
            return this.operation(await tx.modelConfigurationOperation.update({ where: { id: row.id }, data: {
                state, errorCode: state === "failed"
                    ? row.errorCode === "version_conflict" || row.errorCode === "operation_in_progress" ? row.errorCode : "credential_write_failed"
                    : null,
            } }));
        });
    }

    private async owned(tx: Transaction, operation: ProviderCredentialOperation) {
        const row = await tx.modelConfigurationOperation.findUniqueOrThrow({ where: { id: operation.id } });
        const provider = await tx.modelProvider.findUnique({ where: { id: row.providerId } });
        if (row.generation !== operation.generation || !["pending", "cleanup_pending"].includes(row.state)
            || provider?.pendingOperationId !== row.id) conflict();
        return row;
    }

    private operation(row: {
        id: string; providerId: string; generation: number; state: string; phase: string;
        newSecretRef: string | null; oldSecretRef: string | null; resourceVersion: number | null; errorCode: string | null;
    }): ProviderCredentialOperation {
        if (!["pending", "completed", "failed", "cleanup_pending"].includes(row.state)
            || !["registered", "published"].includes(row.phase)) conflict();
        return { ...row, state: row.state as ProviderCredentialOperation["state"],
            phase: row.phase as ProviderCredentialOperation["phase"] };
    }
}
