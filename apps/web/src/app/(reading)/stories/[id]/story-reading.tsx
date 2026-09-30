"use client";

import { ArrowLeft, ExternalLink, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { StoryDetail } from "@cosmos/contracts";

import { client, readError, RELATED_STORY_PORTS } from "@/app/home/page-runtime";
import { loadRelatedStories, type RelatedStory } from "@/lib/related-stories";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EvidenceSection } from "@/components/cosmos/story-panel/evidence";
import { RelatedSection } from "@/components/cosmos/story-panel/related";
import {
    StoryEventTimeLine,
    StoryHumanProtectedNotice,
    StoryKeyFactsBlock,
} from "@/components/cosmos/story-panel/representation";
import { SourceMembersSection } from "@/components/cosmos/story-panel/source-members";
import { TimelineSection } from "@/components/cosmos/story-panel/timeline-section";

/*
 * Story 阅读页（ADR-0029 决策 7）。工作区里唯一的 `(reading)` 路由：只有顶栏，没有侧栏。
 *
 * 版面按 V4 的排版规格：正文卡片 640px、标题用衬线（font-display）、正文 16px/1.8、
 * 阅读列 34em。正文取主成员当前 Revision 的 contentText——这是产品里第一次显示条目正文。
 *
 * 只读：编辑、归并与切分不是阅读动作，留在原抽屉里；这一页负责「读」，并在读完动作区
 * 提供收藏与跳回。锚点（data-story-*）沿用 story-panel 的只读块，浏览器验收依赖它们。
 */
export function StoryReading({ storyId }: { storyId: string }) {
    const [story, setStory] = useState<StoryDetail | null>(null);
    const [related, setRelated] = useState<readonly RelatedStory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [togglingFavorite, setTogglingFavorite] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        try {
            // storyId 是路由参数，Next 已经解码过一次；transport 自己会编码，
            // 这里再编一次会变成 %253A（冒号双重编码）并 404。
            const detail = await client.story(storyId);
            setStory(detail);
            setError(null);
            // 相关内容依赖分组与 Entity，失败就退化为空列表，不阻断正文阅读。
            try {
                setRelated(await loadRelatedStories(detail, RELATED_STORY_PORTS));
            } catch {
                setRelated([]);
            }
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setLoading(false);
        }
    }, [storyId]);

    useEffect(() => {
        // 首次读取：load 内部先 await 再 setState，不会在渲染期间同步触发级联渲染。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const toggleFavorite = async (): Promise<void> => {
        if (story === null) {
            return;
        }
        setTogglingFavorite(true);
        try {
            const next = !story.favorited;
            await (next
                ? client.setFavorite({ targetType: "story", targetId: story.story.id })
                : client.unsetFavorite({ targetType: "story", targetId: story.story.id }));
            setStory({ ...story, favorited: next });
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setTogglingFavorite(false);
        }
    };

    if (loading) {
        return <p className="text-[13px] text-muted-foreground">正在读取…</p>;
    }
    if (story === null) {
        return (
            <div className="rounded-[var(--radius-card)] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-6 py-12 text-center">
                <p className="text-[14px] font-medium">这条内容读不到了</p>
                <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                    {error ?? "它可能已被合并到另一条内容里。"}
                </p>
                <Link
                    className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-3 text-[13px] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href="/"
                >
                    <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
                    回到看板
                </Link>
            </div>
        );
    }

    const primary = story.entry;
    const revision = primary?.revisions[0] ?? null;
    const producers: Record<string, string | null> = {};
    for (const member of story.entries) {
        producers[member.id] = story.story.producer;
    }

    return (
        <div className="flex w-full flex-col gap-8">
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
                                已被拆分
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
                            读原文
                        </Button>
                    </p>
                )}

                <div className="mt-8">
                    <StoryKeyFactsBlock entryOptions={[]} story={story} />
                </div>
            </article>

            {/* 读完动作区（ADR-0029 决策 7）：收藏与跳转；编辑与归并拆分留在原编辑面。 */}
            <section aria-label="读完动作" className="flex flex-wrap items-center gap-2">
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
                    {story.favorited ? "已收藏" : "收藏"}
                </Button>
                <Link
                    className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-[13px] text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href="/"
                >
                    <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
                    回到看板
                </Link>
            </section>

            <section aria-label="来源与关系" className="flex flex-col gap-6">
                <SourceMembersSection busy={false} producers={producers} story={story} />
                <TimelineSection events={timelineEvents(story)} />
                <EvidenceSection
                    busy={false}
                    linkEntryId=""
                    linkRelationType="evidence_for"
                    setLinkEntryId={() => {}}
                    setLinkRelationType={() => {}}
                    story={story}
                    submitLinkEntry={async () => {}}
                    submitUnlinkEntry={async () => {}}
                    title={story.story.title}
                />
                <RelatedSection busy={false} relatedStories={related} story={story} title={story.story.title} />
            </section>
        </div>
    );
}

/**
 * 时间线取主成员与证据条目的发布时间：阅读页要看的是「这件事按时间怎么发生的」，
 * 因此同一个 Story 下的多条来源合并成一条时间轴，不区分主成员与证据。
 */
function timelineEvents(story: StoryDetail) {
    const members = [...story.entries, ...(story.entry === null ? [] : [story.entry])];
    const seen = new Set<string>();
    const events: { id: string; at: string; kind: string; sourceName: string; title: string; detail: string | null }[] = [];
    for (const member of members) {
        if (seen.has(member.id)) {
            continue;
        }
        seen.add(member.id);
        const revision = member.revisions[0];
        const at = revision?.sourcePublishedAt ?? null;
        if (at === null) {
            continue;
        }
        events.push({
            id: member.id,
            at,
            kind: member.sourceKind,
            sourceName: member.sourceName,
            title: revision?.title ?? "无标题",
            detail: null,
        });
    }
    return events.sort((left, right) => left.at.localeCompare(right.at));
}
