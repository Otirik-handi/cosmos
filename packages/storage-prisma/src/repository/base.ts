import { createBuiltinManifestCatalog, type CatalogPort, type LoggerPort, type SecretStorePort } from "@cosmos/application";
import { FileBlobStore } from "@cosmos/blob-store";
import { PrismaClient } from "@prisma/client";
import { FileSecretStore } from "../secret-store.js";
import { recordSqlitePragmaFacts } from "../sqlite-diagnostics.js";
import { type StorageRoots, createPrismaClient, resolveStorageRoots } from "../storage-root.js";

export class PrismaCosmosRepositoryBase {
    readonly roots: StorageRoots;
    readonly prisma: PrismaClient;
    readonly blobs: FileBlobStore;
    readonly secrets: SecretStorePort;
    protected readonly logger?: LoggerPort;
    protected readonly catalog: CatalogPort;

    constructor(options: {
        dataRoot?: string;
        prisma?: PrismaClient;
        blobs?: FileBlobStore;
        secrets?: SecretStorePort;
        logger?: LoggerPort;
        catalog?: CatalogPort;
    } = {}) {
        this.roots = resolveStorageRoots(options.dataRoot);
        this.prisma = options.prisma ?? createPrismaClient(this.roots.dataRoot);
        this.blobs = options.blobs ?? new FileBlobStore({
            root: this.roots.blobRoot,
        });
        this.secrets = options.secrets ?? new FileSecretStore({ root: this.roots.secretRoot });
        this.logger = options.logger;
        this.catalog = options.catalog ?? createBuiltinManifestCatalog();
    }

    async initialize(): Promise<void> {
        const startedAt = Date.now();
        this.logger?.info("storage.initialize.started");
        try {
            await this.prisma.$connect();
            // 诊断运行时把这次连接的 SQLite 环境事实（journal_mode/busy_timeout/synchronous）
            // 写进证据；关掉开关时这行是 no-op。
            await recordSqlitePragmaFacts(this.prisma);
            await this.prisma.$executeRawUnsafe(`
                CREATE VIRTUAL TABLE IF NOT EXISTS entry_search USING fts5(
                    entry_id UNINDEXED,
                    title,
                    content_text,
                    tokenize = 'unicode61'
                )
            `);
            this.logger?.info("storage.initialize.completed", {
                durationMs: Date.now() - startedAt,
            });
        } catch (error) {
            this.logger?.error("storage.initialize.failed", {
                durationMs: Date.now() - startedAt,
            }, error);
            throw error;
        }
    }

    async close(): Promise<void> {
        this.logger?.debug("storage.close.started");
        try {
            await this.prisma.$disconnect();
            this.logger?.debug("storage.close.completed");
        } catch (error) {
            this.logger?.error("storage.close.failed", {}, error);
            throw error;
        }
    }
}
