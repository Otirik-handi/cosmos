import { describe, expect, it } from "vitest";

import {
    connectionInstanceSchema,
    createConnectionCommandSchema,
    updateConnectionCommandSchema,
} from "./index.js";

describe("Connection contracts (ADR-0017)", () => {
    it("validates a connection snapshot with an opaque secretRef", () => {
        const snapshot = connectionInstanceSchema.parse({
            id: "c1",
            name: "主账号",
            connectorId: "bilibili",
            account: null,
            scopeJson: null,
            configJson: null,
            status: "active",
            secretRef: "secret:c1",
            lastError: null,
            lastCheckedAt: null,
            version: 1,
            modelId: null,
            createdAt: "2026-09-10T08:00:00.000Z",
            updatedAt: "2026-09-10T08:00:00.000Z",
        });
        expect(snapshot.status).toBe("active");
        expect(snapshot.secretRef).toBe("secret:c1");
    });

    it("rejects an empty connection name and unknown fields", () => {
        expect(() => createConnectionCommandSchema.parse({ name: "", connectorId: "bilibili" })).toThrow();
        expect(() => createConnectionCommandSchema.parse({ name: "x", connectorId: "bilibili", secret: "raw" })).toThrow();
    });

    it("accepts a status-only update and a null secretRef unlink", () => {
        expect(updateConnectionCommandSchema.parse({ status: "revoked" })).toEqual({ status: "revoked" });
        expect(updateConnectionCommandSchema.parse({ secretRef: null })).toEqual({ secretRef: null });
    });

    /**
     * 非秘密适配器配置（Proposal connection-login-lifecycle-v1 决定 1）：OpenCLI profile
     * 这类标识从 `Source.config` 搬到连接。它是**配置**不是凭证，所以进 `configJson`
     * 而不是 SecretStore——三个字段的所有权边界见该 Proposal。
     */
    it("carries non-secret adapter configuration separate from scope and secret", () => {
        const snapshot = connectionInstanceSchema.parse({
            id: "c1",
            name: "主账号",
            connectorId: "bilibili",
            account: null,
            scopeJson: '{"read":true}',
            configJson: '{"profile":"chrome-main"}',
            status: "active",
            secretRef: null,
            lastError: null,
            lastCheckedAt: null,
            version: 1,
            modelId: null,
            createdAt: "2026-09-10T08:00:00.000Z",
            updatedAt: "2026-09-10T08:00:00.000Z",
        });
        expect(snapshot.configJson).toBe('{"profile":"chrome-main"}');
        expect(snapshot.scopeJson).toBe('{"read":true}');

        expect(createConnectionCommandSchema.parse({
            name: "主账号",
            connectorId: "bilibili",
            configJson: '{"profile":"chrome-main"}',
        })).toMatchObject({ configJson: '{"profile":"chrome-main"}' });
        expect(updateConnectionCommandSchema.parse({ configJson: null })).toEqual({ configJson: null });
    });
});

/**
 * 模型连接（API 0009「Connection 与 invocation 版本」）：`cosmos.agent` 是 Cosmos 自己的
 * 模型连接种类，不是外部服务商标识。它挑一个本地模型，因此凭证仍由 Provider 持有，
 * 连接自己不允许 secretRef——这条边界写在合同里，不靠调用方自觉。
 */
describe("Connection model selection contracts", () => {
    const modelConnection = {
        id: "c1",
        name: "对话模型",
        connectorId: "cosmos.agent",
        account: null,
        scopeJson: null,
        configJson: null,
        status: "active" as const,
        secretRef: null,
        lastError: null,
        lastCheckedAt: null,
        version: 3,
        modelId: "model-1",
        createdAt: "2026-10-20T08:00:00.000Z",
        updatedAt: "2026-10-20T08:00:00.000Z",
    };

    it("exposes the model selection and its version on a snapshot", () => {
        const snapshot = connectionInstanceSchema.parse(modelConnection);

        expect(snapshot.modelId).toBe("model-1");
        expect(snapshot.version).toBe(3);
    });

    it("requires a chosen model for a model connection and forbids its own credential", () => {
        expect(createConnectionCommandSchema.parse({
            name: "对话模型",
            connectorId: "cosmos.agent",
            modelId: "model-1",
        })).toMatchObject({ modelId: "model-1", connectorId: "cosmos.agent" });

        // 必须有模型；凭证属于 Provider，连接上出现 secretRef（即使 null）也算越界。
        expect(() => createConnectionCommandSchema.parse({
            name: "对话模型",
            connectorId: "cosmos.agent",
        })).toThrow();
        expect(() => createConnectionCommandSchema.parse({
            name: "对话模型",
            connectorId: "cosmos.agent",
            modelId: "model-1",
            secretRef: null,
        })).toThrow();
    });

    it("keeps modelId off every other connector kind", () => {
        // 外部平台的连接没有本地模型可挑；写进来会让人以为它被忽略了。
        expect(() => createConnectionCommandSchema.parse({
            name: "主账号",
            connectorId: "bilibili",
            modelId: "model-1",
        })).toThrow();
        expect(createConnectionCommandSchema.parse({
            name: "主账号",
            connectorId: "bilibili",
        })).not.toHaveProperty("modelId");
    });

    it("accepts a versioned model selection change and an unlink", () => {
        expect(updateConnectionCommandSchema.parse({
            expectedVersion: 2,
            modelId: "model-2",
        })).toEqual({ expectedVersion: 2, modelId: "model-2" });
        // null 是「解除选择」的显式信号，与「没传」必须可区分。
        expect(updateConnectionCommandSchema.parse({
            expectedVersion: 2,
            modelId: null,
        })).toEqual({ expectedVersion: 2, modelId: null });
    });

    it("rejects a version that cannot identify a saved connection", () => {
        expect(() => updateConnectionCommandSchema.parse({ expectedVersion: 0, modelId: "model-2" })).toThrow();
        expect(() => updateConnectionCommandSchema.parse({ expectedVersion: 1.5, modelId: "model-2" })).toThrow();
    });
});
