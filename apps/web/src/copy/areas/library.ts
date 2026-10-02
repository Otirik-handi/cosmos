/**
 * 信息库（`/library`）文案：检索工作台之外，页面自己持有的部分是已保存视图的保存与删除。
 */
export const library = {
    savedViews: {
        heading: "已保存视图",
        empty: "尚未保存视图",
        countLabel: (count: number) => `${count} 个视图`,
        nameLabel: "视图名称",
        save: "保存当前条件",
        remove: "删除",
        removeLabel: (name: string) => `删除视图 ${name}`,
    },
    /** 检索提交后的回执；条件为空时说明已回到全量内容。 */
    resultNotice: (count: number) => `搜索到 ${count} 条结果。`,
} as const;
