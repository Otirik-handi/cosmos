# ADR-0018：Trigger / SDK v1

> 状态：Accepted design contract
>
> 日期：2026-09-10
>
> 关联：[`trigger-sdk-v1 Proposal`](../proposals/trigger-sdk-v1.md)、[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §4.1/§4.4、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) AUT-004/EXT-006/007、ADR [`0001`](0001-durable-workflow-runtime.md)、ADR [`0017`](0017-connection-secret-state-v1.md)

## Context

PRD 把 Trigger/SDK 拆成两块：AUT-004（Trigger 由 Webhook/内部事件/条件/上游结果触发，每次触发保存原因/输入/时间/定义版本）与 EXT-006/007（manifest 声明多 Source Operation/认证/schema/SecretRef/StateStore 命名空间）。当前 Trigger 只是 `SourceInstance.config.scheduleIntervalMs` + 运行时 `triggerKind`，manifest 也没有 per-operation 声明。Task 22 已交付 Connection/Secret/State 地基。2026-09-10 用户裁决三项默认建议（TriggerBinding 单绑定 + 从 config 迁移 scheduleIntervalMs、per-operation 声明放 SourceDefinitionManifest、EXT-003 版本化合同保持现状），本文沉淀这些稳定决定。

## Decision

### 1. `TriggerBinding` 实体 + 从 config 迁移 `scheduleIntervalMs`

新增 `TriggerBinding`（id、sourceId `@unique`、kind `schedule|manual`、configJson、enabled、revision）。一个来源当前最多一个 TriggerBinding。migration 把既有来源的 `scheduleIntervalMs` 从 configJson 迁出（SQLite `json_extract`/`json_remove` + 确定性 id `trigger:<sourceId>`）到 schedule TriggerBinding。`SourceInstance.config` 不再承载 `scheduleIntervalMs`（`scheduleConfigShape` 清空）；调度循环改读 `listScheduleTriggers()`（join 来源 enabled + schedule trigger）。`createSource`/`updateSource` 用顶层 `scheduleIntervalMs` 建/改/删 TriggerBinding。

### 2. `SourceDefinitionManifest` 扩展 per-operation 声明（EXT-006/007）

`SourceDefinitionManifest` 新增 `auth`（`none|oauth|cookie|secret_ref|external` + `secretRefRequired`）与 `operations`（每项：operationId、input/output schema、稳定 external key、discovery context、media、stateStore 命名空间）。内置 SourceDefinition 补全：rss = auth none + media download；fixture/aihot = none + metadata_only；bilibili = external（OpenCLI 登录态例外）。声明式合同，不改变运行时执行路径。

### 3. EXT-003 版本化合同保持现状

现有版本化 ref（`source.rss@1`）+ `protocolVersion` 已满足 EXT-003 v1；本切片只补 manifest 字段、不改 Command/Query/Event 版本化机制。

## Consequences

### Positive

- 定时触发成为一等实体，TriggerBinding 为未来 webhook/事件触发留了同构扩展位；触发证据（Run inputSnapshot + manifestHash + triggerKind）不变。
- manifest 现在能完整声明一个 Adapter 的认证/操作/状态/媒体，呼应 Task 22 的 Secret/State 地基，让「新 Adapter 只需声明」成立。
- 无认证来源与 OpenCLI 外部登录态例外均不受影响。

### Costs and risks

- 一次数据变换 migration（JSON backfill + 移除字段），回滚需回填 `scheduleIntervalMs` 到 config（记录回滚代价）。
- `SourceInstance.connectionId` 与 `TriggerBinding` 均无 DB FK 层面的复杂约束（SQLite `ALTER TABLE` 限制），由仓库事务保证。
- Web 的定时字段从 config 移到顶层，表单与来源投影随之调整；这是契约变化，旧客户端发 config.scheduleIntervalMs 会被严格 schema 忽略/拒绝（`.strict()` 来源定义）。

## Alternatives considered

### 一个来源多个 TriggerBinding

拒绝（v1）。多触发/多计划是 CollectionPlan 的职责，先做单绑定。

### 独立 `SourceOperationManifest` 表

拒绝（v1）。manifest 是代码内静态目录，per-operation 声明放同一 `SourceDefinitionManifest` 即可。

### 迁移 Checkpoint 进 ConnectorStateStore

拒绝（v1）。cursor 的 ingest 专用 CAS + domain event 与多计划耦合，随 CollectionPlan 一起迁移。

### 自定义 Trigger/Action 运行时注册

后置（AUT-005，依赖插件运行时/Phase 3）。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 引入 webhook、内部事件、条件变化或上游 Workflow 结果触发（AUT-004 完整形态）；
- CollectionPlan / 多采集计划进入实现（TriggerBinding 需支持一个来源多个触发与 overlap policy）；
- 自定义 Trigger/Action 的插件运行时注册（AUT-005）；
- 引入真实认证 Adapter，manifest 的 auth 声明需要实际驱动登录生命周期。
