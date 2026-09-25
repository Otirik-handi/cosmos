import { expect, it } from "vitest";
import { IngestionService, type IngestConnector } from "@cosmos/application";
import { createFixtureSource, withRepository } from "./index.fixtures.js";

/**
 * 指标刷新与时间回退的行为回归。原先寄居在 `source-activation.test.ts` 里，那条激活路径
 * 随 ADR-0023 的归属切换删除后，这个用例与本文件主题无关，独立成文件。
 */
it("refreshes metrics without creating a revision and keeps publisher ids nullable", async () => {
    await withRepository("metrics-test", async (repository) => {
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
    });
});
