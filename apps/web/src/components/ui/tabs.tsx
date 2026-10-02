"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

/*
 * 分区切换（V4）。整理页的五个分区用它，并各自与 URL query (`?tab=`) 同步——
 * 同步由调用方负责，primitive 不读路由。
 */

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
    return (
        <TabsPrimitive.Root
            className={cn("flex flex-col gap-3", className)}
            data-slot="tabs"
            {...props}
        />
    );
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
    return (
        <TabsPrimitive.List
            className={cn(
                "flex items-center gap-1 border-b border-border",
                className,
            )}
            data-slot="tabs-list"
            {...props}
        />
    );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
    return (
        <TabsPrimitive.Tab
            className={cn(
                "relative -mb-px flex h-8 items-center gap-1.5 rounded-t-[var(--radius-control)] px-2.5 text-[13px]",
                "text-muted-foreground transition-colors duration-[var(--motion-fast)]",
                "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                "data-[selected]:border-b-2 data-[selected]:border-primary data-[selected]:font-medium data-[selected]:text-foreground",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            data-slot="tabs-trigger"
            {...props}
        />
    );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
    return (
        <TabsPrimitive.Panel
            className={cn("outline-none", className)}
            data-slot="tabs-content"
            {...props}
        />
    );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
