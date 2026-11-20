import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { WorkflowHostConflictError, WorkflowHostError, type CreateWorkflowEnvelopeInput } from "@cosmos/application";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resolvePrismaCliPath } from "../prisma-cli.js";
import * as queuedEvents from "./internals-events-lease.js";
import { createWorkflowEnvelopeInTransaction, PrismaWorkflowHostEnvelopeStore } from "./envelope-store.js";

let client: PrismaClient;
let store: PrismaWorkflowHostEnvelopeStore;
function input(id: string): CreateWorkflowEnvelopeInput {
    return { runId: id, idempotencyKey: `key-${id}`,
        definition: { key: "synthetic.envelope", version: "1", manifestHash: "synthetic-hash" },
        inputSnapshot: { storyId: "story", content: "frozen" },
        productRun: { status: "queued", sourceId: "synthetic-source", triggerKind: "manual" },
        createdAt: "2026-11-19T00:00:00.000Z" };
}
const uniqueError = () => new Prisma.PrismaClientKnownRequestError("Synthetic unique conflict", { code: "P2002", clientVersion: "test" });
beforeAll(async () => {
    const parent = resolve(process.cwd(), ".agent/tmp");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, "task43-s1a-envelope-"));
    const databaseUrl = `file:${join(root, "cosmos.sqlite").replaceAll("\\", "/")}`;
    console.info(JSON.stringify({ isolatedRoot: root, retained: true }));
    const environment: NodeJS.ProcessEnv = { DATABASE_URL: databaseUrl, COSMOS_DATA_ROOT: root,
        HOME: root, USERPROFILE: root, TEMP: root, TMP: root, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" };
    for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
        if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    const log = openSync(join(root, "deploy.log"), "wx");
    try {
        const result = spawnSync(process.execPath, [resolvePrismaCliPath(), "migrate", "deploy", "--schema",
            resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma")],
        { cwd: root, env: environment, stdio: ["ignore", log, log], timeout: 60_000 });
        if (result.error || result.status !== 0) throw new Error(`Envelope fixture deployment failed; inspect ${root}`);
    } finally {
        closeSync(log);
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    store = new PrismaWorkflowHostEnvelopeStore(client);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await client?.$disconnect(); });

describe("Workflow envelope transaction helper", () => {
    it("preserves public creation, snapshots, queued event and same-key identity replay", async () => {
        const request = input("public-create");
        const envelope = await store.createWorkflowEnvelope(request);
        expect(envelope).toMatchObject({ runId: request.runId, idempotencyKey: request.idempotencyKey,
            definition: request.definition, inputSnapshot: request.inputSnapshot, productRun: request.productRun,
            status: "queued", resumeRequired: false, createdAt: request.createdAt, updatedAt: request.createdAt,
            startedAt: null, finishedAt: null });
        expect(await store.hasWorkflowKernelState(request.runId)).toBe(false);
        expect(await store.loadWorkflowEnvelope(request.runId)).toEqual(envelope);
        expect(await store.findWorkflowEnvelopeByIdempotencyKey(request.idempotencyKey!)).toEqual(envelope);
        expect(await store.createWorkflowEnvelope({ ...request, runId: "ignored-replay-id" })).toEqual(envelope);
        const events = await client.domainEvent.findMany({ where: { workflowRunId: request.runId } });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: "run.queued.v1", version: "v1", aggregateType: "WorkflowRun",
            aggregateId: request.runId, workflowRunId: request.runId, runId: null, idempotencyKey: `workflow-run:${request.runId}:queued` });
        expect(JSON.parse(events[0]!.payloadJson)).toEqual({ runId: request.runId, sourceId: "synthetic-source", triggerKind: "manual" });
        expect(await client.workflowRun.findUnique({ where: { id: "ignored-replay-id" } })).toBeNull();
    });
    it("rejects changed identity and ID reuse, preserving the durable original", async () => {
        const request = input("identity");
        await store.createWorkflowEnvelope(request);
        for (const change of [{ inputSnapshot: { changed: true } }, { productRun: { changed: true } },
            { definition: { ...request.definition, manifestHash: "other" } }]) {
            await expect(store.createWorkflowEnvelope({ ...request, ...change })).rejects.toBeInstanceOf(WorkflowHostConflictError);
        }
        await expect(store.createWorkflowEnvelope({ ...request, idempotencyKey: "another-key" })).rejects.toBeInstanceOf(WorkflowHostConflictError);
        await expect(store.createWorkflowEnvelope({ ...request, idempotencyKey: null })).rejects.toBeInstanceOf(WorkflowHostConflictError);
        expect(await client.domainEvent.count({ where: { workflowRunId: request.runId } })).toBe(1);
        await expect(store.createWorkflowEnvelope({ ...input("invalid"), runId: "" })).rejects.toBeInstanceOf(WorkflowHostError);
    });
    it("resolves default source plan and preserves explicit plan selection", async () => {
        await client.sourceInstance.create({ data: { id: "envelope-source", name: "Synthetic", kind: "rss",
            sourceDefinitionRef: "synthetic@1", operationId: "synthetic", configJson: "{}" } });
        await client.collectionPlan.create({ data: { id: "envelope-plan", name: "Synthetic plan", sourceId: "envelope-source" } });
        await store.createWorkflowEnvelope({ ...input("resolved-plan"), sourceId: "envelope-source" });
        await client.$transaction((tx) => createWorkflowEnvelopeInTransaction(tx,
            { ...input("explicit-plan"), planId: "envelope-plan" }));
        for (const id of ["resolved-plan", "explicit-plan"]) {
            expect(await client.workflowRun.findUnique({ where: { id }, select: { planId: true } })).toEqual({ planId: "envelope-plan" });
        }
    });
    it("commits helper writes with the outer transaction and replays without another event", async () => {
        const request = input("helper-commit");
        const result = await client.$transaction(async (tx) => {
            const created = await createWorkflowEnvelopeInTransaction(tx, request);
            expect(await tx.workflowRun.count({ where: { id: request.runId } })).toBe(1);
            expect(await tx.domainEvent.count({ where: { workflowRunId: request.runId } })).toBe(1);
            return created;
        });
        const replay = await client.$transaction((tx) => createWorkflowEnvelopeInTransaction(tx, request));
        expect(replay).toEqual(result);
        expect(await client.domainEvent.count({ where: { workflowRunId: request.runId } })).toBe(1);
    });
    it("rolls back Run and event when the owning outer transaction fails after helper success", async () => {
        const request = input("helper-rollback");
        await expect(client.$transaction(async (tx) => {
            await createWorkflowEnvelopeInTransaction(tx, request);
            expect(await tx.workflowRun.count({ where: { id: request.runId } })).toBe(1);
            expect(await tx.domainEvent.count({ where: { workflowRunId: request.runId } })).toBe(1);
            throw new Error("synthetic outer failure");
        })).rejects.toThrow("synthetic outer failure");
        expect(await client.workflowRun.count({ where: { id: request.runId } })).toBe(0);
        expect(await client.domainEvent.count({ where: { workflowRunId: request.runId } })).toBe(0);
        expect(await store.findWorkflowEnvelopeByIdempotencyKey(request.idempotencyKey!)).toBeNull();
    });
    it("keeps the public Run/event atomic when event writing fails", async () => {
        const request = input("event-failure");
        const eventCreate = vi.spyOn(queuedEvents, "appendWorkflowRunQueuedEvent").mockRejectedValueOnce(new Error("synthetic event failure"));
        await expect(store.createWorkflowEnvelope(request)).rejects.toThrow("synthetic event failure");
        eventCreate.mockRestore();
        expect(await client.workflowRun.count({ where: { id: request.runId } })).toBe(0);
        expect(await client.domainEvent.count({ where: { workflowRunId: request.runId } })).toBe(0);
    });
    it("rereads the committed P2002 winner outside the transaction and checks identity", async () => {
        const request = input("unique-winner");
        const original = await store.createWorkflowEnvelope(request);
        const transaction = vi.fn<typeof client.$transaction>().mockRejectedValueOnce(uniqueError());
        const racingStore = new PrismaWorkflowHostEnvelopeStore(new Proxy(client, {
            get(target, property, receiver) {
                return property === "$transaction" ? transaction : Reflect.get(target, property, receiver);
            },
        }));
        expect(await racingStore.createWorkflowEnvelope({ ...request, runId: "losing-run" })).toEqual(original);
        expect(transaction).toHaveBeenCalledTimes(1);
        transaction.mockRejectedValueOnce(uniqueError());
        await expect(racingStore.createWorkflowEnvelope({ ...request, inputSnapshot: { other: "identity" } })).rejects.toBeInstanceOf(WorkflowHostConflictError);
        expect(await client.workflowRun.count({ where: { id: "losing-run" } })).toBe(0);
        expect(await client.domainEvent.count({ where: { workflowRunId: request.runId } })).toBe(1);
    });
    it("handles the P2002 ID winner, missing winner and non-unique errors without swallowing them", async () => {
        const request = input("id-winner");
        await store.createWorkflowEnvelope(request);
        const transaction = vi.fn<typeof client.$transaction>().mockRejectedValueOnce(uniqueError());
        const failingStore = new PrismaWorkflowHostEnvelopeStore(new Proxy(client, {
            get(target, property, receiver) {
                return property === "$transaction" ? transaction : Reflect.get(target, property, receiver);
            },
        }));
        await expect(failingStore.createWorkflowEnvelope({ ...request, idempotencyKey: null })).rejects.toBeInstanceOf(WorkflowHostConflictError);
        transaction.mockRejectedValueOnce(uniqueError());
        await expect(failingStore.createWorkflowEnvelope(input("no-winner"))).rejects.toMatchObject({ code: "unavailable" });
        transaction.mockRejectedValueOnce(new Error("synthetic transport failure"));
        await expect(failingStore.createWorkflowEnvelope(input("transport-failure"))).rejects.toThrow("synthetic transport failure");
    });
});
