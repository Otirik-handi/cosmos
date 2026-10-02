/**
 * 列表页文案：话题、Entity、系统产出、设置。
 * 它们的结构相同（标题 + 计数 + 刷新 + 空态 + 各自的创建行），因此放在同一册。
 * 根布局的 `metadata.description` 同样是页面级文案，但没有别的分册可归，一并放在这里。
 */
export const pages = {
    topics: {
        title: "话题",
        emptyCount: "尚未创建话题",
        countLabel: (count: number) => `${count} 个话题`,
        emptyTitle: "还没有话题",
        emptyBody: "话题是为了持续理解某个问题而建立的范围。在这里先建一个；成员从 Story 页加入。",
        newTitle: "新话题标题",
        newPurpose: "关注目的",
        create: "新建话题",
        detailTitle: "话题详情",
        detailPending: "这一页还没建好",
        detailBody: "改标题与关注目的、维护成员（加入、改角色、移除与恢复）会在这里落地。现在可以从列表页回到话题列表。",
        backToList: "回到话题列表",
    },
    entities: {
        title: "Entity",
        emptyCount: "尚未创建 Entity",
        countLabel: (count: number) => `${count} 个 Entity`,
        emptyTitle: "还没有 Entity",
        emptyBody: "Entity 是可被内容关联的实体（人物、组织、产品、项目、模型、地点），Entity 之间也可以有关系。在这里先建一个；与内容的关联在 Story 页做。",
        newName: "新 Entity 名称",
        newType: "Entity 类型",
        create: "新建 Entity",
        relationCount: (count: number) => `${count} 个关系`,
        detailTitle: "Entity 详情",
        detailPending: "这一页还没建好",
        detailBody: "别名、类型化关系与「关联 Story」的解除会在这里落地。现在可以从列表页回到 Entity 列表。",
        backToList: "回到 Entity 列表",
    },
    system: {
        title: "系统产出",
        description: "采集与 Workflow 的运行记录，以及由系统或 Agent 产生的内容",
        runHistory: "运行记录",
    },
    settings: {
        title: "设置",
        description: "存储与数据管理",
        storage: "存储",
    },
    layout: {
        description: "本地优先的信息聚合与个人情报工作台",
    },
} as const;
