"use client";

import { RefreshCcw, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useStoryWorkspace } from "@/app/home/use-story-workspace";
import { useTopicWorkspace } from "@/app/home/use-topic-workspace";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLiveTopic } from "@/components/shell/live-provider";
import { PageBanners } from "@/components/shell/page-banners";
import { messages } from "@/copy/messages";

/*
 * 话题列表与新建。创建入口在**对象页**（ADR-0029 决策 1：创建动作去对象页、关联动作就地）：
 * 这里建话题，成员从 Story 页加入。改标题与目的、移除成员仍在待办里（`/topics/:id` 还是占位）。
 */
export default function TopicsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [newTitle, setNewTitle] = useState("");
    const [newPurpose, setNewPurpose] = useState("");

    const workspaceContext = useMemo(() => ({ setError, setNotice, setLoading }), []);
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const { createTopic, loadTopics, topics } = useTopicWorkspace(workspaceContext, storyWorkspace);

    useEffect(() => {
        void loadTopics().finally(() => setLoading(false));
    }, [loadTopics]);

    useLiveTopic("stories", () => {
        void loadTopics();
    });

    const canCreate = newTitle.trim() !== "" && newPurpose.trim() !== "";

    return (
        <div className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[15px] font-medium">{messages.pages.topics.title}</h1>
                <span className="text-[12px] text-muted-foreground">
                    {topics.length === 0
                        ? messages.pages.topics.emptyCount
                        : messages.pages.topics.countLabel(topics.length)}
                </span>
                <Button
                    className="ml-auto"
                    disabled={loading}
                    onClick={() => void loadTopics()}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCcw data-icon="inline-start" />
                    {messages.common.refresh}
                </Button>
            </div>

            <PageBanners error={error} notice={notice} />

            <div className="flex flex-wrap items-center gap-2">
                <Input
                    aria-label={messages.pages.topics.newTitle}
                    className="max-w-xs"
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder={messages.pages.topics.newTitle}
                    value={newTitle}
                />
                <Input
                    aria-label={messages.pages.topics.newPurpose}
                    className="max-w-sm"
                    onChange={(event) => setNewPurpose(event.target.value)}
                    placeholder={messages.pages.topics.newPurpose}
                    value={newPurpose}
                />
                <Button
                    disabled={!canCreate}
                    onClick={() => {
                        const title = newTitle.trim();
                        const purpose = newPurpose.trim();
                        setNewTitle("");
                        setNewPurpose("");
                        void createTopic(title, purpose);
                    }}
                    size="sm"
                    variant="outline"
                >
                    {messages.pages.topics.create}
                </Button>
            </div>

            {loading && topics.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{messages.common.loading}</p>
            ) : topics.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                    <p className="text-[13px] font-medium">{messages.pages.topics.emptyTitle}</p>
                    <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                        {messages.pages.topics.emptyBody}
                    </p>
                </div>
            ) : (
                <ul className="flex flex-col">
                    {topics.map((topic) => (
                        <li
                            className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
                            key={topic.id}
                        >
                            <Target
                                aria-hidden
                                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                                strokeWidth={1.75}
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <button
                                    className="text-left text-[14px] font-medium hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    onClick={() => router.push(`/topics/${encodeURIComponent(topic.id)}`)}
                                    type="button"
                                >
                                    {topic.title}
                                </button>
                                <p className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                                    {topic.purpose}
                                </p>
                            </div>
                            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                                {messages.common.storyCount(topic.memberCount)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
