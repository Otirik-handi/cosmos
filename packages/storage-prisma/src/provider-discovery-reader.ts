import type { ProviderDiscoveryReader, ProviderDiscoveryTarget } from "@cosmos/application";

const discoverySelect = {
    id: true, baseUrl: true, version: true, secretRef: true,
} as const;

interface DiscoveryRow {
    id: string; baseUrl: string; version: number; secretRef: string | null;
}

interface DiscoveryClient {
    modelProvider: {
        findUnique(input: { where: { id: string }; select: typeof discoverySelect }): Promise<DiscoveryRow | null>;
    };
}

/**
 * 发现读取：一次查询同时取 Provider 目标与它的不透明 SecretRef。
 *
 * 凭证字节不经过仓储——只有 SecretStore 能读；这里返回的 ref 是唯一线索，
 * 且与目标来自同一行，避免版本校验读到两个不同时刻的状态。
 */
export class PrismaProviderDiscoveryReader implements ProviderDiscoveryReader {
    constructor(private readonly client: DiscoveryClient) {}

    async findProvider(providerId: string): Promise<ProviderDiscoveryTarget | null> {
        const row = await this.row(providerId);
        return row === null ? null : { id: row.id, baseUrl: row.baseUrl, version: row.version };
    }

    async findSecretRef(providerId: string): Promise<string | null> {
        return (await this.row(providerId))?.secretRef ?? null;
    }

    private row(providerId: string): Promise<DiscoveryRow | null> {
        return this.client.modelProvider.findUnique({ where: { id: providerId }, select: discoverySelect });
    }
}
