"use client";

import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FeedItem } from "@cosmos/contracts";

/*
 * 「系统产出」区块：列出由系统或 Agent 产生的 Story。
 *
 * 「谁写的」取每个 Story 当前 Revision 的 producer（ADR-0028）：`human` 表示这版内容
 * 由人写过并已对自动写入方冻结，`system` / `agent` 表示机器产出。用 marker 语义色
 * 标记机器产出——它只用于此，不当作通用强调色。
 */

function isMachineProduced(producer: string | null | undefined): boolean {
    return producer === "system" || producer === "agent";
}

function producerLabel(producer: string | null | undefined): string {
    if (producer === "agent") {
        return "Agent 产生";
    }
    if (producer === "system") {
        return "系统创建";
    }
    return "人工编辑过";
}

export function SystemOutputBlock({
    items,
    loading,
    onOpenStory,
    openingStoryId,
}: {
    items: readonly FeedItem[];
    loading: boolean;
    onOpenStory: (storyId: string) => void;
    openingStoryId?: string | null;
}) {
    return (
        <section aria-label="系统产出" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-x-4">
                <h2 className="text-[15px] font-medium">系统产出</h2>
                <span className="text-[12px] text-muted-foreground">
                    由系统或 Agent 产生的内容，人工编辑过的会标出
                </span>
            </div>

            {loading && items.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">正在读取…</p>
            ) : items.length === 0 ? (
                <div className="rounded-[var(--radius-card)] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-4 py-8 text-center">
                    <p className="text-[13px] font-medium">还没有系统产出</p>
                    <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                        采集运行产生的内容会自动出现在这里。
                    </p>
                </div>
            ) : (
                <ul className="flex flex-col">
                    {items.map((item) => (
                        <li
                            className="mb-1 flex items-start gap-2 rounded-[var(--radius-card)] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-3 py-2.5"
                            key={item.entryId}
                        >
                            <FileText
                                aria-hidden
                                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                                strokeWidth={1.75}
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary">{item.storyKind}</Badge>
                                    {isMachineProduced(item.producer) ? (
                                        <span className="inline-flex items-center gap-1 rounded-[4px] bg-marker-soft px-1.5 py-px text-[11px] leading-4 text-marker">
                                            <span aria-hidden className="size-1.5 rounded-full bg-marker" />
                                            {producerLabel(item.producer)}
                                        </span>
                                    ) : (
                                        <span className="text-[11px] text-muted-foreground">
                                            {producerLabel(item.producer)}
                                        </span>
                                    )}
                                    <span className="text-[12px] text-muted-foreground">{item.sourceName}</span>
                                </div>
                                <Button
                                    aria-disabled={openingStoryId === item.storyId}
                                    className="h-auto justify-start p-0 text-left text-[13px] font-normal aria-disabled:pointer-events-none aria-disabled:opacity-50"
                                    onClick={() => onOpenStory(item.storyId)}
                                    variant="link"
                                >
                                    {item.title}
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
