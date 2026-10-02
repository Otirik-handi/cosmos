/**
 * 外壳文案：侧栏导航与顶栏。导航项与 URL 层级一一对应（ADR-0029 决策 3），
 * 这里的 label 是导航的唯一文案来源，页面自己不再重复写一次。
 */
export const shell = {
    nav: {
        ariaLabel: "主导航",
        groups: {
            content: "内容",
            management: "管理",
        },
        items: {
            home: "首页看板",
            library: "信息库",
            topics: "话题",
            entities: "Entity",
            system: "系统产出",
            organize: "整理",
            automation: "自动化",
            settings: "设置",
        },
    },
    topBar: {
        /** 阅读页的返回入口：回到信息库。 */
        back: "← 返回",
        searchLabel: "搜索标题或正文",
        searchPlaceholder: "搜索标题或正文",
        /** 服务状态；与外壳级单条 SSE 连接的状态一一对应。 */
        stream: {
            connecting: "正在连接",
            connected: "服务正常",
            unavailable: "服务不可用",
        },
    },
    /**
     * 低于 1024 px 的窗口提示（ADR-0029 决策 6：桌面三档，1024 px 是支持下限，
     * 不做降级布局）。三档断点与它一起由 `e2e/browser/layout-and-budget.spec.ts` 断言。
     */
    narrowWindow: {
        title: "窗口过窄",
        body: "Cosmos 是桌面工作台，1024 px 以下不做降级布局。把窗口拉宽到 1024 px 以上即可继续。",
    },
} as const;
