import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
    MemoryDefinitionRegistry,
    MemoryValueStore,
    WorkflowBackendConflictError,
    WorkflowRunNotFoundError,
    deferredActivityConformanceCases,
    type DeferredActivityConformanceHarness,
    type WorkflowRunState,
    workflowBackendConformanceCases,
    workflowRunnerBackendConformanceCases,
} from "@notnotype/nb-workflow";
import { PrismaClient } from "@prisma/client";

import {
    PrismaWorkflowBackend,
    createWorkflowEnvelopeMarker,
    WorkflowStateIntegrityError,
} from "./workflow-backend.js";
import { PrismaWorkflowHostStore } from "./workflow-host-store.js";

const roots: string[] = [];
const clients = new Set<PrismaClient>();
const databasePaths = new WeakMap<PrismaWorkflowBackend, string>();

afterEach(async () => {
    await Promise.all([...clients].map((client) => client.$disconnect()));
    clients.clear();
    await Promise.all(roots.splice(0).map((root) => rm(root, {
        recursive: true,
        force: true,
    })));
});

describe("PrismaWorkflowBackend", () => {
    for (const testCase of workflowBackendConformanceCases) {
        it(`backend conformance: ${testCase.name}`, async () => {
            const backend = await createBackend();
            await testCase.run(() => backend);
        });
    }

    for (const testCase of workflowRunnerBackendConformanceCases) {
        it(`runner conformance: ${testCase.name}`, async () => {
            const backend = await createBackend();
            await testCase.run(() => backend);
        });
    }

    for (const testCase of deferredActivityConformanceCases) {
        it(`deferred Activity conformance: ${testCase.name}`, async () => {
            const backend = await createBackend();
            const host = new PrismaWorkflowHostStore(backend.prisma);
            const harness: DeferredActivityConformanceHarness = {
                backend,
                deferredActivities: {
                    startAction: (request) => host.startAction(request),
                },
                values: new MemoryValueStore(),
                definitions: new MemoryDefinitionRegistry(),
            };
            await testCase.run(() => harness);
        });
    }

    it("round-trips state across Prisma clients and rejects stale revisions", async () => {
        const backend = await createBackend();
        const initial = sampleRun("restart-round-trip");
        await backend.createRun(initial);
        const saved = await backend.saveRun({
            ...initial,
            status: "completed",
            result: { kind: "inline", value: { ok: true } },
            updatedAt: "2026-08-13T00:00:01.000Z",
        }, 0);
        expect(saved.revision).toBe(1);
        await expect(backend.prisma.workflowRun.findUnique({ where: { id: initial.runId } }))
            .resolves.toMatchObject({ finishedAt: new Date("2026-08-13T00:00:01.000Z") });
        const databasePath = databasePathFor(backend);
        await backend.prisma.$disconnect();
        clients.delete(backend.prisma);

        const client = new PrismaClient({
            datasources: { db: { url: `file:${databasePath}` } },
        });
        clients.add(client);
        const reopened = new PrismaWorkflowBackend(client);
        await expect(reopened.loadRun(initial.runId)).resolves.toMatchObject({
            status: "completed",
            revision: 1,
        });
        await expect(reopened.saveRun({
            ...saved,
            logs: ["stale"],
            updatedAt: "2026-08-13T00:00:02.000Z",
        }, 0)).rejects.toBeInstanceOf(WorkflowBackendConflictError);
    });

    it("rejects immutable identity changes and missing runs", async () => {
        const backend = await createBackend();
        const initial = sampleRun("immutable");
        await backend.createRun(initial);
        await expect(backend.saveRun({
            ...initial,
            input: { kind: "inline", value: { changed: true } },
            updatedAt: "2026-08-13T00:00:01.000Z",
        }, 0)).rejects.toBeInstanceOf(WorkflowStateIntegrityError);
        await expect(backend.saveRun({
            ...initial,
            runId: "missing",
        }, 0)).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
    });

    it("fails closed when persisted state JSON or projection is corrupt", async () => {
        const backend = await createBackend();
        const initial = sampleRun("corrupt");
        await backend.createRun(initial);
        await backend.prisma.workflowRun.update({
            where: { id: initial.runId },
            data: { stateJson: "not-json" },
        });
        await expect(backend.loadRun(initial.runId)).rejects.toBeInstanceOf(WorkflowStateIntegrityError);
    });

    it("adopts envelope-only runs atomically and conceals them from Kernel reads", async () => {
        const backend = await createBackend();
        expect(backend.capabilities).toMatchObject({
            durability: "durable",
            processRestart: true,
            concurrentExecution: true,
            multiWorker: true,
            leases: true,
            externalReceipts: true,
            valueReferences: true,
        });
        const runId = "envelope-adoption";
        const createdAt = "2026-08-13T00:00:00.000Z";
        const marker = createWorkflowEnvelopeMarker(runId);
        await backend.prisma.workflowRun.create({
            data: {
                id: runId,
                stateJson: JSON.stringify(marker),
                kernelRevision: 0,
                status: "queued",
                resumeRequired: false,
                definitionKey: "cosmos.ingest",
                definitionVersion: "1",
                manifestHash: "sha256:host",
                idempotencyKey: "idem-envelope-adoption",
                inputSnapshotJson: JSON.stringify({ sourceId: "source-1" }),
                productRunJson: JSON.stringify({ status: "queued" }),
                createdAt: new Date(createdAt),
                updatedAt: new Date(createdAt),
            },
        });

        await expect(backend.loadRun(runId)).resolves.toBeNull();
        await expect(backend.listRuns()).resolves.toEqual([]);

        const initial = sampleRun(runId, createdAt);
        const adopted = await backend.createRun(initial);
        expect(adopted).toMatchObject({
            runId,
            revision: 0,
            status: "running",
        });
        await expect(backend.loadRun(runId)).resolves.toMatchObject({
            runId,
            status: "running",
        });
        await expect(backend.listRuns()).resolves.toHaveLength(1);

        const adoptedRow = await backend.prisma.workflowRun.findUnique({
            where: { id: runId },
        });
        expect(adoptedRow).toMatchObject({
            idempotencyKey: "idem-envelope-adoption",
            inputSnapshotJson: JSON.stringify({ sourceId: "source-1" }),
            productRunJson: JSON.stringify({ status: "queued" }),
            createdAt: new Date(createdAt),
        });

        await expect(backend.createRun(initial)).rejects.toBeInstanceOf(
            WorkflowBackendConflictError,
        );
    });
});

async function createBackend(): Promise<PrismaWorkflowBackend> {
    const root = await mkdtemp(join(tmpdir(), "cosmos-workflow-backend-"));
    roots.push(root);
    const databasePath = join(root, "cosmos.sqlite");
    const client = new PrismaClient({
        datasources: { db: { url: `file:${databasePath}` } },
    });
    clients.add(client);
    const backend = new PrismaWorkflowBackend(client);
    databasePaths.set(backend, databasePath);
    // Test setup uses the checked-in migration without touching a user's database.
    execFileSync(process.execPath, [
        resolve(process.cwd(), "packages/storage-prisma/node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--schema",
        resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma"),
    ], {
        env: {
            ...process.env,
            DATABASE_URL: `file:${databasePath}`,
        },
        stdio: "ignore",
    });
    return backend;
}

function databasePathFor(backend: PrismaWorkflowBackend): string {
    const path = databasePaths.get(backend);
    if (!path) {
        throw new Error("SQLite database path was not registered.");
    }
    return path;
}


function sampleRun(runId: string, createdAt = "2026-08-13T00:00:00.000Z"): WorkflowRunState {
    return {
        runId,
        definition: {
            key: "conformance",
            version: "1",
            manifestHash: "sha256:conformance",
        },
        input: {
            kind: "inline",
            value: { case: runId },
        },
        extensionContext: {},
        status: "running",
        resumeRequired: false,
        cancelRequestedAt: null,
        budget: null,
        checkpoint: null,
        pendingAsks: [],
        pendingWaits: [],
        pendingActivities: [],
        activityCompletions: [],
        logs: [],
        progress: null,
        journal: [],
        revision: 0,
        createdAt,
        updatedAt: createdAt,
    };
}
