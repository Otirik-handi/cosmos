# ADR-0023：采集计划（CollectionPlan）v1

> 状态：Accepted design contract
>
> 日期：2026-09-20
>
> 关联：Proposal [`collection-plan-v1`](../proposals/collection-plan-v1.md)、总体架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §4.6／§4.7 与 §19 决定 85、§21 不变量 63、ADR [`0017`](0017-connection-secret-state-v1.md)（Connection/Secret/State）、[`0018`](0018-trigger-sdk-v1.md)（TriggerBinding 与 manifest 状态命名空间）、[`0014`](0014-per-source-media-policy-v1.md)（媒体策略字段语义）、[`0004`](0004-source-instance-identity-and-revision.md)（SourceInstance 身份与 revision）、PRD AUT-010／AUT-009／EXT-007／ING-012

## Context

AUT-010 要求「一个连接下可以配置多个独立采集计划，每个计划拥有自己的来源操作、范围、频率、预算、checkpoint、发现上下文和失败状态」，验收是同一 Bilibili 账号的两路采集（动态每 30 分钟、推荐流每 2 小时）互不混淆。架构 §4.6 早已冻结目标模型：`ConnectionInstance` 可被多个 `CollectionPlan` 引用，计划把 Source Operation、Trigger、WorkflowBinding、checkpoint namespace、发现上下文、预算、错误、重试和重叠策略组合为独立边界。

但实现里没有这个对象。架构 §4.7 第 2 条记录了 Phase 1 的收窄（「不新增独立 `CollectionPlan` 持久对象」），此后连接、触发器、媒体预算、checkpoint 与状态命名空间分别落在 `SourceInstance` 与 `TriggerBinding` 上：

- 数据面的隔离其实已经具备——Run、WorkflowRun、Observation、Entry 都以来源为归属，Checkpoint 按来源唯一，状态命名空间按来源解析，两个来源共用一个连接在数据上合法；
- 缺的是「计划」这个用户可见对象与产品入口：Web 新建来源硬编码 RSS、manifest 的 `enum` 字段不渲染、`connectionId` 只能通过 API 设置，产品面连一个 Bilibili 计划都建不出来。

因此本 ADR 冻结的不是「要不要做」，而是计划的归属边界、v1 范围与迁移顺序。

## Decision

### 1. 计划是真实对象，v1 与采集目标一对一

`CollectionPlan` 持有：连接引用（可空，未认证来源没有连接）、采集目标引用、触发器（一对一）、媒体预算、计划级 checkpoint 与状态命名空间、重叠策略、启用状态与自身 revision。

采集目标继续承载内容身份：`Entry`、`Observation` 与它们的 revision 仍归目标，计划不成为内容归属。v1 一个目标只有一个计划；「同一目标多个计划」随重叠策略一起后置。

### 2. 归属边界唯一

- Run 与 WorkflowRun 记录计划引用（同时保留目标引用，供内容追溯）；
- Entry、Observation、Asset 归目标，不因计划变化而改变归属；
- Checkpoint 与 ConnectorState 命名空间按计划隔离：manifest 的 `stateStoreNamespace` 模板语义不变（ADR-0018），解析时 `{id}` 取计划 id；
- 计划配置更新使用基于自身 revision 的 CAS，与来源 revision 相互独立（沿用 ADR-0004 的 CAS 形态）。

不出现「计划」与「来源」两套并行的当前状态：同一事实只有一个所有者。

### 3. 重叠策略 v1 只有一种

v1 只实现与现状等价的一种行为——同一计划上一轮尚未结束时，到点不重复入队（由调度幂等键保证）。合同只接受这一个值，其它值显式拒绝并说明尚未实现；架构 §4.6 预留的 `forbid`／`queue`／`replace`／`allow`／`merge` 不在 v1 承诺范围内。

### 4. 迁移四步，contract 单独部署

1. **expand**：新增计划表；Run／WorkflowRun／Checkpoint 增加可空计划列，不动旧列；
2. **backfill**：为每个既有来源生成一个默认计划（继承连接、触发器、媒体预算），回填既有 Run／WorkflowRun／Checkpoint 的计划引用；状态命名空间按计划重写（状态可重建，重写只为避免多余的一次全量抓取）；
3. **read switch**：Worker 调度、ingest、checkpoint 提交、状态命名空间与产品查询全部改读计划；旧列保留但不再写；
4. **contract**：从来源上移除连接／触发器／预算字段。**单独部署、单独授权**，不属于 v1 完成条件。

v1 的完成定义 = expand + backfill + read switch + 产品面 + 验收。回填不改变用户可见行为；读取切换前可安全回滚。

### 5. 产品面与术语

- 连接下可以创建、查看和管理多个计划；计划级频率、媒体预算与失败状态可见；
- 连接器选择与 schema 驱动表单（含 `enum` 字段与认证提示）在同一 Task 内落地——没有它，AUT-010 的验收场景在产品面不可复现；
- 产品面把这一层叫「采集计划」，「来源」保留为内容出处（Feed 卡片上的来源名、来源健康）。

### 6. WorkflowBinding 与发现上下文

`WorkflowBinding` 固定 `cosmos.ingest@1`：用户自定义 Workflow 属 Phase 3，v1 不建可配置绑定。发现上下文 v1 不新增独立字段，仍由目标配置派生（`config.mode` → 发现渠道），避免同一事实两处存放；计划需要展示时以只读投影给出。

媒体预算的归属由来源改为计划，字段语义与上界沿用 ADR-0014（只能收紧、缺省跟随全局默认）。

## Consequences

### Positive

- 架构 §4.6 的合同第一次落到实现，「用户可见的独立采集计划」不再是文案；
- 连接、触发器、预算、checkpoint 与状态命名空间有唯一所有者，未来「同一目标多个计划」与重叠策略不需要再迁移一次；
- AUT-010 的验收场景（同一账号两路采集）在产品面可配置、可验证。

### Costs and risks

- 这是一次真实迁移：新表、三处增列、状态命名空间重写，需要按四步执行并保留回滚路径；
- 计划的引入会让「来源」与「计划」在产品与文档中并存一段时间（目标 vs 执行配置），文案与断言需要与 [`ui-copy-review-v1`](../proposals/ui-copy-review-v1.md) 同批处理；
- v1 一对一意味着「一个目标两套频率」仍需建两个目标；这是刻意的范围取舍，不是模型缺陷。

## Alternatives considered

### 不建实体，把「计划」当作来源的产品视角

拒绝。与已冻结的架构 §4.6 冲突；连接、触发器、预算与 checkpoint 继续挂在目标上，「计划」永远只是文案，未来仍要迁移一次。

### 只建计划行、不迁触发器与 checkpoint（纯展示对象）

拒绝。会出现两套并行状态，触发器与游标归谁说不清，违反架构 §3.6「展示角色不污染领域模型」。

### v1 就允许同一目标被多个计划引用

拒绝。它要求先定义重叠策略与多计划共享目标的游标语义（哪个计划推进 checkpoint、两个计划同时命中同一条目怎么办），会把 AUT-010 拖成两个合同变更；一对一先落地，语义后置。

### 在计划上新增独立的发现上下文字段

拒绝（v1）。发现渠道当前由目标配置派生，新增字段会造成同一事实两处存放；需要多计划共享目标时再随该能力引入。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 需要「同一采集目标多个计划」或补齐 `queue`／`replace`／`allow`／`merge` 重叠策略；
- 用户自定义 Workflow 绑定（Phase 3）需要计划承载版本选择；
- AUT-004 的事件类触发开始接入计划（触发形态从 schedule／manual 扩展）——**已于 2026-09-22 触发并处理**：webhook 形态按 ADR [`0024`](0024-trigger-forms-v1.md) 落地，「一个计划可持有多个触发器」的模型由 ADR [`0025`](0025-multi-trigger-per-plan.md) 冻结；
- 多用户或多租户出现，连接共享与计划权限需要新边界；
- 迁移第 4 步（contract）准备执行，需要重新确认无消费者依赖来源上的旧字段。
