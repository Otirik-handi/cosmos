import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { PrismaCosmosRepository } from "./index.js";
import { captureLogger, createFixtureSource, prepareDatabase, temporaryRoots } from "./index.fixtures.js";

    it("deduplicates queued commands, takes over expired leases, and rejects stale completion", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-job-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await createFixtureSource(repository, {
                name: "Queue fixture",
                config: {},
            });
            const first = await repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "manual-command-1",
            });
            const duplicate = await repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "manual",
                idempotencyKey: "manual-command-1",
            });

            expect(duplicate.id).toBe(first.id);

            const originalLease = await repository.claimNextJob({
                owner: "worker-a",
                leaseMs: -1,
                acceptedKinds: ["source-ingest", "source-probe"],
            });
            expect(originalLease?.attempts).toBe(1);

            const takeover = await repository.claimNextJob({
                owner: "worker-b",
                leaseMs: 60_000,
                acceptedKinds: ["source-ingest", "source-probe"],
            });
            expect(takeover?.attempts).toBe(2);

            expect(await repository.completeJob({
                jobId: originalLease!.id,
                leaseToken: originalLease!.leaseToken,
                status: "succeeded",
            })).toBe(false);
            expect(await repository.completeJob({
                jobId: takeover!.id,
                leaseToken: takeover!.leaseToken,
                status: "retry_wait",
                error: "transient",
                retryDelayMs: 0,
            })).toBe(true);

            const retry = await repository.claimNextJob({
                owner: "worker-b",
                leaseMs: 60_000,
                acceptedKinds: ["source-ingest", "source-probe"],
            });
            expect(retry?.attempts).toBe(3);
            expect(await repository.completeJob({
                jobId: retry!.id,
                leaseToken: retry!.leaseToken,
                status: "succeeded",
            })).toBe(true);

            expect(await repository.latestEventSequence()).toBeGreaterThan(0);
            expect((await repository.events({
                afterSequence: 0,
                limit: 100,
            })).some((event) => event.type === "job.succeeded.v1")).toBe(true);
        } finally {
            await repository.close();
        }
    });

    it("keeps workflow activity jobs out of legacy claims", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-accepted-kinds-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await createFixtureSource(repository, {
                name: "Accepted kinds fixture",
                config: {},
            });
            await repository.prisma.job.create({
                data: {
                    kind: "workflow-activity",
                    status: "queued",
                    payloadJson: JSON.stringify({ runId: "workflow-run-1" }),
                    idempotencyKey: "workflow-activity-1",
                },
            });
            const run = await repository.createQueuedRun({
                sourceId: source.id,
                triggerKind: "manual",
            });

            await expect(repository.claimNextJob({
                owner: "legacy-worker",
                leaseMs: 60_000,
                acceptedKinds: [],
            })).resolves.toBeNull();
            const claimed = await repository.claimNextJob({
                owner: "legacy-worker",
                leaseMs: 60_000,
                acceptedKinds: ["source-ingest", "source-probe"],
            });

            expect(claimed?.kind).toBe("source-ingest");
            expect(claimed?.runId).toBe(run.id);
            expect(await repository.getJob((await repository.prisma.job.findUniqueOrThrow({
                where: { idempotencyKey: "workflow-activity-1" },
                select: { id: true },
            })).id)).toMatchObject({
                kind: "workflow-activity",
                status: "queued",
            });
        } finally {
            await repository.close();
        }
    });

    it("logs claim competition and terminal attempts with source correlation", async () => {
        const { logger, records } = captureLogger();
        const candidate = {
            id: "job-logging",
            runId: "run-logging",
            kind: "source-ingest",
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            leaseToken: null,
            leaseExpiresAt: null,
            payloadJson: JSON.stringify({ sourceId: "source-logging" }),
        };
        const prisma = {
            $transaction: async (
                callback: (transaction: unknown) => unknown,
            ) => callback({
                job: {
                    findFirst: async () => candidate,
                    updateMany: async () => ({ count: 0 }),
                    update: async () => candidate,
                },
                run: {
                    update: async () => undefined,
                },
                domainEvent: {
                    create: async () => undefined,
                },
            }),
        };
        const repository = new PrismaCosmosRepository({
            prisma: prisma as never,
            logger,
        });

        await expect(repository.claimNextJob({
            owner: "worker-logging",
            leaseMs: 5_000,
            acceptedKinds: ["source-ingest", "source-probe"],
        })).resolves.toBeNull();
        candidate.attempts = candidate.maxAttempts;
        await expect(repository.claimNextJob({
            owner: "worker-logging",
            leaseMs: 5_000,
            acceptedKinds: ["source-ingest", "source-probe"],
        })).resolves.toBeNull();

        expect(records).toContainEqual(expect.objectContaining({
            event: "job.claim_rejected",
            level: "debug",
            jobId: "job-logging",
            runId: "run-logging",
            sourceId: "source-logging",
            reason: "lease_competition",
        }));
        expect(records).toContainEqual(expect.objectContaining({
            event: "job.failed_terminal",
            level: "error",
            jobId: "job-logging",
            runId: "run-logging",
            sourceId: "source-logging",
            errorCode: "max_attempts",
        }));
    });

    it("logs both storage health query and heartbeat failures", async () => {
        const queryFailure = captureLogger();
        const queryFailingRepository = new PrismaCosmosRepository({
            prisma: {
                $queryRawUnsafe: async () => {
                    throw new Error("database unavailable");
                },
            } as never,
            logger: queryFailure.logger,
        });
        await expect(queryFailingRepository.health()).resolves.toMatchObject({
            storageStatus: "failed",
        });
        expect(queryFailure.records).toContainEqual(expect.objectContaining({
            event: "storage.health.failed",
            stage: "query",
        }));

        const heartbeatFailure = captureLogger();
        const heartbeatFailingRepository = new PrismaCosmosRepository({
            prisma: {
                $queryRawUnsafe: async () => 1,
                workerHeartbeat: {
                    findFirst: async () => {
                        throw new Error("heartbeat unavailable");
                    },
                },
            } as never,
            logger: heartbeatFailure.logger,
        });
        await expect(heartbeatFailingRepository.health()).resolves.toMatchObject({
            storageStatus: "failed",
        });
        expect(heartbeatFailure.records).toContainEqual(expect.objectContaining({
            event: "storage.health.failed",
            stage: "worker_heartbeat",
        }));
    });

