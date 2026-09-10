---
parent: .agents/tasks/04-workflow-runtime/README.md
range: §27–33(Spike S–Y)
sealed_at: 2026-09-11
tags: [workflow-runtime, spikes]
tokens_est: 7045
---

## 27. Spike S：Outbox 驱动的跨进程 parent wake

### 27.1 目的

把 child Workflow 完成后的父级传播从 terminal close transaction 中拆出，验证以下链路：

```text
child completeRun
→ WorkflowRun terminal
→ workflow.run.terminal DomainEvent / Outbox
→ terminal parent-wake Consumer
→ parent child_workflow StepRun 收口
→ waiting parent Run queued
→ parent Workflow replay
```

### 27.2 实现

- `WorkflowStore.completeRun()` 只负责：
  - 在 Run lease fencing 下收口 terminal 状态；
  - 清理 Run lease 和 waiting 字段；
  - 追加幂等的 `workflow.run.terminal@v1` DomainEvent/Outbox。
- 新增 `WorkflowStore.propagateChildWorkflowTerminal()`：
  - 从持久 child Run 读取真实 terminal 状态、结果和错误；
  - 校验 Event payload 中的 `runId` 与 `parentRunId`；
  - 按 child Run ID 找到唯一父 `child_workflow` StepRun；
  - 将 StepRun 收口为 `succeeded`、`failed` 或 `cancelled`；
  - 只有父 Run 仍在等待同一个 child 时才重新排队。
- 新增 `WorkflowTerminalParentWakeConsumer`：
  - 固定消费 `workflow.run.terminal@v1`；
  - 处理无父级的 terminal event 时只 ack，不产生副作用；
  - handler 已提交但 ack 丢失时允许重新投递；
  - 重投递通过 StepRun 状态和 child ID 做幂等收口。
- InMemory 和 Prisma Store 都在各自的持久化边界内实现上述命令；消费租约和 ack 仍由通用 Outbox Consumer 负责。

### 27.3 验证

- InMemory/Prisma child wait 测试确认：child terminal close 后父 Run 仍为 `waiting`，直到独立 Consumer 处理 Outbox 才变为 `queued`。
- InMemory retry 测试模拟“父级状态已提交、ack 失败”：
  - 第一次消费进入 `retry_wait`；
  - 第二次投递成功 ack；
  - 父 StepRun 和父 Run 没有重复推进。
- Prisma 测试重复执行 `propagateChildWorkflowTerminal()`，第二次返回 `stepUpdated=false`、`parentRequeued=false`。
- full test：16 个测试文件、98 个测试通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，12 条 migration 全部应用。
- `git diff --check`：通过。
- Round 27 涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。

### 27.4 设计结论

- terminal close 和 parent wake 是两个不同的 durable 事实：
  - terminal close 属于 child Run 的生命周期收口；
  - parent wake 属于对 terminal 事实的异步投影/协调。
- parent wake 不能只依赖进程内回调，否则 child Worker 与 parent Worker 分离后无法恢复。
- parent wake handler 必须从数据库读取 child 的真实终态，而不是信任可被重投递的 payload 作为唯一事实。
- 事务提交与 Outbox ack 之间允许出现“副作用已完成、消息仍待重试”的窗口，因此 handler 必须幂等。

### 27.5 偏差与限制

- `WorkflowTerminalParentWakeConsumer` 尚未接入 `apps/worker` 的 supervisor、lane 和 heartbeat。
- 尚未实现 Consumer Definition/Binding 的生产注册和版本迁移。
- 尚未处理 timeout、parent/child cancel propagation、child retry/dead-letter、budget 或递归深度。
- parent wake 目前只更新一个匹配的父 `child_workflow` StepRun；多父引用、Join 和 Fan-in 尚未建模。
- 尚未加入 terminal payload 的正式 schema registry、retention、签名和敏感字段筛选。

### 27.6 下一步

- 把 parent-wake consumer 注册到生产 Worker，并验证跨进程 restart/reclaim。
- 统一 terminal Application Command，收紧可绕过 Event/Outbox 的 `updateRun(status=terminal)` 旁路。
- 增加 timeout/cancel/retry/budget/递归深度合同，再接真实 Research Workflow。

## 28. Spike T：统一 terminal Application Command 与取消 fencing

### 28.1 目的

消除 `updateRun(status=terminal)` 旁路，确保成功、失败和取消都经过明确的 terminal Application Command，并产生一致的 DomainEvent/Outbox。

### 28.2 实现

- 新增 `WorkflowStore.cancelRun()`：
  - 可取消 `queued`、`running` 和 `waiting` Run；
  - 清理 waiting 状态和已有 orchestration lease；
  - 清理旧 lease 使正在执行的 Worker 无法继续 terminal close；
  - 写入幂等的 `workflow.run.terminal@v1` Event/Outbox；
  - 对重复取消返回已有终态，不追加重复事件。
- `WorkflowRuntime.cancel()` 改为调用 `cancelRun()`。
- `WorkflowStore.updateRun()` 拒绝 `succeeded`、`failed`、`cancelled` 状态写入；它只保留运行中状态、等待状态、checkpoint 和普通错误更新。
- Prisma 将 terminal event/outbox 创建抽为同一 transaction helper，`completeRun()` 和 `cancelRun()` 共用。

### 28.3 验证

- InMemory/Prisma focused：2 个测试文件、42 个测试通过。
- full test：16 个测试文件、100 个测试通过。
- 取消后 `completeRun()` 使用旧 Worker lease 会被 `WorkflowLeaseLostError` 拒绝。
- 重复 `cancelRun()` 的 Event 数量保持为 1。
- `updateRun(status=terminal)` 明确失败并提示使用 `completeRun` 或 `cancelRun`。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，12 条 migration 全部应用。
- `git diff --check`：通过。
- Round 28 涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。

### 28.4 设计结论

- terminal 状态不是普通字段 patch，而是需要持久副作用的 Application Command。
- 取消是一次 terminal close，不是只在内存中设置一个取消标记。
- 清 lease 是取消 fencing 的必要条件；否则旧 Worker 可能在用户取消后覆盖结果。
- terminal Event/Outbox 的幂等 key 继续统一为 `workflow-run:<runId>:terminal`。

### 28.5 偏差与限制

- 当前没有 cancellation request/审批状态；单用户阶段直接执行取消。
- parent/child cancel propagation 仍由 terminal parent-wake consumer 后置处理，没有主动级联取消。
- `WorkflowRuntime.cancelledRuns` 仍是进程内的快速取消提示，持久状态才是恢复事实。
- 尚未将所有外部 Application Service 的 terminal close 入口统一到同一 Command Bus。

### 28.6 下一步

- 把 cancel 请求、超时和 Worker heartbeat 纳入统一 Run Control 合同。
- 验证 cancel 与 child wait、Action Job lease、重启恢复的组合。
- 将 parent-wake Consumer 注册到生产 Worker，并补真实 restart/reclaim smoke。

## 29. Spike U：child cancellation 的 parent wake 与 replay

### 29.1 目的

验证取消不是孤立的 child 终态，而是可以沿已有 terminal Event/Outbox 链路驱动等待父 Workflow 的恢复，并最终得到明确的父级结果。

### 29.2 实现验证

链路固定为：

```text
parent wait:true
→ child queued
→ cancelRun(child)
→ child cancelled + terminal Event/Outbox
→ parent-wake Consumer
→ child_workflow StepRun cancelled
→ parent Run queued
→ parent replay
→ parent failed with child cancellation error
```

- InMemory/Prisma 都验证 child cancel 后父 Run 在 Consumer 处理前仍保持 `waiting`。
- Consumer 处理后只唤醒等待同一 child ID 的父 Run。
- 父脚本 replay 读取已收口的 `child_workflow` StepRun，并把取消错误转为父 Run 的明确 `failed` 终态。
- child 取消事件和父级 terminal 事件在同一 Consumer Group 中按 sequence 顺序消费；无父级的事件只 ack。

### 29.3 验证

- InMemory/Prisma focused：2 个测试文件、43 个测试通过。
- 覆盖 `cancelRun()`、terminal Event/Outbox、parent-wake、StepRun `cancelled`、父 Run requeue 和父 replay failure。
- full test：16 个测试文件、101 个测试通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，12 条 migration 全部应用。
- `git diff --check`：通过。
- Round 29 涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。

### 29.4 设计结论

- child cancellation 复用 terminal close 和 parent-wake，不另造一条父子传播通道。
- 父级是否失败由 Workflow 脚本 replay 决定，Store 只负责持久投影和 requeue；这保留了未来自定义“取消后继续/降级/重试”策略的空间。
- 取消错误必须持久在 child StepRun output/error 中，不能只依赖内存异常。

### 29.5 偏差与限制

- 尚未实现主动的 parent → child 级联取消；当前只能取消指定 Run。
- 尚未定义取消策略（立即取消、优雅停止、补偿、降级继续）及其版本化配置。
- Action Job 运行中被取消时，Job lease/外部副作用的停止与补偿仍未闭合。
- 尚未做跨进程真实 restart/reclaim smoke。

### 29.6 下一步

- 把 Run cancellation policy、timeout 和 signal wait 纳入统一 Run Control 合同。
- 验证取消与 Action Job lease、外部副作用 receipt、Worker restart 的组合。
- 再评估 parent → child cancel propagation 是否需要独立 Durable Command。

## 30. Spike V：durable Workflow deadline 与 timeout sweep

### 30.1 目的

验证 Workflow timeout 不依赖进程内 timer，而是由持久 deadline 和 Worker/Runtime tick 共同驱动；服务重启后仍可以从数据库识别并收口过期 Run。

### 30.2 实现

- `WorkflowRun` 新增持久 `deadlineAt`，并增加 `[status, deadlineAt]` 索引。
- `CreateWorkflowRunInput` 支持 `deadlineAt`；`WorkflowRuntime.start()` 支持 `timeoutMs`，转换为绝对 deadline。
- `WorkflowStore.expireDueRuns({ now, limit })`：
  - 扫描 `queued`、`running`、`waiting` 中 deadline 已到的 Run；
  - 清理 waiting 字段和 lease；
  - 以现有 `failed` terminal 状态收口；
  - 写入稳定错误 `Workflow deadline exceeded.` 和 terminal Event/Outbox；
  - 使用 CAS 条件，避免两个 Worker 重复收口同一个 Run。
- `WorkflowRuntime.runNext()` 和 `executeRun()` 每次 tick 先执行 timeout sweep。
- `completeRun()` 在发现当前 Run 已过 deadline 时，将迟到的成功/失败结果拒绝为 deadline failure，不能覆盖超时终态。
- 新增 migration：
  - `20260809000000_workflow_run_deadline`

### 30.3 状态取舍

本轮暂不新增 `timed_out` 状态，timeout 先复用 `failed` + 稳定 error 文本。这是可逆的边界，避免在还没有产品查询/筛选合同前扩大 Run/Step terminal 状态机；未来可以通过 `terminationReason` 或独立状态迁移。

### 30.4 验证

- InMemory/Prisma focused：2 个测试文件、46 个测试通过。
- waiting Run 过期：Runtime tick 将 Run 从 `waiting` 收口为 `failed`，并追加 terminal Event。
- running Run 过期：迟到 `completeRun(status=succeeded)` 返回 deadline failure，Event 数量保持幂等。
- full test：16 个测试文件、104 个测试通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，13 条 migration 全部应用。
- `git diff --check`：通过。
- Round 30 涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。

### 30.5 设计结论

- timeout 的 durable truth 是 `deadlineAt` 和持久 Run 状态，不是某个 Worker 是否还活着。
- 清理 Run lease 是 timeout fencing 的必要条件；过期 Worker 不能继续推进结果。
- timeout sweep 必须是可重复、可抢占的 Store Command，不能只在内存里扫描。
- deadline 只负责终止 Run；父级传播仍统一复用 terminal Outbox/parent-wake Consumer。

### 30.6 偏差与限制

- 正在执行的 Action 到 deadline 后，外部副作用可能已经发生；本轮只保证最终 Run 不接受迟到结果，没有实现 Action 级取消/补偿/receipt。
- `WorkflowWorkerLoop` 目前通过 `runtime.runNext()` 间接 sweep，没有独立 timeout supervisor/指标。
- deadline 暂时只在 Run 创建时设置；没有动态延长、缩短、pause 或子 Run budget/deadline 传播。
- timeout 使用 `failed` 状态，尚无 `terminationReason` 查询字段。

### 30.7 下一步

- 验证 timeout 与 Action Job lease、外部副作用 receipt 和 Worker restart/reclaim 的组合。
- 设计 Run Control policy：cancel、timeout、pause、resume、grace period 和 parent/child propagation。
- 再决定是否引入独立 `timed_out` 状态或 `terminationReason`。

## 31. Spike W：Workflow terminal 与 Action Job fencing

### 31.1 目的

补齐 Run terminal 与 Action Job 自己的 lease 之间的边界，避免 Workflow 已取消或超时后，旧 Action Job 仍把结果写回 Invocation/StepRun。

### 31.2 实现

- Run terminal close（成功、失败、取消、timeout）会在同一 Store 边界取消该 Run 的：
  - `queued` Action Job；
  - `leased` Action Job；
  - `retry_wait` Action Job。
- 同步将关联 `WorkflowActionInvocation` 和 Action `WorkflowStepRun` 置为 `cancelled`，清理 Job lease/retry 时间。
- InMemory/Prisma `claimJob()`：
  - 已知 Run 为 terminal 或 deadline 已到时不再领取；
  - 非 terminal Run 保留低层 Job Port 的现有操作合同。
- InMemory/Prisma `completeJob()`/`failJob()`：
  - 已知 Run terminal 或 deadline 已到时返回 `false`；
  - 旧 lease 不得覆盖 cancelled Invocation/StepRun。
- timeout sweep 和 `cancelRun()` 复用同一 Job cancellation helper，避免三套收口逻辑漂移。

### 31.3 过程偏差与修复

第一次 focused test 把 Job claim 收紧为必须 `Run.status=running`，触发了两个既有低层 Store 测试回归：

- Prisma 基础持久化测试在 queued Run 上直接验证 Job；
- InMemory stale Job 测试使用了没有创建 Run 的历史 spike fixture。

修复为只对“已知 terminal/deadline Run”做 fencing；orphan InMemory fixture 暂时保留为历史低层测试边界，未来应在 Application Command 层禁止生成。

### 31.4 验证

- InMemory/Prisma focused：2 个测试文件、48 个测试通过。
- 取消/timeout 后旧 `completeJob()`、`failJob()` 返回 `false`。
- 取消/timeout 后新的 `claimJob()` 返回 `null`。
- Invocation/Action StepRun 保留 cancelled 状态和错误。
- full test：16 个测试文件、106 个测试通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，13 条 migration 全部应用。
- `git diff --check`：通过。
- Round 31 涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。

### 31.5 设计结论

- Run lease fencing alone 不足以保护 Action Job；Job 必须同时检查父 Run 的 terminal/deadline 状态。
- terminal close 应统一取消尚未完成的内部 Job，否则恢复扫描会重新执行已经失效的工作。
- 外部 Action 已发生的副作用仍不能被数据库回滚；Job cancellation 只保证 Cosmos 内部结果不会迟到写入。

### 31.6 偏差与限制

- 当前没有真正的 Action cancellation token/进程级中断；正在执行的用户代码只能在返回时被拒绝提交。
- 外部副作用 receipt、unknown-result、补偿和幂等仍未实现。
- InMemory 仍允许历史测试创建没有父 Run 的 Invocation/Job；生产 Application 层需要补存在性约束。
- 尚未把 Job cancellation 事件接入审计/SSE。

### 31.7 下一步

- 为 Action Definition 增加 cancellation/abort port 和外部副作用 receipt。
- 验证 timeout/cancel 与 Job retry takeover、Worker restart/reclaim 的组合。
- 在 Application Command 层禁止 orphan Invocation，并把 Job 状态迁移纳入正式 Run Control。

## 32. Spike X：apps/worker 的 Workflow parent-wake wiring（历史基线）

### 32.1 目的

把已经验证的 terminal Outbox/parent-wake Consumer 接入服务器 Worker 入口，同时保持当前固定 Ingest Worker 的运行边界。

### 32.2 实现

- 新增 Application 层 `WorkflowParentWakeWorker`：
  - 复用现有 Worker logger；
  - 将 parent-wake delivery status 作为可观察 worker 记录；
  - 不拥有 Workflow Definition，也不直接操作 Prisma。
- `apps/worker` 启动时：
  - 使用现有 `PrismaCosmosRepository.prisma` 创建 `PrismaWorkflowStore`；
  - 使用同一个 Data Root/SQLite 连接消费 `workflow.run.terminal`；
  - Consumer ID 可由 `COSMOS_WORKFLOW_PARENT_WAKE_CONSUMER_ID` 配置；
  - owner 使用独立的 `<instanceId>:workflow-parent-wake` lease identity。
- 每次 worker poll 的顺序：

```text
parent-wake Consumer tick
→ fixed Ingest Job tick
→ shared heartbeat
```

- parent-wake 出错只记录错误并继续固定 Ingest poll，避免新 Workflow 能力阻塞现有 Phase 1 Ingest。

### 32.3 重要边界

- 本轮只接入 terminal parent-wake Consumer。
- 在 Round 32 当时没有把 `WorkflowWorkerLoop.runNext()` 接入生产入口，因为
  当时还没有真实 Workflow Definition Registry/Action Registry；Round 61 已补上
  可选 lane，但仍保持默认关闭并保留本节的 Registry 限制。
- 没有把 Knowledge/Research Workflow、Consumer Registry binding 或完整 supervisor 假装成已生产化。
- 没有新增数据库 migration。

### 32.4 验证

- Application focused：1 个测试文件、6 个测试通过。
- Apps typecheck：API、Worker、Web 通过。
- Worker 只读审查确认 Workflow Store 与旧 Ingest Repository 共享同一 Prisma/Data Root，未建立第二连接。
- full test：16 个测试文件、107 个测试通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，13 条 migration 全部应用。
- `git diff --check`：通过。
- Round 32 涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。

### 32.5 设计结论

- Parent-wake Consumer 可以先于完整 Workflow execution 接入生产 Worker，作为低风险的 durable projection consumer；Round 61 进一步把 Workflow Run 作为可配置 lane 接入同一宿主。
- Workflow execution loop 必须等 Definition/Action Registry、Run admission、lane、heartbeat 和错误监控合同齐备后再接入。
- 旧 Ingest 与新 Workflow 的共享数据库不是共享进程状态；两者仍通过各自 Store/Application Port 隔离。

### 32.6 偏差与限制

- parent-wake 当前与固定 Ingest 共用一个 poll timer，每次最多消费一条 terminal event。
- 没有独立 Workflow Worker heartbeat/status；现有 heartbeat 只表示整个 Worker 进程 ready。
- 没有 consumer registry 的生产 binding/版本激活流程。
- 生产 Docker、restart/reclaim、真实 terminal event 仍未验收。

### 32.7 下一步

- 增加通用 Definition/Action Registry、插件加载和 Run 输入快照后，再逐步开启自定义 Workflow lane。
- 接入持久 Consumer Registry/Binding，并为 parent-wake 配置正式 definition version。
- 在真实 Workflow Definition Registry 存在后，再开启 `WorkflowWorkerLoop`。

## 33. Spike Y：parent-wake Definition/Binding Registry 激活

### 33.1 目的

把 `apps/worker` 的 parent-wake Consumer 从进程内硬编码配置提升为持久 Definition/Binding 合同，验证版本不可变、启动幂等和 disabled binding 尊重。

### 33.2 实现

- 新增固定 `workflow.parent-wake@1` Definition：
  - event type：`workflow.run.terminal`；
  - lease/retry policy 作为 Definition 内容；
  - Definition version 内容不可变。
- 新增 `createWorkflowTerminalParentWakeConsumerFromRegistry()`：
  - 只激活 enabled binding；
  - 解析绑定的 definition/version；
  - 缺失或 disabled binding 明确失败。
- `apps/worker` 启动：
  - 注册 `workflow.parent-wake@1`；
  - 缺失 binding 时幂等创建 enabled binding；
  - 已存在 disabled binding 时不自动启用；
  - 使用 Registry 解析出的 lease/retry，不用 Ingest `leaseMs` 覆盖 Definition。
- Definition 内容变更必须创建新 version，不能在启动时覆写同一 `id@version`。

### 33.3 验证

- Workflow Runtime focused：1 个测试文件、30 个测试通过。
- 覆盖 enabled binding 解析、Consumer idle tick、disabled binding 拒绝。
- Apps typecheck：API、Worker、Web 通过。
- 无新增 migration。
- full test：16 个测试文件、108 个测试通过。
- `bun run typecheck`：通过，包含 packages、API、Worker 和 Web。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- 隔离 `COSMOS_DATA_ROOT` 执行 `bun run db:migrate`：通过，13 条 migration 全部应用。
- `git diff --check`：通过。
- Round 33 涉及的两个 Markdown 文件：代码围栏、文件末尾换行和相对链接检查通过。

### 33.4 设计结论

- Consumer Definition 是不可变协议；Binding 是可变部署状态。
- Worker 启动可以做幂等“缺失 binding 初始化”，但不能替用户重新启用 disabled binding。
- lease/retry 配置属于 Definition version，不属于每次进程启动的临时覆盖。

### 33.5 偏差与限制

- 当前只激活 parent-wake 一个 Consumer，其他 Knowledge/Research/SSE binding 尚未生产注册。
- 没有 binding activation audit、灰度、rollback 或 supervisor 状态页。
- 如果数据库存在指向未注册旧 Definition 的 binding，Worker 启动会失败，需要显式补齐 Definition version。
- 仍没有完整 Workflow Definition/Action Registry，因此 `WorkflowWorkerLoop` 未接入 apps/worker。

### 33.6 下一步

- 为 Definition/Binding activation 增加启动诊断和可观测状态。
- 抽取多 lane Worker Supervisor，统一 fixed Ingest、parent-wake、timeout sweep。
- 在真实 Workflow Registry 稳定后再启用 Workflow Run execution lane。

