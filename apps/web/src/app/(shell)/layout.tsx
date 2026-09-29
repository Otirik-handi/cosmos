import type { ReactNode } from "react";

import { SideNav } from "@/components/shell/side-nav";
import { TopBar } from "@/components/shell/top-bar";

/**
 * 带侧栏的内容组（ADR-0029 决策 2）：顶栏与悬浮侧栏是跨页面常驻框架，切页不重建。
 * `/stories/:id` 走 `(reading)` 组，是唯一例外（隐藏侧栏、保留顶栏与返回入口）。
 * 实时连接在根布局的 LiveProvider 里，这里只负责版面。
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <TopBar />
            <div className="flex min-h-0 flex-1 items-start gap-5 px-5 pb-5">
                <SideNav />
                <main className="min-w-0 flex-1">{children}</main>
            </div>
        </div>
    );
}
