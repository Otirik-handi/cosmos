"use client";

import type { ReactElement } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * 计划行图标按钮的提示层（Task 37 切片 3）。
 *
 * 单独成模块是为了**按需加载**：`@base-ui/react` 的浮层依赖（`floating-ui-react`）
 * 未压缩约 450 KB，静态引入会把首页首屏 JS 从 320.9 KB 顶到 339.4 KB，超过 E7 的
 * 335.9 KB 预算（实测）。调用方在 `load` 之后才 `import()` 本模块，它因此不进首屏统计。
 *
 * 提示层只负责给调用方渲染好的按钮挂上提示，不自己造按钮：按钮元素连同它自己的子节点
 * （图标 + `sr-only` 文案）整体由 `render` 传入并克隆，所以可访问名与 e2e 的
 * `getByRole("button", { name })` 定位在提示层到位前后完全一致；提示层加载失败也只是
 * 少一个鼠标提示，不会少一个动作。
 *
 * `delay` 直接给在 `TooltipTrigger` 上。Base UI 的 `TooltipProvider` 只负责相邻提示共享
 * 延迟，不是 Tooltip 的前置条件（无 provider 时 trigger 用自己的 `delay`），省掉它本模块
 * 就不必再引一层 provider。
 */
export type IconActionTooltipProps = {
    /** 提示文案，与按钮内 `sr-only` 的那一份同源。 */
    label: string;
    /** 被提示的按钮元素；由 `render` 克隆，子节点随元素一起保留。 */
    button: ReactElement;
};

export function IconActionTooltip({ label, button }: IconActionTooltipProps) {
    return (
        <Tooltip>
            <TooltipTrigger delay={200} render={button} />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
