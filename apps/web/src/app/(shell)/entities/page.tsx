"use client";

import { RefreshCcw, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useEntityWorkspace } from "@/app/home/use-entity-workspace";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";

import { Button } from "@/components/ui/button";
import { useLiveTopic } from "@/components/shell/live-provider";

/*
 * Entity 列表。切片 3b 只做**浏览与跳转**：新建 Entity、加删别名与关系、解除关联
 * 都在 Entity 页落地（切片 3c），与 Story 抽屉旧表单的删除同批进行。
 */
export default function EntitiesPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const workspaceContext = useMemo(() => ({ setError, setNotice, setLoading }), []);
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const { entities, loadEntities } = useEntityWorkspace(workspaceContext, storyWorkspace);

    useEffect(() => {
        void loadEntities().finally(() => setLoading(false));
    }, [loadEntities]);

    useLiveTopic("stories", () => {
        void loadEntities();
    });

    return (
        <div className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[15px] font-medium">Entity</h1>
                <span className="text-[12px] text-muted-foreground">
                    {entities.length === 0 ? "尚未创建 Entity" : `${entities.length} 个 Entity`}
                </span>
                <Button
                    className="ml-auto"
                    disabled={loading}
                    onClick={() => void loadEntities()}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCcw data-icon="inline-start" />
                    刷新
                </Button>
            </div>

            {error && (
                <div
                    className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-3 text-[13px] leading-6 text-destructive"
                    role="alert"
                >
                    {error}
                </div>
            )}
            {notice && (
                <div
                    className="rounded-[var(--radius-control)] border border-border bg-muted/40 p-3 text-[13px] leading-6"
                    role="status"
                >
                    {notice}
                </div>
            )}

            {loading && entities.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">正在读取…</p>
            ) : entities.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                    <p className="text-[13px] font-medium">还没有 Entity</p>
                    <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                        Entity 是可被内容关联的实体（人物、组织、产品、项目、模型、地点），
                        Entity 之间也可以有关系。新建入口随下一步落地。
                    </p>
                </div>
            ) : (
                <ul className="flex flex-col">
                    {entities.map((entity) => (
                        <li
                            className="flex items-start gap-3 border-b border-border py-3 last:border-b-0"
                            key={entity.id}
                        >
                            <Users
                                aria-hidden
                                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                                strokeWidth={1.75}
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <button
                                    className="text-left text-[14px] font-medium hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    onClick={() => router.push(`/entities/${encodeURIComponent(entity.id)}`)}
                                    type="button"
                                >
                                    {entity.name}
                                </button>
                                <span className="text-[12px] text-muted-foreground">{entity.type}</span>
                            </div>
                            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                                {entity.storyCount} 条内容 · {entity.relationCount} 个关系
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
