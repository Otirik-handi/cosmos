import { describe, expect, it, vi } from "vitest";

import { ModelProviderCredentials } from "./model-provider-credentials.js";

const operation = {
    id: "11111111-1111-4111-8111-111111111111", providerId: "provider", generation: 1,
    state: "pending" as const, phase: "registered" as const,
    newSecretRef: "synthetic:new", oldSecretRef: null, resourceVersion: null,
};

function setup() {
    const repository = {
        findByKey: vi.fn().mockResolvedValue(null),
        register: vi.fn().mockResolvedValue({ ...operation }),
        publish: vi.fn().mockResolvedValue({ ...operation, phase: "published", resourceVersion: 1 }),
        finish: vi.fn().mockResolvedValue({ ...operation, state: "completed", resourceVersion: 1 }),
        fail: vi.fn().mockResolvedValue({ ...operation, state: "failed" }),
        cleanupPending: vi.fn().mockResolvedValue({ ...operation, state: "cleanup_pending" }),
        recover: vi.fn(),
        canDelete: vi.fn().mockResolvedValue(true),
    };
    const secrets = {
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
        read: vi.fn(() => { throw new Error("Credential coordinator must never read secrets."); }),
    };
    const lock = vi.fn(async <T>(_id: string, use: () => Promise<T>): Promise<T> => use());
    const service = new ModelProviderCredentials({ repository, secrets,
        lock: async <T>(id: string, use: () => Promise<T>): Promise<T> => {
            let result!: T;
            await lock(id, async () => { result = await use(); });
            return result;
        }, operationId: () => operation.id });
    const input = {
        idempotencyKey: "synthetic-request", providerId: "provider",
        command: { name: "Synthetic", api: "openai-completions" as const,
            baseUrl: "https://example.invalid/v1", apiKey: "synthetic-only" },
    };
    return { service, repository, secrets, lock, input };
}

describe("Provider credential coordination", () => {
    it("preserves not_found when retry cannot locate an operation", async () => {
        const { service, repository, secrets } = setup();
        repository.recover.mockRejectedValue(Object.assign(new Error("private"), { code: "not_found" }));
        await expect(service.retry(operation.id)).rejects.toMatchObject({ code: "not_found" });
        expect(secrets.delete).not.toHaveBeenCalled();
    });
    it.each(["version_conflict", "operation_in_progress"])("compensates before returning a known publication %s", async (code) => {
        const { service, repository, secrets, input } = setup();
        repository.publish.mockRejectedValue(Object.assign(new Error("private"), { code }));
        repository.recover.mockResolvedValue({ ...operation, errorCode: code });
        repository.fail.mockImplementation(async (value) => ({ ...value, state: "failed" }));
        const saved = await service.save(input);
        expect(saved).toMatchObject({ state: "failed", errorCode: code });
        expect(secrets.delete).toHaveBeenCalledWith(operation.newSecretRef);
        expect(repository.recover).toHaveBeenCalledExactlyOnceWith(operation.id, code);
        expect(repository.fail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: operation.id, errorCode: code }));
        repository.findByKey.mockResolvedValue({ ...operation, ...saved });
        repository.recover.mockResolvedValue({ ...operation, ...saved });
        expect(await service.save(input)).toMatchObject({ ...saved, replayed: true });
        expect(await service.retry(operation.id)).toEqual(saved);
        expect(secrets.put).toHaveBeenCalledOnce();
        expect(secrets.delete).toHaveBeenCalledOnce();
    });
    it("prioritizes cleanup_pending over a known publication conflict", async () => {
        const { service, repository, secrets, input } = setup();
        repository.publish.mockRejectedValue(Object.assign(new Error("private"), { code: "version_conflict" }));
        repository.recover.mockResolvedValue(operation);
        secrets.delete.mockRejectedValue(new Error("private"));
        expect(await service.save(input)).toMatchObject({ state: "cleanup_pending" });
    });
    it.each(["initial", "locked", "register"])("marks a reused receipt at the %s window without writing", async (window) => {
        const { service, repository, secrets, input } = setup();
        const winner = { ...operation, id: "another-execution", state: "completed", phase: "published", resourceVersion: 1 };
        if (window === "initial") repository.findByKey.mockResolvedValue(winner);
        if (window === "locked") repository.findByKey.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
        if (window === "register") repository.register.mockResolvedValue(winner);
        expect(await service.save(input)).toMatchObject({ id: winner.id, replayed: true });
        expect(secrets.put).not.toHaveBeenCalled();
        expect(repository.publish).not.toHaveBeenCalled();
    });
    it("holds the operation lock across registration, put, publication and completion", async () => {
        const { service, repository, secrets, lock, input } = setup();
        const result = await service.save(input);
        expect(lock).toHaveBeenCalledOnce();
        expect(secrets.put).toHaveBeenCalledWith(operation.newSecretRef, "synthetic-only");
        expect(repository.register.mock.invocationCallOrder[0]).toBeLessThan(secrets.put.mock.invocationCallOrder[0]!);
        expect(secrets.put.mock.invocationCallOrder[0]).toBeLessThan(repository.publish.mock.invocationCallOrder[0]!);
        expect(result).toEqual({ id: operation.id, providerId: "provider", state: "completed", resourceVersion: 1 });
        expect(JSON.stringify(repository.register.mock.calls)).not.toContain("synthetic-only");
        expect(secrets.read).not.toHaveBeenCalled();
    });

    it("does not expose repository error details", async () => {
        const { service, repository, input } = setup();
        repository.findByKey.mockRejectedValue(new Error("synthetic-only private database detail"));
        await expect(service.save(input)).rejects.toThrow("Model provider credential operation failed.");
    });

    it("contains hostile error code accessors", async () => {
        const { service, repository, input } = setup();
        repository.findByKey.mockRejectedValue({ get code() { throw new Error("synthetic-private-detail"); } });
        await expect(service.save(input)).rejects.toMatchObject({ code: "dependency_unavailable", message: "Model provider credential operation failed." });
    });

    it("reads an error code once and contains Proxy traps", async () => {
        const { service, repository, input } = setup();
        let reads = 0;
        repository.findByKey.mockRejectedValue({ get code() { return ++reads === 1 ? "version_conflict" : "private-detail"; } });
        await expect(service.save(input)).rejects.toMatchObject({ code: "version_conflict" });
        expect(reads).toBe(1);
        repository.findByKey.mockRejectedValue(new Proxy({}, { has() { throw new Error("private-detail"); } }));
        await expect(service.save(input)).rejects.toMatchObject({ code: "dependency_unavailable" });
    });

    it.each(["version_conflict", "operation_in_progress"])("preserves the safe %s code", async (code) => {
        const { service, repository, input } = setup();
        repository.register.mockRejectedValue(Object.assign(new Error("private detail"), { code }));
        await expect(service.save(input)).rejects.toMatchObject({ code, message: "Model provider credential operation failed." });
    });

    it("returns an existing receipt without replaying or reading the submitted credential", async () => {
        const { service, repository, secrets, input } = setup();
        repository.findByKey.mockResolvedValue({ ...operation, state: "completed", resourceVersion: 1 });
        await service.save(input);
        expect(repository.register).not.toHaveBeenCalled();
        expect(secrets.put).not.toHaveBeenCalled();
        expect(secrets.read).not.toHaveBeenCalled();
    });

    it("compensates a partially failed put using only its registered new reference", async () => {
        const { service, repository, secrets, input } = setup();
        secrets.put.mockRejectedValue(new Error("synthetic-only upstream detail"));
        const result = await service.save(input);
        expect(secrets.delete).toHaveBeenCalledExactlyOnceWith(operation.newSecretRef);
        expect(repository.publish).not.toHaveBeenCalled();
        expect(repository.fail).toHaveBeenCalledOnce();
        expect(result.state).toBe("failed");
        expect(JSON.stringify(result)).not.toContain("synthetic-only");
    });

    it("preserves the credential when an update explicitly contains undefined apiKey", async () => {
        const { service, repository, secrets } = setup();
        await service.save({ idempotencyKey: "rename", providerId: "provider",
            command: { expectedVersion: 1, name: "Renamed", apiKey: undefined } });
        expect(repository.register.mock.calls[0]?.[0].replaceCredential).toBe(false);
        expect(secrets.put).not.toHaveBeenCalled();
    });

    it.each(["undefined", "throw"])("compensates a registered replacement when its key getter returns %s", async (mode) => {
        const { service, repository, secrets, input } = setup();
        Object.defineProperty(input.command, "apiKey", { get: () => {
            if (mode === "throw") throw new Error("synthetic-only");
            return undefined;
        } });
        const result = await service.save(input);
        expect(result.state).toBe("failed");
        expect(repository.publish).not.toHaveBeenCalled();
        expect(secrets.delete).toHaveBeenCalledWith(operation.newSecretRef);
        expect(JSON.stringify(result)).not.toContain("synthetic-only");
    });

    it("rejects a stale registration before accessing the submitted key", async () => {
        const { service, repository, input } = setup();
        repository.register.mockRejectedValue(new Error("Model provider operation conflict."));
        const key = vi.fn(() => "synthetic-only");
        Object.defineProperty(input.command, "apiKey", { get: key });
        await expect(service.save(input)).rejects.toThrow("Model provider credential operation failed.");
        expect(key).not.toHaveBeenCalled();
    });

    it("does not release its lock while the credential write is unsettled", async () => {
        const { service, secrets, lock, input } = setup();
        let resolveWrite: () => void = () => {};
        const pending = new Promise<void>((resolve) => { resolveWrite = resolve; });
        secrets.put.mockImplementation(() => pending);
        let held = false;
        lock.mockImplementation(async <T>(_id: string, use: () => Promise<T>): Promise<T> => {
            held = true;
            try { return await use(); } finally { held = false; }
        });
        const result = service.save(input);
        await vi.waitFor(() => expect(secrets.put).toHaveBeenCalledOnce());
        expect(held).toBe(true);
        resolveWrite();
        await result;
        expect(held).toBe(false);
    });

    it("does not delete a newly active reference when publication returned an unknown result", async () => {
        const { service, repository, secrets, input } = setup();
        repository.publish.mockRejectedValue(new Error("unknown commit"));
        repository.recover.mockResolvedValue({ ...operation, phase: "published", resourceVersion: 1 });
        expect((await service.save(input)).state).toBe("completed");
        expect(repository.recover).toHaveBeenCalledWith(operation.id);
        expect(secrets.delete).not.toHaveBeenCalled();
    });

    it("does not write when registration returns the idempotency winner", async () => {
        const { service, repository, secrets, input } = setup();
        repository.register.mockResolvedValue({ ...operation, id: "another-execution" });
        await service.save(input);
        expect(secrets.put).not.toHaveBeenCalled();
        expect(repository.publish).not.toHaveBeenCalled();
    });

    it("retains cleanup_pending when compensation fails instead of releasing the provider", async () => {
        const { service, repository, secrets, input } = setup();
        secrets.put.mockRejectedValue(new Error("synthetic-only"));
        secrets.delete.mockRejectedValue(new Error("synthetic-only"));
        const result = await service.save(input);
        expect(repository.cleanupPending).toHaveBeenCalledOnce();
        expect(repository.finish).not.toHaveBeenCalled();
        expect(repository.fail).not.toHaveBeenCalled();
        expect(result.state).toBe("cleanup_pending");
        expect(JSON.stringify(result)).not.toContain("synthetic-only");
    });
});
