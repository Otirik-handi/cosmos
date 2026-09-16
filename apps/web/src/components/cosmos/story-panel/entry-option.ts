import type { EntryListItem } from "@cosmos/contracts";

/**
 * 关键事实出处与证据关系共用的信息条目候选：`isMember` 让界面把本 Story 的条目
 * 排在前面的分组里（ADR-0021 决定 3：默认优先列本 Story 的条目）。
 */
export type StoryEntryOption = Pick<EntryListItem, "id" | "title" | "sourceName"> & {
    isMember: boolean;
};
