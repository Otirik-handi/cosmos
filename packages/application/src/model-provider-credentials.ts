import type { CreateModelProviderCommand, UpdateModelProviderCommand } from "@cosmos/contracts";

import type {
    ProviderCredentialOperation, ProviderCredentialReceipt, ProviderCredentialRepository,
} from "./model-provider-credential-port.js";
import type { SecretStorePort } from "./secret-store.js";

function receipt(operation: ProviderCredentialOperation): ProviderCredentialReceipt {
    return {
        id: operation.id, providerId: operation.providerId, state: operation.state,
        resourceVersion: operation.resourceVersion,
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
    };
}

function safeFailure(error: unknown): Error {
    let code = "dependency_unavailable";
    try {
        const candidate: unknown = typeof error === "object" && error !== null && "code" in error
            ? error.code : undefined;
        if (candidate === "version_conflict" || candidate === "operation_in_progress" || candidate === "not_found") code = candidate;
    } catch {
        // Dependency errors may themselves have throwing accessors or Proxy traps.
    }
    return Object.assign(new Error("Model provider credential operation failed."), { code });
}

export class ModelProviderCredentials {
    constructor(private readonly dependencies: {
        repository: ProviderCredentialRepository;
        secrets: Pick<SecretStorePort, "put" | "delete">;
        lock: <T>(id: string, use: () => Promise<T>) => Promise<T>;
        operationId: () => string;
    }) {}

    async save(input: {
        idempotencyKey: string; providerId: string;
        command: CreateModelProviderCommand | UpdateModelProviderCommand;
    }): Promise<ProviderCredentialReceipt> {
        try {
            return await this.saveInternal(input);
        } catch (error) {
            throw safeFailure(error);
        }
    }

    private async saveInternal(input: {
        idempotencyKey: string; providerId: string;
        command: CreateModelProviderCommand | UpdateModelProviderCommand;
    }): Promise<ProviderCredentialReceipt> {
        const { repository, lock, secrets } = this.dependencies;
        const existing = await repository.findByKey(input.idempotencyKey);
        if (existing) return { ...receipt(existing), replayed: true };
        const id = this.dependencies.operationId();
        return lock(id, async () => {
            // A competing request may have registered the same key before this lock.
            const duplicate = await repository.findByKey(input.idempotencyKey);
            if (duplicate) return { ...receipt(duplicate), replayed: true };
            const command = input.command;
            const fields = {
                ...(command.name !== undefined ? { name: command.name } : {}),
                ...(command.api !== undefined ? { api: command.api } : {}),
                ...(command.baseUrl !== undefined ? { baseUrl: command.baseUrl } : {}),
                ...("expectedVersion" in command ? { expectedVersion: command.expectedVersion } : {
                    name: command.name, api: command.api, baseUrl: command.baseUrl,
                }),
            };
            let operation = await repository.register({
                id, idempotencyKey: input.idempotencyKey, providerId: input.providerId,
                fields, replaceCredential: (() => {
                    const descriptor = Object.getOwnPropertyDescriptor(command, "apiKey");
                    return descriptor !== undefined && (descriptor.get !== undefined || descriptor.value !== undefined);
                })(),
            });
            // An idempotency loser must not write under another execution's lock.
            if (operation.id !== id) return { ...receipt(operation), replayed: true };
            if (operation.newSecretRef) {
                try {
                    const apiKey = command.apiKey;
                    if (typeof apiKey !== "string" || apiKey.length === 0) {
                        throw new Error("A replacement credential is required.");
                    }
                    await secrets.put(operation.newSecretRef, apiKey);
                } catch {
                    return receipt(await this.cleanup(operation));
                }
            }
            try {
                operation = await repository.publish(operation, fields);
            } catch (error) {
                const code = (safeFailure(error) as Error & { code: string }).code;
                const publicationConflict = code === "version_conflict" || code === "operation_in_progress" ? code : undefined;
                // A commit may have succeeded despite an unknown return value.
                // Recovery fences and reads committed state before choosing a ref.
                operation = publicationConflict ? await repository.recover(id, publicationConflict) : await repository.recover(id);
            }
            return receipt(await this.cleanup(operation));
        });
    }

    async retry(id: string): Promise<ProviderCredentialReceipt> {
        try {
            return await this.dependencies.lock(id, async () => {
                const operation = await this.dependencies.repository.recover(id);
                if (operation.state === "completed" || operation.state === "failed") return receipt(operation);
                return receipt(await this.cleanup(operation));
            });
        } catch (error) {
            throw safeFailure(error);
        }
    }

    private async cleanup(operation: ProviderCredentialOperation): Promise<ProviderCredentialOperation> {
        const { repository, secrets } = this.dependencies;
        const ref = operation.phase === "published" ? operation.oldSecretRef : operation.newSecretRef;
        if (ref) {
            try {
                if (!await repository.canDelete(operation, ref)) throw new Error("Reference is still active.");
                await secrets.delete(ref);
            } catch {
                return repository.cleanupPending(operation);
            }
        }
        return operation.phase === "published" ? repository.finish(operation) : repository.fail(operation);
    }
}
