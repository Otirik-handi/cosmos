import { useState } from "react";

import type { EntryRelation, EntryRelationType, StoryDetail } from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    EMPTY_ENTRY_RELATION_DRAFT,
    ENTRY_RELATION_TYPE_OPTIONS,
    entryRelationCandidates,
    entryRelationCounterpart,
    entryRelationText,
    entryRelationTypeLabel,
    type EntryRelationCandidate,
    type EntryRelationDraft,
} from "@/lib/entry-relations";

import { relationTypeLabel } from "./labels";

type Props = {
    story: StoryDetail;
    busy: boolean;
    /** 可作对端的已加载条目；同 Story 的成员也是合法对端（ADR-0022 决定 4）。 */
    candidates?: readonly EntryRelationCandidate[];
    onLinkEntryRelation?: (input: {
        fromEntryId: string;
        toEntryId: string;
        relationType: EntryRelationType;
    }) => Promise<void>;
    onUnlinkEntryRelation?: (input: {
        fromEntryId: string;
        toEntryId: string;
    }) => Promise<void>;
};

/**
 * 来源成员列表。每行是一个 EntryDetail，重复/转载标注与标记入口都落在这一行
 * 上：v1 没有独立的条目详情页，成员行就是条目关系的可见落点（ADR-0022 决定 7）。
 */
export function SourceMembersSection({
    story,
    busy,
    candidates = [],
    onLinkEntryRelation,
    onUnlinkEntryRelation,
}: Props) {
    const [openEntryId, setOpenEntryId] = useState<string | null>(null);
    const [draft, setDraft] = useState<EntryRelationDraft>(EMPTY_ENTRY_RELATION_DRAFT);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    // 表单状态留在本组件内：面板只提供两条写命令，不再多传一组 draft 回调。
    const disabled = busy || pending;

    const closeDraft = (): void => {
        setOpenEntryId(null);
        setDraft(EMPTY_ENTRY_RELATION_DRAFT);
    };

    const submitLink = async (fromEntryId: string): Promise<void> => {
        if (!onLinkEntryRelation || !draft.entryId) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            await onLinkEntryRelation({
                fromEntryId,
                toEntryId: draft.entryId,
                relationType: draft.relationType,
            });
            closeDraft();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "标记重复/转载失败。");
        } finally {
            setPending(false);
        }
    };

    const submitUnlink = async (relation: EntryRelation, fromEntryId: string): Promise<void> => {
        if (!onUnlinkEntryRelation) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            await onUnlinkEntryRelation({ fromEntryId, toEntryId: relation.entryId });
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "解除重复/转载关系失败。");
        } finally {
            setPending(false);
        }
    };

    return (
            <section aria-label="来源成员" className="border-b pb-4">
                <h3 className="font-medium">
                    来源成员（{story.entries.length}）
                </h3>
                {story.entries.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                        {story.entries.map((member) => (
                            <li
                                key={member.id}
                                data-story-member-id={member.id}
                                className="flex flex-col"
                            >
                                <span className="truncate">
                                    {member.sourceName} ·{" "}
                                    {member.revisions[0]?.title ?? "无标题"} ·{" "}
                                    {member.id}
                                </span>
                                {member.relatedStories.length > 0 && (
                                    <span
                                        className="truncate text-xs"
                                        data-story-member-links={member.id}
                                    >
                                        作为{member.relatedStories
                                            .map((related) => relationTypeLabel(related.relationType))
                                            .join("、")}
                                        关联到：
                                        {member.relatedStories
                                            .map((related) => related.title)
                                            .join("、")}
                                    </span>
                                )}
                                {member.relations.length > 0 && (
                                    <span
                                        className="flex flex-wrap items-center gap-1 text-xs"
                                        data-story-member-relations={member.id}
                                    >
                                        {member.relations.map((relation) => (
                                            <Badge
                                                key={`${relation.entryId}:${relation.relationType}`}
                                                variant="secondary"
                                                data-entry-relation-badge={`${member.id}:${relation.entryId}`}
                                            >
                                                {entryRelationText(relation, entryRelationCounterpart(relation))}
                                            </Badge>
                                        ))}
                                    </span>
                                )}
                                {onUnlinkEntryRelation && member.relations.map((relation) => (
                                    <span
                                        key={`${relation.entryId}:${relation.relationType}:actions`}
                                        className="flex flex-wrap items-center gap-2 text-xs"
                                    >
                                        <span className="truncate">
                                            {entryRelationTypeLabel(relation.relationType)}
                                            {" · "}
                                            {relation.sourceName}
                                            {relation.reason ? ` · ${relation.reason}` : ""}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-auto px-1 py-0 text-xs"
                                            disabled={disabled}
                                            data-entry-relation-remove={`${member.id}:${relation.entryId}`}
                                            onClick={() => void submitUnlink(relation, member.id)}
                                        >
                                            解除
                                        </Button>
                                    </span>
                                ))}
                                {onLinkEntryRelation && openEntryId !== member.id && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="mt-1 w-fit"
                                        disabled={disabled}
                                        data-entry-relation-open={member.id}
                                        onClick={() => {
                                            setOpenEntryId(member.id);
                                            setDraft(EMPTY_ENTRY_RELATION_DRAFT);
                                        }}
                                    >
                                        标记重复 / 转载
                                    </Button>
                                )}
                                {onLinkEntryRelation && openEntryId === member.id && (
                                    <div
                                        className="mt-1 flex flex-wrap items-center gap-2"
                                        data-entry-relation-form={member.id}
                                    >
                                        <select
                                            aria-label="选择对端条目"
                                            value={draft.entryId}
                                            disabled={disabled}
                                            className="max-w-xs rounded-sm border bg-card px-2 py-1 text-sm"
                                            onChange={(event) => setDraft({
                                                ...draft,
                                                entryId: event.target.value,
                                            })}
                                        >
                                            <option value="">选择对端条目…</option>
                                            {entryRelationCandidates(candidates, member.id, member.relations)
                                                .map((candidate) => (
                                                    <option key={candidate.id} value={candidate.id}>
                                                        {candidate.sourceName} · {candidate.title}
                                                    </option>
                                                ))}
                                        </select>
                                        <select
                                            aria-label="重复关系类型"
                                            value={draft.relationType}
                                            disabled={disabled}
                                            className="rounded-sm border bg-card px-2 py-1 text-sm"
                                            onChange={(event) => setDraft({
                                                ...draft,
                                                relationType: event.target.value as EntryRelationType,
                                            })}
                                        >
                                            {ENTRY_RELATION_TYPE_OPTIONS.map((type) => (
                                                <option key={type} value={type}>
                                                    {entryRelationTypeLabel(type)}
                                                </option>
                                            ))}
                                        </select>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={disabled || !draft.entryId}
                                            data-entry-relation-submit={member.id}
                                            onClick={() => void submitLink(member.id)}
                                        >
                                            标记
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={disabled}
                                            onClick={closeDraft}
                                        >
                                            取消
                                        </Button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {error && (
                    <p
                        className="mt-2 text-xs text-destructive"
                        role="alert"
                        data-entry-relation-error="true"
                    >
                        {error}
                    </p>
                )}
            </section>
    );
}
