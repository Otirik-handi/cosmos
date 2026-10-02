"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * 破坏性确认（V4）：确认按钮用 destructive，不用 primary；
 * 文案必须写清可逆性（判据 R4）——「移除后可恢复」还是「此操作不可撤销」。
 * 本文件只提供结构，不提供文案。
 */

function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
    return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger(props: AlertDialogPrimitive.Trigger.Props) {
    return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
    return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
    return (
        <AlertDialogPrimitive.Backdrop
            className={cn(
                "fixed inset-0 isolate z-50 bg-black/20 backdrop-blur-[2px]",
                "transition-opacity duration-[var(--motion-base)]",
                className,
            )}
            data-slot="alert-dialog-overlay"
            {...props}
        />
    );
}

function AlertDialogContent({
    className,
    ...props
}: AlertDialogPrimitive.Popup.Props) {
    return (
        <AlertDialogPortal>
            <AlertDialogOverlay />
            <AlertDialogPrimitive.Popup
                className={cn(
                    "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
                    "gap-4 rounded-[var(--radius-card)] border border-border bg-popover p-4 text-sm text-popover-foreground",
                    "shadow-[var(--elevation-dialog)] outline-none sm:max-w-sm",
                    className,
                )}
                data-slot="alert-dialog-content"
                {...props}
            />
        </AlertDialogPortal>
    );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            className={cn("flex flex-col gap-1.5", className)}
            data-slot="alert-dialog-header"
            {...props}
        />
    );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            className={cn(
                "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
                className,
            )}
            data-slot="alert-dialog-footer"
            {...props}
        />
    );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
    return (
        <AlertDialogPrimitive.Title
            className={cn("text-base leading-tight font-medium", className)}
            data-slot="alert-dialog-title"
            {...props}
        />
    );
}

function AlertDialogDescription({
    className,
    ...props
}: AlertDialogPrimitive.Description.Props) {
    return (
        <AlertDialogPrimitive.Description
            className={cn("text-[13px] leading-6 text-muted-foreground", className)}
            data-slot="alert-dialog-description"
            {...props}
        />
    );
}

/** 取消：普通按钮，永远不是破坏性样式。 */
function AlertDialogCancel({
    className,
    ...props
}: AlertDialogPrimitive.Close.Props) {
    return (
        <AlertDialogPrimitive.Close
            data-slot="alert-dialog-cancel"
            render={<Button variant="outline" />}
            className={className}
            {...props}
        />
    );
}

/** 确认：默认 destructive，调用方可以显式改成 default（例如「移入收藏夹」这类非破坏动作）。 */
function AlertDialogAction({
    className,
    variant = "destructive",
    ...props
}: AlertDialogPrimitive.Close.Props & { variant?: "default" | "destructive" | "outline" }) {
    return (
        <AlertDialogPrimitive.Close
            data-slot="alert-dialog-action"
            render={<Button variant={variant} />}
            className={className}
            {...props}
        />
    );
}

export {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogOverlay,
    AlertDialogPortal,
    AlertDialogTitle,
    AlertDialogTrigger,
};
