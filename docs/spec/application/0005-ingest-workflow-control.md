# Ingest Workflow Control 入队控制

## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

2026-08-16

## 组件定位

`IngestWorkflowControlService` 位于 `packages/application/src/workflow-control.ts`，负责将一次 ingest 请求转换为可排队的工作流输入快照，并通过 `WorkflowHostStore` 创建 queued 状态的工作流信封。

该服务只负责 ingest 入队控制、输入快照捕获和幂等校验；后续 Run、Job、Activity 的执行与生命周期由 [WorkflowHostStore / Workflow Host contract](0007-workflow-host-contract.md) 及其 runtime 管理。

### 在系统中的位置与作用
它是 ingest 请求进入 durable Workflow Host 前的应用入口，位于 API/调用方与 `WorkflowHostStore` 之间。

### 解决的问题
它在执行开始前捕获 Source 快照、规范化工作流输入并处理幂等键，确保排队的 Envelope 不依赖之后变化的 Source 行。

### 使用方式
调用方提交 ingest 请求后调用该服务；服务读取 `SourceExecutionSnapshot`，构造 `cosmos.ingest@1` 的 Envelope 并请求 Host Store 创建 queued 记录，之后由 Host runtime 负责 Run/Job/Activity 执行。

### 典型情景
用户手动触发一次 Source ingest，或 API 收到带 Idempotency-Key 的重复请求时，使用本组件而不是直接写 WorkflowRun 表。

## 概念与定义

- `SourceExecutionSnapshot` 是入队时读取的 source 执行快照，使用公共契约中的定义：[SourceExecutionSnapshot](../contracts/0001-public-contracts.md)。
- `WorkflowEnvelope.definition` 使用 `WorkflowDefinitionReference`。它的 `manifestHash` 是字符串，而不是 catalog 的 `{ algorithm, value }` 对象；本服务固定写入 `"builtin:cosmos.ingest@1:source-snapshot-v1"`。
- `ingestWorkflowInputSnapshotSchema` 定义 ingest 工作流的输入快照结构：
  ```ts
  z.object({
    source: sourceExecutionSnapshotSchema,
    cursor: string | null,
    checkpointRevision: nonnegative integer,
    triggerKind: ingestTriggerKindSchema,
  })
  ```
- `inputSnapshot` 是入队时生成的不可变输入；排队后 source 的修改不会改变该次工作流使用的 source 快照。

## 外部行为

`enqueue({ sourceId, triggerKind, idempotencyKey })` 执行以下行为：

1. 对 `sourceId` 和 `idempotencyKey` 执行 `trim`；服务本身不截断幂等键。
2. 解析 `triggerKind`。
3. 任一必填字符串为空时抛出：
   ```text
   Workflow ingest enqueue requires sourceId and Idempotency-Key.
   ```
4. 先调用 `store.findWorkflowEnvelopeByIdempotencyKey(idempotencyKey)`。
5. 若已存在同幂等键的 envelope：
   - 对其 `inputSnapshot` 执行安全解析；
   - 仅比较 `snapshot.source.id === sourceId` 和 `snapshot.triggerKind === triggerKind`；
   - 两项均匹配时原样返回 existing envelope，不重新读取 source 或 checkpoint；
   - 任一项不匹配，或快照无法解析时，抛出动态错误：
     ```text
     Idempotency key ${idempotencyKey} conflicts with another source run.
     ```
6. 若不存在 existing envelope：
   - 读取 source execution snapshot；
   - source 为 `null` 时抛出动态错误 `Source not found: ${sourceId}`；
   - 读取 checkpoint snapshot；
   - 构造不可变 `inputSnapshot`；
   - 调用 `store.createWorkflowEnvelope(...)` 创建 queued envelope。

相同幂等键会返回同一个已存在的 envelope；相同幂等键但 source 或 trigger 不同会被判定为冲突。

公共 `ingestCommandSchema`（仅在调用方显式使用该 schema 时）把幂等键限制为 trim 后 1–300 字符；但 `IngestWorkflowControlService.enqueue` 的实际端口只执行 trim 与非空检查，没有 `.max(300)`，而当前 API header 也直接传入该端口。因此直接调用 control/API header 可接受超过 300 字符的键并由 Store 持久化；不得在本组件规格中声称 control 自身拒绝超长键。若入口先 parse `ingestCommandSchema`，则超长键在该入口被拒绝。两条边界分别属于 schema 与 control，不能混写成同一运行时校验。

## 输入

服务构造选项为：

```ts
{
  store: WorkflowHostStore,
  getSourceExecutionSnapshot(
    sourceId: string
  ): Promise<SourceExecutionSnapshot | null>,
  getCheckpointSnapshot(
    sourceId: string
  ): Promise<{
    cursor: string | null
    revision: number
  }>,
  ids?: IdGenerator
}
```

`enqueue` 输入为：

```ts
{
  sourceId: string
  triggerKind: Trigger
  idempotencyKey: string
}
```

输入约束：

- `sourceId` 使用 trim 后的值。
- `idempotencyKey` 使用 trim 后的值。
- `triggerKind` 必须通过 `ingestTriggerKindSchema` 解析。
- trim 后的 `sourceId` 或 `idempotencyKey` 为空时请求无效。
- checkpoint 的 `revision` 必须能够构造成非负整数 `checkpointRevision`。
- source snapshot 不存在时不会创建工作流 envelope。

## 输出

成功时返回由 `WorkflowHostStore` 查找或创建的 `WorkflowEnvelope`：

- 幂等键已存在且校验匹配：返回 existing envelope 原值。
- 幂等键不存在：返回 `createWorkflowEnvelope(...)` 的结果。
- 新建 envelope 的定义为：
  ```ts
  {
    key: "cosmos.ingest",
    version: "1",
    manifestHash: "builtin:cosmos.ingest@1:source-snapshot-v1"
  }
  ```
- 新建 envelope 的 `productRun` 为：
  ```ts
  {
    status: "queued",
    sourceId,
    triggerKind,
    idempotencyKey
  }
  ```

## 状态与持久化

服务本身不持有持久状态，也不直接写数据库。

- source snapshot 和 checkpoint snapshot 只在新幂等键入队时读取。
- 已存在幂等键时不重新读取 source 或 checkpoint。
- `WorkflowHostStore` 负责 durable unique key、canonical JSON、并发创建冲突处理以及 queued event。
- `store.createWorkflowEnvelope` 负责将新 envelope 交给 Host contract 定义的持久化与排队机制。
- 后续 Run、Job、Activity 状态由 Workflow Host contract/runtime 管理。

## 状态转换

单次 `enqueue` 请求具有以下可判定转换：

```text
输入校验失败
  -> 抛出 Error

幂等键命中
  -> snapshot.source.id 与 sourceId 匹配
  -> snapshot.triggerKind 与 triggerKind 匹配
  -> 原样返回 existing WorkflowEnvelope

幂等键命中
  -> 任一匹配项失败
  -> 抛出冲突 Error

幂等键未命中
  -> source snapshot 不存在
  -> 抛出 `Source not found: ${sourceId}`

幂等键未命中
  -> 读取 source snapshot 与 checkpoint snapshot
  -> 创建 status = "queued" 的 WorkflowEnvelope
  -> 返回新 envelope
```

创建后的 ingest 工作流输入固定为入队时的 source、cursor、checkpointRevision 和 triggerKind；source 后续修改不会回写或重算该 `inputSnapshot`。

## 副作用

服务调用以下外部能力：

- `store.findWorkflowEnvelopeByIdempotencyKey`：查询 durable 幂等键。
- `getSourceExecutionSnapshot(sourceId)`：读取 source execution snapshot。
- `getCheckpointSnapshot(sourceId)`：读取 checkpoint cursor 与 revision。
- `store.createWorkflowEnvelope(...)`：请求创建 queued workflow envelope。

服务本身不直接执行 source ingest，不直接写数据库，也不负责发送独立的 outbox、signal、timer 或 child workflow 操作。

## 错误与降级

- `sourceId` 或 `idempotencyKey` trim 后为空：抛出
  `Workflow ingest enqueue requires sourceId and Idempotency-Key.`。
- `triggerKind` 无法通过 schema 解析：入队失败。
- 已有 envelope 的 snapshot 无法安全解析，或 snapshot 与请求 source/trigger 不匹配：抛出
  `Idempotency key ${idempotencyKey} conflicts with another source run.`。
- source snapshot 为 `null`：抛出 `Source not found: ${sourceId}`，不创建 envelope。
- 超过 300 字符只有在调用方先使用 `ingestCommandSchema` 时才被拒绝；`enqueue` 自身不拒绝或截断超长键，见上面的 schema/control 边界说明。
- `WorkflowHostStore` 负责 durable unique key 和并发创建冲突；服务不绕过 store，也不自行提供第二套持久化或冲突恢复逻辑。
- 本服务没有静默降级路径；读取失败、schema 失败和 store 创建失败向调用方传播。

## 依赖

- `WorkflowHostStore`：查询和创建 [WorkflowEnvelope](0007-workflow-host-contract.md)，并承担 Host contract 规定的持久化、canonical JSON、唯一键和 queued event 行为。
- `getSourceExecutionSnapshot`：提供 [SourceExecutionSnapshot](../contracts/0001-public-contracts.md)。
- `getCheckpointSnapshot`：提供 source 对应的 cursor 和 revision。
- `ingestTriggerKindSchema`：校验 [Trigger](../contracts/0001-public-contracts.md) 的 ingest 触发类型。
- `IdGenerator`：生成 `runId`；未提供自定义实现时使用服务默认的 ID 生成器。

调用点包括：

- `apps/api/src/app.module.ts`：组合服务并提供 API manual run。
- API controller：使用 `manual:${sourceId}:${randomUUID()}` 或请求 header 中的幂等键调用服务。
- `apps/worker/src/main.ts`：按 schedule bucket 使用
  `schedule:${source.id}:${floor(now / interval)}` 调用服务。

## 配置

固定工作流定义常量为：

```ts
ingestWorkflowDefinitionReference = "cosmos.ingest@1"
ingestWorkflowManifestHash = "builtin:cosmos.ingest@1:source-snapshot-v1"
```

创建 envelope 时使用：

```ts
definition: {
  key: "cosmos.ingest",
  version: "1",
  manifestHash: "builtin:cosmos.ingest@1:source-snapshot-v1"
}
```

服务没有额外的持久化配置、运行时恢复配置或跨进程协调配置。

## 重建验收

- [ ] 对 `sourceId = " source-1 "` 和非空幂等键入队时，store 查询和 source/checkpoint 读取均使用 `source-1`。
- [ ] 对 trim 后为空的 `sourceId` 或 `idempotencyKey` 入队时，抛出精确错误 `Workflow ingest enqueue requires sourceId and Idempotency-Key.`，且不创建 envelope。
- [ ] `triggerKind` 不符合 `ingestTriggerKindSchema` 时，入队失败，且不创建 envelope。
- [ ] 当 `findWorkflowEnvelopeByIdempotencyKey` 返回 existing，且 existing snapshot 的 `source.id` 与 `triggerKind` 均匹配时，返回同一个 existing envelope，并验证 source/checkpoint reader 均未被调用。
- [ ] 当 existing snapshot 的 source id 不匹配时，抛出精确错误 `Idempotency key ${idempotencyKey} conflicts with another source run.`。
- [ ] 当 existing snapshot 的 trigger kind 不匹配或 snapshot 无法解析时，抛出同一精确动态错误 `Idempotency key ${idempotencyKey} conflicts with another source run.`。
- [ ] 当 source reader 返回 `null` 时，抛出 `Source not found: ${sourceId}`，且不调用 `createWorkflowEnvelope`。
- [ ] 当幂等键未命中且 source、checkpoint 均读取成功时，创建的 input snapshot 包含原始 source snapshot、checkpoint cursor、非负 checkpoint revision 和解析后的 trigger kind。
- [ ] 新建 envelope 的 definition key 为 `cosmos.ingest`，version 为 `1`，manifest hash 为 `builtin:cosmos.ingest@1:source-snapshot-v1`。
- [ ] 新建 envelope 的 `productRun.status` 为 `queued`，并包含 sourceId、triggerKind 和 idempotencyKey。
- [ ] source 在首次入队后发生修改时，已创建 envelope 的 input snapshot 仍保持入队时的 source snapshot。
- [ ] 同一幂等键重复入队时返回相同 envelope；使用相同幂等键但不同 source 或 trigger 时拒绝请求。
- [ ] schedule 调用使用 `schedule:${source.id}:${floor(now / interval)}` 作为幂等键；manual run 使用 `manual:${sourceId}:${randomUUID()}` 或请求 header 幂等键。

## 实现与测试锚点

- 实现：[packages/application/src/workflow-control.ts](../../../packages/application/src/workflow-control.ts#L15-L90)
- 行为测试：[apps/worker/src/workflow-ingest.test.ts](../../../apps/worker/src/workflow-ingest.test.ts#L193-L283)，覆盖 snapshot 捕获、幂等返回、source/trigger 冲突、source mutation 和 checkpoint parity。
- API 组合与调用点：`apps/api/src/app.module.ts` 及其 API controller。
- Worker schedule 调用点：`apps/worker/src/main.ts`。

## 非目标/边界

- 不重新定义或复制 [SourceExecutionSnapshot](../contracts/0001-public-contracts.md)、[Trigger](../contracts/0001-public-contracts.md)、[WorkflowEnvelope](0007-workflow-host-contract.md) 或 [WorkflowDefinition](0007-workflow-host-contract.md) 的 canonical 契约。
- 不描述 HTTP 路由、API 认证或 controller 以外的传输细节。
- 不描述 Kernel 行为。
- 不实现跨进程恢复。
- 不管理 signals、timers、children 或 outbox。
- 不执行实际 ingest，也不负责 Run、Job、Activity 的运行时调度。
- 不直接写数据库；durable unique key、canonical JSON、并发创建冲突和 queued event 均属于 `WorkflowHostStore` 职责。
