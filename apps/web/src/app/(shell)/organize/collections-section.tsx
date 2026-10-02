"use client";

import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { CollectionDetail, CollectionSummary } from "@cosmos/contracts";

import { client, readError } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { messages } from "@/copy/messages";

import { ItemBlock, SectionMessage, SectionShell } from "./section-parts";

/*
 * 收藏夹分区：新建、改名与改描述、删除、查看成员并移除，都在这里（ADR-0029 决策 1）。
 * Story 页只能勾选已有收藏夹。
 *
 * 成员**加入**只发生在 Story 页（ADR-0029 §3「关联就地」）：对象页负责对象的字段，
 * 把某条 Story 放进收藏夹是那条 Story 上的关联动作。所以这里只做移除。
 */
export function CollectionsSection() {    const toast = useToast();
    const [collections, setCollections] = useState<readonly CollectionSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CollectionDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    /** 展开区里的改名草稿：null 表示没在改名。 */
    const [renameDraft, setRenameDraft] = useState<{ name: string; description: string } | null>(null);
    const [savingRename, setSavingRename] = useState(false);

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
            setRenameDraft(null);
            return;
        }
        setExpandedId(collectionId);
        setDetail(null);
        setRenameDraft(null);
        setDetailLoading(true);
        try {
            setDetail(await client.collection(collectionId));
        } catch (caught) {
            toast.error({ title: messages.organize.collections.readFailed, description: readError(caught) });
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
            toast.success({ title: messages.organize.collections.created(name) });
        } catch (caught) {
            toast.error({ title: messages.organize.collections.createFailed, description: readError(caught) });
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
            toast.success({ title: messages.organize.collections.removed(collection.name) });
        } catch (caught) {
            toast.error({ title: messages.organize.collections.removeFailed, description: readError(caught) });
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
            toast.success({ title: messages.organize.collections.itemRemoved(title) });
        } catch (caught) {
            toast.error({ title: messages.organize.collections.itemRemoveFailed, description: readError(caught) });
        }
    };

    /** 改名与改描述同一个命令（`updateCollection`），所以在展开区里合成一个小表单。 */
    const rename = async (collectionId: string, draft: { name: string; description: string }): Promise<void> => {
        const name = draft.name.trim();
        if (name === "" || savingRename) {
            return;
        }
        const description = draft.description.trim();
        setSavingRename(true);
        try {
            await client.updateCollection(collectionId, {
                name,
                description: description === "" ? null : description,
            });
            setRenameDraft(null);
            setDetail(await client.collection(collectionId));
            await load();
            toast.success({ title: messages.organize.collections.renamed(name) });
        } catch (caught) {
            toast.error({
                title: messages.organize.collections.renameFailed,
                description: readError(caught),
            });
        } finally {
            setSavingRename(false);
        }
    };

    return (
        <SectionShell
            count={loading ? null : collections.length}
            summary={messages.organize.collections.summary}
            title={messages.organize.tabs.collections}
        >
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    aria-label={messages.organize.collections.newName}
                    className="max-w-xs"
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            void create();
                        }
                    }}
                    placeholder={messages.organize.collections.newName}
                    value={newName}
                />
                <Button
                    disabled={creating || newName.trim() === ""}
                    onClick={() => void create()}
                    variant="outline"
                >
                    <Plus data-icon="inline-start" />
                    {messages.organize.collections.create}
                </Button>
            </div>

            {error ? (
                <SectionMessage kind="error">{error}</SectionMessage>
            ) : loading ? (
                <SectionMessage kind="loading">{messages.common.loading}</SectionMessage>
            ) : collections.length === 0 ? (
                <SectionMessage kind="empty">{messages.organize.collections.empty}</SectionMessage>
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
                                {messages.organize.collections.itemCount(collection.itemCount)}
                            </span>
                            <Button
                                aria-label={messages.organize.collections.removeLabel(collection.name)}
                                onClick={() => void remove(collection)}
                                size="icon-sm"
                                variant="ghost"
                            >
                                <Trash2 aria-hidden className="size-3.5" strokeWidth={1.75} />
                            </Button>
                            {expandedId === collection.id && (
                                <div className="w-full basis-full pt-1">
                                    {renameDraft === null ? (
                                        <Button
                                            className="mb-1 px-0"
                                            onClick={() => setRenameDraft({
                                                name: collection.name,
                                                description: detail?.description ?? "",
                                            })}
                                            size="sm"
                                            variant="link"
                                        >
                                            {messages.organize.collections.rename}
                                        </Button>
                                    ) : (
                                        <CollectionRenameForm
                                            draft={renameDraft}
                                            onChange={setRenameDraft}
                                            onCancel={() => setRenameDraft(null)}
                                            onSubmit={() => void rename(collection.id, renameDraft)}
                                            saving={savingRename}
                                        />
                                    )}
                                    {detailLoading ? (
                                        <p className="text-[12px] text-muted-foreground">
                                            {messages.common.loading}
                                        </p>
                                    ) : detail === null || detail.stories.length === 0 ? (
                                        <p className="text-[12px] text-muted-foreground">
                                            {messages.organize.collections.emptyMembers}
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
                                                        aria-label={messages.organize.collections.removeItem(
                                                            story.title,
                                                        )}
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

/** 改名与改描述合成一个小表单：两者是同一个命令的两个字段。 */
function CollectionRenameForm({
    draft,
    saving,
    onChange,
    onSubmit,
    onCancel,
}: {
    draft: { name: string; description: string };
    saving: boolean;
    onChange: (draft: { name: string; description: string }) => void;
    onSubmit: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="mb-2 grid gap-2">
            <Input
                aria-label={messages.organize.collections.renameName}
                className="max-w-xs"
                onChange={(event) => onChange({ ...draft, name: event.target.value })}
                value={draft.name}
            />
            <Input
                aria-label={messages.organize.collections.renameDescription}
                className="max-w-md"
                onChange={(event) => onChange({ ...draft, description: event.target.value })}
                placeholder={messages.organize.collections.renameDescription}
                value={draft.description}
            />
            <div className="flex gap-2">
                <Button disabled={saving || draft.name.trim() === ""} onClick={onSubmit} size="sm">
                    {messages.organize.collections.renameSubmit}
                </Button>
                <Button onClick={onCancel} size="sm" variant="ghost">
                    {messages.organize.collections.renameCancel}
                </Button>
            </div>
        </div>
    );
}
