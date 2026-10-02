import type { ReactNode } from "react";
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

/** 分隔用色块而不是细线，与全站的分隔语言一致。 */
const SECTION_CLASS = "flex flex-col gap-3";

/** 成员行的来源标记；没有 producer 信息时不显示，不猜。 */
function producerMarker(producer: string | null | undefined): ReactNode {
    if (producer === "system" || producer === "agent") {
        return (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-marker-soft px-1.5 py-px text-[11px] leading-4 text-marker">
                <span aria-hidden className="size-1.5 rounded-full bg-marker" />
                {producer === "agent" ? "Agent 产生" : "系统创建"}
            </span>
        );
    }
    if (producer === "human") {
        return <span className="text-[11px] text-muted-foreground">人工编辑过</span>;
    }
    return null;
}

type Props = {
    story: StoryDetail;
    busy: boolean;
    /**
     * 每条成员条目所属 Story 的当前 Revision 写入者，按 entryId 索引。
     * 阅读页用它区分「系统抓来的」与「人工写过的」（ADR-0028）；来源面板不传就不显示标记。
     */
    producers?: Readonly<Record<string, string | null>>;
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
    producers,
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
            <section aria-label="来源成员" className={SECTION_CLASS}>
                <h3 className="font-medium">
                    来源成员（{story.entries.length}）
                </h3>
                {story.entries.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                        {story.entries.map((member) => (
                            <li
                                key={member.id}
                                data-story-member-id={member.id}
                                className="flex flex-col rounded-[var(--radius-card)] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] px-3 py-2"
                            >
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-medium text-foreground">
                                        {member.revisions[0]?.title ?? "无标题"}
                                    </span>
                                    <span className="text-xs">{member.sourceName}</span>
                                    {/* 来源标记（ADR-0028）：系统/Agent 抓来的与人工写过的分开，
                                        否则读的人分不清这条内容还会不会被自动更新覆盖。 */}
                                    {producerMarker(producers?.[member.id])}
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
