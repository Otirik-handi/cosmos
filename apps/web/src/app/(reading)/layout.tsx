import type { ReactNode } from "react";

import { NarrowWindowNotice } from "@/components/shell/narrow-window-notice";
import { TopBar } from "@/components/shell/top-bar";
import { ToastHost, ToastProvider } from "@/components/ui/toast";

/**
 * 阅读组：只保留顶栏（带返回入口），隐藏左侧栏。
 * 这是版面骨架的唯一例外——读一条内容的宽度优先，同时顶栏保证回程入口存在。
 * 实时连接在根布局的 LiveProvider 里，这里只负责版面。
 * 1024 px 以下与内容组同一条规则：外壳隐藏，只留「窗口过窄」提示。
 *
 * `ToastProvider` 挂在这一层而不是页面里：页面自己要 `useToast`（把写回执转成 toast），
 * 而 context 只能由**祖先**提供——在同一个组件里先调用再渲染 Provider 会直接抛
 * 「useToastManager must be used within <Toast.Provider>」。宿主也放这里，一页一处。
 */
export default function ReadingLayout({ children }: { children: ReactNode }) {
    return (
        <ToastProvider>
            <div className="flex min-h-screen flex-col bg-background text-foreground max-[1023px]:hidden">
                <TopBar showBack />
                {/* `pt-[2.5em]`：与内容组同一条间隔（维护者 2026-10-03，2.5em = 40 px），两组顶栏下方留白一致。 */}
                <main className="min-w-0 flex-1 px-5 pt-[2.5em] pb-5">{children}</main>
            </div>
            <NarrowWindowNotice />
            <ToastHost />
        </ToastProvider>
    );
}
