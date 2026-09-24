import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { ConnectorStateConflictError } from "@cosmos/application";

import {
    PrismaConnectorStateStore,
    PrismaCosmosRepository,
} from "./index.js";
import { resolvePrismaCliPath } from "./prisma-cli.js";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function prepareDatabase(root: string): void {
    const schema = resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma");
    const prismaCli = resolvePrismaCliPath();
    const databaseUrl = `file:${resolve(root, "cosmos.sqlite").replaceAll("\\", "/")}`;
    writeFileSync(resolve(root, "cosmos.sqlite"), new Uint8Array());
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "ignore",
    });
}

async function createRepository(): Promise<PrismaCosmosRepository> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-connection-state-"));
    roots.push(root);
    prepareDatabase(root);
    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();
    return repository;
}

describe("PrismaCosmosRepository connections (ADR-0017)", () => {
    it("creates, lists, reads, updates and deletes a connection", async () => {
        const repository = await createRepository();
        try {
            const created = await repository.createConnection({
                name: "我的 Bilibili 主账号",
                connectorId: "bilibili",
                account: "example",
                secretRef: "secret:conn-1",
            });
            expect(created).toMatchObject({
                name: "我的 Bilibili 主账号",
                connectorId: "bilibili",
                account: "example",
                status: "active",
                secretRef: "secret:conn-1",
            });

            await expect(repository.listConnections()).resolves.toHaveLength(1);
            await expect(repository.getConnection(created.id)).resolves.toMatchObject({ id: created.id });

            const updated = await repository.updateConnection(created.id, {
                status: "revoked",
                lastError: "授权已撤销",
            });
            expect(updated).toMatchObject({ status: "revoked", lastError: "授权已撤销" });

            await expect(repository.deleteConnection(created.id)).resolves.toBe(true);
            await expect(repository.getConnection(created.id)).resolves.toBeNull();
        } finally {
            await repository.close();
        }
    });

    /**
     * 授权范围是连接行的一部分（ADR-0017）：建连接时写入的 `scopeJson` 必须原样读回，
     * 否则重连后「这个账号授权过什么」就丢了。它是不透明 JSON 文本，存储层不做解释。
     */
    it("round-trips the connection authorization scope", async () => {
        const repository = await createRepository();
        try {
            const scopeJson = '{"read":true,"comment":false}';
            const created = await repository.createConnection({
                name: "主账号",
                connectorId: "bilibili",
                scopeJson,
            });
            expect(created.scopeJson).toBe(scopeJson);

            await expect(repository.getConnection(created.id)).resolves.toMatchObject({ scopeJson });
        } finally {
            await repository.close();
        }
    });

    /**
     * 手工恢复走公开的更新命令，和探测回写是两条路：手工把连接改回可用时，失效原因要一起
     * 清空——`lastError: null` 必须真的写进存储，不能被当成「未提供」而跳过。
     */
    it("clears the failure reason when a connection is manually restored", async () => {
        const repository = await createRepository();
        try {
            const connection = await repository.createConnection({
                name: "主账号",
                connectorId: "bilibili",
            });
            await repository.updateConnection(connection.id, {
                status: "revoked",
                lastError: "授权已撤销",
            });

            const restored = await repository.updateConnection(connection.id, {
                status: "active",
                lastError: null,
            });
            expect(restored).toMatchObject({ status: "active", lastError: null });

            await expect(repository.getConnection(connection.id)).resolves.toMatchObject({
                status: "active",
                lastError: null,
            });
        } finally {
            await repository.close();
        }
    });

    /**
     * 登录探测的回写（Proposal connection-login-lifecycle-v1 决定 2）：状态、账号、失效原因
     * 与检查时间一次写入。`lastCheckedAt` 刻意不走公开的更新命令——它是系统观测。
     */
    it("records a login probe onto the connection", async () => {
        const repository = await createRepository();
        try {
            const connection = await repository.createConnection({
                name: "主账号",
                connectorId: "bilibili",
                configJson: '{"profile":"chrome-main"}',
            });
            expect(connection.lastCheckedAt).toBeNull();
            expect(connection.configJson).toBe('{"profile":"chrome-main"}');

            const checked = await repository.recordConnectionProbe(connection.id, {
                status: "expired",
                account: "example",
                lastError: "需要重新登录。",
                checkedAt: "2026-09-23T09:00:00.000Z",
            });
            expect(checked).toMatchObject({
                status: "expired",
                account: "example",
                lastError: "需要重新登录。",
                lastCheckedAt: "2026-09-23T09:00:00.000Z",
            });
            await expect(repository.getConnection(connection.id)).resolves.toMatchObject({
                status: "expired",
                lastCheckedAt: "2026-09-23T09:00:00.000Z",
            });

            await expect(repository.recordConnectionProbe("missing", {
                status: "active",
                account: null,
                lastError: null,
                checkedAt: "2026-09-23T09:00:00.000Z",
            })).rejects.toThrow("Connection not found: missing");
        } finally {
            await repository.close();
        }
    });

    it("links a source to a connection and detaches it on delete", async () => {
        const repository = await createRepository();
        try {
            const connection = await repository.createConnection({
                name: "主账号",
                connectorId: "bilibili",
            });
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            expect(source.connectionId).toBeNull();

            const linked = await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: source.planRevisionId,
                connectionId: connection.id,
            });
            expect(linked.connectionId).toBe(connection.id);

            await repository.deleteConnection(connection.id);
            await expect(repository.getSource(source.id)).resolves.toMatchObject({ connectionId: null });
        } finally {
            await repository.close();
        }
    });
    it("deletes the stored secret bytes when the connection is removed (AUT-001)", async () => {
        const repository = await createRepository();
        try {
            const connection = await repository.createConnection({
                name: "带凭据的连接",
                connectorId: "bilibili",
                secretRef: "secret:conn-delete",
            });
            await repository.secrets.put("secret:conn-delete", "token-value");
            await expect(repository.secrets.read("secret:conn-delete")).resolves.toBe("token-value");

            await expect(repository.deleteConnection(connection.id)).resolves.toBe(true);

            // 连接行与密钥字节一起消失：删除凭据是删除动作的一部分，不是只解引用。
            await expect(repository.getConnection(connection.id)).resolves.toBeNull();
            await expect(repository.secrets.read("secret:conn-delete")).resolves.toBeNull();
        } finally {
            await repository.close();
        }
    });

    it("removes a connection without a secretRef and stays idempotent", async () => {
        const repository = await createRepository();
        try {
            const connection = await repository.createConnection({
                name: "无凭据的连接",
                connectorId: "bilibili",
            });

            await expect(repository.deleteConnection(connection.id)).resolves.toBe(true);
            await expect(repository.getConnection(connection.id)).resolves.toBeNull();
        } finally {
            await repository.close();
        }
    });
});

describe("PrismaConnectorStateStore (ADR-0017)", () => {
    it("writes with version CAS and rejects stale versions", async () => {
        const repository = await createRepository();
        const store = new PrismaConnectorStateStore(repository.prisma);
        try {
            await expect(store.getState("connection:c1", "cursor")).resolves.toBeNull();

            const created = await store.putState("connection:c1", "cursor", { next: "abc" }, null);
            expect(created.version).toBe(1);

            await expect(store.getState("connection:c1", "cursor")).resolves.toEqual({
                value: { next: "abc" },
                version: 1,
            });

            const updated = await store.putState("connection:c1", "cursor", { next: "def" }, 1);
            expect(updated.version).toBe(2);

            await expect(
                store.putState("connection:c1", "cursor", { next: "ghi" }, 1),
            ).rejects.toBeInstanceOf(ConnectorStateConflictError);

            await expect(
                store.putState("connection:c1", "other", {}, null),
            ).resolves.toMatchObject({ version: 1 });
        } finally {
            await repository.close();
        }
    });
});
