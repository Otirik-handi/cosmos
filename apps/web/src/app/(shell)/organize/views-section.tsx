"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { SavedView } from "@cosmos/contracts";

import { client, readError } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { messages } from "@/copy/messages";

import { ItemBlock, SectionMessage, SectionShell } from "./section-parts";

/*
 * 已保存视图分区。这里只做查看与删除：视图保存的是「一组检索条件」，条件是搜出来的，
 * 所以新建仍在信息库页（在那里保存当前条件）。把新建搬到这里就得在这里重做一套筛选控件。
 *
 * 已知缺口：没有改名命令，只能删了重建；也没有「套用视图」——套用需要检索上下文，
 * 点视图名会跳到信息库并带上条件。
 */
export function ViewsSection() {
    const toast = useToast();
    const [views, setViews] = useState<readonly SavedView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        try {
            setViews((await client.listSavedViews()).items);
            setError(null);
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // 首次读取：load 内部先 await 再 setState，不会在渲染期间同步触发级联渲染。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const remove = async (view: SavedView): Promise<void> => {
        try {
            await client.deleteSavedView(view.id);
            await load();
            toast.success({ title: messages.organize.views.removed(view.name) });
        } catch (caught) {
            toast.error({ title: messages.organize.views.removeFailed, description: readError(caught) });
        }
    };

    return (
        <SectionShell
            count={loading ? null : views.length}
            summary={messages.organize.views.summary}
            title={messages.organize.tabs.views}
        >
            {error ? (
                <SectionMessage kind="error">{error}</SectionMessage>
            ) : loading ? (
                <SectionMessage kind="loading">{messages.common.loading}</SectionMessage>
            ) : views.length === 0 ? (
                <SectionMessage kind="empty">{messages.organize.views.empty}</SectionMessage>
            ) : (
                <ul className="flex flex-col">
                    {views.map((view) => (
                        <ItemBlock key={view.id}>
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <Link
                                    className="truncate text-[14px] hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    href={`/library?q=${encodeURIComponent(view.text ?? "")}`}
                                >
                                    {view.name}
                                </Link>
                                <span className="text-[11px] leading-5 text-muted-foreground">
                                    {describeConditions(view)}
                                </span>
                            </div>
                            <Button
                                aria-label={messages.organize.views.removeLabel(view.name)}
                                onClick={() => void remove(view)}
                                size="icon-sm"
                                variant="ghost"
                            >
                                <Trash2 aria-hidden className="size-3.5" strokeWidth={1.75} />
                            </Button>
                        </ItemBlock>
                    ))}
                </ul>
            )}
        </SectionShell>
    );
}

/** 把保存的条件说成人话，让人不用点开就知道这条视图筛的是什么。 */
function describeConditions(view: SavedView): string {
    const parts: string[] = [];
    if (view.text !== null && view.text !== "") {
        parts.push(messages.organize.views.conditionText(view.text));
    }
    if (view.sourceId !== null) {
        parts.push(messages.organize.views.conditionSource);
    }
    if (view.publishedAfter !== null) {
        parts.push(messages.organize.views.conditionFrom(view.publishedAfter.slice(0, 10)));
    }
    if (view.publishedBefore !== null) {
        parts.push(messages.organize.views.conditionTo(view.publishedBefore.slice(0, 10)));
    }
    if (view.labelIds.length > 0) {
        parts.push(messages.organize.views.conditionLabels(view.labelIds.length));
    }
    if (view.topicIds.length > 0) {
        parts.push(messages.organize.views.conditionTopics(view.topicIds.length));
    }
    return parts.length === 0 ? messages.organize.views.noConditions : parts.join(" · ");
}
