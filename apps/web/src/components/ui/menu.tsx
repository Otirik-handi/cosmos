"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * 菜单（V4）：键盘可达（方向键 / Enter / Esc 由 Base UI 提供）。
 * 危险项与普通项之间由调用方插入 MenuSeparator；primitive 不猜语义。
 */

function Menu(props: MenuPrimitive.Root.Props) {
    return <MenuPrimitive.Root data-slot="menu" {...props} />;
}

function MenuTrigger(props: MenuPrimitive.Trigger.Props) {
    return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />;
}

function MenuPortal(props: MenuPrimitive.Portal.Props) {
    return <MenuPrimitive.Portal data-slot="menu-portal" {...props} />;
}

function MenuContent({
    className,
    children,
    sideOffset = 6,
    ...props
}: MenuPrimitive.Positioner.Props & { className?: string; children?: React.ReactNode }) {
    return (
        <MenuPortal>
            <MenuPrimitive.Positioner
                className="z-50 outline-none"
                data-slot="menu-positioner"
                sideOffset={sideOffset}
                {...props}
            >
                <MenuPrimitive.Popup
                    className={cn(
                        "rounded-[var(--radius-control)] border border-border bg-popover text-[13px] text-popover-foreground",
                        "shadow-[var(--elevation-popover)] outline-none",
                        className,
                    )}
                    data-slot="menu-content"
                >
                    {/* 菜单项挂在 Viewport 下：Base UI 用它承载菜单切换时的过渡容器。 */}
                    <MenuPrimitive.Viewport className="min-w-[10rem] overflow-y-auto p-1">
                        {children}
                    </MenuPrimitive.Viewport>
                </MenuPrimitive.Popup>
            </MenuPrimitive.Positioner>
        </MenuPortal>
    );
}

function MenuItem({
    className,
    variant = "default",
    ...props
}: MenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
    return (
        <MenuPrimitive.Item
            className={cn(
                "flex cursor-default items-center gap-2 rounded-[4px] px-2 py-1.5 outline-none select-none",
                "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                variant === "destructive" && "text-destructive data-[highlighted]:bg-destructive/10",
                className,
            )}
            data-slot="menu-item"
            {...props}
        />
    );
}

/** 可勾选项：用对勾表达状态，不改变行的尺寸。 */
function MenuCheckboxItem({
    className,
    children,
    checked,
    ...props
}: MenuPrimitive.CheckboxItem.Props) {
    return (
        <MenuPrimitive.CheckboxItem
            checked={checked}
            className={cn(
                "flex cursor-default items-center gap-2 rounded-[4px] py-1.5 pr-2 pl-7 outline-none select-none",
                "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            data-slot="menu-checkbox-item"
            {...props}
        >
            <span className="absolute left-2 flex size-3.5 items-center justify-center">
                {checked ? <Check aria-hidden className="size-3.5" strokeWidth={2} /> : null}
            </span>
            {children}
        </MenuPrimitive.CheckboxItem>
    );
}

function MenuGroup(props: MenuPrimitive.Group.Props) {
    return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

function MenuGroupLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
    return (
        <MenuPrimitive.GroupLabel
            className={cn("px-2 py-1 text-[11px] text-muted-foreground", className)}
            data-slot="menu-group-label"
            {...props}
        />
    );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
    return (
        <MenuPrimitive.Separator
            className={cn("-mx-1 my-1 h-px bg-border", className)}
            data-slot="menu-separator"
            {...props}
        />
    );
}

function MenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
    return (
        <span
            className={cn("ml-auto font-mono text-[11px] text-muted-foreground", className)}
            data-slot="menu-shortcut"
            {...props}
        />
    );
}

export {
    Menu,
    MenuCheckboxItem,
    MenuContent,
    MenuGroup,
    MenuGroupLabel,
    MenuItem,
    MenuPortal,
    MenuSeparator,
    MenuShortcut,
    MenuTrigger,
};
