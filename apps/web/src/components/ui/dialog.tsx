"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * 对话框的规矩（ADR-0029 / V4 组件规范）：
 * - 焦点陷阱、Esc 关闭、关闭后焦点回到触发元素由 Base UI 提供，不自行实现。
 * - 宽度上限交给调用方用 className 覆盖，默认 sm。
 * - 危险操作的确认按钮用 destructive，不用 primary。
 */

function Dialog(props: DialogPrimitive.Root.Props) {
    return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
    return (
        <DialogPrimitive.Backdrop
            className={cn(
                "fixed inset-0 isolate z-50 bg-black/20 backdrop-blur-[2px]",
                "transition-opacity duration-[var(--motion-base)]",
                className,
            )}
            data-slot="dialog-overlay"
            {...props}
        />
    );
}

function DialogContent({
    className,
    children,
    showCloseButton = true,
    ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
    return (
        <DialogPortal>
            <DialogOverlay />
            <DialogPrimitive.Popup
                className={cn(
                    "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
                    "gap-4 rounded-[var(--radius-card)] border border-border bg-popover p-4 text-sm text-popover-foreground",
                    "shadow-[var(--elevation-dialog)] outline-none sm:max-w-md",
                    className,
                )}
                data-slot="dialog-content"
                {...props}
            >
                {children}
                {showCloseButton ? (
                    <DialogPrimitive.Close
                        data-slot="dialog-close"
                        render={
                            <Button
                                aria-label="关闭"
                                className="absolute top-2 right-2"
                                size="icon-sm"
                                variant="ghost"
                            />
                        }
                    >
                        <X aria-hidden />
                    </DialogPrimitive.Close>
                ) : null}
            </DialogPrimitive.Popup>
        </DialogPortal>
    );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            className={cn("flex flex-col gap-1.5", className)}
            data-slot="dialog-header"
            {...props}
        />
    );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            className={cn(
                "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-[var(--radius-card)] border-t border-border bg-muted/40 p-4 sm:flex-row sm:justify-end",
                className,
            )}
            data-slot="dialog-footer"
            {...props}
        />
    );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
    return (
        <DialogPrimitive.Title
            className={cn("text-base leading-tight font-medium", className)}
            data-slot="dialog-title"
            {...props}
        />
    );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
    return (
        <DialogPrimitive.Description
            className={cn("text-[13px] leading-6 text-muted-foreground", className)}
            data-slot="dialog-description"
            {...props}
        />
    );
}

export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogTrigger,
};
