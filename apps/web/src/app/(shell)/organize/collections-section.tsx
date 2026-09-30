"use client";

import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { CollectionDetail, CollectionSummary } from "@cosmos/contracts";

import { client, readError } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

import { ItemBlock, SectionMessage, SectionShell } from "./section-parts";

/*
 * 收藏夹分区。新建、改描述、删除与增删成员都在这里（ADR-0029 决策 1）；
 * Story 页只能勾选已有收藏夹。
 *
 * 已知缺口：没有从收藏夹里搜索并加入某条 Story 的选择器——成员是在 Story 页勾选的，
 * 这里只做移除。要在这里加人需要先有 Story 选择器（切片 3d 的阅读页会提供）。
 */
export function CollectionsSection() {
    const toast = useToast();
    const [collections, setCollections] = useState<readonly CollectionSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CollectionDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        try {
            setCollections((await client.listCollections()).items);
            setError(null);
        } catch (caught) {
            setError(readError(caught));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // 首次读取：load 内部先 await 再 setState，不会在渲染期间同步触发级联渲染。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const toggleDetail = async (collectionId: string): Promise<void> => {
        if (expandedId === collectionId) {
            setExpandedId(null);
            setDetail(null);
            return;
        }
        setExpandedId(collectionId);
        setDetail(null);
        setDetailLoading(true);
        try {
            setDetail(await client.collection(collectionId));
        } catch (caught) {
            toast.error({ title: "读取收藏夹失败", description: readError(caught) });
        } finally {
            setDetailLoading(false);
        }
    };

    const create = async (): Promise<void> => {
        const name = newName.trim();
        if (name === "") {
            return;
        }
        setCreating(true);
        try {
            await client.createCollection({ name });
            setNewName("");
            await load();
            toast.success({ title: `已创建收藏夹「${name}」` });
        } catch (caught) {
            toast.error({ title: "创建收藏夹失败", description: readError(caught) });
        } finally {
            setCreating(false);
        }
    };

    const remove = async (collection: CollectionSummary): Promise<void> => {
        try {
            await client.deleteCollection(collection.id);
            if (expandedId === collection.id) {
                setExpandedId(null);
                setDetail(null);
            }
            await load();
            toast.success({ title: `已删除收藏夹「${collection.name}」` });
        } catch (caught) {
            toast.error({ title: "删除收藏夹失败", description: readError(caught) });
        }
    };

    const removeMember = async (storyId: string, title: string): Promise<void> => {
        if (expandedId === null) {
            return;
        }
        const collectionId = expandedId;
        try {
            await client.removeCollectionItem(collectionId, { storyId });
            setDetail(await client.collection(collectionId));
            await load();
            toast.success({ title: `已把「${title}」移出收藏夹` });
        } catch (caught) {
            toast.error({ title: "移出收藏夹失败", description: readError(caught) });
        }
    };

    return (
        <SectionShell
            count={loading ? null : collections.length}
            summary="按自己的方式分组的集合；成员在 Story 页勾选，这里可以移出"
            title="收藏夹"
        >
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    aria-label="新收藏夹名称"
                    className="max-w-xs"
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            void create();
                        }
                    }}
                    placeholder="新收藏夹名称"
                    value={newName}
                />
                <Button
                    disabled={creating || newName.trim() === ""}
                    onClick={() => void create()}
                    variant="outline"
                >
                    <Plus data-icon="inline-start" />
                    新建收藏夹
                </Button>
            </div>

            {error ? (
                <SectionMessage kind="error">{error}</SectionMessage>
            ) : loading ? (
                <SectionMessage kind="loading">正在读取…</SectionMessage>
            ) : collections.length === 0 ? (
                <SectionMessage kind="empty">
                    还没有收藏夹。收藏夹用来把一批内容按你的目的放在一起。
                </SectionMessage>
            ) : (
                <ul className="flex flex-col">
                    {collections.map((collection) => (
                        <ItemBlock key={collection.id}>
                            <Button
                                aria-expanded={expandedId === collection.id}
                                className="h-auto min-w-0 flex-1 justify-start gap-1.5 p-0 text-left text-[14px] font-normal"
                                onClick={() => void toggleDetail(collection.id)}
                                variant="link"
                            >
                                {expandedId === collection.id ? (
                                    <ChevronDown aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                                ) : (
                                    <ChevronRight aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                                )}
                                <span className="truncate">{collection.name}</span>
                            </Button>
                            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                                {collection.itemCount} 条
                            </span>
                            <Button
                                aria-label={`删除收藏夹 ${collection.name}`}
                                onClick={() => void remove(collection)}
                                size="icon-sm"
                                variant="ghost"
                            >
                                <Trash2 aria-hidden className="size-3.5" strokeWidth={1.75} />
                            </Button>
                            {expandedId === collection.id && (
                                <div className="w-full basis-full pt-1">
                                    {detailLoading ? (
                                        <p className="text-[12px] text-muted-foreground">正在读取…</p>
                                    ) : detail === null || detail.stories.length === 0 ? (
                                        <p className="text-[12px] text-muted-foreground">
                                            这个收藏夹还是空的。成员在 Story 页勾选。
                                        </p>
                                    ) : (
                                        <ul className="flex flex-col gap-1">
                                            {detail.stories.map((story) => (
                                                <li
                                                    className="flex items-center gap-2 text-[13px]"
                                                    key={story.storyId}
                                                >
                                                    <span className="min-w-0 flex-1 truncate">
                                                        {story.title}
                                                    </span>
                                                    <span className="shrink-0 text-[11px] text-muted-foreground">
                                                        {story.addedAt.slice(0, 10)}
                                                    </span>
                                                    <Button
                                                        aria-label={`把 ${story.title} 移出收藏夹`}
                                                        onClick={() =>
                                                            void removeMember(story.storyId, story.title)
                                                        }
                                                        size="icon-xs"
                                                        variant="ghost"
                                                    >
                                                        <X aria-hidden className="size-3" strokeWidth={2} />
                                                    </Button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </ItemBlock>
                    ))}
                </ul>
            )}
        </SectionShell>
    );
}
