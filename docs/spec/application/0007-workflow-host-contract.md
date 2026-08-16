# Workflow Host 契约

## 状态

Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55

## 最后更新

2026-08-16

## 组件定位

`packages/application/src/workflow-host.ts` 定义 Workflow Host 的应用层存储契约，包括：

- `WorkflowHostStore`：工作流宿主使用的统一事实来源。
- Run port：工作流执行租约的领取、续租与释放。
- Activity port：Activity Job 的领取、续租、释放与完成。
- Completion port：Activity Completion 的领取、续租、投递、重排与死信处理。

这些接口规定可观察行为、租约 fencing、幂等性和原子性边界；具体存储技术不属于契约。

## 概念与定义

共享的 `Action`、`ActivityIdentity`、`JsonValue`、`RetryPolicy` 以[公共契约](../contracts/0001-public-contracts.md)及 `nb-workflow` 相关说明为准，本文不复制其 canonical 定义。

状态集合：

- `WorkflowRunStatus`：`queued | running | waiting | completed | failed | cancelled`。
- `WorkflowJobStatus`：`queued | leased | retry_wait | succeeded | failed_terminal | cancelled`。
- `WorkflowCompletionStatus`：`queued | leased | delivered | dead_letter`。
- Activity Job 的 `kind` 唯一合法值为 `workflow-activity`。
- `WorkflowActionReference` 是版本化的 `ActionDefinition.ref`，不能替换为可执行 Action、schema 或未版本化名称。

`WorkflowEnvelope` 包含：

```ts
{
  runId;
  idempotencyKey: string | null;
  definition: { key; version; manifestHash };
  inputSnapshot: JsonValue;
  productRun: JsonValue;
  status: WorkflowRunStatus;
  resumeRequired: boolean;
  createdAt;
  updatedAt;
  startedAt: string | null;
  finishedAt: string | null;
}
```

`inputSnapshot` 与 `productRun` 是幂等身份的一部分，创建后不可变。Kernel state 由后端另行保存，不嵌入 Envelope。

`WorkflowRunLease` 的 fencing 身份由 `runId`、`leaseToken`、`owner` 三元组构成，并可带 `leaseExpiresAt`。仅持有 `runId` 或仅匹配 `owner` 不构成有效租约。

`WorkflowActivityJobPayload` 包含：

- `runId`。
- `activity`：`key`、`path`、`seq`、`kind`、`fingerprint`。
- `reference`：版本化 Action 引用。
- `input: JsonValue`。
- JSON `options`。
- `idempotencyKey`。
- 可选 `retryPolicy`。

公开 payload 不包含可执行 schema、fence、lease token 或其他存储内部凭据。

`WorkflowActivityJob` 包含 `id`、`workflowRunId`、`kernelRevision`、`kind`、`status`、`payload`、`attempts`、`maxAttempts`、租约 owner/token/expiry 以及创建、更新时间。领取成功后的 Job 必须带当前 owner 和 token。

`WorkflowCompletion` 包含 `id`、`workflowRunId`、`jobId`、`activityKey`、`receipt`、`reference`、`fingerprint`、`completion: DeferredActivityCompletionInput`、状态、尝试次数、最大尝试次数、`availableAt`、租约字段、`lastError` 及时间戳。领取成功后的 Completion 必须带当前租约信息。

## 外部行为

`WorkflowHostStore` 提供以下宿主行为：

- `loadWorkflowEnvelope` 按 Run 标识加载 Envelope。
- `hasWorkflowKernelState` 判断 Run 是否已有独立保存的 Kernel state。
- `createWorkflowEnvelope` 创建新的 Envelope。
- `findWorkflowEnvelopeByIdempotencyKey` 按幂等键查找既有 Envelope。
- `startAction` 按上下文 `idempotencyKey` 执行幂等的 find-or-create。
- `completeActivity` 原子完成 Activity Job 并在需要时入队 Completion。
- `markResumeRequired` 仅允许当前 Run lease 持有者标记恢复需求。
- `listRunsForRecovery` 返回只有 Envelope、尚缺 Kernel state 的 Run，以及 Kernel 仍为 running、需要重新执行的 Run。

`startAction` 遇到相同幂等键和相同 Activity identity 时，复用已有 `receipt`、状态和结果；相同幂等键对应不同 Activity identity 时必须报告冲突。

Run claim 按 `purpose` 区分 `execution | activity | completion`。`execution` 可以扫描可执行 Run；`activity` 和 `completion` 必须显式提供 `runId`，不得跨 Run 扫描领取。

Completion 在已被接受且对应 pending Activity identity 仍存在时，可以在 Run 进入终态后继续投递。实现不得以“Run 已终态”为由统一拒绝这类投递。

接口不提供 exactly-once 保证。调用方和投递目标必须依靠 receipt、幂等键及状态检查承受重复调用。

## 输入

`ClaimWorkflowRunInput` 包含：

- `owner` 和 `leaseMs`。
- 可选 `runId`。
- `purpose: execution | activity | completion`。
- 可选 `now`，用于确定性的租约和可用时间判断。

Run port 输入由 `claimRun`、`heartbeatRun`、`releaseRun` 使用。续租和释放必须提交完整的当前 Run lease 身份。

Activity port 提供：

- `claimActivityJob`：领取可执行 Job。
- `heartbeatActivityJob`：延长当前 Job lease。
- `releaseActivityJob`：释放当前 Job lease。
- `completeActivity`：提交 Activity 执行结果。

`CompleteActivityInput` 必须同时包含：

- `jobLease`：`jobId`、token、owner。
- 当前 `runLease`。
- 结果：`status: succeeded | retry_wait | failed_terminal | cancelled`，以及适用的 `result`、`errorCode`、`error`、`retryDelayMs`。
- 除 `retry_wait` 外必须提供 completion；`retry_wait` 不得产生 Completion。

Completion port 提供：

- `claimWorkflowCompletion`。
- `heartbeatWorkflowCompletion`。
- `deliverWorkflowCompletion`，且投递时必须提供当前 Run lease。
- `requeueWorkflowCompletion`。
- `deadLetterWorkflowCompletion`。

## 输出

Run claim 成功时返回带 `runId`、`owner`、`leaseToken` 和可选 `leaseExpiresAt` 的租约；没有可领取 Run 时返回无候选结果。

Activity claim 成功时返回状态为 `leased` 且带当前 owner、token、expiry 的 Job。Completion claim 同理返回状态为 `leased` 的 Completion。

`completeActivity` 返回：

- `accepted: boolean`，表示本次提交是否被接受。
- 提交后的 `jobStatus`。
- 适用时返回已创建或复用的 `completion`。

对于同一有效完成提交的重试，返回值必须保持幂等，不得重复推进 Job 或重复创建逻辑上不同的 Completion。

`startAction` 的重复调用在身份一致时返回既有 receipt、状态和结果，而不是创建新的 Action 实例。

公开输出不得泄露其他 owner 的 lease token、内部 fencing 数据或可执行定义。

## 状态与持久化

Store 是 Envelope、租约、Activity Job 和 Completion 状态的事实来源。调用方不得以内存缓存替代写入时的租约、状态和 revision 复核。

Envelope 保存工作流身份、输入快照、产品视图和生命周期状态；Kernel state 由后端独立保存。`inputSnapshot` 和 `productRun` 在 Envelope 创建后不可修改。

Activity Job 持久化其 `kernelRevision`。任何会写回宿主状态的 Activity 完成都必须同时验证：

- 当前 Run lease。
- 当前 Job lease。
- 预期 Kernel revision。

Completion 持久化被接受的 `DeferredActivityCompletionInput`、receipt、Action reference、fingerprint、投递状态和重试信息，以支持租约过期后的恢复。

契约只要求各 port 明确声明的原子性、fencing、幂等和恢复行为，不赋予其外的持久化、事务隔离或跨系统一致性语义。

## 状态转换

Envelope 的生命周期为：

```text
queued -> running | waiting
running -> waiting | completed | failed | cancelled
waiting -> running | completed | failed | cancelled
```

`completed`、`failed`、`cancelled` 为 Run 终态。恢复操作可以使需要继续执行的 `waiting` Run 回到 `running`，但不得改写已确定的终态结果。

Run claim 建立带 owner、token 和 expiry 的 fencing 租约。heartbeat 仅能延长当前租约；release 仅能释放当前租约；租约过期后允许新 owner 领取并获得新 token。旧 owner 的后续写入必须返回 false 或以 `lease_lost` 失败关闭。

Activity Job 的状态转换为：

```text
queued | retry_wait -> leased
leased -> succeeded | retry_wait | failed_terminal | cancelled
```

过期的 `leased` Job 可以被重新领取并生成新的 lease token。`retry_wait` 在可重试时间到达后可再次进入 `leased`。`succeeded`、`failed_terminal`、`cancelled` 不得重新执行。一次 Activity 尝试以 `retry_wait` 结束时不创建 Completion。

Completion 的状态转换为：

```text
queued -> leased
leased -> delivered | queued | dead_letter
```

重排会回到 `queued` 并更新可用时间或错误信息。过期的 `leased` Completion 可以重新领取。`delivered` 和 `dead_letter` 为终态。

`completeActivity` 必须在一个原子操作中重新检查：

- Run lease 仍为当前 owner/token 且未过期。
- Job lease 仍为当前 jobId/owner/token 且未过期。
- Run 未处于不允许该 Activity 完成的状态。
- pending Activity 的 identity 以及 `key`、`path`、`seq`、`kind`、`fingerprint` 全部匹配。
- Job 的 `kernelRevision` 与当前预期 revision 匹配。
- 相同 completion 的重复提交可以幂等复用。

Run lease 与 Job lease 的双重 fencing 是契约要求。缺少任一租约、revision 不匹配或旧 owner 提交时，都不得产生部分写入。

## 副作用

`createWorkflowEnvelope` 和首次成功的 `startAction` 可以创建持久化 Envelope 或 Action receipt。

`completeActivity` 可以原子地：

- 将 Job 转为 `succeeded`、`failed_terminal` 或 `cancelled`。
- 保存对应完成结果。
- 入队一条 Completion。

当结果为 `retry_wait` 时，只更新 Job 的重试状态和相关时间，不入队 Completion。

`deliverWorkflowCompletion` 可以把已接受的完成结果交付给对应 Run，并将 Completion 标记为 `delivered`。失败后可通过 requeue 延迟重试，或在不可恢复时进入 `dead_letter`。

`markResumeRequired` 会修改 Envelope 的恢复标记，但只有当前 Run lease 持有者可以执行。

## 错误与降级

Host 错误码限定为：

- `conflict`
- `not_found`
- `lease_lost`
- `invalid_state`
- `serialization`
- `unavailable`

冲突错误具有独立的 conflict 子类，供调用方在不解析消息文本的情况下识别幂等身份冲突。

以下情况必须失败关闭，不得继续写入：

- Run 或 Job lease 缺失、过期、owner 不符或 token 不符。
- Kernel revision 不匹配。
- pending Activity identity 或 fingerprint 不匹配。
- Run、Job 或 Completion 状态不允许目标转换。
- 相同幂等键绑定了不同身份。

暂时性序列化或存储不可用分别报告 `serialization` 或 `unavailable`。接口不要求自动吞掉错误，也不允许把租约丢失降级为无 fencing 写入。

重复投递和调用方在响应丢失后的重试属于正常情况；契约通过幂等检查降低重复副作用，但不承诺 exactly-once。

## 依赖

该契约依赖公共 contracts 中的 Action 引用、Activity identity、JSON 值和重试策略定义，详见[公共契约](../contracts/0001-public-contracts.md)。

Workflow Host runtime 依赖这些 ports 获取事实状态和执行受 fencing 保护的更新；ports 不依赖具体数据库、消息系统或宿主部署拓扑。

## 配置

接口没有全局环境配置要求。影响行为的参数通过调用或持久化记录显式传入，包括：

- claim 的 `owner`、`leaseMs`、`purpose`、可选 `runId` 和可选 `now`。
- Job 的 `maxAttempts`、可选 `retryPolicy` 和重试延迟。
- Completion 的 `maxAttempts` 与 `availableAt`。
- Envelope 的 definition key、version 和 manifest hash。

测试或重建实现可以通过 `now` 注入确定性时间；生产实现仍必须以同一租约过期规则判断所有 claim、heartbeat 和受保护写入。

## 重建验收

重建实现必须满足以下验收条件：

1. Envelope 能按 `runId` 和幂等键查询，输入快照与产品视图创建后不可变。
2. `startAction` 对相同幂等键和相同 Activity identity 复用 receipt、状态和结果，对不同 identity 报 `conflict`。
3. Run claim 遵守 purpose 约束；只有 `execution` 可扫描，辅助 purpose 必须指定 `runId`。
4. Run、Job、Completion 租约过期后可由新 owner 接管，并拒绝旧 owner 的 heartbeat、release、complete 或 deliver。
5. Activity 完成同时校验 Run lease、Job lease、pending Activity identity、fingerprint 和 Kernel revision。
6. Activity 完成不会产生部分提交：Job 终态更新与 Completion 入队同时成功或同时失败。
7. 相同 completion 的重复提交幂等；`retry_wait` 不创建 Completion。
8. Completion 支持过期接管、重排、成功投递和死信。
9. 已接受且 pending identity 仍存在的 Completion 可以在 Run 终态后完成投递。
10. `listRunsForRecovery` 能识别只有 Envelope 的 Run，以及 Kernel 仍为 running、需要重新执行的 Run。
11. 所有公开 payload 均不包含 lease token、fence 或可执行 schema。
12. 不以任何行为暗示 exactly-once。

## 实现与测试锚点

- 契约实现：[packages/application/src/workflow-host.ts](../../../packages/application/src/workflow-host.ts#L12-L391)。
- Fake port 契约测试：[packages/application/src/workflow-host-runtime.test.ts](../../../packages/application/src/workflow-host-runtime.test.ts)。
- 租约 fencing 与接管测试：[packages/storage-prisma/src/workflow-host-store.test.ts](../../../packages/storage-prisma/src/workflow-host-store.test.ts#L132-L212)。
- Envelope、幂等性和 Activity fencing 测试：[packages/storage-prisma/src/workflow-host-store.test.ts](../../../packages/storage-prisma/src/workflow-host-store.test.ts#L214-L375)。
- `startAction` 与 `completeActivity` 测试：[packages/storage-prisma/src/workflow-host-store.test.ts](../../../packages/storage-prisma/src/workflow-host-store.test.ts#L480-L650)。
- Completion 恢复、死信和 Run 终态后投递测试：[packages/storage-prisma/src/workflow-host-store.test.ts](../../../packages/storage-prisma/src/workflow-host-store.test.ts#L652-L887)。

## 非目标/边界

本文不规定具体存储实现、表结构、查询策略、事务 API 或部署方式。Ports 不承诺 Prisma，也不承诺任何其他特定数据库或 ORM。

本文不定义 signals、timers、children、通用 outbox、Gateway、Redis 或多主机协调协议。若这些能力需要与 Workflow Host 集成，必须通过独立契约定义。

本文不描述工作流调度算法、执行优先级或队列扫描策略。Ports 只规定单次 claim 和受 fencing 保护的状态操作。

本文不提供跨外部系统的 exactly-once、分布式事务或全局顺序保证，也不允许调用方从本契约推导未明确声明的 durable semantics。
