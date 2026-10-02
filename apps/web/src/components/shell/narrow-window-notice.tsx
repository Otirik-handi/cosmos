import { messages } from "@/copy/messages";

/**
 * 低于 1024 px 的窗口提示（ADR-0029 决策 6）。
 *
 * 纯 CSS 切换（`min-[1024px]:hidden`），不读窗口宽度：外壳是服务端渲染的常驻框架，
 * 用 JS 量宽度会在首帧先渲染一遍再换掉，反而闪一下。低于下限时整个外壳隐藏、
 * 只留这段提示——ADR 明确「不做降级布局」，所以这里不提供任何替代界面。
 */
export function NarrowWindowNotice() {
    return (
        <div
            className="flex min-h-screen flex-col items-center justify-center gap-2 px-8 text-center min-[1024px]:hidden"
            data-narrow-window-notice="true"
        >
            <p className="font-display text-[18px] font-semibold tracking-tight">
                {messages.shell.narrowWindow.title}
            </p>
            <p className="max-w-[32em] text-[13px] leading-6 text-muted-foreground">
                {messages.shell.narrowWindow.body}
            </p>
        </div>
    );
}
