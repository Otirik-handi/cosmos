import { expect, it, vi } from "vitest";
import { PrismaModelProviderQueryRepository } from "./model-provider-query-repository.js";

type Client = ConstructorParameters<typeof PrismaModelProviderQueryRepository>[0];

it("selects only published Provider fields and derives cleanup state in one query", async () => {
    const row = { id: "p", name: "Provider", api: "openai-completions", baseUrl: "https://example.com/v1", version: 2, state: "active", createdAt: new Date("2026-10-15"), updatedAt: new Date("2026-10-15") };
    const findMany = vi.fn(async (_input: Parameters<Client["modelProvider"]["findMany"]>[0]) => [row]);
    const operations = vi.fn(async (_input: Parameters<Client["modelConfigurationOperation"]["findMany"]>[0]) => [{ providerId: "p" }]);
    const repo = new PrismaModelProviderQueryRepository({ modelProvider: { findMany }, modelConfigurationOperation: { findMany: operations, findUnique: vi.fn(async () => null) } });
    expect((await repo.list({ limit: 2 }))[0]).toMatchObject({ credentialState: "cleanup_pending", createdAt: "2026-10-15T00:00:00.000Z" });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { secretRef: { not: null } }, take: 2, orderBy: { id: "asc" } });
    expect(JSON.stringify(findMany.mock.calls[0])).not.toContain('"secretRef":true');
    expect(operations.mock.calls[0]?.[0]).toMatchObject({ where: { providerId: { in: ["p"] }, state: "cleanup_pending" } });
    expect(await repo.get("p")).toMatchObject({ id: "p" });
});
it("never looks up receipts for hidden or absent Providers", async () => {
    const operations = vi.fn();
    const repo = new PrismaModelProviderQueryRepository({ modelProvider: { findMany: vi.fn(async () => []) }, modelConfigurationOperation: { findMany: operations, findUnique: vi.fn(async () => null) } });
    expect(await repo.get("unpublished")).toBeNull();
    expect(operations).not.toHaveBeenCalled();
});
it("looks up operation receipts by exact ID or key using a secret-free select", async () => {
    const findUnique = vi.fn(async (_input: Parameters<Client["modelConfigurationOperation"]["findUnique"]>[0]) => ({ id: "o", kind: "update", providerId: "p", state: "completed", resourceVersion: 2, errorCode: null }));
    const repo = new PrismaModelProviderQueryRepository({ modelProvider: { findMany: vi.fn(async () => []) }, modelConfigurationOperation: { findMany: vi.fn(async () => []), findUnique } });
    expect(await repo.operation({ id: "o" })).toMatchObject({ id: "o" });
    await repo.operation({ idempotencyKey: "key" });
    expect(findUnique.mock.calls[1]?.[0]).toMatchObject({ where: { idempotencyKey: "key" }, select: { id: true, kind: true, providerId: true, state: true, errorCode: true, resourceVersion: true } });
    expect(JSON.stringify(findUnique.mock.calls)).not.toMatch(/newSecretRef|oldSecretRef|generation/);
});
