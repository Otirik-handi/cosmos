"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
    Plus,
    X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useForm } from "react-hook-form";

import {
    type SearchQuery,
    type SourceSnapshot,
} from "@cosmos/contracts";

import { useBoardWorkspace } from "@/app/home/use-board-workspace";
import { useEntityWorkspace } from "@/app/home/use-entity-workspace";
import { useFeedWorkspace } from "@/app/home/use-feed-workspace";
import { useSourceWorkspace } from "@/app/home/use-source-workspace";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";
import { useTopicWorkspace } from "@/app/home/use-topic-workspace";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardView } from "@/components/cosmos/board-view";
import {CollectionPlanList} from "@/components/cosmos/collection-plan-list";
import {
    SourceForm,
    sourceFormSchema,
    type SourceFormValues,
} from "@/components/cosmos/source-form";
import {useLiveTopic} from "@/components/shell/live-provider";
import {searchSchema, type SearchFormValues} from "@/components/cosmos/feed-browser";
import {SystemOutputBlock} from "@/components/cosmos/system-output-block";
import {
    client,
    readError,
    toBoundaryIso,
    toScheduleIntervalMs,
} from "@/app/home/page-runtime";

export default function Home() {
    const [loading, setLoading] = useState(true);
    /** 来源列表是共享读模型:整体刷新(feed)与来源操作都会写它。 */
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    /**
     * 工作区上下文必须**身份稳定**：各域 hook 把它放进 effect／callback 的依赖里，
     * 每次渲染新建一个对象会让这些 effect 每次渲染都重跑——实测一个页面会话因此对
     * `/collection-plans` 与 `/connections` 各发了 300+ 次读取，整套验收被拖慢数倍。
     */
    const workspaceContext = useMemo(() => ({setError, setNotice, setLoading}), []);

    /** 跨域钩子:各域 hook 在首次渲染时写入自己实现的回调,事件处理里按需调用。 */
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const {
        collections,
        openingStoryId,
        refreshRelatedStories,
        setStorySubtypes,
    } = storyWorkspace;
    const entityWorkspace = useEntityWorkspace(workspaceContext, storyWorkspace);
    const {
        entity,
        loadEntities,
    } = entityWorkspace;
    const topicWorkspace = useTopicWorkspace(workspaceContext, storyWorkspace);
    const {
        loadTopics,
        openTopic,
        openingTopicId,
        topics,
    } = topicWorkspace;
    const boardWorkspace = useBoardWorkspace(workspaceContext, storyWorkspace, topicWorkspace);
    const {
        board,
        boardCommands,
        boardEditing,
        boardRefreshToken,
        boards,
        createBoard,
        newBoardName,
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
            scheduleIntervalMinutes: "30",
            connectionId: "",
            // 默认选中的是 RSS，所以给它的必填字段一个可编辑的起始值。
            config: {feedUrl: "https://example.com/feed.xml"},
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
            author: "",
            contentKind: "",
            assetStatus: "",
        },
    });

    const feedWorkspace = useFeedWorkspace(
        workspaceContext,
        storyWorkspace,
        searchForm,
        setSources,
    );
    const {
        applySavedView,
        beginSearch,
        deleteSavedView,
        feed,
        isSearchWriteCurrent,
        refresh,
        saveCurrentSearchAsView,
        savedViewName,
        savedViews,
        setActiveSearch,
        setFeed,
        setNextCursor,
        setSavedViewName,
    } = feedWorkspace;
    /**
     * 系统产出区块取的是「由系统或 Agent 产生的 Story」：机器产出的排前面，
     * 人工编辑过的保留在后面（ADR-0028 的 producer 语义），让人能看出哪些已被人工接管。
     */
    const systemOutput = useMemo(() => {
        const machine = (item: (typeof feed)[number]): boolean => {
            return item.producer === "system" || item.producer === "agent";
        };
        return [...feed].sort((left, right) => Number(machine(right)) - Number(machine(left)));
    }, [feed]);
    /**
     * 打开一条 Story 走阅读页（ADR-0029 决策 7）：读是导航动作，不是打开抽屉。
     * 抽屉是编辑面（改标题、归并、切分），不再是阅读入口。
     */
    const router = useRouter();
    const openStoryPage = useCallback(
        async (storyId: string): Promise<void> => {
            router.push(`/stories/${encodeURIComponent(storyId)}`);
        },
        [router],
    );

    const sourceWorkspace = useSourceWorkspace(        workspaceContext,
        sourceForm,
        {error, loading, sources, setSources},
        feedWorkspace,
    );
    const {
        activatingPlanId,
        connections,
        definitionState,
        deletePlan,
        deletingPlanId,
        loadDefinitions,
        loadPlans,
        planSummary,
        plans,
        probeConfigKeyRef,
        selectDefinition,
        selectOperation,
        selectedDefinitionRef,
        selectedOperationId,
        setProbeState,
        onCreateSource,
        onTestSourceConfig,
        probeState,
        revokeWebhookEntry,
        rotateWebhookEntry,
        runMediaCleanup,
        runRefreshToken,
        runPlan,
        runningPlanId,
        saveMediaPolicy,
        setShowSourceForm,
        showSourceForm,
        toggleActivation,
    } = sourceWorkspace;

    // 测试结果只对提交时的配置有效；字段一变立即作废，避免旧结果误导保存决定。
    const watchedConfig = sourceForm.watch("config");
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
    }, [watchedConfig, watchedScheduleInterval]);

    /**
     * 首次加载走全页 loading 骨架；之后（SSE、来源变更）一律后台刷新，
     * 保留旧列表可读，避免阅读中的内容被占位卡替换。
     */
    const refreshRef = useRef(refresh);
    const loadPlansRef = useRef(loadPlans);
    useEffect(() => {
        refreshRef.current = refresh;
        loadPlansRef.current = loadPlans;
    }, [refresh, loadPlans]);

    useEffect(() => {
        void refreshRef.current();
    }, []);

    /**
     * 事件订阅来自外壳级 live-provider（全程一条 EventSource）。首页同时关心
     * feed 与运行事件：计划行显示的是「最近一次运行的时间与错误」，所以运行事件
     * 也必须重读计划列表，否则失败提示让用户去计划行看，行里却什么都没有。
     */
    useLiveTopic("library", () => {
        void refreshRef.current();
        void loadPlansRef.current();
    });
    useLiveTopic("automation", () => {
        void refreshRef.current();
        void loadPlansRef.current();
    });

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
        author,
        contentKind,
        assetStatus,
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
                author: author || undefined,
                contentKind: contentKind || undefined,
                assetStatus: assetStatus || undefined,
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
                    || author || contentKind || assetStatus
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

    const planList = (
        <CollectionPlanList
            onRun={runPlan}
            onToggleActivation={toggleActivation}
            onDelete={deletePlan}
            onSaveMediaPolicy={saveMediaPolicy}
            onRotateWebhookEntry={rotateWebhookEntry}
            onRevokeWebhookEntry={revokeWebhookEntry}
            onPreviewMediaCleanup={() => runMediaCleanup(true)}
            onConfirmMediaCleanup={() => runMediaCleanup(false)}
            activatingPlanId={activatingPlanId}
            deletingPlanId={deletingPlanId}
            runningPlanId={runningPlanId}
            plans={plans}
            connections={connections}
        />
    );

    return (
        <div className="flex w-full flex-col gap-5">
            {/* 首页只负责「看」：看板与系统产出。检索工作台在 /library，
                来源与连接配置在 /automation（切片 3c），状态在顶栏。 */}
            <div className="flex flex-wrap items-center gap-2">
                {boards.length > 0 && (
                    <>
                        <label className="flex items-center gap-2 text-[13px]">
                            <span className="text-muted-foreground">看板</span>
                            <select
                                aria-label="切换看板"
                                className="h-8 rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
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
                    </>
                )}
                <Button
                    className="ml-auto"
                    variant="outline"
                    onClick={() => setShowSourceForm((value) => !value)}
                >
                    {showSourceForm ? <X data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                    {showSourceForm ? "关闭表单" : "新建计划"}
                </Button>
            </div>

            {/* 来源表单与连接面板在切片 3c 搬到 /automation；在那之前留在首页，
                否则「来源配不了」会先于新页面出现。 */}
            {showSourceForm && (
                <SourceForm
                    form={sourceForm}
                    definitionState={definitionState}
                    selectedDefinitionRef={selectedDefinitionRef}
                    onSelectDefinition={selectDefinition}
                    selectedOperationId={selectedOperationId}
                    onSelectOperation={selectOperation}
                    onSubmit={onCreateSource}
                    onTest={() => void onTestSourceConfig()}
                    probeState={probeState}
                    onRetryDefinition={() => void loadDefinitions()}
                    connections={connections}
                />
            )}

            {board ? (
                <BoardView
                    board={board}
                    client={client}
                    planListSlot={planList}
                    topics={topics}
                    openingTopicId={openingTopicId}
                    onOpenTopic={(topicId) => void openTopic(topicId)}
                    onOpenStory={openStoryPage}
                    editable={boardEditing}
                    commands={boardCommands}
                    savedViews={savedViews}
                    collections={collections.items}
                    refreshToken={boardRefreshToken}
                />
            ) : null}

            <SystemOutputBlock
                items={systemOutput}
                loading={loading}
                onOpenStory={openStoryPage}
                openingStoryId={openingStoryId}
            />

        </div>
    );
}
