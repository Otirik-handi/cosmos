"use client";

import { useCallback, useMemo } from "react";

import type { NoticeVariant, WorkspaceContext } from "@/app/home/page-bridge";

import { useToast } from "@/components/ui/toast";

/**
 * 把域 hook 的 `ctx.setNotice(文案)` 适配成 toast，并交出身份稳定的 `WorkspaceContext`。
 *
 * 为什么在**上下文这一层**适配、而不是去改调用点：各域 hook（`use-story-workspace` 等）
 * 只认 `ctx.setNotice`，它们被六个页面共用；为了换一种呈现方式去改三十多处调用点不划算。
 *
 * 语气默认 `success`——绝大多数回执是「写完了一条」，只有少数是「报告一个状态」，
 * 那些在调用点显式置 `ctx.noticeVariant = "info"`。每次播报后立刻复位，避免一次 `info`
 * 把后面所有回执都染成信息色。
 *
 * `error` 不在这里：错误要留在页面上、不该自己消失，仍由 `PageBanners` 渲染。
 */
/**
 * 信息类回执的自定义存活时长。
 *
 * 默认 5 秒是给「写完一条」用的：用户不需要读第二遍。信息类是**要读的内容**
 * （检索命中了多少条、服务与存储状态），5 秒偏短——实测检索回执在用户扫结果时已经消失。
 * 写回执仍用 Provider 默认值。
 */
const INFO_TIMEOUT_MS = 10_000;

export function useNoticeToast(
    setError: (message: string | null) => void,
    setLoading: (value: boolean) => void,
): {
    context: WorkspaceContext;
    /** 页面自己发起的回执（不走域 hook）：`variant` 默认 `success`。 */
    showNotice: (message: string | null, variant?: NoticeVariant) => void;
} {
    const toast = useToast();

    const showNotice = useCallback((message: string | null, variant: NoticeVariant = "success") => {
        if (message === null) {
            return;
        }
        if (variant === "info") {
            toast.info({ title: message, timeout: INFO_TIMEOUT_MS });
        } else {
            toast.success({ title: message });
        }
    }, [toast]);

    const context = useMemo<WorkspaceContext>(() => ({
        setError,
        setLoading,
        setNotice: showNotice,
    }), [setError, setLoading, showNotice]);

    return { context, showNotice };
}
