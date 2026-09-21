# Proposal：CollectionPlan（一个连接下的多个采集计划）v1

> 状态：`accepted`
>
> 日期：2026-09-20
>
> 缺口来源：[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) 的 P0-1（AUT-010）
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) AUT-010、AUT-009、EXT-007、ING-012；用户原话见 [`0001-original-requirements.md`](../requirements/0001-original-requirements.md)「2026-08-06：第一轮需求和能力」第 4 条
>
> 关联设计：架构 [`part-04.md`](../architecture/0001-cosmos-foundation/part-04.md) §4.6（Connection、State 与采集计划）、§4.7（产品配置入口）；ADR [`0017`](../adr/0017-connection-secret-state-v1.md)（Connection/Secret/State）、ADR [`0018`](../adr/0018-trigger-sdk-v1.md)（TriggerBinding）
>
> 关联既有切片：Task [`22`](../../.agents/tasks/22-connection-state-store/README.md)（Connection/StateStore）、Task [`23`](../../.agents/tasks/23-trigger-sdk/README.md)（Trigger/manifest）

## 1. 问题

PRD AUT-010 要求：**一个连接下可以配置多个独立采集计划，每个计划拥有自己的来源操作、范围、频率、预算、checkpoint、发现上下文和失败状态**；验收是「同一 Bilibili 账号可以独立配置『动态每 30 分钟』和『推荐流每 2 小时』，两者的 Run、错误、重试和游标互不混淆」。用户原话是同一件事：Bilibili 等平台账号的**主页推荐**「可能每个小时就录入一批」，**关注用户**「频率可能高一点」。

架构 §4.6 已经把目标模型冻结成一张分工表（Provider / Adapter / ConnectionInstance / SourceInstance / Trigger / WorkflowBinding / CollectionPlan），并写明：

> 同一个 `ConnectionInstance` 可以被多个 `CollectionPlan` 引用。每个计划把 Source Operation、Trigger、WorkflowBinding、checkpoint namespace、发现上下文、预算、错误、重试和重叠策略组合为独立边界……用户配置采集计划，不直接配置 Worker。

但实现里**没有** `CollectionPlan` 这个对象：全仓没有对应模型、表和产品入口。架构 §4.7 第 2 条记录了 Phase 1 的收窄：「本切片以一个 SourceInstance 保存……不新增独立 `CollectionPlan` 持久对象……`CollectionPlan` 仍是后续扩展边界」。

所以本 Proposal 要裁定的不是「要不要做」，而是**v1 做到哪一层、怎么迁移、产品面给谁看**。AUT-010 的性质是「已冻结的架构合同尚未落地」，不是新增需求。

## 2. 目标与非目标

### 目标（v1）

1. 落地 `CollectionPlan`：用户可见的独立采集计划，持有连接、触发器、预算与计划级 checkpoint／状态命名空间，为 Run、错误、重试和游标提供独立边界。
2. 为既有来源回填默认计划：迁移**不改变现有用户可见行为**（一个来源照常采集、照常显示）。
3. 产品面：在连接下创建、查看和管理多个计划，计划级频率、预算与失败状态可见。
4. 验收：AUT-010 的 Bilibili 双计划场景有可执行证据（两个计划共用一个连接、不同频率、互不混淆）。

### 非目标（本切片明确后置）

- 重叠策略的完整枚举（`forbid`/`queue`/`replace`/`allow`/`merge`）：v1 只保留与现状等价的一种（见决策 3）。
- 用户自定义 Workflow 绑定：`WorkflowBinding` 固定 `cosmos.ingest@1`，自定义 Workflow 属 Phase 3。
- AUT-004 的 Webhook／内部事件／上游 Workflow 触发：触发形态仍只有 schedule／manual。
- 同一采集目标被多个计划引用（v1 计划与目标一对一；随重叠策略后置）。
- 多用户、多租户与连接共享权限。

## 3. 当前行为与证据

### 3.1 计划要素今天各自挂在哪【代码核实】

| 计划要素（§4.6） | 现在由什么承载 | 结论 |
| --- | --- | --- |
| 来源操作 | `SourceInstance.operationId` + `config` | 有，但挂在「目标」而不是「计划」上 |
| 范围 | `SourceInstance.configJson`（RSS `feedUrl`；Bilibili `mode`/`profile`/`limit`） | 同上 |
| 频率 | `TriggerBinding`（`sourceId` 唯一，一条当前绑定） | 有 |
| 预算 | `config.media`（按来源的图片开关、单文件／单次预算） | 有 |
| checkpoint | `Checkpoint.sourceInstanceId`（唯一） | 有 |
| 状态命名空间 | manifest 的 `stateStoreNamespace`（默认 `source:{id}`），Worker 按来源解析 | 有 |
| 发现上下文 | manifest `discoveryContext` 全为空串；实际由 `config.mode` 在采集时派生 | 隐式，未声明 |
| 失败状态 | `SourceInstance.lastError` + Run 的 `errorCode`/`errorMessage` + 来源健康 | 有 |
| 重叠策略 | 无；调度按 `schedule:{sourceId}:{bucket}` 幂等键去重 | 缺 |
| 一个连接下多个计划 | `SourceInstance.connectionId`（可空、无唯一约束） | 数据面允许 |

### 3.2 数据面已经做到的隔离

- Run、WorkflowRun、Observation、Entry 都以来源为归属，两个来源的 Run、错误、重试与游标**天然不混**。
- 两个 Bilibili 来源可以共用一个连接：创建来源的命令不接受 `connectionId`，但更新来源的命令可以设置（API 可用）。
- 媒体预算、保留期、失败重试都按来源配置。

也就是说，**AUT-010 的验收场景在数据面今天就能表达**：两个来源（`mode=feed` 每 30 分钟、`mode=hot` 每 2 小时）指向同一个连接。缺的不是隔离能力。

### 3.3 产品面：验收场景今天不可达【代码核实】

1. Web 新建来源**硬编码 RSS**：`apps/web/src/home/use-source-workspace.ts` 写死 `RSS_SOURCE_DEFINITION_REF` / `RSS_OPERATION_ID`，表单 schema 强制 `feedUrl`。
2. manifest 驱动只渲染 `string`/`integer` 字段，`enum` 被跳过：Bilibili 的 `mode`（hot/feed）在表单里**没有入口**。
3. **没有连接绑定入口**：`connectionId` 只能通过 API 设置，产品面无法把两个计划挂到同一个连接上。
4. **没有「计划」视角**：来源列表平铺，看不出「这个连接下有哪几个计划、各自的频率和最近一次失败」。

结论：产品面连一个 Bilibili 计划都建不出来，更谈不上两个。这正是 AUT-010 与 Phase-2-UNDO 的 P1-3（连接可见性与绑定）叠在一起的原因。

## 4. 方案与取舍

### 决策 1：v1 计划模型

- **方案 A（推荐）**：按架构 §4.6 落地 `CollectionPlan`，v1 与采集目标一对一。
  计划持有：连接引用（可空）、目标引用、触发器（一对一）、媒体预算、计划级 checkpoint 与状态命名空间、重叠策略（v1 只有一种）、启用状态与 revision；Run／WorkflowRun 增加计划引用，Entry／Observation 仍归目标。
  收益：与已冻结架构一致；「用户可见的独立采集计划」成为真实对象；未来「同一目标多个计划」不需要再迁移一次。
  代价：一次真实迁移（见决策 2）。
- **方案 B**：不建实体，把「计划」当作来源的产品视角（零迁移），并把架构 §4.6／§4.7 的收窄登记成勘误。
  收益：最省，能马上补产品面。
  代价：与已冻结架构冲突；连接、触发器、预算、checkpoint 继续挂在目标上，「计划」永远只是文案；未来仍要迁移。
- **方案 C**：只建计划行、不迁触发器与 checkpoint（纯展示对象）。**拒绝**：会出现「计划」与「来源」两套并行状态，谁拥有触发器与游标说不清（违反架构 §3.6「展示角色不污染领域模型」）。

### 决策 2：迁移路径（按仓库迁移合同分四步）

1. **expand**：新增计划表；Run／WorkflowRun／Checkpoint 增加可空计划列；不动旧列。
2. **backfill**：为每个既有来源生成一个默认计划（继承连接、触发器、预算），回填既有 Run／WorkflowRun／Checkpoint 的计划引用；状态命名空间按 `source:{id}` → 计划命名空间重写（状态可重建，重写只为避免多余的一次全量抓取）。
3. **read switch**：Worker 调度、ingest、checkpoint 提交、状态命名空间与产品查询全部改读计划；旧列保留但不再写。
4. **contract**：读取切换稳定并经过一次部署后，再决定是否从来源上移除连接／触发器／预算字段。**单独部署、单独授权**，不属于 v1 完成条件。

v1 的完成定义 = expand + backfill + read switch + 产品面 + 验收；contract 另排。

### 决策 3：重叠策略

v1 只实现与现状等价的一种（同一计划上一轮未结束时，到点不重复入队），合同只接受这一个值，其它值显式拒绝并说明「尚未实现」。架构 §4.6 预留的 `queue`／`replace`／`allow`／`merge` 不变，随后续切片补齐。

### 决策 4：产品面范围（三个切片）

1. **数据面**：计划实体 + 迁移 + Worker／API 接线。验收 = 既有测试全绿 + 双计划隔离的行为测试。
2. **计划管理面**：新建计划时选连接与目标；计划列表按连接分组；计划级频率、预算、失败状态可见。
3. **连接器选择与 schema 驱动表单**（含 `enum` 字段与认证提示）：让 Bilibili 计划能在产品里建出来。没有切片 3，AUT-010 的验收场景无法在产品面复现。

切片 3 同时闭合 Phase-2-UNDO 的 P1-3（来源↔连接绑定）与 EXT-006 的「按声明展示配置」半边。是否并入本 Task 见待裁定项 2。

### 决策 5：术语

架构把用户可见对象叫「采集计划」，仓库已定用户词是「来源」（术语表 A 组）。两者今天指同一个东西，必须二选一：

- **选项 a（推荐）**：产品面把这一层叫「采集计划」，「来源」保留为内容出处（Feed 卡片上的来源名、来源健康）；与架构一致，但要与 [`ui-copy-review-v1.md`](ui-copy-review-v1.md) 同批处理文案与约 205 处按文案定位的断言。
- **选项 b**：产品面继续叫「来源」，计划只作为连接的属性（零文案返工）；但与架构术语分叉，需要在架构里登记展示名差异。

## 5. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：新增一张表；Run／WorkflowRun／Checkpoint 增列；迁移分四步，destructive contract 单独部署。不删除任何用户数据。
- **接口**：新增计划的 CRUD 端点与读投影；来源读投影保留（内容出处仍需要），新增计划读投影；来源创建命令是否直接接受计划字段由 Task 冻结。
- **安全**：不改变凭证边界；计划引用连接，凭据仍在 SecretStore，计划不保存凭证明文。
- **迁移**：见决策 2；回填不改变用户可见行为，读取切换前可安全回滚。
- **发布**：不涉及版本号、发布或部署；contract 步骤需要单独授权。
- **回滚**：读取切换前回滚无数据损失；读取切换后回滚需要把读取切回旧列（记录回滚代价）。

## 6. 验收草案

1. **既有行为不变**：回填后所有既有来源照常按原频率采集，全量测试全绿。
2. **双计划隔离**：同一连接下两个计划（不同频率、不同目标），Run、错误、重试与游标互不影响——行为测试 + 真实来源验收。
3. **产品面**：不打开数据库就能在一个连接下建出第二个计划，并看到两个计划各自的频率与最近一次失败。
4. **AUT-010 场景**：Bilibili 动态每 30 分钟 + 推荐流每 2 小时，两个计划的 Run 与游标互不混淆（执行面按待裁定项 2 确定）。
5. **迁移可回滚**：expand／backfill 之后旧读取路径仍可用（读取切换前）。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- [`docs/requirements/0002-product-requirements/part-07-1.md`](../requirements/0002-product-requirements/part-07-1.md)：AUT-010 行补 v1 形态注记；AUT-009 的「多个计划引用同一连接」补注记。
- [`docs/architecture/0001-cosmos-foundation/part-04.md`](../architecture/0001-cosmos-foundation/part-04.md)：§4.6 补 v1 落地范围（一对一、重叠策略只一种）；§4.7 第 2 条的「不新增独立 CollectionPlan 持久对象」加注记指向本 Proposal。
- `docs/adr/`：新增 ADR「采集计划 v1」，冻结计划与目标／连接／触发器／checkpoint 的归属边界与迁移顺序。
- `docs/spec/`：contracts（计划 DTO／命令）、storage（表与迁移）、interfaces（API 与 Web）。
- `.agents/tasks/`：由维护者分配编号后创建 Task；本 Proposal 接受前不改代码、不建 worktree。

## 8. 待裁定项

| # | 问题 | 建议 |
| --- | --- | --- |
| 1 | 计划模型选 A（建实体并按 §4.6 迁移）、B（不建实体、收窄架构）还是 C（纯展示对象） | A |
| 2 | 切片 3（连接器选择 + enum 表单）是否并入本 Task | 并入；否则 AUT-010 的验收场景在产品面不可复现 |
| 3 | 术语：产品面叫「采集计划」还是继续叫「来源」 | a（采集计划），与文案 Proposal 同批 |
| 4 | 重叠策略 v1 是否只做一种（与现状等价） | 是 |
| 5 | 迁移第 4 步（contract）是否纳入本 Task | 否，单独排期与授权 |

## 9. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-20 | 起草，状态 `reviewing`，等待裁决待裁定项 1–5 | Agent |
| 2026-09-20 | **确认**：待裁定项 1–5 全部按建议采纳——计划模型选 A（按架构 §4.6 建实体、v1 与目标一对一、四步迁移）、切片 3（连接器选择与 schema 驱动表单）并入本 Task、产品面术语用「采集计划」、重叠策略 v1 只做与现状等价的一种、迁移 contract 步骤单独排期与授权。稳定决定沉淀为 ADR-0023 | 用户（评审确认） |
