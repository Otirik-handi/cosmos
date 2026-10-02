import type { ReactNode } from "react";

import { NarrowWindowNotice } from "@/components/shell/narrow-window-notice";
import { TopBar } from "@/components/shell/top-bar";

/**
 * 阅读组：只保留顶栏（带返回入口），隐藏左侧栏。
 * 这是版面骨架的唯一例外——读一条内容的宽度优先，同时顶栏保证回程入口存在。
 * 实时连接在根布局的 LiveProvider 里，这里只负责版面。
 * 1024 px 以下与内容组同一条规则：外壳隐藏，只留「窗口过窄」提示。
 */
export default function ReadingLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <div className="flex min-h-screen flex-col bg-background text-foreground max-[1023px]:hidden">
                <TopBar showBack />
                <main className="min-w-0 flex-1 px-5 pb-5">{children}</main>
            </div>
            <NarrowWindowNotice />
        </>
    );
}
