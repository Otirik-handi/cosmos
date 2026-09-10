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
    const root = await mkdtemp(join(tmpdir(), "cosmos-trigger-binding-"));
    roots.push(root);
    prepareDatabase(root);
    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();
    return repository;
}

describe("PrismaCosmosRepository trigger binding (ADR-0018)", () => {
    it("creates a schedule TriggerBinding on source create and exposes it", async () => {
        const repository = await createRepository();
        try {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
                scheduleIntervalMs: 60_000,
            });
            expect(source.scheduleIntervalMs).toBe(60_000);

            // Disabled sources are excluded from the scheduler loop.
            await expect(repository.listScheduleTriggers()).resolves.toEqual([]);

            const activated = await repository.activateSource({
                sourceId: source.id,
                enabled: true,
                baseRevisionId: source.revisionId,
                idempotencyKey: "activate-1",
            });
            expect(activated.scheduleIntervalMs).toBe(60_000);
            await expect(repository.listScheduleTriggers()).resolves.toEqual([
                { sourceId: source.id, intervalMs: 60_000, lastRunAt: null },
            ]);
        } finally {
            await repository.close();
        }
    });

    it("upserts and removes the schedule via updateSource", async () => {
        const repository = await createRepository();
        try {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            expect(source.scheduleIntervalMs).toBeNull();

            const scheduled = await repository.updateSource(source.id, {
                baseRevisionId: source.revisionId,
                scheduleIntervalMs: 120_000,
            });
            expect(scheduled.scheduleIntervalMs).toBe(120_000);

            const cleared = await repository.updateSource(source.id, {
                baseRevisionId: scheduled.revisionId,
                scheduleIntervalMs: null,
            });
            expect(cleared.scheduleIntervalMs).toBeNull();
            await expect(repository.listScheduleTriggers()).resolves.toEqual([]);
        } finally {
            await repository.close();
        }
    });
});
