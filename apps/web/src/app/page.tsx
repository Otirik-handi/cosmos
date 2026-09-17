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
    type Annotation,
    type BoardDetail,
    type BoardSummary,
    type CollectionList,
    type EntityDetail,
    type EntityRelationType,
    type EntitySummary,
    type EntityType,
    type EntryListItem,
    type EntryStoryRelationType,
    type FeedItem,
    type HealthResponse,
    type LabelList,
    type MediaCleanupReport,
    type SavedView,
    type SearchQuery,
    type SourceMediaPolicy,
    type SourceSnapshot,
    type SplitStoryCommand,
    type StoryDetail,
    type StorySubtype,
    type TopicDetail,
    type TopicMemberRole,
    type TopicSummary,
    type UpdateEntityCommand,
    type UpdateStoryRevisionCommand,
    type UpdateTopicCommand,
} from "@cosmos/contracts";
import { CosmosTransportError } from "@cosmos/transport-http";

import { useBoardWorkspace } from "./home/use-board-workspace";
import { useEntityWorkspace } from "./home/use-entity-workspace";
import { useFeedWorkspace } from "./home/use-feed-workspace";
import { useSourceWorkspace } from "./home/use-source-workspace";
import { useStoryWorkspace } from "./home/use-story-workspace";
import { useTopicWorkspace } from "./home/use-topic-workspace";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardView, type BoardCommands } from "@/components/cosmos/board-view";
import {ConnectionPanel} from "@/components/cosmos/connection-panel";
import {RunHistory} from "@/components/cosmos/run-history";
import {StoragePanel} from "@/components/cosmos/storage-panel";
import {SourceActions} from "@/components/cosmos/source-actions";
import {
    SourceForm,
    sourceFormSchema,
    type ProbeState,
    type SourceDefinitionState,
    type SourceFormValues,
} from "@/components/cosmos/source-form";
import {StatusSummary, type EventStreamState} from "@/components/cosmos/status-summary";
import {FeedBrowser, searchSchema, type SearchFormValues} from "@/components/cosmos/feed-browser";
import {StoryPanel} from "@/components/cosmos/story-panel";
import {TopicPanel} from "@/components/cosmos/topic-panel";
import {EntityPanel} from "@/components/cosmos/entity-panel";
import {ThemeSwitcher} from "@/components/cosmos/theme-switcher";
import {useTheme} from "@/theme/theme-provider";
import {
    loadRelatedStories,
    type RelatedStory,
    type RelatedStoryPorts,
} from "@/lib/related-stories";
import {
    client,
    RELATED_STORY_PORTS,
    RSS_SOURCE_DEFINITION_REF,
    RSS_OPERATION_ID,
    PROBE_POLL_INTERVAL_MS,
    PROBE_POLL_TIMEOUT_MS,
    delay,
    readError,
    toBoundaryIso,
    toDateInputValue,
    toScheduleIntervalMs,
    toSourceConfig,
} from "./home/page-runtime";

export default function Home() {
    const {preference, setPreference} = useTheme();
    const [loading, setLoading] = useState(true);
    /** 来源列表是共享读模型:整体刷新(feed)与来源操作都会写它。 */
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [eventStreamState, setEventStreamState] = useState<EventStreamState>("connecting");

    /** 跨域钩子:各域 hook 在首次渲染时写入自己实现的回调,事件处理里按需调用。 */
    const storyWorkspace = useStoryWorkspace({setError, setNotice, setLoading});
    const {
        attachLabelToStory,
        closeStory,
        collections,
        createCollectionFromPanel,
        createLabelForStory,
        createStoryAnnotation,
        deleteStoryAnnotation,
        detachLabelFromStory,
        entryOptions,
        keyFactEntryOptions,
        labels,
        linkEntryRelation,
        linkEntryStory,
        loadStoryUserState,
        mergeStory,
        migrateStoryUserState,
        openStory,
        openingStoryId,
        refreshRelatedStories,
        relatedStories,
        setCollections,
        setLabels,
        setStory,
        setStorySubtypes,
        splitStory,
        story,
        storyAnnotations,
        storySubtypes,
        toggleStoryCollection,
        toggleStoryFavorite,
        unlinkEntryRelation,
        unlinkEntryStory,
        updateStoryAnnotation,
        updateStoryRevision,
    } = storyWorkspace;
    const entityWorkspace = useEntityWorkspace({setError, setNotice, setLoading}, storyWorkspace);
    const {
        addEntityAliasPage,
        createEntityLinkedToStory,
        createRelationFromEntityPage,
        entities,
        entity,
        linkEntityToStory,
        loadEntities,
        openEntity,
        openingEntityId,
        removeEntityAliasPage,
        removeRelationFromEntityPage,
        setEntity,
        unlinkEntityFromStory,
        unlinkStoryFromEntityPage,
        updateEntityPage,
    } = entityWorkspace;
    const topicWorkspace = useTopicWorkspace({setError, setNotice, setLoading}, storyWorkspace);
    const {
        createTopicAnnotation,
        createTopicFromStory,
        deleteTopicAnnotation,
        joinTopic,
        loadTopics,
        openTopic,
        openingTopicId,
        removeTopicMember,
        restoreTopicMember,
        setTopic,
        topic,
        topicAnnotations,
        topics,
        updateTopic,
        updateTopicAnnotation,
        updateTopicMemberRole,
    } = topicWorkspace;
    const boardWorkspace = useBoardWorkspace({setError, setNotice, setLoading}, storyWorkspace, topicWorkspace);
    const {
        board,
        boardCommands,
        boardEditing,
        boardRefreshToken,
        boards,
        createBoard,
        newBoardName,
        pinToBoard,
        setBoard,
        setBoardEditing,
        setBoards,
        setNewBoardName,
        switchBoard,
    } = boardWorkspace;
    const sourceForm = useForm<SourceFormValues>({
        resolver: zodResolver(sourceFormSchema),
        defaultValues: {
            name: "Cosmos RSS",
            feedUrl: "https://example.com/feed.xml",
            scheduleIntervalMinutes: "30",
        },
    });
    const searchForm = useForm<SearchFormValues>({
        resolver: zodResolver(searchSchema),
        defaultValues: {
            text: "",
            sourceId: "",
            publishedAfter: "",
            publishedBefore: "",
            labelIds: [],
            topicIds: [],
        },
    });

    const feedWorkspace = useFeedWorkspace(
        {setError, setNotice, setLoading},
        storyWorkspace,
        searchForm,
        setSources,
    );
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
    const sourceWorkspace = useSourceWorkspace(
        {setError, setNotice, setLoading},
        sourceForm,
        {error, loading, sources, setSources},
        feedWorkspace,
    );
    const {
        activatingSourceId,
        checkService,
        checkingService,
        definitionState,
        health,
        loadDefinitions,
        probeConfigKeyRef,
        setProbeState,
        onCreateSource,
        onTestSourceConfig,
        probeState,
        runMediaCleanup,
        runRefreshToken,
        runSource,
        runningSourceId,
        saveMediaPolicy,
        setShowSourceForm,
        showSourceForm,
        sourceSummary,
        toggleActivation,
    } = sourceWorkspace;

    // 测试结果只对提交时的配置有效；字段一变立即作废，避免旧结果误导保存决定。
    const watchedFeedUrl = sourceForm.watch("feedUrl");
    const watchedScheduleInterval = sourceForm.watch("scheduleIntervalMinutes");

    useEffect(() => {
        if (showSourceForm) {
            probeConfigKeyRef.current = null;
            setProbeState({status: "idle"});
            void loadDefinitions();
        }
    }, [showSourceForm, loadDefinitions]);


    useEffect(() => {
        probeConfigKeyRef.current = null;
        setProbeState({status: "idle"});
    }, [watchedFeedUrl, watchedScheduleInterval]);

    /**
     * 首次加载走全页 loading 骨架；之后（SSE、来源变更）一律后台刷新，
     * 保留旧列表可读，避免阅读中的内容被占位卡替换。
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
                // 只监听存储层实际发出的事件类型：Job 成功没有独立事件
                // （Run 终态覆盖它），Job 重试等待以 run.retry_wait.v1 表达。
                if (
                    event.type === "feed.updated.v1"
                    || event.type === "run.queued.v1"
                    || event.type === "run.succeeded.v1"
                    || event.type === "run.failed.v1"
                    || event.type === "run.retry_wait.v1"
                    || event.type === "job.failed_terminal.v1"
                ) {
                    void refreshRef.current();
                }
                if (event.type === "run.failed.v1") {
                    setNotice("一次录入运行失败，已刷新“来源健康”；请在来源行内查看错误信息。");
                }
            },
            onError: () => {
                setEventStreamState("unavailable");
            },
        });
        return closeEvents;
    }, []);

    /**
     * 看板配置低频变化：只首载一次；ensureDefaultBoard 幂等 seed 保证默认
     * 看板存在（ADR-0010 决定 4）。加载失败时主区直接回退完整 Feed，
     * 不阻断阅读。
     */
    useEffect(() => {
        let cancelled = false;
        // 先确保默认看板存在，再读列表：并行会让 listBoards 在 seed 完成前
        // 返回空列表，看板切换器与编辑入口就不会出现。
        client.ensureDefaultBoard()
            .then(async (detail) => {
                if (cancelled) {
                    return;
                }
                setBoard(detail);
                const page = await client.listBoards();
                if (!cancelled) {
                    setBoards(page.items);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setBoard(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const onSearch = searchForm.handleSubmit(async ({
        text,
        sourceId,
        publishedAfter,
        publishedBefore,
        labelIds = [],
        topicIds = [],
    }) => {
        setError(null);
        try {
            const query: SearchQuery = {
                text: text || undefined,
                sourceId: sourceId || undefined,
                publishedAfter: toBoundaryIso(publishedAfter, false),
                publishedBefore: toBoundaryIso(publishedBefore, true),
                labelIds: labelIds.join(",") || undefined,
                topicIds: topicIds.join(",") || undefined,
                limit: 20,
            };
            // 提交新条件即自增搜索版本：此后返回的非本次结果（包括带着旧条件发起的刷新，
            // 例如搜索提交之后才触发的 SSE 刷新）一律丢弃，否则会出现"提示语说 0 条、
            // 列表却残留旧内容"。
            const generation = beginSearch(query);
            const result = await client.search(query);
            if (!isSearchWriteCurrent(generation)) {
                return;
            }
            setActiveSearch(query);
            setFeed(result.items);
            setNextCursor(result.nextCursor);
            setNotice(
                text || sourceId || publishedAfter || publishedBefore
                    || labelIds.length > 0 || topicIds.length > 0
                    ? `搜索到 ${result.items.length} 条结果。`
                    : "已恢复 Feed。",
            );
        } catch (caught) {
            setError(readError(caught));
        }
    });

    const loadStorySubtypes = useCallback(async (): Promise<void> => {
        try {
            setStorySubtypes(await client.listStorySubtypes());
        } catch {
            // subtype 目录读取失败不阻断主 Feed；面板下拉退化为「无 subtype」。
        }
    }, []);

    useEffect(() => {
        void loadTopics();
        void loadEntities();
        void loadStorySubtypes();
    }, [loadTopics, loadEntities, loadStorySubtypes]);

    const savedViewsPanel = (
        <section aria-label="已保存视图" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-xs font-medium text-muted-foreground">已保存视图</h3>
                <span className="text-xs text-muted-foreground">
                    {savedViews.length === 0 ? "尚未保存视图" : `${savedViews.length} 个视图`}
                </span>
            </div>
            {savedViews.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                    {savedViews.map((view) => (
                        <li
                            key={view.id}
                            className="flex items-center gap-1 rounded-[var(--radius-control)] border bg-card pl-2"
                        >
                            <button
                                type="button"
                                onClick={() => void applySavedView(view)}
                                className="rounded-sm py-1 text-sm hover:text-primary focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                            >
                                {view.name}
                            </button>
                            <Button
                                size="xs"
                                variant="ghost"
                                aria-label={`删除视图 ${view.name}`}
                                onClick={() => void deleteSavedView(view.id)}
                            >
                                <X data-icon="inline-start" />
                                删除
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    aria-label="视图名称"
                    placeholder="视图名称"
                    className="max-w-xs"
                    value={savedViewName}
                    onChange={(event) => setSavedViewName(event.target.value)}
                />
                <Button
                    type="button"
                    variant="outline"
                    disabled={savedViewName.trim() === ""}
                    onClick={() => void saveCurrentSearchAsView(savedViewName)}
                >
                    保存当前条件
                </Button>
            </div>
        </section>
    );

    const feedBrowser = (
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
            searchExtras={savedViewsPanel}
            searchForm={searchForm}
            sources={sources}
            labels={labels.items}
            topics={topics}
        />
    );

    const sourceActions = (
        <SourceActions
            onRun={runSource}
            onToggleActivation={toggleActivation}
            onSaveMediaPolicy={saveMediaPolicy}
            onPreviewMediaCleanup={() => runMediaCleanup(true)}
            onConfirmMediaCleanup={() => runMediaCleanup(false)}
            activatingSourceId={activatingSourceId}
            runningSourceId={runningSourceId}
            sources={sources}
        />
    );

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

            {boards.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b pb-4">
                    <label className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">看板</span>
                        <select
                            aria-label="切换看板"
                            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                            value={board?.id ?? ""}
                            onChange={(event) => void switchBoard(event.target.value)}
                        >
                            {boards.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <Button
                        variant="outline"
                        onClick={() => setBoardEditing((value) => !value)}
                    >
                        {boardEditing ? "完成编辑" : "编辑看板"}
                    </Button>
                    {boardEditing && (
                        <>
                            <Input
                                aria-label="新看板名称"
                                className="max-w-xs"
                                placeholder="新看板名称"
                                value={newBoardName}
                                onChange={(event) => setNewBoardName(event.target.value)}
                            />
                            <Button
                                variant="outline"
                                disabled={newBoardName.trim() === ""}
                                onClick={() => {
                                    const name = newBoardName;
                                    setNewBoardName("");
                                    void createBoard(name);
                                }}
                            >
                                新建看板
                            </Button>
                        </>
                    )}
                </div>
            )}

            {/* 信息库与搜索是页面级入口（PRD §8.2），不再依附某个看板区块：
                看板内的每个阅读流区块各自按绑定取数。 */}
            <section aria-label="信息库与搜索" className="border-b pb-6">
                {feedBrowser}
            </section>

            <div className="grid w-full flex-1 items-start gap-8 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
                <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-8">
                    <StatusSummary
                        eventStreamState={eventStreamState}
                        health={health}
                        sourceSummary={sourceSummary}
                    />
                    <section aria-label="Entities" className="grid gap-2">
                        <h2 className="font-display text-lg font-semibold">Entities</h2>
                        {entities.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                尚未创建 Entity；在 Story 详情里可创建并关联。
                            </p>
                        ) : (
                            <ul className="grid gap-1">
                                {entities.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            data-entity-id={item.id}
                                            disabled={openingEntityId === item.id}
                                            onClick={() => void openEntity(item.id)}
                                            className="flex w-full items-center justify-between gap-2 rounded-sm border bg-card px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                                        >
                                            <span className="truncate">{item.name}</span>
                                            <Badge variant="secondary">{item.storyCount}</Badge>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <section aria-label="连接" className="grid gap-2">
                        <h2 className="font-display text-lg font-semibold">连接</h2>
                        <ConnectionPanel client={client} />
                    </section>
                    <section aria-label="存储" className="grid gap-2">
                        <h2 className="font-display text-lg font-semibold">存储</h2>
                        <StoragePanel client={client} />
                    </section>
                    {showSourceForm && (
                        <SourceForm
                            form={sourceForm}
                            definitionState={definitionState}
                            onSubmit={onCreateSource}
                            onTest={() => void onTestSourceConfig()}
                            probeState={probeState}
                            onRetryDefinition={() => void loadDefinitions()}
                        />
                    )}
                </aside>
                {board ? (
                    <BoardView
                        board={board}
                        client={client}
                        sourceActionsSlot={sourceActions}
                        topics={topics}
                        openingTopicId={openingTopicId}
                        onOpenTopic={(topicId) => void openTopic(topicId)}
                        onOpenStory={(storyId) => void openStory(storyId)}
                        editable={boardEditing}
                        commands={boardCommands}
                        savedViews={savedViews}
                        collections={collections.items}
                        refreshToken={boardRefreshToken}
                    />
                ) : null}
            </div>

            <section aria-label="运行记录" className="flex flex-col gap-3">
                <div className="border-b pb-2">
                    <h2 className="font-display text-xl font-semibold tracking-tight">运行记录</h2>
                </div>
                <RunHistory client={client} refreshToken={runRefreshToken} />
            </section>

            {story && (
                <StoryPanel
                    onClose={closeStory}
                    story={story}
                    onUpdateStoryRevision={updateStoryRevision}
                    onMergeStory={mergeStory}
                    onSplitStory={splitStory}
                    subtypeOptions={storySubtypes}
                    topics={topics}
                    onJoinTopic={joinTopic}
                    onCreateTopic={createTopicFromStory}
                    entityOptions={entities}
                    onLinkEntity={linkEntityToStory}
                    onCreateEntityLinked={createEntityLinkedToStory}
                    onUnlinkEntity={unlinkEntityFromStory}
                    labelOptions={labels.items}
                    collections={collections.items}
                    onToggleFavorite={toggleStoryFavorite}
                    onAttachLabel={attachLabelToStory}
                    onDetachLabel={detachLabelFromStory}
                    onCreateLabel={createLabelForStory}
                    onToggleCollection={toggleStoryCollection}
                    onCreateCollection={createCollectionFromPanel}
                    annotations={storyAnnotations}
                    onCreateAnnotation={createStoryAnnotation}
                    onUpdateAnnotation={updateStoryAnnotation}
                    onDeleteAnnotation={deleteStoryAnnotation}
                    onPinToBoard={() => pinToBoard("story", story.story.id)}
                    relatedStories={relatedStories}
                    onOpenRelatedStory={openStory}
                    entryOptions={entryOptions.filter((option) => {
                        return !story.evidence.some((item) => item.entryId === option.id);
                    })}
                    entryCandidates={keyFactEntryOptions}
                    onLinkEntry={linkEntryStory}
                    onUnlinkEntry={unlinkEntryStory}
                    onLinkEntryRelation={linkEntryRelation}
                    onUnlinkEntryRelation={unlinkEntryRelation}
                    onLoadStoryUserState={loadStoryUserState}
                    onMigrateStoryUserState={migrateStoryUserState}
                />
            )}

            {topic && (
                <TopicPanel
                    onClose={() => setTopic(null)}
                    topic={topic}
                    onUpdateTopic={updateTopic}
                    onUpdateMemberRole={updateTopicMemberRole}
                    onRemoveMember={removeTopicMember}
                    onRestoreMember={restoreTopicMember}
                    annotations={topicAnnotations}
                    onCreateAnnotation={createTopicAnnotation}
                    onUpdateAnnotation={updateTopicAnnotation}
                    onDeleteAnnotation={deleteTopicAnnotation}
                    onPinToBoard={() => pinToBoard("topic", topic.topic.id)}
                />
            )}

            {entity && (
                <EntityPanel
                    onClose={() => setEntity(null)}
                    entity={entity}
                    entityOptions={entities}
                    onUpdateEntity={updateEntityPage}
                    onAddAlias={addEntityAliasPage}
                    onRemoveAlias={removeEntityAliasPage}
                    onUnlinkStory={unlinkStoryFromEntityPage}
                    onCreateRelation={createRelationFromEntityPage}
                    onRemoveRelation={removeRelationFromEntityPage}
                />
            )}
        </main>
    );
}
