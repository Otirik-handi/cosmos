import {
    createProviderModelDiscoveryCommandSchema,
    type CreateProviderModelDiscoveryCommand,
    type ProviderModelDiscoveryErrorCode,
    type ProviderModelDiscoverySnapshot,
} from "@cosmos/contracts";

import { parseProviderModelCatalog } from "./provider-model-catalog.js";
import {
    ProviderModelDirectoryError,
    type ProviderModelDirectoryPort,
} from "./provider-model-directory.js";
import type { SecretStorePort } from "./secret-store.js";

export class ProviderDiscoveryConflictError extends Error {
    readonly code = "conflict" as const;

    constructor(message: string) {
        super(message);
        this.name = "ProviderDiscoveryConflictError";
    }
}

export class ProviderDiscoveryNotFoundError extends Error {
    readonly code = "not_found" as const;

    constructor(message: string) {
        super(message);
        this.name = "ProviderDiscoveryNotFoundError";
    }
}

/**
 * Provider 存在但当前不能发现（没有凭证，或凭证字节已失效）。
 * 与“请求失败”分开，因为它发生在发出任何字节之前。
 */
export class ProviderModelDiscoveryUnavailableError extends Error {
    readonly code = "unavailable" as const;

    constructor(message: string) {
        super(message);
        this.name = "ProviderModelDiscoveryUnavailableError";
    }
}

/**
 * 发现只读这三个字段：地址用来拼 `/models`，版本用来做乐观校验，ID 用来回写快照。
 * 不用完整 Provider 快照，是因为发现不关心凭证状态与清理中状态。
 */
export interface ProviderDiscoveryTarget {
    id: string;
    baseUrl: string;
    version: number;
}

/** 发现执行只读 Provider 目标与它的不透明 SecretRef；凭证字节只能通过 SecretStore 读取。 */
export interface ProviderDiscoveryReader {
    findProvider(providerId: string): Promise<ProviderDiscoveryTarget | null>;
    /** 返回挂在该 Provider 上的不透明 SecretRef；没有配置凭证时返回 null。 */
    findSecretRef(providerId: string): Promise<string | null>;
}

export interface ProviderDiscoveryIdGenerator {
    nextId(prefix: string): string;
}

export interface ProviderDiscoveryClock {
    now(): Date;
}

export interface ProviderModelDiscoveryOptions {
    reader: ProviderDiscoveryReader;
    secrets: Pick<SecretStorePort, "read">;
    directory: ProviderModelDirectoryPort;
    ids: ProviderDiscoveryIdGenerator;
    clock: ProviderDiscoveryClock;
}

const statusErrorCodes: Record<number, ProviderModelDiscoveryErrorCode> = {
    401: "authentication_failed",
    403: "authentication_failed",
    404: "unsupported",
    408: "timeout",
    429: "dependency_unavailable",
};

function errorCodeForStatus(status: number): ProviderModelDiscoveryErrorCode {
    if (statusErrorCodes[status]) return statusErrorCodes[status];
    return status >= 500 ? "dependency_unavailable" : "malformed_response";
}

function modelsUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/models`;
}

/**
 * 同步执行一次受控的 `GET <baseUrl>/models`。
 *
 * 这是只读请求，重复发送没有副作用，因此不引入队列、幂等键或“结果未知”恢复：
 * 每次调用要么返回候选，要么返回固定失败码，用户直接重试即可。
 * 凭证只在此处从 SecretStore 读出并立刻交给 transport，不进入返回值或错误信息。
 */
export class ProviderModelDiscoveryRunner {
    constructor(private readonly options: ProviderModelDiscoveryOptions) {}

    async discover(input: CreateProviderModelDiscoveryCommand): Promise<ProviderModelDiscoverySnapshot> {
        const command = createProviderModelDiscoveryCommandSchema.parse(input);
        const provider = await this.options.reader.findProvider(command.providerId);
        if (!provider) {
            throw new ProviderDiscoveryNotFoundError(`Provider not found: ${command.providerId}`);
        }
        if (provider.version !== command.expectedProviderVersion) {
            throw new ProviderDiscoveryConflictError(
                `Provider ${command.providerId} changed before discovery ran.`,
            );
        }

        const secretRef = await this.options.reader.findSecretRef(command.providerId);
        const credential = secretRef === null ? null : await this.options.secrets.read(secretRef);
        if (credential === null) {
            throw new ProviderModelDiscoveryUnavailableError(
                `Provider ${command.providerId} has no stored credential.`,
            );
        }

        const createdAt = this.options.clock.now().toISOString();
        const snapshot = (
            status: "succeeded" | "failed",
            candidates: ProviderModelDiscoverySnapshot["candidates"],
            errorCode: ProviderModelDiscoveryErrorCode | null,
        ): ProviderModelDiscoverySnapshot => ({
            id: this.options.ids.nextId("provider-discovery"),
            providerId: provider.id,
            providerVersion: provider.version,
            status,
            candidates,
            errorCode,
            createdAt,
            updatedAt: createdAt,
        });

        try {
            const response = await this.options.directory.requestModels({
                url: modelsUrl(provider.baseUrl),
                bearerToken: credential,
            });
            if (response.status < 200 || response.status >= 300) {
                return snapshot("failed", [], errorCodeForStatus(response.status));
            }
            const parsed = parseProviderModelCatalog(response.body);
            return parsed.ok
                ? snapshot("succeeded", parsed.candidates, null)
                : snapshot("failed", [], parsed.errorCode);
        } catch (error) {
            if (error instanceof ProviderModelDirectoryError) {
                return snapshot("failed", [], error.code);
            }
            return snapshot("failed", [], "dependency_unavailable");
        }
    }
}
