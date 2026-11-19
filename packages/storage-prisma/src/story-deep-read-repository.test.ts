import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import type { HostActionExecutionFence } from "@cosmos/application";
import { canonicalJson } from "@notnotype/nb-workflow";
import type { InputProjection } from "@cosmos/contracts";
import { PrismaCosmosRepository } from "./index.js";
import { type EnqueueStoryDeepReadInput, type PublishStoryDeepReadRevisionInput } from "./repository/story-deep-read.js";
import { createWorkflowEnvelopeInTransaction } from "./workflow-host-store/envelope-store.js";
import { deploySchema, sqliteUrl } from "./schema-template.js";

let root: string;
let template: string;
beforeAll(async () => {
    const parent = resolve(".agent/tmp");
    await mkdir(parent, { recursive: true });
    root = await mkdtemp(join(parent, "task43-s1b-"));
    template = join(root, "template.sqlite");
    await writeFile(template, new Uint8Array());
    deploySchema(template);
});
afterAll(async () => {
    if (root && root.startsWith(resolve(".agent/tmp/task43-s1b-"))) await rm(root, { recursive: true, force: true });
});
async function database(body: (repository: PrismaCosmosRepository, prisma: PrismaClient, second: PrismaCosmosRepository) => Promise<void>) {
    const path = join(root, randomUUID());
    await mkdir(path);
    const file = join(path, "cosmos.sqlite");
    await copyFile(template, file);
    const prisma = new PrismaClient({ datasources: { db: { url: sqliteUrl(file) } } });
    const other = new PrismaClient({ datasources: { db: { url: sqliteUrl(file) } } });
    const repository = new PrismaCosmosRepository({ prisma, dataRoot: path });
    const second = new PrismaCosmosRepository({ prisma: other, dataRoot: path });
    try {
        await prisma.story.createMany({ data: [{ id: "story", kind: "document" }, { id: "other", kind: "document" }] });
        await body(repository, prisma, second);
    } finally {
        vi.restoreAllMocks();
        await Promise.all([prisma.$disconnect(), other.$disconnect()]);
    }
}
const projection: InputProjection = {
    storyRevisionId: "story-revision", omittedSourceCount: 0,
    sources: [{ entryId: "entry", entryRevisionId: "entry-revision", representationVersion: 1, blockIds: ["b1"],
        includedCharacterCount: 12, truncated: false, omitted: false, reason: null }],
};
function withOmittedSources(): InputProjection {
    return { ...projection, omittedSourceCount: 2, sources: [...projection.sources,
        { entryId: "omitted-null", entryRevisionId: "missing-null", representationVersion: null, blockIds: [],
            includedCharacterCount: 0, omitted: true, truncated: false, reason: "unavailable" },
        { entryId: "omitted-version", entryRevisionId: "missing-version", representationVersion: 3, blockIds: [],
            includedCharacterCount: 0, omitted: true, truncated: false, reason: "budget" },
    ] };
}
function enqueue(key: string = randomUUID(), storyId = "story", input: InputProjection = projection): EnqueueStoryDeepReadInput {
    return {
        storyId, runId: randomUUID(), idempotencyKey: key,
        requestHash: createHash("sha256").update(canonicalJson({ storyId, modelId: null })).digest("hex"),
        definition: { key: "cosmos.story-deep-read", version: "1", manifestHash: "sha256:deep-read" },
        inputSnapshot: { kind: "story-deep-read", storyId, resolvedModelId: "frozen-model", input,
            messages: [{ role: "user", content: "private-source-body-once" }],
            budget: { maxDurationMs: 60_000, maxToolCalls: 0, maxOutputTokens: 6000 } },
        productRun: { kind: "story-deep-read", storyId },
    };
}
async function fence(prisma: PrismaClient, runId: string): Promise<HostActionExecutionFence> {
    const expiry = new Date(Date.now() + 600_000);
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "running", kernelRevision: 2,
        runLeaseOwner: "host", runLeaseToken: "run-token", runLeaseExpiresAt: expiry } });
    const activity = { key: "publish", path: "root", seq: 1, kind: "action" as const, fingerprint: "sha256:publish" };
    const job = await prisma.job.create({ data: { workflowRunId: runId, kind: "workflow-activity", status: "leased",
        workflowKernelRevision: 2, attempts: 1, leaseOwner: "host", leaseToken: "job-token", leaseExpiresAt: expiry,
        idempotencyKey: `${runId}:publish`, payloadJson: JSON.stringify({ activity }) } });
    return { workflowRunId: runId, jobId: job.id, activity, kernelRevision: 2, attempt: 1, runLeaseToken: "run-token", jobLeaseToken: "job-token" };
}
function publish(fence: HostActionExecutionFence, headline = "Report"): PublishStoryDeepReadRevisionInput {
    return { workflowRunId: fence.workflowRunId, fence, headline,
        sections: [{ id: "s1", heading: "Facts", kind: "fact", blocks: [{ id: "s1-b1", type: "paragraph", data: { inlines: [{ type: "text", text: "Report body" }] } }],
            evidence: [{ entryId: "entry", entryRevisionId: "entry-revision", representationVersion: 1, blockId: "b1" }] }],
        producerVersion: "story-deep-read@1", provider: "fake", model: "fixture",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, cost: { input: 0, output: 0, total: 0, currency: "USD" } };
}

it("distinguishes a missing Story from an existing Story without an Artifact", async () => {
    await database(async (repo, prisma) => {
        await expect(repo.getStoryDeepReadArtifact("missing-story")).rejects.toMatchObject({ code: "not_found", retryable: false });
        expect(await repo.getStoryDeepReadArtifact("story")).toBeNull();
        expect(await prisma.artifact.count()).toBe(0);
    });
});

it("looks up a request with its original Run and never repairs its slot", async () => {
    await database(async (repo, prisma) => {
        expect(await repo.findStoryDeepReadRequest("missing-request")).toBeNull();
        const input = enqueue("request-read");
        const created = await repo.enqueueStoryDeepRead(input);
        await prisma.workflowRun.update({ where: { id: input.runId }, data: { status: "failed" } });
        const beforeArtifact = await prisma.artifact.findMany();
        const beforeRequests = await prisma.deepReadRequest.findMany();
        const beforeEvents = await prisma.domainEvent.findMany();
        const result = await repo.findStoryDeepReadRequest("request-read");
        expect(result).toEqual({ storyId: input.storyId, requestHash: input.requestHash,
            run: { ...created.run, status: "failed", updatedAt: expect.any(String) } });
        expect(await prisma.artifact.findMany()).toEqual(beforeArtifact);
        expect(await prisma.deepReadRequest.findMany()).toEqual(beforeRequests);
        expect(await prisma.domainEvent.findMany()).toEqual(beforeEvents);
    });
});

it("rejects a recorded request with corrupt JSON or a missing Run instead of treating it as new", async () => {
    await database(async (repo, prisma) => {
        const input = enqueue("broken-request");
        await repo.enqueueStoryDeepRead(input);
        await prisma.workflowRun.update({ where: { id: input.runId }, data: { inputSnapshotJson: "invalid JSON" } });
        await expect(repo.findStoryDeepReadRequest("broken-request")).rejects.toMatchObject({ code: "malformed_payload", retryable: false });
        // Restrict blocks a missing Run in normal operation; simulate a damaged legacy reference.
        await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
        await prisma.$executeRawUnsafe('DELETE FROM "WorkflowRun" WHERE "id" = ?', input.runId);
        await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
        await expect(repo.findStoryDeepReadRequest("broken-request")).rejects.toMatchObject({ code: "conflict", retryable: false });
        expect(await prisma.deepReadRequest.count()).toBe(1);
    });
});

it("atomically creates envelope, queued event, artifact slot and receipt, and restores the original Run", async () => {
    await database(async (repo, prisma) => {
        expect(await repo.getStoryDeepReadArtifact("story")).toBeNull();
        const input = enqueue();
        const created = await repo.enqueueStoryDeepRead(input);
        expect(created.reused).toBe(false);
        expect(await prisma.artifact.findUnique({ where: { id: created.artifactId } })).toMatchObject({ activeRunId: input.runId });
        expect(await prisma.deepReadRequest.findUnique({ where: { workflowRunId: input.runId } })).toMatchObject({ requestHash: input.requestHash });
        expect(await prisma.domainEvent.count({ where: { type: "run.queued.v1" } })).toBe(1);
        expect(await repo.getStoryDeepReadArtifact("story")).toMatchObject({ revisions: [], current: null,
            generation: { runId: input.runId, modelId: "frozen-model", status: "queued" } });
        const replay = await repo.enqueueStoryDeepRead({ ...input, runId: "unused", inputSnapshot: null });
        expect(replay).toEqual({ ...created, reused: true });
        await expect(repo.enqueueStoryDeepRead({ ...input, requestHash: "f".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
        await expect(repo.enqueueStoryDeepRead(enqueue())).rejects.toMatchObject({ code: "conflict" });
        expect(await prisma.workflowRun.count()).toBe(1);
        expect(await prisma.deepReadRequest.count()).toBe(1);
    });
});

it("rejects global cross-definition keys, cross-Story replays and missing/shell Stories", async () => {
    await database(async (repo, prisma) => {
        const input = enqueue("global");
        await prisma.$transaction((tx) => createWorkflowEnvelopeInTransaction(tx, { ...input, definition: { ...input.definition, key: "cosmos.ingest" } }));
        await expect(repo.enqueueStoryDeepRead(input)).rejects.toMatchObject({ code: "conflict" });
        expect(await prisma.artifact.count()).toBe(0);
        const own = enqueue("own");
        await repo.enqueueStoryDeepRead(own);
        await expect(repo.enqueueStoryDeepRead({ ...enqueue("own", "other"), requestHash: own.requestHash })).rejects.toMatchObject({ code: "conflict" });
        await expect(repo.enqueueStoryDeepRead(enqueue("missing", "missing"))).rejects.toMatchObject({ code: "not_found" });
        await prisma.storyReplacement.create({ data: { storyId: "other", successorStoryId: "story" } });
        await expect(repo.enqueueStoryDeepRead(enqueue("shell", "other"))).rejects.toMatchObject({ code: "invalid_configuration" });
        expect(await prisma.deepReadRequest.count()).toBe(1);
    });
});

it.each(["completed", "failed", "cancelled"])("self-heals a %s slot and preserves permanent replay", async (status) => {
    await database(async (repo, prisma) => {
        const input = enqueue();
        await repo.enqueueStoryDeepRead(input);
        await prisma.workflowRun.update({ where: { id: input.runId }, data: { status } });
        expect((await repo.getStoryDeepReadArtifact("story"))?.generation).toBeNull();
        const next = await repo.enqueueStoryDeepRead(enqueue());
        expect(next.reused).toBe(false);
        expect((await repo.enqueueStoryDeepRead(input)).run.runId).toBe(input.runId);
        expect(await prisma.artifact.findUnique({ where: { id: next.artifactId } })).toMatchObject({ activeRunId: next.run.runId });
        expect(await prisma.workflowRun.count()).toBe(2);
    });
});

it.each(["storyId", "resolvedModelId", "storyRevisionId", "entryId", "entryRevisionId", "blockId", "representationVersion", "emptyModel"])("rejects invalid frozen identity %s before any writes", async (field) => {
    await database(async (repo, prisma) => {
        const input = enqueue();
        const tooLong = "x".repeat(201);
        if (field === "storyId") input.storyId = tooLong;
        const sources = projection.sources.map((source) => ({ ...source,
            entryId: field === "entryId" ? tooLong : source.entryId,
            entryRevisionId: field === "entryRevisionId" ? tooLong : source.entryRevisionId,
            blockIds: field === "blockId" ? [tooLong] : source.blockIds,
            representationVersion: field === "representationVersion" ? 0 : source.representationVersion,
        }));
        input.inputSnapshot = { kind: "story-deep-read", storyId: input.storyId,
            resolvedModelId: field === "resolvedModelId" ? tooLong : field === "emptyModel" ? "   " : "model",
            input: { ...projection, sources, storyRevisionId: field === "storyRevisionId" ? tooLong : projection.storyRevisionId },
            messages: [{ role: "user", content: "fixture" }], budget: { maxDurationMs: 60_000, maxToolCalls: 0, maxOutputTokens: 6000 } };
        await expect(repo.enqueueStoryDeepRead(input)).rejects.toMatchObject({ code: "invalid_configuration", retryable: false });
        expect(await prisma.workflowRun.count()).toBe(0);
        expect(await prisma.artifact.count()).toBe(0);
        expect(await prisma.deepReadRequest.count()).toBe(0);
        expect(await prisma.domainEvent.count()).toBe(0);
    });
});

it("self-heals a missing Run slot without using activeStartedAt as a timeout", async () => {
    await database(async (repo, prisma) => {
        const original = await repo.enqueueStoryDeepRead(enqueue());
        await prisma.artifact.update({ where: { id: original.artifactId }, data: { activeStartedAt: new Date(0) } });
        await expect(repo.enqueueStoryDeepRead(enqueue())).rejects.toMatchObject({ code: "conflict" });
        // Restrict prevents ordinary dangling slots; inject one only to exercise recovery from legacy/corrupt data.
        await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
        await prisma.artifact.update({ where: { id: original.artifactId }, data: { activeRunId: "missing-run" } });
        await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
        const recovered = await repo.enqueueStoryDeepRead(enqueue());
        expect(await prisma.artifact.findUnique({ where: { id: original.artifactId } })).toMatchObject({ activeRunId: recovered.run.runId });
    });
});

it.each([true, false])("serializes concurrent enqueues with sameKey=%s using two real clients", async (sameKey) => {
    await database(async (repo, prisma, second) => {
        const first = enqueue("race-a");
        const other = { ...enqueue(sameKey ? "race-a" : "race-b") };
        const results = await Promise.allSettled([repo.enqueueStoryDeepRead(first), second.enqueueStoryDeepRead(other)]);
        const fulfilled = results.filter((result) => result.status === "fulfilled");
        expect(fulfilled).toHaveLength(sameKey ? 2 : 1);
        if (sameKey) {
            expect(fulfilled.map((result) => result.value.run.runId)[0]).toBe(fulfilled.map((result) => result.value.run.runId)[1]);
            expect(fulfilled.filter((result) => !result.value.reused)).toHaveLength(1);
        } else {
            expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
        }
        expect(await prisma.workflowRun.count()).toBe(1);
        expect(await prisma.deepReadRequest.count()).toBe(1);
        expect(await prisma.domainEvent.count()).toBe(1);
    });
});

it("re-reads the durable P2002 winner outside the rolled-back transaction", async () => {
    await database(async (repo, prisma) => {
        const input = enqueue();
        const winner = await repo.enqueueStoryDeepRead(input);
        vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }));
        expect(await repo.enqueueStoryDeepRead({ ...input, runId: "loser" })).toEqual({ ...winner, reused: true });
        expect(await prisma.workflowRun.count()).toBe(1);
    });
});

it("does not retry a non-Artifact P2002 without a durable winner", async () => {
    await database(async (repo, prisma) => {
        let attempts = 0;
        const instrumented = new Proxy(prisma, { get(target, property) {
            if (property === "$transaction") return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => target.$transaction(async (tx) => {
                attempts++;
                await callback(tx);
                throw new Prisma.PrismaClientKnownRequestError("unique fixture", {
                    code: "P2002", clientVersion: "test", meta: { modelName: "WorkflowRun", target: ["id"] },
                });
            });
            return Reflect.get(target, property, target);
        } });
        const subject = new PrismaCosmosRepository({ prisma: instrumented, dataRoot: repo.roots.dataRoot });
        await expect(subject.enqueueStoryDeepRead(enqueue())).rejects.toMatchObject({ code: "conflict", retryable: false });
        expect(attempts).toBe(1);
        expect(await prisma.workflowRun.count()).toBe(0);
        expect(await prisma.artifact.count()).toBe(0);
        expect(await prisma.deepReadRequest.count()).toBe(0);
        expect(await prisma.domainEvent.count()).toBe(0);
    });
});

it("retries a confirmed Artifact story/kind P2002 at its creation boundary", async () => {
    await database(async (repo, prisma) => {
        let attempts = 0;
        const instrumented = new Proxy(prisma, { get(target, property) {
            if (property === "$transaction") return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => target.$transaction(async (tx) => {
                if (++attempts === 1) vi.spyOn(tx.artifact, "upsert").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique fixture", {
                    code: "P2002", clientVersion: "test", meta: { modelName: "Artifact", target: ["storyId", "kind"] },
                }));
                return callback(tx);
            });
            return Reflect.get(target, property, target);
        } });
        const subject = new PrismaCosmosRepository({ prisma: instrumented, dataRoot: repo.roots.dataRoot });
        expect((await subject.enqueueStoryDeepRead(enqueue())).reused).toBe(false);
        expect(attempts).toBe(2);
        expect(await prisma.workflowRun.count()).toBe(1);
        expect(await prisma.artifact.count()).toBe(1);
        expect(await prisma.deepReadRequest.count()).toBe(1);
        expect(await prisma.domainEvent.count()).toBe(1);
    });
});

it.each(["P2034", "SQLITE_BUSY"])("bounds %s transaction failures at three attempts", async (code) => {
    await database(async (repo, prisma) => {
        const fault = code === "P2034" ? new Prisma.PrismaClientKnownRequestError("conflict", { code, clientVersion: "test" }) : new Error("SQLITE_BUSY: fixture");
        let attempts = 0;
        const instrumented = new Proxy(prisma, { get(target, property) {
            if (property === "$transaction") return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
                if (++attempts <= 3) return Promise.reject(fault);
                return target.$transaction(callback);
            };
            return Reflect.get(target, property, target);
        } });
        const subject = new PrismaCosmosRepository({ prisma: instrumented, dataRoot: repo.roots.dataRoot });
        await expect(subject.enqueueStoryDeepRead(enqueue())).rejects.toMatchObject({ code: "dependency_unavailable", retryable: true });
        expect(attempts).toBe(3);
        expect(await prisma.workflowRun.count()).toBe(0);
        expect(await prisma.artifact.count()).toBe(0);
        expect(await prisma.deepReadRequest.count()).toBe(0);
        expect(await prisma.domainEvent.count()).toBe(0);
    });
});

it("does not retry a permanent ledger rejection and rolls back the envelope", async () => {
    await database(async (repo, prisma) => {
        await prisma.$executeRawUnsafe('CREATE TRIGGER reject_receipt BEFORE INSERT ON "DeepReadRequest" BEGIN SELECT RAISE(ABORT, \'fixture rejection\'); END');
        let attempts = 0;
        const instrumented = new Proxy(prisma, { get(target, property) {
            if (property === "$transaction") return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
                attempts++;
                return target.$transaction(callback);
            };
            return Reflect.get(target, property, target);
        } });
        const subject = new PrismaCosmosRepository({ prisma: instrumented, dataRoot: repo.roots.dataRoot });
        await expect(subject.enqueueStoryDeepRead(enqueue())).rejects.toMatchObject({ retryable: false });
        expect(attempts).toBe(1);
        expect(await prisma.workflowRun.count()).toBe(0);
        expect(await prisma.artifact.count()).toBe(0);
        expect(await prisma.deepReadRequest.count()).toBe(0);
        expect(await prisma.domainEvent.count()).toBe(0);
    });
});

it("rolls back the new envelope when claiming the slot loses CAS", async () => {
    await database(async (repo, prisma) => {
        await prisma.$executeRawUnsafe('CREATE TRIGGER ignore_claim BEFORE UPDATE ON "Artifact" WHEN NEW.activeRunId IS NOT NULL BEGIN SELECT RAISE(IGNORE); END');
        await expect(repo.enqueueStoryDeepRead(enqueue())).rejects.toMatchObject({ code: "dependency_unavailable", retryable: true });
        expect(await prisma.workflowRun.count()).toBe(0);
        expect(await prisma.artifact.count()).toBe(0);
        expect(await prisma.deepReadRequest.count()).toBe(0);
        expect(await prisma.domainEvent.count()).toBe(0);
    });
});

it("rolls back a publication when clearing the slot loses CAS", async () => {
    await database(async (repo, prisma) => {
        const created = await repo.enqueueStoryDeepRead(enqueue());
        const input = publish(await fence(prisma, created.run.runId));
        await prisma.$executeRawUnsafe('CREATE TRIGGER ignore_release BEFORE UPDATE ON "Artifact" WHEN NEW.activeRunId IS NULL BEGIN SELECT RAISE(IGNORE); END');
        await expect(repo.publishStoryDeepReadRevision(input)).rejects.toMatchObject({ code: "conflict" });
        expect(await prisma.artifactRevision.count()).toBe(0);
        expect(await prisma.domainEvent.count({ where: { type: "artifact.revision_published.v1" } })).toBe(0);
        expect(await prisma.artifact.findUnique({ where: { id: created.artifactId } })).toMatchObject({ activeRunId: created.run.runId });
    });
});

it("rejects a colliding Run id as a business conflict and rolls back its new Artifact", async () => {
    await database(async (repo, prisma) => {
        const input = enqueue();
        await repo.enqueueStoryDeepRead(input);
        await expect(repo.enqueueStoryDeepRead({ ...enqueue("different", "other"), runId: input.runId })).rejects.toMatchObject({ code: "conflict", retryable: false });
        expect(await prisma.workflowRun.count()).toBe(1);
        expect(await prisma.artifact.count()).toBe(1);
    });
});

it("publishes N+1 with a host fence, clears the slot, emits once and replays after lease expiry", async () => {
    await database(async (repo, prisma) => {
        const first = await repo.enqueueStoryDeepRead(enqueue());
        const input = publish(await fence(prisma, first.run.runId));
        const one = await repo.publishStoryDeepReadRevision(input);
        expect(one).toMatchObject({ revision: 1, producer: "agent", input: projection, cost: { total: 0 } });
        expect(await prisma.artifact.findUnique({ where: { id: first.artifactId } })).toMatchObject({ activeRunId: null, activeStartedAt: null });
        await prisma.workflowRun.update({ where: { id: first.run.runId }, data: { runLeaseExpiresAt: new Date(0) } });
        expect(await repo.publishStoryDeepReadRevision(input)).toEqual(one);
        await expect(repo.publishStoryDeepReadRevision({ ...input, headline: "Different" })).rejects.toMatchObject({ code: "conflict" });
        const next = await repo.enqueueStoryDeepRead(enqueue());
        const two = await repo.publishStoryDeepReadRevision(publish(await fence(prisma, next.run.runId)));
        expect(two.revision).toBe(2);
        expect(two.contentHash).toBe(one.contentHash);
        expect(await prisma.artifactRevision.count()).toBe(2);
        expect(await prisma.domainEvent.count({ where: { type: "artifact.revision_published.v1" } })).toBe(2);
        const read = await repo.getStoryDeepReadArtifact("story");
        expect(read?.current?.revision).toBe(2);
        expect(read?.revisions.map((revision) => revision.revision)).toEqual([2, 1]);
        expect(read?.revisions[0]).not.toHaveProperty("sections");
        expect(read?.revisions[0]).not.toHaveProperty("input");
        expect(JSON.stringify(read)).not.toContain("private-source-body-once");
        expect(await repo.getStoryDeepReadRevision("story", 1)).toEqual(one);
        expect(await repo.findStoryDeepReadRevisionByRun(first.run.runId)).toEqual(one);
        expect(await repo.findStoryDeepReadRevisionByRun("missing")).toBeNull();
        await expect(repo.getStoryDeepReadRevision("other", 1)).rejects.toMatchObject({ code: "not_found" });
    });
});

it("rejects every stale fence component and a changed slot without writing revisions or events", async () => {
    await database(async (repo, prisma) => {
        const created = await repo.enqueueStoryDeepRead(enqueue());
        const good = await fence(prisma, created.run.runId);
        const variants: HostActionExecutionFence[] = [
            { ...good, runLeaseToken: "old" }, { ...good, jobLeaseToken: "old" }, { ...good, kernelRevision: 1 },
            { ...good, attempt: 2 }, { ...good, workflowRunId: "other" }, { ...good, activity: { ...good.activity, fingerprint: "old" } },
        ];
        for (const bad of variants) await expect(repo.publishStoryDeepReadRevision({ ...publish(good), fence: bad })).rejects.toMatchObject({ code: "conflict" });
        await prisma.job.update({ where: { id: good.jobId }, data: { leaseExpiresAt: new Date(0) } });
        await expect(repo.publishStoryDeepReadRevision(publish(good))).rejects.toMatchObject({ code: "conflict" });
        await prisma.artifact.update({ where: { id: created.artifactId }, data: { activeRunId: null } });
        await expect(repo.publishStoryDeepReadRevision(publish(good))).rejects.toMatchObject({ code: "conflict" });
        expect(await prisma.artifactRevision.count()).toBe(0);
        expect(await prisma.domainEvent.count({ where: { type: "artifact.revision_published.v1" } })).toBe(0);
    });
});

it.each(["P2034", "SQLITE_LOCKED", "P1001", "P1017", "validation", "unknown"])("classifies a %s storage failure inside fence validation", async (code) => {
    await database(async (repo, prisma) => {
        const created = await repo.enqueueStoryDeepRead(enqueue());
        const input = publish(await fence(prisma, created.run.runId));
        const fault = code === "SQLITE_LOCKED" ? new Error("SQLITE_LOCKED: fixture")
            : code === "validation" ? new Prisma.PrismaClientValidationError("private validation detail", { clientVersion: "test" })
            : code === "unknown" ? new Error("private storage detail")
            : new Prisma.PrismaClientKnownRequestError("private storage detail", { code, clientVersion: "test" });
        let attempts = 0;
        // Keep the real transaction and its earlier reads; only the fence SELECT fails.
        const instrumented = new Proxy(prisma, { get(target, property) {
            if (property === "$transaction") return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => target.$transaction(async (tx) => {
                attempts++;
                vi.spyOn(tx.workflowRun, "findFirst").mockRejectedValueOnce(fault);
                return callback(tx);
            });
            return Reflect.get(target, property, target);
        } });
        const publisher = new PrismaCosmosRepository({ prisma: instrumented, dataRoot: repo.roots.dataRoot });
        const retryable = ["P2034", "SQLITE_LOCKED", "P1001", "P1017"].includes(code);
        await expect(publisher.publishStoryDeepReadRevision(input)).rejects.toMatchObject({
            code: code === "validation" ? "invalid_configuration" : "dependency_unavailable", retryable,
        });
        expect(attempts).toBe(retryable ? 3 : 1);
        expect(await prisma.artifactRevision.count()).toBe(0);
        expect(await prisma.domainEvent.count({ where: { type: "artifact.revision_published.v1" } })).toBe(0);
        expect(await prisma.artifact.findUnique({ where: { id: created.artifactId } })).toMatchObject({ activeRunId: created.run.runId });
    });
});

it("allows publication after merge while rejecting new generation and preserving old-key replay", async () => {
    await database(async (repo, prisma) => {
        const request = enqueue();
        const created = await repo.enqueueStoryDeepRead(request);
        const input = publish(await fence(prisma, created.run.runId));
        await prisma.storyReplacement.create({ data: { storyId: "story", successorStoryId: "other" } });
        expect(await repo.publishStoryDeepReadRevision(input)).toMatchObject({ storyId: "story" });
        expect((await repo.enqueueStoryDeepRead(request)).reused).toBe(true);
        await expect(repo.enqueueStoryDeepRead(enqueue())).rejects.toMatchObject({ code: "invalid_configuration" });
        expect(await repo.getStoryDeepReadArtifact("other")).toBeNull();
    });
});

it("validates sections and frozen evidence, and rolls back revision plus slot when its event fails", async () => {
    await database(async (repo, prisma) => {
        const created = await repo.enqueueStoryDeepRead(enqueue());
        const input = publish(await fence(prisma, created.run.runId));
        const invalidSections = [{ id: "s1", heading: "Bad", kind: "fact", blocks: [], evidence: [{ entryId: "outside", entryRevisionId: "entry-revision", representationVersion: 1 }] }];
        await expect(repo.publishStoryDeepReadRevision({ ...input, sections: invalidSections })).rejects.toMatchObject({ code: "malformed_payload" });
        await expect(repo.publishStoryDeepReadRevision({ ...input, sections: [{ type: "image" }] })).rejects.toMatchObject({ code: "malformed_payload" });
        const oversized = [{ id: "s1", heading: "Huge", kind: "opinion", evidence: [], blocks: Array.from({ length: 4 }, (_, index) => ({ id: `s1-b${index + 1}`, type: "code", data: { text: "x".repeat(60_000) } })) }];
        await expect(repo.publishStoryDeepReadRevision({ ...input, sections: oversized })).rejects.toMatchObject({ code: "malformed_payload" });
        await prisma.$executeRawUnsafe('CREATE TRIGGER reject_publication BEFORE INSERT ON "DomainEvent" WHEN NEW.type = \'artifact.revision_published.v1\' BEGIN SELECT RAISE(ABORT, \'fixture rejection\'); END');
        await expect(repo.publishStoryDeepReadRevision(input)).rejects.toMatchObject({ retryable: false });
        expect(await prisma.artifactRevision.count()).toBe(0);
        expect(await prisma.artifact.findUnique({ where: { id: created.artifactId } })).toMatchObject({ activeRunId: created.run.runId });
    });
});

it("returns at most 50 summaries, maximum current and directly readable older versions; rejects corrupt stored JSON", async () => {
    await database(async (repo, prisma) => {
        const created = await repo.enqueueStoryDeepRead(enqueue());
        await repo.publishStoryDeepReadRevision(publish(await fence(prisma, created.run.runId)));
        const original = await prisma.artifactRevision.findUniqueOrThrow({ where: { workflowRunId: created.run.runId } });
        for (let revision = 2; revision <= 52; revision++) {
            const runId = `historical-${revision}`;
            await prisma.$transaction((tx) => createWorkflowEnvelopeInTransaction(tx, { ...enqueue(), runId }));
            const { id: _id, ...copy } = original;
            await prisma.artifactRevision.create({ data: { ...copy, revision, workflowRunId: runId } });
        }
        const read = await repo.getStoryDeepReadArtifact("story");
        expect(read?.revisions).toHaveLength(50);
        expect(read?.revisions[0]?.revision).toBe(52);
        expect(read?.revisions[49]?.revision).toBe(3);
        expect(read?.current?.revision).toBe(52);
        expect((await repo.getStoryDeepReadRevision("story", 1)).revision).toBe(1);
        await prisma.artifactRevision.update({ where: { id: original.id }, data: { inputJson: '{"prompt":"private"}' } });
        await expect(repo.getStoryDeepReadRevision("story", 1)).rejects.toMatchObject({ code: "malformed_payload" });
    });
});

it.each([
    { entryId: "omitted-null", entryRevisionId: "missing-null", representationVersion: 1 },
    { entryId: "omitted-version", entryRevisionId: "missing-version", representationVersion: 3 },
])("rejects evidence for omitted source $entryId without changing the slot", async (evidence) => {
    await database(async (repo, prisma) => {
        const created = await repo.enqueueStoryDeepRead(enqueue(undefined, undefined, withOmittedSources()));
        const input = publish(await fence(prisma, created.run.runId));
        const before = await prisma.artifact.findUniqueOrThrow({ where: { id: created.artifactId } });
        for (const reference of [evidence, { ...evidence, blockId: "b1" }]) {
            await expect(repo.publishStoryDeepReadRevision({ ...input, sections: [{
                id: "s1", heading: "Omitted source", kind: "fact", blocks: [], evidence: [reference],
            }] })).rejects.toMatchObject({ code: "malformed_payload", retryable: false });
        }
        expect(await prisma.artifactRevision.count()).toBe(0);
        expect(await prisma.artifact.findUniqueOrThrow({ where: { id: created.artifactId } })).toEqual(before);
        expect(await prisma.domainEvent.count({ where: { type: "artifact.revision_published.v1" } })).toBe(0);
    });
});

it("computes current/superseded/unavailable from exact included sources without rewriting publication", async () => {
    await database(async (repo, prisma) => {
        const source = await prisma.sourceInstance.create({ data: { name: "Fixture", kind: "rss", sourceDefinitionRef: "rss@1", operationId: "fetch", configJson: "{}" } });
        await prisma.entry.create({ data: { id: "entry", sourceInstanceId: source.id, canonicalExternalId: "entry", storyId: "story" } });
        const observation = await prisma.observation.create({ data: { sourceInstanceId: source.id, externalKey: "entry", sourceLocatorJson: "{}" } });
        await prisma.entryRevision.create({ data: { id: "entry-revision", entryId: "entry", revision: 1, title: "Source", contentText: "source", contentFingerprint: "hash", evidenceObservationId: observation.id } });
        await prisma.contentRepresentation.create({ data: { id: "representation", entryRevisionId: "entry-revision", representationVersion: 1,
            parserVersion: "fixture", status: "complete", blocksJson: "[]", contentText: "source", qualitySignalsJson: "{}" } });
        await prisma.entry.update({ where: { id: "entry" }, data: { currentRevisionId: "entry-revision" } });
        await prisma.entryRevision.update({ where: { id: "entry-revision" }, data: { currentRepresentationId: "representation" } });
        const frozen = withOmittedSources();
        const created = await repo.enqueueStoryDeepRead(enqueue(undefined, undefined, frozen));
        const published = await repo.publishStoryDeepReadRevision(publish(await fence(prisma, created.run.runId)));
        expect(published.sourceStatus).toBe("current");
        expect(published.input).toEqual(frozen);
        expect((await repo.getStoryDeepReadArtifact("story"))?.current?.input).toEqual(frozen);
        expect((await repo.getStoryDeepReadRevision("story", 1)).input).toEqual(frozen);
        expect((await repo.findStoryDeepReadRevisionByRun(created.run.runId))?.input).toEqual(frozen);
        const before = await prisma.artifactRevision.findMany();
        await prisma.entryRevision.update({ where: { id: "entry-revision" }, data: { currentRepresentationId: null } });
        expect((await repo.getStoryDeepReadRevision("story", 1)).sourceStatus).toBe("superseded");
        await prisma.contentRepresentation.update({ where: { id: "representation" }, data: { status: "failed" } });
        expect((await repo.getStoryDeepReadRevision("story", 1)).sourceStatus).toBe("unavailable");
        expect((await repo.getStoryDeepReadArtifact("story"))?.revisions[0]?.sourceStatus).toBe("unavailable");
        await prisma.contentRepresentation.update({ where: { id: "representation" }, data: { status: "complete", blocksJson: "invalid JSON" } });
        expect((await repo.getStoryDeepReadRevision("story", 1)).sourceStatus).toBe("unavailable");
        expect(await prisma.artifactRevision.findMany()).toEqual(before);
    });
});
