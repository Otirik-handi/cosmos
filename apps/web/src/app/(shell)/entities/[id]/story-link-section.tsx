"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";

import type { EntityStoryLink } from "@cosmos/contracts";

import { Button } from "@/components/ui/button";
import { messages } from "@/copy/messages";

import { DetailMessage, DetailSection } from "./detail-section";

type StoryLinkSectionProps = {
    links: readonly EntityStoryLink[];
    busy: boolean;
    onUnlink: (storyId: string, title: string) => Promise<boolean>;
};

/**
 * 关联 Story：这个 Entity 出现在哪些内容里。关联本身在 Story 页做（ADR-0029 决策 1），
 * 这里只读列表并解除。
 */
export function StoryLinkSection({ links, busy, onUnlink }: StoryLinkSectionProps) {
    return (
        <DetailSection
            count={links.length === 0 ? null : messages.common.storyCount(links.length)}
            title={messages.pages.entities.detail.storyTitle}
        >
            {links.length === 0 ? (
                <DetailMessage>{messages.pages.entities.detail.storyEmpty}</DetailMessage>
            ) : (
                <ul className="flex flex-col">
                    {links.map((link) => {
                        // 标题读不到时用占位文案；`storyId` 只做 key 与链接，**不显示**（判据 R3）。
                        const title = link.title ?? messages.pages.entities.detail.storyUntitled;
                        return (
                            <li
                                className="flex flex-wrap items-center gap-2 border-b border-border py-3 last:border-b-0"
                                key={link.storyId}
                            >
                                <Link
                                    className="min-w-0 flex-1 truncate text-[14px] hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    href={`/stories/${encodeURIComponent(link.storyId)}`}
                                >
                                    {title}
                                </Link>
                                <Button
                                    aria-label={messages.pages.entities.detail.storyUnlink(title)}
                                    disabled={busy}
                                    onClick={() => void onUnlink(link.storyId, title)}
                                    size="sm"
                                    variant="ghost"
                                >
                                    <Trash2 aria-hidden className="size-3.5" strokeWidth={1.75} />
                                    {messages.pages.entities.detail.storyUnlinkAction}
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </DetailSection>
    );
}
