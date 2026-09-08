"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEventHandler } from "react";

import type {
    EntityDetail,
    EntityRelation,
    EntityRelationType,
    EntitySummary,
    UpdateEntityCommand,
} from "@cosmos/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const ENTITY_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
    { value: "person", label: "人物" },
    { value: "organization", label: "组织" },
    { value: "product", label: "产品" },
    { value: "project", label: "项目" },
    { value: "model", label: "模型" },
    { value: "location", label: "地点" },
];

export const RELATION_TYPE_OPTIONS: readonly {
    value: EntityRelationType;
    label: string;
}[] = [
    { value: "founded", label: "创立" },
    { value: "works_at", label: "任职于" },
    { value: "located_in", label: "位于" },
    { value: "produced", label: "产出" },
    { value: "part_of", label: "属于" },
    { value: "related_to", label: "相关" },
];

export function entityTypeLabel(type: string): string {
    return ENTITY_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function relationTypeLabel(type: string): string {
    return RELATION_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

type EntityPanelProps = {
    onClose: () => void;
    entity: EntityDetail;
    entityOptions: readonly EntitySummary[];
    onUpdateEntity: (command: UpdateEntityCommand) => Promise<void>;
    onAddAlias: (name: string) => Promise<void>;
    onRemoveAlias: (name: string) => Promise<void>;
    onUnlinkStory: (storyId: string) => Promise<void>;
    onCreateRelation: (
        toEntityId: string,
        relationType: EntityRelationType,
    ) => Promise<void>;
    onRemoveRelation: (relation: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
    }) => Promise<void>;
};

function RelationRow({
    relation,
    busy,
    onRemove,
}: {
    relation: EntityRelation;
    busy: boolean;
    onRemove: (relation: {
        fromEntityId: string;
        toEntityId: string;
        relationType: string;
    }) => Promise<void>;
}) {
    return (
        <li
            data-entity-relation={relation.relationType}
            className="flex flex-wrap items-center gap-2 border-t py-3 first:border-t-0"
        >
            <Badge variant="secondary">{relationTypeLabel(relation.relationType)}</Badge>
            <span className="min-w-0 flex-1 truncate text-sm">
                {relation.fromEntityId}
                <span className="mx-1 text-muted-foreground">→</span>
                {relation.toEntityId}
            </span>
            {relation.actor && (
                <span className="text-xs text-muted-foreground">· {relation.actor}</span>
            )}
            <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void onRemove(relation)}
            >
                移除
            </Button>
        </li>
    );
}

/**
 * 实体抽屉：展示 Entity 本体（规范名/类型/别名）、关联 Story 与类型化关系，
 * 并就地提供改名/改类型、别名增删、关系维护（ADR-0008）。
 */
export function EntityPanel({
    onClose,
    entity,
    entityOptions,
    onUpdateEntity,
    onAddAlias,
    onRemoveAlias,
    onUnlinkStory,
    onCreateRelation,
    onRemoveRelation,
}: EntityPanelProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    const [name, setName] = useState(entity.entity.name);
    const [type, setType] = useState(entity.entity.type);
    const [aliasName, setAliasName] = useState("");
    const [relationToEntityId, setRelationToEntityId] = useState("");
    const [relationType, setRelationType] = useState<EntityRelationType>("related_to");
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

    const runAction = async (action: () => Promise<void>): Promise<void> => {
        setBusy(true);
        setActionError(null);
        try {
            await action();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Entity 操作失败。");
        } finally {
            setBusy(false);
        }
    };

    const submitEntityUpdate: FormEventHandler = async (event) => {
        event.preventDefault();
        const normalizedName = name.trim();
        if (!normalizedName) {
            return;
        }
        await runAction(async () => {
            await onUpdateEntity({
                baseRevisionId: entity.entity.revisionId,
                name: normalizedName,
                type: type as UpdateEntityCommand["type"],
            });
        });
    };

    const submitAliasAdd: FormEventHandler = async (event) => {
        event.preventDefault();
        const normalizedAlias = aliasName.trim();
        if (!normalizedAlias) {
            return;
        }
        await runAction(async () => {
            await onAddAlias(normalizedAlias);
            setAliasName("");
        });
    };

    const submitRelationCreate = async (): Promise<void> => {
        if (!relationToEntityId) {
            return;
        }
        await runAction(async () => {
            await onCreateRelation(relationToEntityId, relationType);
            setRelationToEntityId("");
        });
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-background/70"
            onClick={onClose}
        >
            <div
                aria-labelledby="cosmos-entity-title"
                aria-modal="true"
                role="dialog"
                className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[var(--radius-panel)] border bg-card shadow-[var(--elevation-dialog)] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:max-w-xl sm:rounded-r-none sm:rounded-bl-[var(--radius-panel)]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
                    <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Entity 详情
                        </p>
                        <h2
                            id="cosmos-entity-title"
                            className="font-display text-2xl font-semibold leading-snug tracking-tight"
                        >
                            {entity.entity.name}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {entityTypeLabel(entity.entity.type)} · {entity.entity.id}
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
                    {entity.aliases.length > 0 && (
                        <section aria-label="名称别名" className="border-b pb-4">
                            <h3 className="font-medium">名称别名</h3>
                            <ul className="mt-2 flex flex-wrap gap-2">
                                {entity.aliases.map((alias) => (
                                    <li key={alias} className="flex items-center gap-1">
                                        <Badge variant="outline">{alias}</Badge>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy}
                                            aria-label={`移除别名 ${alias}`}
                                            onClick={() => {
                                                void runAction(() => onRemoveAlias(alias));
                                            }}
                                        >
                                            移除
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <section aria-label="关联 Story" className="border-b pb-4">
                        <h3 className="font-medium">
                            关联 Story（{entity.stories.length}）
                        </h3>
                        {entity.stories.length > 0 ? (
                            <ul className="mt-2 flex flex-col">
                                {entity.stories.map((link) => (
                                    <li
                                        key={link.storyId}
                                        data-entity-story-id={link.storyId}
                                        className="flex flex-wrap items-center gap-2 border-t py-3 first:border-t-0"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-sm">
                                            {link.storyId}
                                        </span>
                                        {link.actor && (
                                            <span className="text-xs text-muted-foreground">
                                                · {link.actor}
                                            </span>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy}
                                            onClick={() => {
                                                void runAction(() => onUnlinkStory(link.storyId));
                                            }}
                                        >
                                            解除关联
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-sm text-muted-foreground">
                                尚未关联任何 Story。
                            </p>
                        )}
                    </section>
                    <section aria-label="类型化关系" className="border-b pb-4">
                        <h3 className="font-medium">
                            关系（{entity.relations.length}）
                        </h3>
                        {entity.relations.length > 0 ? (
                            <ul className="mt-2 flex flex-col">
                                {entity.relations.map((relation) => (
                                    <RelationRow
                                        key={`${relation.fromEntityId}${relation.relationType}${relation.toEntityId}`}
                                        relation={relation}
                                        busy={busy}
                                        onRemove={onRemoveRelation}
                                    />
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-sm text-muted-foreground">
                                尚未建立关系。
                            </p>
                        )}
                    </section>
                    <section
                        aria-label="Entity 操作"
                        className="grid gap-4 border-t pt-4"
                    >
                        <form className="grid gap-3" onSubmit={submitEntityUpdate}>
                            <label
                                htmlFor="cosmos-entity-name-edit"
                                className="text-sm font-medium"
                            >
                                规范名
                            </label>
                            <Input
                                id="cosmos-entity-name-edit"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                disabled={busy}
                            />
                            <label
                                htmlFor="cosmos-entity-type-edit"
                                className="text-sm font-medium"
                            >
                                类型
                            </label>
                            <select
                                id="cosmos-entity-type-edit"
                                value={type}
                                disabled={busy}
                                className="w-fit rounded-sm border bg-card px-2 py-1 text-sm"
                                onChange={(event) => setType(event.target.value)}
                            >
                                {ENTITY_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <Button
                                type="submit"
                                disabled={busy}
                                variant="outline"
                                className="w-fit"
                            >
                                更新名称与类型
                            </Button>
                        </form>
                        <form className="flex flex-wrap items-end gap-2" onSubmit={submitAliasAdd}>
                            <Input
                                id="cosmos-entity-alias-name"
                                value={aliasName}
                                onChange={(event) => setAliasName(event.target.value)}
                                disabled={busy}
                                placeholder="新增名称别名"
                                className="max-w-xs"
                            />
                            <Button
                                type="submit"
                                variant="outline"
                                disabled={busy || !aliasName.trim()}
                            >
                                添加别名
                            </Button>
                        </form>
                        <div className="flex flex-wrap items-end gap-2">
                            <select
                                aria-label="关系目标 Entity"
                                value={relationToEntityId}
                                disabled={busy}
                                className="rounded-sm border bg-card px-2 py-1 text-sm"
                                onChange={(event) => setRelationToEntityId(event.target.value)}
                            >
                                <option value="">选择关系目标…</option>
                                {entityOptions.map((option) => (
                                    <option
                                        key={option.id}
                                        value={option.id}
                                        disabled={option.id === entity.entity.id}
                                    >
                                        {option.name}
                                    </option>
                                ))}
                            </select>
                            <select
                                aria-label="关系类型"
                                value={relationType}
                                disabled={busy}
                                className="rounded-sm border bg-card px-2 py-1 text-sm"
                                onChange={(event) => {
                                    setRelationType(event.target.value as EntityRelationType);
                                }}
                            >
                                {RELATION_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <Button
                                variant="outline"
                                disabled={busy || !relationToEntityId}
                                onClick={() => void submitRelationCreate()}
                            >
                                添加关系
                            </Button>
                        </div>
                        {actionError && (
                            <p
                                role="alert"
                                className="text-sm text-destructive"
                                data-entity-action-error="true"
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
