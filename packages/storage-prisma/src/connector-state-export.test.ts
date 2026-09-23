import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConnectorStateImportRejectedError } from "@cosmos/application";
import { connectorStateExportSchema, type ConnectorStateExport } from "@cosmos/contracts";

import { PrismaConnectorStateStore, PrismaCosmosRepository } from "./index.js";
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
    const root = await mkdtemp(join(tmpdir(), "cosmos-connector-state-export-"));
    roots.push(root);
    prepareDatabase(root);
    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();
    return repository;
}

/** 建一个采集计划（v1 与来源一对一），返回计划身份与来源身份。 */
async function createPlan(
    repository: PrismaCosmosRepository,
    name: string,
): Promise<{ planId: string; planRevisionId: string; sourceId: string }> {
    const source = await repository.createSource({
        name,
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        config: { feedUrl: `https://example.test/${encodeURIComponent(name)}.xml` },
    });
    return {
        planId: source.planId,
        planRevisionId: source.planRevisionId,
        sourceId: source.id,
    };
}

function exportFile(namespaces: ConnectorStateExport["namespaces"]): ConnectorStateExport {
    return connectorStateExportSchema.parse({
        schemaVersion: 1,
        exportedAt: "2026-09-23T00:00:00.000Z",
        scope: { kind: "attributed", value: null },
        counts: {
            namespaces: namespaces.length,
            keys: namespaces.reduce((total, bucket) => total + bucket.entries.length, 0),
        },
        namespaces,
    });
}

describe("ConnectorStateNamespace 归属登记 (ADR-0026)", () => {
    it("同一计划的重复登记是常态；别的计划抢同一个抽屉时保留首个登记", async () => {
        const repository = await createRepository();
        try {
            const store = new PrismaConnectorStateStore(repository.prisma);
            const first = await createPlan(repository, "推荐流");
            const second = await createPlan(repository, "动态");

            await expect(store.registerNamespace(first.planId, { planId: first.planId }))
                .resolves.toBe("registered");
            // 每轮抓取都会登记一次：同一计划的重复登记不是冲突。
            await expect(store.registerNamespace(first.planId, { planId: first.planId }))
                .resolves.toBe("registered");
            await expect(store.registerNamespace(first.planId, { planId: second.planId }))
                .resolves.toBe("conflict");

            const rows = await repository.prisma.connectorStateNamespace.findMany();
            expect(rows.map((row) => [row.namespace, row.planId]))
                .toEqual([[first.planId, first.planId]]);
        } finally {
            await repository.close();
        }
    });
});

describe("连接器状态清单与导出 (ING-012 / ADR-0026)", () => {
    it("清单以实际存在的抽屉为准，导出按范围收窄且不带走未归属抽屉", async () => {
        const repository = await createRepository();
        try {
            const store = new PrismaConnectorStateStore(repository.prisma);
            const connection = await repository.createConnection({ name: "主账号", connectorId: "bilibili" });
            const owned = await createPlan(repository, "推荐流");
            const loose = await createPlan(repository, "动态");
            await repository.updateCollectionPlan(owned.planId, {
                baseRevisionId: owned.planRevisionId,
                connectionId: connection.id,
            });

            await store.registerNamespace(owned.planId, { planId: owned.planId });
            await store.registerNamespace(loose.planId, { planId: loose.planId });
            await store.putState(owned.planId, "http-cache", { etag: 'W/"1"' }, null);
            await store.putState(loose.planId, "page", { cursor: "c-1" }, null);
            // 遗留抽屉：没有归属登记，迁移不认它，宿主也不会再写它。
            await store.putState("other-namespace", "page", { cursor: "x" }, null);

            const listed = await repository.listConnectorStateNamespaces();
            expect(listed.map((item) => [item.namespace, item.keyCount, item.unattributed]).sort())
                .toEqual([
                    ["other-namespace", 1, true],
                    [loose.planId, 1, false],
                    [owned.planId, 1, false],
                ].sort());
            const ownedSummary = listed.find((item) => item.namespace === owned.planId);
            expect(ownedSummary).toMatchObject({
                planId: owned.planId,
                sourceId: owned.sourceId,
                connectionId: connection.id,
            });

            const attributed = await repository.exportConnectorState({ kind: "attributed" });
            expect(attributed.namespaces.map((bucket) => bucket.namespace).sort())
                .toEqual([loose.planId, owned.planId].sort());
            expect(attributed.counts).toEqual({ namespaces: 2, keys: 2 });

            const byConnection = await repository.exportConnectorState({
                kind: "connection",
                connectionId: connection.id,
            });
            expect(byConnection.namespaces.map((bucket) => bucket.namespace)).toEqual([owned.planId]);
            expect(byConnection.scope).toEqual({ kind: "connection", value: connection.id });

            const bySource = await repository.exportConnectorState({
                kind: "source",
                sourceId: loose.sourceId,
            });
            expect(bySource.namespaces.map((bucket) => bucket.namespace)).toEqual([loose.planId]);

            // 未归属抽屉只能按名字点名，此时 owner 为 null。
            const named = await repository.exportConnectorState({
                kind: "namespace",
                namespace: "other-namespace",
            });
            expect(named.namespaces).toHaveLength(1);
            expect(named.namespaces[0]?.owner).toBeNull();
            expect(named.namespaces[0]?.entries).toEqual([
                {
                    key: "page",
                    value: { cursor: "x" },
                    version: 1,
                    updatedAt: expect.any(String),
                },
            ]);
        } finally {
            await repository.close();
        }
    });
});

describe("连接器状态导入 (ADR-0026)", () => {
    it("默认只补缺失；显式覆盖时把版本提到本地 +1，导入保持幂等", async () => {
        const repository = await createRepository();
        try {
            const store = new PrismaConnectorStateStore(repository.prisma);
            const plan = await createPlan(repository, "推荐流");
            await store.registerNamespace(plan.planId, { planId: plan.planId });
            await store.putState(plan.planId, "http-cache", { etag: "local" }, null);
            await store.putState(plan.planId, "http-cache", { etag: "local-2" }, 1);

            const incoming = exportFile([{
                namespace: plan.planId,
                owner: { planId: plan.planId, sourceId: plan.sourceId, connectionId: null },
                entries: [
                    { key: "http-cache", value: { etag: "imported" }, version: 9, updatedAt: "2026-09-22T00:00:00.000Z" },
                    { key: "page", value: { cursor: "p-1" }, version: 7, updatedAt: "2026-09-22T00:00:00.000Z" },
                ],
            }]);

            const skipped = await repository.importConnectorState({ mode: "skip-existing", export: incoming });
            expect(skipped).toEqual({
                mode: "skip-existing",
                namespaces: 1,
                created: 1,
                overwritten: 0,
                skipped: 1,
            });
            // 本地较新的状态没有被回退；新键按导出件的 version 建行，CAS 令牌保持连续。
            await expect(store.getState(plan.planId, "http-cache"))
                .resolves.toEqual({ value: { etag: "local-2" }, version: 2 });
            await expect(store.getState(plan.planId, "page"))
                .resolves.toEqual({ value: { cursor: "p-1" }, version: 7 });

            // 幂等：同一份文件再导一次，结果不变。
            await expect(repository.importConnectorState({ mode: "skip-existing", export: incoming }))
                .resolves.toEqual({
                    mode: "skip-existing",
                    namespaces: 1,
                    created: 0,
                    overwritten: 0,
                    skipped: 2,
                });

            const overwritten = await repository.importConnectorState({ mode: "overwrite", export: incoming });
            expect(overwritten).toEqual({
                mode: "overwrite",
                namespaces: 1,
                created: 0,
                overwritten: 2,
                skipped: 0,
            });
            // 覆盖 = 本地 version + 1：持有旧令牌的写入方会按冲突失败，而不是静默覆盖。
            await expect(store.getState(plan.planId, "http-cache"))
                .resolves.toEqual({ value: { etag: "imported" }, version: 3 });
            await expect(store.getState(plan.planId, "page"))
                .resolves.toEqual({ value: { cursor: "p-1" }, version: 8 });
        } finally {
            await repository.close();
        }
    });

    it("换机改名只允许单抽屉，且目标抽屉必须已有归属登记", async () => {
        const repository = await createRepository();
        try {
            const store = new PrismaConnectorStateStore(repository.prisma);
            const target = await createPlan(repository, "新环境的计划");
            await store.registerNamespace(target.planId, { planId: target.planId });

            const oldBucket = {
                namespace: "plan:source-old",
                owner: null,
                entries: [
                    { key: "http-cache", value: { etag: "old" }, version: 4, updatedAt: "2026-09-22T00:00:00.000Z" },
                ],
            };
            const single = exportFile([oldBucket]);
            await expect(repository.importConnectorState({
                mode: "skip-existing",
                targetNamespace: target.planId,
                export: single,
            })).resolves.toEqual({
                mode: "skip-existing",
                namespaces: 1,
                created: 1,
                overwritten: 0,
                skipped: 0,
            });
            await expect(store.getState(target.planId, "http-cache"))
                .resolves.toEqual({ value: { etag: "old" }, version: 4 });

            // 多抽屉时不允许指定目标抽屉：范围必须唯一。
            const many = exportFile([
                oldBucket,
                {
                    namespace: "plan:source-other",
                    owner: null,
                    entries: [
                        { key: "page", value: { cursor: "c" }, version: 1, updatedAt: "2026-09-22T00:00:00.000Z" },
                    ],
                },
            ]);
            await expect(repository.importConnectorState({
                mode: "skip-existing",
                targetNamespace: target.planId,
                export: many,
            })).rejects.toBeInstanceOf(ConnectorStateImportRejectedError);

            // 目标抽屉没有归属登记 = 新环境没有计划会读它，导进去就是死抽屉。
            await expect(repository.importConnectorState({
                mode: "skip-existing",
                targetNamespace: "plan:not-registered",
                export: single,
            })).rejects.toBeInstanceOf(ConnectorStateImportRejectedError);
        } finally {
            await repository.close();
        }
    });
});
