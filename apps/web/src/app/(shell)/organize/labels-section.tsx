"use client";

import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { LabelDetail, LabelItem } from "@cosmos/contracts";

import { client, readError } from "@/app/home/page-runtime";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { messages } from "@/copy/messages";

import { ItemBlock, SectionMessage, SectionShell } from "./section-parts";

/*
 * 标签分区。新建、改名与删除只在这里发生——Story 页只能挂已有标签（ADR-0029 决策 1）。
 * 点开一个标签看它挂了哪些 Story / 条目 / 话题：这份归属清单由 label(id) 直接解析好标题
 * 返回，不需要前端再查（切片 3a 的读取侧投影）。
 *
 * 改名是原地改写（`PATCH /labels/:id`，Task 36 切片 E）：标签不是 revision 模型，
 * 所以没有版本历史可留；删除仍是不可逆的（标签本身没有墓碑）。
 */
export function LabelsSection() {
    const toast = useToast();
    const [labels, setLabels] = useState<readonly LabelItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<LabelDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    /** 正在改名的标签与它的草稿；null 表示没有在改名。 */
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState("");
    const [renaming, setRenaming] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        try {
            setLabels((await client.listLabels()).items);
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

    const toggleDetail = async (labelId: string): Promise<void> => {
        if (expandedId === labelId) {
            setExpandedId(null);
            setDetail(null);
            return;
        }
        setExpandedId(labelId);
        setDetail(null);
        setDetailLoading(true);
        try {
            setDetail(await client.label(labelId));
        } catch (caught) {
            toast.error({ title: messages.organize.labels.readFailed, description: readError(caught) });
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
            await client.createLabel({ name });
            setNewName("");
            await load();
            toast.success({ title: messages.organize.labels.created(name) });
        } catch (caught) {
            toast.error({ title: messages.organize.labels.createFailed, description: readError(caught) });
        } finally {
            setCreating(false);
        }
    };

    const remove = async (label: LabelItem): Promise<void> => {
        try {
            await client.deleteLabel(label.id);
            if (expandedId === label.id) {
                setExpandedId(null);
                setDetail(null);
            }
            if (renamingId === label.id) {
                setRenamingId(null);
            }
            await load();
            toast.success({ title: messages.organize.labels.removed(label.name) });
        } catch (caught) {
            toast.error({ title: messages.organize.labels.removeFailed, description: readError(caught) });
        }
    };

    const startRename = (label: LabelItem): void => {
        setRenamingId(label.id);
        setRenameDraft(label.name);
    };

    const cancelRename = (): void => {
        setRenamingId(null);
        setRenameDraft("");
    };

    /**
     * 改名。回执是改名后的 LabelItem，但列表按名字排序，所以仍要重读一次才能让顺序正确；
     * 展开区里的归属清单只带标题、与名字无关，不用重读。
     */
    const submitRename = async (label: LabelItem): Promise<void> => {
        const name = renameDraft.trim();
        if (name === "" || name === label.name) {
            cancelRename();
            return;
        }
        setRenaming(true);
        try {
            const updated = await client.updateLabel(label.id, { name });
            cancelRename();
            await load();
            toast.success({ title: messages.organize.labels.renamed(updated.name) });
        } catch (caught) {
            // 撞名（409）与其它失败都留在原地显示，草稿不丢——用户改一个词就能重试。
            toast.error({ title: messages.organize.labels.renameFailed, description: readError(caught) });
        } finally {
            setRenaming(false);
        }
    };

    return (
        <SectionShell
            count={loading ? null : labels.length}
            summary={messages.organize.labels.summary}
            title={messages.organize.tabs.labels}
        >
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    aria-label={messages.organize.labels.newName}
                    className="max-w-xs"
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            void create();
                        }
                    }}
                    placeholder={messages.organize.labels.newName}
                    value={newName}
                />
                <Button
                    disabled={creating || newName.trim() === ""}
                    onClick={() => void create()}
                    variant="outline"
                >
                    <Plus data-icon="inline-start" />
                    {messages.organize.labels.create}
                </Button>
            </div>

            {error ? (
                <SectionMessage kind="error">{error}</SectionMessage>
            ) : loading ? (
                <SectionMessage kind="loading">{messages.common.loading}</SectionMessage>
            ) : labels.length === 0 ? (
                <SectionMessage kind="empty">{messages.organize.labels.empty}</SectionMessage>
            ) : (
                <ul className="flex flex-col">
                    {labels.map((label) => (
                        <ItemBlock key={label.id}>
                            {renamingId === label.id ? (
                                /*
                                 * 改名就地占满整行：与「新建」同一形状（一个输入框 + 保存），
                                 * 但不占额外弹层——标签行本来就只有名字与计数。
                                 */
                                <div className="flex w-full flex-wrap items-center gap-2">
                                    <Input
                                        aria-label={messages.organize.labels.renameField}
                                        autoFocus
                                        className="max-w-xs"
                                        disabled={renaming}
                                        onChange={(event) => setRenameDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                                void submitRename(label);
                                            }
                                            if (event.key === "Escape") {
                                                cancelRename();
                                            }
                                        }}
                                        value={renameDraft}
                                    />
                                    <Button
                                        disabled={renaming || renameDraft.trim() === ""}
                                        onClick={() => void submitRename(label)}
                                        size="sm"
                                        variant="outline"
                                    >
                                        {messages.organize.labels.renameSubmit}
                                    </Button>
                                    <Button
                                        disabled={renaming}
                                        onClick={cancelRename}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        {messages.organize.labels.renameCancel}
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    <Button
                                        aria-expanded={expandedId === label.id}
                                        className="h-auto min-w-0 flex-1 justify-start gap-1.5 p-0 text-left text-[14px] font-normal"
                                        onClick={() => void toggleDetail(label.id)}
                                        variant="link"
                                    >
                                        {expandedId === label.id ? (
                                            <ChevronDown aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                                        ) : (
                                            <ChevronRight aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                                        )}
                                        <span className="truncate">{label.name}</span>
                                    </Button>
                                    <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                                        {messages.organize.labels.useCount(label.assignedCount)}
                                    </span>
                                    <Button
                                        aria-label={messages.organize.labels.rename(label.name)}
                                        onClick={() => startRename(label)}
                                        size="icon-sm"
                                        variant="ghost"
                                    >
                                        <Pencil aria-hidden className="size-3.5" strokeWidth={1.75} />
                                    </Button>
                                    <Button
                                        aria-label={messages.organize.labels.removeLabel(label.name)}
                                        onClick={() => void remove(label)}
                                        size="icon-sm"
                                        variant="ghost"
                                    >
                                        <Trash2 aria-hidden className="size-3.5" strokeWidth={1.75} />
                                    </Button>
                                </>
                            )}
                            {expandedId === label.id && renamingId !== label.id && (
                                <div className="w-full basis-full pt-1">
                                    {detailLoading ? (
                                        <p className="text-[12px] text-muted-foreground">
                                            {messages.common.loading}
                                        </p>
                                    ) : detail === null ? (
                                        <p className="text-[12px] text-muted-foreground">
                                            {messages.organize.labels.noContent}
                                        </p>
                                    ) : (
                                        <LabelAssignments detail={detail} />
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

function LabelAssignments({ detail }: { detail: LabelDetail }) {
    const groups = [
        { title: messages.common.targetType.story, items: detail.assignedStories },
        { title: messages.common.targetType.entry, items: detail.assignedEntries },
        { title: messages.common.targetType.topic, items: detail.assignedTopics },
    ].filter((group) => group.items.length > 0);

    if (groups.length === 0) {
        return (
            <p className="text-[12px] text-muted-foreground">
                {messages.organize.labels.emptyOnTargets}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-1.5">
            {groups.map((group) => (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1" key={group.title}>
                    <span className="text-[11px] text-muted-foreground">{group.title}</span>
                    {group.items.map((item) => (
                        <span
                            className="rounded-[4px] border border-border px-1.5 py-px text-[12px]"
                            key={item.id}
                        >
                            {item.title}
                        </span>
                    ))}
                </div>
            ))}
        </div>
    );
}
