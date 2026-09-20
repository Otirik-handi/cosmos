import {
    type UserDataExport,
    type UserDataExportTarget,
} from "@cosmos/contracts";
import { PrismaCosmosRepositoryBoardContent } from "./board-content.js";

type ExportTargetRef = { targetType: string; targetId: string };

function byId(left: { id: string }, right: { id: string }): number {
    return left.id.localeCompare(right.id);
}

/**
 * 用户数据导出（LIB-008 / OPS-004）。
 *
 * 读取按对象复用各分区已有的公开投影（labelDetail / collectionDetail / boardDetail …），
 * 导出因此不新造第二套对象定义，也不会随某分区加字段而漏字段。只读、不落盘、不改状态；
 * 不加事务——SQLite 单写者下这是尽力而为的一致快照，`exportedAt` 是它的时间标记。
 */
export class PrismaCosmosRepositoryUserDataExport extends PrismaCosmosRepositoryBoardContent {
    async exportUserData(): Promise<UserDataExport> {
        const [labels, collections, favorites, savedViews, boards, annotations, spotlight] =
            await Promise.all([
                this.listLabels(),
                this.listCollections(),
                this.listFavorites(),
                this.listSavedViews(),
                this.listBoards(),
                this.prisma.annotation.findMany({ orderBy: { id: "asc" } }),
                this.listSpotlightPlacements({}),
            ]);

        const labelDetails = (
            await Promise.all(labels.items.map((item) => this.label(item.id)))
        ).flatMap((detail) => (detail === null ? [] : [detail]));
        const collectionDetails = (
            await Promise.all(collections.items.map((item) => this.collection(item.id)))
        ).flatMap((detail) => (detail === null ? [] : [detail]));
        const boardDetails = (
            await Promise.all(boards.items.map((item) => this.getBoard(item.id)))
        ).flatMap((detail) => (detail === null ? [] : [detail]));
        const annotationItems = annotations.map((row) => this.toAnnotation(row));

        // 引用目标来自所有分区：导出件离开 Cosmos 后仍能读出「这条收藏/批注/标签指的是什么」。
        const targets = await this.resolveExportTargets([
            ...labelDetails.flatMap((label) => [
                ...label.assignedStories.map((story) => ({ targetType: "story", targetId: story.id })),
                ...label.assignedEntries.map((entry) => ({ targetType: "entry", targetId: entry.id })),
                ...label.assignedTopics.map((topic) => ({ targetType: "topic", targetId: topic.id })),
            ]),
            ...collectionDetails.flatMap((collection) => collection.stories.map((story) => ({
                targetType: "story",
                targetId: story.storyId,
            }))),
            ...favorites.items.map((favorite) => ({
                targetType: favorite.targetType,
                targetId: favorite.targetId,
            })),
            ...annotationItems.map((annotation) => ({
                targetType: annotation.targetType,
                targetId: annotation.targetId,
            })),
            ...spotlight.items.map((placement) => ({
                targetType: placement.targetType,
                targetId: placement.targetId,
            })),
            ...savedViews.items.flatMap((view) => view.topicIds.map((topicId) => ({
                targetType: "topic",
                targetId: topicId,
            }))),
        ]);

        const data = {
            labels: [...labelDetails].sort(byId),
            collections: [...collectionDetails].sort(byId),
            favorites: [...favorites.items].sort((left, right) =>
                `${left.targetType}:${left.targetId}`.localeCompare(`${right.targetType}:${right.targetId}`)),
            annotations: annotationItems,
            savedViews: [...savedViews.items].sort(byId),
            boards: [...boardDetails].sort(byId),
            spotlightPlacements: [...spotlight.items].sort(byId),
            targets,
        };

        return {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            counts: {
                labels: data.labels.length,
                collections: data.collections.length,
                favorites: data.favorites.length,
                annotations: data.annotations.length,
                savedViews: data.savedViews.length,
                boards: data.boards.length,
                spotlightPlacements: data.spotlightPlacements.length,
                targets: data.targets.length,
            },
            data,
        };
    }

    /**
     * 去重后解析引用目标的标题与链接。目标可能已被删除（标签/收藏的引用不随目标级联），
     * 此时保留引用、标题为 null，导出不因悬空引用失败。
     */
    private async resolveExportTargets(
        refs: readonly ExportTargetRef[],
    ): Promise<UserDataExportTarget[]> {
        const unique = new Map<string, ExportTargetRef>();
        for (const ref of refs) {
            unique.set(`${ref.targetType}:${ref.targetId}`, ref);
        }
        const idsOf = (targetType: string): string[] => [...unique.values()]
            .filter((ref) => ref.targetType === targetType)
            .map((ref) => ref.targetId);

        const [stories, entries, topics] = await Promise.all([
            this.prisma.story.findMany({
                where: { id: { in: idsOf("story") } },
                select: { id: true, currentRevision: { select: { title: true } } },
            }),
            this.prisma.entry.findMany({
                where: { id: { in: idsOf("entry") } },
                select: { id: true, currentRevision: { select: { title: true, webUrl: true } } },
            }),
            this.prisma.topic.findMany({
                where: { id: { in: idsOf("topic") } },
                select: { id: true, currentRevision: { select: { title: true } } },
            }),
        ]);
        const storyTitles = new Map(stories.map((row) => [row.id, row.currentRevision?.title ?? null]));
        const entryTitles = new Map(entries.map((row) => [
            row.id,
            row.currentRevision?.title ?? null,
        ]));
        const entryUrls = new Map(entries.map((row) => [row.id, row.currentRevision?.webUrl ?? null]));
        const topicTitles = new Map(topics.map((row) => [row.id, row.currentRevision?.title ?? null]));

        return [...unique.values()]
            .map((ref) => ({
                targetType: ref.targetType,
                targetId: ref.targetId,
                title: ref.targetType === "story"
                    ? storyTitles.get(ref.targetId) ?? null
                    : ref.targetType === "entry"
                        ? entryTitles.get(ref.targetId) ?? null
                        : ref.targetType === "topic"
                            ? topicTitles.get(ref.targetId) ?? null
                            : null,
                webUrl: ref.targetType === "entry" ? entryUrls.get(ref.targetId) ?? null : null,
            }))
            .sort((left, right) =>
                `${left.targetType}:${left.targetId}`.localeCompare(`${right.targetType}:${right.targetId}`));
    }
}
