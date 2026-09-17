# Task 14：可配置看板 v1（Phase 2 第五切片）

## User Request / Topic

2026-09-09 用户确认：Phase 2 第五切片为「可配置 Board/Section/Block」；Proposal [`board-section-block-v1`](../../../docs/proposals/board-section-block-v1.md) 经评审接受（四项默认：Spotlight 只做人工固定、多 Board 实体、四类 Block 全做、拆 2 子切片），稳定决定沉淀于 [`ADR-0010`](../../../docs/adr/0010-board-section-block-v1.md)，PRD §7.8 第五切片注记（含待决定事项 3 决策注记）与信息模型 §7 v1 切片注记已同步。

## Goal

交付 PRD §7.8「看板与浏览体验」BRD-002/003/004(v1)/006 的可配置看板层：

```text
Board/Section/Block 三层配置实体 -> Block 是纯展示配置（删/藏/复制/移动不触碰内容）
四类 Block -> feed（绑定 SavedView）/ spotlight / source-health / topic-list / collection
多 Board 实体 -> 应用侧幂等 seed 默认 Board（热点/精华/信息流三 Section）
SpotlightPlacement v1 -> 仅 source=manual、expiresAt=null，绑定 Board，pin Story/Topic
Product API -> Board/Section/Block CRUD + move/visibility/duplicate + pin/unpin
Web -> 首页按 Board 树渲染（只读渲染 -> 编辑模式两步交付）
```

## Scope / Non-goals

Scope：

- `Board`（name 唯一）/ `BoardSection`（title + position）/ `BoardBlock`（type 受管枚举 + 白名单 config + position + visible）。
- Block 类型：`feed`（必填 `savedViewId`）、`spotlight`（人工固定列表）、`source-health`、`topic-list`、`collection`（必填 `collectionId`）；未知 type 降级占位。
- `SpotlightPlacement`（targetType 受管枚举 story/topic + targetId + boardId 必填 + source=manual + 可空 reason/expiresAt）；`(boardId, targetType, targetId)` 唯一；物理解除。
- Product API：Board/Section/Block 增删改 + move/set-visibility/duplicate + Spotlight pin/unpin + Board 树读取 + placements 列表（附带目标摘要）。
- 默认 Board 幂等 seed（应用侧，不进 migration）；Web 首页改造为 Board 树渲染 + 编辑模式 + pin/unpin 交互。
- `mergeStories`/`mergeTopics` 同事务重定向 placement（冲突丢弃 obsolete 侧重复项）。

Non-goals（见 Proposal / ADR-0010）：

- 自动 Spotlight policy、Trend Signal、评分/迟滞/TTL 续期（REC-014，Phase 4）。
- Workspace/Artifact Block（BRD-005，Phase 3）、Spotlight 指向 Workspace/Artifact。
- 拖拽排序、网格布局编辑器（v1 纵向流 + 上移/下移）、Board 级视觉主题。
- Board/Query snapshot、Publication、推送（PUB 系列，Phase 5）。
- Feed 反馈（曝光/隐藏记录）、Read State「未读」过滤。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`board-section-block-v1`](../../../docs/proposals/board-section-block-v1.md)（accepted，2026-09-09）。
- ADR [`0010`](../../../docs/adr/0010-board-section-block-v1.md)；ADR [`0007`](../../../docs/adr/0007-topic-domain-v1.md)/[`0009`](../../../docs/adr/0009-user-organization-v1.md)（复用受管枚举/多态 target/command 编排模式，Saved View 是 Feed Block 绑定目标）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) BRD-002/003/004/006、§13 待决定事项 3、§7.8 第五切片注记。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §5.2、§6.8、§7、§8.7、§9。
- 现状 spec：domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10–13 交付，本切片扩展）。

## 实施切片（capability map，无环依赖，逐片合入）

1. **子切片 A：Board/Section/Block 域 + API + Web 只读渲染**
   - domain：`blockTypes` 受管枚举 + 未知降级、config 按 type 判别校验；
   - Prisma：`Board`/`BoardSection`/`BoardBlock` + migration（forward-only、只增不改）；
   - storage 事务命令：board/section/block CRUD + move/set-visibility/duplicate + 默认 Board 幂等 seed + Board 树读取；
   - contracts DTO/命令 schema + transport-http + API 端点；
   - Web：首页按 Board 树渲染四类 Block（只读），Board 切换器。
2. **子切片 B：Spotlight 人工固定 + Web 编辑模式**
   - Prisma：`SpotlightPlacement` + migration；pin/unpin 事务命令；`mergeStories`/`mergeTopics` placement 重定向；
   - contracts/API：pin/unpin 命令与 placements 列表（附带目标摘要）；
   - Web：编辑模式（Section 管理 + Block 增删/排序/隐藏/复制/配置）+ Spotlight Block pin/unpin 交互。

## Current State

- 生命周期阶段：子切片 A、B 均实现完成、门禁通过，已随 `2ea8939` 合入并推送 `master`。
- 本轮（2026-09-09）：Proposal accepted、稳定文档同步（PRD/信息模型/ADR-0010/ADR 索引）；worktree `.worktree/board-section-block`、分支 `feat/t14-board-section-block`（基线 master `038ae1b`）已按授权创建；两个子切片代码、focused 测试、浏览器 E2E 与 spec 同步完成。
- 连贯目标：交付 Board/Section/Block 配置域、只读渲染与编辑模式，以及人工 Spotlight 固定。
- 可观察验收（≤3 条）：
  1. 首页按默认 Board 树渲染出三 Section 与初始 Block（Feed/来源健康/Topic/Spotlight 各就位），刷新后保持；
  2. 编辑模式可增删分区与区块、调整顺序/可见性/复制/绑定，写命令经 API 生效且删除 Block 不影响底层内容；
  3. 从 Story/Topic 面板固定后热点区出现该项，解除后消失；未知 Block type 降级占位不阻断其它 Block。
- 依赖：Task 13 的 SavedView 合同与 `search` 过滤（已合入 master）。
- 受影响合同：contracts（新枚举/DTO/命令 schema）、application（repository 端口）、storage-prisma（新表 + 命令）、api（新端点）、transport-http（client 方法）、web（首页布局 + 编辑模式）。
- 验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器（已执行，见下）。

### 追加切片（2026-09-15）：Feed Block 独立取数（拖拽排序另记）

Phase 2 收口项之一，维护者 2026-09-15 选定。**Feed Block 独立取数已合并**（`14ce892`，2026-09-15）；改动在分支 `fix/t14-board-feed-blocks`（worktree `.worktree/t14-board-feed-blocks`，基线 `2e46dca`，已 rebase 到合并 split 之后的 master）。

- 生命周期阶段：Feed Block 独立取数已合并（`14ce892`）；拖拽排序见下方 2026-09-16 追加切片（已合并）。
- 连贯目标：让每个阅读流区块按自己的绑定取数，不再由「第一个可见区块」独占页面阅读流；交互式搜索归位页面级。
- 可观察验收（≤3 条）：
  1. 两个以上「阅读流」区块各自取数、互不干扰：绑定的按该 Saved View 条件显示，未绑定的显示最新内容流，悬空引用显示占位；
  2. 交互式搜索与「已保存视图」管理位于页面级 section（对齐 PRD §8.2），不再依附某个区块；
  3. 首页既有流程（录入、搜索、Story 打开、390px 无横向溢出）不回归。
- 依赖：无新增合同依赖；复用既有 `search`/`feed` 端点与既有 `boardConfig` schema。
- 受影响合同：**无公共合同变化**（`savedViewId` 早已持久化并可选）；Web 内部取数位置与布局变化。
- 验证层级：typecheck → 单元回归 → build → 浏览器产品 E2E（新增独立取数用例）→ 组件实验室 → `docs:check`。
- 分类依据：属**当前合同可判定的局部 Bug**——ADR-0010 已决定阅读流区块绑定 Saved View，实现却让第一个可见区块独占页面阅读流、`savedViewId` 写入后未被消费；按准入决策表不需要新 Proposal。

**开工前发现的合同冲突与裁决（2026-09-15）**：默认看板 seed 的阅读流区块是**未绑定**态（`packages/storage-prisma/src/repository/views.ts` 写入 `configJson: "{}"`）。照 ADR-0010 决定 5 的字面把「未绑定」渲染成占位，首页「信息流」分区将不再显示内容，与 PRD §8.1「首页看板展示热点、精华和多个分类 Feed」及 Phase 1 的「Feed 以 Story 为入口」验收冲突。维护者选 **方案 A**：未绑定 = 渲染默认最新内容流（即原首页行为），绑定 Save View 后按其条件取数；决定 5 对 `feed` 收窄为「悬空引用渲染占位」（`collection` 不变），ADR-0010 已加注记。

## Decisions and Deviations

- 以 ADR-0010 六条为稳定边界（Block 纯展示配置 + Section 无 kind、type 受管枚举 + 判别 config、Spotlight v1 仅 manual 绑定 Board、多 Board 实体 + 幂等 seed、悬空降级 + merge 重定向、command 编排无新 Workflow）。
- 交付顺序：2 个子切片逐片合入（域 + 只读渲染 → 编辑模式 + Spotlight），每片独立验收。
- seed 不进 migration（ADR-0010 决定 4）：migration 保持纯 schema，默认 Board 由应用侧幂等 seed。
- 追加切片（2026-09-15）：`BoardFeedBlock` 沿用 `BoardCollectionBlock` 的自取数模式——按绑定值重挂载、effect 内不做同步 setState、失败或悬空只降级占位。绑定的 Saved View 解析用页面已加载的 `savedViews`（不再单独拉一次视图详情）：既避免多一次请求，也让视图被改名/删除时区块跟着刷新。
- 追加切片（2026-09-15）：区块内的流是**紧凑列表**（标题 + 来源，点击打开 Story），不复用完整 `FeedBrowser`。完整的搜索卡与结果列表留在页面级；区块是看板的一个格子，不需要承载搜索表单。
- 追加切片（2026-09-15）：组件实验室的 `board-view` fixture 给 `feed` 一个固定响应，使自取数区块在实验室里渲染内容而不是失败占位；此前该 fixture 用 `feedSlot` 传合成内容，现在改为覆盖 client 的 `feed`。
- 追加切片（2026-09-15，验证期发现）：拆分场景的浏览器用例原先只断言收藏按钮翻转、没有服务端确认，标签写入慢时可能在状态落库前就拆分并在事后读到中间态（观察过一次该失败）。已改为先轮询 API 确认收藏与标签都已落库再继续。
- 追加切片（2026-09-16）：**区块拖拽排序已合并**（实现 `a270079`，`--no-ff` 合并 `1dbaf90`）；跨分区拖拽经维护者裁定不做。过程与验证证据见 [walkthrough.md](walkthrough.md)。

## Verification / Gate

- 每子切片按仓库验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器；全量门禁至少 typecheck、docs:check、test、build、git diff --check。
- 迁移类改动必须在 `.agent/tmp/` 用含旧数据的隔离库验证 upgrade（全新表，仍跑 fresh + upgrade 两态）。
- Web 首页布局改造后同步更新现有浏览器 E2E（ingest 流程 8 场景）的选择器与断言（ADR-0010 已记为验收工作一部分）。
- `docs/spec/` 在行为落地后同步（domain/0001、contracts/0001、storage/0001、interfaces/0002/0005）与 `docs/testing/README.md`。

## 过程记录

本 Task 的实现过程、偏差与各切片的实际验证证据（子切片 A/B、两个收尾门禁、Feed Block 独立取数、区块拖拽排序）已移入 [walkthrough.md](walkthrough.md)（2026-09-16 拆分：README 只保留当前摘要、范围、门禁与下一步）。

## Follow-ups

- **搜索 FTS5 查询未转义（2026-09-15 发现，未修）**：`packages/storage-prisma/src/repository/search.ts` 把 `parsed.text` 原样放进 `entry_search MATCH ?`，用户搜索含 `-`、`"`、`*`、括号等 FTS5 语法字符的词会触发 SQLite 语法错误 → search 端点返回 500（实测：`GET /api/v1/search?text=绝不匹配-212c82&limit=5`）。这是既有缺陷，与看板切片无关；修法（把用户输入转成短语查询/转义引号）需要单独确认边界并补回归测试。
- **拖拽排序（维护者 2026-09-15 定为必做）**：**已合并**（`1dbaf90`，2026-09-16，见「追加切片（2026-09-16）：区块拖拽排序」）。ADR-0010 决定 6 已加注记并新增决定 7；跨分区拖拽经裁定不做。
- **合并记录（2026-09-16）**：分支 `feat/t14-board-drag-sort`（实现提交 `a270079`）经维护者授权以 `--no-ff` 合入 `master`（合并提交 `1dbaf90`）并推送 `origin`。合并后 `git diff a270079 HEAD` 为空，master 的树与分支上跑过门禁的树逐字节一致；**未在 master 工作区重跑门禁**（主工作区未安装依赖），因此门禁结论以分支上那次实测为准。PROJECT-STATUS 在同一轮收尾提交里更新。worktree 与分支已于 2026-09-16 按维护者授权清理。
- 子切片 B 已完成；本 Task 已在 `2ea8939` 合入并推送 `master`。
- 后续 Phase 2 切片候选：Story split 完整生命周期、`evidence_for`/`mentions`、自动聚类/Knowledge Workflow、Entity merge/dedup。
- 后续能力：Phase 4 Spotlight policy（为 `SpotlightPlacement` 加列与写入路径）、Phase 3 Workspace/Artifact Block、Read State「未读」过滤。
