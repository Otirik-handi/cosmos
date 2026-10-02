"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * 下拉选择（V4）：用于筛选条件（来源、媒体类型、录入状态）、话题成员角色、
 * Entity 类型与关系类型。选项超过 12 个时改用 combobox。
 * 原生可访问语义由 Base UI 提供。
 */

function Select(props: SelectPrimitive.Root.Props<unknown>) {
    return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue(props: SelectPrimitive.Value.Props) {
    return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
    className,
    children,
    ...props
}: SelectPrimitive.Trigger.Props) {
    return (
        <SelectPrimitive.Trigger
            className={cn(
                "flex h-8 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-input bg-card px-2.5 text-[13px]",
                "outline-none transition-colors duration-[var(--motion-fast)]",
                "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            data-slot="select-trigger"
            {...props}
        >
            {children}
            <SelectPrimitive.Icon
                className="shrink-0 text-muted-foreground"
                data-slot="select-icon"
            >
                <ChevronsUpDown aria-hidden className="size-3.5" strokeWidth={1.75} />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
}

function SelectContent({
    className,
    children,
    sideOffset = 4,
    ...props
}: SelectPrimitive.Positioner.Props & { children?: React.ReactNode }) {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Positioner
                className="z-50 outline-none"
                data-slot="select-positioner"
                sideOffset={sideOffset}
                {...props}
            >
                <SelectPrimitive.Popup
                    className={cn(
                        "max-h-[min(20rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto",
                        "rounded-[var(--radius-control)] border border-border bg-popover p-1 text-[13px] text-popover-foreground",
                        "shadow-[var(--elevation-popover)] outline-none",
                        className,
                    )}
                    data-slot="select-content"
                >
                    {children}
                </SelectPrimitive.Popup>
            </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
    );
}

function SelectItem({
    className,
    children,
    ...props
}: SelectPrimitive.Item.Props) {
    return (
        <SelectPrimitive.Item
            className={cn(
                "flex cursor-default items-center gap-2 rounded-[4px] py-1.5 pr-2 pl-7 outline-none select-none",
                "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            data-slot="select-item"
            {...props}
        >
            <span className="absolute left-2 flex size-3.5 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                    <Check aria-hidden className="size-3.5" strokeWidth={2} />
                </SelectPrimitive.ItemIndicator>
            </span>
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
    );
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
    return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectGroupLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
    return (
        <SelectPrimitive.GroupLabel
            className={cn("px-2 py-1 text-[11px] text-muted-foreground", className)}
            data-slot="select-group-label"
            {...props}
        />
    );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
    return (
        <SelectPrimitive.Separator
            className={cn("-mx-1 my-1 h-px bg-border", className)}
            data-slot="select-separator"
            {...props}
        />
    );
}

export {
    Select,
    SelectContent,
    SelectGroup,
    SelectGroupLabel,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
};
