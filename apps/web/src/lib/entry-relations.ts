import type { EntryListItem, EntryRelation, EntryRelationType } from "@cosmos/contracts";

/**
 * 写命令下拉的顺序与信息模型 §4.2 的词表一致（ADR-0022 决定 1）。
 */
export const ENTRY_RELATION_TYPE_OPTIONS: readonly EntryRelationType[] = [
    "duplicate_of",
    "syndicated_from",
    "near_duplicate_of",
];

export const ENTRY_RELATION_TYPE_LABELS: Record<string, string> = {
    duplicate_of: "完全重复",
    syndicated_from: "转载",
    near_duplicate_of: "近似重复",
};

export function entryRelationTypeLabel(type: string): string {
    return ENTRY_RELATION_TYPE_LABELS[type] ?? type;
}

/** 可作对端的已加载条目；同 Story 的成员也是合法对端（ADR-0022 决定 4）。 */
export type EntryRelationCandidate = Pick<EntryListItem, "id" | "title" | "sourceName">;

/** 对端条目的显示名：读侧标题可能为空（条目没有当前 Revision）。 */
export function entryRelationCounterpart(relation: Pick<EntryRelation, "entryId" | "title">): string {
    return relation.title ?? relation.entryId;
}

/**
 * 一句话关系说明，按「读到的这一侧」措辞：有向关系在转载方说「转载自」，
 * 在原发方说「被…转载」；对称关系两侧同词（ADR-0022 决定 3/7）。
 * 未知类型是读侧降级数据，显示原文而不猜方向语义。
 */
export function entryRelationText(
    relation: Pick<EntryRelation, "relationType" | "direction">,
    counterpart: string,
): string {
    switch (relation.relationType) {
        case "duplicate_of":
            return `重复于 ${counterpart}`;
        case "near_duplicate_of":
            return `近似于 ${counterpart}`;
        case "syndicated_from":
            return relation.direction === "incoming"
                ? `被 ${counterpart} 转载`
                : `转载自 ${counterpart}`;
        default:
            return `${relation.relationType}：${counterpart}`;
    }
}

export type EntryRelationDraft = {
    entryId: string;
    relationType: EntryRelationType;
};

export const EMPTY_ENTRY_RELATION_DRAFT: EntryRelationDraft = {
    entryId: "",
    relationType: "duplicate_of",
};

/**
 * 对端候选：排除自己，排除已经挂着关系的条目——重复标记同一对是覆盖写，
 * 但列表里再出现一次只会让人以为要新增第二条。
 */
export function entryRelationCandidates(
    candidates: readonly EntryRelationCandidate[],
    selfEntryId: string,
    relations: readonly Pick<EntryRelation, "entryId">[],
): readonly EntryRelationCandidate[] {
    const excluded = new Set([selfEntryId, ...relations.map((relation) => relation.entryId)]);
    return candidates.filter((candidate) => !excluded.has(candidate.id));
}
