import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { expect, it } from "vitest";
import { ModelProviderWriteController } from "./model-provider-write.controller.js";
import { ModelProviderCredentials } from "../../../packages/application/src/model-provider-credentials.js";
import type { ProviderCredentialOperation, ProviderCredentialRepository } from "../../../packages/application/src/model-provider-credential-port.js";

it("reads bounded raw JSON before dispatch and never returns the submitted credential", async () => {
    const calls: unknown[] = [];
    let replay = false;
    let readbackFails = false;
    const receipt = { id: "operation", providerId: "provider", state: "completed", resourceVersion: 1 };
    const provider = { id: "provider", name: "Synthetic", api: "openai-completions", baseUrl: "https://example.com/v1", version: 1, state: "active", credentialState: "configured", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" };
    const trust = { origins: ["http://localhost:4300"], authorities: [] as string[] };
    @Module({ controllers: [ModelProviderWriteController], providers: [
        { provide: "COSMOS_MODEL_CONFIGURATION_TRUST", useValue: trust },
        { provide: "COSMOS_MODEL_PROVIDER_CREDENTIALS", useValue: {
            async save(input: unknown) {
                calls.push(input);
                const command = (input as { command: { name?: string } }).command;
                if (command.name === "Fail") throw new Error("SYNTHETIC_PRIVATE_KEY");
                if (command.name === "Conflict") return { ...receipt, state: "failed", errorCode: "version_conflict" };
                if (command.name === "Race") return { ...receipt, replayed: true };
                if (command.name === "Pending") return { ...receipt, state: "pending" };
                if (command.name === "CleanupPublished") return { ...receipt, state: "cleanup_pending", resourceVersion: 2 };
                if (command.name === "CleanupUnpublished") return { ...receipt, state: "cleanup_pending", resourceVersion: null };
                return receipt;
            },
            async retry(id: string) { if (id === "missing") throw Object.assign(new Error("SYNTHETIC_PRIVATE_KEY"), { code: "not_found" }); calls.push(id); return receipt; },
        } },
        { provide: "COSMOS_MODEL_PROVIDER_QUERY", useValue: {
            async get() { if (readbackFails) throw new Error("SYNTHETIC_PRIVATE_KEY"); return provider; },
            async operation() { return { ...receipt, kind: "create" }; },
            async operationByKey() {
                if (replay) return { ...receipt, kind: "create" };
                throw Object.assign(new Error("Not found."), { code: "not_found" });
            },
        } },
        // 删除路由与读写在同一个控制器里：不注入这个端口，模块装配就会失败。
        { provide: "COSMOS_MODEL_PROVIDER_REMOVALS", useValue: { async remove() { throw new Error("SYNTHETIC_PRIVATE_KEY"); } } },
    ] })
    class TestModule {}
    const app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
    try {
        app.setGlobalPrefix("api/v1");
        await app.listen(0, "127.0.0.1");
        const base = await app.getUrl();
        trust.authorities.push(new URL(base).host);
        const send = async (path: string, body: unknown, method = "POST", origin = "http://localhost:4300") => {
            const response = await fetch(`${base}/api/v1/${path}`, { method, headers: {
                Origin: origin, "Content-Type": "application/json", "Idempotency-Key": "request-1",
            }, body: JSON.stringify(body) });
            expect(response.headers.get("cache-control")).toBe("no-store");
            const text = await response.text();
            expect(text).not.toContain("SYNTHETIC_PRIVATE_KEY");
            return { status: response.status, body: JSON.parse(text), operation: response.headers.get("x-cosmos-operation-id") };
        };
        const command = { name: "Synthetic", api: "openai-completions", baseUrl: "https://example.com/v1", apiKey: "SYNTHETIC_PRIVATE_KEY" };
        expect(await send("model-providers", command)).toMatchObject({ status: 201, body: provider, operation: "operation" });
        expect(await send("model-providers/provider", { expectedVersion: 1, name: "Updated" }, "PATCH")).toMatchObject({ status: 200, body: provider });
        expect(await send("model-configuration-operations/operation/retries", {})).toMatchObject({ status: 202, body: { id: "operation", kind: "create" } });
        expect(await send("model-configuration-operations/missing/retries", {})).toMatchObject({ status: 404, body: { code: "not_found", retryable: false } });
        expect(calls).toHaveLength(3);
        expect(await send("model-providers", command, "POST", "http://evil.example")).toMatchObject({ status: 403, body: { code: "forbidden_origin" } });
        expect(await send("model-providers", { ...command, secretRef: "forbidden" })).toMatchObject({ status: 400, body: { code: "invalid_input" } });
        expect(await send("model-providers", { ...command, name: "a".repeat(33000) })).toMatchObject({ status: 413 });
        expect(calls).toHaveLength(3);
        expect(await send("model-providers", { ...command, name: "Fail" })).toMatchObject({ status: 503, body: { code: "dependency_unavailable" } });
        expect(await send("model-providers", { ...command, name: "Pending" })).toMatchObject({ status: 202, body: { id: "operation" } });
        expect(await send("model-providers", { ...command, name: "CleanupPublished" })).toMatchObject({ status: 503, body: { code: "cleanup_pending", resourceVersion: 2, message: "Configuration saved; local credential cleanup is pending." } });
        expect(await send("model-providers", { ...command, name: "CleanupUnpublished" })).toMatchObject({ status: 503, body: { code: "cleanup_pending", resourceVersion: null, message: "Configuration was not published; local credential cleanup is pending." } });
        expect(await send("model-providers", { ...command, name: "Conflict" })).toMatchObject({ status: 409, body: { code: "version_conflict", operationId: "operation" } });
        const raced = await send("model-providers", { ...command, name: "Race" });
        expect(raced).toMatchObject({ status: 202, body: { id: "operation", kind: "create", state: "completed" } });
        expect(raced.body).not.toHaveProperty("replayed");
        readbackFails = true;
        expect(await send("model-providers", command)).toMatchObject({ status: 503, operation: "operation", body: { code: "dependency_unavailable", operationId: "operation" } });
        readbackFails = false;
        const beforeReplay = calls.length;
        replay = true;
        expect(await send("model-providers", {})).toMatchObject({ status: 202, body: { id: "operation", kind: "create", state: "completed" } });
        expect(calls).toHaveLength(beforeReplay);
    } finally { await app.close(); }
});

it("runs real credential coordination through HTTP and resumes cleanup without rewriting the key", async () => {
    let operation: ProviderCredentialOperation | null = null;
    let cleanupFails = true;
    let releaseWrite!: () => void;
    let signalWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => { signalWrite = resolve; });
    const pendingWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let puts = 0;
    let deletes = 0;
    const repository: ProviderCredentialRepository = {
        async findByKey() { return operation; },
        async register(input) {
            operation = { id: input.id, providerId: input.providerId, generation: 1, state: "pending", phase: "registered", newSecretRef: "synthetic-new", oldSecretRef: "synthetic-old", resourceVersion: null };
            expect(JSON.stringify(input)).not.toContain("SYNTHETIC_PRIVATE_KEY");
            return operation;
        },
        async publish(current) { operation = { ...current, phase: "published", resourceVersion: 2 }; return operation; },
        async recover() { if (!operation) throw new Error("Missing synthetic receipt."); operation = { ...operation, generation: operation.generation + 1 }; return operation; },
        async canDelete(_current, ref) { expect(ref).toBe("synthetic-old"); return true; },
        async finish(current) { operation = { ...current, state: "completed" }; return operation; },
        async fail(current) { operation = { ...current, state: "failed" }; return operation; },
        async cleanupPending(current) { operation = { ...current, state: "cleanup_pending", errorCode: "cleanup_pending" }; return operation; },
    };
    const service = new ModelProviderCredentials({ repository, operationId: () => "11111111-1111-4111-8111-111111111111",
        lock: async (_id, use) => use(), secrets: {
            async put(_ref, value) { expect(value).toBe("SYNTHETIC_PRIVATE_KEY"); puts++; signalWrite(); await pendingWrite; },
            async delete() { deletes++; if (cleanupFails) throw new Error("SYNTHETIC_PRIVATE_KEY"); return true; },
        } });
    const snapshot = () => {
        if (!operation) throw Object.assign(new Error("Missing receipt."), { code: "not_found" });
        return { id: operation.id, providerId: operation.providerId, kind: "update", state: operation.state, resourceVersion: operation.resourceVersion };
    };
    const trust = { origins: ["http://localhost:4300"], authorities: [] as string[] };
    @Module({ controllers: [ModelProviderWriteController], providers: [
        { provide: "COSMOS_MODEL_CONFIGURATION_TRUST", useValue: trust },
        { provide: "COSMOS_MODEL_PROVIDER_CREDENTIALS", useValue: service },
        { provide: "COSMOS_MODEL_PROVIDER_QUERY", useValue: { operation: async () => snapshot(), operationByKey: async () => snapshot() } },
        { provide: "COSMOS_MODEL_PROVIDER_REMOVALS", useValue: { async remove() { throw new Error("SYNTHETIC_PRIVATE_KEY"); } } },
    ] })
    class TestModule {}
    const app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
    try {
        app.setGlobalPrefix("api/v1");
        await app.listen(0, "127.0.0.1");
        const base = await app.getUrl();
        trust.authorities.push(new URL(base).host);
        const send = async (path: string, body: unknown, method: string) => {
            const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { Origin: trust.origins[0]!, "Content-Type": "application/json", "Idempotency-Key": "synthetic-request" }, body: JSON.stringify(body) });
            const text = await response.text();
            expect(text).not.toMatch(/SYNTHETIC_PRIVATE_KEY|synthetic-new|synthetic-old/);
            expect(response.headers.get("cache-control")).toBe("no-store");
            return { status: response.status, body: JSON.parse(text) };
        };
        const first = send("model-providers/provider", { expectedVersion: 1, apiKey: "SYNTHETIC_PRIVATE_KEY" }, "PATCH");
        await writeStarted;
        try {
            expect(await send("model-providers/provider", {}, "PATCH")).toMatchObject({ status: 202, body: { state: "pending", resourceVersion: null } });
            expect(puts).toBe(1);
            expect(deletes).toBe(0);
        } finally { releaseWrite(); }
        expect(await first).toMatchObject({ status: 503, body: { code: "cleanup_pending", resourceVersion: 2, message: "Configuration saved; local credential cleanup is pending." } });
        expect(puts).toBe(1);
        expect(deletes).toBe(1);
        cleanupFails = false;
        expect(await send("model-configuration-operations/11111111-1111-4111-8111-111111111111/retries", {}, "POST")).toMatchObject({ status: 202, body: { state: "completed", resourceVersion: 2 } });
        expect(puts).toBe(1);
        expect(deletes).toBe(2);
        expect(await send("model-providers/provider", {}, "PATCH")).toMatchObject({ status: 202, body: { state: "completed", resourceVersion: 2 } });
        expect(puts).toBe(1);
        expect(deletes).toBe(2);
    } finally { await app.close(); }
});

it("deletes a provider through the raw-body route and reports a referenced model as a conflict", async () => {
    const removed: { id: string; expectedVersion: number }[] = [];
    const trust = { origins: ["http://localhost:4300"], authorities: [] as string[] };
    @Module({ controllers: [ModelProviderWriteController], providers: [
        { provide: "COSMOS_MODEL_CONFIGURATION_TRUST", useValue: trust },
        { provide: "COSMOS_MODEL_PROVIDER_CREDENTIALS", useValue: { async save() { throw new Error("删除不该触发凭证写入。"); } } },
        { provide: "COSMOS_MODEL_PROVIDER_QUERY", useValue: { async operation() { throw new Error("missing"); } } },
        { provide: "COSMOS_MODEL_PROVIDER_REMOVALS", useValue: {
            async remove(id: string, expectedVersion: number) {
                if (id === "referenced") throw Object.assign(new Error("in use"), { code: "in_use" });
                if (id === "racing") throw Object.assign(new Error("stale"), { code: "version_conflict" });
                removed.push({ id, expectedVersion });
            },
        } },
    ] })
    class TestModule {}
    const app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
    try {
        app.setGlobalPrefix("api/v1");
        await app.listen(0, "127.0.0.1");
        const base = await app.getUrl();
        trust.authorities.push(new URL(base).host);
        const remove = async (id: string, body: unknown, options: { origin?: string; key?: string | null } = {}) => {
            const headers: Record<string, string> = {
                Origin: options.origin ?? trust.origins[0]!,
                "Content-Type": "application/json",
            };
            if (options.key !== null) headers["Idempotency-Key"] = options.key ?? "request-1";
            const response = await fetch(`${base}/api/v1/model-providers/${id}`, {
                method: "DELETE", headers, body: JSON.stringify(body),
            });
            expect(response.headers.get("cache-control")).toBe("no-store");
            const text = await response.text();
            return { status: response.status, body: text === "" ? null : JSON.parse(text) };
        };

        // 请求体必须由配置写入口自己读：走通用 JSON 解析器会先读光，这里就会变成 invalid_input。
        expect(await remove("provider", { expectedVersion: 3 })).toMatchObject({ status: 204, body: null });
        expect(removed).toEqual([{ id: "provider", expectedVersion: 3 }]);
        expect(await remove("referenced", { expectedVersion: 1 })).toMatchObject({ status: 409, body: { code: "in_use", retryable: false } });
        expect(await remove("racing", { expectedVersion: 1 })).toMatchObject({ status: 409, body: { code: "version_conflict" } });
        expect(await remove("provider", { expectedVersion: 1 }, { origin: "http://evil.example" })).toMatchObject({ status: 403, body: { code: "forbidden_origin" } });
        expect(await remove("provider", { expectedVersion: 1 }, { key: null })).toMatchObject({ status: 400, body: { code: "invalid_input" } });
        expect(await remove("provider", { expectedVersion: "1" })).toMatchObject({ status: 400, body: { code: "invalid_input" } });
        expect(await remove("provider", { expectedVersion: 1, extra: true })).toMatchObject({ status: 400, body: { code: "invalid_input" } });
        expect(removed).toHaveLength(1);
    } finally { await app.close(); }
});
