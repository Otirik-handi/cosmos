---
parent: .agents/tasks/04-workflow-runtime/README.md
range: §34–41(Spike Z–AG)
sealed_at: 2026-09-11
tags: [workflow-runtime, spikes]
tokens_est: 6711
---

## 34. Spike Z：Action Invocation 的父 Run existence fencing

### 34.1 目的

消除 InMemory/Prisma 对 orphan Action Invocation/Job 的不一致，确保 Action 只能挂在存在且仍可执行的 Workflow Run 上。

### 34.2 实现

- InMemory/Prisma `ensureActionInvocation()` 现在都：
  - 校验 `WorkflowRun` 存在；
  - 拒绝 terminal Run；
  - 拒绝 deadline 已到的 Run；
  - 仅允许继续创建/复用 non-terminal、未过期 Run 的 Action Invocation。
- 修正历史 InMemory stale Job fixture，显式创建对应父 Run。
- 保留 Job Port 对非 terminal queued/waiting Run 的低层操作兼容；Application/Runtime 正常路径仍在 running Run 中调用。

### 34.3 验证

- InMemory/Prisma focused：2 个测试文件、49 个测试通过。
- missing parent Run：明确返回 `Workflow Run not found`。
- cancelled parent Run：明确返回 `Workflow Run is not executable`。
- 既有 Action Job lease、retry 和 replay 测试继续通过。
- full test：16 个测试文件、108 个测试通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，13 条 migration 全部应用。
- `git diff --check`：通过。
- Round 34 涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。

### 34.4 设计结论

- `WorkflowRun → WorkflowActionInvocation → Job → StepRun` 的父关系必须在创建 Invocation 时建立，不能等 Job claim 才发现。
- InMemory spike 必须尽量与 Prisma 的持久 FK/存在性语义一致，否则 focused tests 会掩盖生产差异。
- orphan fixture 不再是可接受的 Application 合同；低层测试若需要模拟异常，应该显式标注为 Store corruption case。

### 34.5 偏差与限制

- 数据库已有历史 orphan 数据时没有 repair/migration；当前只阻止新建。
- `WorkflowActionInvocation` 尚未有独立 corruption scan 或 repair command。
- Action cancellation/receipt/unknown-result 仍未实现。

### 34.6 下一步

- 增加 Workflow Store integrity audit：扫描 orphan Invocation、Job、StepRun 和 terminal Run 的 active Job。
- 把完整性审计接入启动诊断和维护 Workflow。
- 继续设计 Action 外部副作用 receipt 与 cancellation port。

## 35. Spike AA：Workflow integrity audit

### 35.1 目的

增加只读的 `WorkflowStore.auditIntegrity()`，用来发现持久化状态中的关系断裂和终态泄漏。审计不是修复器，也不改变 Run、StepRun、Job 或 Invocation。

### 35.2 检查范围

- orphan Action Invocation：Invocation 的父 `WorkflowRun` 不存在。
- orphan Workflow Job：Job 引用的 Action Invocation 或父 Run 不存在。
- orphan Workflow StepRun：StepRun 的父 Run 不存在。
- Invocation 与 Job 的关联不一致。
- Invocation 与 StepRun 的关联不一致。
- terminal Run 仍存在 active Action Job。
- terminal Run 仍存在 active 的非 `child_workflow` StepRun。

父 Run 已经 terminal、但 `child_workflow` StepRun 仍等待子 Run terminal event 的情况是合法的异步 parent-wake 状态，不应被误报为 active step 泄漏。

### 35.3 实现

- InMemory Store 与 Prisma Store 都提供结构化 `WorkflowIntegrityReport`。
- Issue 带稳定 `kind`、实体类型、实体 ID 和必要的关联信息，并按稳定顺序输出，便于日志比较和后续诊断。
- 测试通过专用 corruption fixture 直接制造损坏关系，验证审计能发现问题；正常关系先验证 `issueCount: 0`。
- 本轮没有新增数据库 migration，也没有自动删除历史孤儿记录。

### 35.4 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts --reporter=dot`：2 个测试文件、51 个测试通过。
- 覆盖正常状态、terminal Run 上 active Job/非 child StepRun，以及 orphan Invocation/Job/StepRun。

### 35.5 设计结论

- 完整性审计应当是启动诊断、维护命令和后续运维指标的只读基础能力。
- “能发现损坏”与“能安全修复损坏”是两个不同合同；修复前必须先定义保守的 ownership、补偿和人工确认边界。
- `child_workflow` 的异步等待必须继续由 terminal Outbox/parent-wake 收口，不能用通用 active-step 规则粗暴判定为泄漏。

### 35.6 偏差与限制

- 尚无历史 orphan repair command、dry-run repair plan 或启动时阻断策略。
- 尚未为 integrity issue 建立持久审计快照、告警级别和 API 展示。
- 审计当前是全表扫描，数据量增大后需要分页、索引或按租约/时间窗口分层扫描。

### 35.7 下一步

- 增加面向运维的只读诊断入口，先报告 issue，不自动修复。
- 设计 orphan repair 的候选动作和不可自动修复的终态。
- 继续收口 Action 外部副作用 receipt、取消和 unknown-result 边界。

## 36. Spike AB：父子 Workflow 的级联取消

### 36.1 目的

收口父 Run 取消或 deadline 超时后的后代生命周期。此前 `cancelRun()` 只取消目标 Run 的 Action Job，子 Workflow 可能继续运行并产生外部访问或副作用。

### 36.2 合同

- 显式取消父 Run 时，递归取消所有仍处于 `queued`、`running` 或 `waiting` 的后代 Run。
- 已经 `succeeded`、`failed` 或 `cancelled` 的后代不被改写。
- 父 Run deadline 超时后，根 Run 仍以 `failed` 收口；未终态后代以 `cancelled` 收口，并携带父 deadline 原因。
- 每个被级联取消的 Run 都独立追加 `workflow.run.terminal` Event/Outbox，使用稳定 terminal idempotency key。
- 取消顺序按后代深度优先、根 Run 最后收口；这样 parent-wake 看到的事件顺序与子树完成方向一致。
- normal `completeRun(succeeded/failed)` 不自动取消 fire-and-forget child Workflow；只有显式 cancel 和 deadline timeout 触发级联。

### 36.3 实现

- InMemory Store 增加后代树收集和深度优先 terminal close。
- Prisma Store 在同一 transaction 内：
  - 先用状态条件收口根 Run；
  - 收集后代并以 `updateMany` 做状态 fencing；
  - 逐个取消后代 Action Job/Invocation/Action StepRun；
  - 为每个成功收口的后代写 terminal Event/Outbox。
- 重复取消只返回既有终态，不重复追加 terminal Event。
- stale child Worker 的 `completeJob()` 不能覆盖级联取消后的 Job/Invocation/StepRun。

### 36.4 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts --reporter=dot`：2 个测试文件、55 个测试通过。
- 覆盖：
  - 父取消；
  - 多级后代；
  - active child Action Job；
  - stale completion fencing；
  - 重复取消幂等；
  - 父 deadline 导致根失败、后代取消。

### 36.5 设计结论

取消是 Run Control 的树级命令，不应只修改一个 Run 的状态。数据库内的 terminal close、Job fencing 和子树传播必须在同一持久化边界内收口；parent-wake 仍负责之后的父 StepRun projection。

### 36.6 偏差与限制

- Prisma 当前为 spike 使用全量读取后在内存中构建后代树；大规模数据需要递归查询、分层批处理或专门的 lineage 索引。
- 级联取消只能阻止 Cosmos 接受迟到结果，不能中断已经在外部运行的代码，也不能撤销已经发生的外部副作用。
- 远程 Worker 的 `ActionExecutionContext.isCancelled()` 仍不是跨进程即时通知；需要后续 cancellation signal/abort port。
- 已经 terminal 的父 Run 不会自动修复仍 active 的异常后代；这类状态由 integrity audit 发现，repair policy 后置。

### 36.7 下一步

- 设计 Action effect receipt、idempotency key、unknown-result 和补偿边界。
- 再将 cancellation signal/abort port 接到 Action Worker。
- 评估 descendant lineage 查询在 SQLite 与未来 PostgreSQL 上的实现策略。

## 37. Spike AC：Action effect receipt 与 unknown-result

### 37.1 目的

补齐 Action 已经访问外部系统或产生外部副作用、但 Worker 可能在 Cosmos terminal close 前失联的事实边界。Run/Job lease 只能保护内部状态，不能证明外部副作用没有发生。

### 37.2 合同

`ActionDefinition` 可以声明：

```ts
effectMode: "none" | "external"
```

`external` Action 必须为每次 Job attempt 建立一个 Receipt。Receipt 的唯一业务范围是：

```text
(jobId, attempt)
```

Receipt 状态：

```text
started
→ committed
→ compensated

started
→ unknown
→ committed
→ compensated
```

- `started` 由 Runtime 在调用外部 Action 前持久化。
- Action 必须在返回成功前调用 `context.recordReceipt({ status: "committed", ... })`，或者在无法确定外部结果时记录 `unknown`。
- `unknown` 不得被自动重试覆盖；当前实现把对应 Job 收口为 `failed_terminal`，等待后续 reconciliation/compensation。
- `committed` 不会被迟到的 `unknown` 降级。
- Run/Job 取消会把仍为 `started` 的 Receipt 转换为 `unknown`。
- Action 收到稳定的 `idempotencyKey`、`jobId` 和 `attempt`；当前稳定业务幂等键为 `${runId}:${path}`。

### 37.3 实现

- 新增 `WorkflowActionReceipt` Prisma model 和 migration：
  - 关联 WorkflowRun、ActionInvocation、Job；
  - 保存 external reference、details 和 error；
  - `(jobId, attempt)` 唯一。
- InMemory/Prisma Store 新增：
  - `recordActionReceipt()`；
  - `listActionReceipts()`；
  - 单调状态迁移和 external reference conflict 检查。
- `ActionExecutionContext` 新增：
  - `jobId`；
  - `idempotencyKey`；
  - `attempt`；
  - `recordReceipt()`。
- `WorkflowStore.auditIntegrity()` 增加 Receipt 的 orphan、ownership、attempt 和 terminal `started` 检查。

### 37.4 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts --reporter=dot`：2 个测试文件、57 个测试通过。
- 覆盖：
  - effectful Action 成功 receipt；
  - stable idempotency key/attempt 暴露；
  - unknown receipt 后不进入 retry；
  - unknown → committed 的单调升级；
  - 取消时 started → unknown；
  - InMemory/Prisma 持久化与查询。

### 37.5 设计结论

Receipt 不替代 Job，也不把外部系统的事实复制成 Cosmos 可以强行回滚的状态。它是“这次尝试与外部副作用之间的证据链”，用于幂等重试、人工/Agent reconciliation 和未来补偿。

### 37.6 偏差与限制

- 当前 Job status 没有新增 `unknown_result`，未知事实由 Receipt 表达，Job 以 `failed_terminal` 停止自动重试。
- `committed` Receipt 在 stale `completeJob()` 后不会自动把结果重新绑定到 Invocation；reconciliation/query-by-idempotency 仍未实现。
- `compensated` 只有状态合同，没有补偿 Action、补偿预算和操作审计。
- 当前 `recordReceipt()` 仍由 Action 代码主动提供 externalRef/details，Cosmos 不理解第三方平台的语义。

### 37.7 下一步

- 增加 Receipt reconciliation command：按 idempotency key 查询外部系统并恢复 Invocation/Job。
- 设计 `unknown_result` 的 API/SSE/维护 UI projection。
- 增加 Action abort/cancellation port，并验证进程中断、重启接管与 Receipt 的组合。

## 38. Spike AD：Committed Receipt reconciliation

### 38.1 目的

让 committed Receipt 不只是诊断记录：当外部系统已经确认副作用、但旧 Worker 在 `completeJob()` 前失去 lease 时，维护 Worker 可以在严格 CAS 条件下把已知结果重新绑定到当前 Job/Invocation/StepRun。

### 38.2 合同

`reconcileActionReceipt({ receiptId, result, now })` 只允许以下情况应用：

- Receipt 状态是 `committed`；
- Workflow Run 尚未 terminal，且 deadline 尚未到；
- Job 的 `attempts` 与 Receipt 的 attempt 完全相同；
- Job 没有仍然有效的 active lease；
- Job 不是 `cancelled`。

结果原因：

```text
applied
already_applied
not_committed
run_terminal
run_deadline
attempt_superseded
active_lease
job_cancelled
```

`attempt_superseded` 是关键 fencing：如果新 Worker 已经领取了同一个 Job 的下一次 attempt，旧 Receipt 不能覆盖新 attempt 的结果。

### 38.3 实现

- InMemory/Prisma Store 新增 `reconcileActionReceipt()`。
- 应用成功时在同一 Store/transaction 内：
  - Job → `succeeded`；
  - Invocation → `succeeded` 并写入 result；
  - Action StepRun → `succeeded` 并写入 output；
  - 清除 Job lease/retry 时间。
- 重复调用返回 `already_applied`，不会覆盖第一次结果。
- 本轮没有新增 migration；复用了 Round 37 的 Receipt 表。

### 38.4 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts --reporter=dot`：2 个测试文件、58 个测试通过。
- 覆盖：
  - expired lease 的 committed Receipt 应用；
  - 重复 reconciliation 幂等；
  - 新 attempt 接管后拒绝旧 Receipt；
  - InMemory/Prisma Job、Invocation、StepRun 结果同步。

### 38.5 设计结论

Reconciliation 必须是显式 Application Command，不应让普通 Worker retry 隐式猜测外部副作用是否成功。`receiptId + attempt` 是恢复边界；如果 attempt 已变化，系统应停下来交给新的 Action/查询 Workflow，而不是强行覆盖。

### 38.6 偏差与限制

- 当前 reconciliation 的 `result` 由维护者、Connector 或后续 Workflow 提供，Cosmos 不会自动访问第三方平台查询。
- 没有把 reconciliation 接入 API、CLI、SSE 或权限审计。
- 没有实现 `unknown → committed` 的外部查询自动转化；当前仍需先由外部事实生成 committed Receipt。
- Prisma reconciliation 的候选扫描/领取仍以后续维护入口为边界，没有独立的 reconciliation Job queue。

### 38.7 下一步

- 将 reconciliation 封装为 `maintenance` Workflow/Job，而不是暴露裸 Store 方法。
- 增加外部查询 Action 和 Receipt reconciliation 结果事件。
- 继续补 Action abort signal、Worker restart/reclaim 与 Receipt 的组合场景。

## 39. Spike AE：Action AbortSignal 与跨进程取消提示

### 39.1 目的

把 Run Control 的取消从“最终不接受结果”推进到“正在执行的 Action 能收到标准停止提示”。这不是强杀机制，Action/Connector 必须自行决定如何停止网络请求、子进程或外部 SDK 调用。

### 39.2 合同

`ActionExecutionContext` 新增：

```ts
signal: AbortSignal
```

- 同一个 `WorkflowRuntime.cancel(runId)` 会立即 abort 当前 Runtime 中该 Run 的 active Action。
- 另一个 Runtime/Worker 取消 Run 后，当前 Action 的 Job heartbeat 发现 `renewJob=false`，触发同一个 signal。
- `isCancelled()` 同时反映 durable cancel 的本地投影和 `signal.aborted`。
- Action 收到 abort 后仍必须遵守 `completeJob/failJob` fencing；signal 不是提交权限。
- Action 可以忽略 signal，但这样只能保证 Cosmos 内部最终状态不被迟到结果覆盖，不能保证外部副作用停止。

### 39.3 实现

- `WorkflowRuntime` 按 Run 保存 active `AbortController` 集合。
- `cancel()` 先 abort 当前 Runtime 的 Action，再执行持久 `cancelRun()`。
- Action Job heartbeat 在 lease renew 失败或异常时 abort signal。
- `RuntimeContext.callAction()` 在 finally 中注销 controller，避免长生命周期 Runtime 泄漏。
- 不新增数据库字段或 migration。

### 39.4 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts --reporter=dot`：1 个测试文件、37 个测试通过。
- 覆盖：
  - 本地 Runtime cancel 的即时 abort；
  - 不同 Runtime cancel 后 heartbeat 驱动的 abort；
  - abort 后旧 Action 仍无法完成 Job/Run。

### 39.5 设计结论

取消需要两层合同：

```text
AbortSignal：尽快通知正在执行的代码
Lease fencing：最终阻止迟到代码写入 durable truth
```

两者不能互相替代。AbortSignal 是 cooperative cancellation；强制终止、子进程回收和第三方请求中断属于 Action/宿主能力。

### 39.6 偏差与限制

- 父 Run 级联取消不会直接枚举并 abort 其他进程中的所有 descendant Action；它们依赖各自 heartbeat 发现 Job 已被取消。
- 没有实现 Abort reason、grace period、drain timeout 或强制 kill。
- `AbortSignal` 还没有被映射到 Connector/Adapter 的统一 abort port。

### 39.7 下一步

- 为 Action/Connector 定义统一 `abort`/graceful stop port。
- 将 cancellation、lease_lost、unknown-result 接入 Worker Supervisor 和 heartbeat。
- 继续验证 Worker restart/reclaim 与 abort/Receipt 的组合。

## 40. Spike AF：Receipt reconciliation 的 maintenance Workflow 边界

### 40.1 目的

把 Round 38 的裸 `WorkflowStore.reconcileActionReceipt()` 收敛到 Workflow/Action 模型中，验证未来可以编排：

```text
外部查询 Action
→ committed Receipt
→ Receipt reconciliation Action
→ 通知/审计/知识处理 Action
```

### 40.2 合同

新增版本化定义：

```text
Action    cosmos.receipt.reconcile@1
Workflow  cosmos.maintenance.receipt-reconcile@1
```

Workflow 输入：

```ts
{
    receiptId: string;
    result: unknown;
}
```

Workflow 输出保留：

- `receiptId`
- `invocationId`
- `applied`
- reconciliation `reason`

底层 CAS、Run deadline、active lease、attempt supersede 和 cancelled Job 规则不改变。

### 40.3 实现

- 新增 `createWorkflowReceiptReconcileAction()`。
- 新增 `createWorkflowReceiptReconciliationWorkflow()`。
- 新增 `registerWorkflowReceiptReconciliation(runtime, store, now)`：
  - 注册 Action Definition；
  - 注册 maintenance Workflow Definition；
  - 允许宿主决定是否启用，不在 `apps/worker` 自动开启。
- InMemory focused test 通过真实 Workflow Runtime 执行 reconciliation，确认结果重新写入原 Invocation。
- 不新增数据库字段或 migration。

### 40.4 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts --reporter=dot`：1 个测试文件、38 个测试通过。
- 覆盖底层 reconciliation 和 maintenance Workflow 编排边界。

### 40.5 设计结论

Reconciliation 是一种 maintenance Workflow，而不是 API 对数据库的特殊旁路。外部平台查询、Receipt 更新、结果恢复、通知和审计都可以通过 Action 组合；Cosmos Runtime 只负责 durable orchestration 和边界 fencing。

### 40.6 偏差与限制

- 当前 registration helper 仍是 package-level spike，没有生产 Definition Registry/Binding/权限/审计接线。
- maintenance Workflow 的 `result` 由上游查询 Action 或调用方提供，尚未定义标准外部查询协议。
- 没有把 reconciliation 结果作为 DomainEvent/Outbox 事件发布。

### 40.7 下一步

- 将该 Workflow Definition 放入持久 Definition Registry，并通过 Binding 控制启用。
- 增加外部查询 Action 的 Adapter contract 和查询结果校验。
- 为 reconciliation、compensation、notification 设计统一 maintenance lane。

## 41. Spike AG：Workflow lane/priority 调度接缝

### 41.1 目的

验证 Ingest、Knowledge、Research、Maintenance 等 Workflow 是否可以在同一持久 Run 表中隔离领取，并为后续 Worker Supervisor 提供最小 admission/lane 接缝。

### 41.2 合同

每个 `WorkflowRun` 新增：

```text
lane     默认 "default"
priority 默认 0
```

`claimNextRun()`：

- 如果 Worker 指定 lane，只能领取同 lane 的 queued 或 lease expired Run；
- 按 `priority DESC`；
- 再按 `createdAt ASC`、`id ASC` 稳定排序；
- 没有 wildcard lane，也没有跨 lane 自动窃取。

`WorkflowRuntimeOptions.lane` 表示 Worker 的 admission lane。父 Workflow 启动 child 时，child 继承父的 lane/priority；独立创建的 Run 可以显式指定。

### 41.3 实现

- Runtime 公共合同新增 lane/priority schema、默认值和 Run/Input 字段。
- `WorkflowRuntime.start()` 支持 `lane`/`priority`。
- `WorkflowRuntime.runNext()` 将 Worker lane 传给 Store。
- InMemory/Prisma `claimNextRun()` 保持同一过滤和排序语义。
- Prisma migration：
  - `20260809110000_workflow_run_lane_priority`；
  - 新增 `WorkflowRun.lane`、`WorkflowRun.priority`；
  - 新增 `(lane, status, priority, createdAt)` 索引。

### 41.4 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts --reporter=dot`：2 个测试文件、64 个测试通过。
- 覆盖：
  - default/maintenance lane 隔离；
  - priority 高者先领取；
  - Runtime lane admission；
  - child lane/priority inheritance；
  - Prisma 持久 mapping。

### 41.5 设计结论

Lane 是 Worker 的领取边界，priority 是 lane 内的排序信号；它们不替代 Workflow budget、backpressure、fairness 或 rate limit。把这些概念混成一个 `priority` 字段会导致后续返工，因此本轮只固定最小调度语义。

### 41.6 偏差与限制

- 没有 priority aging/fairness；高优先级持续涌入可能饿死低优先级 Run。
- 没有 lane capacity、并发度、backpressure、rate limit 或 quota admission。
- 没有 parent/child 跨 lane policy；当前 child 直接继承父 lane。
- `apps/worker` 尚未按 lane 启动多个正式 Supervisor lane。

### 41.7 下一步

- 设计 Worker Supervisor 的 lane configuration、并发上限、heartbeat 和 drain。
- 加入 priority aging/fairness 的可选策略，不修改底层脚本 Workflow 语义。
- 将 Source schedule、Research request、Maintenance reconciliation 映射到正式 lane。

