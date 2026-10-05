"use client";

import {
    Home,
    Inbox,
    RefreshCcw,
    Settings,
    Tag,
    Target,
    Users,
    Waypoints,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { messages } from "@/copy/messages";

/**
 * 侧栏导航的单一真相源。八项各占一层 URL，与 ADR-0029 决策 3 的
 * 「URL 层级 = 导航层级」一致；新增页面只改这里，不改路由分组。
 * 文案取自集中文案模块，导航与页面标题不会各写一份。
 */
export const NAV_GROUPS = [
    {
        title: messages.shell.nav.groups.content,
        items: [
            { href: "/", label: messages.shell.nav.items.home, icon: Home, exact: true },
            { href: "/library", label: messages.shell.nav.items.library, icon: Inbox },
            { href: "/topics", label: messages.shell.nav.items.topics, icon: Target },
            { href: "/entities", label: messages.shell.nav.items.entities, icon: Users },
            { href: "/system", label: messages.shell.nav.items.system, icon: Waypoints },
        ],
    },
    {
        title: messages.shell.nav.groups.management,
        items: [
            { href: "/organize", label: messages.shell.nav.items.organize, icon: Tag },
            { href: "/automation", label: messages.shell.nav.items.automation, icon: RefreshCcw },
            { href: "/settings", label: messages.shell.nav.items.settings, icon: Settings },
        ],
    },
] as const;

function isActive(pathname: string, href: string, exact: boolean): boolean {
    if (exact) {
        return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav() {
    const pathname = usePathname();

    /*
     * 侧栏所有尺寸都乘 `--nav-scale`（当前 1.25）：宽度、内边距、行高、间距、字号、图标
     * 一起等比放大。不用「把根字号调大」是因为 Tailwind 的 rem 值按根字号算，那样会波及全站；
     * 也不用 transform: scale()，它会连带把焦点环与阴影拉伸发虚。
     *
     * `sticky top-[calc(4rem+2.5em)]` 让它**跟随滚动**（维护者 2026-10-03）：顶栏 64 px
     * （`4rem`）＋顶栏下方间隔 2.5em = 40 px，正好是侧栏在未滚动时的位置，所以贴上后不会跳。
     * 用 `sticky` 而不是 `fixed`：sticky 仍在文档流里，窄窗口下主内容被压缩的算法不变，
     * 也不需要给主内容补一个等宽的占位。侧栏高度仍由内容撑开（ADR-0029 决策 2 的已知代价：
     * 导航项多到超过视口高度时底部会被裁，Revisit Gate 第 1 条已登记该情况）。
     */
    return (
        <aside className="sticky top-[calc(4rem+2.5em)] w-[calc(196px*var(--nav-scale))] shrink-0 self-start">
            <nav
                aria-label={messages.shell.nav.ariaLabel}
                className={cn(
                    "flex flex-col gap-[calc(1rem*var(--nav-scale))] rounded-[var(--radius-card)] border border-border bg-card p-[calc(0.625rem*var(--nav-scale))]",
                    "shadow-[var(--elevation-card)]",
                )}
            >
                {NAV_GROUPS.map((group) => (
                    <div className="flex flex-col gap-[calc(0.25rem*var(--nav-scale))]" key={group.title}>
                        <div className="px-[calc(0.5rem*var(--nav-scale))] pb-[calc(0.25rem*var(--nav-scale))] text-[calc(11px*var(--nav-scale))] font-medium tracking-wide text-muted-foreground">
                            {group.title}
                        </div>
                        {group.items.map((item) => {
                            const active = isActive(
                                pathname,
                                item.href,
                                "exact" in item && item.exact === true,
                            );
                            const Icon = item.icon;
                            return (
                                <Link
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "flex h-[calc(1.75rem*var(--nav-scale))] items-center gap-[calc(0.5rem*var(--nav-scale))] rounded-[var(--radius-control)] px-[calc(0.5rem*var(--nav-scale))] text-[calc(13px*var(--nav-scale))] leading-none",
                                        "transition-colors duration-[var(--motion-fast)]",
                                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                        active
                                            ? "bg-primary/10 font-medium text-primary"
                                            : "text-foreground/75 hover:bg-accent",
                                    )}
                                    href={item.href}
                                    key={item.href}
                                >
                                    <Icon
                                        aria-hidden
                                        className="size-[calc(0.875rem*var(--nav-scale))] shrink-0"
                                        strokeWidth={1.75}
                                    />
                                    <span className="truncate">{item.label}</span>
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </nav>
        </aside>
    );
}
