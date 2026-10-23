import type { ModelProviderQueryRepository } from "@cosmos/application";

const providerSelect = { id: true, name: true, api: true, baseUrl: true, version: true, state: true, createdAt: true, updatedAt: true } as const;
const operationSelect = { id: true, kind: true, providerId: true, state: true, errorCode: true, resourceVersion: true } as const;
interface ProviderRow {
    id: string; name: string; api: string; baseUrl: string; version: number; state: string;
    createdAt: Date; updatedAt: Date;
}
interface OperationRow {
    id: string; kind: string; providerId: string; state: string;
    errorCode: string | null; resourceVersion: number | null;
}
interface QueryClient {
    modelProvider: { findMany(input: {
        where: { secretRef: { not: null }; id?: string | { gt: string } };
        orderBy: { id: "asc" }; take: number; select: typeof providerSelect;
    }): Promise<ProviderRow[]> };
    modelConfigurationOperation: {
        findMany(input: { where: { providerId: { in: string[] }; state: "cleanup_pending" }; select: { providerId: true } }): Promise<{ providerId: string }[]>;
        findUnique(input: { where: { id: string } | { idempotencyKey: string }; select: typeof operationSelect }): Promise<OperationRow | null>;
    };
}
export class PrismaModelProviderQueryRepository implements ModelProviderQueryRepository {
    constructor(private readonly client: QueryClient) {}

    list(input: { limit: number; cursor?: string }): Promise<unknown[]> {
        return this.providers(input.limit, input.cursor ? { gt: input.cursor } : undefined);
    }
    async get(id: string): Promise<unknown | null> {
        return (await this.providers(1, id))[0] ?? null;
    }
    operation(where: { id: string } | { idempotencyKey: string }): Promise<unknown | null> {
        return this.client.modelConfigurationOperation.findUnique({ where, select: operationSelect });
    }
    private async providers(limit: number, id?: string | { gt: string }): Promise<unknown[]> {
        // A create reservation has no published ref and must never appear as configured.
        const rows = await this.client.modelProvider.findMany({
            where: { secretRef: { not: null }, ...(id === undefined ? {} : { id }) },
            orderBy: { id: "asc" }, take: limit, select: providerSelect,
        });
        if (rows.length === 0) return [];
        const pending = await this.client.modelConfigurationOperation.findMany({
            where: { providerId: { in: rows.map((row) => row.id) }, state: "cleanup_pending" }, select: { providerId: true },
        });
        const cleanup = new Set(pending.map((row) => row.providerId));
        return rows.map((row) => ({
            id: row.id, name: row.name, api: row.api, baseUrl: row.baseUrl, version: row.version,
            state: row.state, credentialState: cleanup.has(row.id) ? "cleanup_pending" : "configured",
            createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        }));
    }
}
