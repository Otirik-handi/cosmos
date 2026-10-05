"use client";

import { ArrowLeft, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { TopicDetail } from "@cosmos/contracts";

import { useNoticeToast } from "@/app/home/use-notice-toast";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";
import { useTopicWorkspace } from "@/app/home/use-topic-workspace";

import { PageBanners } from "@/components/shell/page-banners";
import { Button } from "@/components/ui/button";
import { messages } from "@/copy/messages";

import { createTopicDetailActions } from "./topic-detail-actions";
import { TopicFieldsSection } from "./topic-fields-section";
import { TopicMembersSection } from "./topic-members-section";

/*
 * 话题详情页的页面体（`/topics/:id`）：改标题与目的、改成员角色、移除与恢复成员。
 *
 * 页面只读话题本身，批注不在这里（写批注的入口在 Story 页）。写命令走 `useTopicWorkspace`，
 * 它把命令回执里的新详情直接写回状态，所以每个动作之后界面显示的就是服务端结果。
 *
 * **不显示路由里的 id**（判据 R3）：标题与成员名都取读模型里用户可见的字段，
 * 成员标题读不到时用占位句，不退回内部编号。
 *
 * 已知缺口：这里不订阅实时事件，外部改动要等下一次读取（刷新或本页动作）才出现。
 */

/** 计数只算在话题里的成员；已移除的不计入（与列表页的成员数同一口径）。 */
function memberCountLabel(topic: TopicDetail): string {
    const active = topic.members.filter((member) => !member.removed).length;
    return active === 0
        ? messages.pages.topics.detail.emptyMemberCount
        : messages.pages.topics.detail.memberCount(active);
}

export function TopicDetail({ topicId }: { topicId: string }) {
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** 写回执走 toast；`error` 仍由页面横幅显示。上下文对象身份稳定由 hook 保证。 */
    const { context: workspaceContext } = useNoticeToast(setError, setLoading);
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const topicApi = useTopicWorkspace(workspaceContext, storyWorkspace);
    const { loadTopicDetail, topic } = topicApi;

    const read = useCallback(async (): Promise<void> => {
        setLoading(true);
        setNotFound((await loadTopicDetail(topicId)) === "not_found");
        setLoading(false);
    }, [loadTopicDetail, topicId]);

    useEffect(() => {
        // 首次读取：read 内部先 await 再 setState，不会在渲染期间同步触发级联渲染。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void read();
    }, [read]);

    const actions = createTopicDetailActions({ reload: read, setError, topic, topicApi });

    return (
        <div className="flex w-full flex-col gap-4">
            <Link
                className="inline-flex w-fit items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                href="/topics"
            >
                <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
                {messages.pages.topics.detail.backToList}
            </Link>

            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[15px] font-medium">
                    {topic?.topic.title ?? messages.pages.topics.detail.title}
                </h1>
                {topic !== null && (
                    <span className="text-[12px] text-muted-foreground">{memberCountLabel(topic)}</span>
                )}
                <Button
                    className="ml-auto"
                    disabled={loading}
                    onClick={() => void read()}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCcw data-icon="inline-start" />
                    {messages.common.refresh}
                </Button>
            </div>

            <PageBanners error={error} />

            {loading && topic === null ? (
                <p className="text-[13px] text-muted-foreground">{messages.common.loading}</p>
            ) : notFound ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                    <p className="text-[13px] font-medium">
                        {messages.pages.topics.detail.notFoundTitle}
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                        {messages.pages.topics.detail.notFoundBody}
                    </p>
                </div>
            ) : topic === null ? null : (
                <>
                    <TopicFieldsSection onSave={actions.saveFields} topic={topic} />
                    <TopicMembersSection
                        onChangeRole={actions.changeMemberRole}
                        onRemove={actions.removeMember}
                        onRestore={actions.restoreMember}
                        topic={topic}
                    />
                </>
            )}
        </div>
    );
}
