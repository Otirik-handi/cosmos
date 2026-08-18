# Connector Runtime 组件规格

## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

2026-08-16

## 组件定位

本组件位于 `packages/application/src/index.ts`，由以下三个应用层服务组成：

- `ConnectorRegistry`：维护当前进程可用的采集连接器，并按来源类型解析连接器。
- `ConnectorProbeService`：对已有来源执行只读探测，验证连接器配置并尝试获取一批数据。
- `IngestionService`：执行由旧 SQL Run 模型承载的单来源采集，将获取结果交给 Repository 持久化，并推进 Run 与 Checkpoint。

组件处于连接器实现、领域持久化接口和调用方之间。它负责调用编排和错误传播，但不拥有领域数据真相，也不提供跨进程工作流语义。

### 在系统中的位置与作用
它位于具体 Connector、领域/Repository 端口和应用调用方之间，提供连接器解析、只读探测以及旧 SQL Run 采集的编排。

### 解决的问题
它把“按 Source kind 找到连接器、校验配置、抓取结果、推进 Run/Checkpoint”串成一致入口，并集中传播连接器和持久化错误；它不替代 Workflow Host。

### 使用方式
组合根先注册 `ConnectorRegistry`；调用方通过 registry 解析连接器，探测走 `ConnectorProbeService`，旧采集走 `IngestionService`，后者按既有端口把结果交给 Repository 并推进 Run/Checkpoint。

### 典型情景
API 需要探测一个已保存 Source，或 legacy worker 需要执行一次 `source-ingest`/`source-probe` 时，使用这里的服务，不让 Connector 直接访问 Prisma。

## 概念与定义

### IngestConnector

`IngestConnector` 是连接器运行时端口。实现必须公开以下元数据：

- `id: string`
- `description: string`
- `configVersion: string`
- `capabilities: readonly string[]`

其两个方法签名是两个不同的输入形状：

```ts
validate(source: SourceSnapshot): void;
fetchItems(input: {
  source: SourceSnapshot;
  cursor: string | null;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<{
  items: readonly NormalizedIngestItem[];
  nextCursor: string | null;
}>;
```

`validate` 接收 Source 对象本身，绝不是 `{ source }` 包装对象；只有 `fetchItems` 使用对象参数。`validate` 不返回连接器结果，验证失败通过抛出异常表示。

采集项采用 [NormalizedIngestItem](../domain/0001-normalized-content.md)；来源及其他共享契约采用 [公共契约](../contracts/0001-public-contracts.md)。

### ConnectorResolver

`ConnectorResolver` 是从来源到连接器的解析边界。`ConnectorRegistry` 实现该边界，并依据 `source.kind` 查找注册表中同名 `connector.id` 的连接器。注册时不会替连接器和 Source 做额外的 kind 一致性校验；因此注册的 `id` 必须在实际使用的 Source kind 中可解析。


### ConnectorExecutionError

`ConnectorExecutionError` 表示连接器执行阶段的已分类错误。允许的 `code` 仅为：

- `dependency_unavailable`
- `authentication_required`
- `timeout`
- `rate_limited`
- `malformed_payload`
- `unsupported_version`
- `invalid_configuration`

错误包含 `retryable`。调用方未显式指定时，其默认值为 `true`。

该错误只携带分类和可重试性信息；本组件不会因为 `retryable` 为 `true` 而自动重试。

## 外部行为

### ConnectorRegistry

- `register(connector)` 按 `connector.id` 将连接器加入进程内注册表。
- 同一 `connector.id` 不能重复注册；重复注册立即抛出 `Error`。
- `resolve(source)` 按 `source.kind` 查找连接器。
- 找不到连接器时，`resolve` 抛出包含 `Unsupported source connector` 的错误。
- `validate(source)` 先解析连接器，再调用该连接器的 `validate(source)`。
- `descriptors()` 返回已注册连接器的 `id`、`description`、`capabilities` 和 `configVersion`。
- `descriptors()` 按注册顺序返回结果，不自行排序。
- 每个 descriptor 中的 `capabilities` 是副本，调用方修改该值不得修改连接器自身持有的 `capabilities`。

### ConnectorProbeService

`runSource(sourceId)` 执行以下行为：

1. 通过 `getSource` 读取来源。
2. 来源不存在时抛出错误。
3. 通过 `ConnectorResolver` 解析连接器。
4. 调用连接器的 `validate(source)`。
5. 调用 `fetchItems({ source, cursor: null })`。
6. 返回 [SourceProbeResult](../contracts/0001-public-contracts.md)。

探测结果反映来源标识、连接器标识、返回项数量、是否存在下一游标以及检查时间。

探测过程中不传递 `idempotencyKey`，也不传递 `AbortSignal`。

### IngestionService

`runSource(sourceId)` 执行以下行为：

1. 从 Repository 读取来源。
2. 来源不存在时抛出错误。
3. 创建 `triggerKind` 为 `manual` 的旧 SQL Run。
4. 对该 Run 执行带 lease 的采集流程。

`runExistingRunWithLease(runId, lease)` 执行以下行为：

1. 读取 Run。
2. 读取 Run 对应的来源。
3. 调用 `startRun(runId, lease)`。
4. 解析连接器并调用 `validate(source)`。
5. 读取来源 Checkpoint。
6. 使用 Checkpoint 中的 cursor 调用 `fetchItems`。
7. 按连接器返回顺序逐项调用 `persistIngestItem({ sourceId, runId, item })`。
8. 写入连接器返回的下一 Checkpoint。
9. 调用 `completeRun`，将 Run 标记为 `succeeded`。
10. 返回采集结果。

该旧执行路径调用 `fetchItems` 时不传递 `idempotencyKey`，也不传递 `AbortSignal`。

## 输入

### ConnectorRegistry

- 注册输入：符合 `IngestConnector` 行为约束的连接器实例。
- 解析及验证输入：来源对象，其共享契约见 [公共契约](../contracts/0001-public-contracts.md)。

### ConnectorProbeService

- `sourceId`：要探测的已有来源标识。
- 构造依赖：提供 `getSource` 的读取能力以及一个 `ConnectorResolver`。

### IngestionService

- `runSource` 输入：已有来源标识。
- `runExistingRunWithLease` 输入：已有 Run 标识和有效 lease。
- 构造依赖：`CosmosRepository` 和 `ConnectorResolver`。
- 连接器输入：来源、当前 cursor，以及由连接器消费的来源配置。

## 输出

### ConnectorRegistry

- `resolve` 返回与 `source.kind` 对应的连接器；未命中时抛出上述错误。
- `validate(source)` 先解析、调用 `connector.validate(source)`，成功后返回该连接器；验证异常原样传播。
- `descriptors` 返回注册连接器的描述信息快照，并复制 `capabilities`。

### ConnectorProbeService

成功时返回 [SourceProbeResult](../contracts/0001-public-contracts.md)。其中：

- `sourceId` 对应被探测来源。
- `connectorId` 对应实际解析到的连接器。
- `itemCount` 对应本次 `fetchItems` 返回项数量。
- `nextCursorAvailable` 表示连接器是否返回了可继续采集的游标。
- `checkedAt` 表示本次探测的检查时间。

### IngestionService

成功时返回采集结果，其中包含：

- 已完成的 Run。
- Run 上附加的 `itemCount`、`createdEntryCount` 和 `revisedEntryCount`。
- 顶层 `createdEntryCount`。
- 顶层 `revisedEntryCount`。
- 顶层 `duplicateObservationCount`。

共享结果契约以 [公共契约](../contracts/0001-public-contracts.md) 为准。

## 状态与持久化

`ConnectorRegistry` 的注册状态仅保存在当前进程内的 `Map` 中。进程退出后，该注册状态不会由本组件恢复。

`ConnectorProbeService` 不写入领域数据，并且不得调用：

- `persistIngestItem`
- `setCheckpoint`
- `createRun`

`IngestionService` 自身不保存 durable 状态。以下对象的持久化真相由 `CosmosRepository` 拥有：

- Source
- Run
- Checkpoint
- Observation

连接器返回的数据只有在 `IngestionService` 调用 Repository 后才成为持久化事实。

## 状态转换

### 注册表

- 未注册 → 已注册：首次以某个 `connector.id` 调用 `register`。
- 已注册 → 拒绝重复注册：再次使用相同 `connector.id` 注册时抛错，原映射保持不变。
- 已注册项没有由本组件公开定义的移除或替换转换。

### 探测

探测是一次无持久化状态转换的调用序列：

`读取 Source → 解析 Connector → 验证 Source → 获取数据 → 返回探测结果`

任一步骤失败时调用终止，错误原样向上抛出，不产生领域持久化状态转换。

### 采集

成功路径的可观察转换顺序为：

`读取 Run 与 Source → startRun(runId, lease) → 验证 Source → 读取 Checkpoint → 获取数据 → 顺序持久化采集项 → 写入 Checkpoint → completeRun(succeeded)`

失败路径为：

`任一执行步骤抛错 → 记录失败日志 → 尝试 completeRun(failed, error, lease)`

只有 `completeRun` 成功后，才能将失败终态视为已持久化。

## 副作用

### ConnectorRegistry

- 修改当前进程内的连接器 `Map`。
- 不写入 Repository。
- 不执行连接器网络请求。

### ConnectorProbeService

- 调用来源读取接口。
- 调用连接器验证逻辑。
- 调用连接器获取逻辑；该逻辑可能访问外部依赖。
- 记录 `probe`、`validate` 和 `fetch` 阶段的结构化日志。
- 不创建 Run，不写 Checkpoint，不持久化采集项。
### IngestionService

- 读取 Source、Run 和 Checkpoint。
- 创建 manual Run，调用连接器验证和获取逻辑。
- 按返回顺序持久化采集项，写入 Checkpoint，并将 Run 完成为 `succeeded` 或尝试完成为 `failed`。
- 记录运行时结构化日志，包括失败信息。

## 错误与降级

- 重复注册：立即抛出 `Error`，消息为 `Duplicate connector id: ${connector.id}`。
- 无匹配连接器：抛出消息为 `Unsupported source connector: ${source.kind}` 的错误。
- `ConnectorProbeService` 的 Source 缺失消息为 `Source not found: ${sourceId}`；解析、验证或获取失败时记录阶段日志并将原异常对象向上抛出，不创建 Run、Checkpoint 或采集项。
- `IngestionService.runSource` 的 Source 缺失消息为 `Source not found: ${sourceId}`；`runExistingRunWithLease` 的 Run 缺失消息为 `Run not found: ${runId}`，其 Source 缺失消息为 `Source not found: ${sourceId}`。
- 采集执行异常时，`IngestionService` 先记录错误，再尝试以原 lease 调用 `completeRun` 写入失败终态。`ConnectorExecutionError` 的 `code` 和 `retryable` 进入 `IngestResult`；其它异常使用 `errorCode: null`、`retryable: true`。
- 失败终态的 `completeRun` 失败时抛出 `RunFinalizationError`，不返回伪造的失败 Run；逐项写入在后续步骤失败时不回滚。
- `retryable` 只是结果分类；本组件不自动重试。

## 依赖

### ConnectorRegistry

- JavaScript/TypeScript 进程内 `Map`。
- 已注册的 `IngestConnector` 实例。

### ConnectorProbeService

- `getSource`：按来源标识读取 Source。
- `ConnectorResolver`：按来源解析连接器。
- 连接器的 `validate` 和 `fetchItems`。
- 结构化日志设施。
- 时间来源，用于产生探测检查时间。

### IngestionService

- `CosmosRepository`：
  - 读取 Source 和 Run。
  - 创建、启动和完成 Run。
  - 读取和写入 Checkpoint。
  - 持久化采集项及其 Observation/Entry 结果。
- `ConnectorResolver`。
- 连接器的 `validate` 和 `fetchItems`。
- 结构化日志设施。

## 配置

- 连接器通过 `id` 与 `source.kind` 建立解析关系。
- `configVersion` 是连接器 descriptor 的一部分，并随 `descriptors()` 输出。
- `capabilities` 是连接器 descriptor 的一部分，对外返回时必须复制。
- 来源配置由连接器的 `validate(source)` 解释和验证。
- 本组件不定义额外的持久化注册表配置。
- 本组件不定义自动重试次数、退避策略或超时策略。
- 当前探测路径和旧采集路径均不向连接器传递 `AbortSignal`。
- 当前探测路径和旧采集路径均不向连接器传递 `idempotencyKey`。

## 重建验收

1. 注册两个不同 `id` 的连接器后，`descriptors()` 必须按注册顺序返回两个 descriptor，且不得自行按 `id` 或其他字段排序。
2. 修改 `descriptors()` 返回值中的 `capabilities` 后，再次读取 descriptor 或检查原连接器时，原 `capabilities` 必须保持不变。
3. 使用已注册的 `connector.id` 再次注册时，`register` 必须立即抛出 `Error`，且原连接器仍可被解析。
4. `resolve(source)` 必须仅依据 `source.kind` 解析连接器；没有匹配项时必须抛出包含 `Unsupported source connector` 的错误。
5. `ConnectorRegistry.validate(source)` 必须先解析连接器，并且恰好调用所解析连接器的 `validate(source)`。
6. `ConnectorProbeService.runSource` 在 Source 不存在时必须失败，且不得调用连接器或任何写入方法。
7. 探测成功时，必须以 `cursor: null` 调用一次 `fetchItems`，且参数中不得提供 `idempotencyKey` 或 `signal`。
8. 探测成功时，返回的来源标识、连接器标识、项数量和下一游标可用性必须与实际读取和获取结果一致。
9. 探测无论成功或失败，都不得调用 `createRun`、`persistIngestItem` 或 `setCheckpoint`。
10. 探测的解析、验证或获取失败时，原错误对象必须向上抛出，不得替换为成功结果或另一分类错误。
11. 探测执行必须产生覆盖 `probe`、`validate` 和 `fetch` 阶段的结构化日志。
12. `IngestionService.runSource` 在 Source 不存在时必须失败，且不得创建 Run。
13. `IngestionService.runSource` 对存在的 Source 必须创建 `triggerKind: manual` 的旧 SQL Run。
14. `runExistingRunWithLease` 必须在连接器验证和数据获取前调用 `startRun(runId, lease)`。
15. 获取数据前必须读取 Checkpoint，并将其 cursor 传给 `fetchItems`；调用参数不得提供 `idempotencyKey` 或 `signal`。
16. 多个采集项必须严格按 `fetchItems` 返回顺序逐项传给 `persistIngestItem({ sourceId, runId, item })`。
17. 成功路径必须在所有采集项持久化后调用 `setCheckpoint`，并在其成功后调用 `completeRun` 写入 `succeeded`。
18. 成功结果必须包含 Run 以及一致的 `itemCount`、`createdEntryCount`、`revisedEntryCount` 和 `duplicateObservationCount`。
19. `ConnectorExecutionError` 导致失败时，返回的 `IngestResult` 必须包含该错误的 `errorCode` 和 `retryable`；传给 `completeRun(failed)` 的参数必须包含失败消息和原 lease。
20. 非 `ConnectorExecutionError` 导致失败时，返回的 `IngestResult` 必须包含 `errorCode: null` 和 `retryable: true`；不得把这些字段臆造为 `completeRun` 的输入。
21. 任何执行异常都不得触发本组件内建重试。
22. 原执行异常发生后，如果失败终态的 `completeRun` 也失败，最终必须抛出 `RunFinalizationError`，且不得返回伪造的失败终态。
23. `ConnectorRegistry` 重建后不得依赖先前进程中的注册状态；所有连接器必须重新注册。
24. 除 Repository 写入结果外，三个组件不得声明或依赖自身的 durable 状态。

## 实现与测试锚点

- 实现：[packages/application/src/index.ts](../../../packages/application/src/index.ts#L231-L689)
- `ConnectorRegistry` 测试：[packages/application/src/index.test.ts](../../../packages/application/src/index.test.ts#L101-L123)
- `ConnectorProbeService` 测试：[packages/application/src/index.test.ts](../../../packages/application/src/index.test.ts#L125-L212)
- 运行时日志与 `IngestionService` 测试：[packages/application/src/index.test.ts](../../../packages/application/src/index.test.ts#L214-L273)
- 公共契约：[公共契约](../contracts/0001-public-contracts.md)
- 规范化内容模型：[规范化内容模型](../domain/0001-normalized-content.md)

## 非目标/边界

- 不定义连接器内部如何访问远端系统、解析载荷或实现认证。
- 不定义共享契约或规范化内容的 canonical 数据结构；这些定义分别由 [公共契约](../contracts/0001-public-contracts.md) 和 [规范化内容模型](../domain/0001-normalized-content.md) 负责。
- 不提供连接器自动发现、持久化注册、热替换或跨进程注册同步。
- 不提供自动重试、退避、调度或并发控制策略。
- 不保证一批采集项及 Checkpoint 更新构成单一事务。
- 不拥有 Source、Run、Checkpoint 或 Observation 的持久化真相。
- 不提供跨进程恢复语义。
- 不提供 signals、timers、children 或 outbox 语义。
- 不将该组件定义为 Workflow Kernel。
