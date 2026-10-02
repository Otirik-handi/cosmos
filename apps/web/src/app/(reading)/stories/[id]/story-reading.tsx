"use client";

import { ArrowLeft, ExternalLink, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useEntityWorkspace } from "@/app/home/use-entity-workspace";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";
import { useTopicWorkspace } from "@/app/home/use-topic-workspace";
import { client, readError } from "@/app/home/page-runtime";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StoryEditSurface } from "@/components/cosmos/story-edit-surface";
import { PageBanners } from "@/components/shell/page-banners";
import { messages } from "@/copy/messages";
import {
    StoryEventTimeLine,
    StoryHumanProtectedNotice,
    StoryKeyFactsBlock,
} from "@/components/cosmos/story-panel/representation";

/*
 * Story 阅读页（ADR-0029 决策 7）。工作区里唯一的 `(reading)` 路由：只有顶栏，没有侧栏。
 *
 * 版面按 V4 的排版规格：正文卡片 640px、标题用衬线（font-display）、正文 16px/1.8、
 * 阅读列 34em。正文取主成员当前 Revision 的 contentText——这是产品里第一次显示条目正文。
 *
 * 读与写同居一页：只读区块（来源成员、时间线、证据、相关内容）常驻，写入动作收在
 * `StoryEditSurface` 的「编辑与关联」里按需展开（ADR-0029 决策 1：关联动作就地）。
 * 因此取数与写入都走 `useStoryWorkspace`——抽屉删除后，这里是 Story 的唯一可写入口。
 */
export function StoryReading({ storyId }: { storyId: string }) {
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [togglingFavorite, setTogglingFavorite] = useState(false);

    /** 与首页同一约定：上下文对象必须身份稳定，否则各域 hook 的 effect 每次渲染都重跑。 */
    const workspaceContext = useMemo(() => ({ setError, setNotice, setLoading }), []);
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
            setNotice(messages.reading.pinnedNotice);
        } catch (caught) {
            setError(readError(caught));
        }
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
        <div className="flex w-full flex-col gap-8">
            <PageBanners error={error} notice={notice} />

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
                        <p className="max-w-[34em] text-[15px] leading-7 text-muted-foreground">
                            {story.story.summary}
                        </p>
                    )}

                    <StoryEventTimeLine story={story} />
                    <StoryHumanProtectedNotice story={story} />
                </header>

                {revision !== null && revision.contentText.trim() !== "" && (
                    <div className="mt-6 max-w-[34em] text-[16px] leading-[1.8] whitespace-pre-wrap">
                        {revision.contentText}
                    </div>
                )}

                {revision?.webUrl != null && (
                    <p className="mt-6">
                        <Button render={<a href={revision.webUrl} rel="noreferrer" target="_blank" />} variant="outline">
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

            {/* 读完动作区：收藏与跳转；编辑、归并与拆分在下方「编辑与关联」里按需展开。 */}
            <section aria-label={messages.reading.actionsLabel} className="flex flex-wrap items-center gap-2">
                <Button
                    disabled={togglingFavorite}
                    onClick={() => void toggleFavorite()}
                    variant={story.favorited ? "default" : "outline"}
                >
                    <Star
                        aria-hidden
                        className={story.favorited ? "size-3.5 fill-current" : "size-3.5"}
                        data-icon="inline-start"
                        strokeWidth={1.75}
                    />
                    {story.favorited ? messages.reading.favorited : messages.reading.favorite}
                </Button>
                <Link
                    className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-[13px] text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href="/"
                >
                    <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
                    {messages.reading.backToBoard}
                </Link>
            </section>

            <section aria-label={messages.reading.sourceAndEditLabel} className="flex flex-col gap-6">
                <StoryEditSurface
                    annotations={storyAnnotations}
                    collections={collections.items}
                    entityOptions={entities}
                    entryCandidates={keyFactEntryOptions}
                    entryOptions={entryOptions.filter((option) => {
                        return !story.evidence.some((item) => item.entryId === option.id);
                    })}
                    labelOptions={labels.items}
                    onAttachLabel={storyWorkspace.attachLabelToStory}
                    onCreateAnnotation={storyWorkspace.createStoryAnnotation}
                    onDeleteAnnotation={storyWorkspace.deleteStoryAnnotation}
                    onDetachLabel={storyWorkspace.detachLabelFromStory}
                    onJoinTopic={joinTopic}
                    onLinkEntity={linkEntityToStory}
                    onLinkEntry={storyWorkspace.linkEntryStory}
                    onLinkEntryRelation={storyWorkspace.linkEntryRelation}
                    onLoadStoryUserState={loadStoryUserState}
                    onMergeStory={storyWorkspace.mergeStory}
                    onMigrateStoryUserState={migrateStoryUserState}
                    onOpenRelatedStory={async (relatedId) => {
                        await openStory(relatedId);
                    }}
                    onPinToBoard={pinStoryToBoard}
                    onSplitStory={storyWorkspace.splitStory}
                    onToggleCollection={storyWorkspace.toggleStoryCollection}
                    onToggleFavorite={toggleStoryFavorite}
                    onUnlinkEntity={unlinkEntityFromStory}
                    onUnlinkEntry={storyWorkspace.unlinkEntryStory}
                    onUnlinkEntryRelation={storyWorkspace.unlinkEntryRelation}
                    onUpdateAnnotation={storyWorkspace.updateStoryAnnotation}
                    onUpdateStoryRevision={storyWorkspace.updateStoryRevision}
                    relatedStories={relatedStories}
                    story={story}
                    subtypeOptions={storySubtypes}
                    topics={topics}
                />
            </section>
        </div>
    );
}
