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

    return (
        <aside className="w-[196px] shrink-0 self-start">
            <nav
                aria-label={messages.shell.nav.ariaLabel}
                className={cn(
                    "flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-card p-2.5",
                    "shadow-[var(--elevation-card)]",
                )}
            >
                {NAV_GROUPS.map((group) => (
                    <div className="flex flex-col gap-1" key={group.title}>
                        <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">
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
                                        "flex h-7 items-center gap-2 rounded-[var(--radius-control)] px-2 text-[13px] leading-none",
                                        "transition-colors duration-[var(--motion-fast)]",
                                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                        active
                                            ? "bg-primary/10 font-medium text-primary"
                                            : "text-foreground/75 hover:bg-accent",
                                    )}
                                    href={item.href}
                                    key={item.href}
                                >
                                    <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
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
