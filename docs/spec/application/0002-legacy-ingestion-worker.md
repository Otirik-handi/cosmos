# 旧 IngestionWorker 规范

## 状态

Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55

## 最后更新

2026-08-16

## 组件定位

本文仅描述 `packages/application/src/index.ts` 中的旧 `IngestionWorker`。

该组件轮询旧 Repository Job，按租约执行 `source-ingest` 或 `source-probe`，并在未关闭内部调度时为到期 Source 创建旧 SQL Run/Job。

它不是 Workflow Kernel，不创建或推进 Workflow Envelope、Kernel Activity 或 Completion。

共享的 [Job](../contracts/0001-public-contracts.md)、[Run](../contracts/0001-public-contracts.md) 和 [Source](../contracts/0001-public-contracts.md) 采用公共合同中的 canonical 定义；本文不复制这些定义。

## 概念与定义

- **轮询周期**：一次 `pollOnce` 调用。
- **受支持 Job**：claim 时仅接受 `source-ingest` 和 `source-probe`。
- **内部调度**：`queueScheduledSources` 根据 Source 的 `scheduleIntervalMs` 创建幂等的 scheduled Run。
- **执行租约**：Repository claim 返回的 Job lease；后续续租、Run retry reset 和 Job completion 均受 Repository fencing 约束。
- **terminal 失败**：`attempts >= maxAttempts` 或失败被判定为不可重试。
- **完成被接受**：`repository.completeJob` 返回 `true`。返回 `false` 或抛错均不构成成功完成。

## 外部行为

`pollOnce` 按以下顺序执行：

1. 当 `schedule !== false` 时，先调用 `queueScheduledSources`。
2. 调用 `repository.claimNextJob({ owner, leaseMs, acceptedKinds: ["source-ingest", "source-probe"] })`。
3. 未 claim 到 Job 时返回 `null`。
4. claim 成功后，每隔 `max(1000, floor(leaseMs / 3))` 毫秒尝试续租。
5. 对合法 `source-probe` Job，在其没有 `runId` 且配置了 `probe` 时调用 `probe.runSource(sourceId)`。
6. 对合法 `source-ingest` Job，在其有 `runId` 时调用 `ingestion.runExistingRunWithLease(runId, { jobId, leaseToken })`。
7. 成功执行后尝试以 `succeeded` 完成 Job。
8. 其他已 claim、但不符合上述分派条件的 Job 直接尝试以 `failed_terminal` 完成，错误码为 `unsupported_job`。
9. 只有 Repository 接受 completion 时才返回成功的 `WorkerJobResult`；completion 被拒绝或抛错时记录日志并返回 `null`。

续租失败只记录 `job.lease_lost`，不会主动取消已经开始的 probe 或 ingestion 工作。

## 输入

构造选项为：

```ts
type IngestionWorkerOptions = {
  owner: string;
  leaseMs: number;
  pollIntervalMs?: number;
  now?: () => Date;
  probe?: ConnectorProbeService;
  schedule?: boolean;
  logger?: LoggerPort;
};
```

其中：

- `owner` 用于 claim 和租约操作。
- `leaseMs` 决定 claim 的租期和 heartbeat 间隔。
- `pollIntervalMs` 虽然存在于选项类型中，但 `pollOnce` 本身不读取它；持续轮询的间隔由 Worker 进程调用方控制。
- `now` 为调度时间和 bucket 计算提供可替换时钟。
- `probe` 缺省时，Worker 不能执行 `source-probe`。
- `schedule` 默认开启；仅显式传入 `false` 时关闭内部调度。
- `logger` 接收结构化运行日志。

Job、Run 和 Source 的字段含义以[公共合同](../contracts/0001-public-contracts.md)为准。

## 输出

`pollOnce` 的可观察返回值为：

```ts
type WorkerJobResult = {
  jobId: string;
  runId: string | null;
  status: "succeeded" | "retry_wait" | "failed_terminal";
  attempts: number;
};
```

没有可 claim Job 时返回 `null`。

Job 执行完成但 `repository.completeJob` 返回 `false`或抛错时同样返回 `null`，不得返回或记录为已成功完成的 `WorkerJobResult`。

## 状态与持久化

Worker 创建和推进的是旧 SQL Run/Job。持久化由 Repository 完成，Worker 自身不持有可跨进程恢复的执行状态。

`queueScheduledSources` 执行以下持久化操作：

1. 调用 `listSources`。
2. 仅处理 `enabled` 且 `config.scheduleIntervalMs` 存在的 Source。
3. 若 `lastRunAt` 存在且 `now - lastRunAt < scheduleIntervalMs`，跳过该 Source。
4. 计算 `bucket = floor(nowMs / scheduleIntervalMs)`。
5. 调用：

```ts
createQueuedRun({
  sourceId,
  triggerKind: "schedule",
  idempotencyKey: `schedule:${sourceId}:${bucket}`,
});
```

非 terminal 的带 `runId` 失败会先调用 `repository.resetRunForRetry({ runId, error, lease })`。旧 SQL Run/Step 恢复为 `queued` 的具体写入由 Repository 实现，不属于本 Worker 的内部状态机。

## 状态转换

Job 的 Worker 可见状态转换为：

```text
queued -> leased -> succeeded
                  -> retry_wait
                  -> failed_terminal
```

- `queued -> leased` 由 Repository 的 claim 操作完成。
- 成功执行进入 `succeeded`。
- 可重试且尚未达到最大尝试次数的失败进入 `retry_wait`。
- 不可重试、达到最大尝试次数或 Job 不受支持时进入 `failed_terminal`。
- 本 Worker 不执行 `cancelled` 状态转换。
- 旧 lease 的写入拒绝和并发 fencing 由 Repository 根据 lease token 执行。

## 副作用

Worker 可能产生以下副作用：

- 枚举 Source，并为到期 Source 创建幂等 scheduled Run。
- claim Job 和定时续租 Job lease。
- 调用 `probe.runSource(sourceId)`。
- 调用 `ingestion.runExistingRunWithLease(runId, { jobId, leaseToken })`。
- 重置可重试的旧 SQL Run。
- 完成 Job 为 `succeeded`、`retry_wait` 或 `failed_terminal`。
- 写入带 Job、Run、Source 上下文的结构化日志。

该组件不写入 Workflow Envelope、Kernel Activity 或 Completion。

## 错误与降级

失败先经过 `normalizeFailure`：

- `ConnectorExecutionError` 保留其 `code` 和 `retryable`。
- 任意具有 `message`、`code` 或 `retryable` 属性的对象使用这些属性；只有 `retryable === false` 才明确禁止重试。
- 其他原始错误默认 `retryable = true`。

terminal 判定为：

```text
attempts >= maxAttempts || !retryable
```

对带 `runId` 的非 terminal 失败：

1. 调用 `repository.resetRunForRetry({ runId, error, lease })`。
2. 计算 `retryDelayMs(attempt) = min(30000, 1000 * 2 ** max(0, attempt - 1))`。
3. 尝试以 `retry_wait` 完成 Job。

terminal 失败尝试以 `failed_terminal` 完成 Job。probe 失败使用相同的 terminal 判定和退避规则。

`completeClaimedJob` 将 Job lease token 和完成结果交给 `repository.completeJob`。Repository 返回 `false` 或抛错时，Worker记录结构化日志并返回 `null`，不得宣称 completion 成功。

heartbeat 续租失败时记录 `job.lease_lost`，但不取消正在运行的工作；其后的过期 lease 写入是否被接受由 Repository fencing 决定。

## 依赖

Worker 仅依赖其实际调用的应用接口：

- Repository：Source 枚举、scheduled Run 创建、Job claim、lease 续租、Run retry reset 和 Job completion。
- Ingestion 执行入口：`runExistingRunWithLease`。
- 可选 probe 执行入口：`runSource`。
- 可选时钟和结构化 logger。

本文不定义 ConnectorRegistry、Probe 或 IngestionService 的完整合同。

## 配置

`owner`、`leaseMs` 和 `schedule` 由调用方通过 `IngestionWorkerOptions` 传入。本文不规定或推断任何环境变量。

`schedule` 缺省时为开启状态。存在 Durable Host 时，`apps/worker` 向旧 Worker 传入 `schedule: false`，由 Workflow Control 负责调度；不存在 Durable Host 时，旧 Worker 保持内部调度职责。

Worker 主进程的默认 owner、lease 或轮询环境配置属于 runtime 文档，不属于本组件规范。

## 重建验收

1. 给定 `schedule !== false`，调用 `pollOnce` 时必须先完成 `queueScheduledSources` 调用，再调用 `claimNextJob`。
2. `claimNextJob.acceptedKinds` 必须严格等于 `["source-ingest", "source-probe"]`。
3. Repository 未返回 Job 时，`pollOnce` 必须返回 `null`。
4. claim 成功后，续租间隔必须等于 `max(1000, floor(leaseMs / 3))` 毫秒。
5. `source-probe`、无 `runId` 且存在 `probe` 时，必须以该 Job 的 `sourceId` 调用一次 `probe.runSource`。
6. `source-ingest` 且存在 `runId` 时，必须调用 `runExistingRunWithLease(runId, { jobId, leaseToken })`。
7. 不满足受支持分派条件的已 claim Job 必须尝试完成为 `failed_terminal`，且错误码必须为 `unsupported_job`。
8. `completeJob` 返回 `false` 或抛错时，`pollOnce` 必须返回 `null`，不得返回伪造的成功结果。
9. 续租失败时必须记录 `job.lease_lost`，且不得因该失败主动取消已开始的执行。
10. 仅 `enabled` 且存在 `config.scheduleIntervalMs` 的 Source 可以触发 scheduled Run 创建。
11. 未到调度间隔的 Source 不得调用 `createQueuedRun`。
12. scheduled Run 的 `triggerKind` 必须为 `schedule`，幂等键必须为 `schedule:${sourceId}:${floor(nowMs / interval)}`。
13. 带 `runId` 的可重试失败必须先调用 `resetRunForRetry`，再尝试以 `retry_wait` 完成 Job。
14. `attempts >= maxAttempts` 或 `retryable === false` 时必须尝试以 `failed_terminal` 完成 Job。
15. 第 `attempt` 次失败的退避时间必须等于 `min(30000, 1000 * 2 ** max(0, attempt - 1))` 毫秒。
16. Worker 不得创建 Workflow Envelope、Kernel Activity、Completion 或 Kernel journal 记录。
17. Worker 不得产生 `cancelled` Job 状态转换。
18. 调用方传入 `schedule: false` 时，Worker 不得从 `pollOnce` 调用 `queueScheduledSources`。

## 实现与测试锚点

- 实现：[packages/application/src/index.ts](../../../packages/application/src/index.ts#L691-L1040)
- 测试：[packages/application/src/index.test.ts](../../../packages/application/src/index.test.ts#L275-L360)，覆盖 accepted kinds 仅包含 `source-ingest`/`source-probe`，以及 completion 被拒绝或失败时不伪造成功。
- Durable Host 调度接缝：[apps/worker/src/main.ts](../../../apps/worker/src/main.ts#L139-L145)，存在 Durable Host 时向旧 Worker 传入 `schedule: false`。

## 非目标/边界

本文不描述或承诺以下能力：

- Workflow Kernel 或 Kernel journal。
- Worker 内部的跨进程执行恢复。
- signals、durable timers、children 或 outbox。
- Durable Host Activity 或 Completion。
- Workflow Envelope 的创建或推进。
- ConnectorRegistry、Probe 或 IngestionService 的完整合同。
- Repository 内部的 SQL 状态恢复和 lease fencing 实现。
- Worker 主进程的环境变量及 runtime 默认值。
- 真实外部 connector 的网络、认证、限流、分页或数据语义。
