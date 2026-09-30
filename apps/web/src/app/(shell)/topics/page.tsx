"use client";

import { RefreshCcw, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useStoryWorkspace } from "@/app/home/use-story-workspace";
import { useTopicWorkspace } from "@/app/home/use-topic-workspace";

import { Button } from "@/components/ui/button";
import { useLiveTopic } from "@/components/shell/live-provider";

/*
 * 话题列表。切片 3b 只做**浏览与跳转**：新建话题、加入 Story、改角色、移除与恢复成员
 * 都在话题页落地（切片 3c），因为那时才同批删掉 Story 抽屉里的旧表单——两片各管一头，
 * 避免同一件事出现两个可写入口。
 */
export default function TopicsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const workspaceContext = useMemo(() => ({ setError, setNotice, setLoading }), []);
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const { loadTopics, topics } = useTopicWorkspace(workspaceContext, storyWorkspace);

    useEffect(() => {
        void loadTopics().finally(() => setLoading(false));
    }, [loadTopics]);

    useLiveTopic("stories", () => {
        void loadTopics();
    });

    return (
        <div className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[15px] font-medium">话题</h1>
                <span className="text-[12px] text-muted-foreground">
                    {topics.length === 0 ? "尚未创建话题" : `${topics.length} 个话题`}
                </span>
                <Button
                    className="ml-auto"
                    disabled={loading}
                    onClick={() => void loadTopics()}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCcw data-icon="inline-start" />
                    刷新
                </Button>
            </div>

            {error && (
                <div
                    className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-3 text-[13px] leading-6 text-destructive"
                    role="alert"
                >
                    {error}
                </div>
            )}
            {notice && (
                <div
                    className="rounded-[var(--radius-control)] border border-border bg-muted/40 p-3 text-[13px] leading-6"
                    role="status"
                >
                    {notice}
                </div>
            )}

            {loading && topics.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">正在读取…</p>
            ) : topics.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                    <p className="text-[13px] font-medium">还没有话题</p>
                    <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                        话题是为了持续理解某个问题而建立的范围。新建入口与成员维护随下一步落地；
                        现在可以先从看板或信息库浏览内容。
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
                                {topic.memberCount} 条内容
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
