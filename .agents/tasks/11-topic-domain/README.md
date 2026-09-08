# Task 11：Topic 域模型 v1（Phase 2 第二切片）

## User Request / Topic

2026-09-08 用户确认：Phase 2 下一切片为 Topic/Topic Membership；Proposal [`topic-domain-v1`](../../../docs/proposals/topic-domain-v1.md) 经评审接受（四项默认建议），稳定决定沉淀于 [`ADR-0007`](../../../docs/adr/0007-topic-domain-v1.md)，PRD §7.5 第二切片注记与信息模型 §5 已同步。

## Goal

交付 PRD §9.2「用户能按 Topic 浏览」与示例验收「用户能创建/关注一个 Topic，把多个 Story 组织在一起」：

```text
Topic title/purpose/scope -> 不可变 TopicRevision（fingerprint/当前指针）
(Topic, Story) 成员关系 -> 受管枚举角色 + 纳入理由 + 不可变 membership revision/tombstone
用户编排 -> create/update Topic、成员增删改角色/恢复、merge canonical+alias
Story merge -> 同步迁移 membership 到 canonical
```

## Scope / Non-goals

Scope：

- Topic 实体 + 不可变 `TopicRevision`（确定性 fingerprint、无实质变化 no-op、当前指针）。
- `TopicMembership` 当前关系（`(topicId, storyId)` 唯一）+ 不可变 `TopicMembershipRevision`（role/reason/actor/tombstone，移除可恢复）。
- 成员角色受管枚举 `core`/`update`/`background`/`analysis`/`counterpoint`/`tutorial`，未知值降级读取。
- Topic merge：canonical + obsolete alias/redirect，成员去重迁移（canonical 当前角色保留、obsolete 独有成员迁入）。
- `Story merge` 扩展：同一事务迁移指向 obsolete Story 的 membership 到 canonical（ORG-020 merge 侧）。
- Product API 写命令（create/update/merge/成员命令）与读取（Topic 详情成员列表/列表）。
- Web：Topic 详情页（成员角色分组 + 理由/actor + 操作）+ 从 Story 面板发起「加入 Topic/创建 Topic」+ Topics 列表入口。

Non-goals（见 Proposal / ADR-0007）：

- Agent 自动创建 Topic、自动成员维护、`TopicMaintenanceBinding`（ORG-007 Phase 3）。
- Entity/Relationship、`TopicRelation`、Topic 父子层级、标签（ORG-015；Entity 由用户排除）。
- Spotlight/Board/Section/Block/Subscription（后续看板切片）、归档。
- Story/Topic split、`evidence_for`/`mentions` 跨 Story 引用。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`topic-domain-v1`](../../../docs/proposals/topic-domain-v1.md)（accepted，2026-09-08）。
- ADR [`0007`](../../../docs/adr/0007-topic-domain-v1.md)；ADR [`0006`](../../../docs/adr/0006-story-domain-v1.md)（复用 Story Revision/alias/command 模式）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) §7.5 第二切片注记与 ORG-002/006/008/009/012/015/016/020。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §5（Topic 语义）与 §4.6（merge canonicalization）。
- 现状 spec：domain/0001（Story 语义）、contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10 交付，本切片扩展）。

## 实施切片（capability map，无环依赖）

1. **切片 1：Topic 域语义 + 持久化**（domain + migration + storage，无公共面）
   - domain：`topicMemberRoles` 受管枚举 + 未知降级、`fingerprintTopicRevision`、membership 去重/merge 规则、topic 命令输入语义；
   - Prisma：`Topic`/`TopicRevision`/`TopicMembership`/`TopicMembershipRevision`/`TopicAlias` + migration（forward-only、只增不改）；
   - storage 事务命令：create/update Topic、成员 add/updateRole/remove/restore、mergeTopics；`mergeStories` 扩展同步迁移 membership；
   - 行为测试覆盖 fresh/旧库 upgrade/既有 `story:*` 数据三态，及 `(topicId, storyId)` 唯一与 merge 去重冲突用例。
2. **切片 2：公共合同与 Product API**（contracts + transport-http + apps/api）
   - Topic 命令 schema（版本化、幂等、revision CAS）与 `TopicDetail`/`TopicSummary` DTO；
   - API 写端点与读取扩展；focused + API 集成验收。
3. **切片 3：Web**（apps/web）
   - Topic 详情页（成员角色分组 + 理由/actor + 改角色/移除/恢复）、Topics 列表入口；
   - Story 面板扩展「加入 Topic/创建 Topic」；
   - 组件实验室登记 + 浏览器验收。

## Current State

- 生命周期阶段：三切片（domain/migration/storage → contracts/transport/API → Web）已实现并通过各自聚焦验收与全量门禁；分支 `feat/t11-topic-domain`，待维护者授权合入 master。过程记录见 [walkthrough.md](walkthrough.md)。

## Decisions and Deviations

- 以 ADR-0007 五条为稳定边界（TopicRevision 同构、membership 当前关系 + revision 链、merge canonical/alias、Story merge 迁移 membership、人工 command 路径自动路径后置）。
- 切片顺序沿用 Task 10：存储/领域 → 契约/API → Web，每切片独立验收。

## Verification / Gate

- 每切片按仓库验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器；全量门禁至少 typecheck、docs:check、test、build、git diff --check。
- 迁移类改动必须在 `.agent/tmp/` 用含旧数据的隔离库验证 upgrade/backfill（本切片为全新表，仍跑 upgrade 两态）。
- `docs/spec/` 在行为落地后同步（domain/0001 扩展、contracts/0001、storage/0001、interfaces/0002/0005）与 `docs/testing/README.md`。

## Follow-ups

- 浏览器产品 E2E（Topic 流程）与 `test:browser:component-lab` 未运行（组件实验室/API/存储行为测试已覆盖主路径）；人工浏览器验收留待后续。
- 后续 Phase 2 切片：Entity/关系、标签/批注/集合/Saved View、可配置 Board/Spotlight、自动聚类/Knowledge Workflow、`TopicMaintenanceBinding`/Spotlight。
