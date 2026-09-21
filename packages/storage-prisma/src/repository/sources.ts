import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { type CreateSourceCommand, type ConnectionInstance, type CreateConnectionCommand, type UpdateConnectionCommand, type StorageStats, type BackupSnapshot, type SourceActivationCommand, type SourceSnapshot, type UpdateSourceCommand } from "@cosmos/contracts";
import { ConnectionNotFoundError, SourceNotFoundError, SourceRevisionConflictError } from "@cosmos/application";
import { type Prisma } from "@prisma/client";
import { directorySize, fileSize, parseSourceRevisionId } from "../storage-root.js";
import { appendDomainEvent, isUniqueConstraintError, sourceActivationRequestHash } from "./repository-internals.js";
import { PrismaCosmosRepositoryHelpers4 } from "./helpers-4.js";

export class PrismaCosmosRepositorySources extends PrismaCosmosRepositoryHelpers4 {
    async createSource(input: CreateSourceCommand): Promise<SourceSnapshot> {
        const manifest = this.catalog.getSourceDefinitionByRef(input.sourceDefinitionRef);
        if (!manifest || manifest.status !== "enabled" || !manifest.operationIds.includes(input.operationId)) {
            throw new Error(`Source definition is not available: ${input.sourceDefinitionRef}`);
        }
        const source = await this.prisma.$transaction(async (tx) => {
            const created = await tx.sourceInstance.create({
                data: {
                    name: input.name,
                    kind: manifest.id,
                    sourceDefinitionRef: manifest.ref,
                    operationId: input.operationId,
                    configJson: JSON.stringify(input.config),
                    enabled: false,
                    revision: 1,
                },
            });
            // 计划与采集目标一对一（ADR-0023）：默认计划与来源同批建出。读取切换之后
            // 调度、状态命名空间与媒体预算都按计划归属，晚建会让新来源失去这些归属。
            const plan = await tx.collectionPlan.create({
                data: {
                    id: `plan:${created.id}`,
                    name: created.name,
                    sourceId: created.id,
                    mediaPolicyJson: extractMediaPolicy(input.config),
                    enabled: false,
                    revision: 1,
                },
            });
            if (input.scheduleIntervalMs !== undefined) {
                await tx.triggerBinding.create({
                    data: {
                        sourceId: created.id,
                        planId: plan.id,
                        kind: "schedule",
                        configJson: JSON.stringify({ intervalMs: input.scheduleIntervalMs }),
                        enabled: true,
                        revision: 1,
                    },
                });
            }
            return created;
        });
        return this.toSourceSnapshot(source);
    }

    async listSources(): Promise<readonly SourceSnapshot[]> {
        const sources = await this.prisma.sourceInstance.findMany({
            // 墓碑来源（AUT-001 删除）不再出现在产品面上。
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" },
        });
        return Promise.all(sources.map((source) => this.toSourceSnapshot(source)));
    }

    async getSource(sourceId: string): Promise<SourceSnapshot | null> {
        const source = await this.prisma.sourceInstance.findFirst({
            where: { id: sourceId, deletedAt: null },
        });
        return source ? this.toSourceSnapshot(source) : null;
    }

    async updateSource(sourceId: string, input: UpdateSourceCommand): Promise<SourceSnapshot> {
        const expectedRevision = parseSourceRevisionId(sourceId, input.baseRevisionId);
        const current = await this.prisma.sourceInstance.findUnique({ where: { id: sourceId } });
        // 墓碑来源对编辑命令等同不存在（AUT-001）。
        if (!current || current.deletedAt) throw new SourceNotFoundError(sourceId);
        await this.prisma.$transaction(async (tx) => {
            const updated = await tx.sourceInstance.updateMany({
                where: { id: sourceId, revision: expectedRevision },
                data: {
                    ...(input.name !== undefined ? { name: input.name } : {}),
                    ...(input.config !== undefined ? { configJson: JSON.stringify(input.config) } : {}),
                    ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
                    revision: { increment: 1 },
                },
            });
            if (updated.count !== 1) throw new SourceRevisionConflictError(sourceId);
            if (input.scheduleIntervalMs !== undefined) {
                if (input.scheduleIntervalMs === null) {
                    await tx.triggerBinding.deleteMany({ where: { sourceId } });
                } else {
                    await tx.triggerBinding.upsert({
                        where: { sourceId },
                        create: {
                            sourceId,
                            kind: "schedule",
                            configJson: JSON.stringify({ intervalMs: input.scheduleIntervalMs }),
                            enabled: true,
                            revision: 1,
                        },
                        update: {
                            configJson: JSON.stringify({ intervalMs: input.scheduleIntervalMs }),
                            revision: { increment: 1 },
                        },
                    });
                }
            }
        });
        return this.toSourceSnapshot(await this.prisma.sourceInstance.findUniqueOrThrow({ where: { id: sourceId } }));
    }

    async activateSource(input: SourceActivationCommand & {
        sourceId: string;
        idempotencyKey: string;
    }): Promise<SourceSnapshot> {
        const expectedRevision = parseSourceRevisionId(input.sourceId, input.baseRevisionId);
        const requestHash = sourceActivationRequestHash(input);
        let source: Prisma.SourceInstanceGetPayload<{}>;
        try {
            const outcome = await this.prisma.$transaction(async (tx): Promise<{
                snapshot: SourceSnapshot | null;
            }> => {
                const existing = await tx.sourceActivationCommand.findUnique({
                    where: { idempotencyKey: input.idempotencyKey },
                });
                if (existing) {
                    if (existing.sourceInstanceId !== input.sourceId || existing.requestHash !== requestHash) {
                        throw new SourceRevisionConflictError(input.sourceId);
                    }
                    // Replay returns the recorded first-result snapshot so the
                    // response stays stable even when later PATCHes moved the
                    // source forward. Rows created before that column existed
                    // fall back to a fresh read.
                    return {
                        snapshot: existing.resultSnapshotJson
                            ? JSON.parse(existing.resultSnapshotJson) as SourceSnapshot
                            : null,
                    };
                }

                const current = await tx.sourceInstance.findUnique({ where: { id: input.sourceId } });
                if (!current) throw new SourceNotFoundError(input.sourceId);
                // CAS guard for every fresh command, including no-op intents:
                // a stale baseRevisionId must conflict instead of recording.
                if (current.revision !== expectedRevision) {
                    throw new SourceRevisionConflictError(input.sourceId);
                }

                const resultRevision = current.enabled === input.enabled
                    ? expectedRevision
                    : expectedRevision + 1;
                if (resultRevision !== expectedRevision) {
                    const updated = await tx.sourceInstance.updateMany({
                        where: { id: input.sourceId, revision: expectedRevision },
                        data: { enabled: input.enabled, revision: resultRevision },
                    });
                    if (updated.count !== 1) throw new SourceRevisionConflictError(input.sourceId);
                }
                const resultRow = await tx.sourceInstance.findUniqueOrThrow({ where: { id: input.sourceId } });
                const snapshot = await this.toSourceSnapshot(resultRow, tx);
                await tx.sourceActivationCommand.create({
                    data: {
                        id: randomUUID(),
                        sourceInstanceId: input.sourceId,
                        idempotencyKey: input.idempotencyKey,
                        requestHash,
                        enabled: input.enabled,
                        baseRevisionId: input.baseRevisionId,
                        resultRevision,
                        resultSnapshotJson: JSON.stringify(snapshot),
                    },
                });
                return { snapshot };
            });
            if (outcome.snapshot) return outcome.snapshot;
            source = await this.prisma.sourceInstance.findUniqueOrThrow({ where: { id: input.sourceId } });
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;
            const existing = await this.prisma.sourceActivationCommand.findUnique({
                where: { idempotencyKey: input.idempotencyKey },
            });
            if (!existing || existing.sourceInstanceId !== input.sourceId || existing.requestHash !== requestHash) {
                throw new SourceRevisionConflictError(input.sourceId);
            }
            if (existing.resultSnapshotJson) {
                return JSON.parse(existing.resultSnapshotJson) as SourceSnapshot;
            }
            source = await this.prisma.sourceInstance.findUniqueOrThrow({ where: { id: input.sourceId } });
        }
        return this.toSourceSnapshot(source);
    }

    async createConnection(input: CreateConnectionCommand): Promise<ConnectionInstance> {
        const connection = await this.prisma.connectionInstance.create({
            data: {
                name: input.name,
                connectorId: input.connectorId,
                account: input.account ?? null,
                scopeJson: input.scopeJson ?? null,
                secretRef: input.secretRef ?? null,
            },
        });
        return this.toConnectionSnapshot(connection);
    }

    async listConnections(): Promise<readonly ConnectionInstance[]> {
        const connections = await this.prisma.connectionInstance.findMany({
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        return connections.map((connection) => this.toConnectionSnapshot(connection));
    }

    async getConnection(connectionId: string): Promise<ConnectionInstance | null> {
        const connection = await this.prisma.connectionInstance.findUnique({
            where: { id: connectionId },
        });
        return connection ? this.toConnectionSnapshot(connection) : null;
    }

    async updateConnection(connectionId: string, input: UpdateConnectionCommand): Promise<ConnectionInstance> {
        const current = await this.prisma.connectionInstance.findUnique({
            where: { id: connectionId },
        });
        if (!current) throw new ConnectionNotFoundError(connectionId);
        const updated = await this.prisma.connectionInstance.update({
            where: { id: connectionId },
            data: {
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.status !== undefined ? { status: input.status } : {}),
                ...(input.secretRef !== undefined ? { secretRef: input.secretRef } : {}),
                ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
            },
        });
        return this.toConnectionSnapshot(updated);
    }

    /**
     * 删除 Connection（AUT-001 的「删除凭据」）：来源回退 `connectionId: null`、连接行删除，
     * 并在同一动作里删除 SecretStore 中该 `secretRef` 的密钥字节。
     *
     * 顺序是「先删行、后删密钥」：行删掉后这次删除就已经完成，密钥字节残留只是可清理的垃圾；
     * 反过来先删密钥、行删失败会留下一个指向空密钥的活连接，反而更难发现。密钥删除失败只记
     * warn、不让删除失败（重试删除是幂等的）。
     */
    async deleteConnection(connectionId: string): Promise<boolean> {
        const connection = await this.prisma.connectionInstance.findUnique({
            where: { id: connectionId },
            select: { secretRef: true },
        });
        await this.prisma.$transaction(async (tx) => {
            await tx.sourceInstance.updateMany({
                where: { connectionId },
                data: { connectionId: null },
            });
            await tx.connectionInstance.delete({ where: { id: connectionId } });
        });
        const secretRef = connection?.secretRef;
        if (secretRef) {
            try {
                await this.secrets.delete(secretRef);
            } catch (error) {
                this.logger?.warn("connection.secret.delete_failed", {
                    connectionId,
                    secretRef,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return true;
    }

    /**
     * 删除来源（AUT-001）：墓碑 + 移除调度绑定，已录入的 Entry/Observation/Revision 全部保留
     * （Entry.sourceInstanceId 是必填级联外键，硬删会带走历史，所以来源行留下）。
     *
     * 不建命令表：删除天然幂等——重复调用返回同一份墓碑快照、不重复写事件；CAS 只拦
     * 「拿旧 revision 去删一个已经被改过的来源」。actor/reason 进 DomainEvent 保留审计（ORG-010）。
     */
    async deleteSource(input: {
        sourceId: string;
        baseRevisionId: string;
        idempotencyKey: string;
        actor: string | null;
        reason: string | null;
    }): Promise<SourceSnapshot> {
        const expectedRevision = parseSourceRevisionId(input.sourceId, input.baseRevisionId);
        const current = await this.prisma.sourceInstance.findUnique({ where: { id: input.sourceId } });
        if (!current) throw new SourceNotFoundError(input.sourceId);
        if (current.deletedAt) {
            return this.toSourceSnapshot(current);
        }
        if (current.revision !== expectedRevision) {
            throw new SourceRevisionConflictError(input.sourceId);
        }
        await this.prisma.$transaction(async (tx) => {
            const updated = await tx.sourceInstance.updateMany({
                where: { id: input.sourceId, revision: expectedRevision, deletedAt: null },
                data: { deletedAt: new Date(), enabled: false, revision: expectedRevision + 1 },
            });
            if (updated.count !== 1) throw new SourceRevisionConflictError(input.sourceId);
            await tx.triggerBinding.deleteMany({ where: { sourceId: input.sourceId } });
            await appendDomainEvent(tx, {
                type: "source.deleted.v1",
                aggregateType: "SourceInstance",
                aggregateId: input.sourceId,
                idempotencyKey: input.idempotencyKey,
                payload: {
                    sourceId: input.sourceId,
                    baseRevisionId: input.baseRevisionId,
                    actor: input.actor,
                    reason: input.reason,
                },
            });
        });
        return this.toSourceSnapshot(
            await this.prisma.sourceInstance.findUniqueOrThrow({ where: { id: input.sourceId } }),
        );
    }

    async listScheduleTriggers(): Promise<readonly {
        sourceId: string;
        intervalMs: number;
        lastRunAt: string | null;
    }[]> {
        const bindings = await this.prisma.triggerBinding.findMany({
            where: { kind: "schedule", enabled: true },
            include: { source: { select: { id: true, enabled: true, deletedAt: true } } },
        });
        const result: { sourceId: string; intervalMs: number; lastRunAt: string | null }[] = [];
        for (const binding of bindings) {
            // 删除来源会移除绑定；这里再挡一次，避免历史数据里残留的绑定把墓碑来源排进调度。
            if (!binding.source.enabled || binding.source.deletedAt) continue;
            const config = JSON.parse(binding.configJson) as { intervalMs?: number };
            if (typeof config.intervalMs !== "number") continue;
            const latest = await this.prisma.workflowRun.findFirst({
                where: { sourceInstanceId: binding.sourceId },
                orderBy: { createdAt: "desc" },
                select: { finishedAt: true, createdAt: true },
            });
            result.push({
                sourceId: binding.sourceId,
                intervalMs: config.intervalMs,
                lastRunAt: latest ? (latest.finishedAt ?? latest.createdAt).toISOString() : null,
            });
        }
        return result;
    }

    async getStorageStats(): Promise<StorageStats> {
        const databaseBytes = await fileSize(this.roots.databasePath);
        const blob = await directorySize(this.roots.blobRoot);
        const artifact = await directorySize(this.roots.artifactRoot);
        const cache = await directorySize(this.roots.cacheRoot);
        const log = await directorySize(this.roots.logRoot);
        const secret = await directorySize(this.roots.secretRoot);

        const cleanable = await this.prisma.asset.aggregate({
            _sum: { byteSize: true },
            where: { status: "saved" },
        });
        const cleanableBytes = cleanable._sum.byteSize ?? 0;

        return {
            databaseBytes,
            blobBytes: blob.bytes,
            blobFileCount: blob.fileCount,
            artifactBytes: artifact.bytes,
            cacheBytes: cache.bytes,
            logBytes: log.bytes,
            secretBytes: secret.bytes,
            categories: {
                raw: blob.bytes + databaseBytes,
                user: databaseBytes,
                rebuildable: cache.bytes + log.bytes,
                cleanable: cleanableBytes,
            },
            snapshotAt: new Date().toISOString(),
        };
    }

    async listBackups(): Promise<readonly BackupSnapshot[]> {
        const dir = join(this.roots.dataRoot, "backups");
        let entries: string[] = [];
        try {
            entries = await readdir(dir);
        } catch {
            return [];
        }
        const snapshots: BackupSnapshot[] = [];
        for (const name of entries) {
            if (!name.endsWith(".sqlite")) continue;
            const info = await stat(join(dir, name)).catch(() => null);
            if (!info || !info.isFile()) continue;
            snapshots.push({
                id: name,
                name,
                byteSize: info.size,
                createdAt: info.birthtime.toISOString(),
            });
        }
        return snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    async createBackup(): Promise<BackupSnapshot> {
        const now = new Date();
        const name = `backup-${now.toISOString().replaceAll(":", "-").replaceAll(".", "-")}.sqlite`;
        const dir = join(this.roots.dataRoot, "backups");
        await mkdir(dir, { recursive: true });
        const target = join(dir, name);
        await this.prisma.$executeRawUnsafe(`VACUUM INTO '${target.replaceAll("\\", "/")}'`);
        const info = await stat(target);
        return {
            id: name,
            name,
            byteSize: info.size,
            createdAt: info.birthtime.toISOString(),
        };
    }

    async restoreBackup(backupId: string): Promise<void> {
        const dir = join(this.roots.dataRoot, "backups");
        const source = join(dir, backupId);
        const sourceInfo = await stat(source).catch(() => null);
        if (!sourceInfo || !sourceInfo.isFile()) {
            throw new Error(`Backup not found: ${backupId}`);
        }
        // Protect the current state before overwriting it.
        const now = new Date();
        const preRestore = join(dir, `pre-restore-${now.toISOString().replaceAll(":", "-").replaceAll(".", "-")}.sqlite`);
        await this.prisma.$executeRawUnsafe(`VACUUM INTO '${preRestore.replaceAll("\\", "/")}'`);
        await copyFile(source, this.roots.databasePath);
    }

}

/**
 * 计划的媒体预算从来源配置继承（ADR-0023 决策 6，字段语义沿用 ADR-0014）。
 * 没有配置时保持 null —— 那表示「跟随全局默认」，不是空策略。
 */
function extractMediaPolicy(config: unknown): string | null {
    if (config === null || typeof config !== "object") {
        return null;
    }
    const media = (config as { media?: unknown }).media;
    return media === undefined ? null : JSON.stringify(media);
}
