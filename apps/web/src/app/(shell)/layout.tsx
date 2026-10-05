import type { ReactNode } from "react";

import { NarrowWindowNotice } from "@/components/shell/narrow-window-notice";
import { SideNav } from "@/components/shell/side-nav";
import { TopBar } from "@/components/shell/top-bar";
import { ToastHost, ToastProvider } from "@/components/ui/toast";

/**
 * 带侧栏的内容组（ADR-0029 决策 2）：顶栏与悬浮侧栏是跨页面常驻框架，切页不重建。
 * `/stories/:id` 走 `(reading)` 组，是唯一例外（隐藏侧栏、保留顶栏与返回入口）。
 * 实时连接在根布局的 LiveProvider 里，这里只负责版面。
 *
 * 1024 px 以下不做降级布局：外壳整组隐藏，只留「窗口过窄」提示（ADR-0029 决策 6）。
 *
 * `ToastProvider` 与宿主挂在这一层：内容组每个页面都要 `useToast`（写回执走 toast），
 * 而 context 只能由**祖先**提供——页面自己渲染 Provider 会抛
 * 「useToastManager must be used within <Toast.Provider>」。宿主一页一处，所以不放根布局
 * （那会让所有路由共用同一个视口实例，且 PWA/错误页也会带上它）。
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
    return (
        <ToastProvider>
            <div className="flex min-h-screen flex-col bg-background text-foreground max-[1023px]:hidden">
                <TopBar />
                {/*
                 * 「侧栏 + 内容」作为一个整体居中：196×`--nav-scale` + 20 + 880。
                 * 侧栏基准 196 px，`--nav-scale` 当前 1.25（维护者 2026-10-03：侧栏等比放大，
                 * 1.5 过大后收敛到 1.25）→ 整组 1145 px。**这个 max-w 必须跟着 `--nav-scale` 走**：
                 * 写死旧值 1120 时侧栏一涨，
                 * 主内容就被挤到 806 px，直接违反「内容限宽 880」的门禁。主内容区仍 880 px——
                 * 行宽不随侧栏放大而变宽。窗口更窄时由 flex 压缩主内容（`min-w-0`），不产生横向溢出。
                 *
                 * `pt-[2.5em]` 是顶栏与下方框架之间的间隔（维护者 2026-10-03 两轮裁定：先是「间隔较小」，
                 * 再由 16 px 加大到 **2.5em = 40 px**）。用 em 而不是 px：这个层级字号是 16 px（继承自
                 * body），em 让间隔跟着字号体系走，与 V4 的形状/密度 token 同一口径。
                 * 侧栏是 `self-start`，两者一起下移、间距一致。放在这一层而不是顶栏自身的
                 * 底部内边距，是因为后者会让 64 px 顶栏里的内容偏上、不再垂直居中。
                 */}
                <div className="mx-auto flex w-full max-w-[calc(196px*var(--nav-scale)+900px)] min-h-0 flex-1 items-start gap-5 px-5 pt-[2.5em] pb-5">
                    <SideNav />
                    {/*
                     * 内容限宽 880px。
                     *
                     * 为什么不是 E5 原文的 1080px：那是按「外壳容器」定的，但信息库的竖排列表项
                     * 与看板区块会跟着容器一起变宽——实测 1080px 下卡牌宽高比 7.4:1，标题只占
                     * 350px、摘要只占一行，七成横向空间是空白。这个列表在旧首页的正文列里实际
                     * 只有约 800px（max-w-7xl 减 300px 侧栏与间距），880px 让它回到原来的可读
                     * 比例，同时容得下检索行里的日期区间与三个下拉。ADR-0029 决策 6 已按实测修正。
                     */}
                    <main className="flex min-w-0 flex-1 justify-start">
                        <div className="w-full min-w-0 max-w-[880px]">{children}</div>
                    </main>
                </div>
            </div>
            <NarrowWindowNotice />
            <ToastHost />
        </ToastProvider>
    );
}
