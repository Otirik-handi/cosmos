import { expect, it } from "vitest";
import { IngestionService, type IngestConnector } from "@cosmos/application";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { PrismaCosmosRepository } from "./index.js";
import { createFixtureSource, withRepository } from "./index.fixtures.js";

/**
 * LIB-001 的三个过滤维度：作者、媒体类型、录入状态。
 *
 * 作者与媒体类型落在 EntryRevision 上（`publisherJson` / `contentKind`），
 * 「录入状态」按本 Task 冻结的口径 = 该 Entry 当前 Revision 的**本地媒体保存状态**
 * （即资产里存在该状态的媒体），不是"读没读过"——后者是 Read State（Phase 4）。
 */
it("filters search by author, media type and local media status (LIB-001)", async () => {
    await withRepository("search-filters", async (repository) => {
        const source = await createFixtureSource(repository, {
            name: "Filter fixture",
            config: {},
        });
        const items: readonly NormalizedIngestItem[] = [
            {
                externalId: "video-by-alice",
                title: "Alice 的评测视频",
                summary: null,
                contentText: "视频正文",
                webUrl: null,
                kind: "video",
                publisher: {
                    platformId: "u-alice",
                    name: "Alice",
                    handle: "@alice",
                    profileUrl: null,
                    kind: "user",
                    metrics: null,
                },
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "video-by-alice" },
                rawPayload: "<item>video-by-alice</item>",
                assets: [{
                    kind: "image",
                    sourceUrl: "https://example.test/alice.png",
                    status: "saved",
                    mimeType: "image/png",
                    byteSize: 3,
                    content: new TextEncoder().encode("abc"),
                }],
            },
            {
                externalId: "article-by-bob",
                title: "Bob 的文章",
                summary: null,
                contentText: "文章正文",
                webUrl: null,
                kind: "article",
                publisher: {
                    platformId: "u-bob",
                    name: "Bob",
                    handle: "@bob",
                    profileUrl: null,
                    kind: "user",
                    metrics: null,
                },
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "article-by-bob" },
                rawPayload: "<item>article-by-bob</item>",
                assets: [{
                    kind: "image",
                    sourceUrl: "https://example.test/bob.png",
                    status: "failed",
                    mimeType: null,
                    byteSize: null,
                    content: null,
                    errorMessage: "图片下载超时",
                }],
            },
            {
                externalId: "post-without-author",
                title: "无作者的帖子",
                summary: null,
                contentText: "帖子正文",
                webUrl: null,
                kind: "post",
                publisher: null,
                metrics: null,
                publishedAt: null,
                updatedAt: null,
                sourceLocator: { provider: "fixture", item: "post-without-author" },
                rawPayload: "<item>post-without-author</item>",
                assets: [],
            },
        ];
        const connector: IngestConnector = {
            id: "test-fixture",
            description: "Test fixture",
            configVersion: "v1",
            capabilities: ["test"],
            validate: () => undefined,
            async fetchItems() {
                return { items, nextCursor: null };
            },
        };
        await new IngestionService(repository, () => connector).runSource(source.id);

        const titles = async (query: Parameters<typeof repository.search>[0]) =>
            (await repository.search({ ...query, limit: 20 })).items.map((item) => item.title);

        // 作者：子串匹配、大小写不敏感，name 与 handle 都算。
        expect(await titles({ author: "alice" })).toEqual(["Alice 的评测视频"]);
        expect(await titles({ author: "@bob" })).toEqual(["Bob 的文章"]);
        expect(await titles({ author: "carol" })).toEqual([]);

        // 媒体类型 = 内容形态。
        expect(await titles({ contentKind: "video" })).toEqual(["Alice 的评测视频"]);
        expect(await titles({ contentKind: "article" })).toEqual(["Bob 的文章"]);

        // 录入状态 = 当前 Revision 的本地媒体状态。
        expect(await titles({ assetStatus: "saved" })).toEqual(["Alice 的评测视频"]);
        expect(await titles({ assetStatus: "failed" })).toEqual(["Bob 的文章"]);
        expect(await titles({ assetStatus: "metadata_only" })).toEqual([]);

        // 组合过滤：条件之间是 AND。
        expect(await titles({ author: "alice", contentKind: "video", assetStatus: "saved" }))
            .toEqual(["Alice 的评测视频"]);
        expect(await titles({ author: "alice", contentKind: "article" })).toEqual([]);
    });
});

/**
 * `skipped` 是资产状态四个取值里的降级态（ADR-0015：拿到候选但按大小上限、
 * 安全策略或预算没下载），上一个用例只覆盖了 saved／failed／metadata_only。
 * 这条用例固定它也参与 `assetStatus` 过滤，而不是被当成「没有媒体」的同义词。
 */
it("filters search by the skipped asset status (LIB-001)", async () => {
    await withRepository("search-filters", async (repository) => {
        await seedFilterFixture(repository, [
            { externalId: "saved-media", title: "已保存的图片", kind: "video", status: "saved", author: "Alice" },
            { externalId: "skipped-media", title: "被跳过的图片", kind: "article", status: "skipped", author: "Bob" },
        ]);
        const titles = async (query: Parameters<typeof repository.search>[0]) =>
            (await repository.search({ ...query, limit: 20 })).items.map((item) => item.title);

        expect(await titles({ assetStatus: "skipped" })).toEqual(["被跳过的图片"]);
        // 非空转：别的状态条件不命中 skipped 那条，skipped 条件也不命中别的状态。
        expect(await titles({ assetStatus: "saved" })).toEqual(["已保存的图片"]);
        expect(await titles({ assetStatus: "failed" })).toEqual([]);
        expect(await titles({ assetStatus: "metadata_only" })).toEqual([]);
    });
});

/**
 * 浏览器用例的「清除筛选后回到默认 Feed」在数据侧就是这个：三个维度全部清空后
 * 回到该来源的全量，而不是回到某一个维度上一次的取值。
 */
it("returns every entry of the source once author, contentKind and assetStatus are all cleared (LIB-001)", async () => {
    await withRepository("search-filters", async (repository) => {
        const { sourceId } = await seedFilterFixture(repository, [
            { externalId: "video-by-alice", title: "Alice 的评测视频", kind: "video", status: "saved", author: "Alice" },
            { externalId: "article-by-bob", title: "Bob 的文章", kind: "article", status: "skipped", author: "Bob" },
            { externalId: "post-without-author", title: "无作者的帖子", kind: "post", status: "failed", author: null },
        ]);
        // 先确认夹具本身是有区分的：每个维度单独用都能把结果收窄到一条。
        expect((await repository.search({ author: "alice", limit: 20 })).items).toHaveLength(1);
        expect((await repository.search({ contentKind: "video", limit: 20 })).items).toHaveLength(1);
        expect((await repository.search({ assetStatus: "failed", limit: 20 })).items).toHaveLength(1);

        const allTitles = ["Alice 的评测视频", "Bob 的文章", "无作者的帖子"].sort();

        // 三个维度都不传：返回该来源的全部条目，条数与灌入条数相等。
        const cleared = await repository.search({ sourceId, limit: 20 });
        expect(cleared.items).toHaveLength(3);
        expect(cleared.items.map((item) => item.title).sort()).toEqual(allTitles);

        // 显式 undefined 与不传同义，不残留上一次筛选的取值。
        const explicit = await repository.search({
            sourceId,
            author: undefined,
            contentKind: undefined,
            assetStatus: undefined,
            limit: 20,
        });
        expect(explicit.items).toHaveLength(3);
        expect(explicit.items.map((item) => item.title).sort()).toEqual(allTitles);
    });
});

/** 资产状态从领域合同的资产输入推导，避免测试里另抄一份取值集合。 */
type FixtureAssetStatus = NormalizedIngestItem["assets"][number]["status"];

type FilterFixtureEntry = {
    externalId: string;
    title: string;
    kind: NormalizedIngestItem["kind"];
    status: FixtureAssetStatus;
    /** 发布者名字；null 表示这条没有发布者（作者条件不该命中它）。 */
    author: string | null;
};

/**
 * 真库 + 真 IngestionService 灌入夹具条目。连接器不带 mediaDownload 能力、调用方也
 * 不注入 mediaAcquirer，所以资产状态按夹具原样落库——`skipped` 与 `saved` 走的是
 * 同一条持久化路径（只有 saved 会去写 blob）。
 */
async function seedFilterFixture(
    repository: PrismaCosmosRepository,
    entries: readonly FilterFixtureEntry[],
): Promise<{ sourceId: string }> {
    const source = await createFixtureSource(repository, { name: "Filter fixture", config: {} });
    const items: readonly NormalizedIngestItem[] = entries.map((entry) => ({
        externalId: entry.externalId,
        title: entry.title,
        summary: null,
        contentText: `${entry.title}的正文`,
        webUrl: null,
        kind: entry.kind,
        publisher: entry.author === null ? null : {
            platformId: `u-${entry.externalId}`,
            name: entry.author,
            handle: `@${entry.author.toLowerCase()}`,
            profileUrl: null,
            kind: "user",
            metrics: null,
        },
        metrics: null,
        publishedAt: null,
        updatedAt: null,
        sourceLocator: { provider: "fixture", item: entry.externalId },
        rawPayload: `<item>${entry.externalId}</item>`,
        assets: [{
            kind: "image",
            sourceUrl: `https://example.test/${entry.externalId}.png`,
            status: entry.status,
            mimeType: entry.status === "saved" ? "image/png" : null,
            byteSize: entry.status === "saved" ? 3 : null,
            content: entry.status === "saved" ? new TextEncoder().encode("abc") : null,
            ...(entry.status === "saved" ? {} : { errorMessage: `夹具给出的降级状态：${entry.status}` }),
        }],
    }));
    const connector: IngestConnector = {
        id: "test-fixture",
        description: "Test fixture",
        configVersion: "v1",
        capabilities: ["test"],
        validate: () => undefined,
        async fetchItems() {
            return { items, nextCursor: null };
        },
    };
    await new IngestionService(repository, () => connector).runSource(source.id);
    return { sourceId: source.id };
}
