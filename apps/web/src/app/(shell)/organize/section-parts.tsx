"use client";

import type { ReactNode } from "react";

import { messages } from "@/copy/messages";
import { cn } from "@/lib/utils";

/*
 * 整理页五分区的共享小件。五个分区结构相同（标题 + 新建 + 列表 + 空态），
 * 差异只在数据与操作，所以共用这三个，不各自重写。
 */

export const blockClass =
    "rounded-[var(--radius-card)] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))]";

export function SectionShell({
    title,
    summary,
    count,
    children,
}: {
    title: string;
    summary: string;
    count: number | null;
    children: ReactNode;
}) {
    return (
        <section aria-label={title} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[15px] font-medium">{title}</h2>
                <span className="text-[12px] text-muted-foreground">{summary}</span>
                {count !== null && (
                    <span className="ml-auto font-mono text-[12px] text-muted-foreground">
                        {messages.organize.sectionCount(count)}
                    </span>
                )}
            </div>
            {children}
        </section>
    );
}

export function SectionMessage({
    kind,
    children,
}: {
    kind: "empty" | "error" | "loading";
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                blockClass,
                "px-4 py-6 text-center text-[13px] leading-6",
                kind === "error" ? "text-destructive" : "text-muted-foreground",
            )}
        >
            {children}
        </div>
    );
}

export function ItemBlock({ children }: { children: ReactNode }) {
    return (
        <li className={cn(blockClass, "mb-1 flex items-start gap-3 px-3 py-3")}>{children}</li>
    );
}
