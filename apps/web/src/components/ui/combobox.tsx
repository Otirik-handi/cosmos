"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * 可搜索选择器（V4）：话题选择器、Entity 选择器、Story 选择器（归并目标）。
 * 判据 R3 要求「不要求用户输入或背诵内部标识符」，所以这些位置必须可搜索，
 * 不能用原生 select。键盘上下选择由 Base UI 提供。
 */

function Combobox(props: ComboboxPrimitive.Root.Props<unknown>) {
    return <ComboboxPrimitive.Root data-slot="combobox" {...props} />;
}

function ComboboxInput({
    className,
    showTrigger = true,
    ...props
}: ComboboxPrimitive.Input.Props & { showTrigger?: boolean }) {
    return (
        <div className="relative flex items-center">
            <ComboboxPrimitive.Input
                className={cn(
                    "h-8 w-full rounded-[var(--radius-control)] border border-input bg-card px-2.5 pr-8 text-[13px]",
                    "outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                    className,
                )}
                data-slot="combobox-input"
                {...props}
            />
            {showTrigger ? (
                <ComboboxPrimitive.Trigger
                    aria-label="展开选项"
                    className={cn(
                        "absolute right-1 flex size-6 items-center justify-center rounded-[4px] text-muted-foreground",
                        "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    )}
                    data-slot="combobox-trigger"
                >
                    <ChevronsUpDown aria-hidden className="size-3.5" strokeWidth={1.75} />
                </ComboboxPrimitive.Trigger>
            ) : null}
        </div>
    );
}

function ComboboxContent({
    className,
    children,
    sideOffset = 4,
    ...props
}: ComboboxPrimitive.Positioner.Props & { children?: React.ReactNode }) {
    return (
        <ComboboxPrimitive.Portal>
            <ComboboxPrimitive.Positioner
                className="z-50 outline-none"
                data-slot="combobox-positioner"
                sideOffset={sideOffset}
                {...props}
            >
                <ComboboxPrimitive.Popup
                    className={cn(
                        "max-h-[min(20rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto",
                        "rounded-[var(--radius-control)] border border-border bg-popover p-1 text-[13px] text-popover-foreground",
                        "shadow-[var(--elevation-popover)] outline-none",
                        className,
                    )}
                    data-slot="combobox-content"
                >
                    {children}
                </ComboboxPrimitive.Popup>
            </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
    );
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
    return (
        <ComboboxPrimitive.Item
            className={cn(
                "flex cursor-default items-center gap-2 rounded-[4px] py-1.5 pr-2 pl-7 outline-none select-none",
                "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            data-slot="combobox-item"
            {...props}
        >
            <span className="absolute left-2 flex size-3.5 items-center justify-center">
                <ComboboxPrimitive.ItemIndicator>
                    <Check aria-hidden className="size-3.5" strokeWidth={2} />
                </ComboboxPrimitive.ItemIndicator>
            </span>
            <span className="truncate">{children}</span>
        </ComboboxPrimitive.Item>
    );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
    return (
        <ComboboxPrimitive.Empty
            className={cn("px-2 py-3 text-center text-[12px] text-muted-foreground", className)}
            data-slot="combobox-empty"
            {...props}
        />
    );
}

/**
 * 列表。必须用函数子节点：Base UI 的 Combobox 在这里传入**已按输入过滤**的条目，
 * 调用方不要自己过滤再 map——那样过滤逻辑就绕过了组件自己的匹配规则。
 */
function ComboboxList<Item>({
    className,
    children,
    ...props
}: Omit<ComboboxPrimitive.List.Props, "children"> & {
    className?: string;
    children: (item: Item, index: number) => React.ReactNode;
}) {
    return (
        <ComboboxPrimitive.List
            className={cn("flex flex-col", className)}
            data-slot="combobox-list"
            {...props}
        >
            {children as never}
        </ComboboxPrimitive.List>
    );
}

function ComboboxGroup(props: ComboboxPrimitive.Group.Props) {
    return <ComboboxPrimitive.Group data-slot="combobox-group" {...props} />;
}

function ComboboxGroupLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
    return (
        <ComboboxPrimitive.GroupLabel
            className={cn("px-2 py-1 text-[11px] text-muted-foreground", className)}
            data-slot="combobox-group-label"
            {...props}
        />
    );
}

function ComboboxSeparator({ className, ...props }: ComboboxPrimitive.Separator.Props) {
    return (
        <ComboboxPrimitive.Separator
            className={cn("-mx-1 my-1 h-px bg-border", className)}
            data-slot="combobox-separator"
            {...props}
        />
    );
}

export {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxGroup,
    ComboboxGroupLabel,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    ComboboxSeparator,
};
