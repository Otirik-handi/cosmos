/**
 * 写入动作的回执与错误文案。
 *
 * 这些句子由域 hook（`app/home/use-*-workspace`）与 transport 包装层产生，由页面上的
 * 通知/错误横幅显示给用户，因此和页面文案同源。带参数的回执写成函数，调用点才看得到
 * 变量落在句子的哪个位置。
 */
export const notices = {
    /** transport 包装层：请求失败与未知错误。 */
    requestFailed: (status: number) => `服务请求失败（HTTP ${status}）。`,
    unknownError: "发生未知错误。",

    board: {
        created: (name: string) => `已创建看板「${name}」，可在编辑模式添加分区与区块。`,
        notLoaded: "看板尚未加载，无法固定。",
        pinned: "已固定到看板热点区。",
    },

    story: {
        favorited: "已收藏当前 Story。",
        unfavorited: "已取消收藏当前 Story。",
        collectionAdded: "已把当前 Story 加入该收藏夹。",
        collectionRemoved: "已把当前 Story 移出该收藏夹。",
        annotationCreated: "已添加批注。",
        annotationUpdated: "已更新批注。",
        annotationDeleted: "已删除批注。",
        userStateMigrated: (moved: number) => `已迁移 ${moved} 项标记。`,
        userStateMigratedWithSkipped: (moved: number, skipped: number) =>
            `已迁移 ${moved} 项标记；${skipped} 项因去向已有相同标记而跳过。`,
    },

    topic: {
        annotationCreated: "已添加批注。",
        annotationUpdated: "已更新批注。",
        annotationDeleted: "已删除批注。",
        created: (title: string) => `已创建话题「${title}」。`,
    },

    entity: {
        created: (name: string) => `已创建 Entity「${name}」。`,
    },

    feed: {
        restored: "已恢复 Feed。",
        viewSaved: (name: string) => `已保存视图「${name}」。`,
        viewApplied: (name: string, count: number) => `已套用视图「${name}」，共 ${count} 条结果。`,
        viewDeleted: "已删除保存的视图。",
        viewUnsupported: (fields: string) => `保存视图暂不支持这些条件：${fields}（属 LIB-005，Phase 4）。`,
        /** 保存视图时被丢弃的条件字段名，与检索表单的字段标签同源。 */
        fieldLabels: {
            author: "作者",
            contentKind: "媒体类型",
            assetStatus: "录入状态",
        },
    },

    source: {
        noPlans: "尚未配置采集计划",
        planSummary: (total: number, enabled: number) => `${total} 个采集计划，${enabled} 个启用`,
        noDefinitions: "目录里没有可用的来源定义。",
        noDefinitionsToSave: "目录里没有可用的来源定义，无法保存计划。",
        probeNoResult: "探测任务没有返回结果。",
        invalidConfig: "目标配置有未填写或不合法的字段，请按提示修正。",
        planSaved: "采集计划已保存，当前为停用状态；在“采集计划”列表中启用后开始抓取。",
        mediaPolicySaved: (name: string) => `已保存 ${name} 的媒体策略；只影响之后的采集。`,
        planVersionConflict: "计划配置已被其它修改更新（版本冲突），列表已刷新，请重试。",
        planStateConflict: "计划状态已被其它修改更新（版本冲突），列表已刷新，请重试。",
        planDeleteConflict: "计划已被其它修改更新（版本冲突），列表已刷新，请重试。",
        webhookRotated: (name: string) => `已为 ${name} 生成 Webhook 入口；旧凭证（如果有）已立即失效。`,
        webhookRevoked: (name: string) => `已撤销 ${name} 的 Webhook 入口；需要重新生成才能再用。`,
        cleanupTimeout: "清理任务超时，请稍后在运行记录中查看。",
        cleanupFailed: "清理任务失败。",
        planEnabled: (name: string) => `计划 ${name} 已启用；可执行手动录入，配置了定时的计划会自动抓取。`,
        planDisabled: (name: string) => `计划 ${name} 已停用，不再自动或手动抓取。`,
        planDeleted: (name: string) => `计划 ${name} 已删除；已录入内容与来源历史保留。`,
        /** 看板区块删除后写进运行记录的原因；面向用户，不写内部机制名。 */
        planDeletedByBoardReason: "用户在看板删除采集计划",
        storageStatus: (status: string) => `服务正常，数据层 ${status}。`,
        runQueued: (runId: string) => `录入任务已排队（Run ${runId}），Worker 完成后 Feed 会自动刷新。`,
        runStatus: (status: string) => `录入任务状态：${status}。`,
    },
} as const;
