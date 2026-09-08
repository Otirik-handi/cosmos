# Task 13：用户组织 v1（Phase 2 第四切片）

## User Request / Topic

2026-09-08 用户确认：Phase 2 第四切片为「用户组织」= Label/Annotation/Collection/Saved View；Proposal [`label-annotation-collection-saved-view-v1`](../../../docs/proposals/label-annotation-collection-saved-view-v1.md) 经评审接受（三项默认：拆 3 子切片、Annotation 目标范围、收藏语义），稳定决定沉淀于 [`ADR-0009`](../../../docs/adr/0009-user-organization-v1.md)，PRD §7.4 第四切片注记与信息模型 §9 已同步。

## Goal

交付 PRD §7.4「信息库、分类与检索」与 LIB-003/004/005/008 的用户组织层（手动优先）：

```text
Label 分类标签 -> 全局命名注册表 + 多态 LabelAssignment（Story/Entry/Topic）
Collection 命名收藏夹 -> 成员为 Story + Story/Entry 独立轻量收藏标记（Favorite）
Annotation 批注 -> 绑定 Story/Entry/Topic（可编辑笔记 + targetRevisionId + 可选 quote/evidence）
Saved View 持久查询视图 -> 只存查询条件不存快照，search 扩展 labelIds/topicIds
用户编排 -> create/update/delete/attach/detach/set/unset + 列表/详情
```

## Scope / Non-goals

Scope：

- Label：全局命名注册表（name 唯一）+ 多态 `LabelAssignment` 附加到 Story/Entry/Topic（`targetType` 受管枚举 + 未知降级）；批量打标/移除。
- Collection：命名收藏夹（name/可选 description）+ `CollectionItem`（`(collectionId, storyId)` 唯一）；`Favorite`（`(targetType, targetId)` 唯一）表达 Story/Entry 轻量收藏。
- Annotation：绑定 Story/Entry/Topic 的批注，含 `actor`、创建/更新时间、可选 `targetRevisionId`、`quote`、`evidence`；增删改。
- Saved View：命名视图 + 结构化查询条件（text/sourceId/时间范围/labelIds/topicIds），只存条件不存快照；`search` 扩展可选 `labelIds`/`topicIds` 过滤。
- Product API 写命令与读取（label/collection/favorite/annotation/saved-view 的增删改、附加/解除、列表/详情）。
- Web：Story/Entry/Topic 面板打标签/批注/收藏开关；侧栏 Collection 列表 + 从 Story 侧加入集合；搜索页保存/套用 Saved View。

Non-goals（见 Proposal / ADR-0009）：

- 自动分类/标签推荐、`KnowledgeSignal`/Knowledge Workflow（ORG-021，LLM/Agent 后置）。
- Artifact 作为目标（Phase 3 对象）、正文片段字符级锚点（本片用可选 `quote` 文本表达）。
- Read State（`last_seen_revision_id`）驱动的「未读/状态」过滤（LIB-005 部分）。
- Feed Block 绑定 Saved View（BRD-006，依赖可配置看板）、批量导出/删除（LIB-008 部分）。
- 可配置 Board/Section/Block、Spotlight（BRD-002~008）、`TopicRelation`（ORG-015 类型化 Relation 部分）。
- 混合召回/推荐排序（REC 系列 Phase 4）、embedding、多用户权限、审批 UI。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`label-annotation-collection-saved-view-v1`](../../../docs/proposals/label-annotation-collection-saved-view-v1.md)（accepted，2026-09-08）。
- ADR [`0009`](../../../docs/adr/0009-user-organization-v1.md)；ADR [`0006`](../../../docs/adr/0006-story-domain-v1.md)/[`0007`](../../../docs/adr/0007-topic-domain-v1.md)/[`0008`](../../../docs/adr/0008-entity-relation-v1.md)（复用 command/当前关系/唯一附加模式）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) LIB-003/004/005/008、ORG-015、REC-013、§11 数据保留、§7.4 第四切片注记。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §2「用户组织」、§8.2、§9、§11 不变量 16/24。
- 现状 spec：domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10/11/12 交付，本切片扩展）。

## 实施切片（capability map，无环依赖，逐片合入）

1. **子切片 A：Label + Collection + 收藏标记**（domain + migration + storage + contracts + API + Web）
   - domain：`targetType` 受管枚举 + 未知降级、Label/Collection/Favorite 语义、命令输入语义；
   - Prisma：`Label`/`LabelAssignment`/`Collection`/`CollectionItem`/`Favorite` + migration（forward-only、只增不改）；
   - storage 事务命令：label create/delete/attach/detach、collection create/update/delete/add-item/remove-item、favorite set/unset；`mergeStories` 迁移 `CollectionItem`/`Favorite` 并重定向 `LabelAssignment.targetId`；
   - contracts DTO/命令 schema + transport-http + API 端点 + Web（打标签/收藏/集合）。
2. **子切片 B：Annotation**（domain + migration + storage + contracts + API + Web）
   - `Annotation` 表 + migration；annotation create/update/delete 事务命令；DTO/命令 schema；API 端点；Web 批注面板（Story/Entry/Topic）。
3. **子切片 C：Saved View**（migration + storage + contracts + API + Web + search 扩展）
   - `SavedView` 表 + migration；saved-view create/update/delete；`search` 扩展 `labelIds`/`topicIds` 过滤；Web 保存/套用 Saved View。

## Current State

- 生命周期阶段：Proposal accepted，稳定文档已同步（PRD §7.4 第四切片注记、信息模型 §9 v1 注记、ADR-0009、ADR 索引、Task 13 README）；未开始实现；待维护者授权创建 worktree 与分支 `feat/t13-user-organization` 后进入子切片 A。

## Decisions and Deviations

- 以 ADR-0009 六条为稳定边界（targetType 受管枚举 + 未知降级、Label 全局注册表 + 多态附加、Collection 与收藏标记分离、Annotation 用可编辑笔记而非 revision 链、Saved View 只存条件不存快照并扩展 search、自动分类/Artifact/片段锚点/Read State/Feed Block 绑定后置）。
- 交付顺序：3 个子切片逐片合入（Label+Collection → Annotation → Saved View），每片独立验收、独立 commit/merge。
- Story merge 的成员迁移与 targetId 重定向在子切片 A 一并落地（与 ADR-0007/0008 对称）。

## Verification / Gate

- 每子切片按仓库验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器；全量门禁至少 typecheck、docs:check、test、build、git diff --check。
- 迁移类改动必须在 `.agent/tmp/` 用含旧数据的隔离库验证 upgrade（全新表，仍跑 fresh + upgrade 两态）。
- `docs/spec/` 在行为落地后同步（domain/0001 扩展、contracts/0001、storage/0001、interfaces/0002/0005）与 `docs/testing/README.md`。

## Follow-ups

- 浏览器产品 E2E（用户组织流程）与人工浏览器验收留待后续。
- 后续 Phase 2 切片：可配置 Board/Spotlight（BRD-006 Feed Block 绑定）、自动聚类/Knowledge Workflow、Entity merge/dedup、`evidence_for`/`mentions`。
- 后续能力：Artifact 目标、正文片段字符级锚点、Read State「未读」过滤、批量导出/删除（LIB-008 部分）。
