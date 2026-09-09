# ADR-0010：可配置看板 v1（Board、Section、Block 与人工 Spotlight）

> 状态：Accepted design contract
>
> 日期：2026-09-09
>
> 关联：[`board-section-block-v1 Proposal`](../proposals/board-section-block-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §5.2/§6.8/§7/§8.7/§9、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) BRD-002/003/004/006、§13 待决定事项 3、REC-014/REC-016、ADR [`0007`](0007-topic-domain-v1.md)/[`0008`](0008-entity-relation-v1.md)/[`0009`](0009-user-organization-v1.md)（复用其受管枚举/多态 target/command 编排模式，Saved View 是 Feed Block 的绑定目标）

## Context

Phase 2 前四切片已交付 Story、Topic、Entity/关系与用户组织（Label/Collection/Favorite/Annotation/Saved View），BRD-006 依赖的 Saved View 与 `search` 过滤已就绪。PRD §7.8 要求 Phase 2 交付可配置看板：可配置 Board/Section/Block（BRD-002）、默认看板按热点/精华/普通信息流组织（BRD-003）、Spotlight Block 可由用户设置（BRD-004）、Feed Block 绑定 Saved View（BRD-006）。当前 schema/contracts/API 无任何 Board 概念，Web 首页是纯硬编码布局。信息模型已冻结相关语义：Spotlight 是展示决定不是内容实体（§7），BoardPlacement/SpotlightPlacement 与 Topic 字段解耦（§5.2），看板精华区 = Board Section 展示选中对象（§8.7），PRD 待决定事项 3（Board 是否 Phase 2 支持多实例）悬而未决。

2026-09-09 用户对齐：Spotlight v1 只做人工固定（自动 policy 后置 Phase 4）；Board 按多实体建模 + 预置一个默认 Board；v1 Block 类型 = Feed（绑 SavedView）/ Spotlight / 来源健康 / Topic 与 Collection 列表；拆 2 个子切片（域 + API + 只读渲染 → 编辑模式 + 人工 Spotlight）。本文沉淀这些稳定决定。

## Decision

### 1. Block 是纯展示配置，Section 不设 kind

`Board`（name 唯一）→ `BoardSection`（title + position）→ `BoardBlock`（type + config + position + visible）三层。Block 的创建、删除、隐藏、复制、移动只改展示配置行，不触碰 Story/Entry/Topic/Entity/Collection/SavedView/Source（BRD-002「删除区块不删除内容」）。Section 只是「带标题的 Block 容器」，不设 kind/展示策略字段——热点/精华/信息流的区域差异由其内 Block 类型承载（热点 = Spotlight Block、精华 = Collection Block、信息流 = Feed Block；同一对象可同时出现在三者中，满足 BRD-003「引用相同对象、不同展示策略」）。

### 2. Block type 受管枚举 + 按 type 判别的白名单 config

`blockTypes` 受管枚举 `feed`/`spotlight`/`source-health`/`topic-list`/`collection`，写入侧校验、读取侧未知值降级为「未知区块」占位（同 `storyKinds`/`entityTypes` 模式）。`config` 是白名单化 JSON，按 type 判别 union 校验：`feed`/`collection` 的对象引用（`savedViewId`/`collectionId`）与所有类型的 `limit` 均可选——区块可以先创建为未绑定态再配置，未绑定或悬空引用在读取侧渲染占位（决定 5），不阻断创建。Block 渲染数据源复用既有端点（`search`/`listSources`/`listTopics`/`listCollections`），不新增内容查询端点。

### 3. Spotlight v1 只有 manual Placement，绑定具体 Board

`SpotlightPlacement` 表与未来自动 policy 共用同一 Placement 合同：v1 仅 `source=manual`、`expiresAt=null`（「人工固定可以不设 TTL」）；`targetType` 受管枚举 `story`/`topic` + `targetId`；`boardId` 必填（人工覆盖绑定具体 Placement/Board，REC-016「同一 Story 可以在不同 Board 有不同人工展示决定」）；`(boardId, targetType, targetId)` 唯一，解除固定用物理解除（对齐 Label/Annotation removals 风格）。`policyVersion`/信号明细/迟滞列不建，自动 policy（REC-014，Phase 4）落地时再加列；pin/unpin 不改变 Story/Topic 本身。

### 4. 多 Board 实体 + 预置默认 Board（消化 PRD 待决定事项 3）

Board 是实体，配置彼此独立、底层信息共享（BRD-009 语义提前落进模型）。产品 v1 由应用侧幂等 seed 一个默认 Board（热点/精华/信息流三 Section；热点含 Spotlight Block、精华含 Topic 列表 Block、信息流含 Feed + 来源健康 Block，对齐 BRD-003）；seed 不进 migration，migration 保持纯 schema。Web 支持创建与切换多个 Board。

### 5. 引用悬空降级 + merge 重定向

删除 SavedView/Collection 不级联删 Block；`config` 中 id 悬空时读取侧显示降级占位，用户重新配置或移除 Block。`mergeStories`/`mergeTopics` 在同一事务内把指向 obsolete 对象的 `SpotlightPlacement.targetId` 重定向到 canonical，与 canonical 既有 placement 冲突时丢弃 obsolete 侧重复项（与 ADR-0007/0008/0009 的迁移对称）。

### 6. 编排形态与后置项

看板配置是单机本地事务 + 审计，不产生外部副作用：API command → Application 命令 → repository 事务 → 领域事件，不新增 Workflow/Job 类型，复用 ADR-0006–0009 的 `actor/幂等键/白名单投影` 模式。后置：自动 Spotlight policy/Trend Signal（Phase 4）、Workspace/Artifact Block（BRD-005，Phase 3）、拖拽排序与网格布局编辑器（v1 纵向流 + 上移/下移）、Board/Query snapshot 与 Publication（Phase 5）、Feed 反馈与 Read State「未读」过滤。

## Consequences

### Positive

- Phase 2「组织与可配置看板」的看板半边第一次有落点：首页从硬编码布局变为配置驱动，BRD-002/003/004(v1)/006 全部达成可验收状态。
- `SpotlightPlacement` 与自动 policy 共用合同，Phase 4 落地 policy 时只加列与写入路径，不改人工固定语义。
- 多 Board 实体提前消化 PRD 待决定事项 3，避免未来从单 Board 迁移。
- Block 渲染全部复用既有查询端点，不扩大读取面。

### Costs and risks

- Web 首页布局改造会触碰现有浏览器 E2E 的选择器与断言（8 场景），本切片验收需同步更新。
- 4 张新表 + `mergeStories`/`mergeTopics` 各增一段迁移，继续加深 merge 编排的耦合面（与 ADR-0009 同一代价方向）。
- config 存 JSON 字符串，跨 type 的 config 演进需要判别 union 同步维护；未知 type 降级占位掩盖配置错误的风险由读取侧测试覆盖。

## Alternatives considered

### Spotlight v1 直接做简单规则推荐

拒绝。与 PRD 把 policy 化 Spotlight 划在 Phase 4（REC-014）的边界冲突，伪 policy 会造成返工；人工固定已满足 BRD-004 的用户侧验收（固定一个 Topic）。

### Section 带 kind（spotlight/curation/feed）

拒绝。展示策略由 Block 类型表达已足够；Section 级 kind 会把 BRD-003 的区域语义固化到容器上，未来加 Section 级策略时反而要处理两套表达。

### Spotlight 固定存在 Block config 里（pinned 列表）

拒绝。Spotlight 是独立于 Board 的展示决定（信息模型 §7/§9：SP → B），未来自动 policy 要写同一 Placement 合同；把固定列表藏进某个 Block 的 config 会让自动/人工两套写入没有统一权威。

### v1 严格单默认 Board（Web 不提供多 Board 入口）

拒绝（模型层面）。数据模型上 Board 是实体与单 Board 成本几乎相同，多 Board 建模避免迁移；产品面是否开放多 Board 创建入口可由 Task 按验收成本微调，不影响本决定。

### Board 配置加 baseRevisionId CAS

拒绝。看板配置是本地单用户的低冲突编辑，无跨执行者写冲突诉求；v1 用 last-write + 领域事件审计，与 Label/Collection 附加关系同一取舍。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 启动 Phase 4 Spotlight policy（REC-014），需要为 `SpotlightPlacement` 增加 policy/version、信号明细、迟滞与可续期 TTL 写入路径，并定义自动 Placement 与人工覆盖的互操作；
- Phase 3 Workspace/Artifact 落地，需要扩展 `blockTypes` 与 Spotlight `targetType`；
- Story split（ORG-014）设计落地，需要定义 Block/Placement 在 split 后的迁移语义（信息模型不变量 24）；
- 多列/网格布局或拖拽编辑器进入产品范围，`position` 字段与移动命令需要重审；
- Feed 反馈与 Read State 落地，Feed Block 需要「未读」过滤与曝光记录按 surface 对齐。
