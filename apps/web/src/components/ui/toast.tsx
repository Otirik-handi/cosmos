"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

/*
 * 命令回执（V4）：成功自动消失；失败不自动消失，必须可关闭且说明下一步。
 *
 * Base UI 的用法是「manager 持有队列 → Viewport 遍历渲染」。因此本模块导出三样东西：
 * - ToastProvider：挂在需要回执的子树外层（调用方决定挂在哪一层）
 * - ToastHost：渲染队列的宿主，一个页面一处
 * - useToast：提交回执的入口
 * 自动消失时长由调用方按成功/失败传入，primitive 不猜语义。
 */

const INFINITE = 0;

export type ToastVariant = "info" | "success" | "error";

/**
 * 自增序号：让「哪条回执最新」成为可断言的事实。
 *
 * 队列里可以同时存在多条回执，而 `manager.toasts` 的顺序是**管理器自己的顺序**——
 * 实测按 DOM 顺序取「最后一条」会拿到旧的那条（搜索回执连着发两次时命中过）。
 * 序号在**提交时**分配、挂在回执的 `data` 上，宿主渲染时只读；渲染期分配会被
 * `react-hooks/refs` 判为违规（渲染必须是纯的）。
 */
let toastSequence = 0;

/** 回执在队列里的序号；测试按它取「最新一条」（`e2e/support/lab.ts` 的 `latestToast`）。 */
export const TOAST_SEQUENCE_KEY = "seq";

function ToastProvider({ timeout = 5000, ...props }: ToastPrimitive.Provider.Props) {
    return <ToastPrimitive.Provider timeout={timeout} {...props} />;
}

function ToastHost({ className }: { className?: string }) {
    const manager = ToastPrimitive.useToastManager();

    return (
        <ToastPrimitive.Portal>
            <ToastPrimitive.Viewport
                className={cn(
                    "fixed right-5 bottom-5 z-50 flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-2 outline-none",
                    className,
                )}
                data-slot="toast-viewport"
            >
                {manager.toasts.map((toast) => {
                    const variant = (toast.type ?? "info") as ToastVariant;
                    const sequence = toast.data?.[TOAST_SEQUENCE_KEY];
                    return (
                        <ToastPrimitive.Root
                            className={cn(
                                "relative flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-popover p-3 text-[13px] text-popover-foreground",
                                "shadow-[var(--elevation-popover)]",
                                variant === "error" && "border-destructive/40",
                            )}
                            data-slot="toast-root"
                            data-toast-seq={typeof sequence === "number" ? sequence : undefined}
                            data-variant={variant}
                            key={toast.id}
                            toast={toast}
                        >
                            <ToastPrimitive.Title
                                className="pr-6 font-medium"
                                data-slot="toast-title"
                            />
                            <ToastPrimitive.Description
                                className="leading-5 text-muted-foreground"
                                data-slot="toast-description"
                            />
                            <ToastPrimitive.Close
                                aria-label="关闭"
                                className={cn(
                                    "absolute top-2 right-2 rounded-[4px] p-1 text-muted-foreground",
                                    "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                )}
                                data-slot="toast-close"
                            >
                                <X aria-hidden className="size-3.5" strokeWidth={2} />
                            </ToastPrimitive.Close>
                        </ToastPrimitive.Root>
                    );
                })}
            </ToastPrimitive.Viewport>
        </ToastPrimitive.Portal>
    );
}

export type ToastInput = {
    title: string;
    description?: string;
    variant?: ToastVariant;
    /**
     * 覆盖 Provider 的默认存活时长（毫秒）。
     * 不传就用 Provider 的 5 秒；`error` 恒为不自动消失（见 `push`）。
     * 信息类回执需要更长时间读完时传它（`useNoticeToast` 的 `INFO_TIMEOUT_MS`）。
     */
    timeout?: number;
};

/**
 * 提交回执。失败默认不自动消失——用户需要时间读完并决定是否重试（V4）。
 *
 * 返回的函数是稳定的（manager 每次渲染都是新引用，直接闭包会让调用方的
 * effect 依赖反复变化）。调用方可以安全地把 success/error/info 放进依赖数组。
 */
export function useToast(): {
    success: (input: ToastInput) => void;
    error: (input: ToastInput) => void;
    info: (input: ToastInput) => void;
} {
    const manager = ToastPrimitive.useToastManager();
    const managerRef = useRef(manager);
    // 在 effect 里同步而不是渲染期写 ref：渲染期访问 ref.current 会阻止 React 编译器
    // 优化，也让「这次渲染读到哪一版 manager」变得不确定。
    useEffect(() => {
        managerRef.current = manager;
    }, [manager]);

    return useMemo(() => {
        const push = (variant: ToastVariant, input: ToastInput): void => {
            toastSequence += 1;
            managerRef.current.add({
                data: { [TOAST_SEQUENCE_KEY]: toastSequence },
                description: input.description,
                title: input.title,
                timeout: variant === "error" ? INFINITE : input.timeout,
                type: variant,
            });
        };

        return {
            success: (input: ToastInput) => push("success", input),
            error: (input: ToastInput) => push("error", input),
            info: (input: ToastInput) => push("info", input),
        };
    }, []);
}

export { ToastPrimitive, ToastProvider, ToastHost };
