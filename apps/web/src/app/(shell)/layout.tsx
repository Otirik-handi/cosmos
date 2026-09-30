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
            {/*
             * 「侧栏 + 内容」作为一个整体居中：196 + 20 + 880 = 1096px，取 1120px 留余量。
             * 只把内容在主区里居中是不够的——侧栏固定贴视口左边时，内容在视口里仍然偏右。
             */}
            <div className="mx-auto flex w-full max-w-[1120px] min-h-0 flex-1 items-start gap-5 px-5 pb-5">
                <SideNav />
                {/*
                 * 内容限宽 880px。
                 *
                 * 为什么不是 E5 原文的 1080px：那是按「外壳容器」定的，但信息库的竖排列表项
                 * 与看板区块会跟着容器一起变宽——实测 1080px 下卡牌宽高比 7.4:1，标题只占
                 * 350px、摘要只占一行，七成横向空间是空白。这个列表在旧首页的正文列里实际
                 * 只有约 800px（max-w-7xl 减 300px 侧栏与间距），880px 让它回到原来的可读
                 * 比例，同时容得下检索行里的日期区间与三个下拉。
                 */}
                <main className="flex min-w-0 flex-1 justify-start">
                    <div className="w-full min-w-0 max-w-[880px]">{children}</div>
                </main>
            </div>
        </div>
    );
}
