/**
 * Story 阅读页（`/stories/:id`）文案。
 *
 * 只读卡片与「读完动作」在这里；编辑与关联面的文案（改标题、归并、拆分、打标签…）
 * 随 `story-edit-surface` 一起在组件级批次迁移，见 Task 35 的 Follow-ups。
 */
export const reading = {
    loading: "正在读取…",
    missingTitle: "这条内容读不到了",
    missingBody: "它可能已被合并到另一条内容里。",
    backToBoard: "回到看板",
    splitBadge: "已被拆分",
    readOriginal: "读原文",
    actionsLabel: "读完动作",
    sourceAndEditLabel: "来源与编辑",
    favorite: "收藏",
    favorited: "已收藏",
    pinnedNotice: "已固定到看板热点区。",
    /** ADR-0029 决策 7：正在编辑时不覆盖，让用户决定什么时候读新内容。 */
    staleStory: "这条内容在别处有了新变化。你正在编辑的内容没有被改动。",
    reloadStory: "重新读取",
} as const;
