# ADR-0008：Entity/关系 v1（Entity 版本化、Story↔Entity 关联与 Entity↔Entity 类型化关系）

> 状态：Accepted design contract
>
> 日期：2026-09-08
>
> 关联：[`entity-relation-v1 Proposal`](../proposals/entity-relation-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §2/§4.5/§9、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ORG-003/ORG-021/REC-008/009/012、ADR [`0006`](0006-story-domain-v1.md) 与 [`0007`](0007-topic-domain-v1.md)（本切片复用其 revision/alias/command 模式）

## Context

Task 10/11 已交付 Story 与 Topic 域模型：多成员 Story、版本化 `StoryRevision`、merge canonical/alias，以及 Topic 版本化 + Membership revision。PRD §7.5「Story、Topic、Entity 与关系」要求“系统识别人、组织、产品、项目、模型和地点等 Entity，并保存带依据的关系”（ORG-003）；推荐与“相关内容”信号依赖“共享 Entity、关系图”（REC-008/009）。信息模型 §2 已把 Entity/Relationship 冻结为「知识关系」层（人、组织、产品以及有依据的关联），§9 关系图里 Entity 有 `Entry→N`、`Story→N` 两条边，另有实体间类型化关系。当前 schema 无任何 Entity/关系模型。

2026-09-08 用户对齐：Phase 2 下一切片 = Entity/关系；v1 三层全做（实体本体 + Story↔Entity + Entity↔Entity）；提取方式手动优先；评审接受七项默认建议（见 Decision）。本文沉淀这些稳定决定。

## Decision

### 1. 实体类型受管枚举 + 未知降级

`entityTypes = person/organization/product/project/model/location`（ORG-003 六类）。写入侧受管枚举校验，读取侧未知值降级展示，同 `storyKinds`/`topicMemberRoles` 模式。

### 2. Entity 名字走不可变 `EntityRevision`

规范名 `name` 走不可变 Revision：确定性 fingerprint 覆盖 `{name, type}`，展示字段实质变化才追加 revision、无实质变化的更新命令 no-op、当前指针指向当前表示。`type` 去规范化在 `Entity` 表（同 Story 的 kind/subtype）。名称别名用 `EntityAlias` 表（`(entityId, name)` 唯一），add/remove 是离散命令、不进 revision 链——别名是名称解析用的操作数据，不是展示内容。

### 3. Story↔Entity 与 Entity↔Entity 用“当前关系 + provenance”

一条 `(storyId, entityId)` 唯一关联表达“Story 涉及 Entity”；一条 `(fromEntityId, toEntityId, relationType)` 唯一表达类型化关系。两者都保存 producer/version/confidence/evidence 与 actor/reason，不建 revision 链（没有角色频繁变化的历史诉求，比 Topic membership 更简单）。手动优先：v1 只由人工命令写入，provenance 字段已就位，未来自动识别落地时无需迁移即可写入 agent 派生关系。

### 4. 关系类型受管枚举 + 未知降级

`entityRelationTypes = founded/works_at/located_in/produced/part_of/related_to`，直接对应 PRD 示例“Jeff Dean 创立 Discovery Loop”“Jeff Dean 参与过的组织、职位变化”。未知值读取降级展示，扩展不破坏旧客户端。

### 5. 自动识别与 merge/dedup 后置

自动 Entity 识别/抽取（ORG-021 的 Knowledge Workflow，依赖 LLM/Agent）后置；Entity merge/dedup（同一实体录入两次时的 ID 归并）后置，本切片只做名称别名；`evidence_for`/`mentions`（ORG-011）继续后置。Entity/关系编排是单机本地事务 + 审计、无外部副作用，以“Product API command → Application 命令 → repository 事务 → 审计/领域事件”落地，不新增 durable Workflow/Action 类型；未来自动路径必须走 Workflow，人工路径走 command，二者共用同一 Entity domain 语义。

## Consequences

### Positive

- Phase 2 的推荐与“相关内容”信号第一次有 Entity/关系落点：`Story↔Entity` 与 `Entity↔Entity` 关系图成为可检索的数据基础（REC-008/009 的 Phase 4 消费方）。
- 契约改动边界清晰：先动 domain/storage/contracts/API，UI 只做最小 Entity 详情 + 从 Story 侧发起的关联。
- 复用 ADR-0006/0007 已验证的 Revision/alias/command 模式，实现与测试形态一致，不引入第二套写入语义。
- provenance 字段（producer/version/confidence/evidence）前瞻兼容自动识别，无需二次迁移。

### Costs and risks

- v1 只有人工创建与人工关系编排，在 Knowledge Workflow 上线前没有“系统自动识别实体”体验；这是接受的顺序取舍。
- merge/dedup 后置导致同一实体可能被录入多次，需后续归并切片处理。
- 5 张新表（Entity/EntityRevision/EntityAlias/StoryEntity/EntityRelation）带来额外读写成本；但都沿用既有模式。

## Alternatives considered

### 自动识别进 v1

拒绝。自动 Entity 识别依赖 Knowledge Workflow（ORG-021）与 LLM/Agent，超出本切片范围；v1 先交付可手工维护的知识关系骨架，provenance 字段已预留。

### Entity↔Entity 关系类型使用自由文本

拒绝。自由文本无法稳定分组/校验，无法按类型结构化展示；受管枚举 + 未知降级更稳，且 PRD 示例已给出明确关系语义。

### Story↔Entity / Entity↔Entity 建 revision 链

拒绝。这两类关系没有“角色频繁变化”的历史诉求（区别于 Topic membership），用“当前关系 + provenance”更简单；审计由 actor/reason/时间戳覆盖。

### Entity merge/dedup 进 v1

拒绝。关系重映射（Story↔Entity、Entity↔Entity 都要迁到 canonical）复杂，先做名称别名，ID 归并另开切片。

### 用 TopicMembership 式 revision 链表达 Entity 关系

拒绝。语义不同：Entity 关系没有“角色”概念，也没有“单一当前角色 + 历史角色”的诉求；套用 membership 模式会制造不必要的复杂度。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 开始 Knowledge Workflow/自动 Entity 识别（ORG-021），需要定义自动关系写入的 actor/接受边界与“人工修正不被重分析覆盖”的落地语义；
- 设计 Entity merge/dedup，需要定义 canonical/alias 与 Story↔Entity/Entity↔Entity 的关系重映射；
- 引入 `evidence_for`/`mentions`（ORG-011），需要与 Story↔Entity 的边界统一；
- 混合召回/推荐排序开始消费 Entity/关系（REC-009/012 Phase 4），需要定义关系图查询投影与索引。
