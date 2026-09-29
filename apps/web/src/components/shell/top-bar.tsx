"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { ThemeSwitcher } from "@/components/cosmos/theme-switcher";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme/theme-provider";

import { useStreamState } from "./live-provider";

const STREAM_COPY: Record<string, string> = {
    connecting: "正在连接",
    connected: "服务正常",
    unavailable: "服务不可用",
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
        <header className="flex h-14 shrink-0 items-center gap-4 px-5">
            {showBack ? (
                <Link
                    className={cn(
                        "flex h-8 items-center rounded-[var(--radius-control)] border border-border bg-card px-2.5 text-[13px]",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    )}
                    href="/library"
                >
                    ← 返回
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
                    搜索标题或正文
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
                        placeholder="搜索标题或正文"
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
