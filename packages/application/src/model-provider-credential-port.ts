import type { CreateModelProviderCommand, UpdateModelProviderCommand } from "@cosmos/contracts";

export type ProviderCredentialFields = Omit<CreateModelProviderCommand, "apiKey">
    | Omit<UpdateModelProviderCommand, "apiKey">;
export type ProviderCredentialState = "pending" | "completed" | "failed" | "cleanup_pending";
export interface ProviderCredentialOperation {
    id: string;
    providerId: string;
    generation: number;
    state: ProviderCredentialState;
    phase: "registered" | "published";
    newSecretRef: string | null;
    oldSecretRef: string | null;
    resourceVersion: number | null;
    errorCode?: string | null;
}
export interface ProviderCredentialReceipt {
    id: string;
    providerId: string;
    state: ProviderCredentialState;
    resourceVersion: number | null;
    errorCode?: string;
    /** Internal execution result; public operation snapshots must omit this marker. */
    replayed?: true;
}

/** All mutations must fence generation and Provider ownership in one transaction. */
export interface ProviderCredentialRepository {
    findByKey(key: string): Promise<ProviderCredentialOperation | null>;
    register(input: {
        id: string; idempotencyKey: string; providerId: string;
        fields: ProviderCredentialFields; replaceCredential: boolean;
    }): Promise<ProviderCredentialOperation>;
    publish(operation: ProviderCredentialOperation, fields: ProviderCredentialFields): Promise<ProviderCredentialOperation>;
    recover(id: string, publicationConflict?: "version_conflict" | "operation_in_progress"): Promise<ProviderCredentialOperation>;
    canDelete(operation: ProviderCredentialOperation, ref: string): Promise<boolean>;
    finish(operation: ProviderCredentialOperation): Promise<ProviderCredentialOperation>;
    fail(operation: ProviderCredentialOperation): Promise<ProviderCredentialOperation>;
    cleanupPending(operation: ProviderCredentialOperation): Promise<ProviderCredentialOperation>;
}
