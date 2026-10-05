"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
    type SourceSnapshot,
} from "@cosmos/contracts";

import { useBoardWorkspace } from "@/app/home/use-board-workspace";
import { useEntityWorkspace } from "@/app/home/use-entity-workspace";
import { useFeedWorkspace } from "@/app/home/use-feed-workspace";
import { useSourceWorkspace } from "@/app/home/use-source-workspace";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";
import { useTopicWorkspace } from "@/app/home/use-topic-workspace";
import { HomeBoardToolbar } from "./home/board-toolbar";

import { BoardView } from "@/components/cosmos/board-view";
import {CollectionPlanList} from "@/components/cosmos/collection-plan-list";
import { PageBanners } from "@/components/shell/page-banners";
import {
    sourceFormSchema,
    SOURCE_FORM_DEFAULTS,
    type SourceFormValues,
} from "@/components/cosmos/source-form";
import {useLiveTopic} from "@/components/shell/live-provider";
import {searchSchema, EMPTY_SEARCH_VALUES, type SearchFormValues} from "@/components/cosmos/feed-browser";
import {SystemOutputBlock} from "@/components/cosmos/system-output-block";
import {
    client,
} from "@/app/home/page-runtime";
import { useNoticeToast } from "@/app/home/use-notice-toast";

export default function Home() {
    const [loading, setLoading] = useState(true);
    /** 来源列表是共享读模型:整体刷新(feed)与来源操作都会写它。 */
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [error, setError] = useState<string | null>(null);

    /** 写回执走 toast；`error` 仍由页面横幅显示。上下文对象身份稳定由 hook 保证。 */
    const { context: workspaceContext } = useNoticeToast(setError, setLoading);

    /** 跨域钩子:各域 hook 在首次渲染时写入自己实现的回调,事件处理里按需调用。 */
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const {
        collections,
        openingStoryId,
        setStorySubtypes,
    } = storyWorkspace;
    const entityWorkspace = useEntityWorkspace(workspaceContext, storyWorkspace);
    const {
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
        defaultValues: SOURCE_FORM_DEFAULTS,
    });
    const searchForm = useForm<SearchFormValues>({
        resolver: zodResolver(searchSchema),
        defaultValues: EMPTY_SEARCH_VALUES,
    });

    const feedWorkspace = useFeedWorkspace(
        workspaceContext,
        storyWorkspace,
        searchForm,
        setSources,
    );
    const {
        feed,
        refresh,
        savedViews,
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

    const sourceWorkspace = useSourceWorkspace(workspaceContext,
        sourceForm,
        {error, loading, sources, setSources},
        feedWorkspace,
    );
    const {
        activatingPlanId,
        connections,
        deletePlan,
        deletingPlanId,
        loadPlans,
        plans,
        revokeWebhookEntry,
        rotateWebhookEntry,
        runMediaCleanup,
        runPlan,
        runningPlanId,
        saveMediaPolicy,
        toggleActivation,
    } = sourceWorkspace;


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
            {/* 写入口径的回执（新建看板）与读取失败与其它页同一条规则：不静默丢弃。 */}
            <PageBanners error={error} />
            <HomeBoardToolbar
                board={board}
                boardEditing={boardEditing}
                boards={boards}
                createBoard={createBoard}
                newBoardName={newBoardName}
                setBoardEditing={setBoardEditing}
                setNewBoardName={setNewBoardName}
                switchBoard={switchBoard}
            />
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
