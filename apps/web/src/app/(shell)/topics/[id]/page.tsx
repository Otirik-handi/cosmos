import Link from "next/link";

import { messages } from "@/copy/messages";

/**
 * 话题详情占位（`/topics/:id`）。
 *
 * 列表页的每一行都链到这里，但改标题与目的、成员改角色/移除/恢复还没有归属页面——
 * **占位而不是 404**：用户点了行以后应该看到「这里还没建好」，而不是一页错误。
 * 与阅读页同一条规矩：`params.id` 到这一层仍是 URL 编码形态，解码只在这里做一次。
 */
export default async function TopicDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    return (
        <div className="flex w-full flex-col gap-4">
            <h1 className="text-[15px] font-medium">{messages.pages.topics.detailTitle}</h1>
            <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                <p className="text-[13px] font-medium">{messages.pages.topics.detailPending}</p>
                <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                    {messages.pages.topics.detailBody}
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    {decodeURIComponent(id)}
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
