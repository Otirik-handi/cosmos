import type { ReactNode } from "react";

/**
 * 切片 1 的页面占位：路由与导航先立起来，真实内容在切片 3 搬迁。
 * 占位必须说明「这里将是什么」，不能留空白页——空屏会被误读成坏掉。
 */
export function PagePlaceholder({
    title,
    summary,
    children,
}: {
    title: string;
    summary: string;
    children?: ReactNode;
}) {
    return (
        <div className="flex w-full max-w-[1080px] flex-col gap-4">
            <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-[var(--elevation-card)]">
                <h1 className="font-serif text-[22px] font-semibold tracking-tight">{title}</h1>
                <p className="max-w-[52em] text-[13px] leading-6 text-muted-foreground">{summary}</p>
                {children}
            </section>
        </div>
    );
}
