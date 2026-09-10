# Proposal：Trigger / SDK v1（平台面）

> 状态：accepted
>
> 日期：2026-09-10
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) AUT-004、AUT-005、EXT-003、EXT-006、EXT-007（关联 EXT-001/005/008）
>
> 关联设计：架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §4.1（Trigger 类型）、§4.4（manifest 与 Source Operation）、§5.2；ADR [`0001`](../adr/0001-durable-workflow-runtime.md)（TriggerBinding）、ADR [`0017`](../adr/0017-connection-secret-state-v1.md)（SecretRef/StateStore）
>
> 关联既有切片：Task 02（SourceInstance）、Task 22（Connection/Secret/State）

## 1. 问题

PRD 把「Trigger/SDK」拆成两块：AUT-004（Trigger 可由 Webhook/内部事件/条件变化/上游结果触发，每次触发保存原因/输入/时间/定义版本）、AUT-005（用户或插件定义自定义 Trigger/Action，经版本化 SDK）；以及 EXT-003/006/007（版本化 Command/Query/Event、manifest 声明多 Source Operation/认证/配置状态 schema/SecretRef/StateStore 命名空间）。当前实现：

- Trigger 只是 `SourceInstance.configJson` 里的一个 `scheduleIntervalMs` 字段 + 运行时的 `triggerKind: manual|schedule`（`packages/application/src/workflow-control.ts`），没有 `Trigger`/`TriggerBinding` 实体，也没有保存「每次触发的原因/输入/定义版本」之外的触发证据。
- manifest（`packages/application/src/catalog.ts`）已有版本化 ref（`source.rss@1`）、`configurationSchema`、`operationIds`、`capabilities`，但没有声明 Source Operation 的输入/输出 schema、认证方式、SecretRef 需求、StateStore 命名空间或媒体状态（EXT-006/007）。
- 无插件运行时；Connector 是内置的（rss/bilibili/aihot/fixture）。

Task 22 已交付 `ConnectionInstance` + `SecretStore` + `ConnectorStateStore`。本切片把这些地基接进 manifest 与 Trigger，让「新 Adapter 只需声明、不改核心表/Worker 分支」成立，并把定时触发从 config 里显式建模出来。

## 2. 目标与非目标

### 目标（v1）

1. **TriggerBinding 实体**（AUT-004 部分）：把定时触发从 `SourceInstance.config.scheduleIntervalMs` 迁移为显式 `TriggerBinding`（kind `schedule`/`manual`），来源可带一个当前 TriggerBinding；触发证据（原因、输入快照、定义版本）在 Run 入队时固化。
2. **SourceDefinition manifest 扩展**（EXT-006/007）：声明 Source Operation 的输入/输出 schema、认证方式（`auth`）、`SecretRef` 需求、`StateStore` 命名空间、媒体状态（`media`）；内置 SourceDefinition 补全这些声明。

### 非目标（本切片明确后置）

- Webhook、内部事件、条件变化、上游 Workflow 结果触发（AUT-004 完整形态，仅 schedule/manual）。
- 自定义 Trigger/Action 的运行时注册（AUT-005，依赖插件运行时/Phase 3）。
- 插件运行时加载、EXT-002（SDK 兼容范围 + 预算）、不可信插件沙箱（Phase 3）。
- Trigger 的并发/重叠策略（`forbid/queue/replace/allow/merge`，随 CollectionPlan）。

## 3. 当前行为与证据

- `scheduleIntervalMs` 位于 `SourceInstance.configJson`，由 `sourceConfigSchema`/`rssSourceConfigSchema` 校验（`packages/contracts/src/base.ts`），Worker 定时循环按它分桶（`apps/worker/src/main.ts` 用 `schedule:${source.id}:${floor(now / interval)}`）。
- `triggerKind: manual|schedule` 进入 ingest 的 `inputSnapshot`（`workflow-control.ts` 的 `ingestWorkflowInputSnapshotSchema`），Run 已保存 inputSnapshot 与 manifestHash，但触发「原因」只以 triggerKind 表达。
- manifest `SourceDefinitionManifest`（`catalog.ts:15`）有 `configurationSchema`、`operationIds`、`capabilities`，无 per-operation 输入/输出、无 auth/SecretRef/StateStore/media 声明。
- `ConnectorDescriptor`（`catalog.ts` 派生）有 `capabilities` + `configVersion`，无状态/密钥/操作声明。

## 4. 方案

### 决策 1：`TriggerBinding` 实体 + 从 config 迁移 `scheduleIntervalMs`

新增 `TriggerBinding` 模型（id、sourceId、kind `schedule|manual`、configJson、enabled、revision、createdAt/updatedAt）。一个来源当前最多一个 TriggerBinding（v1 不搞多计划）。migration 把既有来源的 `scheduleIntervalMs` 从 config 迁到 schedule TriggerBinding（forward-only）。`SourceInstance.config` 不再承载 `scheduleIntervalMs`（保留 schema 兼容一段时间再收紧）。触发证据：Run 的 `inputSnapshot` 已保存 source/config/manifestHash/triggerKind，补一个显式 `trigger` 快照（reason/kind/定义版本）。

**备选**：TriggerBinding 支持多个（一个来源多个 schedule）。拒绝（v1）：多触发/多计划是 CollectionPlan 的职责，先做单 TriggerBinding。

### 决策 2：`SourceDefinitionManifest` 扩展 per-operation 声明（EXT-006/007）

`SourceDefinitionManifest` 新增 `operations`（每项：operationId、input/output schema ref、external key 稳定性声明、discovery context 声明、media 状态、secretRef 需求、stateStore 命名空间）与 `auth`（认证方式：none/oauth/cookie/secretRef）。内置 SourceDefinition 补全（rss/fixture/aihot = auth none + stateStore `source:{id}`；bilibili = auth 外部登录态例外）。这是声明式合同，不改变运行时执行路径。

**备选**：新增独立 `SourceOperationManifest` 表。拒绝（v1）：manifest 是代码内静态目录，per-operation 声明放同一个 `SourceDefinitionManifest` 即可，不建表。

### 决策 3：EXT-003 版本化合同保持现状并固化

现有版本化 ref（`source.rss@1`、`cosmos.ingest@1`）+ `protocolVersion` 已满足 EXT-003 v1；本切片只补 manifest 字段、不改 Command/Query/Event 的版本化机制。不兼容版本拒绝语义已有（`getSourceDefinitionByRef` 精确匹配 ref）。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| TriggerBinding 单当前绑定（schedule/manual） | 采纳（决策 1） |
| 一个来源多个 TriggerBinding | 拒绝（v1，随 CollectionPlan） |
| per-operation 声明放 `SourceDefinitionManifest` | 采纳（决策 2） |
| 独立 `SourceOperationManifest` 表 | 拒绝（v1） |
| 自定义 Trigger/Action 运行时注册 | 后置（AUT-005，插件运行时） |
| Webhook/内部事件/上游结果触发 | 后置（AUT-004 完整形态） |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：新增 `TriggerBinding` 表；migration 从 `SourceInstance.config.scheduleIntervalMs` 迁出（forward-only，历史来源各生成一条 schedule TriggerBinding）。
- **接口**：`TriggerBinding` CRUD 端点（或并入 source）；`SourceDefinitionManifest` 结构扩展（向后兼容，加字段）；`ConnectorDescriptor` 补充声明。
- **安全**：manifest 声明 SecretRef/StateStore 命名空间，不包含凭证明文；触发证据不含 Secret。
- **迁移与发布**：一次 migration；不涉及版本号/发布/部署。
- **回滚**：回滚代码后 TriggerBinding 表未使用、config.scheduleIntervalMs 已迁出需回填（记录回滚代价，与 Task 22 同型）。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements.md`：AUT-004/EXT-006/007 行补 v1 形态；新增 Phase 2 第十三切片注记。
- `docs/architecture/0001-cosmos-foundation.md` §4.1/§4.4：补 TriggerBinding 实体与 manifest per-operation 声明。
- `docs/adr/0018-trigger-sdk-v1.md`（新）：冻结决策 1–3；同步 ADR 索引。
- `docs/spec/`：contracts（TriggerBinding/manifest 扩展）、storage（TriggerBinding 表）、interfaces（API 与 Web）。
- `.agents/tasks/{新编号}-trigger-sdk/README.md`：由维护者分配编号后创建。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-10 | 起草，状态 `reviewing`，等待裁决决策 1/2/3 与实施授权 | Agent |
| 2026-09-10 | **确认**：TriggerBinding 单当前绑定（schedule/manual）+ 从 config 迁移 `scheduleIntervalMs`（决策 1）、per-operation 声明放 `SourceDefinitionManifest`（决策 2）、EXT-003 版本化合同保持现状（决策 3）；并授权创建 worktree `.worktree/trigger-sdk` / 分支 `feat/t23-trigger-sdk` 实现与测试 | 用户（评审确认） |
