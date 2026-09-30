---
parent: docs/proposals/frontend-redesign-v1.md
range: 第 1.5 层 · 工程决策 E1–E7
sealed_at: 2026-09-24
tags: [proposal, ui, frontend, engineering]
tokens_est: 4400
---

本册是 [`frontend-redesign-v1.md`](../frontend-redesign-v1.md) 的分册，保存第 1.5 层工程决策（E1–E7）。主文档保留当前状态与有效决定；**E5 断点策略同时写入主文档**，因为它是版面骨架的组成部分。勘误写在主文档，不改写本册。

## 评审当时的工程现状（证据）

- `apps/web`：Next.js 16.3.0 App Router、React 19.2.8、Tailwind v4（`@tailwindcss/postcss`）、TypeScript 5 `strict`、`@/*` 别名、`output: "standalone"`。
- 数据访问：`@cosmos/transport-http` 的 `HttpCosmosClient`，**模块级单例**（`apps/web/src/app/home/page-runtime.ts`），经 Next `rewrites` 把 `/api/*` 与 `/hooks/*` 转发到 `COSMOS_API_URL`。
- 实时更新：`client.openEventStream()` 每次调用**新建一个 `EventSource`**；当前只有首页 `page.tsx:325` 订阅一次，监听 `feed.updated.v1`、`run.queued.v1`、`run.succeeded.v1`、`run.failed.v1`、`run.retry_wait.v1`、`job.failed_terminal.v1` 六类事件，**每个事件都触发全量重读 Feed + 采集计划**。
- 页面状态：全部集中在 `/` 一条路由的五个 workspace hook（`use-source-workspace` 431 行、`use-story-workspace` 413 行、`use-feed-workspace` 249 行、`use-topic-workspace` 184 行、`use-entity-workspace` 177 行）。
- 分页：`/library` 的检索已用 cursor 分页（`Page<T>` + `nextCursor` + 「加载更多」）。
- 无缓存层、无请求去重；`page.tsx` 802 行、`board-view.tsx` 917 行、`story-panel.tsx` 815 行均在代码规模红线内。

## E1 技术选型

**底座不变**（维护者 2026-09-24：技术栈底座仍为 React + Tailwind CSS）。

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 框架 | Next.js 16 App Router | 已在用；路由组可直接表达「外壳」与「无侧栏例外」 |
| 样式 | Tailwind v4 + shadcn 语义 token | 已在用；V4 已验证 V3 配色可装进现有语义层 |
| 组件基座 | Base UI（`@base-ui/react` ^1.7.0）+ shadcn `base-nova` | 已在用；新 primitive 走 `shadcn add` 生成 |
| 表单 | React Hook Form + Zod | 已在用；`feed-browser.tsx` 的搜索表单已是该模式 |
| 客户端状态 | **不引入状态库**。模块级单例 client + 页面级 hook + 外壳级事件总线 | 现有五个 workspace hook 已是该模式；引入 Zustand/Redux 会与「服务端是真相源」冲突 |
| 数据获取 | **不引入 TanStack Query**。保持「显式加载函数 + 事件触发重读」 | 当前无缓存需求；引入后要重写全部 workspace hook，收益不明确 |
| 拖拽 | `@dnd-kit`（已装） | 看板拖拽排序已定必做 |
| i18n | **不引入框架**。集中文案模块（见 E6） | 只有中文界面；「不做多语言」是非目标 |

**放弃的备选与理由**：状态库与数据获取库都会引入「客户端缓存是第二真相源」的风险，而本产品的全部数据都来自 Product API 与 SSE，缓存失效策略目前没有需求驱动。

## E2 前端工程架构

### 路由分组与外壳

```text
app/
├── layout.tsx                   根布局（字体、主题引导、AppShell）
├── (shell)/                     带侧栏的内容组
│   ├── layout.tsx               顶栏 + 悬浮侧栏
│   ├── page.tsx                 /            首页看板
│   ├── library/page.tsx         /library
│   ├── topics/page.tsx          /topics
│   ├── topics/[id]/page.tsx     /topics/:id
│   ├── entities/page.tsx        /entities
│   ├── entities/[id]/page.tsx   /entities/:id
│   ├── system/page.tsx          /system
│   ├── organize/page.tsx        /organize
│   ├── automation/page.tsx      /automation
│   └── settings/page.tsx        /settings
└── (reading)/
    ├── layout.tsx               仅顶栏（返回 + 全局搜索 + 状态）
    └── stories/[id]/page.tsx    /stories/:id
```

**「Story 页隐藏侧栏」用路由组表达，不在页面里写条件判断**——这是 E4 的核心手法：版面差异属于布局层，不属于页面层。

### 模块分层

```text
src/app/**            路由与页面组合，不含可复用逻辑
src/components/ui/**  primitive（受组件实验室 CI 登记约束）
src/components/cosmos/**  产品组件（同受登记约束）
src/components/shell/**   外壳：顶栏、悬浮侧栏、AppShell（不登记，属布局）
src/lib/**            纯函数：格式化、派生计算、条件转换
src/hooks/**          跨页面复用的数据 hook
src/copy/**           集中文案模块（E6）
src/theme/**          主题合同（V4 收敛后）
```

### 外壳级实时连接（E2 的关键改动）

**问题**：`openEventStream` 每次调用新建一个 `EventSource`；拆成十个页面后若各自订阅，会开十条 SSE 连接，且每条都触发各自的全量重读。

**方案**：把连接与「什么数据变旧了」提升到外壳层。

- `src/components/shell/live-provider.tsx`：**在 `(shell)` 与 `(reading)` 两个 layout 中共用**，模块级单例只开**一条** SSE 连接。
- 暴露两样东西：`streamState`（`connecting` / `connected` / `unavailable`，供顶栏显示）与 `subscribe(topic, handler)`。
- 事件到 topic 的映射固定为一张表（例如 `feed.updated.v1 → library`、`run.* → automation`、`story.* → stories`），**页面只订阅自己关心的 topic**，不再全量重读。
- 未映射的事件类型**不触发任何重读**，只更新 `streamState`。

### 页面数据的统一形状

每个页面 hook 返回同一组字段，避免十种写法：

```ts
{ data, loading, error, refresh, stale }
```

- `loading` 仅首次加载为 true；后续重读走后台，保留旧数据可读（沿用 `page.tsx` 现有注释里已确认的原则：**首次骨架、之后后台刷新**）。
- `stale` 由 live-provider 的 topic 通知置位，用于详情页的「有新变化」提示（E4 决策 A）。

### 页面文件大小预算

代码规模治理红线：源码单文件 >800 行或 >50 KB 违规，入口文件 >300 行违规。当前被重做的三个超线文件（`page.tsx` 802 行、`board-view.tsx` 917 行、`story-panel.tsx` 815 行）**必须在本次拆分中回到线内**，且新页面不得把同样的堆积重新造出来。

## E3 接口与数据格式约定

**写入侧零新增**；读取侧新增四个只读查询（维护者 2026-09-24 裁定）：

| 查询 | 返回 | 消费者 |
| --- | --- | --- |
| 话题成员（带 Story 标题） | 在 `TopicDetail.members` 上补解析后的标题 | 话题页详情 |
| Entity 关联 Story（带标题） | 在 `EntityDetail.stories` 上补解析后的标题 | Entity 页详情 |
| 收藏列表（带标题） | 在 `FavoriteItem` 上补 `targetType` 对应的标题 | 整理页收藏分区 |
| 跨目标批注列表 | 新增「按 actor 列出全部批注」的只读查询 | 整理页批注分区 |

**约束**：

1. 四项都是「把已有数据取出来」，不改写入合同、不改持久化、不新增业务语义。
2. 列表一律沿用既有 `Page<T>`（`items` + `nextCursor`）分页形状，不发明第二套分页。
3. 时间字段一律 ISO 8601 带时区；展示层格式化在 `src/lib/`，不在接口层。
4. 错误沿用 `CosmosTransportError`（含 `status`），页面按 `status` 分类展示，不解析错误文案字符串。

**落点**：四项属 `docs/api/` 的 Draft 变更，按仓库规则在 RED 前更新 [`../../api/`](../../api/) 并补 conformance 场景；本 Proposal 只冻结范围与形状。

## E4 路由与权限体系

### 路由表

```text
/                     首页看板
/library              信息库与搜索        （搜索条件进 query string）
/topics               话题列表
/topics/:id           话题详情
/entities             Entity 列表
/entities/:id         Entity 详情
/system               系统产出
/organize             整理（?tab=labels|collections|favorites|annotations|views）
/automation           自动化（来源 / 采集计划 / 连接 / 运行记录）
/settings             设置
/stories/:id          Story 阅读页（无侧栏）
```

**URL 层级 = 导航层级**：八个导航项各占一层，`/:id` 只是详情，不产生第二层导航。整理页的五个分区用 query 而非路径段，因为它们是同一页内的分区（D6「一页内分区」），不是独立页面。

### 权限

**单用户、最大产品权限，不建权限体系**（既有裁定，本次不推翻）。因此：

- 没有登录态、没有角色、没有按权限隐藏的入口。
- 不预留权限 UI 占位；将来需要时按「未来多人/远端/不可信扩展」另开 Proposal。
- 与 PRD §9 的关系：UC-07 要求的「区分内容来源」由 V4 的 `marker` 语义承担，**不是权限**。

### 实时刷新边界（维护者 2026-09-24 裁定）

| 页面类型 | 收到相关 topic 事件时 |
| --- | --- |
| 列表页（看板 / 信息库 / 话题列表 / Entity 列表 / 系统产出） | **静默后台重读**，保留滚动位置与筛选条件 |
| 详情页（Story / 话题详情 / Entity 详情）**未在编辑** | 静默后台重读 |
| 详情页**正在编辑**（表单 dirty） | **不覆盖**，显示「有新变化，重新读取？」由用户决定 |
| 自动化 / 设置 | 只更新 `streamState`，不自动重读列表 |

「正在编辑」的判定：表单 `isDirty` 为真，或存在未提交的批注/标题草稿。

## E5 响应式与多端适配

**PC 优先、不做移动端适配**（维护者 2026-09-17 裁定），因此本层不设计移动端布局，只定义**桌面端从多宽开始可用**。

### 断点

| 断点 | 宽度 | 布局 |
| --- | --- | --- |
| 紧凑 | 1024–1279 px | 悬浮侧栏收窄至 176 px；主内容区限宽改为自适应（去掉 1080 上限）；顶栏搜索框收窄 |
| 标准 | 1280–1439 px | 悬浮侧栏 196 px；主内容区限宽 1080 px 居中 |
| 宽屏 | ≥ 1440 px | 同标准，仅两侧留白增加 |

**1024 px 是支持下限**：低于 1024 px 不做适配，显示一条「窗口过窄」提示，引导放大窗口。理由：产品是本地桌面工具，1024 px 已覆盖最小可用的笔记本宽度；低于此宽度的真实使用场景没有证据。

### 版面对齐的硬约束（门禁可断言）

- 顶栏、悬浮侧栏、主内容区在**三档断点下都必须存在且位置一致**（`/stories/:id` 按设计不含侧栏）。
- 悬浮侧栏宽度变化不得导致导航项换行或截断。
- 主内容区限宽变化时，列表行不得出现横向滚动条。

### 阅读区

阅读卡片限宽 640 px **在三档断点下都不变**（行宽是阅读舒适度约束，不随屏幕变宽而放宽）。

## E6 可访问性与国际化

### 可访问性目标（维护者 2026-09-24 裁定）

**质量下限 + 关键路径键盘可达**，不做完整 WCAG 逐条审计：

1. 对比度：正文与背景 ≥ 4.5:1；大字号与图形元素 ≥ 3:1。**四组必须实测**（V4 已列）。
2. 键盘：全部交互元素可达；`dialog` 焦点陷阱与关闭后焦点归位；`menu` 方向键；`combobox` 上下选择；`tooltip` 由 focus 触发。
3. 焦点可见：一律用 `--ring` 画环，不用 `outline: none` 抑制。
4. 语义：landmark（`header` / `nav` / `main`）、标题层级连续、表单标签关联、`aria-live` 用于命令回执。
5. 动效：`prefers-reduced-motion: reduce` 下三个时长归零。

**明确不做**：完整 WCAG 审计报告、屏幕阅读器逐页走查、色盲模拟矩阵。

### 国际化

**不做多语言、不引入 i18n 框架**（非目标维持）。文案归属用**集中模块**：

- `src/copy/messages.ts`：按语义分组的常量对象（`as const`），界面文案全部从这里取。
- 好处：术语表有一处落点；**禁用词扫描可以写成测试**（扫到「分类」「历史壳」「Spotlight 区块」「Story ID」等即失败），把 `ui-copy-review-v1` 的 R2 判据变成门禁。
- 不引入依赖、不包 provider、读代码能看到原文。
- 将来真要加第二语言，从常量模块迁到 `next-intl` 的机械工作量与现在直接上框架相当，不构成技术债。

**术语约束**：`Story`、`Entity` 保留英文；`Topic`→「话题」、`Entry`→「信息条目」、`Spotlight`→「热点」、`Revision`→「版本」、`kind`/`subtype`→「类型」/「细分类型」。

## E7 性能与安全预算

**E7 是开发前设定的预算，不是事后优化建议。**

| 指标 | 预算 | 说明 |
| --- | --- | --- |
| 首屏可交互（本地开发机，1440 px） | ≤ 2 s | 本地部署场景，不含公网延迟 |
| 路由切换（同会话内切导航项） | ≤ 300 ms | 外壳不重建，只换主内容区 |
| 单个列表页首屏数据 | 20 条（沿用 `Page<T>` 默认 limit） | 不做预取下一页 |
| SSE 连接数 | **全程恰好 1 条** | 由 E2 的外壳级 live-provider 保证；这是可断言的预算 |
| 事件触发的重读 | 只重读被映射的 topic，且**同一 topic 300 ms 内合并** | 防止突发事件导致的重读风暴 |
| 单页 JS 增量 | 新增 8 个 primitive 后，首屏 JS 不得增加超过 30 KB（gzip） | `dialog`/`menu`/`combobox` 等按需加载 |
| 图片 | 一律 `next/image`；列表缩略图不加载原图 | 媒体是本地 Blob，不经过外部 CDN |

### 安全

- **无新增攻击面**：不引入新依赖、不开新对外端口、不改 `/api/*` 与 `/hooks/*` 的转发边界。
- **XSS**：外部内容（RSS 摘要、标题、批注）一律作为**纯文本**渲染；现有 `toReadableExcerpt` 的标签剥离与实体解码必须保留，禁止改成 `dangerouslySetInnerHTML`。
- **CSRF**：单用户本地、无 Cookie 会话，不引入 CSRF token；沿用现有边界。
- **敏感数据**：`SecretRef` 与凭证不进 Product DTO（既有约束）；新页面不得展示任何 Secret 值，只能展示「已配置 / 未配置」。
- **不可信输入**：`localStorage`（主题偏好）、URL query（搜索条件、`?tab=`）在边界以 `unknown` 接收并立即用 Zod 校验，解析失败回退默认值。

## 待验证（E 层交付时必须量）

1. 三档断点（1024 / 1280 / 1440）下悬浮侧栏与主内容区的实际表现，以及「窗口过窄」提示的触发。
2. SSE 连接数**恰好 1 条**（可在浏览器 Network 面板或行为测试中计数）。
3. 事件合并：300 ms 内多条同类事件只触发一次重读。
4. 首屏 JS 增量与首屏可交互时间。
5. 四组对比度实测值（与 V4 的待验证项合并）。
6. 「正在编辑时不被覆盖」：构造 dirty 表单 + 事件到达，断言表单内容不变且出现提示。
