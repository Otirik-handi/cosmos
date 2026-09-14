import type {
    Annotation,
    CollectionSummary,
    LabelRef,
    StoryDetail,
} from "@cosmos/contracts";
import { type Dispatch, type FormEventHandler, type SetStateAction } from "react";
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
    newCollectionName: string;
    newLabelName: string;
    onAttachLabel?: (labelId: string) => Promise<void>;
    onCreateAnnotation?: (input: { body: string; quote?: string | null }) => Promise<void>;
    onCreateCollection?: (name: string) => Promise<void>;
    onCreateLabel?: (name: string) => Promise<void>;
    onDeleteAnnotation?: (annotationId: string) => Promise<void>;
    onDetachLabel?: (labelId: string) => Promise<void>;
    onPinToBoard?: () => Promise<void>;
    onToggleCollection?: (collectionId: string, member: boolean) => Promise<void>;
    onToggleFavorite?: (favorited: boolean) => Promise<void>;
    onUpdateAnnotation?: (annotationId: string, input: { body: string; quote?: string | null }) => Promise<void>;
    setAttachLabelId: Dispatch<SetStateAction<string>>;
    setEditingAnnotationBody: Dispatch<SetStateAction<string>>;
    setEditingAnnotationQuote: Dispatch<SetStateAction<string>>;
    setNewAnnotationBody: Dispatch<SetStateAction<string>>;
    setNewAnnotationQuote: Dispatch<SetStateAction<string>>;
    setNewCollectionName: Dispatch<SetStateAction<string>>;
    setNewLabelName: Dispatch<SetStateAction<string>>;
    startEditAnnotation: (annotation: Annotation) => void;
    story: StoryDetail;
    submitAttachLabel: () => Promise<void>;
    submitCreateAnnotation: () => Promise<void>;
    submitCreateCollection: () => Promise<void>;
    submitCreateLabel: () => Promise<void>;
    submitDeleteAnnotation: (annotationId: string) => Promise<void>;
    submitDetachLabel: (labelId: string) => Promise<void>;
    submitPinToBoard: () => Promise<void>;
    submitToggleCollection: (collectionId: string, member: boolean) => Promise<void>;
    submitToggleFavorite: () => Promise<void>;
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
    newCollectionName,
    newLabelName,
    onAttachLabel,
    onCreateAnnotation,
    onCreateCollection,
    onCreateLabel,
    onDeleteAnnotation,
    onDetachLabel,
    onPinToBoard,
    onToggleCollection,
    onToggleFavorite,
    onUpdateAnnotation,
    setAttachLabelId,
    setEditingAnnotationBody,
    setEditingAnnotationQuote,
    setNewAnnotationBody,
    setNewAnnotationQuote,
    setNewCollectionName,
    setNewLabelName,
    startEditAnnotation,
    story,
    submitAttachLabel,
    submitCreateAnnotation,
    submitCreateCollection,
    submitCreateLabel,
    submitDeleteAnnotation,
    submitDetachLabel,
    submitPinToBoard,
    submitToggleCollection,
    submitToggleFavorite,
    submitUpdateAnnotation,
}: Props) {
    return (
        <>
            {(onToggleFavorite
                || onAttachLabel
                || onDetachLabel
                || onCreateLabel
                || onToggleCollection
                || onCreateCollection
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
                                在当前看板的 Spotlight 区块展示本条 Story。
                            </span>
                        </div>
                    )}
                    {onToggleFavorite && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                data-testid="story-favorite-toggle"
                                onClick={() => void submitToggleFavorite()}
                            >
                                {story.favorited ? "★ 取消收藏" : "☆ 收藏"}
                            </Button>
                            <span className="text-sm text-muted-foreground">
                                {story.favorited
                                    ? "已收藏本条 Story，可在收藏列表快速找回。"
                                    : "收藏后可在收藏列表快速找回本条 Story。"}
                            </span>
                        </div>
                    )}
                    {(onAttachLabel || onDetachLabel || onCreateLabel) && (
                        <div className="grid gap-3">
                            <h4 className="text-sm font-medium">标签</h4>
                            {story.labels.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    本条 Story 还没有标签；可从已有标签添加或新建一个。
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
                            {onCreateLabel && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <Input
                                        id="cosmos-story-new-label-name"
                                        value={newLabelName}
                                        onChange={(event) => setNewLabelName(event.target.value)}
                                        disabled={busy}
                                        placeholder="新标签名称"
                                        className="max-w-52"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy || !newLabelName.trim()}
                                        onClick={() => void submitCreateLabel()}
                                    >
                                        创建并添加
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                    {(onToggleCollection || onCreateCollection) && (
                        <div className="grid gap-3">
                            <h4 className="text-sm font-medium">收藏夹</h4>
                            {onToggleCollection && (
                                collections && collections.length > 0
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
                                            还没有收藏夹；可新建一个后把本条 Story 收纳进去。
                                        </p>
                                    )
                            )}
                            {onCreateCollection && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <Input
                                        id="cosmos-story-new-collection-name"
                                        value={newCollectionName}
                                        onChange={(event) => setNewCollectionName(event.target.value)}
                                        disabled={busy}
                                        placeholder="新收藏夹名称"
                                        className="max-w-52"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy || !newCollectionName.trim()}
                                        onClick={() => void submitCreateCollection()}
                                    >
                                        新建收藏夹
                                    </Button>
                                </div>
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
