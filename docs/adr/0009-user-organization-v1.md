# ADR-0009：用户组织 v1（Label、Collection + 收藏、Annotation、Saved View）

> 状态：Accepted design contract
>
> 日期：2026-09-08
>
> 关联：[`label-annotation-collection-saved-view-v1 Proposal`](../proposals/label-annotation-collection-saved-view-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §2/§8.2/§9/§11、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) LIB-003/004/005/008、ORG-015、REC-013、§11 数据保留、ADR [`0006`](0006-story-domain-v1.md)/[`0007`](0007-topic-domain-v1.md)/[`0008`](0008-entity-relation-v1.md)（复用其 command/当前关系/唯一附加模式）

## Context

Task 10/11/12 已交付 Story、Topic、Entity/关系三层域模型。PRD §7.4「信息库、分类与检索」要求“用户可以创建 Label、Annotation、Collection 和 Saved View”（LIB-003），Annotation 可绑定 Entry/Story/Topic/Artifact/正文片段并显示作者/时间/目标版本/依据（LIB-004），Saved View 可保存分类/时间/来源/状态/未读/Topic 等查询条件并被 Feed Block 与搜索页复用（LIB-005），并可查看/导出/删除自有持久数据（LIB-008）。信息模型 §2 已把「用户组织 = Label、Annotation、Collection、Saved View」冻结为稳定类别，§8.2 明确 Collection/Saved View/Query「结果单位为 Story」，§9 关系图里 `Saved View / Query` 是 Workspace Input Binding 输入，§11 不变量 16/24 明确「收藏/批注可指向 Story 或 Entry」「split 后用户状态不自动扇出到全部后继」。当前 schema/domain/contracts/API 均无这四个概念。

2026-09-08 用户对齐：Phase 2 第四切片 = 用户组织；分 3 个子切片逐片合入（Label+Collection → Annotation → Saved View）；Annotation 目标 = Entry/Story/Topic、片段锚点后置；收藏 = 命名 Collection + Story/Entry 轻量收藏标记。本文沉淀这些稳定决定。

## Decision

### 1. 附加目标受管枚举 + 未知降级

`targetType` 受管枚举 `story`/`entry`/`topic`（未来可扩 `artifact`/`workspace`），写入侧校验、读取侧未知值降级展示，同 `storyKinds`/`topicMemberRoles`/`entityTypes` 模式。Label 附加与 Annotation 目标共用这一枚举；Collection 成员固定为 Story（对齐信息模型 §8.2「结果单位为 Story」，不经 targetType 泛化）。

### 2. Label：全局命名注册表 + 多态附加

`Label` 表保存稳定 id + 唯一 name；附加关系用多态 `LabelAssignment`（`labelId` + `targetType` + `targetId`，`(labelId, targetType, targetId)` 唯一）。标签是附着在对象外的用户真相，不进入被标注对象自身的 revision——重分析刷新派生数据不触碰标签（NFR-004）。可批量打标/移除。

### 3. Collection 与收藏标记分离

`Collection` 表保存命名收藏夹（name/可选 description），`CollectionItem` 保存 `(collectionId, storyId)` 唯一成员。轻量「收藏」用独立 `Favorite` 表保存 `(targetType, targetId)` 唯一（targetType ∈ story/entry），与 Collection 相互独立——分别满足信息模型 §8.2「手工集合（Story 单位）」与 REC-013「收藏绑定 Story 或 Entry」两条不同语义。

### 4. Annotation 用可编辑笔记，而非不可变 revision 链

`Annotation` 表保存目标（`targetType` + `targetId`）、可选 `targetRevisionId`（写入时目标为 Story 则指向其当前 `StoryRevision`，满足 LIB-004「目标版本」）、可选 `quote` 文本、正文 `body`、`actor`、创建/更新时间、可选依据 `evidence`。批注是可编辑用户笔记，用 `update` 命令覆盖（记录 actor/updatedAt），不建不可变 revision 链——批注没有「展示字段版本化历史」诉求，比 Story/Topic 更轻。删除用 tombstone 或物理删除（以 Task 细化为准）。

### 5. Saved View 只存查询条件不存快照，扩展 search 过滤

`SavedView` 表保存命名视图 + 结构化查询条件（关键词 `text`、`sourceId`、时间范围 `publishedAfter/publishedBefore`、`labelIds`、`topicIds`），条件白名单化存储。它只持久化「用户想复用的查询条件」，不存结果快照——套用视图时即时重查，保证结果新鲜。为落地「搜索页复用」（LIB-005），`search` 端点扩展可选 `labelIds`/`topicIds` 过滤（Saved View 子切片内一并交付）；Feed Block 绑定（BRD-006）依赖可配置看板，后置。

### 6. 后置项

自动分类/标签推荐与 Knowledge Workflow（ORG-021）后置；Artifact 作为目标后置（Phase 3 对象）；正文片段字符级锚点后置（本片用可选 `quote` 文本表达）；Read State（`last_seen_revision_id`）驱动的「未读/状态」过滤后置（LIB-005 部分）；Feed Block 绑定后置（BRD-006）；批量导出/删除后置（LIB-008 部分，本片只交付查看 + 单对象删除）。四类对象都是「用户真相 + 人工操作」，共用「多态 target + 唯一附加 + command 编排」骨架，复用 ADR-0006/0007/0008 的 `actor/reason/幂等键/白名单投影` 模式，不引入派生写入；编排是单机本地事务 + 审计，不新增 durable Workflow/Action 类型。

## Consequences

### Positive

- Phase 2「组织与可配置看板」第一次有用户组织层落点：标签、收藏、批注、持久查询视图成为可手工维护的用户真相。
- 四类对象共用同一「多态 target + 唯一附加 + command」骨架，实现与测试形态一致，不引入第二套写入语义。
- Saved View 扩展的 `search` 过滤能力（`labelIds`/`topicIds`）为后续 Board/Spotlight 与推荐消费方提供了检索基础。
- `targetRevisionId`/`evidence`/`quote` 字段前瞻兼容正文片段锚点与 Artifact 目标，无需二次迁移。

### Costs and risks

- v1 只有人工打标/收藏/批注/建视图，在 Knowledge Workflow 上线前没有「自动分类」体验；这是接受的顺序取舍。
- 5 张新表（Label/LabelAssignment/Collection/CollectionItem/Favorite）+ Annotation + SavedView 带来额外读写成本，但沿用既有模式。
- Story merge 需在同一事务内迁移 `CollectionItem`/`Favorite` 并重定向 `LabelAssignment`/`Annotation` 的 `targetId`（与 ADR-0007/0008 的 membership/StoryEntity 迁移对称），增加 `mergeStories` 的耦合面。

## Alternatives considered

### 四类合并成一个大切片一次交付

拒绝。范围过大、单次验证面广；分 3 个子切片逐片合入（Label+Collection → Annotation → Saved View）可独立验收、风险更小。

### Annotation 用不可变 revision 链

拒绝。批注没有「展示字段版本化历史」诉求（区别于 Story/Topic 的标题/摘要），用可编辑笔记 + `actor`/`updatedAt` 审计更简单。

### 收藏只用 Collection，或只用布尔标记

拒绝。二者语义不同：Collection 是命名手工集合（Story 单位），收藏是 Story/Entry 的轻量标记（REC-013）；合并会丢失一条语义或制造约定负担。

### Saved View 存结果快照

拒绝。快照会过期，与「重新分析后用户数据不丢失、结果新鲜」相悖；只存查询条件、套用时即时重查。

### 正文片段字符级锚点进 v1

拒绝。需要额外的 fragment 定位模型与 UI，复杂度高；先用可选 `quote` 文本表达片段引用，锚点后置。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 开始 Knowledge Workflow/自动分类（ORG-021），需要定义自动标签/批注/收藏写入的 actor/接受边界与「人工修正不被重分析覆盖」的落地语义；
- Artifact（Phase 3）落地后，需要把 `targetType` 扩到 `artifact`/`workspace`；
- Read State 落地后，需要为 Saved View 增加「未读/状态」过滤条件；
- 可配置看板（BRD-006）落地后，需要把 Saved View 绑定到 Feed Block；
- 设计 Story split 完整生命周期（ORG-014），需要定义 Label/Annotation/Favorite/CollectionItem 在 split 后的迁移语义（不变量 24）；
- 数据运维切片（LIB-008 的批量导出/删除）落地后，需要定义这些用户真相对象的导出与受控删除边界。
