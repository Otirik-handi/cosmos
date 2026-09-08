"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEventHandler } from "react";

import type {
    TopicDetail,
    TopicMember,
    TopicMemberRole,
    UpdateTopicCommand,
} from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TopicPanelProps = {
    onClose: () => void;
    topic: TopicDetail;
    onUpdateTopic: (command: UpdateTopicCommand) => Promise<void>;
    onUpdateMemberRole: (storyId: string, role: TopicMemberRole) => Promise<void>;
    onRemoveMember: (storyId: string) => Promise<void>;
    onRestoreMember: (storyId: string, role: TopicMemberRole) => Promise<void>;
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
}: TopicPanelProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    const [title, setTitle] = useState(topic.topic.title);
    const [purpose, setPurpose] = useState(topic.topic.purpose);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

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
                </div>
            </div>
        </div>
    );
}
