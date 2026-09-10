---
parent: .agents/tasks/04-workflow-runtime/README.md
range: §19–26(Spike K–R)
sealed_at: 2026-09-11
tags: [workflow-runtime, spikes]
tokens_est: 7170
---

## 19. Spike K：child Workflow start-only StepRun

### 19.1 目的

验证脚本 Workflow 可以在持久边界内启动一个子 Workflow，并在父 Workflow replay 后复用同一个子 Run，而不会因重复执行脚本产生重复子任务。

### 19.2 实现

- `WorkflowContext.startChildWorkflow()` 支持：
  - 解析并校验目标 Workflow Definition 和输入；
  - 默认 `wait: false`；
  - 使用 `child:<key>` 作为稳定 Step path；未提供 key 时使用当前执行内的序号 fallback；
  - 通过 `WorkflowStore.startChildWorkflowStep()` 完成父 Run lease 校验和持久化。
- InMemory Store 与 Prisma Store 在同一存储操作中：
  - 校验父 Run lease；
  - 首次调用创建 queued 子 `WorkflowRun`，写入 `parentRunId`；
  - 创建父级 `child_workflow` StepRun，状态为 `running`，output 为 `{ runId }`；
  - replay 时按父 Run + path 找回已有 StepRun，并返回原子保存的子 Run ID。
- `wait: true` 目前明确返回未实现错误，不产生没有恢复语义的半成品等待状态。
- 本 Spike 不自动执行 queued 子 Run；子 Run 调度、父子完成等待和结果传播后置。

### 19.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、26 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、84 个测试通过。
- 隔离 `COSMOS_DATA_ROOT` 下 `bun run db:migrate`：11 条 migration 全部通过。
- `git diff --check`：通过。
- 本轮涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。
- InMemory 测试覆盖：
  - 子 Run 的 `parentRunId`、输入、kind 和 queued 状态；
  - 父级 `child_workflow` StepRun；
  - Signal resume 后 replay 返回同一个子 Run ID；
  - `wait: true` 明确失败。
- Prisma 测试覆盖同一持久化与 replay 合同。

### 19.4 过程偏差与修复

- 首次 Prisma focused test 失败：`WorkflowRun.id` 在 schema 中是必填字段，child transaction 漏传 ID。
- 修复为在 Prisma transaction 内生成 `randomUUID()`，随后 focused tests 重新通过。
- 本轮没有新增 Prisma schema，因此不新增 migration。

### 19.5 偏差与限制

- `wait: true` 尚未实现；父 Workflow 不会自动等待、接收子 Run output 或传播子 Run failure。
- `child_workflow` StepRun 在父 Workflow 完成后仍可能保持 `running`，因为本轮没有 child completion consumer。
- queued 子 Run 还没有接入实际 Worker/Runtime 调度循环。
- 尚未实现 child cancellation、递归深度限制、父子 budget 传播和结果引用 schema。

### 19.6 下一步

- 先定义 child completion 的持久事件、父级 wait StepRun 和结果引用，再实现 wait/resume。
- 明确 child failure/cancel/timeout 如何收口父 Run。
- 将 queued child Run 接入持久 Job/Trigger 调度，而不是在父 Runtime 进程内直接执行。

## 20. Spike L：durable Workflow Run dispatch tick

### 20.1 目的

验证已经持久化为 `queued` 的 Workflow Run 可以由共享 Store 驱动领取和执行，而不是只能依赖创建它的 Runtime 进程立即调用 `start()`。这为后续 `apps/worker` 长循环、child Run 调度和进程重启恢复保留接缝。

### 20.2 实现

- `WorkflowStore` 增加 `claimNextRun()`：
  - 领取最早的 `queued` Run；
  - 领取 lease 已过期的 `running` Run，用于进程中断后的接管；
  - 不自动领取 `waiting` Run，避免没有新 Signal/Trigger 时忙循环；
  - 返回带新 lease token 的 `ClaimedWorkflowRun`。
- InMemory Store 按 `createdAt + id` 稳定排序并领取。
- Prisma Store 在 transaction 内：
  - 查询 queued/expired running 候选；
  - 使用状态、旧 lease token 和过期时间进行条件更新；
  - 重新读取带新 lease 的 Run；
  - 领取竞争失败时返回空。
- `WorkflowRuntime.runNext()`：
  - 一次最多领取并执行一个 Run；
  - 复用与 `start()`/`resume()` 相同的 Definition、heartbeat、Action/Signal/lease fencing 和 terminal close 路径；
  - 无可运行 Run 时返回 `null`。
- 现有 start-only child Run 可以由下一次 `runNext()` tick 领取；本轮仍不实现父级等待和结果传播。

### 20.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、28 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、86 个测试通过。
- 隔离 `COSMOS_DATA_ROOT` 下 `bun run db:migrate`：11 条 migration 全部通过。
- `git diff --check`：通过。
- 本轮涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。
- InMemory/Prisma 测试验证两个 queued Run 按稳定顺序各执行一次，完成后下一次 tick 返回 `null`。

### 20.4 偏差与限制

- 这只是单次 dispatch tick，不是 `apps/worker` 的长循环、并发池、优雅停机或 heartbeat 服务。
- 当前调度顺序是 `createdAt + id`，尚未实现 priority、lane、fairness、budget admission 或 schedule time。
- WorkflowRun orchestration lease 与 Action Job lease 仍是两个层次；本轮没有把每个 Workflow Run 再包装成独立 Job。
- `waiting` Run 仍需 Signal、Trigger 或未来 child completion consumer 显式唤醒。
- queued child Run 仍没有父子完成等待、结果绑定、失败传播、取消或超时语义。

### 20.5 下一步

- 把 `runNext()` 接入可持久 heartbeat、退出和重启恢复的 Worker loop。
- 定义 priority/lane/并发 admission 与 queued Run 的 claim fairness。
- 在完成 child completion 事件和父级 wait StepRun 合同后，再实现 `wait: true`。

## 21. Spike M：multi-Worker claim fencing

### 21.1 目的

验证多个 Runtime/Worker 共享同一个 Workflow Store 时，同一个 queued Run 只能被一个 Worker 领取和执行；其它 Worker 必须因为已有有效 lease 返回 idle，而不能重复执行 Workflow。

### 21.2 实现

- InMemory 和 Prisma focused tests 各创建两个独立 `WorkflowRuntime`，共享同一个 Store。
- 测试 Workflow 在第一个 Worker 获得 Run lease 后暂停，确保第二个 Worker 在第一个 Worker 尚未完成时尝试 `runNext()`。
- 第二个 Worker 的 `claimNextRun()` 返回 `null`。
- 释放第一个 Workflow 后，只有第一个 Worker 完成 Run，最终状态和 output 只写入一次。
- 本轮没有修改 schema，因此没有新增 migration。

### 21.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、30 个测试通过。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、88 个测试通过。
- 隔离 `COSMOS_DATA_ROOT` 下 `bun run db:migrate`：11 条 migration 全部通过。
- `git diff --check`：通过。
- 本轮涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。
- InMemory/Prisma 都通过单有效 lease 的竞争测试。

### 21.4 偏差与限制

- 本轮验证的是“一个 Worker 已持有 lease 时的竞争”，还没有覆盖 SQLite 高并发锁冲突、lease 到期接管期间的旧 Worker 中途写入和网络分区。
- `runNext()` 仍是单次 tick，不是多 Worker 长循环、并发池或公平调度器。
- lease 竞争只保护 WorkflowRun orchestration；Action Job、外部副作用和 child completion 仍需要各自的 fencing/幂等合同。

### 21.5 下一步

- 增加 lease 到期接管的 runtime-level 测试：旧 Worker 执行中，新的 Worker 接管后旧 Worker 不能 terminal close。
- 将竞争测试接入实际 Worker loop 和 shutdown/heartbeat 生命周期。
- 再评估 SQLite 的 busy timeout、重试和调度公平性。

## 22. Spike N：runtime-level stale Worker takeover

### 22.1 目的

验证旧 Worker 在 Workflow 执行期间失去 Run lease 后，即使它随后恢复并返回结果，也不能覆盖新 Worker 接管后已经写入的 terminal state。

### 22.2 实现

- InMemory 和 Prisma focused tests 各创建两个独立 Runtime：
  - stale Worker 使用短 lease；
  - current Worker 使用正常 lease。
- 测试临时让 stale Worker 的 `renewRun` 失败，并让第一次 Workflow 执行暂停，等待 lease 过期。
- current Worker 通过 `runNext()` 接管同一个 `running` Run，执行第二次并写入 `output: "current"`。
- 释放 stale Worker 后，它必须抛出 `WorkflowLeaseLostError`，不能将 `"stale"` 写入 Run。
- 最终持久 Run 保持 `succeeded/current`。
- 本轮没有修改 schema，因此没有新增 migration。

### 22.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、32 个测试通过。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、90 个测试通过。
- 隔离 `COSMOS_DATA_ROOT` 下 `bun run db:migrate`：11 条 migration 全部通过。
- `git diff --check`：通过。
- 本轮涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。
- InMemory/Prisma 都通过旧 Worker 中途恢复拒绝 terminal close 的测试。

### 22.4 偏差与限制

- 测试通过受控 Store renew 失败模拟 lease 丢失，不等同真实进程 kill、网络分区或系统时钟漂移。
- 旧 Worker 在 lease 丢失后仍可能继续产生外部副作用；本轮只验证 Cosmos 持久状态不能被旧 Worker 覆盖，未知外部结果仍需 Publisher/Action receipt。
- Workflow Runtime 尚未把 lease-lost 分类为可观测的 Worker 结果，也没有统一 drain/shutdown 协议。

### 22.5 下一步

- 将 lease-lost、taken-over、unknown-result 变成 Worker tick 的结构化结果。
- 在真实 Worker loop 中验证进程中断、重启、heartbeat 和退出时不再领取新任务。
- 为 Action/Connector 外部副作用补齐 receipt/idempotency 边界。

## 23. Spike O：可停止的 Workflow Worker loop

### 23.1 目的

把 `WorkflowRuntime.runNext()` 包装成一个可单测、可停止、可观测的 Worker loop 接缝，同时不改变当前固定 Ingest Worker 的生产入口。

### 23.2 实现

- 新增 `WorkflowWorkerLoop`：
  - `tick()` 执行一次 `runNext()`；
  - `processed` 返回 Run ID 和最终 Run status；
  - 无任务返回 `idle`；
  - `WorkflowLeaseLostError` 返回结构化 `lease_lost`；
  - 其它异常返回 `error`。
- `start()`：
  - 立即执行第一 tick；
  - 按 `pollIntervalMs` 等待下一次 tick；
  - 不在等待期间占用数据库 lease。
- `stop()`：
  - 设置停止标志；
  - 唤醒 poll timer，不必等待完整轮询间隔；
  - 等待当前 tick 完成后退出。
- `onTick` 作为最小观测 Port，Worker 宿主可以映射到结构化日志/heartbeat/metrics。
- 仅加入 `packages/workflow-runtime`，没有把它接入 `apps/worker/src/main.ts`；当前 apps/worker 仍只运行固定 Ingest/Probe Worker。

### 23.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts`：1 个测试文件、21 个测试通过。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、93 个测试通过。
- 隔离 `COSMOS_DATA_ROOT` 下 `bun run db:migrate`：11 条 migration 全部通过。
- `git diff --check`：通过。
- 本轮涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。
- 覆盖 processed、idle、stop 唤醒和 lease_lost 结果。

### 23.4 偏差与限制

- 这是 Runtime package 的 loop contract，不是生产 Worker wiring；没有多种 Consumer 的统一调度、优雅 shutdown drain 或 WorkerHeartbeat 持久化。
- `onTick` 不是完整 metrics/tracing contract；回调异常处理、backpressure、并发度和 lane 仍后置。
- 当前 loop 每次只处理一个 Workflow Run；Outbox Consumer 和旧 Source Job 仍有各自的 loop。
- `stop()` 等待当前 tick 完成，但不会取消正在运行的 Action 或外部 Connector。

### 23.5 下一步

- 设计宿主级 Worker supervisor：Workflow Run、Action Job、Outbox、Source Job 的 lane/admission/fairness。
- 将 loop 的 `lease_lost/taken_over/unknown_result` 接入统一 heartbeat、日志和恢复指标。
- 在确认 Definition 注册和生产 wiring 后，再把 package loop 接入 `apps/worker`。

## 24. Spike P：child terminal close propagation

### 24.1 目的

补齐 child Workflow 的一个独立生命周期事实：child Run 进入 `succeeded/failed/cancelled` 后，父级 `child_workflow` StepRun 不能永远停留在 `running`。本轮只收口 StepRun，不实现父 Run 的 wait/resume。

### 24.2 实现

- `WorkflowStore` 新增 `completeRun()`，要求当前 Run lease token，并在同一 Store/transaction 内：
  - 写入 child Run 的 terminal status/output/error；
  - 清除 child Run lease；
  - 根据 `parentRunId` 和 StepRun output 中的 `runId` 找到父级 `child_workflow` StepRun；
  - 将父 StepRun 收口为 `succeeded/failed/cancelled`；
  - 写入 `{ runId, status, result, error }` 作为 child completion output。
- `WorkflowRuntime` 的成功/业务失败 terminal close 改用 `completeRun()`；waiting 仍使用 `updateRun()`。
- InMemory/Prisma 保持同一合同和原子边界。
- child terminal propagation 不自动 requeue 父 Run，不发送新的父级 Signal，也不实现 `wait: true`。

### 24.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、37 个测试通过。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、95 个测试通过。
- 隔离 `COSMOS_DATA_ROOT` 下 `bun run db:migrate`：11 条 migration 全部通过。
- `git diff --check`：通过。
- 本轮涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。
- 覆盖 child success 与 child failure：
  - child Run terminal 状态；
  - 父 StepRun terminal 状态；
  - output/error 结果引用；
  - InMemory/Prisma 一致性。

### 24.4 偏差与限制

- `wait: true` 仍未实现；父 Run 不会因 child 完成自动重新排队或恢复。
- 当前传播依赖 child Run 的 `parentRunId` 和父 StepRun output 中的 runId；尚未有独立 parent-child relation 表或 completion event。
- `completeRun()` 当前由 Runtime terminal close 使用；直接调用旧 `updateRun(status=terminal)` 不会触发 child propagation，后续需要收紧 Application Command 边界。
- child completion 尚未写入独立 DomainEvent/Outbox，也没有 child result schema/version。

### 24.5 下一步

- 定义 child completion DomainEvent/Outbox 和父级 wait StepRun 的唤醒合同。
- 决定 child success/failure/cancel/timeout 对父 Run 的 requeue、传播和幂等规则。
- 将所有 terminal close 收口到统一 Application Command，禁止旁路 `updateRun` 产生不完整生命周期。

## 25. Spike Q：child wait/resume 最小合同

### 25.1 目的

实现 `startChildWorkflow(wait:true)` 的最小 durable 语义：父 Run 等待 child，child 完成后父 Run 被重新排队，下一次 `runNext()` replay 父脚本并取得 child result；不把 timeout、取消传播和事件消费者提前混入。

### 25.2 实现

- `WorkflowRunRecord` 增加：
  - `waitingKind`：当前支持 `signal`、`child_workflow`；
  - `waitingRef`：Signal ref 或 child Run ID；
  - `waitingSignal` 保留为 signal UI/兼容字段，child wait 时为 `null`。
- Prisma 增加 migration：
  - `20260808230000_workflow_waiting_reason`；
  - `WorkflowRun.waitingKind`；
  - `WorkflowRun.waitingRef`。
- `WorkflowWaitingError` 变成带 kind/ref 的等待合同，兼容旧的 signal-only 构造方式。
- `startChildWorkflowStep` 接收 `wait`：
  - `wait:false` 创建 `running` child StepRun；
  - `wait:true` 创建 `waiting` child StepRun，并让父 Run 保存 `waitingKind=child_workflow`、`waitingRef=childRunId`；
  - child 成功时返回 result；
  - child failed/cancelled 时让父 Run 进入业务失败路径。
- `completeRun` 在同一 Store/transaction 内：
  - 收口 child Run；
  - 收口父 `child_workflow` StepRun；
  - 若父 Run 正等待同一个 child，则清除等待字段并置为 `queued`；
  - 不唤醒等待 Signal，也不重排队无关父 Run。
- `runNext()` replay 父脚本：
  - existing child StepRun succeeded → 读取保存 result；
  - existing child StepRun failed → 父 Run 进入 failed；
  - 没有重复创建 child Run。

### 25.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、39 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、97 个测试通过。
- 隔离 `COSMOS_DATA_ROOT` 下 `bun run db:migrate`：12 条 migration 全部通过。
- `git diff --check`：通过。
- 本轮涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。
- 覆盖 InMemory/Prisma：
  - 父 Run waiting kind/ref；
  - child success → parent queued → parent replay succeeded；
  - child failure → parent queued → parent replay failed；
  - 既有 Signal wait 行为不回归。

### 25.4 过程偏差与修复

- 首次 focused test 发现 `updateRun(status=waiting)` 被错误当成 terminal，清除了 waiting kind/ref；修复为 waiting 释放 lease、terminal 才清除等待原因。
- 同一问题还使 InMemory queued parent 保留旧 lease token，`claimNextRun()` 将其排除；补上 waiting 的 lease release 后通过。
- 原有 `wait:true` 未实现测试已更新为新的 waiting 合同。

### 25.5 偏差与限制

- 只实现 child completion 后的精确父 Run requeue；没有 timeout、parent/child cancel propagation、retry policy 或死信。
- child completion 尚未产生独立 DomainEvent/Outbox，也没有跨进程 completion consumer；当前传播发生在 child terminal close transaction 内。
- `updateRun(status=terminal)` 旁路仍可能绕过 child propagation；后续应收紧 terminal Application Command。
- parent result 当前为动态 JSON，没有独立 schema/version/引用表。
- 生产 `apps/worker` 尚未注册 Workflow Definition 或接入 `WorkflowWorkerLoop`。

### 25.6 下一步

- 为 child completion 增加 DomainEvent/Outbox 与 consumer，验证跨进程父子唤醒。
- 定义 timeout、cancel、retry、budget 和递归深度传播。
- 将 `wait:true` 接入一个真实的 Knowledge/Research Workflow，再评估是否需要独立 ParentChildRelation 表。

## 26. Spike R：Workflow terminal DomainEvent/Outbox

### 26.1 目的

让每个 Workflow terminal close 都产生可持久观察的 `workflow.run.terminal` DomainEvent 和 Outbox message，为未来跨进程 child completion consumer、SSE 和审计提供事实来源。

### 26.2 实现

- `completeRun()` 在当前 Run lease fencing 下写入 terminal event：
  - type：`workflow.run.terminal`；
  - version：`v1`；
  - idempotency key：`workflow-run:<runId>:terminal`；
  - payload：Run ID、status、output、error、parentRunId。
- InMemory Store：
  - terminal Run、父 StepRun propagation 和 terminal Event/Outbox 在同一状态边界完成；
  - event sequence 与 Outbox sequence 复用同一顺序源。
- Prisma Store：
  - terminal Run、父 StepRun propagation、DomainEvent 和 WorkflowOutboxMessage 在同一 transaction；
  - 已存在 terminal event 时不重复创建。
- 既有 Workflow 显式业务事件仍保留；一个 Run 可以同时有业务事件和 terminal 生命周期事件。

### 26.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、39 个测试通过。
- 验证显式业务事件先于 terminal 事件，两个 Outbox message 都是 pending。
- child success 的 terminal event 在 InMemory/Prisma 都包含 output，并可通过 Run ID 查询。

### 26.4 Round 25 基线偏差与限制

- Round 25 记录的当时状态：parent-wake Consumer 尚不存在，父级传播发生在 child transaction 内；该边界已由 Round 27 的 Spike S 推进为 Outbox parent-wake Consumer。
- event payload 是动态 JSON，尚未有独立 schema registry、retention、签名或敏感字段筛选。
- terminal event 不能表示外部 Action 的未知结果；外部副作用仍需 receipt/幂等合同。
- direct `updateRun(status=terminal)` 仍不会产生 terminal event；后续需要统一 terminal Application Command。

### 26.5 Round 26 兼容性修复与验证

Round 25 的第一次全量测试发现固定 Ingest 测试仍假设每个 Run 只有一个事件：

```text
16 个测试文件中 15 个通过，96/97 个测试通过。
```

这是测试断言落后于新事件合同，不是 Runtime 的事件重复写入。已将测试改为分别断言：

- `ingest.page.persisted` 业务事件；
- `workflow.run.terminal` 生命周期事件；
- 两个 Outbox message 都处于 `pending`。

Round 26 验证结果：

- focused：3 个测试文件、40 个测试通过；
- full：16 个测试文件、97 个测试通过；
- `bun run db:validate`：通过；
- `bun run db:generate`：通过；
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，12 条 migration 全部应用；
- `git diff --check`：通过；
- Markdown 代码围栏、文件末尾换行和相对链接检查：通过。

### 26.6 下一步

- 为 `workflow.run.terminal` 增加 Consumer Definition/Binding 和 parent wake consumer，验证跨进程恢复。
- 定义 event payload schema/version、retention、dead-letter 和 `snapshot_required`。
- 将 terminal event 接入 SSE/审计，但保持领域状态表为事实来源。

