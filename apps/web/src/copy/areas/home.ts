/**
 * 首页看板文案：看板切换与新建看板。
 *
 * 「采集计划」是 `Source` 计划的产品名（术语表：不叫「来源健康」）；看板区块的 `type` 键仍叫
 * `source-health`（已持久化，改名要迁移），只有标签在 `board-view/shared.ts`。
 * 来源与计划的**创建**入口不在首页——只在 `/automation`（ADR-0029 决策 1）。
 */
export const home = {
    boardLabel: "看板",
    switchBoard: "切换看板",
    editBoard: "编辑看板",
    finishEditing: "完成编辑",
    newBoardName: "新看板名称",
    createBoard: "新建看板",
} as const;
