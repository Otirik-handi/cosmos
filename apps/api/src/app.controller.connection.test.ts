import { describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";

import { createBuiltinManifestCatalog } from "@cosmos/application";

import { AppController } from "./app.controller.js";

const connection = {
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

/**
 * 探测入口要走 manifest 声明（`auth.probeSupported`），所以这些用例必须带上真实 catalog：
 * 内置定义里只有 Bilibili 声明支持登录探测。
 */
function controllerWithCatalog(repository: unknown) {
    return new AppController(
        repository as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        undefined,
        createBuiltinManifestCatalog() as never,
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

    /**
     * 连接登录探测（Proposal connection-login-lifecycle-v1 决定 2）：探测排队走 Worker，
     * 能不能发起由 manifest 的 `auth.probeSupported` 决定，不硬编码 connectorId。
     */
    it("enqueues a login probe for a connection whose adapter declares support", async () => {
        const probeJob = {
            id: "job-probe-1",
            kind: "connection-probe",
            sourceId: null,
            runId: null,
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            errorCode: null,
            error: null,
            createdAt: "2026-09-23T09:00:00.000Z",
            updatedAt: "2026-09-23T09:00:00.000Z",
            result: null,
        };
        const createConnectionProbeJob = vi.fn(
            async (_input: { connectionId: string; idempotencyKey?: string }) => probeJob,
        );
        const controller = controllerWithCatalog({
            getConnection: vi.fn(async (id: string) => (id === "c1" ? connection : null)),
            createConnectionProbeJob,
            getJob: vi.fn(async () => probeJob),
        });

        await expect(controller.createConnectionProbe("c1", "probe-key-1"))
            .resolves.toMatchObject({ kind: "connection-probe", status: "queued" });
        expect(createConnectionProbeJob).toHaveBeenCalledWith({
            connectionId: "c1",
            idempotencyKey: "probe-key-1",
        });
        // 不给幂等键时由 API 生成一个（探测与采集一样是入队动作）。
        await controller.createConnectionProbe("c1");
        expect(createConnectionProbeJob.mock.calls[1]?.[0]).toMatchObject({ connectionId: "c1" });
        expect(String(createConnectionProbeJob.mock.calls[1]?.[0]?.idempotencyKey)).toContain("connection-probe:");
        await expect(controller.connectionProbe("job-probe-1"))
            .resolves.toMatchObject({ kind: "connection-probe" });
    });

    it("maps an unknown connection to 404 and an adapter without probe support to 409", async () => {
        const missing = controllerWithCatalog({ getConnection: vi.fn(async () => null) });
        await expect(missing.createConnectionProbe("missing")).rejects.toBeInstanceOf(NotFoundException);

        const createConnectionProbeJob = vi.fn();
        const unsupported = controllerWithCatalog({
            getConnection: vi.fn(async () => ({ ...connection, connectorId: "rss" })),
            createConnectionProbeJob,
        });
        await expect(unsupported.createConnectionProbe("c1")).rejects.toBeInstanceOf(ConflictException);
        expect(createConnectionProbeJob).not.toHaveBeenCalled();
    });

    it("hides probe jobs of another kind behind 404", async () => {
        const controller = controllerWithCatalog({
            getJob: vi.fn(async () => ({ id: "job-1", kind: "source-probe" })),
        });
        await expect(controller.connectionProbe("job-1")).rejects.toBeInstanceOf(NotFoundException);
    });
});
