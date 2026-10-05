"use client";

import type {
    Annotation,
    CollectionSummary,
    LabelRef,
    StoryDetail,
} from "@cosmos/contracts";
import { X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { messages } from "@/copy/messages";

/**
 * 「我的标记」段（C 段）：收藏、固定到看板、标签、收藏夹、批注。
 *
 * 判据是「它是不是我对这条内容的私有标记」——都不改 Story 表示，只写「用户 × Story」这一层
 * （ADR-0028 的用户真相保护只管这半边）。本轮之前这五件事散在三处：收藏在标题行、
 * 固定/标签/收藏夹/批注在「用户组织」、而那个容器里还混装了「关联 Entity / 加入 Topic」
 * （另一类：改的是关系表）。Task 36 Round 9 按类别重排，把标记类收回本段、关联类搬去 D 段。
 *
 * 草稿状态（选中的标签、编辑中/新建的批注）归本组件持有：它们只在本段内使用，
 * 没有跨段消费者——把草稿提到面板上再传进来，就是把状态留在原地只挪渲染位置。
 * 写入进行中的 busy 与错误行仍由 `StoryEditPanel` 持有，四段共用一行提示。
 */
type Props = {
    story: StoryDetail;
    busy: boolean;
    /**
     * 各写入动作由 `StoryMarkingEditor` 注入：它已经套好了 busy/错误漏斗，
     * 本组件只负责表单与草稿，不重复实现一遍提交状态。
     */
    submitToggleFavorite?: () => Promise<void>;
    submitPinToBoard?: () => Promise<void>;
    submitAttachLabel: (labelId: string) => Promise<void>;
    submitDetachLabel: (labelId: string) => Promise<void>;
    submitToggleCollection: (collectionId: string, member: boolean) => Promise<void>;
    submitCreateAnnotation: (input: { body: string; quote?: string | null }) => Promise<void>;
    submitUpdateAnnotation: (
        annotationId: string,
        input: { body: string; quote?: string | null },
    ) => Promise<void>;
    submitDeleteAnnotation: (annotationId: string) => Promise<void>;
    labelOptions?: readonly LabelRef[];
    collections?: readonly Pick<CollectionSummary, "id" | "name" | "containsStory">[];
    annotations?: readonly Annotation[];
    /** 收藏请求进行中：按钮据此禁用。 */
    togglingFavorite?: boolean;
};

export function StoryMarkingSection({
    story,
    busy,
    submitToggleFavorite,
    submitPinToBoard,
    submitAttachLabel,
    submitDetachLabel,
    submitToggleCollection,
    submitCreateAnnotation,
    submitUpdateAnnotation,
    submitDeleteAnnotation,
    labelOptions = [],
    collections = [],
    annotations = [],
    togglingFavorite = false,
}: Props) {
    const [attachLabelId, setAttachLabelId] = useState("");
    const [newAnnotationBody, setNewAnnotationBody] = useState("");
    const [newAnnotationQuote, setNewAnnotationQuote] = useState("");
    const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
    const [editingAnnotationBody, setEditingAnnotationBody] = useState("");
    const [editingAnnotationQuote, setEditingAnnotationQuote] = useState("");

    /** 下拉只列尚未打到本条 Story 的标签，避免重复添加。 */
    const attachableLabels = labelOptions.filter((option) => {
        return !story.labels.some((label) => label.id === option.id);
    });

    const createAnnotation = async (): Promise<void> => {
        const body = newAnnotationBody.trim();
        if (!body) {
            return;
        }
        const quote = newAnnotationQuote.trim();
        await submitCreateAnnotation({ body, quote: quote || null });
        setNewAnnotationBody("");
        setNewAnnotationQuote("");
    };

    const startEditAnnotation = (annotation: Annotation): void => {
        setEditingAnnotationId(annotation.id);
        setEditingAnnotationBody(annotation.body);
        setEditingAnnotationQuote(annotation.quote ?? "");
    };

    const cancelEditAnnotation = (): void => {
        setEditingAnnotationId(null);
        setEditingAnnotationBody("");
        setEditingAnnotationQuote("");
    };

    const updateAnnotation = async (annotationId: string): Promise<void> => {
        const body = editingAnnotationBody.trim();
        if (!body) {
            return;
        }
        const quote = editingAnnotationQuote.trim();
        await submitUpdateAnnotation(annotationId, { body, quote: quote || null });
        cancelEditAnnotation();
    };

    return (
        <section aria-label={messages.reading.storyEdit.marking.sectionLabel} className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
                {submitToggleFavorite !== undefined && (
                    <Button
                        disabled={togglingFavorite}
                        onClick={() => void submitToggleFavorite()}
                        size="sm"
                        variant={story.favorited ? "default" : "outline"}
                    >
                        {story.favorited ? messages.reading.favorited : messages.reading.favorite}
                    </Button>
                )}
                {submitPinToBoard !== undefined && (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        data-testid="story-pin-to-board"
                        onClick={() => void submitPinToBoard()}
                    >
                        {messages.reading.storyEdit.marking.pinToBoard}
                    </Button>
                )}
            </div>

            <div className="grid gap-3">
                <h4 className="text-sm font-medium">{messages.reading.storyEdit.marking.labelsTitle}</h4>
                {story.labels.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {messages.reading.storyEdit.marking.labelsEmpty}
                    </p>
                ) : (
                    <ul className="flex flex-wrap gap-2">
                        {story.labels.map((label) => (
                            <li
                                key={label.id}
                                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border bg-muted/40 py-0.5 pl-2 pr-1 text-sm"
                            >
                                {label.name}
                                <button
                                    type="button"
                                    data-testid={`story-label-${label.id}`}
                                    aria-label={messages.reading.storyEdit.marking.labelRemove(label.name)}
                                    disabled={busy}
                                    onClick={() => void submitDetachLabel(label.id)}
                                    className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-50"
                                >
                                    <X aria-hidden={true} className="size-3" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {attachableLabels.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            aria-label={messages.reading.storyEdit.marking.labelSelect}
                            value={attachLabelId}
                            disabled={busy}
                            className="rounded-sm border bg-card px-2 py-1 text-sm"
                            onChange={(event) => setAttachLabelId(event.target.value)}
                        >
                            <option value="">{messages.reading.storyEdit.marking.labelSelectPlaceholder}</option>
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
                            onClick={() => void submitAttachLabel(attachLabelId)}
                        >
                            {messages.reading.storyEdit.marking.labelAdd}
                        </Button>
                    </div>
                )}
            </div>

            <div className="grid gap-3">
                <h4 className="text-sm font-medium">{messages.reading.storyEdit.marking.collectionsTitle}</h4>
                {collections.length > 0 ? (
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
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {messages.reading.storyEdit.marking.collectionsEmpty}
                    </p>
                )}
            </div>

            <div className="grid gap-3">
                <h4 className="text-sm font-medium">{messages.reading.storyEdit.marking.annotationsTitle}</h4>
                {annotations.length > 0 ? (
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
                                            aria-label={messages.reading.storyEdit.marking.annotationBody}
                                            value={editingAnnotationBody}
                                            onChange={(event) => setEditingAnnotationBody(event.target.value)}
                                            disabled={busy}
                                        />
                                        <Input
                                            aria-label={messages.reading.storyEdit.marking.annotationQuote}
                                            value={editingAnnotationQuote}
                                            onChange={(event) => setEditingAnnotationQuote(event.target.value)}
                                            disabled={busy}
                                            placeholder={messages.reading.storyEdit.marking.annotationQuotePlaceholder}
                                        />
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={busy || !editingAnnotationBody.trim()}
                                                onClick={() => void updateAnnotation(annotation.id)}
                                            >
                                                {messages.reading.storyEdit.marking.annotationSave}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={busy}
                                                onClick={cancelEditAnnotation}
                                            >
                                                {messages.reading.storyEdit.marking.annotationCancel}
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
                                            {annotation.actor ?? messages.reading.storyEdit.marking.annotationUnsigned} ·{" "}
                                            {new Date(annotation.createdAt).toLocaleString()}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={busy}
                                                onClick={() => startEditAnnotation(annotation)}
                                            >
                                                {messages.reading.storyEdit.marking.annotationEdit}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={busy}
                                                onClick={() => void submitDeleteAnnotation(annotation.id)}
                                            >
                                                {messages.reading.storyEdit.marking.annotationDelete}
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {messages.reading.storyEdit.marking.annotationsEmpty}
                    </p>
                )}
                <div className="grid gap-2">
                    <Textarea
                        aria-label={messages.reading.storyEdit.marking.annotationNewBody}
                        value={newAnnotationBody}
                        onChange={(event) => setNewAnnotationBody(event.target.value)}
                        disabled={busy}
                        placeholder={messages.reading.storyEdit.marking.annotationNewBodyPlaceholder}
                    />
                    <Input
                        aria-label={messages.reading.storyEdit.marking.annotationNewQuote}
                        value={newAnnotationQuote}
                        onChange={(event) => setNewAnnotationQuote(event.target.value)}
                        disabled={busy}
                        placeholder={messages.reading.storyEdit.marking.annotationQuotePlaceholder}
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        disabled={busy || !newAnnotationBody.trim()}
                        onClick={() => void createAnnotation()}
                    >
                        {messages.reading.storyEdit.marking.annotationAdd}
                    </Button>
                </div>
            </div>
        </section>
    );
}
