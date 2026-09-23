import {
    ConnectorStateImportRejectedError,
} from "@cosmos/application";
import type {
    ConnectorStateExport,
    ConnectorStateExportScope,
    ConnectorStateImportCommand,
    ConnectorStateImportResult,
    ConnectorStateNamespaceSummary,
} from "@cosmos/contracts";
import { PrismaCosmosRepositoryUserDataExport } from "./user-data-export.js";

type ExportNamespace = ConnectorStateExport["namespaces"][number];

/**
 * 连接器状态导出／导入（ING-012 / ADR-0026）。
 *
 * 归属来自 `ConnectorStateNamespace`，所以清单与导出都是一次 join，不再解析 manifest
 * 模板。清单以**实际存在的抽屉**为准（`ConnectorState` 的 distinct namespace），登记表
 * 只回答"属于谁"：登记了但一条状态都没有的抽屉不出现在清单里。
 */
export class PrismaCosmosRepositoryConnectorStateExport extends PrismaCosmosRepositoryUserDataExport {
    async listConnectorStateNamespaces(): Promise<readonly ConnectorStateNamespaceSummary[]> {
        const [grouped, owners] = await Promise.all([
            this.prisma.connectorState.groupBy({
                by: ["namespace"],
                _count: { _all: true },
            }),
            this.prisma.connectorStateNamespace.findMany({
                select: {
                    namespace: true,
                    planId: true,
                    plan: { select: { sourceId: true, connectionId: true } },
                },
            }),
        ]);
        const ownerByNamespace = new Map(owners.map((row) => [row.namespace, row]));
        return grouped
            .map((row) => {
                const owner = ownerByNamespace.get(row.namespace);
                return {
                    namespace: row.namespace,
                    keyCount: row._count._all,
                    planId: owner?.planId ?? null,
                    sourceId: owner?.plan.sourceId ?? null,
                    connectionId: owner?.plan.connectionId ?? null,
                    unattributed: owner === undefined,
                };
            })
            .sort((left, right) => left.namespace.localeCompare(right.namespace));
    }

    async exportConnectorState(scope: ConnectorStateExportScope): Promise<ConnectorStateExport> {
        const namespaces = await this.resolveScopeNamespaces(scope);
        const [rows, owners] = await Promise.all([
            this.prisma.connectorState.findMany({
                where: { namespace: { in: namespaces } },
                orderBy: [{ namespace: "asc" }, { key: "asc" }],
            }),
            this.prisma.connectorStateNamespace.findMany({
                where: { namespace: { in: namespaces } },
                select: {
                    namespace: true,
                    planId: true,
                    plan: { select: { sourceId: true, connectionId: true } },
                },
            }),
        ]);
        const ownerByNamespace = new Map(owners.map((row) => [row.namespace, row]));

        const buckets = new Map<string, ExportNamespace>();
        for (const row of rows) {
            let bucket = buckets.get(row.namespace);
            if (!bucket) {
                const owner = ownerByNamespace.get(row.namespace);
                bucket = {
                    namespace: row.namespace,
                    owner: owner
                        ? {
                            planId: owner.planId,
                            sourceId: owner.plan.sourceId,
                            connectionId: owner.plan.connectionId,
                        }
                        : null,
                    entries: [],
                };
                buckets.set(row.namespace, bucket);
            }
            bucket.entries.push({
                key: row.key,
                value: JSON.parse(row.valueJson) as unknown,
                version: row.version,
                updatedAt: row.updatedAt.toISOString(),
            });
        }

        const exported = [...buckets.values()];
        return {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            scope: toExportScope(scope),
            counts: {
                namespaces: exported.length,
                keys: rows.length,
            },
            namespaces: exported,
        };
    }

    async importConnectorState(
        command: ConnectorStateImportCommand,
    ): Promise<ConnectorStateImportResult> {
        const incoming = command.export.namespaces;
        const targetNamespace = command.targetNamespace;
        if (targetNamespace !== undefined) {
            if (incoming.length !== 1) {
                throw new ConnectorStateImportRejectedError(
                    `targetNamespace requires an export with exactly one namespace, got ${incoming.length}.`,
                );
            }
            const registered = await this.prisma.connectorStateNamespace.findUnique({
                where: { namespace: targetNamespace },
                select: { namespace: true },
            });
            if (registered === null) {
                throw new ConnectorStateImportRejectedError(
                    `Target namespace is not registered to any collection plan: ${targetNamespace}`,
                );
            }
        }

        const counts = { created: 0, overwritten: 0, skipped: 0 };
        await this.prisma.$transaction(async (tx) => {
            for (const bucket of incoming) {
                const namespace = targetNamespace ?? bucket.namespace;
                for (const entry of bucket.entries) {
                    // JSON.stringify(undefined) 返回 undefined 而不是字符串；缺 `value`
                    // 字段的输入按 null 落库，不让它变成一次 500。
                    const valueJson = JSON.stringify(entry.value ?? null);
                    const existing = await tx.connectorState.findUnique({
                        where: { namespace_key: { namespace, key: entry.key } },
                        select: { version: true },
                    });
                    if (existing === null) {
                        await tx.connectorState.create({
                            data: {
                                namespace,
                                key: entry.key,
                                valueJson,
                                version: entry.version,
                            },
                        });
                        counts.created += 1;
                        continue;
                    }
                    if (command.mode === "skip-existing") {
                        counts.skipped += 1;
                        continue;
                    }
                    // 覆盖时把版本提到本地 +1：照搬导出件的 version 会让持有旧 CAS 令牌的
                    // 写入方以为自己的写入仍然有效，从而静默覆盖刚恢复的状态（ADR-0026）。
                    await tx.connectorState.update({
                        where: { namespace_key: { namespace, key: entry.key } },
                        data: { valueJson, version: existing.version + 1 },
                    });
                    counts.overwritten += 1;
                }
            }
        });

        return {
            mode: command.mode,
            namespaces: incoming.length,
            ...counts,
        };
    }

    /**
     * 把范围解析成抽屉名。`namespace` 是唯一的"可以点名未归属抽屉"的入口；其余四种
     * 都只认登记表，所以未归属抽屉不会因为选了"全部"而被悄悄带走。
     */
    private async resolveScopeNamespaces(scope: ConnectorStateExportScope): Promise<string[]> {
        switch (scope.kind) {
            case "namespace":
                return [scope.namespace];
            case "attributed":
                return (await this.prisma.connectorStateNamespace.findMany({
                    select: { namespace: true },
                })).map((row) => row.namespace);
            case "plan":
                return (await this.prisma.connectorStateNamespace.findMany({
                    where: { planId: scope.planId },
                    select: { namespace: true },
                })).map((row) => row.namespace);
            case "connection":
                return (await this.prisma.connectorStateNamespace.findMany({
                    where: { plan: { connectionId: scope.connectionId } },
                    select: { namespace: true },
                })).map((row) => row.namespace);
            case "source":
                return (await this.prisma.connectorStateNamespace.findMany({
                    where: { plan: { sourceId: scope.sourceId } },
                    select: { namespace: true },
                })).map((row) => row.namespace);
        }
    }
}

function toExportScope(scope: ConnectorStateExportScope): ConnectorStateExport["scope"] {
    switch (scope.kind) {
        case "attributed":
            return { kind: "attributed", value: null };
        case "namespace":
            return { kind: "namespace", value: scope.namespace };
        case "plan":
            return { kind: "plan", value: scope.planId };
        case "connection":
            return { kind: "connection", value: scope.connectionId };
        case "source":
            return { kind: "source", value: scope.sourceId };
    }
}
