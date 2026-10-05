"use client";

import { RefreshCcw, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useEntityWorkspace } from "@/app/home/use-entity-workspace";
import { useNoticeToast } from "@/app/home/use-notice-toast";
import { useStoryWorkspace } from "@/app/home/use-story-workspace";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENTITY_TYPE_OPTIONS } from "@/components/cosmos/entity-panel";
import { useLiveTopic } from "@/components/shell/live-provider";
import { PageBanners } from "@/components/shell/page-banners";
import { messages } from "@/copy/messages";

/*
 * Entity 列表与新建。创建入口在**对象页**（ADR-0029 决策 1）：这里建 Entity，
 * 与内容的关联在 Story 页做。加删别名与关系、解除关联 Story 在详情页（`/entities/:id`）。
 */
export default function EntitiesPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newName, setNewName] = useState("");
    const [newType, setNewType] = useState<string>(ENTITY_TYPE_OPTIONS[0]?.value ?? "person");

    /** 写回执走 toast；`error` 仍由页面横幅显示。上下文对象身份稳定由 hook 保证。 */
    const { context: workspaceContext } = useNoticeToast(setError, setLoading);
    const storyWorkspace = useStoryWorkspace(workspaceContext);
    const { createEntity, entities, loadEntities } = useEntityWorkspace(workspaceContext, storyWorkspace);

    useEffect(() => {
        void loadEntities().finally(() => setLoading(false));
    }, [loadEntities]);

    useLiveTopic("stories", () => {
        void loadEntities();
    });

    return (
        <div className="flex w-full flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[15px] font-medium">{messages.pages.entities.title}</h1>
                <span className="text-[12px] text-muted-foreground">
                    {entities.length === 0
                        ? messages.pages.entities.emptyCount
                        : messages.pages.entities.countLabel(entities.length)}
                </span>
                <Button
                    className="ml-auto"
                    disabled={loading}
                    onClick={() => void loadEntities()}
                    size="sm"
                    variant="outline"
                >
                    <RefreshCcw data-icon="inline-start" />
                    {messages.common.refresh}
                </Button>
            </div>

            <PageBanners error={error} />

            <div className="flex flex-wrap items-center gap-2">
                <Input
                    aria-label={messages.pages.entities.newName}
                    className="max-w-xs"
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder={messages.pages.entities.newName}
                    value={newName}
                />
                <label className="flex items-center gap-2 text-[13px]">
                    <span className="text-muted-foreground">{messages.pages.entities.newType}</span>
                    <select
                        aria-label={messages.pages.entities.newType}
                        className="h-8 rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
                        onChange={(event) => setNewType(event.target.value)}
                        value={newType}
                    >
                        {ENTITY_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                <Button
                    disabled={newName.trim() === ""}
                    onClick={() => {
                        const name = newName.trim();
                        setNewName("");
                        void createEntity(name, newType);
                    }}
                    size="sm"
                    variant="outline"
                >
                    {messages.pages.entities.create}
                </Button>
            </div>

            {loading && entities.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{messages.common.loading}</p>
            ) : entities.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-10 text-center">
                    <p className="text-[13px] font-medium">{messages.pages.entities.emptyTitle}</p>
                    <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
                        {messages.pages.entities.emptyBody}
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
                                {messages.common.storyCount(entity.storyCount)} ·{" "}
                                {messages.pages.entities.relationCount(entity.relationCount)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
