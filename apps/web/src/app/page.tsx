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
import {
    CosmosTransportError,
    HttpCosmosClient,
} from "@cosmos/transport-http";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardView, type BoardCommands } from "@/components/cosmos/board-view";
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



const client = new HttpCosmosClient({
    baseUrl: process.env.NEXT_PUBLIC_COSMOS_API_URL ?? "",
});

/**
 * 相关内容 v1 的读取端口：只组合已有读合同（search/entity/story），
 * 不引入新的服务端接口，也不参与 Story 的权威关系。
 */
const RELATED_STORY_PORTS: RelatedStoryPorts = {
    searchByLabelIds: async (labelIds) => {
        return (await client.search({labelIds, limit: 10})).items;
    },
    entity: (entityId) => client.entity(entityId),
    story: (storyId) => client.story(storyId),
};

/** 产品入口只暴露这一个来源定义；表单字段仍由该 manifest 的 schema 驱动。 */
const RSS_SOURCE_DEFINITION_REF = "source.rss@1";
const RSS_OPERATION_ID = "fetch";
const PROBE_POLL_INTERVAL_MS = 1_500;
const PROBE_POLL_TIMEOUT_MS = 30_000;

/**
 * 表单里的定时以“分钟”输入，保存为 canonical 合同的 scheduleIntervalMs；
 * 清空表示关闭定时，与 schema 的 union("") 分支一致。
 */
function toSourceConfig(values: SourceFormValues): Record<string, unknown> {
    const config: Record<string, unknown> = { feedUrl: values.feedUrl.trim() };
    if (values.scheduleIntervalMinutes !== "") {
        config.scheduleIntervalMs = Number(values.scheduleIntervalMinutes) * 60_000;
    }
    return config;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export default function Home() {
    const {preference, setPreference} = useTheme();
    const [board, setBoard] = useState<BoardDetail | null>(null);
    const [boards, setBoards] = useState<readonly BoardSummary[]>([]);
    const [boardEditing, setBoardEditing] = useState(false);
    const [boardRefreshToken, setBoardRefreshToken] = useState(0);
    const [newBoardName, setNewBoardName] = useState("");
    const [feed, setFeed] = useState<readonly FeedItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [activeSearch, setActiveSearch] = useState<SearchQuery | null>(null);
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [story, setStory] = useState<StoryDetail | null>(null);
    const [storySubtypes, setStorySubtypes] = useState<readonly StorySubtype[]>([]);
    const [relatedStories, setRelatedStories] = useState<readonly RelatedStory[]>([]);
    const [entryOptions, setEntryOptions] = useState<
        readonly Pick<EntryListItem, "id" | "title" | "sourceName">[]
    >([]);
    const [topics, setTopics] = useState<readonly TopicSummary[]>([]);
    const [topic, setTopic] = useState<TopicDetail | null>(null);
    const [openingTopicId, setOpeningTopicId] = useState<string | null>(null);
    const [entities, setEntities] = useState<readonly EntitySummary[]>([]);
    const [entity, setEntity] = useState<EntityDetail | null>(null);
    const [openingEntityId, setOpeningEntityId] = useState<string | null>(null);
    const [labels, setLabels] = useState<LabelList>({ items: [] });
    const [collections, setCollections] = useState<CollectionList>({ items: [] });
    const [savedViews, setSavedViews] = useState<readonly SavedView[]>([]);
    const [savedViewName, setSavedViewName] = useState("");
    const [storyAnnotations, setStoryAnnotations] = useState<readonly Annotation[]>([]);
    const [topicAnnotations, setTopicAnnotations] = useState<readonly Annotation[]>([]);
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [openingStoryId, setOpeningStoryId] = useState<string | null>(null);
    const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
    const [activatingSourceId, setActivatingSourceId] = useState<string | null>(null);
    const [checkingService, setCheckingService] = useState(false);
    const [showSourceForm, setShowSourceForm] = useState(false);
    const [eventStreamState, setEventStreamState] = useState<EventStreamState>("connecting");
    const [definitionState, setDefinitionState] = useState<SourceDefinitionState>({status: "loading"});
    const [probeState, setProbeState] = useState<ProbeState>({status: "idle"});
    const probeConfigKeyRef = useRef<string | null>(null);
    const openStoryIdRef = useRef<string | null>(null);
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

    /**
     * 首次加载走全页 loading 骨架；之后（SSE、来源变更）一律后台刷新，
     * 保留旧列表可读，避免阅读中的内容被占位卡替换。
     */
    const refresh = useCallback(async (): Promise<void> => {
        setError(null);
        setLoading(true);
        try {
            const [nextFeed, nextSources, nextLabels, nextCollections, nextSavedViews] = await Promise.all([
                activeSearch
                    ? client.search(activeSearch)
                    : client.feed(),
                client.listSources(),
                client.listLabels(),
                // 打开 Story 时集合列表要带 containsStory 成员信息；关闭时只刷平铺列表。
                client.listCollections(story ? { storyId: story.story.id } : {}),
                client.listSavedViews(),
            ]);
            setFeed(nextFeed.items);
            setNextCursor(nextFeed.nextCursor);
            setSources(nextSources);
            setLabels(nextLabels);
            setCollections(nextCollections);
            setSavedViews(nextSavedViews.items);
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setLoading(false);
        }
    }, [activeSearch, story]);

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

    const reloadBoards = async (): Promise<void> => {
        setBoards((await client.listBoards()).items);
    };

    /** 看板写命令统一用返回的树刷新当前 Board，保证顺序/可见性与服务端一致。 */
    const boardCommands: BoardCommands = {
        createSection: async (title) => {
            if (!board) {
                return;
            }
            setBoard(await client.createBoardSection({ boardId: board.id, title }));
            await reloadBoards();
        },
        updateSection: async (sectionId, input) => {
            setBoard(await client.updateBoardSection(sectionId, input));
        },
        deleteSection: async (sectionId) => {
            await client.deleteBoardSection(sectionId);
            if (board) {
                setBoard(await client.getBoard(board.id));
                await reloadBoards();
            }
        },
        createBlock: async (sectionId, type, config) => {
            setBoard(await client.createBoardBlock({
                sectionId,
                type: type as Parameters<typeof client.createBoardBlock>[0]["type"],
                config,
            }));
        },
        updateBlockConfig: async (blockId, config) => {
            setBoard(await client.updateBoardBlockConfig(blockId, { config }));
        },
        deleteBlock: async (blockId) => {
            await client.deleteBoardBlock(blockId);
            if (board) {
                setBoard(await client.getBoard(board.id));
            }
        },
        moveBlock: async (blockId, sectionId, position) => {
            setBoard(await client.moveBoardBlock(blockId, { sectionId, position }));
        },
        setBlockVisibility: async (blockId, visible) => {
            setBoard(await client.setBoardBlockVisibility(blockId, { visible }));
        },
        duplicateBlock: async (blockId) => {
            setBoard(await client.duplicateBoardBlock(blockId));
        },
    };

    const switchBoard = async (boardId: string): Promise<void> => {
        setError(null);
        try {
            setBoard(await client.getBoard(boardId));
            setBoardEditing(false);
        } catch (caught) {
            setError(readError(caught));
        }
    };

    const createBoard = async (name: string): Promise<void> => {
        const trimmed = name.trim();
        if (trimmed === "") {
            return;
        }
        setError(null);
        try {
            setBoard(await client.createBoard({ name: trimmed }));
            await reloadBoards();
            setBoardEditing(true);
            setNotice(`已创建看板「${trimmed}」，可在编辑模式添加分区与区块。`);
        } catch (caught) {
            setError(readError(caught));
        }
    };

    /** 把当前 Story/Topic 固定到当前看板热点区（Spotlight 人工固定，ADR-0010）。 */
    const pinToBoard = async (
        targetType: "story" | "topic",
        targetId: string,
    ): Promise<void> => {
        if (!board) {
            setError("看板尚未加载，无法固定。");
            return;
        }
        setError(null);
        try {
            await client.pinSpotlight({ boardId: board.id, targetType, targetId });
            setBoardRefreshToken((token) => token + 1);
            setNotice("已固定到看板热点区。");
        } catch (caught) {
            setError(readError(caught));
        }
    };

    const sourceSummary = useMemo(() => {
        if (sources.length === 0) {
            return "尚未配置来源";
        }
        return `${sources.length} 个来源，${sources.filter((source) => source.enabled).length} 个启用`;
    }, [sources]);

    /** 表单字段由 catalog manifest 驱动；目录不可用时只提供重试，不回退硬编码字段。 */
    const loadDefinitions = useCallback(async (): Promise<void> => {
        setDefinitionState({status: "loading"});
        try {
            const definitions = await client.listSourceDefinitions();
            const manifest = definitions.find((item) => item.ref === RSS_SOURCE_DEFINITION_REF);
            if (!manifest) {
                setDefinitionState({status: "error", message: `目录中没有 ${RSS_SOURCE_DEFINITION_REF} 来源定义。`});
                return;
            }
            if (manifest.status !== "enabled") {
                setDefinitionState({status: "error", message: `来源定义 ${RSS_SOURCE_DEFINITION_REF} 当前不可用。`});
                return;
            }
            setDefinitionState({status: "ready", manifest});
        } catch (caught) {
            setDefinitionState({status: "error", message: readError(caught)});
        }
    }, []);

    useEffect(() => {
        if (showSourceForm) {
            probeConfigKeyRef.current = null;
            setProbeState({status: "idle"});
            void loadDefinitions();
        }
    }, [showSourceForm, loadDefinitions]);

    // 测试结果只对提交时的配置有效；字段一变立即作废，避免旧结果误导保存决定。
    const watchedFeedUrl = sourceForm.watch("feedUrl");
    const watchedScheduleInterval = sourceForm.watch("scheduleIntervalMinutes");
    useEffect(() => {
        probeConfigKeyRef.current = null;
        setProbeState({status: "idle"});
    }, [watchedFeedUrl, watchedScheduleInterval]);

    const onTestSourceConfig = async (): Promise<void> => {
        const valid = await sourceForm.trigger();
        if (!valid) {
            return;
        }
        const values = sourceForm.getValues();
        const config = toSourceConfig(values);
        probeConfigKeyRef.current = JSON.stringify(config);
        setProbeState({status: "running"});
        try {
            let snapshot = await client.createSourceConfigProbe({
                sourceDefinitionRef: RSS_SOURCE_DEFINITION_REF,
                operationId: RSS_OPERATION_ID,
                config,
            });
            const deadline = Date.now() + PROBE_POLL_TIMEOUT_MS;
            while (
                snapshot.status !== "succeeded"
                && snapshot.status !== "failed_terminal"
                && snapshot.status !== "cancelled"
            ) {
                if (Date.now() >= deadline) {
                    if (probeConfigKeyRef.current !== null) {
                        setProbeState({status: "timeout"});
                    }
                    return;
                }
                await delay(PROBE_POLL_INTERVAL_MS);
                snapshot = await client.getSourceConfigProbe(snapshot.id);
            }
            if (snapshot.status === "succeeded" && snapshot.result) {
                if (probeConfigKeyRef.current !== null) {
                    setProbeState({status: "succeeded", result: snapshot.result});
                }
                return;
            }
            if (probeConfigKeyRef.current !== null) {
                setProbeState({
                    status: "failed",
                    message: snapshot.error ?? "探测任务没有返回结果。",
                });
            }
        } catch (caught) {
            if (probeConfigKeyRef.current !== null) {
                setProbeState({status: "failed", message: readError(caught)});
            }
        }
    };

    const onCreateSource = sourceForm.handleSubmit(async (values) => {
        setError(null);
        try {
            await client.createSource(createSourceCommandSchema.parse({
                name: values.name,
                sourceDefinitionRef: RSS_SOURCE_DEFINITION_REF,
                operationId: RSS_OPERATION_ID,
                config: toSourceConfig(values),
            }));
            setNotice("来源已保存，当前为停用状态；在“来源健康”列表中启用后开始抓取。");
            setShowSourceForm(false);
            sourceForm.reset();
            await refresh();
        } catch (caught) {
            setError(readError(caught));
        }
    });

    const saveMediaPolicy = async (
        source: SourceSnapshot,
        policy: SourceMediaPolicy,
    ): Promise<void> => {
        setError(null);
        try {
            const nextConfig = { ...source.config, media: policy };
            await client.updateSource(source.id, {
                baseRevisionId: source.revisionId,
                config: nextConfig,
            });
            setNotice(`已保存 ${source.name} 的媒体策略；只影响之后的采集。`);
            await refresh();
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 409) {
                setError("来源配置已被其它修改更新（版本冲突），列表已刷新，请重试。");
                await refresh();
            }
            throw caught;
        }
    };

    /**
     * 保留期清理是显式的维护 Run（ADR-0015）：预览用 dryRun，确认才删除字节。
     * Worker 异步执行，这里轮询到终态再回报结果。
     */
    const runMediaCleanup = async (dryRun: boolean): Promise<MediaCleanupReport> => {
        let snapshot = await client.createMediaCleanup(
            { dryRun },
            `web-media-cleanup:${dryRun ? "preview" : "confirm"}:${crypto.randomUUID()}`,
        );
        const deadline = Date.now() + 30_000;
        while (snapshot.status === "queued" || snapshot.status === "running") {
            if (Date.now() > deadline) {
                throw new Error("清理任务超时，请稍后在运行记录中查看。");
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            snapshot = await client.getMediaCleanup(snapshot.runId);
        }
        if (snapshot.status !== "succeeded" || !snapshot.report) {
            throw new Error(snapshot.error ?? "清理任务失败。");
        }
        return snapshot.report;
    };

    const toggleActivation = async (source: SourceSnapshot, enabled: boolean): Promise<void> => {        setActivatingSourceId(source.id);
        setError(null);
        try {
            await client.activateSource(source.id, {
                enabled,
                baseRevisionId: source.revisionId,
            }, `web-activation:${source.id}:${source.revisionId}:${enabled ? "enable" : "disable"}`);
            setNotice(enabled
                ? `来源 ${source.name} 已启用；可执行手动录入，配置了定时的来源会自动抓取。`
                : `来源 ${source.name} 已停用，不再自动或手动抓取。`);
            await refresh();
        } catch (caught) {
            if (caught instanceof CosmosTransportError && caught.status === 409) {
                setError("来源状态已被其它修改更新（版本冲突），列表已刷新，请重试。");
                await refresh();
            } else {
                setError(readError(caught));
            }
        } finally {
            setActivatingSourceId(null);
        }
    };

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
            const result = await client.search(query);
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

    /** 保存视图记录当前搜索表单的全部条件，包括分类（Label）与 Topic 多选。 */
    const saveCurrentSearchAsView = async (name: string): Promise<void> => {
        const trimmedName = name.trim();
        if (trimmedName === "") {
            return;
        }
        const values = searchForm.getValues();
        setError(null);
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
            setNotice(`已保存视图「${trimmedName}」。`);
        } catch (caught) {
            setError(readError(caught));
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
        setError(null);
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
            setNotice(`已套用视图「${view.name}」，共 ${result.items.length} 条结果。`);
        } catch (caught) {
            setError(readError(caught));
        }
    };

    const deleteSavedView = async (viewId: string): Promise<void> => {
        setError(null);
        try {
            await client.deleteSavedView(viewId);
            setSavedViews((await client.listSavedViews()).items);
            setNotice("已删除保存的视图。");
        } catch (caught) {
            setError(readError(caught));
        }
    };

    /**
     * 相关内容是当前 Story 的派生视图：打开、改标签、改实体后都要重算，
     * 且切换 Story 后旧请求的结果必须丢弃。
     */
    const refreshRelatedStories = useCallback(async (detail: StoryDetail): Promise<void> => {
        try {
            const next = await loadRelatedStories(detail, RELATED_STORY_PORTS);
            if (openStoryIdRef.current === detail.story.id) {
                setRelatedStories(next);
            }
        } catch {
            if (openStoryIdRef.current === detail.story.id) {
                setRelatedStories([]);
            }
        }
    }, []);

    const openStory = async (storyId: string): Promise<void> => {
        setOpeningStoryId(storyId);
        setError(null);
        try {
        const [storyDetail, storyCollections, entryPage] = await Promise.all([
            client.story(storyId),
            client.listCollections({ storyId }),
            // 证据关系候选：最近条目里排除本 Story 自己的成员。
            client.entries({ limit: 50 }),
        ]);
        // 批注按 canonical Story id 归属：Feed 传入的 id 可能指向已归并的旧 Story。
        const annotationList = await client.listAnnotations({
            targetType: "story",
            targetId: storyDetail.story.id,
        });
        setStory(storyDetail);
        setCollections(storyCollections);
        setStoryAnnotations(annotationList.items);
        setEntryOptions(entryPage.items
            .filter((item) => item.storyId !== storyDetail.story.id)
            .map((item) => ({
                id: item.id,
                title: item.title,
                sourceName: item.sourceName,
            })));
            // 相关内容是附加区块：先渲染 Story，再后台补齐，读取失败不阻塞阅读。
            openStoryIdRef.current = storyDetail.story.id;
            setRelatedStories([]);
            void refreshRelatedStories(storyDetail);
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setOpeningStoryId(null);
        }
    };

    const closeStory = useCallback((): void => {
        openStoryIdRef.current = null;
        setStory(null);
        setRelatedStories([]);
        setEntryOptions([]);
    }, []);

    /** 证据关系写命令返回 canonical StoryDetail，直接刷新面板即可。 */
    const linkEntryStory = async (input: {
        entryId: string;
        relationType: EntryStoryRelationType;
    }): Promise<void> => {
        if (!story) {
            return;
        }
        const updated = await client.linkEntryStory({
            entryId: input.entryId,
            storyId: story.story.id,
            relationType: input.relationType,
        });
        setStory(updated);
    };

    const unlinkEntryStory = async (entryId: string): Promise<void> => {
        if (!story) {
            return;
        }
        const updated = await client.unlinkEntryStory({
            entryId,
            storyId: story.story.id,
        });
        setStory(updated);
    };

    const updateStoryRevision = async (command: UpdateStoryRevisionCommand): Promise<void> => {
        if (!story) {
            return;
        }
        const updated = await client.updateStoryRevision(story.story.id, command);
        setStory(updated);
    };

    const mergeStory = async (obsoleteStoryId: string): Promise<void> => {
        if (!story) {
            return;
        }
        const updated = await client.mergeStories({
            canonicalStoryId: story.story.id,
            obsoleteStoryIds: [obsoleteStoryId],
        });
        setStory(updated);
    };

    const splitStory = async (command: SplitStoryCommand): Promise<void> => {
        if (!story) {
            return;
        }
        // 拆分命令返回历史壳，面板随即切换到壳视图（后继列表可继续打开）。
        const updated = await client.splitStory(story.story.id, command);
        setStory(updated);
        await refreshRelatedStories(updated);
    };

    /** 标签/收藏变更后重读打开的 Story，并把标签列表刷到最新指派计数。 */
    const refreshStoryWithLabels = async (): Promise<void> => {
        if (!story) {
            return;
        }
        const [nextStory, nextLabels] = await Promise.all([
            client.story(story.story.id),
            client.listLabels(),
        ]);
        setStory(nextStory);
        setLabels(nextLabels);
        await refreshRelatedStories(nextStory);
    };

    /** 刷新当前 Story 的收藏夹成员视图（携带 containsStory 与 itemCount）。 */
    const refreshStoryCollections = async (): Promise<void> => {
        if (!story) {
            return;
        }
        setCollections(await client.listCollections({ storyId: story.story.id }));
    };

    const toggleStoryFavorite = async (favorited: boolean): Promise<void> => {
        if (!story) {
            return;
        }
        if (favorited) {
            await client.setFavorite({ targetType: "story", targetId: story.story.id });
            setNotice("已收藏当前 Story。");
        } else {
            await client.unsetFavorite({ targetType: "story", targetId: story.story.id });
            setNotice("已取消收藏当前 Story。");
        }
        setStory(await client.story(story.story.id));
    };

    const attachLabelToStory = async (labelId: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.attachLabel({
            labelId,
            targetType: "story",
            targetId: story.story.id,
        });
        await refreshStoryWithLabels();
    };

    const detachLabelFromStory = async (labelId: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.detachLabel({
            labelId,
            targetType: "story",
            targetId: story.story.id,
        });
        await refreshStoryWithLabels();
    };

    /**
     * 面板“新建标签”控件只传名称、拿不到新标签 id，所以创建后直接打上当前
     * Story：一次交互完成“建标签 + 添加”两件事。
     */
    const createLabelForStory = async (name: string): Promise<void> => {
        if (!story) {
            return;
        }
        const created = await client.createLabel({ name });
        await client.attachLabel({
            labelId: created.id,
            targetType: "story",
            targetId: story.story.id,
        });
        setNotice(`已创建标签「${name}」并添加到当前 Story。`);
        await refreshStoryWithLabels();
    };

    const toggleStoryCollection = async (
        collectionId: string,
        member: boolean,
    ): Promise<void> => {
        if (!story) {
            return;
        }
        if (member) {
            await client.removeCollectionItem(collectionId, { storyId: story.story.id });
            setNotice("已把当前 Story 移出该收藏夹。");
        } else {
            await client.addCollectionItem(collectionId, { storyId: story.story.id });
            setNotice("已把当前 Story 加入该收藏夹。");
        }
        await refreshStoryCollections();
    };

    const createCollectionFromPanel = async (name: string): Promise<void> => {
        if (!story) {
            return;
        }
        const created = await client.createCollection({ name });
        setNotice(`已创建收藏夹「${created.name}」。`);
        await refreshStoryCollections();
    };

    const refreshStoryAnnotations = async (): Promise<void> => {
        if (!story) {
            return;
        }
        const list = await client.listAnnotations({
            targetType: "story",
            targetId: story.story.id,
        });
        setStoryAnnotations(list.items);
    };

    const createStoryAnnotation = async (input: {
        body: string;
        quote?: string | null;
    }): Promise<void> => {
        if (!story) {
            return;
        }
        await client.createAnnotation({
            targetType: "story",
            targetId: story.story.id,
            body: input.body,
            quote: input.quote ?? null,
        });
        setNotice("已添加批注。");
        await refreshStoryAnnotations();
    };

    const updateStoryAnnotation = async (
        annotationId: string,
        input: { body: string; quote?: string | null },
    ): Promise<void> => {
        if (!story) {
            return;
        }
        await client.updateAnnotation(annotationId, {
            body: input.body,
            quote: input.quote ?? null,
        });
        setNotice("已更新批注。");
        await refreshStoryAnnotations();
    };

    const deleteStoryAnnotation = async (annotationId: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.deleteAnnotation(annotationId);
        setNotice("已删除批注。");
        await refreshStoryAnnotations();
    };

    const loadTopics = useCallback(async (): Promise<void> => {
        try {
            const page = await client.listTopics({ limit: 50 });
            setTopics(page.items);
        } catch {
            // 话题列表读取失败不阻断主 Feed；显式打开时才暴露错误。
        }
    }, []);

    const loadEntities = useCallback(async (): Promise<void> => {
        try {
            const page = await client.listEntities({ limit: 50 });
            setEntities(page.items);
        } catch {
            // 实体列表读取失败不阻断主 Feed；显式打开时才暴露错误。
        }
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

    const openTopic = async (topicId: string): Promise<void> => {
        setOpeningTopicId(topicId);
        setError(null);
        try {
            const topicDetail = await client.topic(topicId);
            const annotationList = await client.listAnnotations({
                targetType: "topic",
                targetId: topicDetail.topic.id,
            });
            setTopic(topicDetail);
            setTopicAnnotations(annotationList.items);
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setOpeningTopicId(null);
        }
    };

    const openEntity = async (entityId: string): Promise<void> => {
        setOpeningEntityId(entityId);
        setError(null);
        try {
            setEntity(await client.entity(entityId));
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setOpeningEntityId(null);
        }
    };

    const updateEntityPage = async (command: UpdateEntityCommand): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.updateEntity(entity.entity.id, command);
        setEntity(updated);
        await loadEntities();
    };

    const addEntityAliasPage = async (name: string): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.addEntityAlias(entity.entity.id, { name });
        setEntity(updated);
        await loadEntities();
    };

    const removeEntityAliasPage = async (name: string): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.removeEntityAlias(entity.entity.id, { name });
        setEntity(updated);
        await loadEntities();
    };

    const refreshStoryAfterEntityChange = async (): Promise<void> => {
        if (!story) {
            return;
        }
        const nextStory = await client.story(story.story.id);
        setStory(nextStory);
        await loadEntities();
        await refreshRelatedStories(nextStory);
    };

    const unlinkStoryFromEntityPage = async (storyId: string): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.unlinkStoryEntity({
            storyId,
            entityId: entity.entity.id,
        });
        setEntity(updated);
        await loadEntities();
        if (story?.story.id === storyId) {
            setStory(await client.story(storyId));
        }
    };

    const createRelationFromEntityPage = async (
        toEntityId: string,
        relationType: EntityRelationType,
    ): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.createEntityRelation({
            fromEntityId: entity.entity.id,
            toEntityId,
            relationType,
        });
        setEntity(updated);
        await loadEntities();
    };

    const removeRelationFromEntityPage = async (relation: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
    }): Promise<void> => {
        if (!entity) {
            return;
        }
        const updated = await client.removeEntityRelation(relation);
        setEntity(updated);
        await loadEntities();
    };

    const linkEntityToStory = async (entityId: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.linkStoryEntity({
            storyId: story.story.id,
            entityId,
        });
        await refreshStoryAfterEntityChange();
    };

    const createEntityLinkedToStory = async (
        name: string,
        type: string,
    ): Promise<void> => {
        if (!story) {
            return;
        }
        const created = await client.createEntity({
            name,
            type: type as EntityType,
        });
        await client.linkStoryEntity({
            storyId: story.story.id,
            entityId: created.entity.id,
        });
        setNotice(`已创建 Entity「${name}」并关联当前 Story。`);
        await refreshStoryAfterEntityChange();
    };

    const unlinkEntityFromStory = async (entityId: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.unlinkStoryEntity({
            storyId: story.story.id,
            entityId,
        });
        await refreshStoryAfterEntityChange();
    };

    const updateTopic = async (command: UpdateTopicCommand): Promise<void> => {
        if (!topic) {
            return;
        }
        const updated = await client.updateTopic(topic.topic.id, command);
        setTopic(updated);
        await loadTopics();
    };

    const updateTopicMemberRole = async (
        storyId: string,
        role: TopicMemberRole,
    ): Promise<void> => {
        if (!topic) {
            return;
        }
        const updated = await client.updateTopicMemberRole(topic.topic.id, {
            storyId,
            role,
        });
        setTopic(updated);
    };

    const removeTopicMember = async (storyId: string): Promise<void> => {
        if (!topic) {
            return;
        }
        const updated = await client.removeTopicMember(topic.topic.id, { storyId });
        setTopic(updated);
    };

    const restoreTopicMember = async (
        storyId: string,
        role: TopicMemberRole,
    ): Promise<void> => {
        if (!topic) {
            return;
        }
        const updated = await client.restoreTopicMember(topic.topic.id, {
            storyId,
            role,
        });
        setTopic(updated);
    };

    const refreshTopicAnnotations = async (): Promise<void> => {
        if (!topic) {
            return;
        }
        const list = await client.listAnnotations({
            targetType: "topic",
            targetId: topic.topic.id,
        });
        setTopicAnnotations(list.items);
    };

    const createTopicAnnotation = async (input: {
        body: string;
        quote?: string | null;
    }): Promise<void> => {
        if (!topic) {
            return;
        }
        await client.createAnnotation({
            targetType: "topic",
            targetId: topic.topic.id,
            body: input.body,
            quote: input.quote ?? null,
        });
        setNotice("已添加批注。");
        await refreshTopicAnnotations();
    };

    const updateTopicAnnotation = async (
        annotationId: string,
        input: { body: string; quote?: string | null },
    ): Promise<void> => {
        if (!topic) {
            return;
        }
        await client.updateAnnotation(annotationId, {
            body: input.body,
            quote: input.quote ?? null,
        });
        setNotice("已更新批注。");
        await refreshTopicAnnotations();
    };

    const deleteTopicAnnotation = async (annotationId: string): Promise<void> => {
        if (!topic) {
            return;
        }
        await client.deleteAnnotation(annotationId);
        setNotice("已删除批注。");
        await refreshTopicAnnotations();
    };

    const joinTopic = async (topicId: string, role: TopicMemberRole): Promise<void> => {
        if (!story) {
            return;
        }
        await client.addTopicMember(topicId, {
            storyId: story.story.id,
            role,
        });
        await loadTopics();
    };

    const createTopicFromStory = async (title: string, purpose: string): Promise<void> => {
        if (!story) {
            return;
        }
        await client.createTopic({
            title,
            purpose,
            seedStoryId: story.story.id,
        });
        setNotice(`已创建 Topic「${title}」并把当前 Story 加入为核心成员。`);
        await loadTopics();
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
                        feedSlot={feedBrowser}
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
                ) : (
                    feedBrowser
                )}
            </div>

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
                    onLinkEntry={linkEntryStory}
                    onUnlinkEntry={unlinkEntryStory}
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

/** 视图条件存的是 canonical ISO 时间；日期输入框只接受 YYYY-MM-DD 前缀。 */
function toDateInputValue(value: string | null): string {
    if (!value) {
        return "";
    }
    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(value);
    return match ? match[1] : "";
}
