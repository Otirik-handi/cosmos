"use client";

import { FileText, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { Annotation } from "@cosmos/contracts";

import { client, readError } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { ItemBlock, SectionMessage, SectionShell } from "./section-parts";

/*
 * 批注分区。不带目标查询列出全部批注——这条读取路径是切片 3a 新开的：扩展前
 * listAnnotations 必须带 targetType + targetId，因此无法回答「我写过哪些批注」。
 *
 * 批注对象只带 targetType/targetId，没有标题投影，所以这里只能显示批注正文与它挂在
 * 什么类型上；要跳回被批注的内容需要另一次查询。
 */
export function AnnotationsSection() {
    const toast = useToast();
    const [items, setItems] = useState<readonly Annotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        try {
            setItems((await client.listAnnotations({})).items);
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

    const remove = async (annotation: Annotation): Promise<void> => {
        try {
            await client.deleteAnnotation(annotation.id);
            await load();
            toast.success({ title: "已删除批注" });
        } catch (caught) {
            toast.error({ title: "删除批注失败", description: readError(caught) });
        }
    };

    return (
        <SectionShell
            count={loading ? null : items.length}
            summary="写给内容、条目或话题的笔记；在对应对象上写，这里用来回顾"
            title="批注"
        >
            {error ? (
                <SectionMessage kind="error">{error}</SectionMessage>
            ) : loading ? (
                <SectionMessage kind="loading">正在读取…</SectionMessage>
            ) : items.length === 0 ? (
                <SectionMessage kind="empty">
                    还没有批注。读内容时写下的想法会出现在这里。
                </SectionMessage>
            ) : (
                <ul className="flex flex-col">
                    {items.map((annotation) => (
                        <ItemBlock key={annotation.id}>
                            <FileText
                                aria-hidden
                                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                                strokeWidth={1.75}
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <p className="whitespace-pre-wrap text-[13px] leading-6">
                                    {annotation.body}
                                </p>
                                {annotation.quote !== null && annotation.quote !== "" && (
                                    <p className="border-l-2 border-border pl-2 text-[12px] leading-5 text-muted-foreground">
                                        {annotation.quote}
                                    </p>
                                )}
                                <span className="text-[11px] text-muted-foreground">
                                    挂在{annotation.targetType === "story"
                                        ? "内容"
                                        : annotation.targetType === "entry"
                                            ? "条目"
                                            : "话题"}上 ·
                                    {annotation.updatedAt.slice(0, 10)}
                                </span>
                            </div>
                            <Button
                                aria-label="删除这条批注"
                                onClick={() => void remove(annotation)}
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
