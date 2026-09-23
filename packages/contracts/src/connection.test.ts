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
