import { expect, it } from "vitest";
import { ModelProviderQuery } from "./model-provider-query.js";

const provider = { id: "p", name: "Provider", api: "openai-completions", baseUrl: "https://example.com/v1", version: 1, state: "active", credentialState: "configured", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" };
function setup() {
    return new ModelProviderQuery({
        list: async () => [provider], get: async () => provider,
        operation: async () => ({ id: "o", kind: "create", providerId: "p", state: "completed", resourceVersion: 1 }),
    });
}
it("returns safe Provider and operation snapshots through every query", async () => {
    const query = setup();
    expect(await query.list()).toEqual({ items: [provider], nextCursor: null });
    expect(await query.get("p")).toEqual(provider);
    expect(await query.operation("o")).toEqual(await query.operationByKey("key"));
});
it.each(["version_conflict", "operation_in_progress"])("returns a persisted %s receipt by ID and idempotency key", async (errorCode) => {
    const row = { id: "o", kind: "update", providerId: "p", state: "failed", resourceVersion: null, errorCode };
    const query = new ModelProviderQuery({ list: async () => [], get: async () => null, operation: async () => row });
    expect(await query.operation("o")).toEqual(row);
    expect(await query.operationByKey("key")).toEqual(row);
});
it("rejects invalid pagination and identifiers before calling dependencies", async () => {
    const query = setup();
    for (const limit of [0, 101, 1.5]) await expect(query.list({ limit })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(query.get("")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(query.operationByKey("\n")).rejects.toMatchObject({ code: "invalid_input" });
});
it("uses lookahead pagination without exposing its extra row", async () => {
    const query = new ModelProviderQuery({ list: async () => [provider, { ...provider, id: "q" }], get: async () => null, operation: async () => null });
    expect(await query.list({ limit: 1 })).toEqual({ items: [provider], nextCursor: "p" });
    await expect(query.get("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(query.operation("missing")).rejects.toMatchObject({ code: "not_found" });
});
it("suppresses dependency values and rejects extra secret fields or unknown receipt codes", async () => {
    const query = new ModelProviderQuery({ list: async () => { throw new Error("SYNTHETIC_PRIVATE"); }, get: async () => ({ ...provider, secretRef: "SYNTHETIC_PRIVATE" }), operation: async () => ({ id: "o", kind: "create", providerId: "p", state: "failed", resourceVersion: null, errorCode: "SYNTHETIC_PRIVATE" }) });
    for (const use of [() => query.list(), () => query.get("p"), () => query.operation("o")]) {
        await expect(use()).rejects.toMatchObject({ code: "dependency_unavailable", message: "Model configuration query failed." });
    }
});
