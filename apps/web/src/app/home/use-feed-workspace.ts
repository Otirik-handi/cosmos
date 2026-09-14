import {
    useCallback,
    useState,
} from "react";
import {
    type FeedItem,
    type SourceSnapshot,
    type SavedView,
    type SearchQuery,
} from "@cosmos/contracts";
import {
    client,
    readError,
    toBoundaryIso,
    toDateInputValue,
} from "./page-runtime";
import type { UseFormReturn } from "react-hook-form";

import type { SearchFormValues } from "@/components/cosmos/feed-browser";
import type { WorkspaceContext } from "./page-bridge";
import type { useStoryWorkspace } from "./use-story-workspace";

type StoryApi = ReturnType<typeof useStoryWorkspace>;

/** 由 G06 切片 4 从 page.tsx 拆出的域 hook（搬运，未改行为）。 */
export function useFeedWorkspace(
    ctx: WorkspaceContext,
    storyApi: StoryApi,
    searchForm: UseFormReturn<SearchFormValues>,
    setSources: (next: readonly SourceSnapshot[]) => void,
) {
    const [feed, setFeed] = useState<readonly FeedItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [activeSearch, setActiveSearch] = useState<SearchQuery | null>(null);
    const [savedViews, setSavedViews] = useState<readonly SavedView[]>([]);
    const [savedViewName, setSavedViewName] = useState("");
    const [loadingMore, setLoadingMore] = useState(false);
    const refresh = useCallback(async (): Promise<void> => {
        ctx.setError(null);
        ctx.setLoading(true);
        try {
            const [nextFeed, nextSources, nextLabels, nextCollections, nextSavedViews] = await Promise.all([
                activeSearch
                    ? client.search(activeSearch)
                    : client.feed(),
                client.listSources(),
                client.listLabels(),
                // 打开 Story 时集合列表要带 containsStory 成员信息；关闭时只刷平铺列表。
                client.listCollections(storyApi.story ? { storyId: storyApi.story.story.id } : {}),
                client.listSavedViews(),
            ]);
            setFeed(nextFeed.items);
            setNextCursor(nextFeed.nextCursor);
            setSources(nextSources);
            storyApi.setLabels(nextLabels);
            storyApi.setCollections(nextCollections);
            setSavedViews(nextSavedViews.items);
        } catch (caught) {
            ctx.setError(readError(caught));
        } finally {
            ctx.setLoading(false);
        }
    }, [activeSearch, storyApi.story]);

    /**
     * SSE 与首次加载只跑一次：refresh 经 latest-ref 读取，
     * 搜索条件变化不再拆掉重连事件流（重连会让浏览器记录请求失败）。
     */
    const clearSearch = useCallback(async (): Promise<void> => {
        searchForm.reset();
        setActiveSearch(null);
        ctx.setError(null);
        try {
            const result = await client.feed();
            setFeed(result.items);
            setNextCursor(result.nextCursor);
            ctx.setNotice("已恢复 Feed。");
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    }, [searchForm]);

    /** 保存视图记录当前搜索表单的全部条件，包括分类（Label）与 Topic 多选。 */
    const saveCurrentSearchAsView = async (name: string): Promise<void> => {
        const trimmedName = name.trim();
        if (trimmedName === "") {
            return;
        }
        const values = searchForm.getValues();
        ctx.setError(null);
        try {
            await client.createSavedView({
                name: trimmedName,
                conditions: {
                    text: values.text?.trim() || null,
                    sourceId: values.sourceId?.trim() || null,
                    publishedAfter: toBoundaryIso(values.publishedAfter, false) ?? null,
                    publishedBefore: toBoundaryIso(values.publishedBefore, true) ?? null,
                    labelIds: values.labelIds,
                    topicIds: values.topicIds,
                },
            });
            setSavedViewName("");
            setSavedViews((await client.listSavedViews()).items);
            ctx.setNotice(`已保存视图「${trimmedName}」。`);
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    };

    /** 套用视图 = 用视图条件重跑 search，并写回 activeSearch 让分页/刷新沿用同一筛选。 */
    const applySavedView = async (view: SavedView): Promise<void> => {
        searchForm.reset({
            text: view.text ?? "",
            sourceId: view.sourceId ?? "",
            publishedAfter: toDateInputValue(view.publishedAfter),
            publishedBefore: toDateInputValue(view.publishedBefore),
            labelIds: view.labelIds,
            topicIds: view.topicIds,
        });
        ctx.setError(null);
        try {
            const query: SearchQuery = {
                text: view.text ?? undefined,
                sourceId: view.sourceId ?? undefined,
                publishedAfter: view.publishedAfter ?? undefined,
                publishedBefore: view.publishedBefore ?? undefined,
                labelIds: view.labelIds.join(",") || undefined,
                topicIds: view.topicIds.join(",") || undefined,
                limit: 20,
            };
            const result = await client.search(query);
            setActiveSearch(query);
            setFeed(result.items);
            setNextCursor(result.nextCursor);
            ctx.setNotice(`已套用视图「${view.name}」，共 ${result.items.length} 条结果。`);
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    };

    const deleteSavedView = async (viewId: string): Promise<void> => {
        ctx.setError(null);
        try {
            await client.deleteSavedView(viewId);
            setSavedViews((await client.listSavedViews()).items);
            ctx.setNotice("已删除保存的视图。");
        } catch (caught) {
            ctx.setError(readError(caught));
        }
    };

    /**
     * 相关内容是当前 Story 的派生视图：打开、改标签、改实体后都要重算，
     * 且切换 Story 后旧请求的结果必须丢弃。
     */
    const loadMore = async (): Promise<void> => {
        if (!nextCursor || loadingMore) {
            return;
        }
        setLoadingMore(true);
        ctx.setError(null);
        try {
            const page = activeSearch
                ? await client.search({
                    ...activeSearch,
                    cursor: nextCursor,
                })
                : await client.feed({ cursor: nextCursor });
            setFeed((current) => [...current, ...page.items]);
            setNextCursor(page.nextCursor);
        } catch (caught) {
            ctx.setError(readError(caught));
        } finally {
            setLoadingMore(false);
        }
    };


    return {
        activeSearch,
        applySavedView,
        clearSearch,
        deleteSavedView,
        feed,
        loadMore,
        loadingMore,
        nextCursor,
        refresh,
        saveCurrentSearchAsView,
        savedViewName,
        savedViews,
        setActiveSearch,
        setFeed,
        setNextCursor,
        setSavedViewName,
    };
}
