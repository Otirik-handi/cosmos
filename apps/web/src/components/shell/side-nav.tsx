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

/**
 * 侧栏导航的单一真相源。八项各占一层 URL，与 ADR-0029 决策 3 的
 * 「URL 层级 = 导航层级」一致；新增页面只改这里，不改路由分组。
 */
export const NAV_GROUPS = [
    {
        title: "内容",
        items: [
            { href: "/", label: "首页看板", icon: Home, exact: true },
            { href: "/library", label: "信息库", icon: Inbox },
            { href: "/topics", label: "话题", icon: Target },
            { href: "/entities", label: "Entity", icon: Users },
            { href: "/system", label: "系统产出", icon: Waypoints },
        ],
    },
    {
        title: "管理",
        items: [
            { href: "/organize", label: "整理", icon: Tag },
            { href: "/automation", label: "自动化", icon: RefreshCcw },
            { href: "/settings", label: "设置", icon: Settings },
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
                aria-label="主导航"
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
