# ADR-0025：一个采集计划持有多个触发器（TriggerBinding 多绑定 v1）

> 状态：Accepted design contract
>
> 日期：2026-09-22
>
> 关联：ADR [`0018`](0018-trigger-sdk-v1.md)（Trigger/SDK v1，本 ADR 取代其决定 1 的单绑定口径）、[`0023`](0023-collection-plan-v1.md)（采集计划 v1，其 Revisit Gate 第 3 条在此触发并处理）、[`0024`](0024-trigger-forms-v1.md)（Trigger 剩余形态 v1，webhook 入口）、Proposal [`trigger-forms-v1`](../proposals/trigger-forms-v1.md)、总体架构 [`part-04.md`](../architecture/0001-cosmos-foundation/part-04.md) §4.1／§4.6、PRD AUT-004／AUT-010

## Context

ADR-0018 的 v1 把触发器做成「一个来源最多一行 `TriggerBinding`」（`sourceId` 与后来的 `planId` 都是唯一索引），并把「一个来源多个 TriggerBinding」明确后置给采集计划。ADR-0023 随后把绑定的归属从来源移到计划，并在 Revisit Gate 第 3 条写明：**AUT-004 的事件类触发开始接入计划（触发形态从 schedule／manual 扩展）时重新评估**。

ADR-0024 让 webhook 成为 Phase 2 唯一要交付的剩余形态，并把入口放在 `TriggerBinding` 上（`kind = webhook`）。把这个决定落到单绑定模型上会撞车：`listScheduleTriggers` 只取 `kind === "schedule"` 且 `enabled` 的绑定，因此「为挂 webhook 而把这一行的 kind 改成 webhook」会让该计划的**定时抓取静默停止**——用户不会收到任何提示，而「每 30 分钟 + 收到通知就立刻抓」正是这个功能最自然的用法。

需求侧也支持共存：AUT-010 要求每个计划拥有自己的频率与失败状态，AUT-004 要求触发可由多种形态发起；两者合起来就是「同一计划、多种触发」。

## Decision

### 1. 一个计划可以持有多个 TriggerBinding

唯一约束由「每个来源／计划一行」改为「每个来源／计划、每种类型一行」：`(sourceId, kind)` 与 `(planId, kind)` 唯一。同一个计划因此可以同时拥有 schedule 行与 webhook 行，各自持有自己的 `configJson`、`enabled` 与 `revision`。

迁移前每个来源至多一行，所以改约束不改变任何既有数据。

### 2. 调度只读 schedule 行，行为不变

`listScheduleTriggers` 继续只取 `kind = schedule` 且 `enabled` 的绑定；新增的 webhook 行不参与调度。计划的启用状态仍归计划（ADR-0023 决策 2），触发器的 `enabled` 是它自己的字段。

### 3. 计划的调度写入口只动 schedule 行

`updateCollectionPlan` 的 `scheduleIntervalMs` 只增／改／删 `kind = schedule` 的那一行，不触碰其它类型的行。删除调度不能顺带删掉 webhook 入口——两者是不同的触发方式。

### 4. 计划读投影不再暴露「触发器的 id」

多绑定下「那个绑定的 id」没有唯一含义。公开投影保留派生的行为字段：调度间隔由 schedule 行派生（`scheduleIntervalMs`），webhook 入口由 webhook 行派生（ADR-0024 的入口字段）。触发器的 id 只在仓储内部使用；产品面不需要它，也不应依赖它。

### 5. 本 ADR 取代 ADR-0018 决定 1 的单绑定口径

ADR-0018 的其余决定（实体化、从 config 迁移 `scheduleIntervalMs`、manifest per-operation 声明、EXT-003 保持现状）不变。

## Consequences

### Positive

- 「定时 + 即时」可以兼得，且不会因为启用一种触发方式而静默关掉另一种；
- Phase 3 的 event／condition／dependency 触发以**新增行**接入，不需要再迁移一次数据模型；
- 每种触发方式各自持有 `enabled` 与 `revision`，语义清晰，重叠策略落地时能区分「哪个触发器导致的重叠」。

### Costs and risks

- 计划的触发器读写必须显式按 kind 寻址；漏写 kind 会误改另一种触发方式（这是本 ADR 的主要回归面，需要行为测试看守）；
- 迁移是 SQLite 索引级操作（drop 两个唯一索引、建两个复合唯一索引），不重建表；
- `triggerBindingId` 从公开投影移除属于合同变化，仓库内的测试与 fixture 需同批更新。

## Alternatives considered

### 单绑定 + 入口作为该行上的附加字段

拒绝。`kind` 的语义会变糊（一行同时表示「有定时」和「有 webhook」），且 Phase 3 的三种触发形态会继续往同一行加列，最终把一行变成一张配置表。

### 单计划单触发方式（开 webhook 即清掉定时）

拒绝。按 Context 的事实，它会让用户在启用 Webhook 时静默丢掉定时抓取。

### 保留 `triggerBindingId` 并改成数组

拒绝。仓库内没有任何生产消费者需要触发器 id；保留一个只会误导（多绑定下不再唯一）的字段不如删掉。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 需要「同一计划、同一类型多个触发器」（例如两个不同间隔的定时）；
- 触发器需要计划级排序、优先级或互斥策略；
- 重叠策略（ADR-0023 决定 3 预留的 `queue`／`replace`／`allow`／`merge`）落地，需要按触发器区分重叠判定；
- 触发器需要独立于计划的启用/停用产品入口（当前只有计划级启停与触发器自身的 `enabled` 字段）。
