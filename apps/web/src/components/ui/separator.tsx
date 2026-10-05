"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

/**
 * 分隔线。
 *
 * Base UI 的 primitive 固定输出 `role="separator"`，即向辅助技术声明「这里有一条内容边界」。
 * 产品里绝大多数线（面板内区块之间、页头与正文之间）表达的是**视觉层级归属**（V4 原则 2），
 * 不是内容语义，因此用 `decorative` 把它从无障碍树里摘掉——否则一页会凭空多出几十个停顿。
 * 真正需要声明内容边界的场景不传这个开关，保留 primitive 的语义。
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = false,
  ...props
}: SeparatorPrimitive.Props & { decorative?: boolean }) {
  return (
    <SeparatorPrimitive
      data-orientation={orientation}
      data-slot="separator"
      orientation={orientation}
      aria-hidden={decorative ? true : undefined}
      className={cn(
        /*
         * 变体用 `data-[orientation=…]`，不是 Tailwind/Base UI v1 的 `data-horizontal`：
         * Base UI v2 只输出 `data-orientation`（见 @base-ui/react/separator/SeparatorDataAttributes）。
         * 写成旧名字时两条尺寸规则都不命中，分隔线的 `h-px` 永远不生效，实测高度是 0——
         * 也就是一条看不见的线。这个缺陷此前没暴露，是因为业务里从没渲染过这个组件。
         *
         * 横向线用 `--divider-thickness`（0.75em，维护者 2026-10-03）：它是一条**色带**而不是发丝线，
         * 两头用 `rounded-full` 收成半圆（维护者 2026-10-03）——完整圆角半径是高度的一半，
         * 两端各一个半圆帽。竖向线仍是 1px 宽、不加圆角：同一条规则套在竖向上是 8px 宽的竖条，
         * 那是版式事故不是分隔线，而 1px 宽的线加圆角也看不出任何差别。
         */
        "shrink-0 bg-border data-[orientation=horizontal]:h-[var(--divider-thickness)] data-[orientation=horizontal]:w-full data-[orientation=horizontal]:rounded-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
