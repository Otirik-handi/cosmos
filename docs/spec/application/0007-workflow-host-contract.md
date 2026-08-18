# Workflow Host 契约

## 状态

当前实现规格；后续代码变化应同步更新本文。

2026-08-18

## 组件定位

`packages/application/src/workflow-host.ts` 定义 Workflow Host 的应用层存储契约，包括：

- `WorkflowHostStore`：工作流宿主使用的统一事实来源。
- Run port：工作流执行租约的领取、续租与释放。
- Activity port：Activity Job 的领取、续租、释放与完成。
- Completion port：Activity Completion 的领取、续租、投递、重排与死信处理。

这些接口规定可观察行为、租约 fencing、幂等性和原子性边界；具体存储技术不属于契约。

### 在系统中的位置与作用
它是 Workflow Host runtime 与 durable storage 之间的应用层端口，定义 Run、Activity Job、Completion 的领取、租约和完成语义。

### 解决的问题
它把 fencing、幂等、原子性和 lease 生命周期固定为可观察合同，让 runtime 不必依赖某一种数据库；具体 SQL 实现由 storage owner 提供。

### 使用方式
Host runtime 通过这些 port 按“claim → 在 lease 内执行 → renew 或 complete/requeue/dead-letter”的顺序工作；组合根注入实现，Backend、EventSink 和 Repository 各自保留自己的 owner 边界。

### 典型情景
实现或重建 Workflow Host Store、替换存储适配器，或核对 Worker 在崩溃/重复投递时应遵循的 lease/fence 行为时，先以本契约为准。

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

创建入参可带可空 `sourceId`；该来源身份由 durable WorkflowRun source projection 保存，非 ingest 调用可为 null。`inputSnapshot` 与 `productRun` 是幂等身份的一部分，创建后不可变。Kernel state 由后端另行保存，不嵌入 Envelope。

`WorkflowRuntimeAttempt` 是 Worker 进程当前 Activity 执行的内存登记，字段为 `attemptId`、`jobId`、`runId`、`actionRef`、`lane`、`slot`、`startedAt`、`leaseExpiresAt`、`cancellationRequested`，不含 lease token。公开历史由 Domain Event lifecycle 投影为 AttemptSnapshot；它不是独立 Attempt 表。

`WorkflowRunLease` 的 fencing 身份由 `runId`、`leaseToken`、`owner` 三元组构成，并可带 `leaseExpiresAt`。仅持有 `runId` 或仅匹配 `owner` 不构成有效租约。

`WorkflowHostStore` 还提供 `failWorkflowRun({ runLease, error, now? })`：仅在当前 Run lease owner/token 未过期且 Run 非终态时，以 CAS 将 Run 置为 `failed`，写 `finishedAt`、清除 lease 并追加幂等 `run.failed.v1`；失败的 stale lease/CAS 返回 `false`，不改变其它 owner 状态。
## 输出

Run claim 成功时返回带 `runId`、`owner`、`leaseToken` 和可选 `leaseExpiresAt` 的租约；没有可领取 Run 时返回无候选结果。

Activity claim 成功时返回状态为 `leased` 且带当前 owner、token、expiry 的 Job。Completion claim 同理返回状态为 `leased` 的 Completion；达到 completion attempts 上限时仍由 dispatcher 领取并负责死信，不由 claim 静默丢弃。

`completeActivity` 返回：

- `accepted: boolean`，表示本次提交是否被接受。
- 提交后的 `jobStatus`。
- 适用时返回已创建或复用的 `completion`。

对于同一有效完成提交的重试，返回值必须保持幂等，不得重复推进 Job 或重复创建逻辑上不同的 Completion。公开输出不得泄露其他 owner 的 lease token、内部 fencing 数据或可执行定义。

`failWorkflowRun` 可以把死信导致的非终态 Run 投影为 `failed`；错误字符串只用于受控错误投影，不包含 lease token、Kernel state 或完整外部 payload。
## 状态与持久化

Store 是 Envelope、租约、Activity Job 和 Completion 状态的事实来源。调用方不得以内存缓存替代写入时的租约、状态和 revision 复核。

Envelope 保存工作流身份、输入快照、产品视图、可选 source projection 和生命周期状态；Kernel state 由后端独立保存。`inputSnapshot` 和 `productRun` 在 Envelope 创建后不可修改。

Activity Job 持久化其 `kernelRevision`。任何会写回宿主状态的 Activity 完成都必须同时验证当前 Run lease、当前 Job lease 和预期 Kernel revision。

Completion 持久化被接受的 `DeferredActivityCompletionInput`、receipt、Action reference、fingerprint、投递状态和重试信息，以支持租约过期后的恢复。Completion 达到上限或确定性错误时进入 `dead_letter`，关联 Run 只有在当前 Run lease CAS 成功时才进入 `failed`。

契约只要求各 port 明确声明的原子性、fencing、幂等和恢复行为，不赋予其外的持久化、事务隔离或跨系统一致性语义。
## 状态转换

Envelope 的生命周期为：

```text
queued -> running | waiting
running -> waiting | completed | failed | cancelled
waiting -> running | completed | failed | cancelled
```

`completed`、`failed`、`cancelled` 为 Run 终态。恢复操作可以使需要继续执行的 `waiting` Run 回到 `running`，但不得改写已确定的终态结果。死信失败通过当前 Run lease 的 CAS 追加 `run.failed.v1` 并进入 `failed`。

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

重排会回到 `queued` 并更新可用时间或错误信息。过期的 `leased` Completion 可以重新领取。`delivered` 和 `dead_letter` 为终态；dead-lettered completion 的关联 Run 进入 `failed` 需要另一个受 fence 保护的 CAS。
## 错误与降级

Host 错误码限定为：`conflict`、`not_found`、`lease_lost`、`invalid_state`、`serialization`、`unavailable`。

冲突错误具有独立的 conflict 子类，供调用方在不解析消息文本的情况下识别幂等身份冲突。以下情况必须失败关闭，不得继续写入：Run 或 Job lease 缺失/过期/owner 不符/token 不符；Kernel revision 不匹配；pending Activity identity 或 fingerprint 不匹配；Run、Job 或 Completion 状态不允许目标转换；相同幂等键绑定了不同身份。

暂时性序列化或存储不可用分别报告 `serialization` 或 `unavailable`。接口不要求自动吞掉错误，也不允许把租约丢失降级为无 fencing 写入。`failWorkflowRun` 在 stale lease、终态 Run 或 CAS 未更新时返回 `false`；不得把 false 报成失败投影成功。

重复投递和调用方在响应丢失后的重试属于正常情况；契约通过幂等检查降低重复副作用，但不承诺 exactly-once。
## 重建验收

重建实现必须满足以下验收条件：

1. Envelope 能按 `runId` 和幂等键查询，输入快照、产品视图和 source projection 创建后不可变。
2. `startAction` 对相同幂等键和相同 Activity identity 复用 receipt、状态和结果，对不同 identity 报 `conflict`。
3. Run claim 遵守 purpose 约束；只有 `execution` 可扫描，辅助 purpose 必须指定 `runId`。
4. Run、Job、Completion 租约过期后可由新 owner 接管，并拒绝旧 owner 的 heartbeat、release、complete 或 deliver。
5. Activity 完成同时校验 Run lease、Job lease、pending Activity identity、fingerprint 和 Kernel revision。
6. Activity 完成不会产生部分提交：Job 终态更新与 Completion 入队同时成功或同时失败。
7. 相同 completion 的重复提交幂等；`retry_wait` 不创建 Completion。
8. Completion 支持过期接管、重排、成功投递和死信；dead-letter 后 Run 观察为 `failed`，stale Run lease/CAS false 不改变新 owner 的状态。
9. 已接受且 pending identity 仍存在的 Completion 可以在 Run 终态后完成投递。
10. `listRunsForRecovery` 能识别只有 Envelope 的 Run，以及 Kernel 仍为 running、需要重新执行的 Run。
11. Worker Activity Attempt register/finish 成对，公开字段不含 lease token。
12. 所有公开 payload 均不包含 lease token、fence 或可执行 schema。
13. 不以任何行为暗示 exactly-once。
