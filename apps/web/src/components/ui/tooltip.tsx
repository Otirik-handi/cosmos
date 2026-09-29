"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * 提示（V4）：承载来源依据、置信度、producer 说明与被截断的标题。
 *
 * 两条硬约束：
 * 1. focus 也触发（键盘用户必须能看到同一信息），由 Base UI 提供。
 * 2. **不得承载操作**——不能把按钮只放在 tooltip 里，触屏与键盘用户会够不到。
 *    需要动作就放进 menu 或 dialog。
 */

function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
    return <TooltipPrimitive.Provider delay={200} {...props} />;
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
    className,
    children,
    sideOffset = 6,
    ...props
}: TooltipPrimitive.Positioner.Props & { children?: React.ReactNode }) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Positioner
                className="z-50 outline-none"
                data-slot="tooltip-positioner"
                sideOffset={sideOffset}
                {...props}
            >
                <TooltipPrimitive.Popup
                    className={cn(
                        // 内容不超过两行的约束来自 V4；超出的信息应该写成可见文案而不是塞进提示。
                        "max-w-[22rem] rounded-[var(--radius-control)] border border-border bg-popover px-2 py-1.5",
                        "text-[12px] leading-5 text-popover-foreground shadow-[var(--elevation-popover)]",
                        className,
                    )}
                    data-slot="tooltip-content"
                >
                    {children}
                </TooltipPrimitive.Popup>
            </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
    );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
