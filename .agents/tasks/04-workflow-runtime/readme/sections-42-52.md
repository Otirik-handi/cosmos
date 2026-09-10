---
parent: .agents/tasks/04-workflow-runtime/README.md
range: §42–52(Spike AH–AR)
sealed_at: 2026-09-11
tags: [workflow-runtime, spikes]
tokens_est: 7033
---

## 42. Spike AH：Workflow lane supervisor 接缝

### 42.1 目的

在不替换现有 `apps/worker` 的情况下，验证多个 Workflow lane、并发 slot 和 graceful stop 可以由一个宿主级 Supervisor 统一管理。

### 42.2 合同

`WorkflowLaneSupervisor` 接受多个 lane definition：

```ts
{
    id: string;
    lane: string;
    runtime: WorkflowRuntime;
    concurrency?: number;
    pollIntervalMs?: number;
}
```

- 每个 lane 创建固定数量的 `WorkflowWorkerLoop` slot；
- slot 共享同一 lane admission，但每个 tick 独立 claim Run；
- 一个 Workflow 业务失败收口为 `processed + runStatus=failed`，不阻塞其他 slot；
- lease/store 基础设施异常仍以 `error`/`lease_lost` 暴露；
- `stop()` 停止领取新 tick，等待当前 tick 和各 slot loop 退出；
- Supervisor 不自动接管 fixed Ingest、parent-wake 或 Worker heartbeat。

### 42.3 实现

- 新增 `WorkflowLaneSupervisor`、lane status、slot tick result。
- 构造时校验：
  - lane id 唯一；
  - Runtime lane 与 definition lane 一致；
  - concurrency 和 poll interval 为正数。
- `tick()` 按 lane concurrency 并发执行 slot。
- `start()`/`stop()` 复用现有 `WorkflowWorkerLoop` 的可停止 poll 生命周期。
- 不新增数据库字段或 migration。

### 42.4 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts --reporter=dot`：1 个测试文件、43 个测试通过。
- 覆盖：
  - concurrency=2 的 bounded slots；
  - lane 内多个 Run 处理；
  - 业务失败与成功 slot 隔离；
  - start/stop drain；
  - slot tick 观测结果。

### 42.5 设计结论

Supervisor 是宿主运行控制层，不应进入脚本 Workflow 语义。Workflow Runtime 提供单次 durable tick 和 lease fencing；Supervisor 决定 lane、并发、poll、停止和未来的 backpressure。

### 42.6 偏差与限制

- 当前 Supervisor 只管理 Workflow Runtime loop，不管理旧 Ingest Job、parent-wake Outbox Consumer 或 heartbeat。
- 没有全局并发预算、lane quota、fairness、aging、backpressure、circuit breaker 或 shutdown grace period。
- 多 slot 当前可共享同一个 Runtime workerId；生产实现需要决定 slot/worker identity 与 heartbeat 维度。
- 没有接入 `apps/worker`，避免把实验性 Supervisor 当作生产入口。

### 42.7 下一步

- 抽象统一 `PollerLane` Port，让 Ingest、Outbox、Workflow Run 共用 Supervisor 生命周期。
- 增加 durable Worker lane heartbeat、slot identity、drain deadline 和 backpressure。
- 评估 lane 内 priority aging 与全局 budget admission。

## 43. Spike AI：通用 Poller Lane Supervisor

### 43.1 目的

把 Supervisor 生命周期从 Workflow Runtime 中再抽象一层，验证旧 Ingest Worker、Outbox parent-wake 和未来 Workflow Run lane 可以共享同一种 poller/slot/stop 合同。

### 43.2 合同

`WorkerPollerSupervisor` 接受：

```ts
{
    id: string;
    concurrency?: number;
    pollIntervalMs?: number;
    createPoller(slot: number): WorkerPollerPort;
}
```

- 每个 slot 有独立 identity；
- `tick()` 对 lane 的 slots bounded 并发；
- 单个 poller 抛错只产生该 slot 的 `error`，不影响其他 slot；
- `start()` 启动 poll loop；
- `stop()` 停止新 poll、唤醒 timer 并等待当前 poll 完成；
- observation callback 抛错不会停止 poller。

### 43.3 与 WorkflowLaneSupervisor 的关系

```text
WorkerPollerSupervisor       宿主通用生命周期
└── WorkflowLaneSupervisor   Workflow Run 专用 admission/lease tick
```

本轮没有强行把两者合并成一套复杂泛型；Workflow Runtime 仍保留 `processed/failed/lease_lost` 语义，宿主 Poller Supervisor 只负责 poller 生命周期和 slot 错误隔离。

### 43.4 实现

- `packages/application/src/index.ts` 新增：
  - `WorkerPollerPort`；
  - `WorkerPollerLaneDefinition`；
  - `WorkerPollerSupervisor`；
  - slot tick result/status。
- `createPoller(slot)` 为未来 Ingest/Outbox/Workflow lane 提供 owner/consumer identity 注入点。
- 不修改 `apps/worker/src/main.ts`，不改变现有生产轮询链路。
- 不新增数据库字段或 migration。

### 43.5 验证

- `bun run test -- packages/application/src/index.test.ts --reporter=dot`：1 个测试文件、8 个测试通过。
- 覆盖：
  - bounded poller slots；
  - 单 slot error isolation；
  - observation callback failure isolation；
  - graceful stop/drain；
  - duplicate lane/invalid concurrency validation。

### 43.6 设计结论

宿主 Supervisor 不应理解 Entry、Story 或 Action 业务；它只协调可持久化的 poller。WorkflowLaneSupervisor 可以作为一种更强的 poller adapter，fixed Ingest 和 Outbox 也应沿相同生命周期接入。

### 43.7 偏差与限制

- 通用 Supervisor 仍是 package-level spike，没有统一 heartbeat/metrics/tracing。
- 没有 poller backpressure、lane quota、circuit breaker、drain deadline 或 force stop。
- `apps/worker` 尚未迁移到通用 Supervisor；当前生产代码仍有手写 `setInterval`。

### 43.8 下一步

- 为 Ingest Worker、parent-wake Consumer 和 Workflow Supervisor 实现 Poller Adapter。
- 统一 slot identity、WorkerHeartbeat、日志字段和 shutdown 状态。
- 再设计 backpressure 与 lane budget，不把策略塞入单个 Poller。

## 44. Spike AJ：固定 Worker 的 Poller Adapter

### 44.1 目的

验证现有固定 Ingest/Probe Worker 和 terminal parent-wake Consumer 可以接入通用
`WorkerPollerSupervisor`，同时保持各自的 Job/Outbox 领域语义不进入宿主层。

### 44.2 合同

新增两个 Application 层 factory：

```ts
createIngestionWorkerPollerLane(...)
createWorkflowParentWakeWorkerPollerLane(...)
```

- Ingest lane 为每个 slot 创建一个 `IngestionWorker`；
- owner identity 使用 `<ownerPrefix>:<laneId>:<slot>`；
- 每个 parent-wake slot 由调用方提供已经完成 Definition/Binding 解析的 Consumer；
- Supervisor 只看到 `pollOnce()`，不解释 Job、Outbox、Entry 或 Workflow 状态；
- Consumer 的 lease/ack/cursor 仍由 parent-wake Consumer 自己持有。

### 44.3 实现

- `packages/application/src/index.ts`
  - 新增 `IngestionWorkerPollerLaneOptions`；
  - 新增 `createIngestionWorkerPollerLane`；
  - 新增 `WorkflowParentWakeWorkerPollerLaneOptions`；
  - 新增 `createWorkflowParentWakeWorkerPollerLane`。
- `packages/application/src/index.test.ts`
  - 验证两个 Ingest slot 生成独立 owner；
  - 验证两个 parent-wake slot 分别创建 Consumer；
  - 验证 adapter 不改变 Supervisor 的结果封装。
- 没有修改 `apps/worker/src/main.ts`，没有新增 migration。

### 44.4 设计结论

Poller Adapter 的职责是“把领域 worker 实例化为宿主 slot”，不是把 Job 或
Consumer 的状态抽象成另一套状态机。Ingest 的 owner identity 可以由 lane factory
同步生成；parent-wake 的异步 Definition/Binding 解析仍由宿主在创建 lane 前完成。

这保留了一个重要边界：

```text
宿主 Supervisor：slot 生命周期、并发、停止、观测
领域 Worker：claim/lease/retry/checkpoint 或 claim/ack/cursor
```

### 44.5 偏差与限制

- `apps/worker` 仍使用手写 `setInterval`，本轮只验证 adapter，不迁移生产 wiring。
- `WorkerPollerLaneDefinition.createPoller()` 仍为同步 factory；需要异步创建
  Consumer 的宿主必须先完成 Definition/Binding 解析。
- slot heartbeat、全局预算、backpressure、fairness、drain deadline 和强制
  abort 仍未实现。

### 44.6 下一步

- 在不改变领域 worker 合同的前提下，把 adapters 组合到一个 worker bootstrap
  spike，验证 startup/shutdown 顺序和 disabled binding。
- 再决定是否需要 async lane materialization，而不是先把异步初始化塞入
  `WorkerPollerSupervisor` 构造函数。

## 45. Spike AK：Worker bootstrap 的多 lane 接线

### 45.1 目的

验证生产 `apps/worker` 可以使用通用 Poller Supervisor 管理固定 Ingest 和
parent-wake 两条 lane，并明确 graceful shutdown 的顺序。

### 45.2 实现

- `apps/worker/src/main.ts`
  - Ingest lane 通过 `createIngestionWorkerPollerLane()` 创建；
  - parent-wake lane 按 slot 预先完成 Definition/Binding 解析，再通过
    `createWorkflowParentWakeWorkerPollerLane()` 注入；
  - 每个 Ingest slot 使用独立 Job owner；
  - 每个 parent-wake slot 使用独立 Consumer owner；
  - `WorkerPollerSupervisor.start()` 取代手写 `setInterval`；
  - `onTick` 负责统一 poller 错误观察和 process-level ready heartbeat；
  - shutdown 顺序固定为：

```text
stop supervisor
→ drain active poll
→ heartbeat(stopped)
→ close Repository
→ close Logger
```

- 默认保持单 slot；通过环境变量预留：
  - `COSMOS_WORKER_INGEST_CONCURRENCY`
  - `COSMOS_WORKER_PARENT_WAKE_CONCURRENCY`

### 45.3 设计结论

生产 Worker 的 bootstrap 可以只负责组合：

```text
Repository / Connector / Definition Registry
→ Domain Worker Poller Adapter
→ WorkerPollerSupervisor
```

它不需要把 Ingest 或 Outbox 状态翻译成统一业务状态。Supervisor 的 `error`
只表示 poller 基础设施或未处理异常；领域 Worker 仍返回自己的 Job/Consumer
结果并自行完成 durable 收口。

异步的 Consumer Definition/Binding 解析放在 Supervisor 构造之前完成，避免让
同步构造函数隐式拥有数据库初始化和网络/注册依赖。

### 45.4 偏差与限制

- 本轮只完成 bootstrap 接线，尚未建立独立的 Worker bootstrap 单元测试。
- heartbeat 仍是进程级状态，不是持久化的 lane/slot heartbeat。
- 多 lane 的公平性、预算、backpressure、drain deadline 和强制 abort 仍未实现。
- Workflow Run execution lane 仍未启用；当前 parent-wake 只是 durable projection
  consumer。

### 45.5 验证

- `bun run --cwd apps/worker typecheck`：通过。
- `bun run build:worker`：通过。
- `pwsh -NoProfile -File scripts/smoke-node.ps1`：通过；
  - Worker health 为 `ready`；
  - Source/Run/Feed/Search/Story/SSE 链路通过；
  - API/Worker/Connector 结构化日志关联通过。
- `COSMOS_WORKER_INGEST_CONCURRENCY=2`
  `COSMOS_WORKER_PARENT_WAKE_CONCURRENCY=2` 下重跑同一 smoke：通过。

该 smoke 使用隔离 Data Root，并验证 Worker 能启动和消费真实 API 任务；
脚本当前使用 `Stop-Process -Force` 清理进程，因此 graceful shutdown 仍未作为
独立验收证据。

### 45.6 下一步

- 补充 graceful shutdown/drain 的独立进程级验收；
- 将 startup 配置解析和 lane 状态抽成可测试的 bootstrap port；
- 再评估是否需要异步 lane materialization，以及是否接入 Workflow Run lane。

## 46. Spike AL：Worker bootstrap 的可测试边界

### 46.1 目的

把 Worker 主入口中的环境变量解析和 lane materialization 抽成独立模块，
避免 `apps/worker/src/main.ts` 同时承载配置规则、Consumer 初始化、lane
组合和 Supervisor 生命周期。

### 46.2 实现

新增 `apps/worker/src/bootstrap.ts`：

- `readWorkerBootstrapConfig()`：
  - 统一解析 poll interval、lease、Ingest concurrency、parent-wake
    concurrency、版本和 Consumer ID；
  - 非正数、非有限数和非整数配置在启动前失败。
- `createWorkerPollerLanes()`：
  - 总是创建 Ingest lane；
  - disabled parent-wake 不 materialize Consumer；
  - enabled parent-wake 按 slot 异步创建 Consumer；
  - 将 owner identity 固定为
    `<instanceId>:workflow-parent-wake:<slot>`。

`apps/worker/src/main.ts` 现在只负责：

```text
Repository / Connector / Registry 初始化
→ bootstrap lane composition
→ WorkerPollerSupervisor
→ heartbeat / signal / close
```

### 46.3 测试

新增 `apps/worker/src/bootstrap.test.ts`，覆盖：

- 默认和显式环境配置；
- 非法配置拒绝；
- disabled binding 不创建 parent-wake Consumer；
- 2 个 Ingest slot + 2 个 parent-wake slot 的 owner/lane 组合。

### 46.4 设计结论

异步外部依赖的 materialization 应由 bootstrap port 完成；通用 Supervisor
继续只接收已经构造好的 Poller。这样可以测试“是否创建了哪些 lane/slot”，
也不会把 Registry/Prisma 初始化细节泄漏进通用运行时。

### 46.5 偏差与限制

- 尚未把 heartbeat 状态和 lane/slot 状态抽成持久模型。
- graceful shutdown 仍缺独立进程级测试；现有 Node smoke 使用强制清理。
- Workflow Run execution lane 仍未接入生产 Worker。

### 46.6 下一步

- 设计可测试的 graceful shutdown harness，验证 SIGTERM/SIGINT 后的 drain 和
  stopped heartbeat；
- 检查配置变更对 Docker/.env.example/部署文档的同步；
- 再评估 lane heartbeat、backpressure 和 Workflow Run lane。

## 47. Spike AM：Poller graceful drain fencing

### 47.1 目的

验证 Supervisor 在一个 slot 的 `pollOnce()` 尚未返回时收到 stop 请求，
能够等待当前 poll 完成，同时拒绝新的手动 tick。

### 47.2 发现与修复

原实现只拒绝 `running` 和 `stopped` 状态的手动 `tick()`；当状态已经进入
`stopping` 时仍会接受新的 tick。这会让 shutdown drain 期间出现额外 poll，
破坏“停止接纳新工作”的生命周期合同。

修复为 `stopping` 状态明确抛出：

```text
Worker Poller Supervisor is stopping.
```

当前顺序固定为：

```text
stop()
→ status=stopping
→ 拒绝新 tick
→ 等待 current poll
→ status=stopped
```

### 47.3 测试

新增 Application focused test：

- poller 阻塞在当前 tick；
- `stop()` 进入 `stopping`；
- 新 `tick()` 被拒绝；
- 释放 poller 后 stop 等待完成；
- `poll.finished` 先于 Supervisor stopped。

### 47.4 设计结论

Supervisor 的 drain 是 admission fencing，不是强制终止外部调用。正在执行的
Connector/Consumer/Action 仍需要自己的 AbortSignal 和租约 fencing；Supervisor
只保证不再启动新的 poll，并等待已有 poll 返回。

### 47.5 偏差与限制

- 尚未做真实 OS signal 到 Worker 进程的独立测试；
- 没有 drain deadline 或卡死 poller 的强制回收；
- `stopped` heartbeat 仍由 apps/worker signal handler 写入。

### 47.6 下一步

- 将 signal handler 的 shutdown sequence 抽成可注入 port；
- 增加 drain deadline/超时后的 degraded close 设计；
- 同步更新 Docker stop grace period 和 Worker 运维状态。

## 48. Spike AN：可注入的 Worker shutdown sequence

### 48.1 目的

把 `apps/worker` 的 signal handler 从不可测试的 `process.exit()` 闭包中抽出，
验证 shutdown 的阶段顺序、幂等和 degraded close。

### 48.2 实现

新增 `createWorkerShutdownController()`，由宿主注入：

- `stopPollers`
- `heartbeatStopped`
- `closeRepository`
- `announceStopped`
- `closeLogger`
- `onStageError`

控制器保证：

```text
stop pollers
→ heartbeat(stopped)
→ close repository
→ announce worker.stopped
→ close logger
```

- 多次收到 SIGINT/SIGTERM 共享同一个 Promise；
- 任一阶段失败不会跳过后续清理；
- 结果返回 `ok/exitCode=0` 或 `degraded/exitCode=1`；
- `process.exit()` 只留在 `apps/worker/src/main.ts` 的最外层 signal adapter。

### 48.3 测试

新增 bootstrap focused tests：

- 成功 shutdown 的阶段顺序；
- 重复 signal 的 promise 去重；
- poller/repository/logger 任一阶段失败后的继续清理和 degraded 结果。

### 48.4 设计结论

signal 是宿主输入，不应成为领域 Worker 的状态机。shutdown controller 只协调
生命周期阶段；Job/Outbox/Workflow 的 durable 收口仍由各自 Store/Worker 完成。

### 48.5 偏差与限制

- 尚未有真实 OS signal + 独立 Worker 进程的 graceful shutdown 验收；
- 没有 drain deadline，阻塞 poll 仍可能无限等待；
- `stopped` heartbeat 仍是 process-level，不包含每个 lane/slot。

### 48.6 下一步

- 增加可配置 drain deadline；
- 设计超时后的 degraded close、AbortSignal 和租约处理；
- 将 Docker stop grace period 与 shutdown deadline 对齐。

## 49. Spike AO：Poller drain deadline 的显式结果

### 49.1 目的

验证 Supervisor 可以在 deadline 到达时报告“仍有活动 slot”，而不把未完成
poll 错误地标记为 `stopped`。

### 49.2 合同

```ts
supervisor.stop({ deadlineMs })
```

返回：

```ts
{
    status: "drained" | "timed_out";
    activeSlots: Array<{ laneId: string; slot: number }>;
}
```

- `drained`：所有当前 poll 已完成，Supervisor 进入 `stopped`；
- `timed_out`：Supervisor 保持 `stopping`，返回仍在运行的 slot；
- timeout 不会强制终止 poll，也不会关闭 Repository；
- 后续调用无 deadline 的 `stop()` 仍可等待最终 drain。

### 49.3 实现与测试

- `packages/application/src/index.ts`
  - 新增 `WorkerPollerStopOptions`；
  - 新增 `WorkerPollerStopResult`；
  - `stop()` 支持可选 non-negative deadline；
  - active slot 通过 loop promise 观察。
- `packages/application/src/index.test.ts`
  - 阻塞 poll 的 timeout；
  - timeout 后拒绝新 tick；
  - 释放 poll 后继续完成最终 drain；
  - 负 deadline 在任意 Supervisor 状态下拒绝。

### 49.4 设计结论

deadline 只是“观察和分级关闭”的边界，不是安全强杀机制：

```text
timed_out
→ 仍可能有外部调用
→ 不能直接假设 Repository 可安全关闭
```

真正的 degraded close 需要和 AbortSignal、Job/Outbox lease fencing、进程终止
以及 Docker stop grace period 一起设计。

### 49.5 偏差与限制

- `apps/worker` 当前仍使用无 deadline 的 graceful shutdown；
- timeout 后的宿主策略尚未自动化；
- 没有持久化 drain state 或 active slot heartbeat。

### 49.6 下一步

- 将 `WorkerPollerStopResult` 接入 shutdown controller；
- 设计 timeout 后先 abort、再等待 fencing、最后决定 Repository close 的策略；
- 增加进程级 SIGTERM 验收。

## 50. Spike AP：Drain timeout 的安全 shutdown 边界

### 50.1 目的

验证 `WorkerPollerStopResult.timed_out` 接入 shutdown controller 后，不会在
仍有活动 poll 时关闭共享资源。

### 50.2 合同

当 `stopPollers()` 返回：

```ts
{
    status: "timed_out";
    activeSlots: ...
}
```

shutdown controller：

- 返回 `degraded`、`exitCode=1`；
- 调用 `onDrainTimeout` 记录 active slots；
- 不写 `heartbeat(stopped)`；
- 不调用 `Repository.close()`；
- 不调用 `Logger.close()`；
- 不宣称 `worker.stopped`。

正常 `drained` 或没有返回 stop result 时，继续完整清理。

### 50.3 设计结论

```text
timed_out
→ active poll 仍可能访问 Repository
→ 不关闭共享资源
→ 由最外层宿主决定进程终止
```

这避免了“旧 poll 仍在执行、Repository 已关闭”的二次竞态。后续需要把
AbortSignal、lease fencing 和进程终止组合起来，才能实现更完整的 degraded close。

### 50.4 测试

- 正常 shutdown 结果增加 `resourcesClosed=true` 和空 active slots；
- timeout shutdown 返回 `resourcesClosed=false`；
- timeout 路径只执行 `pollers.stop → drain.timeout`；
- 仍保留阶段失败后的继续清理测试。

### 50.5 偏差与限制

- `apps/worker` 当前没有配置 drain deadline，所以生产仍走完整 graceful drain；
- timeout 后由 `process.exit(1)` 终止进程，尚未实现先 abort/lease fencing 的编排；
- 没有真实 SIGTERM 进程级验证。

### 50.6 下一步

- 为 Worker 增加可配置 `COSMOS_WORKER_DRAIN_DEADLINE_MS`；
- 在 timeout 路径接入 Action/Connector AbortSignal；
- 验证旧 Job/Outbox Worker 在进程终止后不能继续写入。

## 51. Spike AQ：Worker drain deadline 配置接线

### 51.1 实现

新增可选环境变量：

```text
COSMOS_WORKER_DRAIN_DEADLINE_MS
```

- 未配置：保持无限 cooperative drain；
- 配置非负毫秒数：传递给 `WorkerPollerSupervisor.stop()`；
- 配置非法值：Worker bootstrap 在启动配置阶段失败；
- Worker started log 记录 deadline（未配置时为 `null`）。

### 51.2 运行结果

- deadline 内完成：正常写 stopped heartbeat、关闭 Repository/Logger；
- deadline 超时：复用 Spike AP 的安全路径：
  - 记录 `worker.drain_timeout`；
  - 返回 degraded；
  - 不写 stopped heartbeat；
  - 不关闭 Repository/Logger；
  - 最外层以 `exitCode=1` 终止进程。

### 51.3 设计结论

默认行为保持兼容，deadline 是显式的运维策略而不是隐式强杀。只有明确配置
deadline 后，Worker 才会进入 timeout 分支；真正的 abort/fencing 仍需后续接入。

### 51.4 测试

- bootstrap 配置默认值包含 `drainDeadlineMs=undefined`；
- 显式 `1500` 可解析；
- 负值被拒绝；
- Round 50 timeout shutdown 行为继续通过。

### 51.5 偏差与限制

- 真实 SIGTERM 与 deadline 的进程级测试仍未完成；
- timeout 后依赖 `process.exit(1)`，尚未实现外部调用 abort；
- Docker stop grace period 尚未同步。

### 51.6 下一步

- 做 Node Worker 的 SIGTERM + deadline smoke；
- 将 AbortSignal 从 Supervisor/Worker 传播到 Connector/Consumer；
- 验证 timeout 后 lease fencing 和重启接管。

### 51.7 平台验证记录

在当前 Windows 环境用 Node 子进程实验 `process.kill(childPid, "SIGTERM")`
和 `"SIGINT"`，子进程均直接退出且没有触发 Node signal handler。该调用不能
作为 Windows graceful shutdown 验收手段。

因此当前证据分开记录：

- PowerShell 7 Node smoke：startup 和真实业务链路通过；
- shutdown controller focused test：顺序、幂等、timeout 分支通过；
- Windows 独立进程 graceful SIGTERM：未验证，现有 `smoke-node.ps1` 使用
  `Stop-Process -Force` 清理。

## 52. Spike AR：Poller AbortSignal 传播

### 52.1 实现

`WorkerPollerPort.pollOnce()` 增加可选 `AbortSignal`：

```ts
pollOnce(signal?: AbortSignal): Promise<unknown>
```

`WorkerPollerSupervisor`：

- 每个 slot 持有独立 `AbortController`；
- `start()` 为新生命周期创建新的 controller；
- `stop()` 先 abort 当前 slot，再等待 poll 返回；
- timeout 仍只报告 active slot，不强制终止。

### 52.2 设计边界

本轮只扩展宿主 Port，不改变领域 Worker 的错误分类：

```text
Supervisor AbortSignal
→ Poller Adapter
→ Connector/Consumer/Action（后续选择性接入）
```

AbortSignal 是 cooperative hint；Job/Outbox lease fencing 仍是 durable truth
的最终边界。领域适配器必须决定 abort 是取消、retry_wait、unknown result
还是继续完成外部副作用。

### 52.3 测试

- 阻塞 poll 收到 stop 后观察到 `signal.aborted`；
- abort 后 poll 返回，Supervisor 正常 drained；
- 既有 timeout、stopping tick fencing 和全量恢复测试继续保留。

### 52.4 偏差与限制

- Ingest Connector、parent-wake Consumer 尚未消费 signal；
- 没有把 AbortError 自动映射到 Job 状态；
- 没有跨进程 abort 或 OS signal 证明。

### 52.5 下一步

- 为 Connector/Consumer 定义统一 signal/abort port；
- 明确 abort 与 retry/unknown Receipt 的映射；
- 验证 Ingest 在外部 fetch 中断后的 lease/checkpoint 行为。

