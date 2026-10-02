import Link from "next/link";

import { messages } from "@/copy/messages";

/**
 * Entity 详情占位（`/entities/:id`）。
 *
 * 列表页的每一行都链到这里，但别名、类型化关系与「关联 Story」的解除还没有归属页面——
 * **占位而不是 404**。刻意**不显示路由里的 id**：判据 R3 要求界面不出现内部标识符，
 * 占位页也不例外。
 */
export default function EntityDetailPage() {
    return (
        <div className="flex w-full flex-col gap-4">
            <h1 className="text-[15px] font-medium">{messages.pages.entities.detailTitle}</h1>
            <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                <p className="text-[13px] font-medium">{messages.pages.entities.detailPending}</p>
                <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                    {messages.pages.entities.detailBody}
                </p>
                <Link
                    className="mt-4 inline-flex h-8 items-center rounded-[var(--radius-control)] border border-border px-3 text-[13px] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href="/entities"
                >
                    {messages.pages.entities.backToList}
                </Link>
            </div>
        </div>
    );
}
