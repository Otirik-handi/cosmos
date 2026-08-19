# Worker 进程

## 状态

当前实现规格；后续代码变化应同步更新本文。

- 本文只描述当前实现中可由代码确认的 Worker 进程行为。
- 未列出的部署、恢复、信号处理及运行时保证不属于本规格。

## 最后更新

2026-08-18

## 组件定位

Worker 进程是 Cosmos 后台执行入口。它负责初始化 Repository、创建摄取服务与 legacy worker、按配置组合 Workflow Host、按固定顺序轮询四条 lane、维护 WorkerHeartbeat，并装配可选 Worker Admin。

Workflow Host 的 durable 合同见 [`application/0007-workflow-host-contract.md`](../application/0007-workflow-host-contract.md)，Action 合同见 [`application/0003-action-registry.md`](../application/0003-action-registry.md)。

### 在系统中的位置与作用

它是 Cosmos 的后台 Worker 进程入口，负责把 Repository、Connector runtime、legacy worker、Workflow Host 和可选 Admin 组合成持续轮询的进程。

### 解决的问题

它统一初始化后台依赖、按固定顺序推进 legacy/workflow lane、维护 heartbeat，并在停止时收拢进程资源，而不是让每条 lane 自己管理主循环。

### 使用方式

Worker main 读取配置并启动本进程；进程创建 host 后按周期轮询各 lane，更新 WorkerHeartbeat，必要时由 Worker Admin 触发 drain/shutdown。

### 典型情景

需要持续执行 legacy ingestion 或 durable Workflow、检查 Worker 存活，或在本地启动后台处理进程时，选择该入口。

## 概念与定义

- **workerId**：`COSMOS_WORKER_ID` 经 `trim` 后非空时采用其值，否则采用主机名。
- **instanceId**：`${hostname}:${process.pid}`，用于当前进程的 owner 身份。
- **Workflow Host**：由 `createWorkflowHost` 创建的工作流运行宿主，默认启用。
- **legacy worker**：`IngestionWorker`。Host 启用时仍参与 legacy lane，但其 `schedule` 关闭；Host 禁用时 `schedule` 开启。
- **lane**：一次 poll 中独立处理的一类队列。Host 启用时顺序为 `workflow-run`、`workflow-activity`、`workflow-completion`、`legacy`。
- **heartbeat**：写入 `WorkerHeartbeat` 的进程生命周期状态，不等同于 runtime Attempt。
- **scheduled source**：`enabled` 且存在 `scheduleIntervalMs` 的 Source；Source 的 canonical 定义见 [`contracts/0001-public-contracts.md`](../contracts/0001-public-contracts.md)。
- **调度桶与幂等键**：`bucket=floor(nowMs/interval)`，键为 `schedule:${source.id}:${bucket}`。

## 外部行为

启动前先调用 `parseWorkerRuntimeConfig`，在构造 Repository、Connector、Workflow Host、Worker 或 Admin 之前 fail-fast 校验数值配置。校验通过后依次执行 `repository.initialize()`、`heartbeat(starting)`、构造摄取/探针/legacy worker，按开关构造 Workflow Host 和 control service，启动 Admin（若启用），记录 `worker.started`，写 `heartbeat(ready)`，执行一次初始 poll 后再创建 `setInterval(pollMs)`。

Host 启用时，一个 poll 周期严格执行：

1. workflow-run：逐个扫描 scheduled source；单个 enqueue 失败只记录并继续。随后优先从 `store.listRunsForRecovery({ limit: 1 })` 取得候选并按 `runId` poll，否则普通扫描；
2. workflow-activity；
3. workflow-completion；
4. legacy worker。

Host 禁用时只执行 legacy lane。每个 lane 都由 Admin 的 `beginPoll`/`endPoll` 包住；异常也必须结束 lane 记录，某 lane 失败不能跳过后续 lane。成功结果调用 `recordClaim`，周期结束异步发起 `heartbeat(ready)`。同一时间只允许一个 poll。

调度扫描只对 enabled 且到达间隔的 Source enqueue，使用 `schedule:<sourceId>:<floor(nowMs / interval)>` 幂等键；重复键、快照复用和冲突由 control/store owner 处理。

`SIGINT`/`SIGTERM` 与 Admin drain 进入同一 `WorkerRuntime.requestShutdown` 状态机；停止新 poll，等待当前 poll 和已登记 Attempt，超过 deadline 才进入 force shutdown。

## 输入

| 输入 | 默认或约束 |
|---|---|
| `COSMOS_WORKER_POLL_MS` | `30000` 毫秒，安全正整数 |
| `COSMOS_WORKER_LEASE_MS` | `120000` 毫秒，安全正整数 |
| `COSMOS_WORKER_SHUTDOWN_DEADLINE_MS` | `30000` 毫秒，安全整数 `0..86400000` |
| `COSMOS_VERSION` | `0.1.0` |
| `COSMOS_WORKER_ID` | trim 后非空使用，否则 hostname |
| `COSMOS_WORKFLOW_HOST_ENABLED` | 只有精确字符串 `false` 禁用，其他值启用 |
| `COSMOS_WORKER_ADMIN_ENABLED` | 只有精确字符串 `false` 禁用，其他值启用 |
| `COSMOS_WORKER_ADMIN_HOST` | `127.0.0.1` |
| `COSMOS_WORKER_ADMIN_PORT` | `9091`，整数 `0..65535`；`0` 允许动态端口 |
| `COSMOS_WORKER_ADMIN_TOKEN` | trim 后非空才启用 exact Bearer 授权 |

Repository 提供可领取工作、Source 调度字段和 `health()`；Admin drain、进程信号和 shutdown deadline 是其它停止输入。

## 输出

- `WorkerHeartbeat` 的 `starting`、`ready`、`stopped` 记录。
- Workflow/legacy lane 的 claim 和 ingest enqueue。
- Admin health、capabilities、status、metrics 和 drain 输出。
- Workflow Activity 成功 claim 后登记 `${jobId}:attempt:${attempt}` 的 runtime Attempt（当前单 poll 的 `slot=0`），finally 在所有执行/异常路径注销；Attempt 回调异常只记录 warning。
- `worker.started`、`worker.poll.completed`、`workflow_run_execution_finished`、`worker.job_finished`、`worker.poll_failed`、`worker.heartbeat_failed`、`worker.shutdown.timed_out` 等结构化日志。
- 正常 shutdown 退出码 `0`；停止步骤失败或 bootstrap 失败退出码 `1`；deadline force shutdown 返回 `timed_out`、`resourcesClosed=false` 并以 `1` 结束。

## 状态与持久化

进程内维护 `WorkerRuntime` 的 `polling`、`shuttingDown`、timer、当前 poll、Host/control/legacy/Admin 实例。heartbeat 持久写 `WorkerHeartbeat`；工作流、Job、Completion、Blob 和领域数据由各自 storage owner 持有。调度幂等键交给 control/store，不由 main 维护跨进程索引。

Activity runtime Attempt 是内存中的当前执行登记，字段包含 `attemptId`、`jobId`、`runId`、`actionRef`、`lane`、`slot`、`startedAt`、`leaseExpiresAt`、`cancellationRequested`，不包含 lease token；Attempt 的公开历史仍由 Domain Event lifecycle 投影。shutdown 等待该登记，不能从 poll 或 heartbeat 猜造 identity。

## 状态转换

| 当前 | 事件 | 结果 |
|---|---|---|
| 未初始化 | bootstrap | 先校验配置；非法数值在任何依赖构造前抛错 |
| starting | 组合完成 | 记录 started，写 ready |
| ready | poll 允许 | 进入单轮 polling，按 recovery-priority 的 lane 顺序执行 |
| polling | 完成或异常 | 清理 lane 状态，异步写 ready |
| ready/polling | SIGINT、SIGTERM 或 Admin drain | 设置 shuttingDown，清 interval，停止接收新 poll |
| shuttingDown | poll 与 Attempt 在 deadline 内清空且资源关闭成功 | heartbeat stopped、关闭 Admin、markStopped、关闭 Repository/logger，退出 0 |
| shuttingDown | deadline 到达仍有 poll/Attempt | 取消 active Run/Activity/Completion controller，记录 `worker.shutdown.timed_out`，尽可能关闭资源，返回 `timed_out/resourcesClosed=false`，退出 1 |
| shuttingDown | 其它停止步骤失败 | 记录 stop_failed，继续清理，返回 failed，退出 1 |
| bootstrap 任意阶段 | 抛错 | 记录 worker.failed，清理并设置 exitCode 1 |

正常 shutdown 顺序为等待当前 poll/Attempt、`heartbeat(stopped)`、关闭 Admin、`markStopped`、关闭 Repository、close logger。Admin drain 与进程信号共用该顺序；deadline force shutdown 不报告成功 drain。

## 副作用

数据库初始化与 heartbeat 写入；构造 Host、Action 和 Connector 运行依赖；领取四 lane 工作；scheduled enqueue；Attempt register/finish；Admin 监听；周期定时器；结构化日志；shutdown 关闭 Admin、Repository、logger 并设置退出码。

## 错误与降级

非法 `COSMOS_WORKER_POLL_MS`、`COSMOS_WORKER_LEASE_MS` 或 `COSMOS_WORKER_SHUTDOWN_DEADLINE_MS` 在初始化任何依赖之前抛固定前缀错误。poll 重入、shutdown 或 Admin 不可接收工作时直接跳过；lane 异常会记录失败且仍调用 `endPoll`，并继续后续 lane。Host 精确禁用时降级为 legacy-only；Admin 精确禁用时不启动 Admin。deadline 到达不能伪装成成功 drain；错误 shutdown 记录 `worker.stop_failed` 并以 1 退出；bootstrap 失败执行 best-effort cleanup。

## 依赖

`PrismaCosmosRepository`、内建 connector registry、`IngestionService`、`ConnectorProbeService`、`IngestionWorker`、`createWorkflowHost`、`IngestWorkflowControlService`、Worker Admin、Worker logger、主机名/PID、Node timer 和 process exit。

## 配置

Worker 默认 Host 和 Admin 均启用；poll/lease 为 `30000/120000`；shutdown deadline 默认 `30000`，范围 `0..86400000`；Admin 默认 `127.0.0.1:9091`，配置 `0` 时由操作系统分配动态端口。`COSMOS_WORKER_POLL_MS` 与 `COSMOS_WORKER_LEASE_MS` 必须为安全正整数；deadline 必须为安全整数且在上述范围内。非法值在依赖构造前 fail-fast，错误前缀分别为 `COSMOS_WORKER_POLL_MS must be a positive integer.`、`COSMOS_WORKER_LEASE_MS must be a positive integer.`、`COSMOS_WORKER_SHUTDOWN_DEADLINE_MS must be an integer between 0 and 86400000.`。Admin token 为空时无 token callback，非空时 exact `Authorization: Bearer <trimmed>`；端口非法会在启动前抛错。`COSMOS_WORKSPACE_ROOT` 默认当前工作目录并传给 connector registry；其余存储/log 配置由对应 owner 解析。

## 重建验收

1. 给定未设置覆盖变量，观察 `30000/120000/30000` 的 poll、lease、shutdown deadline，版本 `0.1.0`、Admin `127.0.0.1:9091`，且不发生默认 Host/Admin 禁用。
2. 给定非法 poll、lease 或 deadline，观察在 Repository/Connector/Host/Admin 构造前以对应固定前缀抛错，且不发生副作用。
3. 给定开关值为 `false`，观察对应组件不创建；给定 `FALSE`、`0` 或空值，观察组件仍按启用路径创建，且不发生宽松布尔解析。
4. 给定 Host 启用，观察 poll 顺序严格为 run→activity→completion→legacy；恢复候选存在时 run lane 先按 runId 领取，且不发生 lane 重排。
5. 给定 scheduled source 已到间隔，观察 enqueue key 为 `schedule:sourceId:floor(nowMs/interval)`；Source A enqueue 失败时 Source B 和后续 lanes 仍执行。
6. 给定 poll 重入、shutdown 或 Admin 不接收，观察不开始第二轮，且不发生并行领取。
7. 给定 Activity claim 成功，观察 Attempt 注册与 finally finish 成对，Attempt slot 为 `0` 且不包含 token；回调异常只形成 warning。
8. 给定 lane 成功或抛错，观察均有 begin/end 配对，且不发生 lane 计数悬挂。
9. 给定 SIGTERM 或 Admin drain，观察共用等待 poll/Attempt、heartbeat stopped、Admin、Repository、logger 的停止顺序；deadline 内成功，否则返回 `timed_out/resourcesClosed=false` 并退出 1。
10. 给定停止步骤失败，观察 `worker.stop_failed` 和退出码 1，且不发生提前跳过其他可执行清理。
11. 给定 bootstrap 抛错，观察 `worker.failed` 与 cleanup，且不发生成功退出码。

## 实现与测试锚点

- `apps/worker/src/config.ts`：数值配置解析和 fail-fast 校验。
- `apps/worker/src/runtime.ts`：单飞 poll、recovery priority、四 lane 隔离、shutdown deadline、Attempt 等待和 force cancellation。
- `apps/worker/src/main.ts`：环境读取、heartbeat、scheduled enqueue、bootstrap、Admin 组合和信号入口。
- `apps/worker/src/runtime.test.ts`、`apps/worker/src/runtime.property.test.ts`、`apps/worker/src/config.test.ts`：配置、lane 隔离、recovery、shutdown deadline 和 property 行为。
- `e2e/ingest.e2e.test.ts`、`e2e/worker-admin.e2e.test.ts`、`e2e/recovery.e2e.test.ts`、`e2e/scheduling.e2e.test.ts`：真实 dist/API/Worker/SQLite 的四个 Node E2E；浏览器入口见 [`docs/testing/README.md`](../../testing/README.md)。

## 非目标/边界

- legacy lane 仍存在；本规格不替代 legacy worker 规格。
- Admin disabled 路径没有 Admin 运维面。
- 当前已通过四个 Node E2E 和 Playwright browser E2E 的本地证据；未证明长时间双 Worker 压力/fencing、Docker Compose 部署或真实 RSS/Bilibili/OpenCLI 来源。
- Docker 只通过显式 `bun run test:docker` 验收；当前 Docker CLI 缺失，未运行。真实来源只通过显式 `bun run test:real:rss`、`bun run test:real:aihot`、`bun run test:real:bilibili` 验收；当前缺少对应变量或外部前置，未运行。
- 不描述 Gateway、Redis、多主机、远程执行或 Worker Admin 持久化。
