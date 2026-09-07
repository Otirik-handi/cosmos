# Task 10：Story 域模型 v1（Phase 2 首切片）

## User Request / Topic

2026-09-07 用户确认：Phase 2 首切片为 Story 域模型；Proposal [`story-domain-v1`](../../../docs/proposals/story-domain-v1.md) 经评审接受，稳定决定沉淀于 [`ADR-0006`](../../../docs/adr/0006-story-domain-v1.md)，PRD §7.5 注记与信息模型 v0.12 已同步。

## Goal

把 Phase 1 的“一个 Entry 一个 Story”最小投影升级为稳定、可版本化、可人工编排的 Story 域对象，交付 PRD Phase 2 验收主句“用户能打开一个多来源 Story”：

```text
跨来源 Entry -> 同一 Story（主归属）
Story title/summary/kind/subtype -> 不可变 Story Revision（版本号/指纹/当前指针）
用户编排 -> move entry / update Story Revision / merge canonical+alias
```

## Scope / Non-goals

Scope：

- `StoryRevision` 版本化：revision 编号、fingerprint、actor/理由，backfill 既有数据为 revision 1。
- Entry 主归属移动（move entry）与 Story merge（canonical ID + 旧 ID alias/redirect，历史不删除）。
- kind/subtype 受管核心枚举与未知 subtype 降级读取。
- Product API 的 Story 编排写命令与 Story 详情多 Entry 返回。
- Web 最小多来源 Story 详情与操作入口。

Non-goals（见 Proposal / ADR-0006）：

- 自动聚类、LLM/Knowledge Workflow、Proposal/接受流程。
- Topic/Topic Membership、Entity/Relationship、Label/Annotation/Collection/Saved View。
- Story split 完整生命周期（历史壳、`replaced_by[]`、状态迁移）。
- `evidence_for`/`mentions` 跨 Story 引用、动态插件 subtype 注册表、可配置 Board/Spotlight。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`story-domain-v1`](../../../docs/proposals/story-domain-v1.md)（accepted，2026-09-07）。
- ADR [`0006`](../../../docs/adr/0006-story-domain-v1.md)。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) §7.5 注记与 ORG-001/004/011/012/013/017/020/022。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) v0.12 §1/§4.3/§4.7。
- 现状 spec：domain/0001（Story projection）、contracts/0001、storage/0001、interfaces/0002 与 0005。

## 实施切片（capability map，无环依赖）

1. **切片 1：Story 域语义 + 持久化**（domain + migration + storage，无公共面）
   - Story Revision 版本化与 backfill；
   - move entry 主归属、update Story Revision、merge canonical/alias 的事务命令与读取；
   - 行为测试覆盖 fresh/旧库/既有 `story:*` 数据三态。
2. **切片 2：公共合同与 Product API**（contracts + transport-http + apps/api）
   - Story 命令 schema（版本化、幂等、revision CAS）与详情多 Entry DTO；
   - API 写端点与读取扩展；focused + API 集成验收。
3. **切片 3：Web 多来源 Story 详情与操作入口**（apps/web）
   - Story 详情成员列表、归并/编辑/merge 操作；
   - 组件实验室登记 + 浏览器验收。

## Current State

- 生命周期阶段：计划完成，进入切片 1；基线 = worktree `.worktree/story-domain` / 分支 `feat/t10-story-domain`，base `6f6651d`（master 最新）。
- 尚无代码改动；文档基线（Proposal accepted、ADR-0006、PRD/架构同步）已在 master 提交 `6f6651d` 并推送 fork。

## Decisions and Deviations

- 以 ADR-0006 六条为稳定边界（主归属单外键、Revision 最小字段集 + fingerprint、merge 进 v1、split/自动聚类后置、人工命令路径、自动路径复用同一 domain 语义）。
- 切片顺序从存储/领域开始，再契约/API，再 Web；每个切片独立验收，不把“公共 API 端点 + DTO + 首个消费者”拆到不可独立合入的层。

## Verification / Gate

- 每切片按仓库验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器；全量门禁至少 typecheck、docs:check、test、build、git diff --check。
- 迁移类改动必须在 `.agent/tmp/` 用含旧数据的隔离库验证 upgrade/backfill，不只跑 fresh DB。
- `docs/spec/` 只在行为落地后同步（切片 1 落存储/domain 行为、切片 2 落 API/DTO、切片 3 落 Web client）。

## Follow-ups

- 切片验收后同步 `docs/spec/domain/0001`、`contracts/0001`、`storage/0001`、`interfaces/0002/0005` 与 testing README。
- 更新 PROJECT-STATUS（合入 master 后）。
- 后续 Phase 2 切片：Topic、Entity/关系、标签/批注/集合/Saved View、可配置看板、自动聚类/Knowledge Workflow。
