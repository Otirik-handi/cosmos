"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
    Plus,
    RefreshCcw,
    X,
} from "lucide-react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useForm } from "react-hook-form";

import {
    createSourceCommandSchema,
    type FeedItem,
    type HealthResponse,
    type SearchQuery,
    type SourceSnapshot,
    type StoryDetail,
} from "@cosmos/contracts";
import {
    CosmosTransportError,
    HttpCosmosClient,
} from "@cosmos/transport-http";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {SourceActions} from "@/components/cosmos/source-actions";
import {SourceForm, sourceFormSchema, type SourceFormValues} from "@/components/cosmos/source-form";
import {StatusSummary, type EventStreamState} from "@/components/cosmos/status-summary";
import {FeedBrowser, searchSchema, type SearchFormValues} from "@/components/cosmos/feed-browser";
import {StoryPanel} from "@/components/cosmos/story-panel";
import {ThemeSwitcher} from "@/components/cosmos/theme-switcher";
import {useTheme} from "@/theme/theme-provider";



const client = new HttpCosmosClient({
    baseUrl: process.env.NEXT_PUBLIC_COSMOS_API_URL ?? "",
});

export default function Home() {
    const {preference, setPreference} = useTheme();
    const [feed, setFeed] = useState<readonly FeedItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [activeSearch, setActiveSearch] = useState<SearchQuery | null>(null);
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [story, setStory] = useState<StoryDetail | null>(null);
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [openingStoryId, setOpeningStoryId] = useState<string | null>(null);
    const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
    const [checkingService, setCheckingService] = useState(false);
    const [showSourceForm, setShowSourceForm] = useState(false);
    const [eventStreamState, setEventStreamState] = useState<EventStreamState>("connecting");
    const sourceForm = useForm<SourceFormValues>({
        resolver: zodResolver(sourceFormSchema),
        defaultValues: {
            name: "Cosmos RSS",
            feedUrl: "https://example.com/feed.xml",
        },
    });
    const searchForm = useForm<SearchFormValues>({
        resolver: zodResolver(searchSchema),
        defaultValues: {
            text: "",
            sourceId: "",
            publishedAfter: "",
            publishedBefore: "",
        },
    });

    /**
     * 首次加载走全页 loading 骨架；之后（SSE、来源变更）一律后台刷新，
     * 保留旧列表可读，避免阅读中的内容被占位卡替换。
     */
    const refresh = useCallback(async (): Promise<void> => {
        setError(null);
        setLoading(true);
        try {
            const [nextFeed, nextSources] = await Promise.all([
                activeSearch
                    ? client.search(activeSearch)
                    : client.feed(),
                client.listSources(),
            ]);
            setFeed(nextFeed.items);
            setNextCursor(nextFeed.nextCursor);
            setSources(nextSources);
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setLoading(false);
        }
    }, [activeSearch]);

    /**
     * SSE 与首次加载只跑一次：refresh 经 latest-ref 读取，
     * 搜索条件变化不再拆掉重连事件流（重连会让浏览器记录请求失败）。
     */
    const refreshRef = useRef(refresh);
    useEffect(() => {
        refreshRef.current = refresh;
    }, [refresh]);

    useEffect(() => {
        void refreshRef.current();
        const closeEvents = client.openEventStream({
            onEvent: (event) => {
                setEventStreamState("connected");
                if (event.type === "snapshot_required") {
                    setNotice("服务要求重新读取快照，正在刷新 Feed。");
                }
                if (
                    event.type === "feed.updated.v1"
                    || event.type === "run.succeeded.v1"
                    || event.type === "run.failed.v1"
                    || event.type === "job.succeeded.v1"
                    || event.type === "job.retry_wait.v1"
                    || event.type === "job.failed_terminal.v1"
                ) {
                    void refreshRef.current();
                }
            },
            onError: () => {
                setEventStreamState("unavailable");
            },
        });
        return closeEvents;
    }, []);

    const sourceSummary = useMemo(() => {
        if (sources.length === 0) {
            return "尚未配置来源";
        }
        return `${sources.length} 个来源，${sources.filter((source) => source.enabled).length} 个启用`;
    }, [sources]);

    const onCreateSource = sourceForm.handleSubmit(async (values) => {
        setError(null);
        try {
            const created = await client.createSource(createSourceCommandSchema.parse({
                name: values.name,
                sourceDefinitionRef: "source.rss@1",
                operationId: "fetch",
                config: { feedUrl: values.feedUrl },
            }));
            await client.activateSource(created.id, {
                enabled: true,
                baseRevisionId: created.revisionId,
            }, `web-activation:${created.id}:${created.revisionId}`);
            setNotice("RSS 来源已保存并启用，可以立即触发一次录入。");
            setShowSourceForm(false);
            sourceForm.reset();
            await refresh();
        } catch (caught) {
            setError(readError(caught));
        }
    });

    const onSearch = searchForm.handleSubmit(async ({
        text,
        sourceId,
        publishedAfter,
        publishedBefore,
    }) => {
        setError(null);
        try {
            const query: SearchQuery = {
                text: text || undefined,
                sourceId: sourceId || undefined,
                publishedAfter: toBoundaryIso(publishedAfter, false),
                publishedBefore: toBoundaryIso(publishedBefore, true),
                limit: 20,
            };
            const result = await client.search(query);
            setActiveSearch(query);
            setFeed(result.items);
            setNextCursor(result.nextCursor);
            setNotice(
                text || sourceId || publishedAfter || publishedBefore
                    ? `搜索到 ${result.items.length} 条结果。`
                    : "已恢复 Feed。",
            );
        } catch (caught) {
            setError(readError(caught));
        }
    });

    const clearSearch = useCallback(async (): Promise<void> => {
        searchForm.reset();
        setActiveSearch(null);
        setError(null);
        try {
            const result = await client.feed();
            setFeed(result.items);
            setNextCursor(result.nextCursor);
            setNotice("已恢复 Feed。");
        } catch (caught) {
            setError(readError(caught));
        }
    }, [searchForm]);

    const openStory = async (storyId: string): Promise<void> => {
        setOpeningStoryId(storyId);
        setError(null);
        try {
            setStory(await client.story(storyId));
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setOpeningStoryId(null);
        }
    };

    const loadMore = async (): Promise<void> => {
        if (!nextCursor || loadingMore) {
            return;
        }
        setLoadingMore(true);
        setError(null);
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
            setError(readError(caught));
        } finally {
            setLoadingMore(false);
        }
    };

    const checkService = async (): Promise<void> => {
        if (checkingService) {
            return;
        }
        setCheckingService(true);
        setError(null);
        try {
            const result = await client.health();
            setHealth(result);
            setNotice(`服务正常，数据层 ${result.storageStatus}。`);
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setCheckingService(false);
        }
    };

    const runSource = async (source: SourceSnapshot): Promise<void> => {
        setRunningSourceId(source.id);
        setError(null);
        try {
            const result = await client.triggerSource(source.id);
            setNotice(
                result.status === "queued" || result.status === "running"
                    ? `录入任务已排队（Run ${result.id}），Worker 完成后 Feed 会自动刷新。`
                    : `录入任务状态：${result.status}。`,
            );
            await refresh();
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setRunningSourceId(null);
        }
    };

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10">
            <header className="border-b pb-6">
                <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
                    <div className="flex min-w-0 flex-col gap-2">
                        <Badge variant="secondary" className="w-fit">
                            Phase 1 · 本地信息库
                        </Badge>
                        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                            Cosmos
                        </h1>
                        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                            从 Story 入口浏览已保存的信息，并手动触发 RSS 录入。
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <ThemeSwitcher onValueChange={setPreference} value={preference} />
                        <Button onClick={() => setShowSourceForm((value) => !value)}>
                            {showSourceForm ? <X data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                            {showSourceForm ? "关闭表单" : "新建来源"}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={checkingService}
                            onClick={() => void checkService()}
                        >
                            <RefreshCcw data-icon="inline-start" />
                            检查服务
                        </Button>
                    </div>
                </div>
            </header>

            {error && (
                <div
                    role="alert"
                    className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6 text-destructive"
                >
                    {error}
                </div>
            )}
            {notice && (
                <div
                    role="status"
                    className="rounded-[var(--radius-control)] border bg-muted/40 p-4 text-sm leading-6"
                >
                    {notice}
                </div>
            )}

            <div className="grid w-full flex-1 items-start gap-8 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
                <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-8">
                    <StatusSummary
                        eventStreamState={eventStreamState}
                        health={health}
                        sourceSummary={sourceSummary}
                    />
                    <SourceActions
                        onRun={runSource}
                        runningSourceId={runningSourceId}
                        sources={sources}
                    />
                    {showSourceForm && (
                        <SourceForm form={sourceForm} onSubmit={onCreateSource} />
                    )}
                </aside>
                <FeedBrowser
                    activeSearch={activeSearch}
                    feed={feed}
                    loading={loading}
                    loadingMore={loadingMore}
                    nextCursor={nextCursor}
                    onClearSearch={() => void clearSearch()}
                    onLoadMore={loadMore}
                    onOpenStory={openStory}
                    onSubmit={onSearch}
                    openingStoryId={openingStoryId}
                    refreshing={loading && feed.length > 0}
                    searchForm={searchForm}
                    sources={sources}
                />
            </div>

            {story && <StoryPanel onClose={() => setStory(null)} story={story} />}
        </main>
    );
}

function readError(error: unknown): string {
    if (error instanceof CosmosTransportError) {
        return `服务请求失败（HTTP ${error.status}）。`;
    }
    return error instanceof Error ? error.message : "发生未知错误。";
}

function toBoundaryIso(
    value: string | undefined,
    endOfDay: boolean,
): string | undefined {
    if (!value) {
        return undefined;
    }
    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    return new Date(`${value}${suffix}`).toISOString();
}
