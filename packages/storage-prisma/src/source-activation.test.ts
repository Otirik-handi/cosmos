import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { IngestionService, type IngestConnector } from "@cosmos/application";
import { PrismaCosmosRepository } from "./index.js";
import { createFixtureSource, prepareDatabase, temporaryRoots } from "./index.fixtures.js";

    it("makes source activation idempotent and rejects stale or mismatched retries", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-source-activation-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const created = await repository.createSource({
                name: "Activation fixture",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            expect(created).toMatchObject({
                enabled: false,
                revisionId: `${created.id}:1`,
            });

            const activated = await repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-1",
                enabled: true,
                baseRevisionId: created.revisionId,
            });
            expect(activated).toMatchObject({
                enabled: true,
                revisionId: `${created.id}:2`,
            });

            await expect(repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-1",
                enabled: true,
                baseRevisionId: created.revisionId,
            })).resolves.toMatchObject({
                enabled: true,
                revisionId: `${created.id}:2`,
            });

            await expect(repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-1",
                enabled: false,
                baseRevisionId: created.revisionId,
            })).rejects.toMatchObject({ code: "conflict" });

            await expect(repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-2",
                enabled: false,
                baseRevisionId: created.revisionId,
            })).rejects.toMatchObject({ code: "conflict" });

            await expect(repository.prisma.sourceActivationCommand.findMany({
                orderBy: { createdAt: "asc" },
            })).resolves.toHaveLength(1);
        } finally {
            await repository.close();
        }
    });


    it("records no-op activation commands without incrementing the source revision", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-source-activation-noop-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const created = await repository.createSource({
                name: "Activation no-op fixture",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            const activated = await repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-noop-1",
                enabled: true,
                baseRevisionId: created.revisionId,
            });
            const replayedIntent = await repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-noop-2",
                enabled: true,
                baseRevisionId: activated.revisionId,
            });

            expect(replayedIntent.revisionId).toBe(activated.revisionId);
            await expect(repository.prisma.sourceActivationCommand.findMany({
                orderBy: { createdAt: "asc" },
                select: { resultRevision: true },
            })).resolves.toEqual([
                { resultRevision: 2 },
                { resultRevision: 2 },
            ]);
        } finally {
            await repository.close();
        }
    });

    it("rejects a stale no-op activation instead of recording it", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-source-activation-stale-noop-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const created = await repository.createSource({
                name: "Stale no-op fixture",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            await repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-stale-1",
                enabled: true,
                baseRevisionId: created.revisionId,
            });

            // Desired state matches, but baseRevisionId points at :1 while
            // the source is now at :2; ADR-0004 requires conflict.
            await expect(repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-stale-2",
                enabled: true,
                baseRevisionId: created.revisionId,
            })).rejects.toMatchObject({ code: "conflict" });

            await expect(repository.prisma.sourceActivationCommand.count())
                .resolves.toBe(1);
        } finally {
            await repository.close();
        }
    });

    it("replays the recorded activation result after the source moved forward", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-source-activation-replay-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const created = await repository.createSource({
                name: "Replay fixture",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            const activated = await repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-replay-1",
                enabled: true,
                baseRevisionId: created.revisionId,
            });

            // A later PATCH moves the source to :3 with a new name and config.
            await repository.updateSource(created.id, {
                baseRevisionId: activated.revisionId,
                name: "Renamed fixture",
                config: { scheduleIntervalMs: 60_000 },
            });

            const replayed = await repository.activateSource({
                sourceId: created.id,
                idempotencyKey: "source-activation-replay-1",
                enabled: true,
                baseRevisionId: created.revisionId,
            });

            // Same key + same request still returns the full first recorded
            // result — name, config and updatedAt stay frozen at the
            // activation moment, not the renamed :3 projection.
            expect(replayed.name).toBe("Replay fixture");
            expect(replayed.enabled).toBe(true);
            expect(replayed.revisionId).toBe(`${created.id}:2`);
            expect(replayed.config).toEqual({});
            expect(replayed.updatedAt).toBe(activated.updatedAt);
            await expect(repository.prisma.sourceActivationCommand.findMany())
                .resolves.toHaveLength(1);
        } finally {
            await repository.close();
        }
    });

    it("refreshes metrics without creating a revision and keeps publisher ids nullable", async () => {
        const root = await mkdtemp(join(tmpdir(), "cosmos-metrics-test-"));
        temporaryRoots.push(root);
        prepareDatabase(root);

        const repository = new PrismaCosmosRepository({ dataRoot: root });
        await repository.initialize();

        try {
            const source = await createFixtureSource(repository, {
                name: "Metrics fixture",
                config: {},
            });
            let likes = 1;
            let exactPublishedAt = false;
            const connector: IngestConnector = {
                id: "metrics-test",
                description: "Metrics test",
                configVersion: "v1",
                capabilities: ["test"],
                validate: () => undefined,
                async fetchItems() {
                    return {
                        items: [{
                            externalId: "metrics-item",
                            title: "Metrics item",
                            summary: null,
                            contentText: "Stable body",
                            webUrl: null,
                            kind: "video",
                            publisher: {
                                platformId: null,
                                name: "Author without id",
                                handle: null,
                                profileUrl: null,
                                kind: "unknown",
                                metrics: null,
                            },
                            metrics: {
                                values: { likes },
                                raw: { likes: String(likes) },
                                reliability: "high",
                                capturedAt: "2026-08-10T00:00:00.000Z",
                            },
                            publishedAt: exactPublishedAt
                                ? {
                                    exact: "2026-08-10T00:00:00.000Z",
                                    exactPrecision: "second",
                                    fallback: null,
                                }
                                : {
                                    exact: null,
                                    exactPrecision: null,
                                    fallback: {
                                        raw: "今天",
                                        lowerBound: "2026-08-10T00:00:00.000Z",
                                        precision: "day",
                                        timezone: "UTC",
                                        confidence: "inferred",
                                    },
                                },
                            updatedAt: null,
                            sourceLocator: {
                                provider: "metrics-test",
                            },
                            rawPayload: JSON.stringify({ likes }),
                            assets: [],
                        }],
                        nextCursor: null,
                    };
                },
            };
            const service = new IngestionService(repository, () => connector);

            const first = await service.runSource(source.id);
            likes = 2;
            exactPublishedAt = true;
            const second = await service.runSource(source.id);

            expect(first.createdEntryCount).toBe(1);
            expect(second.revisedEntryCount).toBe(0);
            expect(second.duplicateObservationCount).toBe(1);

            const entries = await repository.entries({
                sourceId: source.id,
                limit: 20,
            });
            expect(entries.items[0]).toMatchObject({
                contentKind: "video",
                publisher: {
                    platformId: null,
                    name: "Author without id",
                },
                metrics: {
                    values: { likes: 2 },
                },
            });

            const detail = await repository.entry(entries.items[0]!.id);
            expect(detail?.revisions).toHaveLength(1);
            expect(detail?.revisions[0]?.publishedAt).toMatchObject({
                exact: "2026-08-10T00:00:00.000Z",
                fallback: null,
            });
            expect((await repository.feed({ limit: 20 })).items[0]?.storyKind)
                .toBe("media");
        } finally {
            await repository.close();
        }
    });

