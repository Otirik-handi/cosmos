"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
    ExternalLink,
    Play,
    Plus,
    RefreshCcw,
    Search,
    X,
} from "lucide-react";
import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const searchSchema = z.object({
    text: z.string().trim().max(500).default(""),
    sourceId: z.string().default(""),
    publishedAfter: z.string().default(""),
    publishedBefore: z.string().default(""),
});

const sourceFormSchema = z.object({
    name: z.string().trim().min(1).max(200),
    fixturePath: z.string().trim().min(1),
});

const client = new HttpCosmosClient({
    baseUrl: process.env.NEXT_PUBLIC_COSMOS_API_URL ?? "",
});

type SourceFormValues = z.input<typeof sourceFormSchema>;

export default function Home() {
    const [feed, setFeed] = useState<readonly FeedItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [activeSearch, setActiveSearch] = useState<SearchQuery | null>(null);
    const [sources, setSources] = useState<readonly SourceSnapshot[]>([]);
    const [story, setStory] = useState<StoryDetail | null>(null);
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showSourceForm, setShowSourceForm] = useState(false);
    const [eventStreamState, setEventStreamState] = useState<
        "connecting" | "connected" | "unavailable"
    >("connecting");

    const sourceForm = useForm<SourceFormValues>({
        resolver: zodResolver(sourceFormSchema),
        defaultValues: {
            name: "Cosmos fixture",
            fixturePath: "fixtures/rss/basic.xml",
        },
    });
    const searchForm = useForm<z.input<typeof searchSchema>>({
        resolver: zodResolver(searchSchema),
        defaultValues: {
            text: "",
            sourceId: "",
            publishedAfter: "",
            publishedBefore: "",
        },
    });

    const refresh = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
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

    useEffect(() => {
        const load = async (): Promise<void> => {
            await refresh();
        };
        void load();
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
                    void refresh();
                }
            },
            onError: () => {
                setEventStreamState("unavailable");
            },
        });
        return closeEvents;
    }, [refresh]);

    const sourceSummary = useMemo(() => {
        if (sources.length === 0) {
            return "尚未配置来源";
        }
        return `${sources.length} 个来源，${sources.filter((source) => source.enabled).length} 个启用`;
    }, [sources]);

    const onCreateSource = sourceForm.handleSubmit(async (values) => {
        setError(null);
        try {
            await client.createSource(createSourceCommandSchema.parse({
                name: values.name,
                kind: "fixture-rss",
                config: {
                    fixturePath: values.fixturePath,
                },
                enabled: true,
            }));
            setNotice("来源已创建，可以立即触发一次录入。");
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

    const loadMore = async (): Promise<void> => {
        if (!nextCursor) {
            return;
        }
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
        }
    };

    const checkService = async (): Promise<void> => {
        setError(null);
        try {
            const result = await client.health();
            setHealth(result);
            setNotice(`服务正常，数据层 ${result.storageStatus}。`);
        } catch (caught) {
            setError(readError(caught));
        }
    };

    const runSource = async (source: SourceSnapshot): Promise<void> => {
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
        }
    };

    return (
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10 lg:px-8">
            <header className="flex flex-col gap-4 border-b pb-8 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-col gap-2">
                    <Badge variant="secondary" className="w-fit">
                        Phase 1 · 本地信息库
                    </Badge>
                    <h1 className="text-4xl font-semibold tracking-tight">
                        Cosmos
                    </h1>
                    <p className="max-w-2xl text-muted-foreground">
                        从 Story 入口浏览已保存的信息，并手动触发 RSS/fixture 录入。
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => setShowSourceForm((value) => !value)}>
                        {showSourceForm ? <X data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                        {showSourceForm ? "关闭表单" : "新建来源"}
                    </Button>
                    <Button variant="outline" onClick={() => void checkService()}>
                        <RefreshCcw data-icon="inline-start" />
                        检查服务
                    </Button>
                </div>
            </header>

            {(notice || error) && (
                <div
                    className={error
                        ? "rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
                        : "rounded-lg border border-border bg-muted/40 p-4 text-sm"}
                    role={error ? "alert" : "status"}
                >
                    {error ?? notice}
                </div>
            )}

            {showSourceForm && (
                <Card>
                    <CardHeader>
                        <CardTitle>新建 RSS 来源</CardTitle>
                        <CardDescription>
                            当前首条切片使用本地 fixture；真实 RSS 只需要把类型改为 RSS 并填写 Feed URL。
                        </CardDescription>
                    </CardHeader>
                    <form onSubmit={onCreateSource}>
                        <CardContent>
                            <FieldGroup>
                                <Field data-invalid={Boolean(sourceForm.formState.errors.name)}>
                                    <FieldLabel htmlFor="source-name">名称</FieldLabel>
                                    <Input
                                        id="source-name"
                                        aria-invalid={Boolean(sourceForm.formState.errors.name)}
                                        {...sourceForm.register("name")}
                                    />
                                    <FieldError errors={[sourceForm.formState.errors.name]} />
                                </Field>
                                <Field data-invalid={Boolean(sourceForm.formState.errors.fixturePath)}>
                                    <FieldLabel htmlFor="fixture-path">Fixture 路径</FieldLabel>
                                    <Textarea
                                        id="fixture-path"
                                        aria-invalid={Boolean(sourceForm.formState.errors.fixturePath)}
                                        {...sourceForm.register("fixturePath")}
                                    />
                                    <FieldDescription>
                                        相对于服务器工作目录的路径，例如 fixtures/rss/basic.xml。
                                    </FieldDescription>
                                    <FieldError errors={[sourceForm.formState.errors.fixturePath]} />
                                </Field>
                            </FieldGroup>
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" disabled={sourceForm.formState.isSubmitting}>
                                {sourceForm.formState.isSubmitting ? "保存中…" : "保存来源"}
                            </Button>
                        </CardFooter>
                    </form>
                </Card>
            )}

            <section className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader>
                        <CardDescription>服务模式</CardDescription>
                        <CardTitle>服务器部署优先</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        {health ? `${health.service} · ${health.workerStatus}` : "Next.js Web · NestJS API · Worker"}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardDescription>来源</CardDescription>
                        <CardTitle>{sourceSummary}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        手动触发同一套 Ingest 合同。
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardDescription>数据层</CardDescription>
                        <CardTitle>Prisma + SQLite</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        已保存内容在上游断开后仍可查询。
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardDescription>实时状态</CardDescription>
                        <CardTitle>
                            {eventStreamState === "connected"
                                ? "SSE 已连接"
                                : eventStreamState === "connecting"
                                    ? "正在连接"
                                    : "SSE 不可用"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        {eventStreamState === "unavailable"
                            ? "数据仍可手动刷新；服务恢复后会重新连接。"
                            : "Run、Job 和 Feed 更新会自动刷新。"}
                    </CardContent>
                </Card>
            </section>

            <section className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div className="flex flex-col gap-1">
                        <h2 className="text-xl font-semibold">来源与录入</h2>
                        <p className="text-sm text-muted-foreground">
                            {sources.length === 0 ? "创建第一个 fixture 来源。" : "选择来源执行一次手动录入。"}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {sources.map((source) => (
                            <Button
                                key={source.id}
                                size="sm"
                                variant="outline"
                                disabled={!source.enabled}
                                onClick={() => void runSource(source)}
                            >
                                <Play data-icon="inline-start" />
                                {source.name}
                            </Button>
                        ))}
                    </div>
                </div>
            </section>

            <section className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div className="flex flex-col gap-1">
                        <h2 className="text-xl font-semibold">Story Feed</h2>
                        <p className="text-sm text-muted-foreground">
                            Phase 1 使用保守 Story projection，不提前实现跨来源聚类。
                        </p>
                    </div>
                    <form className="flex w-full max-w-3xl flex-col gap-2" onSubmit={onSearch}>
                        <div className="flex flex-col gap-2 md:flex-row">
                            <Input
                                aria-label="搜索已保存内容"
                                placeholder="搜索标题或正文"
                                {...searchForm.register("text")}
                            />
                            <select
                                aria-label="搜索来源"
                                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                                {...searchForm.register("sourceId")}
                            >
                                <option value="">全部来源</option>
                                {sources.map((source) => (
                                    <option key={source.id} value={source.id}>
                                        {source.name}
                                    </option>
                                ))}
                            </select>
                            <Input
                                aria-label="开始日期"
                                type="date"
                                {...searchForm.register("publishedAfter")}
                            />
                            <Input
                                aria-label="结束日期"
                                type="date"
                                {...searchForm.register("publishedBefore")}
                            />
                            <Button type="submit" variant="outline">
                                <Search data-icon="inline-start" />
                                搜索
                            </Button>
                        </div>
                    </form>
                </div>
                {loading ? (
                    <Card>
                        <CardContent className="py-8 text-sm text-muted-foreground">
                            正在读取本地 Feed…
                        </CardContent>
                    </Card>
                ) : feed.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-sm text-muted-foreground">
                            暂无已保存内容，请先创建来源并触发录入。
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                        {feed.map((item) => (
                            <Card key={item.storyId}>
                                <CardHeader>
                                    <div className="flex items-center justify-between gap-4">
                                        <Badge variant="secondary">{item.storyKind}</Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {item.sourceName}
                                        </span>
                                    </div>
                                    <CardTitle>{item.title}</CardTitle>
                                    <CardDescription>{item.summary ?? "暂无摘要"}</CardDescription>
                                </CardHeader>
                                <CardFooter>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void client.story(item.storyId).then(setStory).catch((caught) => setError(readError(caught)))}
                                    >
                                        <ExternalLink data-icon="inline-start" />
                                        打开 Story
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )}
                {nextCursor && (
                    <div className="flex justify-center">
                        <Button variant="outline" onClick={() => void loadMore()}>
                            加载更多
                        </Button>
                    </div>
                )}
            </section>

            {story && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex flex-col gap-1">
                                <CardTitle>{story.story.title}</CardTitle>
                                <CardDescription>
                                    {story.entry.sourceName} · {story.entry.revisions.length} 个 Revision
                                </CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setStory(null)}>
                                <X data-icon="inline-start" />
                                关闭
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        <p className="whitespace-pre-wrap text-sm leading-6">
                            {story.entry.revisions[0]?.contentText ?? "暂无正文"}
                        </p>
                        <div className="grid gap-3 border-t pt-4 text-sm md:grid-cols-2">
                            <div>
                                <p className="font-medium">Entry</p>
                                <p className="text-muted-foreground">{story.entry.id}</p>
                            </div>
                            <div>
                                <p className="font-medium">Source</p>
                                <p className="text-muted-foreground">
                                    {story.entry.sourceName} · {story.entry.sourceKind}
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {story.entry.revisions.map((revision) => (
                                <Badge key={revision.id} variant="secondary">
                                    Revision {revision.revision} · {revision.id}
                                </Badge>
                            ))}
                            {story.entry.observations.map((observation) => (
                                <Badge key={observation.id} variant="outline">
                                    Observation · {observation.webUrl ?? "无网页 URL"}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
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
