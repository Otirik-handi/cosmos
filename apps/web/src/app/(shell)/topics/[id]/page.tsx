import Link from "next/link";

import { messages } from "@/copy/messages";

/**
 * 话题详情占位（`/topics/:id`）。
 *
 * 列表页的每一行都链到这里，但改标题与目的、成员改角色/移除/恢复还没有归属页面——
 * **占位而不是 404**：用户点了行以后应该看到「这里还没建好」，而不是一页错误。
 * 刻意**不显示路由里的 id**：判据 R3 要求界面不出现内部标识符，占位页也不例外。
 */
export default function TopicDetailPage() {
    return (
        <div className="flex w-full flex-col gap-4">
            <h1 className="text-[15px] font-medium">{messages.pages.topics.detailTitle}</h1>
            <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                <p className="text-[13px] font-medium">{messages.pages.topics.detailPending}</p>
                <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                    {messages.pages.topics.detailBody}
                </p>
                <Link
                    className="mt-4 inline-flex h-8 items-center rounded-[var(--radius-control)] border border-border px-3 text-[13px] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href="/topics"
                >
                    {messages.pages.topics.backToList}
                </Link>
            </div>
        </div>
    );
}
