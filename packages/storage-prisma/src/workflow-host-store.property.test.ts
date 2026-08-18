import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import fc from "fast-check";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaWorkflowHostStore } from "./workflow-host-store.js";

const definition = {
    key: "cosmos.ingest",
    version: "1",
    manifestHash: "sha256:cosmos-ingest",
} as const;

let root: string;
let client: PrismaClient;
let store: PrismaWorkflowHostStore;
let runSequence = 0;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "cosmos-workflow-lease-property-"));
    const databasePath = join(root, "property.sqlite");
    execFileSync(process.execPath, [
        resolve(process.cwd(), "packages/storage-prisma/node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--schema",
        resolve(process.cwd(), "packages/storage-prisma/prisma/schema.prisma"),
    ], {
        env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
        stdio: "ignore",
    });
    client = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
    store = new PrismaWorkflowHostStore(client);
});

afterAll(async () => {
    await client.$disconnect();
    await rm(root, { recursive: true, force: true });
});

describe("PrismaWorkflowHostStore lease fencing properties", () => {
    it("accepts only the current unexpired Run lease identity", async () => {
        await fc.assert(
            fc.asyncProperty(fc.integer({ min: 10, max: 10_000 }), async (leaseMs) => {
                runSequence += 1;
                const runId = `lease-property-${runSequence}`;
                const now = new Date("2026-08-18T00:00:00.000Z");
                await store.createWorkflowEnvelope({
                    runId,
                    idempotencyKey: `${runId}:enqueue`,
                    definition,
                    inputSnapshot: { sourceId: "source-1", cursor: null },
                    productRun: {
                        status: "queued",
                        sourceId: "source-1",
                        triggerKind: "manual",
                    },
                });

                const first = await store.claimRun({
                    owner: "worker-a",
                    leaseMs,
                    runId,
                    now,
                });
                expect(first).not.toBeNull();
                if (!first) throw new Error("expected initial Run lease");

                const wrongOwnerAt = new Date(now.getTime() + 1);
                await expect(store.heartbeatRun({
                    ...first,
                    owner: "worker-b",
                    leaseMs,
                    now: wrongOwnerAt,
                })).resolves.toBe(false);

                const takeoverAt = new Date(now.getTime() + leaseMs + 1);
                const takeover = await store.claimRun({
                    owner: "worker-b",
                    leaseMs,
                    runId,
                    now: takeoverAt,
                });
                expect(takeover).not.toBeNull();
                if (!takeover) throw new Error("expected expired Run takeover");

                await expect(store.heartbeatRun({
                    ...first,
                    leaseMs,
                    now: takeoverAt,
                })).resolves.toBe(false);
                await expect(store.releaseRun({
                    ...first,
                    now: takeoverAt,
                })).resolves.toBe(false);
                await expect(store.heartbeatRun({
                    ...takeover,
                    leaseMs,
                    now: takeoverAt,
                })).resolves.toBe(true);
                await expect(store.releaseRun({
                    ...takeover,
                    now: takeoverAt,
                })).resolves.toBe(true);
            }),
            { numRuns: 40 },
        );
    });
});
