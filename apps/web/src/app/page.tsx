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
    type EntityDetail,
    type EntityRelationType,
    type EntitySummary,
    type EntityType,
    type FeedItem,
    type HealthResponse,
    type SearchQuery,
    type SourceSnapshot,
    type StoryDetail,
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



const client = new HttpCosmosClient({
    baseUrl: process.env.NEXT_PUBLIC_COSMOS_API_URL ?? "",
});

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
    const [feed, setFeed] = useState<readonly FeedItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [activeSearch, setActiveSearch] = useState<SearchQuery | null>(null);
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [story, setStory] = useState<StoryDetail | null>(null);
    const [topics, setTopics] = useState<readonly TopicSummary[]>([]);
    const [topic, setTopic] = useState<TopicDetail | null>(null);
    const [openingTopicId, setOpeningTopicId] = useState<string | null>(null);
    const [entities, setEntities] = useState<readonly EntitySummary[]>([]);
    const [entity, setEntity] = useState<EntityDetail | null>(null);
    const [openingEntityId, setOpeningEntityId] = useState<string | null>(null);
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

    const toggleActivation = async (source: SourceSnapshot, enabled: boolean): Promise<void> => {
        setActivatingSourceId(source.id);
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

    useEffect(() => {
        void loadTopics();
        void loadEntities();
    }, [loadTopics, loadEntities]);

    const openTopic = async (topicId: string): Promise<void> => {
        setOpeningTopicId(topicId);
        setError(null);
        try {
            setTopic(await client.topic(topicId));
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
        setStory(await client.story(story.story.id));
        await loadEntities();
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
                        onToggleActivation={toggleActivation}
                        activatingSourceId={activatingSourceId}
                        runningSourceId={runningSourceId}
                        sources={sources}
                    />
                    <section aria-label="Topics" className="grid gap-2">
                        <h2 className="font-display text-lg font-semibold">Topics</h2>
                        {topics.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                尚未创建 Topic；在 Story 详情里可创建并加入。
                            </p>
                        ) : (
                            <ul className="grid gap-1">
                                {topics.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            data-topic-id={item.id}
                                            disabled={openingTopicId === item.id}
                                            onClick={() => void openTopic(item.id)}
                                            className="flex w-full items-center justify-between gap-2 rounded-sm border bg-card px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-60"
                                        >
                                            <span className="truncate">{item.title}</span>
                                            <Badge variant="secondary">{item.memberCount}</Badge>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
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

            {story && (
                <StoryPanel
                    onClose={() => setStory(null)}
                    story={story}
                    onUpdateStoryRevision={updateStoryRevision}
                    onMergeStory={mergeStory}
                    topics={topics}
                    onJoinTopic={joinTopic}
                    onCreateTopic={createTopicFromStory}
                    entityOptions={entities}
                    onLinkEntity={linkEntityToStory}
                    onCreateEntityLinked={createEntityLinkedToStory}
                    onUnlinkEntity={unlinkEntityFromStory}
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
