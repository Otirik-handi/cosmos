"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { SavedView } from "@cosmos/contracts";

import { client, readError } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

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
            toast.success({ title: `已删除视图「${view.name}」` });
        } catch (caught) {
            toast.error({ title: "删除视图失败", description: readError(caught) });
        }
    };

    return (
        <SectionShell
            count={loading ? null : views.length}
            summary="存下来的一组检索条件；在信息库保存，这里用来查看与删除"
            title="已保存视图"
        >
            {error ? (
                <SectionMessage kind="error">{error}</SectionMessage>
            ) : loading ? (
                <SectionMessage kind="loading">正在读取…</SectionMessage>
            ) : views.length === 0 ? (
                <SectionMessage kind="empty">
                    还没有视图。在信息库设好筛选条件后点「保存当前条件」。
                </SectionMessage>
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
                                aria-label={`删除视图 ${view.name}`}
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
        parts.push(`关键词「${view.text}」`);
    }
    if (view.sourceId !== null) {
        parts.push("限定来源");
    }
    if (view.publishedAfter !== null) {
        parts.push(`从 ${view.publishedAfter.slice(0, 10)}`);
    }
    if (view.publishedBefore !== null) {
        parts.push(`到 ${view.publishedBefore.slice(0, 10)}`);
    }
    if (view.labelIds.length > 0) {
        parts.push(`${view.labelIds.length} 个标签`);
    }
    if (view.topicIds.length > 0) {
        parts.push(`${view.topicIds.length} 个话题`);
    }
    return parts.length === 0 ? "没有条件（等同全部内容）" : parts.join(" · ");
}
