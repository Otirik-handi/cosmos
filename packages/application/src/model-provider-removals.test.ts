import { describe, expect, it, vi } from "vitest";
import { ModelProviderRemovals, type ModelProviderRemovalRepository } from "./model-provider-removals.js";

function removals(overrides: Partial<ModelProviderRemovalRepository> = {}, deleteSecret?: () => Promise<boolean>) {
    const repository: ModelProviderRemovalRepository = {
        remove: vi.fn(async () => null),
        ...overrides,
    };
    const secrets = { delete: vi.fn(deleteSecret ?? (async () => true)) };
    const onCleanupFailure = vi.fn();
    return { service: new ModelProviderRemovals({ repository, secrets, onCleanupFailure }), repository, secrets, onCleanupFailure };
}

describe("ModelProviderRemovals", () => {
    it("deletes the credential after the row is gone", async () => {
        const { service, repository, secrets } = removals({ remove: vi.fn(async () => "secret-model-provider-1") });

        await service.remove("provider-1", 3);

        expect(repository.remove).toHaveBeenCalledWith({ id: "provider-1", expectedVersion: 3 });
        expect(secrets.delete).toHaveBeenCalledWith("secret-model-provider-1");
    });

    it("says nothing about credentials when the provider had none", async () => {
        const { service, secrets } = removals();

        await service.remove("provider-1", 1);

        expect(secrets.delete).not.toHaveBeenCalled();
    });

    it("keeps the removal successful when the secret file cannot be deleted", async () => {
        const { service, onCleanupFailure } = removals(
            { remove: vi.fn(async () => "secret-model-provider-1") },
            async () => { throw new Error("EACCES"); },
        );

        await expect(service.remove("provider-1", 1)).resolves.toBeUndefined();
        expect(onCleanupFailure).toHaveBeenCalledWith({ secretRef: "secret-model-provider-1", error: expect.any(Error) });
    });

    it("keeps a reference conflict distinguishable from a retryable dependency failure", async () => {
        const { service, secrets } = removals({
            remove: vi.fn(async () => { throw Object.assign(new Error("refused"), { code: "in_use" }); }),
        });

        await expect(service.remove("provider-1", 1)).rejects.toMatchObject({ code: "in_use" });
        expect(secrets.delete).not.toHaveBeenCalled();
    });

    it("does not forward an unknown dependency code", async () => {
        const { service } = removals({
            remove: vi.fn(async () => { throw Object.assign(new Error("db down"), { code: "P1001" }); }),
        });

        await expect(service.remove("provider-1", 1)).rejects.toMatchObject({ code: "dependency_unavailable" });
    });

    it("rejects an identifier that is not a plain identifier before touching storage", async () => {
        const { service, repository } = removals();

        await expect(service.remove(" provider-1", 1)).rejects.toMatchObject({ code: "invalid_input" });
        await expect(service.remove("provider-1", 0)).rejects.toMatchObject({ code: "invalid_input" });
        expect(repository.remove).not.toHaveBeenCalled();
    });
});
