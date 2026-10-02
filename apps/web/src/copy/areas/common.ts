/**
 * 跨页面重复出现的文案：加载态、通用动作、对象类型名与单位后缀。
 *
 * 术语表（`ui-copy-review-v1` B/C 组）：`Story`、`Entity` 保留英文；
 * `Entry`→信息条目、`Topic`→话题、`Revision`→版本、`kind`/`subtype`→类型/细分类型。
 * 「内容」在这里指一条 Story（用户读的东西），不是导航分区「内容」组。
 */
export const common = {
    loading: "正在读取…",
    refresh: "刷新",
    /** 组织动作作用的三种对象：Story 显示为「内容」，Entry 显示为「条目」。 */
    targetType: {
        story: "内容",
        entry: "条目",
        topic: "话题",
    },
    /** 标签 / 收藏夹成员行的计数单位。 */
    itemUnit: "条",
    storyCount: (count: number) => `${count} 条内容`,
} as const;
