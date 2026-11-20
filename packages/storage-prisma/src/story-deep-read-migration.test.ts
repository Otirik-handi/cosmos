import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { resolvePrismaCliPath } from "./prisma-cli.js";

const repository = process.cwd();
const source = resolve(repository, "packages/storage-prisma/prisma");
const parent = resolve(repository, ".agent/tmp");
const migration = "20261119150000_story_deep_read_artifact";
const timestamp = new Date("2026-11-19T00:00:00.000Z");

async function snapshot(root: string, current: boolean): Promise<string> {
    const target = join(root, current ? "current" : "legacy");
    await mkdir(join(target, "migrations"), { recursive: true });
    await copyFile(join(source, "schema.prisma"), join(target, "schema.prisma"));
    await copyFile(join(source, "migrations/migration_lock.toml"), join(target, "migrations/migration_lock.toml"));
    const migrations = (await readdir(join(source, "migrations"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    if (migrations.some((name) => name > migration)) throw new Error("Re-audit the Task 43 migration boundary.");
    for (const name of migrations.filter((name) => current || name < migration)) {
        await mkdir(join(target, "migrations", name));
        await copyFile(join(source, "migrations", name, "migration.sql"), join(target, "migrations", name, "migration.sql"));
    }
    return join(target, "schema.prisma");
}
function deploy(root: string, schema: string, label: string): void {
    const environment: NodeJS.ProcessEnv = {
        DATABASE_URL: `file:${join(root, "cosmos.sqlite").replaceAll("\\", "/")}`,
        COSMOS_DATA_ROOT: root, HOME: root, USERPROFILE: root, TEMP: root, TMP: root,
        CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1",
    };
    for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
        if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    const log = openSync(join(root, `${label}.log`), "wx");
    try {
        const result = spawnSync(process.execPath, [resolvePrismaCliPath(), "migrate", "deploy", "--schema", schema],
            { cwd: root, env: environment, stdio: ["ignore", log, log], timeout: 60_000 });
        if (result.error || result.status !== 0) throw new Error(`Migration failed; inspect ${join(root, `${label}.log`)}`);
    } finally {
        closeSync(log);
    }
}
async function seedRun(client: PrismaClient, id: string): Promise<void> {
    await client.workflowRun.create({ data: { id, stateJson: "{}", status: "queued", definitionKey: "synthetic",
        definitionVersion: "1", manifestHash: "synthetic-hash", idempotencyKey: `key-${id}`, createdAt: timestamp, updatedAt: timestamp } });
}
async function oldRows(client: PrismaClient): Promise<Record<string, unknown>> {
    const tables = await client.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table'
        AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_prisma_migrations','Artifact','ArtifactRevision','DeepReadRequest') ORDER BY name`);
    const result: Record<string, unknown> = {};
    for (const table of tables) result[table.name] = await client.$queryRawUnsafe(`SELECT * FROM "${table.name.replaceAll('"', '""')}" ORDER BY rowid`);
    return result;
}
async function insertArtifact(client: PrismaClient, id: string, storyId = "story", activeRunId: string | null = null): Promise<unknown> {
    return client.$executeRawUnsafe(`INSERT INTO "Artifact" (id,storyId,kind,activeRunId,updatedAt) VALUES (?,?,?,?,?)`,
        id, storyId, "story-deep-read", activeRunId, timestamp);
}
async function insertRevision(client: PrismaClient, id: string, revision: number, runId: string, artifactId = "artifact"): Promise<unknown> {
    return client.$executeRawUnsafe(`INSERT INTO "ArtifactRevision"
        (id,artifactId,revision,headline,sectionsJson,inputJson,contentHash,producer,producerVersion,provider,model,workflowRunId)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, artifactId, revision, "Report", "[]", "{}", "a".repeat(64), "agent", "1", "synthetic", "synthetic", runId);
}
async function insertRequest(client: PrismaClient, id: string, key: string, runId: string, storyId = "story"): Promise<unknown> {
    return client.$executeRawUnsafe(`INSERT INTO "DeepReadRequest" (id,idempotencyKey,requestHash,storyId,workflowRunId) VALUES (?,?,?,?,?)`,
        id, key, "a".repeat(64), storyId, runId);
}

async function verifyConstraints(client: PrismaClient): Promise<void> {
    await client.story.create({ data: { id: "story", kind: "event" } });
    await client.story.create({ data: { id: "request-story", kind: "event" } });
    for (const id of ["run-active", "run-1", "run-2", "run-request", "run-request-2"]) await seedRun(client, id);
    await insertArtifact(client, "artifact", "story", "run-active");
    await expect(insertArtifact(client, "duplicate")).rejects.toThrow();
    await expect(insertArtifact(client, "missing-story", "missing")).rejects.toThrow();
    await expect(insertArtifact(client, "missing-run", "request-story", "missing")).rejects.toThrow();
    await insertRevision(client, "revision-1", 1, "run-1");
    await expect(insertRevision(client, "duplicate-version", 1, "run-2")).rejects.toThrow();
    await expect(insertRevision(client, "duplicate-run", 2, "run-1")).rejects.toThrow();
    await expect(insertRevision(client, "missing-artifact", 2, "run-2", "missing")).rejects.toThrow();
    await expect(insertRevision(client, "missing-revision-run", 2, "missing")).rejects.toThrow();
    await insertRevision(client, "revision-2", 2, "run-2");
    await insertRequest(client, "request", "request-key", "run-request", "request-story");
    await expect(insertRequest(client, "duplicate-key", "request-key", "run-request-2")).rejects.toThrow();
    await expect(insertRequest(client, "duplicate-request-run", "other-key", "run-request")).rejects.toThrow();
    await expect(insertRequest(client, "missing-request-story", "missing-key", "run-request-2", "missing")).rejects.toThrow();
    await expect(insertRequest(client, "missing-request-run", "missing-run-key", "missing")).rejects.toThrow();
    // Each parent is protected independently: active slot, publication, request ledger and Story ownership.
    for (const [table, id] of [["Story", "story"], ["Story", "request-story"], ["Artifact", "artifact"],
        ["WorkflowRun", "run-active"], ["WorkflowRun", "run-1"], ["WorkflowRun", "run-request"]]) {
        await expect(client.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id=?`, id)).rejects.toThrow();
    }
    for (const table of ["Artifact", "ArtifactRevision", "DeepReadRequest"]) {
        const foreignKeys = await client.$queryRawUnsafe<{ on_delete: string }[]>(`PRAGMA foreign_key_list('${table}')`);
        expect(foreignKeys).toHaveLength(2);
        expect(foreignKeys.every((key) => key.on_delete === "RESTRICT")).toBe(true);
    }
    const indexes = await client.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='index'
        AND tbl_name IN ('Artifact','ArtifactRevision','DeepReadRequest')`);
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
        "Artifact_storyId_kind_key", "Artifact_activeRunId_idx", "ArtifactRevision_artifactId_revision_key",
        "ArtifactRevision_workflowRunId_key", "DeepReadRequest_idempotencyKey_key", "DeepReadRequest_workflowRunId_key", "DeepReadRequest_storyId_idx",
    ]));
    expect(await client.$queryRawUnsafe(`SELECT usageJson,costJson FROM ArtifactRevision WHERE id='revision-1'`))
        .toEqual([{ usageJson: null, costJson: null }]);
    expect(await client.$queryRawUnsafe(`PRAGMA foreign_key_check`)).toEqual([]);
    expect(await client.$queryRawUnsafe(`PRAGMA integrity_check`)).toEqual([{ integrity_check: "ok" }]);
}

describe("Task 43 additive artifact migration", () => {
    it.each(["fresh", "upgrade"] as const)("applies on %s without changing existing data", async (mode) => {
        await mkdir(parent, { recursive: true });
        const root = await mkdtemp(join(parent, "task43-s1a-migration-"));
        console.info(JSON.stringify({ mode, isolatedRoot: root, retained: true }));
        const client = new PrismaClient({ datasources: { db: { url: `file:${join(root, "cosmos.sqlite").replaceAll("\\", "/")}` } } });
        try {
            let before: Record<string, unknown> | undefined;
            if (mode === "upgrade") {
                deploy(root, await snapshot(root, false), "legacy");
                await client.story.create({ data: { id: "legacy-story", kind: "event", createdAt: timestamp, updatedAt: timestamp } });
                await client.storyRevision.create({ data: { id: "legacy-revision", storyId: "legacy-story", revision: 1,
                    title: "Retained user title", producer: "human", createdAt: timestamp } });
                await seedRun(client, "legacy-run");
                before = await oldRows(client);
            }
            deploy(root, await snapshot(root, true), "current");
            if (before) expect(await oldRows(client)).toEqual(before);
            for (const table of ["Artifact", "ArtifactRevision", "DeepReadRequest"]) {
                expect(await client.$queryRawUnsafe(`SELECT * FROM "${table}"`)).toEqual([]);
            }
            await verifyConstraints(client);
        } finally {
            await client.$disconnect();
        }
    });
});
