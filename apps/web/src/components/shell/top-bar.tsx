"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { ThemeSwitcher } from "@/components/cosmos/theme-switcher";
import { messages } from "@/copy/messages";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme/theme-provider";

import { useStreamState } from "./live-provider";

const STREAM_COPY: Record<string, string> = {
    connecting: messages.shell.topBar.stream.connecting,
    connected: messages.shell.topBar.stream.connected,
    unavailable: messages.shell.topBar.stream.unavailable,
};

/**
 * 顶栏是跨页面常驻框架的一部分，切页不重建（ADR-0029 决策 2）。
 * 全局搜索只负责跳转 `/library?q=`，完整筛选条件在信息库页展开，避免两套搜索 UI。
 */
export function TopBar({ showBack = false }: { showBack?: boolean }) {
    const router = useRouter();
    const streamState = useStreamState();
    const { preference, setPreference } = useTheme();
    const [query, setQuery] = useState("");

    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const trimmed = query.trim();
        router.push(trimmed === "" ? "/library" : `/library?q=${encodeURIComponent(trimmed)}`);
    };

    return (
        /*
         * 顶栏：高度 64 px（V4 规格原文 56，维护者 2026-10-03 指令加高一档）+ 底色 `--surface-toolbar`。
         * **间隔不在这里**：底栏带内边距会让 64 px 里的内容偏上而不是居中；间距由路由组 layout 的
         * `pt-[2.5em]` 提供（见 `(shell)/layout.tsx` 与 `(reading)/layout.tsx`）。
         * 下边框不加：底板色已能把顶栏与内容分开，再画一条线是重复表达。
         */
        <header className="flex h-16 shrink-0 items-center gap-4 bg-[var(--surface-toolbar)] px-5">
            {showBack ? (
                <Link
                    className={cn(
                        "flex h-8 items-center rounded-[var(--radius-control)] border border-border bg-card px-2.5 text-[13px]",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    )}
                    href="/library"
                >
                    {messages.shell.topBar.back}
                </Link>
            ) : (
                <Link
                    className="font-serif text-[16px] font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href="/"
                >
                    Cosmos
                </Link>
            )}

            <form className="min-w-0" onSubmit={submit} role="search">
                <label className="sr-only" htmlFor="global-search">
                    {messages.shell.topBar.searchLabel}
                </label>
                <div
                    className={cn(
                        "flex h-8 w-[380px] max-w-[38vw] items-center gap-2 rounded-[var(--radius-control)] border border-border bg-card px-2.5",
                    )}
                >
                    <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <input
                        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                        id="global-search"
                        onChange={(event) => setQuery(event.currentTarget.value)}
                        placeholder={messages.shell.topBar.searchPlaceholder}
                        value={query}
                    />
                </div>
            </form>

            <div className="ml-auto flex items-center gap-3.5">
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span
                        aria-hidden
                        className={cn(
                            "size-1.5 rounded-full",
                            streamState === "connected" ? "bg-primary" : "bg-muted-foreground",
                        )}
                    />
                    {STREAM_COPY[streamState] ?? STREAM_COPY.unavailable}
                </span>
                <span aria-hidden className="text-border">
                    |
                </span>
                <ThemeSwitcher onValueChange={setPreference} value={preference} />
            </div>
        </header>
    );
}
