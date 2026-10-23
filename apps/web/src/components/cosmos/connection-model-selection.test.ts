import { describe, expect, it } from "vitest";

import type {
    ConfiguredModelSnapshot, ConnectionInstance, ModelProviderSnapshot,
} from "@cosmos/contracts";

import {
    connectionModelNotice, connectionModelState, modelChoices, toSelectModelCommand,
} from "./connection-model-selection";

function connection(overrides: Partial<ConnectionInstance> = {}): ConnectionInstance {
    return {
        id: "connection-1",
        name: "对话模型",
        connectorId: "cosmos.agent",
        account: null,
        scopeJson: null,
        configJson: null,
        status: "active",
        secretRef: null,
        lastError: null,
        lastCheckedAt: null,
        modelId: "model-1",
        version: 4,
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:00:00.000Z",
        ...overrides,
    };
}

function provider(overrides: Partial<ModelProviderSnapshot> = {}): ModelProviderSnapshot {
    return {
        id: "provider-1",
        name: "Synthetic",
        api: "openai-completions",
        baseUrl: "https://example.invalid/v1",
        version: 1,
        state: "active",
        credentialState: "configured",
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:00:00.000Z",
        ...overrides,
    };
}

function model(overrides: Partial<ConfiguredModelSnapshot> = {}): ConfiguredModelSnapshot {
    return {
        id: "model-1",
        providerId: "provider-1",
        modelId: "namespace/one",
        name: "One",
        contextWindow: 4096,
        maxOutputTokens: 512,
        version: 1,
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:00:00.000Z",
        ...overrides,
    };
}

describe("model choices", () => {
    it("flattens providers in order and keeps the provider name for the label", () => {
        const choices = modelChoices(
            [provider(), provider({ id: "provider-2", name: "Second" })],
            new Map([
                ["provider-1", [model()]],
                ["provider-2", [model({ id: "model-2", name: "Two" })]],
            ]),
        );

        expect(choices).toEqual([
            { modelId: "model-1", label: "One", providerName: "Synthetic", providerId: "provider-1" },
            { modelId: "model-2", label: "Two", providerName: "Second", providerId: "provider-2" },
        ]);
    });

    it("ignores models of providers that are not in the list", () => {
        const choices = modelChoices(
            [provider()],
            new Map([
                ["provider-1", [model()]],
                ["provider-gone", [model({ id: "model-9" })]],
            ]),
        );

        expect(choices.map((choice) => choice.modelId)).toEqual(["model-1"]);
    });
});

describe("connection model state", () => {
    it("reports non-model connections without inventing a selection", () => {
        const state = connectionModelState(
            connection({ connectorId: "bilibili", modelId: null }),
            [],
        );

        expect(state).toEqual({ kind: "not-model" });
    });

    it("separates an unset selection from a missing one", () => {
        expect(connectionModelState(connection({ modelId: null }), [])).toEqual({ kind: "unset" });
        // 模型被删了：这条连接在运行时是坏的，必须让用户看见「配置缺失」。
        expect(connectionModelState(connection(), [])).toEqual({ kind: "missing", modelId: "model-1" });
    });

    it("resolves the selected model to its display label", () => {
        const state = connectionModelState(connection(), [
            { modelId: "model-1", label: "One", providerName: "Synthetic", providerId: "provider-1" },
        ]);

        expect(state).toEqual({
            kind: "selected", modelId: "model-1", label: "One", providerName: "Synthetic",
        });
    });
});

describe("select model command", () => {
    it("carries the version that was read, not a guessed one", () => {
        expect(toSelectModelCommand(connection({ version: 7 }), "model-2")).toEqual({
            expectedVersion: 7,
            modelId: "model-2",
        });
    });
});

describe("model selection failure notice", () => {
    it("tells a concurrent edit apart from an invalid pick", () => {
        expect(connectionModelNotice(409, { code: "version_conflict" })).toBe("versionConflict");
        expect(connectionModelNotice(409, { code: "invalid_model_selection" })).toBe("invalidSelection");
        expect(connectionModelNotice(404, null)).toBe("notFound");
        expect(connectionModelNotice(500, null)).toBe("unavailable");
        // 未知错误码不能泄漏服务端正文，也不能伪装成已知原因。
        expect(connectionModelNotice(400, { code: "something_new", message: "boom" })).toBe("unavailable");
    });
});
