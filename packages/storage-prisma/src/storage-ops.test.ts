import { describe, expect, it } from "vitest";

import { withRepository } from "./index.fixtures.js";

describe("PrismaCosmosRepository storage ops (ADR-0019)", () => {
    it("reports storage occupancy with non-negative sizes and categories", async () => {
        await withRepository("storage-ops", async (repository) => {
            const stats = await repository.getStorageStats();
            expect(stats.databaseBytes).toBeGreaterThan(0);
            expect(stats.blobBytes).toBeGreaterThanOrEqual(0);
            expect(stats.cacheBytes).toBeGreaterThanOrEqual(0);
            expect(stats.categories.raw).toBeGreaterThanOrEqual(stats.databaseBytes);
            expect(stats.categories.user).toBe(stats.databaseBytes);
        });
    });

    it("creates, lists and restores a database backup", async () => {
        await withRepository("storage-ops", async (repository) => {
            await repository.createSource({
                name: "种子来源",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });

            const backup = await repository.createBackup();
            expect(backup.byteSize).toBeGreaterThan(0);

            const list = await repository.listBackups();
            expect(list).toHaveLength(1);
            expect(list[0]?.id).toBe(backup.id);

            await repository.restoreBackup(backup.id);
            // Restore creates a pre-restore protection backup.
            const after = await repository.listBackups();
            expect(after.length).toBeGreaterThanOrEqual(2);
        });
    });
});
