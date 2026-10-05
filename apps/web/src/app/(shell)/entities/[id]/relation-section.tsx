"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { EntityRelation, EntityRelationType } from "@cosmos/contracts";

import { RELATION_TYPE_OPTIONS, relationTypeLabel } from "@/components/cosmos/entity-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { messages } from "@/copy/messages";

import { DetailMessage, DetailSection } from "./detail-section";

type RelationSectionProps = {
    /** 当前 Entity：用来判断关系行里哪一端是对端。 */
    selfId: string;
    relations: readonly EntityRelation[];
    /** 可以作为关系目标的其它 Entity；为空时不显示添加表单。 */
    candidates: readonly { id: string; name: string }[];
    /** 把 id 翻成名称；关系合同只有 id，界面**不显示 id**（判据 R3）。 */
    nameOf: (entityId: string) => string;
    busy: boolean;
    onCreate: (toEntityId: string, relationType: EntityRelationType) => Promise<boolean>;
    onRemove: (relation: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
    }) => Promise<boolean>;
};

/** 关系：本 Entity 与另一个 Entity 之间的一条类型化关系，两个方向都列出来。 */
export function RelationSection({
    selfId,
    relations,
    candidates,
    nameOf,
    busy,
    onCreate,
    onRemove,
}: RelationSectionProps) {
    const [targetId, setTargetId] = useState("");
    const [relationType, setRelationType] = useState<EntityRelationType>("related_to");

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (targetId === "" || busy) {
            return;
        }
        if (await onCreate(targetId, relationType)) {
            setTargetId("");
        }
    };

    return (
        <DetailSection
            count={relations.length === 0 ? null : messages.pages.entities.relationCount(relations.length)}
            title={messages.pages.entities.detail.relationTitle}
        >
            {candidates.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                    {messages.pages.entities.detail.relationNoCandidates}
                </p>
            ) : (
                <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => void submit(event)}>
                    <label className="text-[13px] text-muted-foreground" htmlFor="entity-relation-target">
                        {messages.pages.entities.detail.relationTarget}
                    </label>
                    <select
                        className="h-8 rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
                        disabled={busy}
                        id="entity-relation-target"
                        onChange={(event) => setTargetId(event.target.value)}
                        value={targetId}
                    >
                        <option value="">{messages.pages.entities.detail.relationTargetEmpty}</option>
                        {candidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                                {candidate.name}
                            </option>
                        ))}
                    </select>
                    <label className="text-[13px] text-muted-foreground" htmlFor="entity-relation-type">
                        {messages.pages.entities.detail.relationType}
                    </label>
                    <select
                        className="h-8 rounded-[var(--radius-control)] border border-input bg-card px-2 text-[13px]"
                        disabled={busy}
                        id="entity-relation-type"
                        onChange={(event) => {
                            setRelationType(event.target.value as EntityRelationType);
                        }}
                        value={relationType}
                    >
                        {RELATION_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <Button disabled={busy || targetId === ""} size="sm" type="submit" variant="outline">
                        <Plus data-icon="inline-start" />
                        {messages.pages.entities.detail.relationCreate}
                    </Button>
                </form>
            )}

            {relations.length === 0 ? (
                <DetailMessage>{messages.pages.entities.detail.relationEmpty}</DetailMessage>
            ) : (
                <ul className="flex flex-col">
                    {relations.map((relation) => (
                        <RelationRow
                            busy={busy}
                            key={`${relation.fromEntityId}|${relation.relationType}|${relation.toEntityId}`}
                            nameOf={nameOf}
                            onRemove={onRemove}
                            relation={relation}
                            selfId={selfId}
                        />
                    ))}
                </ul>
            )}
        </DetailSection>
    );
}

function RelationRow({
    relation,
    selfId,
    nameOf,
    busy,
    onRemove,
}: {
    relation: EntityRelation;
    selfId: string;
    nameOf: (entityId: string) => string;
    busy: boolean;
    onRemove: RelationSectionProps["onRemove"];
}) {
    const counterpartId = relation.fromEntityId === selfId ? relation.toEntityId : relation.fromEntityId;
    const counterpartName = nameOf(counterpartId);

    return (
        <li className="flex flex-wrap items-center gap-2 border-b border-border py-3 last:border-b-0">
            <Badge variant="secondary">{relationTypeLabel(relation.relationType)}</Badge>
            <span className="min-w-0 flex-1 truncate text-[14px]">
                {nameOf(relation.fromEntityId)}
                <span aria-hidden className="mx-1 text-muted-foreground">
                    →
                </span>
                <span className="sr-only">{messages.pages.entities.detail.relationDirection}</span>
                {nameOf(relation.toEntityId)}
            </span>
            <Button
                aria-label={messages.pages.entities.detail.relationRemove(counterpartName)}
                disabled={busy}
                onClick={() => void onRemove(relation)}
                size="sm"
                variant="ghost"
            >
                <Trash2 aria-hidden className="size-3.5" strokeWidth={1.75} />
                {messages.pages.entities.detail.relationRemoveAction}
            </Button>
        </li>
    );
}
