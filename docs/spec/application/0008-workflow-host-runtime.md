# Workflow Host Runtime

## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

2026-08-18

## 组件定位

`packages/application/src/workflow-host-runtime.ts` 提供三个单次轮询执行通道：

| 组件 | 职责 |
| --- | --- |
| `WorkflowRunLane` | 领取可执行 [Run](0007-workflow-host-contract.md)，加载工作流信封并执行 `begin` 或 `rerun` |
| `WorkflowActivityWorker` | 领取 Activity [Job](0007-workflow-host-contract.md)，在持有 Job 与 Run Lease 时解析、执行 [Action](0003-action-registry.md)，并提交 Activity 结果 |
| `WorkflowCompletionDispatcher` | 领取持久化 [Completion](0007-workflow-host-contract.md)，在 Run 上调用 Kernel completion API，并确认、重排或死信该 Completion |

三个通道均以 `pollOnce()` 为最小工作单元，不拥有调度循环，也不拥有 SQL truth。

### 在系统中的位置与作用

它位于 Worker 主循环与 Workflow Host Store、Kernel Runner、Action Registry 之间，提供 Run、Activity、Completion 三条单次轮询通道。

### 解决的问题

它把一次 durable 工作单元的领取、执行和确认串起来，并在每条通道内应用 Run/Job lease 与 fence；它本身不拥有调度循环或 SQL truth。

### 使用方式

Worker 组合好 store、runner、definitions、values 和 registry 后，按轮询周期分别调用各 lane 的 `pollOnce()`；执行所需的定义、Action 和持久化依赖由组合根注入。

### 典型情景

Worker 需要推进已入队的 Workflow Run、Activity Job 或 Completion 时使用这些 lane；若只想定义业务步骤，应修改 Workflow/Action，而不是 lane。

## 概念与定义

[Run、Job、Completion、Lease 与 Fence](0007-workflow-host-contract.md)、[Action](0003-action-registry.md) 及其[公开契约](../contracts/0001-public-contracts.md)沿用 canonical 定义，本文不复制这些定义。

`FixedRunIdGenerator` 是运行时内部适配器，确保新 Kernel 状态调用 `runner.begin(...)` 时生成的首个 Run ID 与当前已领取的 Run ID 相同。

“Lease 丢失”包括 heartbeat 返回 `false` 或抛出异常。Lease 丢失后，运行时通过 `AbortSignal` 和可选 runner 中断接口发出协作式取消，并通过 lease race 阻止后续持久化确认。

## 外部行为

`WorkflowRunLane.pollOnce({ runId? })`：

1. 调用 `claimRun({ owner, leaseMs, purpose: "execution", runId?, now })`；没有 Lease 时返回 `null`。
2. 加载工作流信封；信封不存在属于错误，不创建新信封。
3. 解析工作流 definition，以 lease-aware backend、events、固定 Run ID 和初始时钟创建 runner。
4. `hasWorkflowKernelState(runId) === false` 时调用 `runner.begin(definition, envelope.inputSnapshot, { signal })`；已有状态时调用 `runner.rerun(runId)`。Kernel 的 `rerun` API 不接收 signal。
5. `waiting`、`completed`、`failed`、`cancelled` 均是本次执行的返回边界，并记录 terminal 日志。
6. `finally` 中停止 heartbeat 并释放 Run Lease；`abortActive(reason)` 会取消当前 Run controller，并尽可能调用 runner 的 abort/stop/interrupt。

Worker 主循环在普通 run claim 前调用 `store.listRunsForRecovery({ limit: 1 })`；有候选时把其 `runId` 传入 `pollOnce`，无候选时才进行普通扫描。该查询只提供 recovery priority，claim/CAS 仍是唯一领取权威。

`WorkflowActivityWorker.pollOnce()`：

1. 调用 `claimActivityJob(...)`；没有 Job 时返回 `null`。
2. Job kind 不是 `workflow-activity` 时仅记录警告并返回 `null`，且不领取 Run。
3. 领取 `claimRun({ runId: job.workflowRunId, purpose: "activity", ... })`；失败时以 reason 释放 Activity Job 并返回 `null`。
4. 成功 claim 且确定 Action ref 后登记 `${job.id}:attempt:${job.attempts}` 的 `WorkflowRuntimeAttempt`，当前单 poll 的 `slot` 固定为 `0`；执行、异常和取消路径均在 `finally` 调用 finish。登记/注销回调异常只记录 warning，不改变 Activity 结果；Attempt 不含 lease token。
5. 同时维持 Run 与 Job heartbeat，解析 Action，并使用持久化 reference、input、options、activity、idempotency key 发起执行。
6. host placement 使用 `hostFence(...)`；其他 placement 使用 public dispatch。
7. 成功输出必须是 JSON-safe，随后调用 store 完成 Activity。
8. `finally` 中释放 Run Lease；`abortActive(reason)` 取消当前 Action controller，使 shutdown 复用现有 AbortSignal/lease-fence 路径。

`WorkflowCompletionDispatcher.pollOnce()`：

1. 调用 `claimWorkflowCompletion(...)`；没有 Completion 时返回 `null`。达到 attempts 上限的记录仍须可领取，由 dispatcher 取得对应 Run lease 后负责 dead-letter。
2. 以 `purpose: "completion"` 领取对应 Run；失败时按 completion 失败策略重排或死信。
3. 同时维持 Run 与 Completion heartbeat。
4. 创建 lease-aware runner，调用 `runner.completeActivity(runId, completion.completion)`。
5. 仅在调用成功且 heartbeat 未丢失时执行 `deliverWorkflowCompletion(completionLease, runLease)`；返回 `false` 时重排。
6. 确定性 Kernel 错误或 completion attempts 达到 `maxCompletionAttempts` 时，先 dead-letter，再通过当前 Run lease 调用 `failWorkflowRun`；Run 进入 `failed`，不再停在 `running`。transient 错误仍按指数退避 requeue。
7. `finally` 中释放 Run Lease；`abortActive(reason)` 取消当前 completion controller。

只要 store 仍接受 pending completion identity，即使 Run 已处于 terminal 状态，dispatcher 仍可交付最后一个 Activity Completion；不能仅依据 Run terminal 状态拒绝交付。

## 输入

运行时依赖为：

```ts
WorkflowRuntimeDependencies = {
  store,
  backend?,
  deferredActivities?,
  definitions?,
  values?,
  events?,
  ids?,
  resolveDefinition?,
  runnerFactory?,
  now?,
}
```

Run lane 的持久化输入是已领取 Run 对应的 workflow envelope、input snapshot、definition 和可选 Kernel state。Activity worker 的输入是 durable Activity Job 及其 Action reference、input、options、retry policy、attempt 和 fence token。Completion dispatcher 的输入是 durable Workflow Completion 及其 completion identity。

Action 的公开执行 context 仅包含 `idempotencyKey` 与 `signal`。Run token、Job token、attempt token 及 Kernel revision 不得进入公开 Action context。

## 输出

| 方法 | 返回类型 | 含义 |
| --- | --- | --- |
| `WorkflowRunLane.pollOnce()` | `RunView \| null` | 本次 runner 执行后的 Run；无可领取 Run 时为 `null` |
| `WorkflowActivityWorker.pollOnce()` | `CompleteActivityResult \| null` | store 接受的 Activity 结果（包括 `retry_wait`）；无 Job、Kind 被拒绝、Run lease 不可用、lease 丢失、重排或死信时为 `null` |
| `WorkflowCompletionDispatcher.pollOnce()` | `RunView \| null` | Completion 交付后的 Run；无工作、重排、死信或 Lease 丢失时为 `null` |

Activity terminal success 生成 completed completion identity：`activityKey`、`receipt = job.id`、`reference`、`fingerprint`、`status: "completed"` 与 `result`。Terminal failure 或 cancellation 生成对应 failed/cancelled completion；retry wait 不生成 Completion。

## 状态与持久化

三个通道只领取、heartbeat、释放或提交 durable store 资源。Kernel、Backend、ValueStore、DefinitionRegistry 由 runner 使用；运行时不建立第二份工作流状态，也不把内存对象作为恢复依据。

WorkerRuntime 的 recovery 查询只决定 run lane 的候选优先级，不建立第二个队列；具体 claim、lease takeover、Attempt lifecycle event、Completion attempts/dead-letter 和 Run failed projection 仍由 durable store 判定。

`WorkflowRunLane` 接收 WorkerRuntime 传入的可选 `runId`，不自行扫描恢复列表。崩溃恢复、过期 Lease 回收和恢复候选选择由 store 的 claim/recovery 查询负责。

Completion 是否仍为 pending、identity 是否已接受、Job attempt、retry availability、dead-letter 状态及 Lease/Fence token 均由 store 判定；dead-letter 后的 Run failed CAS 也必须由当前 Run lease 保护。

## 状态转换

Run lane 的执行转换为：

```text
unclaimed -> recovery-priority candidate or normal execution claim
execution lease + no kernel state -> begin
execution lease + kernel state    -> rerun
runner result -> waiting | completed | failed | cancelled
shutdown/lease loss -> abort controller -> no stale acknowledgement
any exit -> stop heartbeat -> release run
```

Activity Job 的转换为：

```text
claimed job -> claimed run -> register Attempt -> dispatch
dispatch success -> completed + completion identity
retryable failure with attempts remaining -> retry_wait
cancel/abort -> cancelled + completion identity
terminal failure -> failed_terminal + completion identity
lease lost/shutdown abort -> no completeActivity; durable Job remains recoverable
finally -> finish Attempt -> release run
```

Completion 的转换为：

```text
claimed completion -> claimed run -> runner.completeActivity
accepted delivery -> delivered
transient failure or rejected delivery -> requeued
deterministic/permanent or exhausted failure -> dead-lettered -> Run failed (lease CAS)
lease lost -> no delivery acknowledgement
```

## 副作用

Run lane 创建 runner，执行 `begin`/`rerun`，维持 Run heartbeat，并在 Lease 丢失或 shutdown 时调用 runner 暴露的 `abort`、`stop` 或 `interrupt`。

Activity worker 解析并调用 Action，登记/注销 runtime Attempt。host placement 的 fence 包含 `workflowRunId`、`kernelRevision`、activity identity、Job/attempt/Job token 与 Run token；public dispatch 不暴露这些字段。完成、重试、取消和失败状态通过 `store.completeActivity(...)` 持久化。

Completion dispatcher 调用 Kernel completion API，并通过 store 交付、重排或死信 Completion；死信完成后通过 `failWorkflowRun` 将非终态 WorkflowRun 以 lease/CAS 置为 `failed`，写 `finishedAt` 和幂等 `run.failed.v1`，不把 token 或完整错误 payload 放入公共投影。

创建 runner 时，如 `events` 提供 `emitWithLease`，EventSink 被包装为 `emitWithLease(request, runLease)`，保证 Domain Event 使用当前 Run Fence。`deferredActivities` 未提供时默认调用 `store.startAction(...)`。

## 错误与降级

任一 heartbeat 返回 `false` 或抛出异常均视为 Lease 丢失。`raceWithLease` 立即抛出 `WorkflowHostError`，code 为 `lease_lost`。Run lane 同时触发 `AbortController` 和可用的 runner 中断方法；Activity worker 中止 signal，且不得调用 `completeActivity`。

Activity failure 分类规则：

- signal 已 aborted、`AbortError`、`ABORT_ERR` 或 `code === "cancelled"`：生成 cancelled completion。
- Action error details 从 `code`、`message`、`retryable` 读取。
- `policy.retryableErrors` 未定义时允许 retryable error；定义后，error code 必须在白名单内。
- 可重试且 `attempts < maxAttempts` 时进入 `retry_wait`，记录 `errorCode`、`error`、`retryDelayMs`，不生成 Completion。
- 其余失败进入 `failed_terminal` 并生成 failed completion。

Completion 异常中，`lease_lost` 仅记录日志并返回 `null`。其他错误在 attempts 达到 `maxCompletionAttempts`，或属于确定性 Kernel 错误时 dead-letter，并在取得当前 Run lease 后调用 `failWorkflowRun`；该调用的 stale lease/CAS false 不得伪装成 failed 成功。否则按指数退避 requeue。确定性错误包括 `DeferredActivityCompletionConflictError`、`DeferredActivityLateCompletionError`、`DeferredActivityNotFoundError`、`WorkflowRunNotFoundError`、`NonJsonValueError`，以及 `WorkflowHostError` 的 `conflict`、`not_found`、`serialization`、`invalid_state`，`TypeError`、`SyntaxError`、validation 与 `invalid_*` 类错误。

## 依赖

生产默认 runner 必须同时获得 `backend`、`definitions` 与 `values`；缺失任一依赖时抛出 code 为 `unavailable` 的 `WorkflowHostError`。测试或嵌入场景提供 `runnerFactory` fake runner 时可以省略这些生产依赖。

`resolveDefinition` 可覆盖 definition 解析方式；`ids`、`now` 和 `events` 分别提供 ID、时钟与事件能力。runner 使用 Kernel、Backend、ValueStore 和 DefinitionRegistry，但三个 lane 不实现这些组件。

## 配置

Lease 配置支持 `owner`、`workerId`、`leaseMs`、`runLeaseMs`、`heartbeatMs`、`heartbeatIntervalMs`、`logger`、`now`。

- owner 为 `owner ?? workerId ?? "workflow-host"`。
- Lease 时长为 `leaseMs ?? runLeaseMs ?? 30000`，必须是大于零的有限数。
- heartbeat 间隔默认为 Lease 时长的三分之一；`heartbeatMs`/`heartbeatIntervalMs` 可配置为 `0` 以禁用定时 heartbeat，但必须是非负有限数。
- Activity effective retry policy 为 `job.payload.retryPolicy ?? definition.execution.retryPolicy`，并在需要时以 Job 已确定的 `maxAttempts` 覆盖策略值。
- Activity retry delay 优先使用 payload policy 的 `backoffMs`，其次使用 `options.retryDelayMs` 的数字或函数结果，默认 `1000`；结果不得为负，并受 `maxRetryDelayMs` 默认 `30000` 限制。
- Completion 最大尝试次数 `maxCompletionAttempts` 默认为 `5`；达到上限不静默丢弃，必须进入 dead-letter/fail-Run 路径。
- Completion 重排时间为 `now + base * 2^(attempts - 1)`；`completionRetryDelayMs` 的 base 默认 `1000`，并受 `maxCompletionRetryDelayMs` 默认 `60000` 限制。

## 重建验收

- 无可领取 Run、Job 或 Completion 时，对应 `pollOnce()` 返回 `null`，不产生 runner 执行。
- recovery candidate 存在时 WorkerRuntime 先以候选 `runId` 调用 run lane；无候选时才普通扫描，且不建立第二队列。
- 新 Run 使用 `begin`，已有 Kernel state 使用 `rerun`，且 begin 的首个 Run ID 等于 claim Run ID。
- Run heartbeat 丢失会中止 runner 并以 `lease_lost` 结束；所有路径最终释放 Run。
- Activity 必须先领取 Job，再领取 Run；成功 claim 后 Attempt register/finish 成对，slot 为 `0`，且任一 Run/Job heartbeat 丢失都不得调用 `completeActivity`。
- Action public context 不包含任何 Fence token；host placement 收到完整 host fence。
- retry allow-list、attempt 上限、delay 优先级与上限符合本文规则；retry wait 不生成 Completion。
- cancellation、terminal success 和 terminal failure 生成稳定 completion identity，成功输出拒绝非 JSON-safe 值。
- Completion 同时受 Run 与 Completion heartbeat 保护；交付返回 `false` 时重排。
- transient completion error 重排；确定性错误或尝试耗尽进入 dead letter，并且 Run 通过 `failWorkflowRun` 进入 `failed`，stale lease/CAS false 不改变其它 owner 状态。
- store 接受 pending identity 时，terminal Run 的最后 Activity Completion 仍可交付。
- Domain Event 通过带 Run Lease 的 `emitWithLease` 发出。
- Run lane 不直接维护恢复标记或扫描恢复列表。

## 实现与测试锚点

- 实现：`packages/application/src/workflow-host-runtime.ts`。
- 测试：`packages/application/src/workflow-host-runtime.test.ts`，覆盖无 claim、retry allow-list、取消、heartbeat 丢失、begin/rerun、Attempt 成对登记、Fence 泄漏、Completion 重排/死信及 terminal Run 最终交付。
- Worker runtime 与 recovery/shutdown：`apps/worker/src/runtime.ts`、`apps/worker/src/runtime.test.ts`、`apps/worker/src/runtime.property.test.ts`。
- Worker 轮询顺序：`apps/worker/src/main.ts`。

## 非目标/边界

本文不把 `nb-workflow` 0.2.0 尚未提供的 signals、timers、children、outbox 或 cross-process claims 描述为已实现能力。

三个 lane 不定义 Run、Job、Completion、Lease、Fence 或 Action 的 canonical 数据模型，不实现 SQL truth、跨进程 claim 算法、Kernel 状态机、Action Registry、Backend、ValueStore、DefinitionRegistry，也不负责 worker 主循环、恢复扫描或调度公平性。
