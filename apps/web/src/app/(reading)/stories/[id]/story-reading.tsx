"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useEntityWorkspace } from "@/app/home/use-entity-workspace";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";
import { useTopicWorkspace } from "@/app/home/use-topic-workspace";
import { useNoticeToast } from "@/app/home/use-notice-toast";
import { client, readError } from "@/app/home/page-runtime";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StoryEditPanel } from "@/components/cosmos/story-edit-panel";
import { StoryReadingContent } from "@/components/cosmos/story-reading-content";
import { PageBanners } from "@/components/shell/page-banners";
import { useLiveTopic } from "@/components/shell/live-provider";
import { messages } from "@/copy/messages";
import {
    StoryEventTimeLine,
    StoryHumanProtectedNotice,
    StoryKeyFactsBlock,
} from "@/components/cosmos/story-panel/representation";

/*
 * Story 阅读页（ADR-0029 决策 7）。工作区里唯一的 `(reading)` 路由：只有顶栏，没有侧栏。
 *
 * 版面是两栏 3:1（维护者 2026-10-03 裁定，取代本轮之前的 3:2 + 整组限宽 ≈931 px）：
 * 左栏「内容」、右栏「操作编辑」，整组宽 = 视口 80%、居中，不占满导航栏下方的整个区域。
 * 宽度用 `vw` 表达，三档断点因此不需要各自的规则：两栏与整组一起按 80% 缩放，3:1 与 80%
 * 两条约束在整档宽度内同时成立。正文跟着左栏撑满，不再限 34em——本轮同时废止了 V4 的
 * 「行宽 ≤34em」那条合同（理由与代价见 walkthrough Round 3）。
 *
 * 正文取主成员当前 Revision 的 contentText——这是产品里第一次显示条目正文。
 * 读与写分居两栏：只读区块（成员、证据、时间线、相关内容、媒体）在左栏，
 * 写入动作收在右栏 `StoryEditPanel` 的「编辑与关联」里按需展开（ADR-0029 决策 1：
 * 关联动作就地）。因此取数与写入都走 `useStoryWorkspace`——抽屉删除后，这里是
 * Story 的唯一可写入口。
 */
export function StoryReading({ storyId }: { storyId: string }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [togglingFavorite, setTogglingFavorite] = useState(false);
    /** 编辑面里有未保存的编辑；事件到达时据此决定静默重读还是先问用户（ADR-0029 决策 7）。 */
    const [unsavedEdit, setUnsavedEdit] = useState(false);
    const [stale, setStale] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    /*
     * 两栏共用一行写入状态：左栏的证据表单与右栏的编辑表单都会写入，各自持有一份
     * busy/错误行时，左栏失败的错误会显示在右栏看不见的地方，用户只看到按钮弹回来。
     */
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    /*
     * 回执走 toast，不再用页面顶部的横幅（维护者 2026-10-03）：写一条标记就凭空出现一条
     * 横幅、把正文往下推，很突兀；toast 在右下角自己消失。Provider 与宿主在路由组的 layout 里
     * ——context 只能由祖先提供，页面自己渲染 Provider 是无效的。
     * 错误仍走 `PageBanners`：错误要留在页面上，不该自己消失。
     */
    const { context: workspaceContext, showNotice } = useNoticeToast(setError, setLoading);
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const entityWorkspace = useEntityWorkspace(workspaceContext, storyWorkspace);
    const topicWorkspace = useTopicWorkspace(workspaceContext, storyWorkspace);
    const {
        collections,
        entryOptions,
        keyFactEntryOptions,
        labels,
        loadLabels,
        loadStoryUserState,
        migrateStoryUserState,
        openStory,
        relatedStories,
        setStorySubtypes,
        story,
        storyAnnotations,
        storySubtypes,
        toggleStoryFavorite,
    } = storyWorkspace;
    const {
        entities,
        linkEntityToStory,
        loadEntities,
        unlinkEntityFromStory,
    } = entityWorkspace;
    // 只取「关联已有话题」用的命令：创建话题在 `/topics`（ADR-0029 决策 1）。
    const { joinTopic, loadTopics, topics } = topicWorkspace;

    useEffect(() => {
        void openStory(storyId).finally(() => setLoading(false));
    }, [openStory, storyId]);

    useEffect(() => {
        void loadEntities();
        void loadTopics();
        // 标签目录要显式加载：不加载时「选择要添加的标签」下拉不会渲染，Story 就无法打标签。
        void loadLabels();
    }, [loadEntities, loadLabels, loadTopics]);

    /*
     * ADR-0029 决策 7 的刷新边界：详情页**正在编辑时不覆盖**，显示「有新变化，重新读取？」
     * 交给用户决定；没在编辑就静默后台重读（滚动位置与展开状态都不动）。
     * `useLiveTopic` 通过 ref 转发回调，所以这里读到的是最新的 `unsavedEdit`。
     */
    useLiveTopic("stories", () => {
        if (unsavedEdit) {
            setStale(true);
            return;
        }
        void openStory(storyId);
    });

    const reloadStory = async (): Promise<void> => {
        setStale(false);
        // 先读到新内容再递增 token：编辑面据此把草稿对齐到新内容，顺序反过来会对齐到旧内容。
        await openStory(storyId);
        setReloadToken((value) => value + 1);
    };

    useEffect(() => {
        // 受管理 subtype 目录（ORG-013）读取失败只让下拉退化为「无 subtype」，不阻断阅读。
        void client.listStorySubtypes().then(setStorySubtypes).catch(() => undefined);
    }, [setStorySubtypes]);

    const toggleFavorite = async (): Promise<void> => {
        if (story === null) {
            return;
        }
        setTogglingFavorite(true);
        try {
            await toggleStoryFavorite(!story.favorited);
        } finally {
            setTogglingFavorite(false);
        }
    };

    /**
     * 阅读页没有「当前看板」这个跨页状态（首页的选中看板不跨路由保留），所以固定一律落到
     * 默认看板；`ensureDefaultBoard` 幂等 seed，未建过看板时也不会失败（ADR-0010 决定 4）。
     */
    const pinStoryToBoard = async (): Promise<void> => {
        if (story === null) {
            return;
        }
        try {
            const board = await client.ensureDefaultBoard();
            await client.pinSpotlight({
                boardId: board.id,
                targetType: "story",
                targetId: story.story.id,
            });
            showNotice(messages.reading.pinnedNotice);
        } catch (caught) {
            setError(readError(caught));
        }
    };

    /**
     * 归并目标候选（判据 R3：不要求用户粘贴内部 Story ID）。
     *
     * 复用既有 `GET /search`，不新增读查询。搜索以 **Entry** 为投影单位，同一条 Story
     * 会有多行，所以必须按 storyId 去重——不去重的话选择列表里会出现重复标题，
     * 用户选哪一条都指向同一个 Story。代价：候选只包含有当前 Revision 的 Story，
     * 历史壳与零成员 Story 不可选（既有读合同的边界，本 Task 不扩合同）。
     */
    const searchMergeTargets = async (text: string) => {
        const query = text.trim();
        const page = await client.search(query === "" ? { limit: 20 } : { text: query, limit: 20 });
        const seen = new Set<string>();
        const candidates: { storyId: string; title: string }[] = [];
        for (const item of page.items) {
            if (item.storyId === storyId || seen.has(item.storyId)) {
                continue;
            }
            seen.add(item.storyId);
            candidates.push({ storyId: item.storyId, title: item.title });
        }
        return candidates;
    };

    if (loading && story === null) {
        return <p className="text-[13px] text-muted-foreground">{messages.common.loading}</p>;
    }
    if (story === null) {
        return (
            <div className="rounded-[var(--radius-card)] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-6 py-12 text-center">
                <p className="text-[14px] font-medium">{messages.reading.missingTitle}</p>
                <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                    {error ?? messages.reading.missingBody}
                </p>
                <Link
                    className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-3 text-[13px] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href="/"
                >
                    <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
                    {messages.reading.backToBoard}
                </Link>
            </div>
        );
    }

    const primary = story.entry;
    const revision = primary?.revisions[0] ?? null;

    return (
        <div className="mx-auto flex w-[80vw] flex-col gap-6">
                <PageBanners error={error} />

                {stale && (
                <div
                    className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-border bg-muted/40 p-3 text-[13px] leading-6"
                    role="status"
                >
                    <span>{messages.reading.staleStory}</span>
                    <Button
                        className="ml-auto"
                        size="sm"
                        variant="outline"
                        onClick={() => void reloadStory()}
                    >
                        {messages.reading.reloadStory}
                    </Button>
                </div>
            )}

            {/*
             * 3:1 两栏：整组是父级的 80%（= 视口 80vw），两栏按 3:1 分。
             * 右栏带 240 px 下限（维护者 2026-10-03）：按 3:1 算，1024 px 窗口下右栏只剩
             * 199 px，「标题」输入框被压成一条、下拉选项文字截断。下限只在窄窗口生效
             * （1440 px 时右栏 282 px 本就够宽），代价是窄窗口下整组略超出 80%，
             * 由左栏让位补偿——这是维护者选定的一档，不改成「左栏自适应」。
             */}
            <div
                className="grid grid-cols-1 items-start gap-6 min-[1024px]:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]"
                data-story-columns="true"
            >
                <div className="flex min-w-0 flex-col gap-6" data-story-column="content">
                    <article className="rounded-[var(--radius-card)] bg-paper p-8 shadow-[var(--elevation-card)]">
                        <header className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                <Badge variant="secondary">{story.story.kind}</Badge>
                                {story.story.subtype !== null && <Badge variant="outline">{story.story.subtype}</Badge>}
                                {primary !== null && <span>{primary.sourceName}</span>}
                                {revision?.sourcePublishedAt != null && (
                                    <span>{revision.sourcePublishedAt.slice(0, 10)}</span>
                                )}
                                {story.story.status === "split" && (
                                    <Badge data-story-shell="true" variant="outline">
                                        {messages.reading.splitBadge}
                                    </Badge>
                                )}
                            </div>

                            <h1
                                className="font-display text-[28px] leading-tight font-semibold tracking-tight"
                                data-story-id={story.story.id}
                            >
                                {story.story.title}
                            </h1>

                            {/*
                             * 摘要在与正文完全相同时不重复显示：采集侧有时把来源的描述同时写进
                             * summary 与 contentText，照原样渲染会让同一句话读两遍。
                             */}
                            {story.story.summary !== null
                                && story.story.summary !== ""
                                && story.story.summary !== revision?.contentText.trim() && (
                                <p className="text-[15px] leading-7 text-muted-foreground">
                                    {story.story.summary}
                                </p>
                            )}

                            <StoryEventTimeLine story={story} />
                            <StoryHumanProtectedNotice story={story} />
                        </header>

                        {revision !== null && revision.contentText.trim() !== "" && (
                            <div className="mt-6 w-full text-[16px] leading-[1.8] whitespace-pre-wrap">
                                {revision.contentText}
                            </div>
                        )}

                        {revision?.webUrl != null && (
                            <p className="mt-6">
                                {/*
                                 * `nativeButton={false}`：这里渲染的是 `<a>`，不关掉的话 Base UI
                                 * 会往控制台写一条「期望原生 button」的告警，而浏览器验收断言 console
                                 * 零错误——真链接又必须保留（新标签页打开原文、可复制地址）。
                                 */}
                                <Button
                                    nativeButton={false}
                                    render={<a href={revision.webUrl} rel="noreferrer" target="_blank" />}
                                    variant="outline"
                                >
                                    <ExternalLink data-icon="inline-start" />
                                    {messages.reading.readOriginal}
                                </Button>
                            </p>
                        )}

                        <div className="mt-8">
                            {/*
                             * 出处候选必须传真实清单：`keyFactSourceLabel` 只在候选里找不到时才回
                             * 「出处已删除」，传空数组会把**每一条**出处都渲染成「出处已删除」。
                             * 这里用的是与编辑面同一份候选（本 Story 成员 + 全量已加载条目，ADR-0021 决定 3）。
                             */}
                            <StoryKeyFactsBlock entryOptions={keyFactEntryOptions} story={story} />
                        </div>
                    </article>

                    <StoryReadingContent
                        busy={busy}
                        entryCandidates={keyFactEntryOptions}
                        entryOptions={entryOptions.filter((option) => {
                            return !story.evidence.some((item) => item.entryId === option.id);
                        })}
                        onActionError={setActionError}
                        onLinkEntry={storyWorkspace.linkEntryStory}
                        onLinkEntryRelation={storyWorkspace.linkEntryRelation}
                        onOpenRelatedStory={async (relatedId) => {
                            await openStory(relatedId);
                        }}
                        onUnlinkEntry={storyWorkspace.unlinkEntryStory}
                        onUnlinkEntryRelation={storyWorkspace.unlinkEntryRelation}
                        relatedStories={relatedStories}
                        setBusy={setBusy}
                        story={story}
                    />
                </div>

                <div className="min-w-0" data-story-column="actions">
                    <StoryEditPanel
                        actionError={actionError}
                        annotations={storyAnnotations}
                        busy={busy}
                        collections={collections.items}
                        entityOptions={entities}
                        /*
                         * 「重新读取」通过换 key 重挂载编辑面：草稿与「未保存」的基准一起重新初始化，
                         * 不必在编辑面里写「prop 变了就 setState」的 effect（那会级联渲染，也被 lint 拦）。
                         */
                        key={`story-edit-${storyId}-${reloadToken}`}
                        labelOptions={labels.items}
                        onAttachLabel={storyWorkspace.attachLabelToStory}
                        onCreateAnnotation={storyWorkspace.createStoryAnnotation}
                        onDeleteAnnotation={storyWorkspace.deleteStoryAnnotation}
                        onDetachLabel={storyWorkspace.detachLabelFromStory}
                        onJoinTopic={joinTopic}
                        onLinkEntity={linkEntityToStory}
                        onLoadStoryUserState={loadStoryUserState}
                        onMergeStory={storyWorkspace.mergeStory}
                        onMigrateStoryUserState={migrateStoryUserState}
                        onOpenRelatedStory={async (relatedId) => {
                            await openStory(relatedId);
                        }}
                        onPinToBoard={pinStoryToBoard}
                        onSearchMergeTargets={searchMergeTargets}
                        onSplitStory={storyWorkspace.splitStory}
                        onToggleCollection={storyWorkspace.toggleStoryCollection}
                        onToggleFavorite={toggleFavorite}
                        onUnlinkEntity={unlinkEntityFromStory}
                        onUnsavedChange={setUnsavedEdit}
                        onUpdateAnnotation={storyWorkspace.updateStoryAnnotation}
                        onUpdateStoryRevision={storyWorkspace.updateStoryRevision}
                        setActionError={setActionError}
                        setBusy={setBusy}
                        story={story}
                        subtypeOptions={storySubtypes}
                        togglingFavorite={togglingFavorite}
                        topics={topics}
                    />
                </div>
            </div>
        </div>
    );
}
