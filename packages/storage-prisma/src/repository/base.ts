import { createBuiltinManifestCatalog, type CatalogPort, type LoggerPort } from "@cosmos/application";
import { FileBlobStore } from "@cosmos/blob-store";
import { PrismaClient } from "@prisma/client";
import { type StorageRoots, createPrismaClient, resolveStorageRoots } from "../storage-root.js";

export class PrismaCosmosRepositoryBase {
    readonly roots: StorageRoots;
    readonly prisma: PrismaClient;
    readonly blobs: FileBlobStore;
    protected readonly logger?: LoggerPort;
    protected readonly catalog: CatalogPort;

    constructor(options: {
        dataRoot?: string;
        prisma?: PrismaClient;
        blobs?: FileBlobStore;
        logger?: LoggerPort;
        catalog?: CatalogPort;
    } = {}) {
        this.roots = resolveStorageRoots(options.dataRoot);
        this.prisma = options.prisma ?? createPrismaClient(this.roots.dataRoot);
        this.blobs = options.blobs ?? new FileBlobStore({
            root: this.roots.blobRoot,
        });
        this.logger = options.logger;
        this.catalog = options.catalog ?? createBuiltinManifestCatalog();
    }

    async initialize(): Promise<void> {
        const startedAt = Date.now();
        this.logger?.info("storage.initialize.started");
        try {
            await this.prisma.$connect();
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
