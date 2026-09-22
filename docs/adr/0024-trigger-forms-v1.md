# ADR-0024：Trigger 剩余形态 v1（Webhook 落地，其余三种后置）

> 状态：Accepted design contract
>
> 日期：2026-09-22
>
> 关联：Proposal [`trigger-forms-v1`](../proposals/trigger-forms-v1.md)、总体架构 [`part-04.md`](../architecture/0001-cosmos-foundation/part-04.md) §4.1（Trigger 类型）／§4.4／§4.6、ADR [`0018`](0018-trigger-sdk-v1.md)（TriggerBinding v1）、[`0023`](0023-collection-plan-v1.md)（采集计划 v1）、[`0017`](0017-connection-secret-state-v1.md)（Connection/Secret/State）、PRD AUT-004／AUT-015／AUT-016／OPS-005／OPS-007

## Context

AUT-004 要求 Trigger 可由 Webhook、内部事件、条件变化或上游 Workflow 结果触发，每次触发保存触发原因、输入、时间和对应定义版本。ADR-0018 的 v1 只交付了 `schedule`／`manual` 两种形态，把其余形态明确后置；[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) 因此把 AUT-004 列为 Phase 2 未闭合的最高优先项。

架构 §4.1 早已把七种 Trigger 类型写进「第一版合同预留」：`manual`、`schedule`、`poll`、`webhook`、`event`、`condition`、`dependency`。需求表的四种形态正是其中的 `webhook`／`event`／`condition`／`dependency`，所以本项的性质是**已冻结的架构合同未落地**，与 AUT-010 同类（ERRATA 2026-09-20 对 AUT-010 的原话），而不是新增需求。

逐条核实依赖后，缺口内部的依赖并不相同：

- `dependency`（上游 Workflow 结果）**真依赖 Phase 3**：它要求用户先有自己的 Workflow，而「用户自定义 Workflow 产品面」按 PRD 定级 Phase 3（ERRATA 2026-09-20 记载）；
- `event`（内部事件）与 `condition`（条件变化）**不依赖 Phase 3 交付物**：它们缺的是仓库里还没有的领域事件订阅分发与条件求值。领域事件表已在约 15 个领域写入，但读取只用于时间线/审计，没有订阅者；
- `webhook` 的瓶颈不是 Phase 3 也不是代码量，而是**消费者**：四个内置来源都只声明一个轮询 `fetch` 操作，没有任何来源能主动推送，仓库里也没有任何 inbound 入口。

因此需要裁定的不是「要不要做」，而是 Phase 2 承担哪些形态、Webhook 的入口边界是什么。

## Decision

### 1. Phase 2 只交付 Webhook，其余三种形态记 Phase 3

`webhook` 是 Phase 2 唯一要交付的剩余形态；`event`、`condition`、`dependency` 记为 Phase 3，与 Knowledge Workflow 及用户自定义 Workflow 产品面同批评估。需求文字与验收条件不改写，口径更正登记在 [`ERRATA.md`](../requirements/0002-product-requirements/ERRATA.md)（沿用 AUT-010 先例）。

`poll` 不为它单列类型：轮询来源今天由 `schedule` + 持久 checkpoint 表达（AUT-003 已交付），另立类型会造成同一件事两套语义。

### 2. 入口以 TriggerBinding 为定位对象

Webhook 入口挂在 `TriggerBinding`（`kind = webhook`），解析时按 `planId` 优先、否则按来源——与 ADR-0023 的 read switch 顺序一致，不依赖其迁移第 4 步（contract），也不出现第二套解析路径。

每个绑定持有一个**不可猜的不透明入口标识**，不复用实体 id。入口端点独立于产品 API 的版本前缀（产品 API 现为 `/api/v1`），因为它的调用方是外部自动化而不是产品客户端。

### 3. 入口凭证走 SecretStore，不静默升级加密

入口凭证由既有 `SecretStore` 持有，公开合同只暴露不透明 `SecretRef`；请求必须携带该凭证，校验失败不入队，也不透露绑定是否存在。凭证轮换、停用与入口变更走 `TriggerBinding.revision`，已入队的 Run 使用创建时的快照（AUT-015／AUT-016 的既有语义）。

SecretStore v1 是受限权限明文文件、不加密-at-rest（ADR-0017 的既定边界）。Webhook 凭证**不因此升级加密要求**，但必须在 `docs/spec/` 写明；需要加密时按新的 ADR 处理。

不复用 Connection 凭证：连接凭证表达「Cosmos 如何访问外部平台」，入口凭证表达「外部如何访问 Cosmos」，方向相反；混用会让 AUT-009 要求可见的「授权范围」与「失效原因」无法解释。

### 4. 触发证据落在 Run 的既有位置

每次 Webhook 触发固化四项证据，不新增表：

| 需求要求 | 落点 |
| --- | --- |
| 触发原因 | 触发类型 `webhook` + 绑定标识 + 外部事件标识（可读、可审计，不含 Secret） |
| 输入 | `inputSnapshot`（沿用 ingest 的输入快照：来源/计划、游标与 checkpoint revision） |
| 时间 | Run 的 `createdAt`（入队）与 `startedAt`（开始执行） |
| 定义版本 | `manifestHash`（沿用） |

公开触发类型枚举新增 `webhook` 属 EXT-003 的版本化合同扩展：不兼容版本必须被拒绝并解释原因。Run 级时间/token 预算快照不在本次范围（按 ERRATA 2026-09-20 记载随 RUN-006/RUN-009 后置）。

### 5. 入口的幂等、限流与脱敏

- 外部事件标识作为幂等键，重复投递不产生第二个 Run；
- 入口设请求体积上限与速率上限，超限返回可识别状态且不写入；
- 请求体不进日志与事件 payload（OPS-005），只保留摘要（大小、哈希、来源标识）；
- 「入队失败」与「已接受但未入队」必须能分开表达（RUN-005 的精神，RUN-005 本身定级 Phase 5）。

### 6. v1 的验收消费者是用户自己的自动化

Webhook v1 的消费者是用户自己的自动化（本机脚本或其它工具调用入口触发采集计划），不需要新 Adapter，符合「v1 面向单个本地用户」的产品口径（OPS-007）。等真实认证 Adapter 的平台推送（EXT-006 的后续）不在 v1 验收范围，避免重演「合同先行、无人消费」。

### 7. 产品面按采集计划呈现

新建/编辑采集计划时可选 Webhook 触发，并从计划面板拿到入口地址与凭证状态（只回显引用，不回显明文）。不新增独立的「触发器」页面——同一件事只有一个可写入口。

## Consequences

### Positive

- AUT-004 从「按需求表字面无法完成」变成口径清晰、边界可验收的一项，Phase 2 不再自相矛盾；
- Webhook 建立在既有的 TriggerBinding、SecretStore、入队幂等与触发证据之上，不需要新实体或第二套执行路径；
- `event`／`condition`／`dependency` 明确后置到它们的价值峰值（Knowledge Workflow 与用户 Workflow 产品面）之后，不再养没有消费者的合同。

### Costs and risks

- 入口是**新的外部副作用面**：鉴权、幂等、限流、体积上限、脱敏缺一不可，任何一项缺失都会让一个本地 HTTP 入口变成写库通道；
- 入口凭证沿用明文-at-rest 的既有边界，必须写进 spec 而不是靠默认；
- Webhook 的产品价值依赖用户自己写自动化脚本，v1 的可用性低于「平台推送」；这是刻意的范围取舍，不是能力缺陷；
- `dependency` 的后置依赖 Phase 3 的用户 Workflow 产品面，Phase 3 若先做 Workflow 而不回看本 ADR，可能重复设计触发绑定。

## Alternatives considered

### Phase 2 交付 Webhook + 内部事件 + 条件变化，只后置上游结果

拒绝。订阅分发与条件求值是两条新的架构面（各自的合同、持久化与验收），且 Phase 2 内没有真实消费者；采用它会把 Phase 2 的尾巴变成一个新阶段。

### AUT-004 整行改标 Phase 3

不作为首选。它把不需要等 Phase 3 的 Webhook 一起推后，且与 ERRATA 2026-09-16「AUT-004 是真正属于 Phase 2 的尾巴」的记载冲突。维护者的目标是尽快关闭 Phase 2 时它是唯一零实现选项，本次未采纳。

### 入口凭证复用 Connection 凭证

拒绝，理由见决定 3。

### 入口标识复用 TriggerBinding id

拒绝。实体 id 可枚举、可猜测，会让入口暴露绑定数量与顺序，且 id 泄漏即等于入口泄漏。

### 把 Webhook 建模为新的持久对象（独立 WebhookSubscription 表）

拒绝（v1）。绑定已经承载「何时启动」的语义与 revision，另立对象会出现两个所有者；需要多入口/多凭证时再评估。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 真实认证 Adapter 接入后需要平台主动推送（EXT-006 的后续），需要重新界定入口凭证与平台签名校验；
- Knowledge Workflow（Phase 3）落地后评估 `event`／`condition` 的归属与消费者；
- 用户自定义 Workflow 产品面（Phase 3）落地后评估 `dependency`；
- ADR-0023 的迁移第 4 步（contract）执行，入口解析需要跟随 `planId` 调整；
- 入口需要公网暴露、TLS 或为入口凭证引入加密-at-rest；
- 需要同一计划多个入口或多个凭证。
