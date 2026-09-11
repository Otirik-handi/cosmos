import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { type CreateSourceCommand, type ConnectionInstance, type CreateConnectionCommand, type UpdateConnectionCommand, type StorageStats, type BackupSnapshot, type SourceActivationCommand, type SourceSnapshot, type UpdateSourceCommand } from "@cosmos/contracts";
import { ConnectionNotFoundError, SourceNotFoundError, SourceRevisionConflictError } from "@cosmos/application";
import { type Prisma } from "@prisma/client";
import { directorySize, fileSize, parseSourceRevisionId } from "../storage-root.js";
import { isUniqueConstraintError, sourceActivationRequestHash } from "./repository-internals.js";
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
            if (input.scheduleIntervalMs !== undefined) {
                await tx.triggerBinding.create({
                    data: {
                        sourceId: created.id,
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
            orderBy: { createdAt: "asc" },
        });
        return Promise.all(sources.map((source) => this.toSourceSnapshot(source)));
    }

    async getSource(sourceId: string): Promise<SourceSnapshot | null> {
        const source = await this.prisma.sourceInstance.findUnique({
            where: { id: sourceId },
        });
        return source ? this.toSourceSnapshot(source) : null;
    }

    async updateSource(sourceId: string, input: UpdateSourceCommand): Promise<SourceSnapshot> {
        const expectedRevision = parseSourceRevisionId(sourceId, input.baseRevisionId);
        const current = await this.prisma.sourceInstance.findUnique({ where: { id: sourceId } });
        if (!current) throw new SourceNotFoundError(sourceId);
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

    async deleteConnection(connectionId: string): Promise<boolean> {
        await this.prisma.$transaction(async (tx) => {
            await tx.sourceInstance.updateMany({
                where: { connectionId },
                data: { connectionId: null },
            });
            await tx.connectionInstance.delete({ where: { id: connectionId } });
        });
        return true;
    }

    async listScheduleTriggers(): Promise<readonly {
        sourceId: string;
        intervalMs: number;
        lastRunAt: string | null;
    }[]> {
        const bindings = await this.prisma.triggerBinding.findMany({
            where: { kind: "schedule", enabled: true },
            include: { source: { select: { id: true, enabled: true } } },
        });
        const result: { sourceId: string; intervalMs: number; lastRunAt: string | null }[] = [];
        for (const binding of bindings) {
            if (!binding.source.enabled) continue;
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
