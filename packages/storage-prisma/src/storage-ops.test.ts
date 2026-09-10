import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { PrismaCosmosRepository } from "./index.js";

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
    const root = await mkdtemp(join(tmpdir(), "cosmos-storage-ops-"));
    roots.push(root);
    prepareDatabase(root);
    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();
    return repository;
}

describe("PrismaCosmosRepository storage ops (ADR-0019)", () => {
    it("reports storage occupancy with non-negative sizes and categories", async () => {
        const repository = await createRepository();
        try {
            const stats = await repository.getStorageStats();
            expect(stats.databaseBytes).toBeGreaterThan(0);
            expect(stats.blobBytes).toBeGreaterThanOrEqual(0);
            expect(stats.cacheBytes).toBeGreaterThanOrEqual(0);
            expect(stats.categories.raw).toBeGreaterThanOrEqual(stats.databaseBytes);
            expect(stats.categories.user).toBe(stats.databaseBytes);
        } finally {
            await repository.close();
        }
    });

    it("creates, lists and restores a database backup", async () => {
        const repository = await createRepository();
        try {
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
        } finally {
            await repository.close();
        }
    });
});
