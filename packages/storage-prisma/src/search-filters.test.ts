import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { IngestionService, type IngestConnector } from "@cosmos/application";
import type { NormalizedIngestItem } from "@cosmos/domain";
import { PrismaCosmosRepository } from "./index.js";
import { createFixtureSource, prepareDatabase, temporaryRoots } from "./index.fixtures.js";

/**
 * LIB-001 的三个过滤维度：作者、媒体类型、录入状态。
 *
 * 作者与媒体类型落在 EntryRevision 上（`publisherJson` / `contentKind`），
 * 「录入状态」按本 Task 冻结的口径 = 该 Entry 当前 Revision 的**本地媒体保存状态**
 * （即资产里存在该状态的媒体），不是"读没读过"——后者是 Read State（Phase 4）。
 */
it("filters search by author, media type and local media status (LIB-001)", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosmos-search-filters-"));
    temporaryRoots.push(root);
    prepareDatabase(root);

    const repository = new PrismaCosmosRepository({ dataRoot: root });
    await repository.initialize();

    try {
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
    } finally {
        await repository.close();
    }
});
