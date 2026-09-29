import { PagePlaceholder } from "@/components/shell/page-placeholder";

/**
 * Story 阅读页。切片 1 只建立路由与「无侧栏」版面；正文、来源成员、时间线、
 * 关键事实、引用关系、读完动作区与归并拆分在切片 3 搬迁。
 */
export default async function StoryPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    return (
        <div className="flex w-full justify-center">
            <div className="w-full max-w-[640px]">
                <div className="rounded-[var(--radius-card)] border border-border bg-paper p-8 shadow-[var(--elevation-card)]">
                    <PagePlaceholder
                        summary="这一页只保留顶栏（带返回入口），左侧导航按设计隐藏——读一条内容的宽度优先。正文、来源成员（标出采集与人工）、时间线、关键事实、引用关系、相关内容、读完动作区与归并拆分将在切片 3 落地。"
                        title="Story 阅读页"
                    >
                        <p className="font-mono text-[12px] text-muted-foreground">story id: {id}</p>
                    </PagePlaceholder>
                </div>
            </div>
        </div>
    );
}
