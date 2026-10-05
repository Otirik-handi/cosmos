"use client";

import type { ReactNode } from "react";

/*
 * 详情页三个分区（别名 / 关系 / 关联 Story）结构相同：标题 + 计数 + 内容或空态。
 * 差异只在数据与操作，所以共用这个壳，不各自重写。空态样式沿用列表页的虚线框。
 */

export function DetailSection({
    title,
    count,
    children,
}: {
    title: string;
    /** 已按文案模块格式化好的计数；没有内容时传 null，不显示计数。 */
    count: string | null;
    children: ReactNode;
}) {
    return (
        <section aria-label={title} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[15px] font-medium">{title}</h2>
                {count !== null && (
                    <span className="font-mono text-[12px] text-muted-foreground">{count}</span>
                )}
            </div>
            {children}
        </section>
    );
}

export function DetailMessage({ children }: { children: ReactNode }) {
    return (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-6 text-center text-[13px] leading-6 text-muted-foreground">
            {children}
        </div>
    );
}
