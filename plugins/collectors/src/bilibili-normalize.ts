import { createTemporalValue, normalizePublisher } from "@cosmos/domain";
import type { ContentMetrics, NormalizedAssetInput, NormalizedIngestItem } from "@cosmos/domain";
import { asRecord, createMetadataAsset, extractRows, firstText, firstUrl, isRecord, normalizeContentMetrics, parseJsonDocument, readRecordValue } from "./shared.js";

export function normalizeBilibiliOutput(
    output: string,
    shape: BilibiliExecutionPlan["shape"],
): readonly NormalizedIngestItem[] {
    const rows = extractRows(parseJsonDocument(output));
    return rows.map((row, index) => {
        const externalId = firstText(
            row.bvid,
            row.id,
            row.aid,
            row.video_id,
        );
        const title = firstText(row.title, row.name) || "Untitled Bilibili item";
        const author = firstText(
            row.author,
            row.author_name,
            readRecordValue(row.author, "name"),
            readRecordValue(row.owner, "name"),
        );
        const owner = asRecord(row.owner);
        const description = firstText(
            row.description,
            row.desc,
            row.summary,
        );
        const webUrl = firstUrl(
            row.url,
            row.link,
            row.web_url,
            externalId?.startsWith("BV")
                ? `https://www.bilibili.com/video/${externalId}`
                : null,
        );
        const publishedAtRaw = firstText(
            row.published_at,
            row.publishedAt,
            row.pubdate,
            row.time,
        );
        const asset = createMetadataAsset(
            "cover",
            firstUrl(row.cover, row.pic, row.thumbnail, row.cover_url),
        );
        const metrics = normalizeContentMetrics({
            likes: firstText(row.likes, row.like),
            views: firstText(row.views, row.view),
            reposts: firstText(row.reposts, row.repost),
            comments: firstText(row.comments, row.comment),
            collects: firstText(row.collects, row.favorite, row.favorites),
            score: firstText(row.score),
        });

        return {
            externalId,
            title,
            summary: description || null,
            contentText: description || title,
            webUrl,
            kind: shape.kind,
            publisher: normalizePublisher({
                platformId: firstText(
                    row.mid,
                    row.uid,
                    row.author_id,
                    readRecordValue(owner, "mid"),
                    readRecordValue(owner, "uid"),
                ),
                name: author,
                kind: "user",
                profileUrl: firstUrl(
                    row.author_url,
                    readRecordValue(owner, "url"),
                ),
            }),
            metrics,
            publishedAt: createTemporalValue({
                exact: publishedAtRaw,
                raw: publishedAtRaw,
                timezone: "Asia/Shanghai",
            }),
            updatedAt: null,
            sourceLocator: {
                provider: "bilibili",
                mode: shape.locatorMode,
                rank: index + 1,
                externalId,
            },
            // hot 是平台推荐流、feed 是关注的动态、search 是显式查询（ING-004）：同一个 manifest
            // 下的不同发现方式由 operation 声明，而不是靠一个 mode 字段兼顾所有情况。
            discoveryChannel: shape.discoveryChannel,
            rawPayload: JSON.stringify(row),
            rawPayloadMimeType: "application/json",
            assets: asset ? [asset] : [],
        };
    });
}

/** 一次 Bilibili 抓取的完整决定：命令参数、要带的 profile、结果怎么归类。 */
export type BilibiliExecutionPlan = {
    args: string[];
    profile: string | null;
    shape: {
        kind: "listing" | "video";
        discoveryChannel: "recommendation" | "account" | "search";
        locatorMode: string;
    };
};
