import { join } from "node:path";
import { type SearchPage, type SearchQuery } from "@cosmos/contracts";
import { parseCursor, parseIdList } from "./repository-internals.js";
import { PrismaCosmosRepositoryMedia } from "./media.js";

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
        };
        if (
            (parsed.publishedAfter && Number.isNaN(parsed.publishedAfter.getTime()))
            || (parsed.publishedBefore && Number.isNaN(parsed.publishedBefore.getTime()))
        ) {
            throw new Error("Search date filters must be valid ISO timestamps.");
        }

        const conditions: string[] = [];
        const parameters: unknown[] = [];
        if (parsed.text) {
            conditions.push("entry_search MATCH ?");
            parameters.push(parsed.text);
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
        const fromClause = parsed.text
            ? "FROM entry_search JOIN Entry e ON e.id = entry_search.entry_id"
            : "FROM Entry e";
        const rankSelect = parsed.text ? "bm25(entry_search)" : "0.0";
        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(" AND ")}`
            : "";
        const orderClause = parsed.text
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
