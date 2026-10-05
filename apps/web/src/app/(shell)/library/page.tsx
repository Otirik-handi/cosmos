"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { type SearchQuery, type SourceSnapshot } from "@cosmos/contracts";

import { useFeedWorkspace } from "@/app/home/use-feed-workspace";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";
import { useTopicWorkspace } from "@/app/home/use-topic-workspace";
import {
    client,
    readError,
    toBoundaryIso,
} from "@/app/home/page-runtime";
import { useNoticeToast } from "@/app/home/use-notice-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPTY_SEARCH_VALUES, FeedBrowser, searchSchema, type SearchFormValues } from "@/components/cosmos/feed-browser";
import { PageBanners } from "@/components/shell/page-banners";
import { useLiveTopic } from "@/components/shell/live-provider";
import { messages } from "@/copy/messages";

/*
 * 信息库与搜索（PRD §8.2）。整套检索工作台从首页搬到这里：关键词与组合过滤、
 * 已保存视图、结果列表与分页。顶栏搜索框回车也跳到这里并带入关键词。
 *
 * 顶栏搜索把条件放在 URL 上（`?q=`），挂载时读一次并立即执行，让「从顶栏搜」与
 * 「在页内搜」走同一条路径；之后不再跟随 URL，否则用户清空条件又会被旧关键词拉回去。
 */
export default function LibraryPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [error, setError] = useState<string | null>(null);

    /** 写回执走 toast；`error` 仍由页面横幅显示。上下文对象身份稳定由 hook 保证。 */
    const { context: workspaceContext, showNotice } = useNoticeToast(setError, setLoading);

    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const topicWorkspace = useTopicWorkspace(workspaceContext, storyWorkspace);
    const { loadTopics, topics } = topicWorkspace;
    const { labels, loadLabels } = storyWorkspace;

    const searchForm = useForm<SearchFormValues>({
        resolver: zodResolver(searchSchema),
        defaultValues: EMPTY_SEARCH_VALUES,
    });

    const feedWorkspace = useFeedWorkspace(workspaceContext, storyWorkspace, searchForm, setSources);
    const {
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
    } = feedWorkspace;

    useEffect(() => {
        void refresh();
    }, []);

    useEffect(() => {
        void loadTopics();
        // 标签目录要显式加载：不加载时 FeedBrowser 的「按标签筛选」一栏不会渲染。
        void loadLabels();
    }, [loadLabels, loadTopics]);

    /**
     * 事件订阅来自外壳级 live-provider（全程一条连接）。信息库只关心 feed 变化，
     * 表单没有脏保护，所以静默重读。
     */
    useLiveTopic("library", () => {
        void refresh();
    });

    const [initialQuery] = useState(() => {
        if (typeof window === "undefined") {
            return "";
        }
        return new URLSearchParams(window.location.search).get("q") ?? "";
    });

    const runSearch = searchForm.handleSubmit(async (values) => {
        const {
            text,
            sourceId,
            publishedAfter,
            publishedBefore,
            labelIds = [],
            topicIds = [],
            author,
            contentKind,
            assetStatus,
        } = values;
        setError(null);
        try {
            const query: SearchQuery = {
                text: text || undefined,
                sourceId: sourceId || undefined,
                publishedAfter: toBoundaryIso(publishedAfter, false),
                publishedBefore: toBoundaryIso(publishedBefore, true),
                labelIds: labelIds.join(",") || undefined,
                topicIds: topicIds.join(",") || undefined,
                author: author || undefined,
                contentKind: contentKind || undefined,
                assetStatus: assetStatus || undefined,
                limit: 20,
            };
            // 提交新条件即自增搜索版本：此后返回的非本次结果一律丢弃，否则会出现
            // 「提示语说 0 条、列表却残留旧内容」。
            const generation = beginSearch(query);
            const result = await client.search(query);
            if (!isSearchWriteCurrent(generation)) {
                return;
            }
            setActiveSearch(query);
            setFeed(result.items);
            setNextCursor(result.nextCursor);
            // 报告本次检索结果（条数），不是写入回执：走 info。
            showNotice(messages.library.resultNotice(result.items.length), "info");
        } catch (caught) {
            setError(readError(caught));
        }
    });

    useEffect(() => {
        if (initialQuery === "") {
            return;
        }
        searchForm.setValue("text", initialQuery);
        void runSearch();
        // 只在挂载时按 URL 执行一次；后续搜索由用户操作驱动。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialQuery]);

    const savedViewsPanel = (
        <section aria-label={messages.library.savedViews.heading} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-xs font-medium text-muted-foreground">
                    {messages.library.savedViews.heading}
                </h3>
                <span className="text-xs text-muted-foreground">
                    {savedViews.length === 0
                        ? messages.library.savedViews.empty
                        : messages.library.savedViews.countLabel(savedViews.length)}
                </span>
            </div>
            {savedViews.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                    {savedViews.map((view) => (
                        <li
                            key={view.id}
                            className="flex items-center gap-1 rounded-[var(--radius-control)] border border-border bg-card pl-2"
                        >
                            <button
                                type="button"
                                onClick={() => void applySavedView(view)}
                                className="rounded-sm py-1 text-[13px] hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                                {view.name}
                            </button>
                            <Button
                                aria-label={messages.library.savedViews.removeLabel(view.name)}
                                onClick={() => void deleteSavedView(view.id)}
                                size="xs"
                                variant="ghost"
                            >
                                <X data-icon="inline-start" />
                                {messages.library.savedViews.remove}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    aria-label={messages.library.savedViews.nameLabel}
                    className="max-w-xs"
                    onChange={(event) => setSavedViewName(event.target.value)}
                    placeholder={messages.library.savedViews.nameLabel}
                    value={savedViewName}
                />
                <Button
                    disabled={savedViewName.trim() === ""}
                    onClick={() => void saveCurrentSearchAsView(savedViewName)}
                    type="button"
                    variant="outline"
                >
                    {messages.library.savedViews.save}
                </Button>
            </div>
        </section>
    );

    return (
        <div className="flex w-full flex-col gap-4">
            <PageBanners error={error} />

            <FeedBrowser
                activeSearch={activeSearch}
                feed={feed}
                labels={labels.items}
                loading={loading}
                loadingMore={loadingMore}
                nextCursor={nextCursor}
                onClearSearch={() => void clearSearch()}
                onLoadMore={loadMore}
                onOpenStory={async (storyId) => {
                    router.push(`/stories/${encodeURIComponent(storyId)}`);
                }}
                onSubmit={runSearch}
                refreshing={loading && feed.length > 0}
                searchExtras={savedViewsPanel}
                searchForm={searchForm}
                sources={sources}
                topics={topics}
            />
        </div>
    );
}
