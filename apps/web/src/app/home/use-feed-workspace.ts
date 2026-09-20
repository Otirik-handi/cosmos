import {
    useCallback,
    useRef,
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
    /**
     * 当前生效的搜索条件与它的版本号。Feed 状态有多个异步写入者（首次加载、SSE 触发的
     * refresh、搜索、套用视图、分页），判定"这次响应还算不算数"不能只看谁最后发起：
     * SSE 触发的 refresh 可能在搜索提交之后才发起，却因为读的是旧闭包而带着旧条件。
     * 所以把当前查询与版本号放进 ref——提交新条件时同步自增，响应返回时比对版本，
     * 条件已变就丢弃结果。这样"提示语说 0 条、列表却残留旧内容"不再可能出现。
     */
    const activeSearchRef = useRef<SearchQuery | null>(null);
    const searchGeneration = useRef(0);
    /** 提交新的搜索条件：同步更新 ref 与版本号，并返回本次写入应比对的版本。 */
    const beginSearch = useCallback((query: SearchQuery | null): number => {
        activeSearchRef.current = query;
        searchGeneration.current += 1;
        return searchGeneration.current;
    }, []);
    const isSearchWriteCurrent = useCallback(
        (generation: number): boolean => generation === searchGeneration.current,
        [],
    );
    const [savedViews, setSavedViews] = useState<readonly SavedView[]>([]);
    const [savedViewName, setSavedViewName] = useState("");
    const [loadingMore, setLoadingMore] = useState(false);
    const refresh = useCallback(async (): Promise<void> => {
        const generation = searchGeneration.current;
        ctx.setError(null);
        ctx.setLoading(true);
        try {
            const [nextFeed, nextSources, nextLabels, nextCollections, nextSavedViews] = await Promise.all([
                activeSearchRef.current
                    ? client.search(activeSearchRef.current)
                    : client.feed(),
                client.listSources(),
                client.listLabels(),
                // 打开 Story 时集合列表要带 containsStory 成员信息；关闭时只刷平铺列表。
                client.listCollections(storyApi.story ? { storyId: storyApi.story.story.id } : {}),
                client.listSavedViews(),
            ]);
            // 来源/分类/集合/已保存视图与搜索条件无关，任何一次刷新都可以写；
            // 只有 Feed 与游标属于"当前搜索条件"，陈旧响应必须丢弃——否则会出现
            // 提示语说 0 条、列表却还留着旧内容。
            setSources(nextSources);
            storyApi.setLabels(nextLabels);
            storyApi.setCollections(nextCollections);
            setSavedViews(nextSavedViews.items);
            if (!isSearchWriteCurrent(generation)) {
                return;
            }
            setFeed(nextFeed.items);
            setNextCursor(nextFeed.nextCursor);
        } catch (caught) {
            if (isSearchWriteCurrent(generation)) {
                ctx.setError(readError(caught));
            }
        } finally {
            ctx.setLoading(false);
        }
    }, [storyApi.story, isSearchWriteCurrent]);

    /**
     * SSE 与首次加载只跑一次：refresh 经 latest-ref 读取，
     * 搜索条件变化不再拆掉重连事件流（重连会让浏览器记录请求失败）。
     */
    const clearSearch = useCallback(async (): Promise<void> => {
        searchForm.reset();
        const generation = beginSearch(null);
        setActiveSearch(null);
        ctx.setError(null);
        try {
            const result = await client.feed();
            if (!isSearchWriteCurrent(generation)) {
                return;
            }
            setFeed(result.items);
            setNextCursor(result.nextCursor);
            ctx.setNotice("已恢复 Feed。");
        } catch (caught) {
            if (isSearchWriteCurrent(generation)) {
                ctx.setError(readError(caught));
            }
        }
    }, [searchForm, beginSearch, isSearchWriteCurrent]);

    /** 保存视图记录当前搜索表单的全部条件，包括分类（Label）与 Topic 多选。 */
    const saveCurrentSearchAsView = async (name: string): Promise<void> => {
        const trimmedName = name.trim();
        if (trimmedName === "") {
            return;
        }
        const values = searchForm.getValues();
        ctx.setError(null);
        // SavedView 合同只有关键词/来源/时间/分类/Topic（LIB-005 的「状态」等条件属 Phase 4），
        // 带了存不下的条件就拒绝保存，而不是让条件被静默丢掉。
        const unsupported = [
            values.author?.trim() ? "作者" : null,
            values.contentKind ? "媒体类型" : null,
            values.assetStatus ? "录入状态" : null,
        ].filter((label): label is string => label !== null);
        if (unsupported.length > 0) {
            ctx.setError(`保存视图暂不支持这些条件：${unsupported.join("、")}（属 LIB-005，Phase 4）。`);
            return;
        }
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
            // 视图存不下这三个条件（LIB-005，Phase 4），套用时显式清空，
            // 否则表单会残留上一次搜索的作者/媒体筛选。
            author: "",
            contentKind: "",
            assetStatus: "",
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
            const generation = beginSearch(query);
            const result = await client.search(query);
            if (!isSearchWriteCurrent(generation)) {
                return;
            }
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
        const generation = searchGeneration.current;
        try {
            const page = activeSearchRef.current
                ? await client.search({
                    ...activeSearchRef.current,
                    cursor: nextCursor,
                })
                : await client.feed({ cursor: nextCursor });
            if (!isSearchWriteCurrent(generation)) {
                return;
            }
            setFeed((current) => [...current, ...page.items]);
            setNextCursor(page.nextCursor);
        } catch (caught) {
            if (isSearchWriteCurrent(generation)) {
                ctx.setError(readError(caught));
            }
        } finally {
            setLoadingMore(false);
        }
    };


    return {
        activeSearch,
        applySavedView,
        beginSearch,
        clearSearch,
        deleteSavedView,
        feed,
        isSearchWriteCurrent,
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
