import type {
    Annotation,
    CollectionSummary,
    LabelRef,
    StoryDetail,
} from "@cosmos/contracts";
import { type Dispatch, type SetStateAction } from "react";
import {
    X,
} from "lucide-react";
import {
    Button,
} from "@/components/ui/button";
import {
    Input,
} from "@/components/ui/input";
import {
    Textarea,
} from "@/components/ui/textarea";

type Props = {
    annotations?: readonly Annotation[];
    attachLabelId: string;
    attachableLabels: readonly LabelRef[];
    busy: boolean;
    cancelEditAnnotation: () => void;
    collections?: readonly Pick<CollectionSummary, "id" | "name" | "containsStory">[];
    editingAnnotationBody: string;
    editingAnnotationId: string | null;
    editingAnnotationQuote: string;
    newAnnotationBody: string;
    newAnnotationQuote: string;
    onAttachLabel?: (labelId: string) => Promise<void>;
    onCreateAnnotation?: (input: { body: string; quote?: string | null }) => Promise<void>;
    onDeleteAnnotation?: (annotationId: string) => Promise<void>;
    onDetachLabel?: (labelId: string) => Promise<void>;
    onPinToBoard?: () => Promise<void>;
    onToggleCollection?: (collectionId: string, member: boolean) => Promise<void>;
    onUpdateAnnotation?: (annotationId: string, input: { body: string; quote?: string | null }) => Promise<void>;
    setAttachLabelId: Dispatch<SetStateAction<string>>;
    setEditingAnnotationBody: Dispatch<SetStateAction<string>>;
    setEditingAnnotationQuote: Dispatch<SetStateAction<string>>;
    setNewAnnotationBody: Dispatch<SetStateAction<string>>;
    setNewAnnotationQuote: Dispatch<SetStateAction<string>>;
    startEditAnnotation: (annotation: Annotation) => void;
    story: StoryDetail;
    submitAttachLabel: () => Promise<void>;
    submitCreateAnnotation: () => Promise<void>;
    submitDeleteAnnotation: (annotationId: string) => Promise<void>;
    submitDetachLabel: (labelId: string) => Promise<void>;
    submitPinToBoard: () => Promise<void>;
    submitToggleCollection: (collectionId: string, member: boolean) => Promise<void>;
    submitUpdateAnnotation: (annotationId: string) => Promise<void>;
};

export function StoryOrganizationSection({
    annotations = [],
    attachLabelId,
    attachableLabels = [],
    busy,
    cancelEditAnnotation,
    collections = [],
    editingAnnotationBody,
    editingAnnotationId,
    editingAnnotationQuote,
    newAnnotationBody,
    newAnnotationQuote,
    onAttachLabel,
    onCreateAnnotation,
    onDeleteAnnotation,
    onDetachLabel,
    onPinToBoard,
    onToggleCollection,
    onUpdateAnnotation,
    setAttachLabelId,
    setEditingAnnotationBody,
    setEditingAnnotationQuote,
    setNewAnnotationBody,
    setNewAnnotationQuote,
    startEditAnnotation,
    story,
    submitAttachLabel,
    submitCreateAnnotation,
    submitDeleteAnnotation,
    submitDetachLabel,
    submitPinToBoard,
    submitToggleCollection,
    submitUpdateAnnotation,
}: Props) {
    return (
        <>
            {(onAttachLabel
                || onDetachLabel
                || onToggleCollection
                || onCreateAnnotation
                || onUpdateAnnotation
                || onDeleteAnnotation
                || onPinToBoard) && (
                <section
                    aria-label="用户组织"
                    className="grid gap-4 border-t pt-4"
                >
                    <h3 className="font-medium">用户组织</h3>
                    {onPinToBoard && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                data-testid="story-pin-to-board"
                                onClick={() => void submitPinToBoard()}
                            >
                                固定到看板热点区
                            </Button>
                            <span className="text-sm text-muted-foreground">
                                在当前看板的热点区展示本条内容。
                            </span>
                        </div>
                    )}
                    {/*
                     * 收藏**不在这里**：它是阅读页动作区的按钮（ADR-0029 决策 1「同一件事只保留一个
                     * 可写入口」）。这里曾经也放了一个同命令的按钮，形成双写，Round 13 删除。
                     */}
                    {(onAttachLabel || onDetachLabel) && (
                        <div className="grid gap-3">
                            <h4 className="text-sm font-medium">标签</h4>
                            {story.labels.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    本条 Story 还没有标签；可从已有标签里添加一个。
                                </p>
                            ) : (
                                <ul className="flex flex-wrap gap-2">
                                    {story.labels.map((label) => (
                                        <li
                                            key={label.id}
                                            className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border bg-muted/40 py-0.5 pl-2 pr-1 text-sm"
                                        >
                                            {label.name}
                                            {onDetachLabel && (
                                                <button
                                                    type="button"
                                                    data-testid={`story-label-${label.id}`}
                                                    aria-label={`移除标签 ${label.name}`}
                                                    disabled={busy}
                                                    onClick={() => void submitDetachLabel(label.id)}
                                                    className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-50"
                                                >
                                                    <X aria-hidden={true} className="size-3" />
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {onAttachLabel && attachableLabels.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <select
                                        aria-label="选择要添加的标签"
                                        value={attachLabelId}
                                        disabled={busy}
                                        className="rounded-sm border bg-card px-2 py-1 text-sm"
                                        onChange={(event) => setAttachLabelId(event.target.value)}
                                    >
                                        <option value="">选择标签…</option>
                                        {attachableLabels.map((option) => (
                                            <option key={option.id} value={option.id}>
                                                {option.name}
                                            </option>
                                        ))}
                                    </select>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy || !attachLabelId}
                                        onClick={() => void submitAttachLabel()}
                                    >
                                        添加
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                    {onToggleCollection && (
                        <div className="grid gap-3">
                            <h4 className="text-sm font-medium">收藏夹</h4>
                            {collections && collections.length > 0
                                    ? (
                                        <ul className="grid gap-2">
                                            {collections.map((collection) => {
                                                const member = collection.containsStory === true;
                                                return (
                                                    <li key={collection.id}>
                                                        <label className="flex items-center gap-2 text-sm">
                                                            <input
                                                                type="checkbox"
                                                                checked={member}
                                                                disabled={busy}
                                                                data-testid={`story-collection-${collection.id}`}
                                                                onChange={() => void submitToggleCollection(collection.id, member)}
                                                                className="size-4 rounded-sm border"
                                                            />
                                                            <span className="min-w-0 flex-1 truncate">
                                                                {collection.name}
                                                            </span>
                                                        </label>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )
                                    : (
                                        <p className="text-sm text-muted-foreground">
                                            还没有收藏夹；在整理页建一个后把本条 Story 收纳进去。
                                        </p>
                                    )}
                        </div>
                    )}
                    {(onCreateAnnotation
                        || onUpdateAnnotation
                        || onDeleteAnnotation) && (
                        <div className="grid gap-3">
                            <h4 className="text-sm font-medium">批注</h4>
                            {annotations && annotations.length > 0 ? (
                                <ul className="grid gap-3">
                                    {annotations.map((annotation) => (
                                        <li
                                            key={annotation.id}
                                            data-story-annotation-id={annotation.id}
                                            className="grid gap-2 rounded-sm border bg-muted/40 p-3 text-sm"
                                        >
                                            {editingAnnotationId === annotation.id ? (
                                                <div className="grid gap-2">
                                                    <Textarea
                                                        aria-label="批注正文"
                                                        value={editingAnnotationBody}
                                                        onChange={(event) => setEditingAnnotationBody(event.target.value)}
                                                        disabled={busy}
                                                    />
                                                    <Input
                                                        aria-label="批注引文"
                                                        value={editingAnnotationQuote}
                                                        onChange={(event) => setEditingAnnotationQuote(event.target.value)}
                                                        disabled={busy}
                                                        placeholder="引文（可选）"
                                                    />
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            disabled={busy || !editingAnnotationBody.trim()}
                                                            onClick={() => void submitUpdateAnnotation(annotation.id)}
                                                        >
                                                            保存
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            disabled={busy}
                                                            onClick={cancelEditAnnotation}
                                                        >
                                                            取消
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <p className="whitespace-pre-wrap leading-6">
                                                        {annotation.body}
                                                    </p>
                                                    {annotation.quote && (
                                                        <p className="border-l-2 pl-2 text-xs text-muted-foreground">
                                                            {annotation.quote}
                                                        </p>
                                                    )}
                                                    <p className="text-xs text-muted-foreground">
                                                        {annotation.actor ?? "未署名"} ·{" "}
                                                        {new Date(annotation.createdAt).toLocaleString()}
                                                    </p>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        {onUpdateAnnotation && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={busy}
                                                                onClick={() => startEditAnnotation(annotation)}
                                                            >
                                                                编辑
                                                            </Button>
                                                        )}
                                                        {onDeleteAnnotation && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={busy}
                                                                onClick={() => void submitDeleteAnnotation(annotation.id)}
                                                            >
                                                                删除
                                                            </Button>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    本条 Story 还没有批注；可在下方记录摘录与想法。
                                </p>
                            )}
                            {onCreateAnnotation && (
                                <div className="grid gap-2">
                                    <Textarea
                                        aria-label="新批注正文"
                                        value={newAnnotationBody}
                                        onChange={(event) => setNewAnnotationBody(event.target.value)}
                                        disabled={busy}
                                        placeholder="写下批注正文"
                                    />
                                    <Input
                                        aria-label="新批注引文"
                                        value={newAnnotationQuote}
                                        onChange={(event) => setNewAnnotationQuote(event.target.value)}
                                        disabled={busy}
                                        placeholder="引文（可选）"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-fit"
                                        disabled={busy || !newAnnotationBody.trim()}
                                        onClick={() => void submitCreateAnnotation()}
                                    >
                                        添加批注
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </section>
            )}
        </>
    );
}
