import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";

import { AppController } from "./app.controller.js";

const connection = {
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
};

function controllerWith(repository: unknown) {
    return new AppController(
        repository as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
    );
}

describe("AppController connections (ADR-0017)", () => {
    it("creates, lists and reads connections", async () => {
        const repository = {
            createConnection: vi.fn(async () => connection),
            listConnections: vi.fn(async () => [connection]),
            getConnection: vi.fn(async (id: string) => (id === "c1" ? connection : null)),
            updateConnection: vi.fn(async () => connection),
            deleteConnection: vi.fn(async () => true),
        };
        const controller = controllerWith(repository);

        await expect(controller.createConnection({ name: "主账号", connectorId: "bilibili" }))
            .resolves.toMatchObject({ id: "c1", status: "active" });
        await expect(controller.listConnections()).resolves.toHaveLength(1);
        await expect(controller.connection("c1")).resolves.toMatchObject({ id: "c1" });
        await expect(controller.deleteConnection("c1")).resolves.toMatchObject({ action: "connection.deleted" });
    });

    it("maps a missing connection to 404", async () => {
        const repository = {
            getConnection: vi.fn(async () => null),
        };
        const controller = controllerWith(repository);
        await expect(controller.connection("missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects an empty connection name", async () => {
        const controller = controllerWith({ createConnection: vi.fn() });
        await expect(controller.createConnection({ name: "", connectorId: "bilibili" }))
            .rejects.toBeInstanceOf(Error);
    });
});
