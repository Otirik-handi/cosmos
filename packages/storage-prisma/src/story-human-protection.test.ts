import { expect, it } from "vitest";
import { IngestionService, type IngestConnector } from "@cosmos/application";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { PrismaCosmosRepository } from "./index.js";
import { createFixtureSource, withRepository as withSharedRepository } from "./index.fixtures.js";

/**
 * PRD §12 Phase 2 验收第 4 条「重分析不覆盖用户批注和人工关系修正」与 LIB-003
 * 「重新分析、重新索引或刷新后用户数据不丢失」。
 *
 * 今天唯一会覆盖用户编辑的自动写入方是 ingest 的 Entry→Story 投影
 * (`helpers-4.ts` 的 `persistIngestItemInternal`)：来源发布内容修订时它用
 * Entry 的标题/摘要顶掉 Story 的当前 Revision，并把人工填的时间范围与关键
 * 事实清空。保护合同见 `docs/proposals/user-truth-protection-v1.md`。
 */

const HUMAN_TITLE = "人工标题：这条我不希望被来源改回去";
const HUMAN_TIME_RANGE = {
    start: {
        exact: "2026-08-01T00:00:00.000Z",
        exactPrecision: "second" as const,
        fallback: null,
    },
    end: null,
};
const HUMAN_KEY_FACTS = [{ text: "人工关键事实", entryId: null }];

function item(input: {
    externalId: string;
    title: string;
    contentText: string;
}): NormalizedIngestItem {
    return {
        externalId: input.externalId,
        title: input.title,
        summary: `${input.title} 摘要`,
        contentText: input.contentText,
        webUrl: null,
        kind: "article",
        publisher: null,
        metrics: null,
        publishedAt: {
            exact: "2026-08-08T00:00:00.000Z",
            exactPrecision: "second",
            fallback: null,
        },
        updatedAt: null,
        sourceLocator: { provider: "fixture", item: input.externalId },
        rawPayload: `<item>${input.externalId}</item>`,
        assets: [],
    };
}

/** A source whose items can be republished with different content between runs. */
function republishableConnector(pages: () => readonly NormalizedIngestItem[]): IngestConnector {
    return {
        id: "test-human-protection",
        description: "Human protection fixture",
        configVersion: "v1",
        capabilities: ["test"],
        validate: () => undefined,
        async fetchItems() {
            return { items: pages(), nextCursor: null };
        },
    };
}

/** 本文件的场景包装：在共享生命周期之上补来源、录入服务与翻页。 */
async function withRepository(
    name: string,
    body: (context: {
        repository: PrismaCosmosRepository;
        sourceId: string;
        run: () => Promise<void>;
        setPages: (pages: readonly NormalizedIngestItem[]) => void;
    }) => Promise<void>,
): Promise<void> {
    await withSharedRepository(name, async (repository) => {
        const source = await createFixtureSource(repository, { name, config: {} });
        let pages: readonly NormalizedIngestItem[] = [];
        const service = new IngestionService(repository, () => republishableConnector(() => pages));
        await body({
            repository,
            sourceId: source.id,
            run: async () => {
                await service.runSource(source.id);
            },
            setPages: (next) => {
                pages = next;
            },
        });
    });
}

async function onlyStoryId(repository: PrismaCosmosRepository): Promise<string> {
    const feed = await repository.feed({ limit: 10 });
    expect(feed.items).toHaveLength(1);
    return feed.items[0].storyId;
}

async function storyIdByTitle(
    repository: PrismaCosmosRepository,
    title: string,
): Promise<string> {
    const feed = await repository.feed({ limit: 10 });
    const match = await Promise.all(
        feed.items.map((feedItem) => repository.story(feedItem.storyId)),
    );
    const found = match.find((detail) => detail?.story.title === title);
    expect(found).toBeDefined();
    return found!.story.id;
}

it("keeps a human-edited Story representation when the source republishes the Entry", async () => {
    await withRepository("story-human-protection", async ({ repository, run, setPages }) => {
        setPages([item({
            externalId: "entry-a",
            title: "来源原始标题",
            contentText: "原始正文",
        })]);
        await run();
        const storyId = await onlyStoryId(repository);

        const before = await repository.story(storyId);
        expect(before).not.toBeNull();
        const human = await repository.updateStoryRevision({
            storyId,
            baseRevisionId: before!.story.revisionId,
            title: HUMAN_TITLE,
            summary: before!.story.summary,
            kind: "event",
            subtype: null,
            timeRange: HUMAN_TIME_RANGE,
            keyFacts: HUMAN_KEY_FACTS,
        });
        const humanRevisionId = human!.story.revisionId;
        expect(human!.story.title).toBe(HUMAN_TITLE);

        // The source republishes the same Entry with different content: this is the
        // "重新分析 / 重新索引 / 刷新" the acceptance criterion protects against.
        setPages([item({
            externalId: "entry-a",
            title: "来源改过的标题",
            contentText: "改过的正文",
        })]);
        await run();

        const after = await repository.story(storyId);
        expect(after!.story.revisionId).toBe(humanRevisionId);
        expect(after!.story.title).toBe(HUMAN_TITLE);
        expect(after!.story.kind).toBe("event");
        expect(after!.story.timeRange).toEqual(HUMAN_TIME_RANGE);
        expect(after!.story.keyFacts).toEqual(HUMAN_KEY_FACTS);

        // The freeze is recorded rather than silent, and only because the
        // projection would actually have written something (ADR-0028).
        const skipped = await repository.prisma.domainEvent.findMany({
            where: { type: "story.representation_projection_skipped.v1" },
        });
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toMatchObject({ aggregateType: "Story", aggregateId: storyId });
        expect(JSON.parse(skipped[0].payloadJson)).toMatchObject({
            storyId,
            currentRevisionId: humanRevisionId,
            reason: "human_protected",
        });
    });
});

it("still follows the source for a Story no human has edited", async () => {
    await withRepository("story-auto-projection", async ({ repository, run, setPages }) => {
        setPages([item({
            externalId: "entry-a",
            title: "来源原始标题",
            contentText: "原始正文",
        })]);
        await run();
        const storyId = await onlyStoryId(repository);

        setPages([item({
            externalId: "entry-a",
            title: "来源改过的标题",
            contentText: "改过的正文",
        })]);
        await run();

        const after = await repository.story(storyId);
        expect(after!.story.title).toBe("来源改过的标题");
        expect(after!.story.producer).toBe("system");
        expect(await repository.prisma.domainEvent.count({
            where: { type: "story.representation_projection_skipped.v1" },
        })).toBe(0);
    });
});

it("records who wrote each Revision", async () => {
    await withRepository("story-revision-producer", async ({ repository, run, setPages }) => {
        setPages([item({
            externalId: "entry-a",
            title: "来源原始标题",
            contentText: "原始正文",
        })]);
        await run();
        const storyId = await onlyStoryId(repository);

        const ingested = await repository.prisma.storyRevision.findFirst({
            where: { storyId },
            orderBy: { revision: "asc" },
        });
        expect(ingested?.producer).toBe("system");

        const before = await repository.story(storyId);
        const human = await repository.updateStoryRevision({
            storyId,
            baseRevisionId: before!.story.revisionId,
            title: HUMAN_TITLE,
            summary: before!.story.summary,
            kind: "event",
            subtype: null,
            timeRange: HUMAN_TIME_RANGE,
            keyFacts: HUMAN_KEY_FACTS,
        });
        expect(human!.story.producer).toBe("human");
    });
});

it("keeps a human-edited Story when a merged member Entry is republished", async () => {
    await withRepository("story-human-protection-merged", async ({ repository, run, setPages }) => {
        setPages([
            item({ externalId: "entry-a", title: "来源标题 A", contentText: "正文 A" }),
            item({ externalId: "entry-b", title: "来源标题 B", contentText: "正文 B" }),
        ]);
        await run();
        const storyA = await storyIdByTitle(repository, "来源标题 A");
        const storyB = await storyIdByTitle(repository, "来源标题 B");

        await repository.mergeStories({
            canonicalStoryId: storyA,
            obsoleteStoryIds: [storyB],
            actor: "user",
            reason: "同一事件",
        });

        const before = await repository.story(storyA);
        const human = await repository.updateStoryRevision({
            storyId: storyA,
            baseRevisionId: before!.story.revisionId,
            title: HUMAN_TITLE,
            summary: before!.story.summary,
            kind: "event",
            subtype: null,
            timeRange: HUMAN_TIME_RANGE,
            keyFacts: HUMAN_KEY_FACTS,
        });
        const humanRevisionId = human!.story.revisionId;

        // Only the merged-away member is republished; the projection follows the
        // Entry's Story id, which merge re-pointed at the canonical Story.
        setPages([
            item({ externalId: "entry-a", title: "来源标题 A", contentText: "正文 A" }),
            item({ externalId: "entry-b", title: "来源标题 B 改过", contentText: "正文 B 改过" }),
        ]);
        await run();

        const after = await repository.story(storyA);
        expect(after!.story.revisionId).toBe(humanRevisionId);
        expect(after!.story.title).toBe(HUMAN_TITLE);
        expect(after!.story.timeRange).toEqual(HUMAN_TIME_RANGE);
        expect(after!.story.keyFacts).toEqual(HUMAN_KEY_FACTS);
    });
});
