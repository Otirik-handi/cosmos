/**
 * Story 阅读页（`/stories/:id`）文案。
 *
 * `storyEdit` 一组随 Task 36 切片 A 的组件拆分一起迁入：那一轮把编辑面拆成
 * `story-reading-content` 与 `story-edit-panel` 两个新文件，而「内联文案只减不增」
 * 门禁不允许新文件带内联中文，因此拆分的必要条件就是把它们的文案迁到这里。
 */
export const reading = {
    loading: "正在读取…",
    missingTitle: "这条内容读不到了",
    missingBody: "它可能已被合并到另一条内容里。",
    backToBoard: "回到看板",
    splitBadge: "已被拆分",
    /**
     * 拆分来源回链（维护者 2026-10-05）。原条拆成空壳后没有成员、不出现在任何列表里，
     * 而用户状态按 ADR-0020 留在原条上，所以后继必须能指回去。
     */
    splitOrigin: {
        label: "拆分来源",
        hint: "这条内容由它拆出；它的批注、标签与收藏留在原条上，可回到原条迁移。",
    },
    readOriginal: "读原文",
    actionsLabel: "读完动作",
    sourceAndEditLabel: "来源与编辑",
    favorite: "收藏",
    favorited: "已收藏",
    pinnedNotice: "已固定到看板热点区。",
    /** ADR-0029 决策 7：正在编辑时不覆盖，让用户决定什么时候读新内容。 */
    staleStory: "这条内容在别处有了新变化。你正在编辑的内容没有被改动。",
    reloadStory: "重新读取",
    /** 右栏「操作编辑区」。 */
    storyEdit: {
        sectionLabel: "编辑与关联",
        collapsedHint: "改标题与关键事实、归并、拆分、打标签、写批注、加入话题、关联 Entity 都在这里展开。",
        expand: "展开",
        collapse: "收起",
        updateFailed: "Story 操作失败。",
        mergeFailed: "Story 归并失败。",
        splitFailed: "拆分 Story 失败。",
        splitNeedsTitle: "每个后继都需要标题。",
        /** 下限与合同一致（`storySplitSuccessorMinCount`）：拆成一条不是拆分。 */
        splitNeedsSuccessors: "拆分至少要保留两个后继；只想留下一条的话，不需要拆分。",
        /**
         * 拆成零成员壳的确认（维护者 2026-10-05）。壳是 ADR-0012 有意保留的，不是错误，
         * 但它不再出现在任何列表里，而用户状态按 ADR-0020 留在壳上——所以必须讲清后果。
         */
        splitEmptyShellTitle: "原条会变空",
        splitEmptyShellBody:
            "所有成员都分给了后继，原条将不再有内容：链接与历史仍然保留，但它不会出现在信息库和看板里。你留在原条上的批注、标签与收藏不会丢，可以从后继页面的「拆分来源」回到原条去迁移。",
        splitEmptyShellCancel: "返回调整",
        splitEmptyShellConfirm: "仍然拆分",
        splitNeedsMember: (title: string): string =>
            `后继「${title}」还没有分配到任何成员；请给它至少一个成员，或减少后继数量。`,
        splitRemoveSuccessor: "删除后继",
        keyFactNeedsText: "每条关键事实都需要文字；不需要的请删除。",
        linkEvidenceFailed: "添加证据来源失败。",
        unlinkEvidenceFailed: "解除证据来源失败。",
        mergeTargetLabel: "选择要并入本条的内容",
        mergeTargetPlaceholder: "搜索标题…",
        mergeTargetSearching: "正在搜索…",
        mergeTargetEmpty: "没有匹配的内容",
        /**
         * 右栏按类别重排后的四段（Task 36 Round 9）。标签/批注这些文案原本内联在
         * `story-panel/organization.tsx` 里；那个文件按段拆开时，新文件不允许带内联中文，
         * 所以整段文案跟着一起迁进来。
         */
        /**
         * 四段的段标题（维护者 2026-10-03：右栏每一段要有一个 Title）。原本只有 C、D
         * 两段带名字（藏在各自组件里），B、A 两段只有分割线、没有名字，用户看不出
         * 一堆控件属于哪一类；四个标题现在都由 `StoryEditPanel` 统一渲染。
         */
        segments: {
            family: "家族与关系",
            representation: "内容与表示",
        },
        marking: {
            sectionLabel: "我的标记",
            actionFailed: "操作失败。",
            pinToBoard: "固定到看板热点区",
            labelsTitle: "标签",
            labelsEmpty: "本条 Story 还没有标签；可从已有标签里添加一个。",
            labelSelect: "选择要添加的标签",
            labelSelectPlaceholder: "选择标签…",
            labelAdd: "添加",
            labelRemove: (name: string): string => `移除标签 ${name}`,
            collectionsTitle: "收藏夹",
            collectionsEmpty: "还没有收藏夹；在整理页建一个后把本条 Story 收纳进去。",
            annotationsTitle: "批注",
            annotationsEmpty: "本条 Story 还没有批注；可在下方记录摘录与想法。",
            annotationBody: "批注正文",
            annotationQuote: "批注引文",
            annotationQuotePlaceholder: "引文（可选）",
            annotationSave: "保存",
            annotationCancel: "取消",
            annotationEdit: "编辑",
            annotationDelete: "删除",
            annotationUnsigned: "未署名",
            annotationNewBody: "新批注正文",
            annotationNewBodyPlaceholder: "写下批注正文",
            annotationNewQuote: "新批注引文",
            annotationAdd: "添加批注",
        },
        /** 右栏 D 段「对象关联」的标题与失败文案。 */
        entities: {
            sectionLabel: "对象关联",
            actionFailed: "操作失败。",
        },
    },
} as const;
