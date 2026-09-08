# Proposal：用户组织 v1（Label + Collection + Annotation + Saved View，Phase 2 第四切片）

> 状态：accepted
>
> 日期：2026-09-08
>
> 需求真相源：[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md)（LIB-003、LIB-004、LIB-005、LIB-008、ORG-015、REC-013、§7.4、§11 数据保留）与 [`../requirements/0001-original-requirements.md`](../requirements/0001-original-requirements.md)
>
> 关联：信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §2「知识关系」、§8.2（Collection 结果单位为 Story）、§9 关系图、§11 不变量 16/24；公共术语 [`../../CONTEXT.md`](../../CONTEXT.md)；ADR [`0006`](../adr/0006-story-domain-v1.md) / [`0007`](../adr/0007-topic-domain-v1.md) / [`0008`](../adr/0008-entity-relation-v1.md)（复用其 command/别名/当前关系/provenance 已验证模式）；Task 10/11/12 walkthrough [`../../.agents/tasks/12-entity-relation/README.md`](../../.agents/tasks/12-entity-relation/README.md)

## 问题

PRD §7.4「信息库、分类与检索」要求“用户可以创建 Label、Annotation、Collection 和 Saved View”（LIB-003），Annotation 可绑定 Entry/Story/Topic/Artifact/正文片段并显示作者/时间/目标版本/依据（LIB-004），Saved View 可保存分类/时间/来源/状态/未读/Topic 等查询条件并被 Feed Block 与搜索页复用（LIB-005），并可查看/导出/删除自有持久数据（LIB-008）。当前实现完全没有这一层：

- `packages/storage-prisma/prisma/schema.prisma` 现有 24 个 model（`SourceInstance`…`EntityRelation`/`WorkflowRun`/`WorkflowCompletion`），没有任何 Label、批注、收藏、集合或持久查询视图表。
- `packages/domain`、`packages/contracts`、`apps/api` 均无 Label/Annotation/Collection/Saved View 概念（grep 无命中）；内容组织与用户标记停在 Story/Topic/Entity。
- 现有 `search` 查询只支持 `text/sourceId/publishedAfter/publishedBefore/cursor/limit`，没有标签或 Topic 过滤——Saved View 若要复用查询，必须先扩展检索能力。
- 信息模型 §2 已把「用户组织 = Label、Annotation、Collection、Saved View」冻结为稳定类别（分类、批注、手工集合、持久查询），§9 关系图里 `Saved View / Query` 是 Workspace Input Binding 的输入、§11 不变量 16/24 明确“收藏和批注可指向 Story 或 Entry”“split 后用户状态不自动扇出到全部后继”。本 Proposal 只做最小实现切片并处理实现级取舍，不引入新的语义分歧。

本 Proposal 把 Phase 2 第四切片冻结为「用户组织 v1」：Label（分类标签）+ Collection（命名收藏夹 + 轻量收藏标记）+ Annotation（批注）+ Saved View（持久查询视图），**全部人工操作**。**不包含**自动分类/Knowledge Workflow 提议流、可配置看板与 Spotlight、`evidence_for`/`mentions`、Read State 驱动的「未读」过滤。

## 已拍板输入（用户 2026-09-08 接受）

| 输入 | 建议决定 |
| --- | --- |
| Phase 2 第四切片 | 用户组织（Label/Annotation/Collection/Saved View，PRD 顺序）；可配置看板与 Spotlight 不在本切片 |
| 交付拆分 | 拆 3 个子切片逐片合入：①Label + Collection（+ 轻量收藏）；②Annotation；③Saved View。每片独立验收、独立 commit/merge |
| Annotation 目标范围 | v1 绑定 Entry/Story/Topic 三种已存在对象；Artifact（Phase 3）与正文片段字符级锚点后置，片段暂用可选引用文本 `quote` 表达 |
| 收藏语义 | Collection = 命名收藏夹（成员为 Story，对齐信息模型 §8.2「结果单位为 Story」）；另设 Story/Entry 的轻量布尔「收藏」标记（满足 REC-013「收藏绑定 Story 或 Entry」） |

## 目标与非目标

### 目标

1. **Label（分类标签）**：稳定命名标签注册表，可附加到 Story/Entry/Topic（多态附加），可批量打标/移除；标签是用户真相，重分析不覆盖（NFR-004）。
2. **Collection（命名收藏夹）+ 收藏标记**：命名集合（成员为 Story）+ Story/Entry 轻量「收藏」布尔标记；两者独立、语义清晰。
3. **Annotation（批注）**：绑定 Entry/Story/Topic 的用户批注，显示作者、时间、目标版本引用与可选依据/引用文本（`quote`）；可编辑、可删除，保留 actor 与时间。
4. **Saved View（持久查询视图）**：保存关键词、时间、来源、标签、Topic 等查询条件，可命名、可复用；搜索页可套用同一 Saved View（LIB-005 的「搜索页复用」落地，Feed Block 绑定归可配置看板切片）。
5. **Product API 写命令与读取**（创建/更新/删除/附加/解除/应用），沿用 Task 10/11/12 的编排路径形态（API command → Application 命令 → repository 事务 → 领域事件），不引入新 Workflow/Job 类型。
6. **Web 最小验证面**：Story/Entry/Topic 面板可打标签与批注；侧栏 Collection 列表 + 收藏开关；搜索页可保存/套用 Saved View；作为浏览器验收面。

### 非目标

- 自动分类/标签推荐、`KnowledgeSignal`/Knowledge Workflow 提议流（ORG-021 依赖 LLM/Agent，后置）。
- `evidence_for`/`mentions` 跨 Story 引用（ORG-011，与用户组织正交，继续后置）。
- Artifact 作为批注/标签目标（Artifact 是 Phase 3 对象）；正文片段字符级锚点（本片只做可选 `quote` 文本）。
- Read State（`last_seen_revision_id`）与「未读」过滤——LIB-005 中的「状态/未读」条件依赖尚未实现的 Read State，后置；Saved View v1 只覆盖可映射到现有/新增检索字段的条件（关键词/来源/时间/标签/Topic）。
- Feed Block 绑定 Saved View（BRD-006）——依赖可配置看板，归 Board/Spotlight 切片。
- 批量导出与受控删除的完整生命周期（LIB-008）——本片交付「查看」与单对象删除；导出/批量删除留待数据运维切片。
- 可配置 Board/Section/Block、Spotlight（BRD-002~008）、TopicRelation（ORG-015 的类型化 Relation 部分）。
- 混合召回/推荐排序（REC 系列是 Phase 4）、embedding、多用户权限、审批 UI。

## 当前行为与证据

- `packages/storage-prisma/prisma/schema.prisma:10-480`：现有 24 个 model，到 `EntityRelation`/`WorkflowRun`/`WorkflowCompletion` 为止；全文件无 Label、Annotation、Collection、Favorite、SavedView 模型。
- `packages/domain/src/index.ts`、`packages/contracts/src/index.ts`、`apps/api/src/app.controller.ts`：grep `label|annotation|collection|favorite|saved view` 无命中；`storyKinds`/`topicMemberRoles`/`entityTypes` 等受管枚举 + 未知降级、`fingerprintStoryRevision` 等指纹模式已存在（Task 10/11/12 交付），可复用于本片的写入侧校验与可选指纹。
- `packages/transport-http/src/index.ts:261-287`：`search` 查询仅 `text/sourceId/publishedAfter/publishedBefore/cursor/limit`；`/feed` 走按更新倒序的 Story Feed。无标签或 Topic 过滤，Saved View 需要扩展检索。
- 语义设计已冻结：信息模型 §2（用户组织四类）、§8.2（Collection/Saved View/Query 结果单位为 Story）、§9（`Saved View / Query` 作为 Workspace Input Binding 输入）、§11 不变量 10（用户标签/批注/Topic 修正不因重分析丢失）、16（收藏/批注可指向 Story 或 Entry）、24（split 后用户状态不自动扇出到全部后继）。
- 用户组织相关需求为 Phase 2 的部分已由 PRD 冻结：LIB-003/004/005/008（本切片核心）；ORG-015 用标签组织 Topic 关系（本片覆盖 Label，类型化 TopicRelation 后置）；REC-013 的「收藏/批注绑定 Story 或 Entry」由收藏标记 + Annotation 目标覆盖。

## 方案与取舍

### 1. 领域层：四类对象的语义

- **Label**：全局命名标签注册表，`Label` 表保存稳定 id + 名称（唯一）+ 创建/更新时间。附加关系用多态 `LabelAssignment`（`labelId` + `targetType` + `targetId`，`(labelId, targetType, targetId)` 唯一）。`targetType` 受管枚举 `story`/`entry`/`topic`（未来可扩 `artifact`/`workspace`），未知值降级读取（同 `storyKinds` 模式）。标签不进入被标注对象自身的 revision——它是附着在对象外的用户真相，重分析刷新派生数据不触碰标签（NFR-004）。
- **Collection + 收藏标记**：`Collection` 表保存命名集合（name/可选 description）；`CollectionItem` 保存 `(collectionId, storyId)` 唯一成员。轻量「收藏」用 `Favorite` 表保存 `(targetType, targetId)` 唯一（单用户，targetType ∈ story/entry），与 Collection 相互独立——满足 REC-013 与信息模型 §8.2 两条不同语义。
- **Annotation**：`Annotation` 表保存目标（`targetType` + `targetId`，枚举 story/entry/topic）、可选 `targetRevisionId`（写入时目标为 Story 则指向其当前 `StoryRevision`，满足「目标版本」）、可选 `quote` 文本、正文 `body`、`actor`、创建/更新时间、可选依据 `evidence`。批注是可编辑的用户笔记，用 `update` 命令覆盖（记录 actor/updatedAt），不建不可变 revision 链——批注没有「展示字段版本化历史」的诉求，比 Story/Topic 更轻；删除用 tombstone 或物理删除，以 Task 细化为准。
- **Saved View**：`SavedView` 表保存命名视图 + 结构化查询条件（关键词 `text`、`sourceId`、时间范围 `publishedAfter/publishedBefore`、`labelIds`、`topicIds`），条件用白名单化 JSON 或结构化列存储（以 Task 细化为准）。它只持久化「用户想要复用的查询条件」，不存储结果快照——套用视图时即时重查，保证结果新鲜。为落地「搜索页复用」，`search` 端点扩展可选 `labelIds`/`topicIds` 过滤（Saved View 子切片内一并交付）。

**取舍**：四个对象都是「用户真相 + 人工操作」，共用同一套「多态 target + 唯一附加 + command 编排」骨架，复用 Task 10/11/12 已验证的 `actor/reason/时间戳 + 幂等键 + 白名单投影` 模式，不引入派生写入。代价是「自动分类/推荐标签/自动收藏」体验要等 Knowledge Workflow 切片；v1 只交付可手工维护的用户组织骨架。

### 2. 持久化与迁移

预计改动（以 Task 细化为准，按子切片分 3 条 forward-only migration，避免一次过大的 schema 变更）：

- 子切片 A：`Label`（id、name 唯一、createdAt/updatedAt）、`LabelAssignment`（`(labelId, targetType, targetId)` 唯一）、`Collection`、`CollectionItem`（`(collectionId, storyId)` 唯一）、`Favorite`（`(targetType, targetId)` 唯一）。
- 子切片 B：`Annotation`（targetType/targetId/targetRevisionId/quote/body/actor/evidence/时间戳）。
- 子切片 C：`SavedView`（name + 结构化查询条件）。

全新表、无既有数据 backfill；migration forward-only、只增不改；每条 migration 按门禁验证 fresh DB + 既有 master 旧库 upgrade 两态。既有 `Story`/`StoryRevision`/`Entry`/`Topic`/`Entity` 表结构不改；Story/Topic/Entry 只增反向关系（同 Task 11 `Story.topicMemberships` 的做法）。`CollectionItem` 外键引用 `Story`（并处理 Story merge 的成员迁移，见下）。

**取舍**：附加关系用「当前关系表 + 唯一约束」而非 append-only 事件表——标签/收藏/集合成员的当前投影是详情页主路径，需要 O(1) 查询；历史只在 `actor`/时间戳字段保留，v1 不重建附加关系历史链（与 Entity 的 Story↔Entity/Entity↔Entity 关系同一取舍）。

### 3. merge/split 的成员迁移一致性

- **Story merge**（ORG-020 已落地）：`mergeStories` 同一事务内把指向 obsolete Story 的 `CollectionItem`/`Favorite` 迁到 canonical Story（保持唯一约束在 canonical 上成立），删除 duplicate 并写领域事件——与 Task 11 `TopicMembership` 迁移、Task 12 `StoryEntity` 迁移对称。`LabelAssignment`/`Annotation` 的 `targetId` 指向 obsolete Story 时同样解析到 canonical（这些是多态附加，无跨 canonical 的唯一冲突，仅重定向 `targetId`）。
- **Story split**（ORG-014 后置，本片不实现 split 命令）：但 Annotation/Label/Favorite 的目标引用要能在 split 落地时保留——按信息模型 §11 不变量 24「split 后用户状态不自动扇出到全部后继」，收藏/批注留在历史壳，显式迁移后置。本片只保证这些对象不阻止未来 split 实现（`targetId` 是字符串外键，无 schema 阻塞）。

### 4. 公共边界：Product API command，不引入新 Workflow 类型

用户组织编排是单机本地事务 + 审计，不产生外部副作用，与 Story/Topic/Entity 编排同形态：API command → Application 命令 → repository 事务 → 领域事件。待 Task 细化的命令形态（版本化、幂等键、输入校验先以 `unknown` 收口）：

- `label.create`、`label.delete`、`label.attach`、`label.detach`；
- `collection.create`、`collection.update`、`collection.delete`、`collection.add-item`、`collection.remove-item`；
- `favorite.set`、`favorite.unset`；
- `annotation.create`、`annotation.update`、`annotation.delete`；
- `saved-view.create`、`saved-view.update`、`saved-view.delete`（「应用」由客户端读条件后调 `search`，不设服务端 apply 端点）；
- 读取扩展：`Label`/`Collection`/`Annotation`/`SavedView` 的列表与详情 DTO；Story/Topic/Entry 详情可选附带「标签/批注/收藏」投影（向后兼容新增字段，最小可后置到 Task 定）；`search` 扩展 `labelIds`/`topicIds` 过滤。

### 5. Web 最小验证面

- Story/Entry/Topic 面板：打标签（选择已有/新建）、批注列表 + 增删改、收藏开关（Story/Entry）。
- 侧栏 Collection 列表 + 新建集合 + 从 Story 侧「加入集合」（沿用 Task 11「从 Story 侧发起」方向，规避目标 ID 可用性障碍）。
- 搜索页：保存当前条件为 Saved View、从 Saved View 列表套用；套用后走扩展后的 `search`（含标签/Topic 过滤）。
- 组件实验室登记对应场景；生产行为与 API 合同同步进 `docs/spec/`；视觉打磨不属本切片验收。

## 影响

- **产品/API**：新增用户组织写命令与读取；既有 Feed/Search/Story/Topic/Entity 路径不变；`search` 新增可选 `labelIds`/`topicIds`（向后兼容，缺省行为不变）。
- **数据**：新增 5 张表（`Label`/`LabelAssignment`/`Collection`/`CollectionItem`/`Favorite`）+ `Annotation` + `SavedView`，分 3 条 migration；不改既有表结构；外键引用 Story/Topic/Entry，Story merge 需同步迁移 `CollectionItem`/`Favorite` 并重定向多态 `targetId`。
- **公开合同**：contracts 新增 targetType 枚举、命令与列表/详情 schema；`storyKinds`/`topicMemberRoles`/`entityTypes` 及既有 Story/Topic/Entity DTO 不变。
- **安全**：本地单用户最大权限（沿用既有边界），写入口参数白名单化，不引入审批 UI；写入审计记录 actor。
- **迁移/回滚**：migration forward-only；无 ID 重定向（除 Story merge 的成员迁移）；回滚只回退代码路径，已建用户组织数据保留。
- **发布**：本切片不涉及发布与部署（后置债）。

## 验收草案（设计通过后归 Task）

- **domain focused**：targetType 枚举校验与未知值降级；Label 唯一性；Favorite/CollectionItem/LabelAssignment 的唯一约束语义；Annotation 的 targetRevisionId 写入规则；Saved View 条件白名单校验（非法条件拒绝）。
- **storage/迁移**：fresh + 旧库 upgrade（每条 migration）；`(labelId,targetType,targetId)`、`(collectionId,storyId)`、`(targetType,targetId)` 唯一约束与并发写入；Story merge 迁移 `CollectionItem`/`Favorite` 与 `LabelAssignment`/`Annotation` 的 targetId 重定向。
- **contracts/API focused**：命令 Zod 校验、幂等键、白名单投影；`search` 的 `labelIds`/`topicIds` 过滤行为；列表/详情返回标签/批注/集合成员。
- **浏览器**：给 Story 打标签 → 标签列表可见 → 从标签反查 Story；收藏 Story → 收藏夹可见；批注绑定 Story/Entry → 显示作者/时间/quote；搜索条件存为 Saved View → 套用后结果一致。
- **明确不运行**：Docker/Compose、发布部署、真实公网长时定时、非 Windows 平台 smoke、长时间故障恢复（Phase 1 后置债划线不变）。

## 对稳定文档的预期改动（接受后执行）

- `docs/requirements/0002-product-requirements.md`：LIB-003/004/005/008 注记 v1 已实现边界（Artifact/正文片段锚点、未读/状态过滤、Feed Block 绑定、批量导出/删除后置）。
- `docs/architecture/0002-information-model.md` §2/§8.2/§9/§11：注记 v1 实现边界（Label/Collection/Annotation/Saved View 手动优先落地，自动分类与 Read State 后置）。
- `docs/adr/`：新增 ADR-0009 用户组织 v1，沉淀稳定决定（targetType 受管枚举 + 未知降级、Collection 成员为 Story + 独立轻量收藏标记、Annotation 用可编辑笔记而非不可变 revision 链、Saved View 只持久查询条件不存快照、自动分类/Read State/Feed Block 绑定后置）。
- `docs/spec/`：domain/0001（用户组织语义）、contracts/0001（新 DTO 与 search 扩展）、storage/0001（迁移与读写）、interfaces/0002 与 0005 同步；`docs/testing/README.md` 补充测试数据边界。
- 新建 Phase 2 Task（编号待维护者分配，建议 13）记录实施切片；本 Proposal 状态 reviewing → accepted 前不修改任何代码或稳定文档。

## 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-08 | Phase 2 第四切片 = 用户组织（Label/Annotation/Collection/Saved View）；可配置看板与 Spotlight 不进本切片 | 用户 |
| 2026-09-08 | 拆 3 个子切片逐片合入（Label+Collection → Annotation → Saved View）；Annotation 目标 = Entry/Story/Topic、片段锚点后置；收藏 = 命名 Collection + Story/Entry 轻量收藏标记 | 用户 |
| 2026-09-08 | **接受本 Proposal**（含上述三项默认：拆 3 子切片、Annotation 目标范围、收藏语义） | 用户（评审接受） |
