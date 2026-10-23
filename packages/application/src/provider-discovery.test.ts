import { describe, expect, it, vi } from "vitest";

import type { ModelProviderSnapshot, ProviderModelDiscoverySnapshot } from "@cosmos/contracts";
import {
    ProviderDiscoveryConflictError,
    ProviderDiscoveryNotFoundError,
    ProviderModelDiscoveryRunner,
    ProviderModelDiscoveryUnavailableError,
    type ProviderDiscoveryReader,
} from "./provider-discovery.js";
import type { ProviderModelDirectoryPort } from "./provider-model-directory.js";
import { ProviderModelDirectoryError } from "./provider-model-directory.js";

const provider: ModelProviderSnapshot = {
    id: "provider-1", name: "Provider", api: "openai-completions", baseUrl: "https://provider.example/v1",
    version: 2, state: "active", credentialState: "configured",
    createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
};

function fixture(overrides: {
    provider?: ModelProviderSnapshot | null;
    secretRef?: string | null;
    secret?: string | null;
    directory?: ProviderModelDirectoryPort;
} = {}) {
    const current = overrides.provider === undefined ? provider : overrides.provider;
    const reader: ProviderDiscoveryReader = {
        findProvider: vi.fn(async (id) => current && id === current.id ? current : null),
        findSecretRef: vi.fn(async () => overrides.secretRef === undefined ? "secret:provider-1" : overrides.secretRef),
    };
    const directory: ProviderModelDirectoryPort = overrides.directory ?? {
        requestModels: vi.fn(async () => ({ status: 200, body: { data: [{ id: "gpt-x", name: "GPT X" }] } })),
    };
    const runner = new ProviderModelDiscoveryRunner({
        reader,
        secrets: { read: vi.fn(async () => overrides.secret === undefined ? "synthetic-key" : overrides.secret) },
        directory,
        ids: { nextId: () => "discovery-1" },
        clock: { now: () => new Date("2026-10-15T00:00:00.000Z") },
    });
    return { runner, reader, directory };
}

describe("ProviderModelDiscoveryRunner", () => {
    it("reads the saved credential once and returns bounded candidates", async () => {
        const harness = fixture();
        const result = await harness.runner.discover({ providerId: provider.id, expectedProviderVersion: 2 });

        expect(result).toEqual<ProviderModelDiscoverySnapshot>({
            id: "discovery-1", providerId: provider.id, providerVersion: 2,
            status: "succeeded", candidates: [{ modelId: "gpt-x", name: "GPT X" }], errorCode: null,
            createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
        });
        expect(harness.directory.requestModels).toHaveBeenCalledExactlyOnceWith({
            url: "https://provider.example/v1/models",
            bearerToken: "synthetic-key",
        });
        expect(JSON.stringify(result)).not.toContain("synthetic-key");
    });

    it("strips a trailing slash from the saved base URL", async () => {
        const harness = fixture({ provider: { ...provider, baseUrl: "https://provider.example/v1/" } });
        await harness.runner.discover({ providerId: provider.id, expectedProviderVersion: 2 });
        expect(harness.directory.requestModels).toHaveBeenCalledWith(expect.objectContaining({
            url: "https://provider.example/v1/models",
        }));
    });

    it("rejects unknown providers and stale versions before reading any credential", async () => {
        const missing = fixture({ provider: null });
        await expect(missing.runner.discover({ providerId: "absent", expectedProviderVersion: 2 }))
            .rejects.toBeInstanceOf(ProviderDiscoveryNotFoundError);

        const stale = fixture();
        await expect(stale.runner.discover({ providerId: provider.id, expectedProviderVersion: 1 }))
            .rejects.toBeInstanceOf(ProviderDiscoveryConflictError);
        expect(stale.directory.requestModels).not.toHaveBeenCalled();
    });

    it("fails as unconfigured when the Provider has no stored credential", async () => {
        const harness = fixture({ secretRef: null });
        await expect(harness.runner.discover({ providerId: provider.id, expectedProviderVersion: 2 }))
            .rejects.toBeInstanceOf(ProviderModelDiscoveryUnavailableError);
        expect(harness.directory.requestModels).not.toHaveBeenCalled();
    });

    it("maps directory failures to fixed safe error codes", async () => {
        const unauthorized = fixture({
            directory: { requestModels: vi.fn(async () => ({ status: 401, body: { error: { message: "bad key sk-live" } } })) },
        });
        expect(await unauthorized.runner.discover({ providerId: provider.id, expectedProviderVersion: 2 }))
            .toMatchObject({ status: "failed", errorCode: "authentication_failed", candidates: [] });

        const unsupported = fixture({
            directory: { requestModels: vi.fn(async () => ({ status: 404, body: null })) },
        });
        expect(await unsupported.runner.discover({ providerId: provider.id, expectedProviderVersion: 2 }))
            .toMatchObject({ status: "failed", errorCode: "unsupported" });

        const malformed = fixture({ directory: { requestModels: vi.fn(async () => ({ status: 200, body: { nope: true } })) } });
        expect(await malformed.runner.discover({ providerId: provider.id, expectedProviderVersion: 2 }))
            .toMatchObject({ status: "failed", errorCode: "malformed_response" });

        const empty = fixture({ directory: { requestModels: vi.fn(async () => ({ status: 200, body: { data: [] } })) } });
        expect(await empty.runner.discover({ providerId: provider.id, expectedProviderVersion: 2 }))
            .toMatchObject({ status: "failed", errorCode: "empty_result" });
    });

    it("never leaks the credential into a failed snapshot", async () => {
        const harness = fixture({
            directory: {
                requestModels: vi.fn(async () => {
                    const failure = new ProviderModelDirectoryError("timeout");
                    // 上游或底层可能把敏感内容写进 message；快照只允许带走 code。
                    failure.message = "connect failed for Bearer sk-live";
                    throw failure;
                }),
            },
        });
        const result = await harness.runner.discover({ providerId: provider.id, expectedProviderVersion: 2 });
        expect(result).toMatchObject({ status: "failed", errorCode: "timeout" });
        expect(JSON.stringify(result)).not.toContain("sk-live");
    });
});
