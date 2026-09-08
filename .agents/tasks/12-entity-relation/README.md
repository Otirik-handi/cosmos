# Task 12：Entity/关系 v1（Phase 2 第三切片）

## User Request / Topic

2026-09-08 用户确认：Phase 2 下一切片为 Entity/关系；Proposal [`entity-relation-v1`](../../../docs/proposals/entity-relation-v1.md) 经评审接受（七项默认建议），稳定决定沉淀于 [`ADR-0008`](../../../docs/adr/0008-entity-relation-v1.md)，PRD §7.5 第三切片注记与信息模型 §9 已同步。

## Goal

交付 PRD §7.5「Story、Topic、Entity 与关系」与 ORG-003 的知识关系层（手动优先）：

```text
Entity name/type -> 不可变 EntityRevision（fingerprint/当前指针）+ EntityAlias 名称别名
(Story, Entity) 关联 -> provenance（producer/version/confidence/evidence/actor/reason）
(fromEntity -> relationType -> toEntity) 类型化关系 -> provenance
用户编排 -> create/update/别名/关联/关系 + 列表/详情
```

## Scope / Non-goals

Scope：

- Entity 实体 + 不可变 `EntityRevision`（确定性 fingerprint、无实质变化 no-op、当前指针）+ 名称别名 `EntityAlias`。
- 实体类型受管枚举 `person`/`organization`/`product`/`project`/`model`/`location`，未知值降级读取。
- Story↔Entity 关联（`(storyId, entityId)` 唯一 + provenance）。
- Entity↔Entity 类型化关系（`(fromEntityId, toEntityId, relationType)` 唯一 + provenance）；关系类型受管枚举 `founded`/`works_at`/`located_in`/`produced`/`part_of`/`related_to`，未知值降级读取。
- Product API 写命令（create/update/别名/关联/关系）与读取（Entity 详情含别名/关联 Story/关系列表/列表）。
- Web：Entity 详情页（名字/类型/别名 + 关联 Story + 关系 + 操作）+ 从 Story 面板发起「关联/创建 Entity」+ Entity 列表入口。

Non-goals（见 Proposal / ADR-0008）：

- 自动 Entity 识别/抽取、`KnowledgeSignal`/Knowledge Workflow（ORG-021，LLM/Agent 后置）。
- Entity merge/dedup（ID 归并，本切片只做名称别名）；`evidence_for`/`mentions` 跨 Story 引用（ORG-011）。
- Label/Annotation/Collection/Saved View（LIB-003/004/005）、可配置 Board/Section/Block、Spotlight（BRD-002~008）、`TopicRelation`（ORG-015）。
- 混合召回/推荐排序（REC-009/012 Phase 4）。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`entity-relation-v1`](../../../docs/proposals/entity-relation-v1.md)（accepted，2026-09-08）。
- ADR [`0008`](../../../docs/adr/0008-entity-relation-v1.md)；ADR [`0006`](../../../docs/adr/0006-story-domain-v1.md)/[`0007`](../../../docs/adr/0007-topic-domain-v1.md)（复用 Revision/alias/command 模式）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) ORG-003/021、REC-008/009/012、§7.5 第三切片注记。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §2「知识关系」、§4.5、§9。
- 现状 spec：domain/0001（Story 语义）、contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10/11 交付，本切片扩展）。

## 实施切片（capability map，无环依赖）

1. **切片 1：Entity 域语义 + 持久化**（domain + migration + storage，无公共面）
   - domain：`entityTypes`/`entityRelationTypes` 受管枚举 + 未知降级、`fingerprintEntityRevision`、Story↔Entity/Entity↔Entity 的 provenance 字段语义、Entity 命令输入语义；
   - Prisma：`Entity`/`EntityRevision`/`EntityAlias`/`StoryEntity`/`EntityRelation` + migration（forward-only、只增不改）；
   - storage 事务命令：create/update Entity、别名 add/remove、Story↔Entity link/unlink、Entity↔Entity relation create/remove；
   - 行为测试覆盖 fresh/旧库 upgrade 两态，及 `(storyId, entityId)`、`(fromEntityId, toEntityId, relationType)`、`(entityId, name)` 唯一约束与并发写入。
2. **切片 2：公共合同与 Product API**（contracts + transport-http + apps/api）
   - Entity 类型/关系类型枚举、命令 schema（版本化、幂等、revision CAS）与 `EntityDetail`/`EntitySummary` DTO；
   - API 写端点与读取扩展；focused + API 集成验收。
3. **切片 3：Web**（apps/web）
   - Entity 详情页（名字/类型/别名 + 关联 Story + 关系 + 操作）、Entity 列表入口；
   - Story 面板扩展「关联 Entity / 创建 Entity 并关联本 Story」；
   - 组件实验室登记 + 浏览器验收。

## Current State

- 生命周期阶段：Proposal accepted，稳定文档已同步（PRD §7.5 第三切片注记、信息模型 §9 v1 注记、ADR-0008、ADR 索引、Task 12 README）；未开始实现；待维护者授权创建 worktree 与分支 `feat/t12-entity-relation` 后进入切片 1。

## Decisions and Deviations

- 以 ADR-0008 五条为稳定边界（实体类型受管枚举 + 未知降级、名字走不可变 `EntityRevision`、Story↔Entity/Entity↔Entity 用「当前关系 + provenance」、关系类型受管枚举 + 未知降级、自动识别与 merge/dedup 后置）。
- 切片顺序沿用 Task 10/11：存储/领域 → 契约/API → Web，每切片独立验收。

## Verification / Gate

- 每切片按仓库验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器；全量门禁至少 typecheck、docs:check、test、build、git diff --check。
- 迁移类改动必须在 `.agent/tmp/` 用含旧数据的隔离库验证 upgrade（本切片为全新表，仍跑 upgrade 两态）。
- `docs/spec/` 在行为落地后同步（domain/0001 扩展、contracts/0001、storage/0001、interfaces/0002/0005）与 `docs/testing/README.md`。

## Follow-ups

- 浏览器产品 E2E（Entity/关系流程）与人工浏览器验收留待后续。
- 后续 Phase 2 切片：Label/Annotation/Collection/Saved View、可配置 Board/Spotlight、自动聚类/Knowledge Workflow、Entity merge/dedup、`evidence_for`/`mentions`。
