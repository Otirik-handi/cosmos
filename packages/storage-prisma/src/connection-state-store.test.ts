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

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function prepareDatabase(root: string): void {
    const schema = resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma");
    const prismaCli = resolve(process.cwd(), "packages/storage-prisma/node_modules/prisma/build/index.js");
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

            const linked = await repository.updateSource(source.id, {
                baseRevisionId: source.revisionId,
                connectionId: connection.id,
            });
            expect(linked.connectionId).toBe(connection.id);

            await repository.deleteConnection(connection.id);
            await expect(repository.getSource(source.id)).resolves.toMatchObject({ connectionId: null });
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
