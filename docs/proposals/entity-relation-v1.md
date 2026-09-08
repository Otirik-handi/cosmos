# Proposal：Entity/关系 v1（Entity + Story↔Entity + Entity↔Entity，Phase 2 下一切片）

> 状态：accepted
>
> 日期：2026-09-08
>
> 需求真相源：[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md)（ORG-003、ORG-021、REC-008/009/012、§7.5、§9.2）与 [`../requirements/0001-original-requirements.md`](../requirements/0001-original-requirements.md)
>
> 关联：信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §2「知识关系」、§4.5、§9；公共术语 [`../../CONTEXT.md`](../../CONTEXT.md)「关系速记」；ADR [`0006`](../adr/0006-story-domain-v1.md) / [`0007`](../adr/0007-topic-domain-v1.md)（复用其 revision/alias/command 已验证模式）；Task 10/11 walkthrough [`../../.agents/tasks/10-story-domain/README.md`](../../.agents/tasks/10-story-domain/README.md)、[`../../.agents/tasks/11-topic-domain/README.md`](../../.agents/tasks/11-topic-domain/README.md)（已收口）

## 问题

PRD §7.5「Story、Topic、Entity 与关系」的完成标准要求“系统识别人、组织、产品、项目、模型和地点等 Entity，并保存带依据的关系”（ORG-003）；§9.2 的示例验收依赖“共享 Entity、前后时间关系、引用”来解释相关内容（REC-008/009）。当前实现完全没有 Entity 或关系层：

- Prisma schema 只有 `Story`/`StoryRevision`/`StoryAlias`/`Topic`/`TopicMembership`/`TopicMembershipRevision`/`TopicAlias`/`Entry`，没有任何 Entity、别名、Story↔Entity 或 Entity↔Entity 表。
- domain、contracts、Product API、Web 均无 Entity 概念；内容组织单位停在 Story/Topic。
- Task 10/11 已交付 Story 与 Topic 域模型，上层推荐与“相关内容”信号里的“共享 Entity、关系图”没有落点——Entity 是下一个被阻塞的切片。

信息模型 §2 已把 Entity/Relationship 冻结为「知识关系」层（人、组织、产品以及有依据的关联），§9 关系图里 Entity 有 `Entry→N`、`Story→N` 两条边，另有实体之间的类型化关系。本 Proposal 不引入新的语义分歧，只做最小实现切片并处理实现级取舍。

本 Proposal 把 Phase 2 下一片冻结为“Entity/关系 v1”：Entity 实体 + Story↔Entity 关联 + Entity↔Entity 类型化关系，**全部手动优先**。**不包含**自动 Entity 提取、`evidence_for`/`mentions`、Label/Annotation/Collection/Saved View、可配置看板与 Spotlight。

## 已拍板输入（用户 2026-09-08 对齐）

| 输入 | 决定 |
| --- | --- |
| Phase 2 下一切片 | Entity/关系（PRD 顺序）；标签/批注/集合/Saved View、可配置看板不在本切片 |
| v1 切片范围 | 三层全做：①实体本体（规范名/类型枚举/别名）；②Story↔Entity 关联；③Entity↔Entity 类型化关系 |
| 提取方式 | 手动优先：用户显式创建实体、关联故事、建立实体间关系；自动识别（Knowledge Workflow/LLM，ORG-021）后置 |

## 目标与非目标

### 目标

1. Entity 成为稳定知识对象：规范名（canonical name）+ 受管类型枚举（person/organization/product/project/model/location）+ 名称别名（name alias，用于同一实体的多写法解析）；名字变化走不可变 `EntityRevision`（同 Story/Topic 指纹 no-op、当前指针）。
2. Story↔Entity 关联：一条 `(Story, Entity)` 关联表达“该 Story 涉及该 Entity”，保存 producer/version/confidence/evidence 与 actor/reason，人工建立与解除（ORG-003 的 provenance 字段预留，自动识别后置）。
3. Entity↔Entity 类型化关系：带方向、带类型的 `(fromEntity → relationType → toEntity)` 关系（如“Jeff Dean → founded → Discovery Loop”），同样保存 producer/version/confidence/evidence；关系类型受管枚举 + 未知值降级读取。
4. Product API 写命令与读取（创建/更新/别名/关联/关系/列表/详情），沿用 Task 10/11 Story/Topic 编排同一路径形态（API command → Application 命令 → repository 事务 → 领域事件），不引入新 Workflow/Job 类型。
5. Web 最小验证面：Entity 详情页（名字/类型/别名 + 关联 Story + 关系）+ 从 Story 面板发起“关联/创建 Entity” + Entity 列表入口，作为浏览器验收面。

### 非目标

- 自动 Entity 识别/抽取、`KnowledgeSignal`/Knowledge Workflow 提议流（ORG-021 是 Phase 2 async 分析，依赖 LLM/Agent，后置）。
- `evidence_for`/`mentions` 跨 Story 引用（ORG-011，Entry↔Story 关系，与 Entity 正交，继续后置）。
- Entity merge/dedup 的 canonical/alias ID 重定向（同一实体被录入两次时的合并）——本切片只做**名称别名**，不做实体 ID 归并；归并另行切片（关系重映射更复杂）。
- Label/Annotation/Collection/Saved View（LIB-003/004/005）、可配置 Board/Section/Block、Spotlight（BRD-002~008）、TopicRelation（ORG-015）。
- 混合召回/推荐排序（REC-009/012 是 Phase 4，本切片只提供 Entity/关系可被检索的数据基础）。
- 多用户权限、审批 UI、Workspace/Artifact 联动、embedding。

## 当前行为与证据

- `packages/storage-prisma/prisma/schema.prisma:249-353`：仅 `Story`/`StoryRevision`/`StoryAlias`（249/263/279）、`Topic`/`TopicRevision`/`TopicMembership`/`TopicMembershipRevision`/`TopicAlias`（288/299/316/331/346）、`Entry.storyId` 主归属外键；全文件无 Entity、别名、Story↔Entity 或 Entity↔Entity 模型。
- `packages/domain/src/index.ts:3,7`：`storyKinds`、`topicMemberRoles` 受管枚举 + 未知降级模式已存在；`:186,206` `fingerprintStoryRevision`/`fingerprintTopicRevision` 确定性指纹模式已存在；无 `entityTypes`/`entityRelationTypes` 或 Entity 语义。
- `packages/contracts`：Story/Topic 编排命令 schema（版本化、幂等键、revision CAS）与详情/列表 DTO 已存在（Task 10/11 交付）；transport-http 与 API 提供对应端点；无 Entity DTO。
- `apps/web`：`StoryPanel`/`TopicPanel` 已支持多成员/角色展示与编排；无 Entity 入口。Task 10 收尾已知可用性障碍（UI 不展示 Story ID）已被 Task 11 的“从 Story 侧发起成员”方案规避，本切片沿用同一方向。
- 语义设计已冻结：信息模型 §2（Entity/Relationship = 人、组织、产品以及有依据的关联）、§9（`Entry→Entity`、`Story→Entity`、类型化关系）、CONTEXT.md「关系速记」（`Story + Entity -> Topic`、`related_to` 比 Topic 更轻量）。
- Entity 相关需求为 Phase 2 的部分已由 PRD 冻结：ORG-003（本切片核心）；ORG-021 的自动实体/关系提议是 Phase 2 但依赖 Knowledge Workflow（后置）；REC-008/009/012 是 Phase 4 的消费方，不是本切片实现范围。

## 方案与取舍

### 1. 领域层：Entity 语义 + 关系 provenance

- **Entity 类型受管枚举**：`entityTypes = ["person", "organization", "product", "project", "model", "location"]`（ORG-003 六类），读取时允许未知值降级展示，同 `storyKinds`/`topicMemberRoles` 模式。
- **Entity 本体**：稳定 `id` + 受管 `type`（`Entity` 表去规范化当前值，同 Story 的 kind/subtype）+ 规范名 `name` 走不可变 `EntityRevision`（确定性 fingerprint、无实质变化 no-op、当前指针）。fingerprint 覆盖 `{name, type}`，与 `fingerprintStoryRevision`/`fingerprintTopicRevision` 同构。
- **名称别名**：`EntityAlias` 表保存 `(entityId, name)` 唯一，add/remove 是离散命令，不进入 revision fingerprint——别名是名称解析用的操作数据，不是展示内容。
- **Story↔Entity 关联**：一条 `(storyId, entityId)` 唯一当前关联，字段含 producer/version/confidence/evidence 与 actor/reason；建立/解除是离散命令，不建 revision 链（没有“角色频繁变化”的历史诉求，比 Topic membership 更简单）。
- **Entity↔Entity 类型化关系**：`(fromEntityId, toEntityId, relationType)` 唯一，方向由 from/to 表达，字段同样含 provenance；关系类型受管枚举 + 未知降级读取。
- **关系类型受管枚举（建议初版）**：`founded`（创立）、`works_at`（任职）、`located_in`（位于）、`produced`（产出/发布）、`part_of`（从属）、`related_to`（通用兜底）——直接对应 PRD 示例“Jeff Dean 创立 Discovery Loop”“Jeff Dean 参与过的组织、职位变化”；未知值降级读取，后续可扩展不破坏旧客户端。
- **手动优先的 provenance 语义**：v1 只有人工命令写入，每次写入记录 actor、reason、producer（固定 human 语义）、confidence（默认 high/1.0，可显式降级）；producer/version/confidence/evidence 字段已就位，自动识别落地时无需迁移即可写入 agent 派生关系，且“人工修正不被重分析覆盖”由后续 Knowledge Workflow 在写入侧尊重已人工确认的关系实现（本切片不实现自动写入）。

取舍：自动识别、merge/dedup、Proposal/接受流程全部后置，v1 的 Entity 与关系只由用户显式操作——与 Story/Topic 切片同一逻辑，成本最低、不引入不可信派生写入；代价是“系统自动识别实体”体验要等 Knowledge Workflow 切片，v1 只交付可手工维护的知识关系骨架。

### 2. 持久化与迁移

预计改动（以 Task 细化为准）：

- 新表 `Entity`（id、type、currentRevisionId）、`EntityRevision`（id、entityId、revision、fingerprint、name、actorJson、reason + `(entityId, revision)` 唯一）、`EntityAlias`（`(entityId, name)` 唯一）、`StoryEntity`（`(storyId, entityId)` 唯一 + provenance 字段）、`EntityRelation`（`(fromEntityId, toEntityId, relationType)` 唯一 + provenance 字段）。
- 全新表、无既有数据 backfill；migration forward-only，只增不改；迁移验证 fresh DB + 既有 master 旧库 upgrade 两态（无旧 Entity 数据，upgrade 风险低，但仍按门禁跑）。
- 既有 `Story`/`StoryRevision`/`Entry`/`Topic` 结构不改；`Story` 增加 `storyEntities` 反向关系、`Entity` 增加关联反向关系（同 Task 11 `Story.topicMemberships` 的做法）。

取舍：Story↔Entity 与 Entity↔Entity 都用“当前关系表 + provenance 字段”，而非 append-only 事件表——查询 Story 涉及哪些 Entity、Entity 有哪些关系是详情页主路径，需要 O(1) 当前投影；历史只在审计字段里保留 actor/reason 与时间戳，v1 不重建关系历史链。

### 3. 公共边界：Product API command，不引入新 Workflow 类型

Entity/关系编排是单机本地事务 + 审计，不产生外部副作用，与 Task 10/11 Story/Topic 编排同形态：API command → Application 命令 → repository 事务 → 领域事件；自动路径（未来 Knowledge Workflow）必须走 Workflow，人工路径走 command，二者最终共用同一 Entity domain 语义。

待 Task 细化的命令形态（版本化、幂等键、revision CAS、输入校验先以 `unknown` 收口）：

- `entity.create`、`entity.update`（走不可变 revision 化）、`entity.add-alias`、`entity.remove-alias`；
- `story-entity.link`、`story-entity.unlink`（关联 Story 与 Entity，带 evidence/confidence）；
- `entity-relation.create`、`entity-relation.remove`（Entity↔Entity 类型化关系）；
- 读取扩展：`EntityDetail`（名字/类型/别名/revision + 关联 Story 列表 + 关系列表）、`EntitySummary`/列表；Story 详情可选附带“涉及 Entity”（最小可不做，待 Task 定）。

### 4. Web 最小验证面

- Entity 详情页：名字/类型/别名 + 关联 Story（含 evidence）+ 关系（from→type→to，含证据/置信度）+ 操作入口。
- 关联入口方向（沿用 Task 11 决策）：从 Story 详情/面板发起“关联 Entity / 创建 Entity 并关联本 Story”，规避“UI 不展示目标 ID”的可用性障碍；Entity 详情页不做“搜索 Story 添加关联”。
- 首页/侧栏提供最小 Entity 列表入口；视觉打磨不属本切片验收。
- 组件实验室登记对应场景；生产行为与 API 合同同步进 `docs/spec/`。

## 影响

- **产品/API**：新增 Entity/关系写命令与读取；既有 Feed/Story/Topic 路径不变；Story 详情可选扩展字段向后兼容。
- **数据**：新增 5 张表 + 一条 migration；不改既有表结构；`StoryEntity` 外键引用 `Story`/`Entity`，`EntityRelation` 双外键引用 `Entity`。
- **公开合同**：contracts 新增 Entity 类型/关系类型枚举、命令与详情/列表 schema；`storyKinds`/`topicMemberRoles`/Story DTO 不变。
- **安全**：本地单用户最大权限（沿用既有边界），写入口参数白名单化，不引入审批 UI；关系写入审计记录 actor、reason。
- **迁移/回滚**：migration forward-only；本切片无 merge/ID 重定向，回滚只回退代码路径，已建 Entity/关系数据保留。
- **发布**：本切片不涉及发布与部署（后置债）。

## 验收草案（设计通过后归 Task）

- **domain focused**：实体类型枚举校验与未知值降级；`EntityRevision` fingerprint/no-op/递增规则；关系类型枚举校验与未知值降级；Story↔Entity 与 Entity↔Entity 的 provenance 字段语义（producer/version/confidence/evidence）。
- **storage/迁移**：fresh + 旧库 upgrade；`(storyId, entityId)`、`(fromEntityId, toEntityId, relationType)`、`(entityId, name)` 唯一约束与并发写入；事务内关联/关系/别名落库。
- **contracts/API focused**：命令 Zod 校验、幂等键、CAS 冲突、白名单投影；`EntityDetail` 返回别名/关联 Story/关系列表。
- **浏览器**：从两个 Story 分别创建/关联同一 Entity → Entity 详情显示两个关联 Story；建立一条 Entity↔Entity 关系后详情可读方向/类型/证据；改名后出现新 Revision 且历史可查。
- **明确不运行**：Docker/Compose、发布部署、真实公网长时定时、非 Windows 平台 smoke、长时间故障恢复（Phase 1 后置债划线不变）。

## 对稳定文档的预期改动（接受后执行）

- `docs/requirements/0002-product-requirements.md`：ORG-003 注记 v1 已实现边界（自动识别/ORG-021、merge/dedup、`evidence_for`/`mentions` 后置）。
- `docs/architecture/0002-information-model.md` §2/§9：注记 v1 实现边界（Entity/Relationship 手动优先落地，自动识别与 Entry→Entity 抽取后置）。
- `docs/adr/`：新增 ADR-0008 Entity/关系 v1，沉淀稳定决定（实体类型受管枚举 + 未知降级、名字走不可变 `EntityRevision`、Story↔Entity/Entity↔Entity 用“当前关系 + provenance”而非 revision 链、关系类型受管枚举 + 未知降级、自动识别与 merge/dedup 后置）。
- `docs/spec/`：domain/0001（Entity 语义与 provenance 规则）、contracts/0001（新 DTO）、storage/0001（迁移与读写）、interfaces/0002 与 0005 同步；`docs/testing/README.md` 补充测试数据边界。
- 新建 Phase 2 Task（编号待维护者分配，建议 12）记录实施切片；本 Proposal 状态 reviewing → accepted 前不修改任何代码或稳定文档。

## 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-08 | Phase 2 下一切片 = Entity/关系；标签/批注/集合/Saved View、可配置看板不进本切片 | 用户 |
| 2026-09-08 | v1 切片范围 = 三层全做（实体本体 + Story↔Entity + Entity↔Entity）；提取方式 = 手动优先，自动识别后置 | 用户 |
| 2026-09-08 | **接受七项默认建议**：实体类型枚举六类 + 未知降级；名字走不可变 `EntityRevision`（fingerprint name+type）；名称别名用 `EntityAlias` 表不进 revision 链；Story↔Entity/Entity↔Entity 用「当前关系 + provenance」而非 revision 链；关系类型枚举 `founded`/`works_at`/`located_in`/`produced`/`part_of`/`related_to` + 未知降级；Entity merge/dedup 后置（本片只做名称别名）；`evidence_for`/`mentions` 继续后置 | 用户（评审接受） |
