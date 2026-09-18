import {
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { AppController } from "./app.controller.js";

/**
 * 公开投影不得含内部 Blob key。
 *
 * 依据 [`docs/spec/storage/0001-prisma-repository.md`]：仓储内部的 Asset snapshot 可能携带
 * `storageKey`，Product API 的公开投影必须另行剥离。这里断言的是**整份响应 JSON**，因此
 * 新增嵌套层级不会自动豁免——投影漏在任一层都会让用例失败。
 */
const STORAGE_KEY = "sha256/00/public-projection-fixture";

function assetFixture(id = "asset-1") {
    return {
        id,
        kind: "image",
        status: "saved",
        sourceUrl: "https://example.test/pic.png",
        storageKey: STORAGE_KEY,
        mimeType: "image/png",
        byteSize: 12,
        errorMessage: null,
        errorCode: null,
        attemptCount: 1,
    };
}

function revisionFixture() {
    return {
        id: "revision-1",
        revision: 1,
        title: "Fixture title",
        summary: null,
        contentText: "Fixture body",
        webUrl: null,
        contentKind: "article",
        publisher: null,
        publishedAt: null,
        assets: [assetFixture()],
    };
}

function entryDetailFixture(id = "entry-1") {
    return {
        id,
        sourceId: "source-1",
        sourceName: "Source One",
        sourceKind: "rss",
        currentRevisionId: "revision-1",
        metrics: null,
        revisions: [revisionFixture()],
        observations: [],
        relatedStories: [],
        relations: [],
    };
}

function feedItemFixture() {
    return {
        storyId: "story-1",
        storyKind: "event",
        title: "Fixture title",
        summary: null,
        entryId: "entry-1",
        sourceId: "source-1",
        sourceName: "Source One",
        sourceKind: "rss",
        revisionId: "revision-1",
        publishedAt: null,
        assets: [assetFixture()],
    };
}

function entryListItemFixture() {
    return {
        id: "entry-1",
        sourceId: "source-1",
        sourceName: "Source One",
        sourceKind: "rss",
        storyId: "story-1",
        currentRevisionId: "revision-1",
        title: "Fixture title",
        summary: null,
        webUrl: null,
        contentKind: "article",
        publisher: null,
        metrics: null,
        publishedAt: null,
        updatedAt: "2026-09-18T00:00:00.000Z",
        revisionCount: 1,
        observationCount: 1,
        assets: [assetFixture()],
    };
}

function storyDetailFixture() {
    const entry = entryDetailFixture();
    return {
        story: {
            id: "story-1",
            kind: "event",
            subtype: null,
            revisionId: "story-revision-1",
            title: "Fixture title",
            summary: null,
            timeRange: null,
            keyFacts: [],
            status: "active",
            replacedBy: [],
        },
        entry,
        entries: [entry],
        entities: [],
        topics: [],
        labels: [],
        favorited: false,
        evidence: [],
    };
}

function createController(repository: Record<string, unknown>) {
    return new AppController(repository as never, {} as never, undefined, {} as never);
}

/**
 * 每条读取路由一个用例：mock 的仓储投影刻意带 `storageKey`（仓储层允许），
 * 失败即说明控制器把内部字段原样发给了客户端。
 */
const readRoutes: Array<{
    route: string;
    repository: Record<string, unknown>;
    call: (controller: AppController) => Promise<unknown>;
}> = [
    {
        route: "GET /feed",
        repository: { feed: vi.fn().mockResolvedValue({ items: [feedItemFixture()], nextCursor: null }) },
        call: (controller) => controller.feed(undefined, undefined),
    },
    {
        route: "GET /search",
        repository: {
            search: vi.fn().mockResolvedValue({
                items: [{ ...feedItemFixture(), rank: 0.5 }],
                nextCursor: null,
            }),
        },
        call: (controller) => controller.search({}),
    },
    {
        route: "GET /entries",
        repository: {
            entries: vi.fn().mockResolvedValue({ items: [entryListItemFixture()], nextCursor: null }),
        },
        call: (controller) => controller.entries({}),
    },
    {
        route: "GET /stories/:storyId",
        repository: { story: vi.fn().mockResolvedValue(storyDetailFixture()) },
        call: (controller) => controller.story("story-1"),
    },
    {
        route: "GET /entries/:entryId",
        repository: { entry: vi.fn().mockResolvedValue(entryDetailFixture()) },
        call: (controller) => controller.entry("entry-1"),
    },
    {
        route: "GET /revisions/:revisionId",
        repository: {
            revision: vi.fn().mockResolvedValue({
                ...revisionFixture(),
                entryId: "entry-1",
                sourceId: "source-1",
                sourceName: "Source One",
                sourceKind: "rss",
            }),
        },
        call: (controller) => controller.revision("revision-1"),
    },
];

describe("Product API public projection", () => {
    it.each(readRoutes)("$route does not expose the internal asset storage key", async ({ repository, call }) => {
        const result = await call(createController(repository));

        expect(JSON.stringify(result)).not.toContain("storageKey");
    });

    it("keeps every public asset field of GET /feed", async () => {
        const result = await createController(readRoutes[0]!.repository).feed(undefined, undefined);
        const items = (result as { items: Array<{ assets: Array<Record<string, unknown>> }> }).items;

        expect(items[0]!.assets[0]).toEqual({
            id: "asset-1",
            kind: "image",
            status: "saved",
            sourceUrl: "https://example.test/pic.png",
            mimeType: "image/png",
            byteSize: 12,
            errorMessage: null,
            errorCode: null,
            attemptCount: 1,
        });
    });
});
