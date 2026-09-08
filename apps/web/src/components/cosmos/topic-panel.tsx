"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEventHandler } from "react";

import type {
    Annotation,
    TopicDetail,
    TopicMember,
    TopicMemberRole,
    UpdateTopicCommand,
} from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TopicPanelProps = {
    onClose: () => void;
    topic: TopicDetail;
    onUpdateTopic: (command: UpdateTopicCommand) => Promise<void>;
    onUpdateMemberRole: (storyId: string, role: TopicMemberRole) => Promise<void>;
    onRemoveMember: (storyId: string) => Promise<void>;
    onRestoreMember: (storyId: string, role: TopicMemberRole) => Promise<void>;
    annotations?: readonly Annotation[];
    onCreateAnnotation?: (input: { body: string; quote?: string | null }) => Promise<void>;
    onUpdateAnnotation?: (
        annotationId: string,
        input: { body: string; quote?: string | null },
    ) => Promise<void>;
    onDeleteAnnotation?: (annotationId: string) => Promise<void>;
};

export const ROLE_OPTIONS: readonly { value: TopicMemberRole; label: string }[] = [
    { value: "core", label: "核心" },
    { value: "update", label: "进展" },
    { value: "background", label: "背景" },
    { value: "analysis", label: "分析" },
    { value: "counterpoint", label: "反方" },
    { value: "tutorial", label: "教程" },
];

function roleLabel(role: string): string {
    return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function MemberRow({
    member,
    busy,
    onUpdateRole,
    onRemove,
    onRestore,
}: {
    member: TopicMember;
    busy: boolean;
    onUpdateRole: (storyId: string, role: TopicMemberRole) => Promise<void>;
    onRemove: (storyId: string) => Promise<void>;
    onRestore: (storyId: string, role: TopicMemberRole) => Promise<void>;
}) {
    return (
        <li
            data-topic-member-story-id={member.storyId}
            className="flex flex-wrap items-center gap-2 border-t py-3 first:border-t-0"
        >
            <Badge variant={member.removed ? "outline" : "secondary"}>
                {roleLabel(member.role)}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {member.storyId}
            </span>
            {member.reason && (
                <span className="text-xs text-muted-foreground">{member.reason}</span>
            )}
            {member.actor && (
                <span className="text-xs text-muted-foreground">· {member.actor}</span>
            )}
            {member.removed ? (
                <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onRestore(member.storyId, member.role as TopicMemberRole)}
                >
                    恢复
                </Button>
            ) : (
                <>
                    <select
                        aria-label={`修改 ${member.storyId} 的角色`}
                        value={member.role}
                        disabled={busy}
                        className="rounded-sm border bg-card px-2 py-1 text-sm"
                        onChange={(event) => {
                            void onUpdateRole(member.storyId, event.target.value as TopicMemberRole);
                        }}
                    >
                        {ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void onRemove(member.storyId)}
                    >
                        移除
                    </Button>
                </>
            )}
        </li>
    );
}

export function TopicPanel({
    onClose,
    topic,
    onUpdateTopic,
    onUpdateMemberRole,
    onRemoveMember,
    onRestoreMember,
    annotations,
    onCreateAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
}: TopicPanelProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    const [title, setTitle] = useState(topic.topic.title);
    const [purpose, setPurpose] = useState(topic.topic.purpose);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [newAnnotationBody, setNewAnnotationBody] = useState("");
    const [newAnnotationQuote, setNewAnnotationQuote] = useState("");
    const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
    const [editingAnnotationBody, setEditingAnnotationBody] = useState("");
    const [editingAnnotationQuote, setEditingAnnotationQuote] = useState("");

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onCloseRef.current();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            previousFocus?.focus();
        };
    }, []);

    const submitTopicUpdate: FormEventHandler = async (event) => {
        event.preventDefault();
        const normalizedTitle = title.trim();
        const normalizedPurpose = purpose.trim();
        if (!normalizedTitle || !normalizedPurpose) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onUpdateTopic({
                baseRevisionId: topic.topic.revisionId,
                title: normalizedTitle,
                purpose: normalizedPurpose,
                scope: topic.topic.scope,
            });
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Topic 操作失败。");
        } finally {
            setBusy(false);
        }
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

    const submitCreateAnnotation = async (): Promise<void> => {
        if (!onCreateAnnotation) {
            return;
        }
        const normalizedBody = newAnnotationBody.trim();
        if (!normalizedBody) {
            return;
        }
        const normalizedQuote = newAnnotationQuote.trim();
        setBusy(true);
        setActionError(null);
        try {
            await onCreateAnnotation({
                body: normalizedBody,
                quote: normalizedQuote || null,
            });
            setNewAnnotationBody("");
            setNewAnnotationQuote("");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "添加批注失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitUpdateAnnotation = async (annotationId: string): Promise<void> => {
        if (!onUpdateAnnotation) {
            return;
        }
        const normalizedBody = editingAnnotationBody.trim();
        if (!normalizedBody) {
            return;
        }
        const normalizedQuote = editingAnnotationQuote.trim();
        setBusy(true);
        setActionError(null);
        try {
            await onUpdateAnnotation(annotationId, {
                body: normalizedBody,
                quote: normalizedQuote || null,
            });
            cancelEditAnnotation();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "更新批注失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitDeleteAnnotation = async (annotationId: string): Promise<void> => {
        if (!onDeleteAnnotation) {
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            await onDeleteAnnotation(annotationId);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "删除批注失败。");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-background/70"
            onClick={onClose}
        >
            <div
                aria-labelledby="cosmos-topic-title"
                aria-modal="true"
                role="dialog"
                className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[var(--radius-panel)] border bg-card shadow-[var(--elevation-dialog)] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:max-w-xl sm:rounded-r-none sm:rounded-bl-[var(--radius-panel)]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
                    <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Topic 详情
                        </p>
                        <h2
                            id="cosmos-topic-title"
                            className="font-display text-2xl font-semibold leading-snug tracking-tight"
                        >
                            {topic.topic.title}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {topic.topic.purpose}
                        </p>
                    </div>
                    <Button
                        ref={closeButtonRef}
                        variant="ghost"
                        size="sm"
                        onClick={onClose}
                    >
                        <X data-icon="inline-start" />
                        关闭
                    </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
                    <section aria-label="成员" className="border-b pb-4">
                        <h3 className="font-medium">
                            成员（{topic.members.filter((member) => !member.removed).length}）
                        </h3>
                        {topic.members.length > 0 ? (
                            <ul className="mt-2 flex flex-col">
                                {topic.members.map((member) => (
                                    <MemberRow
                                        key={member.storyId}
                                        member={member}
                                        busy={busy}
                                        onUpdateRole={onUpdateMemberRole}
                                        onRemove={onRemoveMember}
                                        onRestore={onRestoreMember}
                                    />
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-sm text-muted-foreground">
                                尚未加入任何 Story。
                            </p>
                        )}
                    </section>
                    {topic.topic.scope && (
                        <p className="text-sm leading-6 text-muted-foreground">
                            {topic.topic.scope}
                        </p>
                    )}
                    <section
                        aria-label="Topic 操作"
                        className="grid gap-4 border-t pt-4"
                    >
                        <form
                            className="grid gap-3"
                            onSubmit={submitTopicUpdate}
                        >
                            <label
                                htmlFor="cosmos-topic-title-edit"
                                className="text-sm font-medium"
                            >
                                标题
                            </label>
                            <Input
                                id="cosmos-topic-title-edit"
                                value={title}
                                onChange={(event) => setTitle(event.target.value)}
                                disabled={busy}
                            />
                            <label
                                htmlFor="cosmos-topic-purpose-edit"
                                className="text-sm font-medium"
                            >
                                关注目的
                            </label>
                            <Input
                                id="cosmos-topic-purpose-edit"
                                value={purpose}
                                onChange={(event) => setPurpose(event.target.value)}
                                disabled={busy}
                            />
                            <Button
                                type="submit"
                                disabled={busy}
                                variant="outline"
                                className="w-fit"
                            >
                                更新标题与目的
                            </Button>
                        </form>
                        {actionError && (
                            <p
                                role="alert"
                                className="text-sm text-destructive"
                                data-topic-action-error="true"
                            >
                                {actionError}
                            </p>
                        )}
                    </section>
                    {(onCreateAnnotation
                        || onUpdateAnnotation
                        || onDeleteAnnotation) && (
                        <section
                            aria-label="批注"
                            className="grid gap-3 border-t pt-4"
                        >
                            <h3 className="font-medium">批注</h3>
                            {annotations && annotations.length > 0 ? (
                                <ul className="grid gap-3">
                                    {annotations.map((annotation) => (
                                        <li
                                            key={annotation.id}
                                            data-topic-annotation-id={annotation.id}
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
                                    本 Topic 还没有批注；可在下方记录摘录与想法。
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
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
