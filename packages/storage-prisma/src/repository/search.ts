import { join } from "node:path";
import { type SearchPage, type SearchQuery } from "@cosmos/contracts";
import { parseCursor, parseIdList } from "./repository-internals.js";
import { PrismaCosmosRepositoryMedia } from "./media.js";

/**
 * 把用户输入变成 FTS5 查询：按空白切成词，每段作为字面短语（内部引号双写转义）。
 *
 * `MATCH` 有自己的查询语言——`-` 是 NOT、`*` 是前缀通配、括号分组、`OR`/`NEAR`
 * 是运算符。用户给的是关键词而不是查询语句：把 `绝不匹配-212c82` 当查询语言会让
 * SQLite 抛语法错误（实测 `fts5: syntax error near ""`）并让整个请求 500，把
 * `cosmos OR scaffold` 当查询语言则得到用户没要求的布尔语义。这里统一按字面处理，
 * 多词之间保持 AND（与修复前普通词的行为一致）。
 *
 * 返回 null 表示输入里没有可搜索的词（例如只有 `-` 或 `()`）：调用方按「没有文本
 * 条件」处理，而不是拿一个空查询去查。
 */
function toFtsMatchQuery(text: string): string | null {
    const phrases = text
        .split(/\s+/)
        .filter((token) => /[\p{L}\p{N}]/u.test(token))
        .map((token) => `"${token.replaceAll("\"", "\"\"")}"`);
    return phrases.length > 0 ? phrases.join(" ") : null;
}

/**
 * 作者是子串匹配，所以必须转义 LIKE 的通配符：用户输入的 `%` / `_` 要当字面字符，
 * 否则 `a_b` 会意外匹配 `axb`。
 */
function escapeLikePattern(value: string): string {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
}

export class PrismaCosmosRepositorySearch extends PrismaCosmosRepositoryMedia {
    async search(input: SearchQuery): Promise<SearchPage> {
        const parsed = {
            text: input.text?.trim() ?? "",
            sourceId: input.sourceId,
            publishedAfter: input.publishedAfter
                ? new Date(input.publishedAfter)
                : null,
            publishedBefore: input.publishedBefore
                ? new Date(input.publishedBefore)
                : null,
            cursor: parseCursor(input.cursor),
            limit: Number(input.limit ?? 20),
            labelIds: parseIdList(input.labelIds),
            topicIds: parseIdList(input.topicIds),
            author: input.author?.trim() ?? "",
            contentKind: input.contentKind,
            assetStatus: input.assetStatus,
        };
        if (
            (parsed.publishedAfter && Number.isNaN(parsed.publishedAfter.getTime()))
            || (parsed.publishedBefore && Number.isNaN(parsed.publishedBefore.getTime()))
        ) {
            throw new Error("Search date filters must be valid ISO timestamps.");
        }
        const matchQuery = toFtsMatchQuery(parsed.text);
        const hasText = matchQuery !== null;

        const conditions: string[] = [];
        const parameters: unknown[] = [];
        if (matchQuery) {
            conditions.push("entry_search MATCH ?");
            parameters.push(matchQuery);
        }
        if (parsed.sourceId) {
            conditions.push("e.sourceInstanceId = ?");
            parameters.push(parsed.sourceId);
        }
        if (parsed.publishedAfter) {
            conditions.push("r.sourcePublishedAt >= ?");
            parameters.push(parsed.publishedAfter.getTime());
        }
        if (parsed.publishedBefore) {
            conditions.push("r.sourcePublishedAt <= ?");
            parameters.push(parsed.publishedBefore.getTime());
        }
        // Saved View filters (ADR-0009 decision 5): any-of semantics on
        // Story-level labels / active Topic membership.
        if (parsed.labelIds.length > 0) {
            conditions.push(
                `EXISTS (SELECT 1 FROM LabelAssignment la WHERE la.targetType = 'story' AND la.targetId = e.storyId AND la.labelId IN (${parsed.labelIds.map(() => "?").join(", ")}))`,
            );
            parameters.push(...parsed.labelIds);
        }
        if (parsed.topicIds.length > 0) {
            conditions.push(
                `EXISTS (SELECT 1 FROM TopicMembership tm JOIN TopicMembershipRevision tmr ON tmr.id = tm.currentRevisionId WHERE tm.storyId = e.storyId AND tmr.tombstone = 0 AND tm.topicId IN (${parsed.topicIds.map(() => "?").join(", ")}))`,
            );
            parameters.push(...parsed.topicIds);
        }
        // LIB-001：作者匹配发布者的 name 或 handle；没有发布者的条目在 SQL 里是 NULL，
        // 不会命中任何作者条件。
        if (parsed.author) {
            const pattern = `%${escapeLikePattern(parsed.author)}%`;
            conditions.push(
                "(json_extract(r.publisherJson, '$.name') LIKE ? ESCAPE '\\' OR json_extract(r.publisherJson, '$.handle') LIKE ? ESCAPE '\\')",
            );
            parameters.push(pattern, pattern);
        }
        if (parsed.contentKind) {
            conditions.push("r.contentKind = ?");
            parameters.push(parsed.contentKind);
        }
        // 录入状态取当前 Revision 的媒体状态：任一资产处于该状态即命中。
        if (parsed.assetStatus) {
            conditions.push(
                "EXISTS (SELECT 1 FROM Asset a WHERE a.entryRevisionId = r.id AND a.status = ?)",
            );
            parameters.push(parsed.assetStatus);
        }
        const fromClause = hasText
            ? "FROM entry_search JOIN Entry e ON e.id = entry_search.entry_id"
            : "FROM Entry e";
        const rankSelect = hasText ? "bm25(entry_search)" : "0.0";
        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(" AND ")}`
            : "";
        const orderClause = hasText
            ? "ORDER BY rank ASC, e.updatedAt DESC"
            : "ORDER BY e.updatedAt DESC";
        parameters.push(parsed.limit + 1, parsed.cursor);
        const rows = await this.prisma.$queryRawUnsafe<Array<{
            entryId: string;
            storyId: string;
            storyKind: string;
            title: string;
            summary: string | null;
            sourceId: string;
            sourceName: string;
            sourceKind: string;
            revisionId: string;
            publishedAt: string | null;
            rank: number;
        }>>(
            `
                SELECT
                    e.id AS entryId,
                    e.storyId AS storyId,
                    story.kind AS storyKind,
                    r.title AS title,
                    r.summary AS summary,
                    s.id AS sourceId,
                    s.name AS sourceName,
                    s.kind AS sourceKind,
                    r.id AS revisionId,
                    r.sourcePublishedAt AS publishedAt,
                    ${rankSelect} AS rank
                ${fromClause}
                JOIN EntryRevision r ON r.id = e.currentRevisionId
                JOIN SourceInstance s ON s.id = e.sourceInstanceId
                JOIN Story story ON story.id = e.storyId
                ${whereClause}
                ${orderClause}
                LIMIT ? OFFSET ?
            `,
            ...parameters,
        );
        const hasNext = rows.length > parsed.limit;
        const items = await Promise.all(
            rows.slice(0, parsed.limit).map(async (row) => ({
                ...this.toFeedItemFromSearchRow(row),
                assets: await this.assetsForRevision(row.revisionId),
                rank: row.rank,
            })),
        );

        return {
            items,
            nextCursor: hasNext ? String(parsed.cursor + parsed.limit) : null,
        };
    }

}
