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
            status: "active",
            secretRef: "secret:c1",
            lastError: null,
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
});
