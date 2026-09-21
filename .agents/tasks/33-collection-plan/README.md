# Task 33：采集计划 v1（AUT-010，一个连接下的多个计划）

> 编号 33 由 Agent 建议、待维护者确认。

## User Request / Topic

2026-09-20 维护者在 Phase 2 缺口复核后设定目标「按 [`Phase-2-UNDO.md`](../../../Phase-2-UNDO.md) 的缺口优先级完成第一个缺口」，第一个缺口是 P0-1 = AUT-010（一个连接下可以配置多个独立采集计划）。同日维护者审阅并确认 Proposal [`collection-plan-v1`](../../../docs/proposals/collection-plan-v1.md) 的 5 项待裁定（全部按建议），Proposal 转 `accepted`，稳定决定沉淀为 ADR [`0023`](../../../docs/adr/0023-collection-plan-v1.md)。

该请求是**非公开的维护者明确请求**，按 [`repository-workflow.md` 准入决策表](../../../docs/standards/repository-workflow.md#准入决策表) 的例外条款替代公开 Issue 的记录与实现授权；它不授权 commit、push、创建 PR、合并或其它外部操作。

## Goal

把架构 §4.6 已冻结、实现里一直缺席的 `CollectionPlan` 落地为用户可见的独立采集计划，让「一个连接下多个计划，各自的频率、预算、checkpoint 与失败状态互不混淆」第一次成立：

```text
CollectionPlan 实体（连接 + 目标 + 触发器 + 媒体预算 + 计划级 checkpoint/状态命名空间 + 重叠策略 + revision CAS）
-> 三步迁移（expand / backfill / read switch），既有来源回填为默认计划且用户可见行为不变
-> 计划级读投影与 API（列表 / 详情 / 运行入口）
-> 产品面：在连接下建出第二个计划，看到各自的频率与最近一次失败
-> 连接器选择与 schema 驱动表单（含 enum 与认证提示），Bilibili 双计划在产品面可建
-> 验收：同一连接两个计划的 Run、错误、重试与游标互不混淆
```

## Scope / Non-goals

Scope：

- **切片 1（数据面）**：`CollectionPlan` 模型与 migration；Run／WorkflowRun／Checkpoint 的计划引用；连接、触发器、媒体预算的归属迁移（backfill）；Worker 调度、ingest、checkpoint 提交、状态命名空间与产品查询的 read switch；计划的 CRUD 与读投影（contracts／API／transport）。
- **切片 2（计划管理面）**：Web 按连接分组的计划列表、新建计划时选连接与目标、计划级频率／预算／失败状态可见。
- **切片 3（连接器与表单）**：新建计划可选连接器（不再硬编码 RSS）、按 manifest schema 渲染字段（含 `enum` 与认证提示），使 Bilibili 计划能在产品面建出。
- **文档**：`docs/api/` Draft 的 v1 落地范围、行为落地后的 `docs/spec/`、`PROJECT-STATUS.md` 与 `Phase-2-UNDO.md` 的进度。

Non-goals（ADR-0023 已裁定后置）：

- 重叠策略除 v1 一种以外的值（`queue`／`replace`／`allow`／`merge`）；
- 同一采集目标被多个计划引用；
- 迁移第 4 步（contract：从来源移除连接／触发器／预算字段）——单独部署、单独授权；
- 自定义 Workflow 绑定（Phase 3）、AUT-004 事件类触发、多用户与连接共享；
- 计划级发现上下文的新持久字段（v1 由目标配置派生）。

## 权威合同

- Proposal [`collection-plan-v1`](../../../docs/proposals/collection-plan-v1.md)（accepted，2026-09-20）
- ADR [`0023`](../../../docs/adr/0023-collection-plan-v1.md)（采集计划 v1）
- 架构 [`part-04.md`](../../../docs/architecture/0001-cosmos-foundation/part-04.md) §4.6／§4.7；主文档 §19 决定 85、§21 不变量 63
- PRD AUT-010／AUT-009／EXT-007／ING-012（[`part-07-1.md`](../../../docs/requirements/0002-product-requirements/part-07-1.md)、[`part-07-3.md`](../../../docs/requirements/0002-product-requirements/part-07-3.md)）与勘误台账 [`ERRATA.md`](../../../docs/requirements/0002-product-requirements/ERRATA.md)
- API Draft [`0002`](../../../docs/api/0002-product-service-api.md) §4.3／§4.4、[`0003`](../../../docs/api/0003-product-dtos.md) 的 CollectionPlan DTO、[`0006`](../../../docs/api/0006-scenarios-and-conformance.md) 的双计划场景
- 既有 ADR：[`0017`](../../../docs/adr/0017-connection-secret-state-v1.md)（Connection／State）、[`0018`](../../../docs/adr/0018-trigger-sdk-v1.md)（TriggerBinding 与 manifest 命名空间）、[`0014`](../../../docs/adr/0014-per-source-media-policy-v1.md)（媒体预算字段语义）、[`0004`](../../../docs/adr/0004-source-instance-identity-and-revision.md)（来源身份与 revision CAS）

## Current State

- 生命周期阶段：**数据面切片已并入 master**（合并提交 `067428f`，`--no-ff`）。已完成切片 1a expand、1b backfill、1c-1a（来源与默认计划同批创建）、1c-1b（调度按计划取数、运行归属计划）、1c-2a（计划读接口）、1c-1c-a（媒体预算写穿透）；过程与验证记录见 [`walkthrough.md`](walkthrough.md)。
- 连贯目标：让「一个连接下的多个采集计划」成为真实对象并可在产品面配置。
- 可观察验收（≤3）：
  1. 回填后既有来源照常按原频率采集，全量测试与既有浏览器用例无回归；✅ 数据面已达成（合并后 master 全量测试 113 文件 / 654 用例全绿），浏览器用例未在本 Task 跑过。
  2. 同一连接下两个计划的 Run、错误、重试与游标互不影响（行为测试 + 真实来源验收）；⏳ 调度与运行归属已有行为测试，游标仍按来源，真实来源验收待切片 3。
  3. 不打开数据库就能在一个连接下建出第二个计划，并看到两个计划各自的频率与最近一次失败；⏳ 读接口已就绪，产品面待切片 2。
- 仍未切换（留在来源侧，属 1c-1c）：媒体策略的读取、启用状态、游标与状态命名空间。
- 剩余顺序已冻结为 **1c-1c → 切片 2 → 切片 3**；界面形态等 1c-1c 让计划行成为唯一事实后再定。
- 依赖：Task 22（Connection／StateStore）、Task 23（TriggerBinding 与 manifest 命名空间）、Task 02（SourceInstance／Checkpoint）。
- 受影响合同：Prisma schema 与 migration；contracts（计划 DTO／命令、Run 投影的计划引用）；application（调度与 ingest 的计划解析）；storage（repository）；API（计划端点）；transport（HTTP client）；Web（计划管理面与来源表单）。
- 预计核心文件：`packages/storage-prisma/prisma/schema.prisma` + 新 migration；`packages/contracts/src/`（计划合同与 `index.ts`）；`packages/application/src/`（`repository-port.ts`、`workflow-ingest.ts`、`workflow-control.ts`、`catalog.ts`）；`packages/storage-prisma/src/repository/`；`apps/worker/src/main.ts`、`apps/worker/src/scheduling.ts`；`apps/api/src/app.controller/`（新增计划 controller）；`packages/transport-http/src/`；`apps/web/src/app/`、`apps/web/src/components/cosmos/`、`apps/web/src/home/`。
- 验证层级：focused（contracts／storage／application／api／transport／web）→ 全量 `bun run test` → 迁移与回填行为测试 → 浏览器产品 E2E → 真实来源验收（Bilibili 双计划）。

## 实施切片

capability map（无环）：切片 1 → 切片 2 → 切片 3；切片 1 内部按 expand → backfill → read switch 顺序，每一步可独立合入与验证。

1. **切片 1a expand**：✅ 已交付并合入 master（计划表、contracts、四处可空计划列）。
2. **切片 1b backfill**：✅ 已交付并合入 master（默认计划与计划引用回填；状态命名空间重写按偏差记录移到 1c）。
3. **切片 1c read switch**：⏳ 部分交付并合入 master——调度、运行归属与计划读接口已切换（1c-1b／1c-2a）；媒体策略读取、启用状态、游标与状态命名空间仍按来源（1c-1c，下一轮，分支 `feat/t33-plan-read-switch`）。
4. **切片 2 计划管理面**：⏳ 未开始（Web 连接下多计划的创建与查看）。验收：浏览器 E2E。
5. **切片 3 连接器与表单**：⏳ 未开始（连接器选择 + schema 驱动字段）。验收：产品面建出 Bilibili 双计划并跑真实来源。

每片开工前在 [`walkthrough.md`](walkthrough.md) 记录当轮切片与仍有后果的假设；本 README 只维护当前摘要，过程、偏差与验证记录写入 walkthrough。

## Decisions and Deviations

- 计划模型与迁移顺序按 ADR-0023 执行，不在本 Task 重新讨论；实现若发现 ADR 与代码冲突，先记录证据再回到 ADR／Proposal 修订，不用兼容层绕过。
- 计划与目标 v1 一对一；API Draft 里 `CollectionPlanDetail` 的 `scope`／`sourceOperationRef` 在 v1 是目标的只读投影，不是计划自有字段。
- 重叠策略 v1 只接受一种值，其它值显式拒绝并说明尚未实现；API Draft 的完整枚举保留为目标合同。
- 发现上下文 v1 不新增持久字段，由目标配置派生；API Draft 的 `discoveryContext` 细节留待后续切片。
- v1 手动运行沿用 `POST /sources/{id}/runs`，计划级运行路由后置（已写入 API Draft §4.3 的 v1 落地范围）。
- 待实现期决定的项（记录在此，不静默选择）：`PATCH /sources/{id}` 与 `PATCH /collection-plans/{id}` 的字段边界（连接、调度、媒体预算的写入入口），在 1c-1c 冻结并同批更新 API Draft。
- 连接器状态命名空间的 manifest 默认模板由 `source:{id}` 改为 `plan:{id}`（2026-09-20 决定）：ADR-0023 决策 2 的「模板语义不变」按**解析对象**不变理解（仍是单一 `{id}` 占位、仍由 manifest 声明），字面前缀随归属改为 `plan`；照字面只换 `{id}` 取值会得到 `source:plan:<sourceId>`，前缀与实际含义相反。

## Implementation Walkthrough

过程、偏差与验证记录写入同目录 [`walkthrough.md`](walkthrough.md)（append-only）；本节不重复其证据。

## Verification / Gate

合并后的 master 全绿：`typecheck` 0、全量测试 113 文件 / 654 用例、`docs:check` 721 文件 0 失败、`db:validate` 通过、`size-governance --fail-on-new` PASS。命令、结果与未运行项见 [`walkthrough.md`](walkthrough.md) 的合并记录；未运行项为 `test:e2e`、浏览器产品 E2E 与真实来源验收。

## Follow-ups

- 迁移第 4 步（contract）单独排期与授权。
- 重叠策略其余值与「同一目标多个计划」按 ADR-0023 的 Revisit Gate 重新评估。
- 切片 3 顺带收口 EXT-006 的「按声明展示配置」半边与 AUT-009 的连接可见性／绑定入口（对应 [`Phase-2-UNDO.md`](../../../Phase-2-UNDO.md) 的 P1-2、P1-3）。
- Task 编号待维护者确认。
