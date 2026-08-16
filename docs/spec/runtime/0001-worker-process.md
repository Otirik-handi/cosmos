## 状态

`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`

- 本文只描述该实现基线中可由代码确认的 Worker 进程行为。
- 未列出的部署、恢复、信号处理及运行时保证不属于本规格。

## 最后更新

2026-08-16

## 组件定位

Worker 进程是 Cosmos 后台执行入口。它负责初始化 Repository、创建摄取服务与 legacy worker、按配置组合 Workflow Host、按固定顺序轮询四条 lane、维护 WorkerHeartbeat，并装配可选 Worker Admin。

Workflow Host 的 durable 合同见 [`application/0007-workflow-host-contract.md`](../application/0007-workflow-host-contract.md)，Action 合同见 [`application/0003-action-registry.md`](../application/0003-action-registry.md)。

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

启动顺序是 `repository.initialize()`、`heartbeat(starting)`、构造摄取/探针/legacy worker，按开关构造 Workflow Host 和 control service，启动 Admin（若启用），记录 `worker.started`，写 `heartbeat(ready)`，执行一次 `await poll()` 后再创建 `setInterval(intervalMs)`。

Host 启用时，一个 poll 周期严格执行：

1. workflow-run：先扫描 scheduled source，再执行 run lane；
2. workflow-activity；
3. workflow-completion；
4. legacy worker。

Host 禁用时只执行 legacy lane。每个 lane 都由 Admin 的 `beginPoll`/`endPoll` 包住；异常也必须结束 lane 记录。成功结果调用 `recordClaim`。周期结束异步发起 `heartbeat(ready)`。

调度扫描只对 enabled 且到达间隔的 Source enqueue；重复键、快照复用和冲突由 control/store owner 处理。

## 输入

| 输入 | 默认或约束 |
|---|---|
| `COSMOS_WORKER_POLL_MS` | `30000` 毫秒 |
| `COSMOS_WORKER_LEASE_MS` | `120000` 毫秒 |
| `COSMOS_VERSION` | `0.1.0` |
| `COSMOS_WORKER_ID` | trim 后非空使用，否则 hostname |
| `COSMOS_WORKFLOW_HOST_ENABLED` | 只有精确字符串 `false` 禁用，其他值启用 |
| `COSMOS_WORKER_ADMIN_ENABLED` | 只有精确字符串 `false` 禁用，其他值启用 |
| `COSMOS_WORKER_ADMIN_HOST` | `127.0.0.1` |
| `COSMOS_WORKER_ADMIN_PORT` | `9091`，整数 `0..65535` |
| `COSMOS_WORKER_ADMIN_TOKEN` | trim 后非空才启用 exact Bearer 授权 |

Repository 提供可领取工作、Source 调度字段和 `health()`；Admin drain 是另一个停止输入。

## 输出

- `WorkerHeartbeat` 的 `starting`、`ready`、`stopped` 记录。
- Workflow/legacy lane 的 claim 和 ingest enqueue。
- Admin health、capabilities、status 和 drain 输出。
- `worker.started`、`workflow.lanes.polled`、`worker.job_finished`、`worker.poll_failed`、`worker.heartbeat_failed` 等结构化日志。
- 正常 shutdown 退出码 `0`；停止步骤失败或 bootstrap 失败退出码 `1`。

## 状态与持久化

进程内维护 `polling`、`shuttingDown`、timer、Host/control/legacy/Admin 实例。heartbeat 持久写 `WorkerHeartbeat`；工作流、Job、Completion、Blob 和领域数据由各自 storage owner 持有。调度幂等键交给 control/store，不由 main 维护跨进程索引。

main 未注册真实 runtime Attempt，不能从 poll 或 heartbeat 推导 active Attempt 状态。

## 状态转换

| 当前 | 事件 | 结果 |
|---|---|---|
| 未初始化 | bootstrap | initialize 后写 starting |
| starting | 组合完成 | 记录 started，写 ready |
| ready | poll 允许 | 进入单轮 polling，按 lane 顺序执行 |
| polling | 完成或异常 | 清理 lane 状态，异步写 ready |
| ready/polling | SIGINT、SIGTERM 或 Admin drain | 设置 shuttingDown，清 interval |
| shuttingDown | 所有停止步骤成功 | heartbeat stopped、关闭资源、退出 0 |
| shuttingDown | 任一步骤失败 | 记录 stop_failed，继续清理，退出 1 |
| bootstrap 任意阶段 | 抛错 | 记录 worker.failed，清理并设置 exitCode 1 |

shutdown 顺序为 heartbeat(stopped)、关闭 Admin、markStopped、关闭 Repository、记录 stopped、close logger。它没有等待 active runtime Attempt 的代码证据。

## 副作用

数据库初始化与 heartbeat 写入；构造 Host、Action 和 Connector 运行依赖；领取四 lane 工作；scheduled enqueue；Admin 监听；周期定时器；结构化日志；shutdown 关闭 Admin、Repository、logger 并设置退出码。

## 错误与降级

poll 重入、shutdown 或 Admin 不可接收工作时直接跳过。lane 异常会记录失败且仍调用 `endPoll`。Host 精确禁用时降级为 legacy-only；Admin 精确禁用时不启动 Admin。错误 shutdown 记录 `worker.stop_failed` 并以 1 退出；bootstrap 失败执行 best-effort cleanup。

## 依赖

`PrismaCosmosRepository`、内建 connector registry、`IngestionService`、`ConnectorProbeService`、`IngestionWorker`、`createWorkflowHost`、`IngestWorkflowControlService`、Worker Admin、Worker logger、主机名/PID、Node timer 和 process exit。

## 配置

Worker 默认 Host 和 Admin 均启用；poll/lease 为 `30000/120000`；Admin 默认 `127.0.0.1:9091`。Admin token 为空时无 token callback，非空时 exact `Authorization: Bearer <trimmed>`。端口非法会在启动前抛错。`COSMOS_WORKSPACE_ROOT` 默认当前工作目录并传给 connector registry；其余存储/log 配置由对应 owner 解析。

## 重建验收

1. 给定未设置覆盖变量，观察 `30000/120000`、版本 `0.1.0`、Admin `127.0.0.1:9091`，且不发生默认 Host/Admin 禁用。
2. 给定开关值为 `false`，观察对应组件不创建；给定 `FALSE`、`0` 或空值，观察组件仍按启用路径创建，且不发生宽松布尔解析。
3. 给定 Host 启用，观察 poll 顺序严格为 run→activity→completion→legacy，且不发生 lane 重排。
4. 给定 Host 禁用，观察只轮询 legacy 且 `schedule=true`，且不发生 durable lane 领取。
5. 给定 scheduled source 已到间隔，观察 enqueue key 为 `schedule:sourceId:floor(nowMs/interval)`，且不发生 main 自己的跨进程去重。
6. 给定 poll 重入、shutdown 或 Admin 不接收，观察不开始第二轮，且不发生并行领取。
7. 给定 lane 成功或抛错，观察均有 begin/end 配对，且不发生 lane 计数悬挂。
8. 给定 SIGTERM 或 Admin drain，观察执行 shutdown 资源关闭顺序，且不发生“已等待 active Attempt”的结论。
9. 给定停止步骤失败，观察 `worker.stop_failed` 和退出码 1，且不发生提前跳过其他可执行清理。
10. 给定 bootstrap 抛错，观察 `worker.failed` 与 cleanup，且不发生成功退出码。

## 实现与测试锚点

- `apps/worker/src/main.ts`：环境读取、`heartbeat`、`queueScheduledWorkflowSources`、`bootstrap`、`poll`、`shutdown`、Admin 组合。
- `apps/worker/src/workflow-host.ts`：Host 组合边界。
- `apps/worker/src/workflow-ingest.test.ts`：durable ingest composition、idempotency、snapshot、revision 和 projection smoke。
- `scripts/smoke-node.ps1`：只作为 Node 生产验收锚点，不作为 Worker 组件实现。

## 非目标/边界

- legacy lane 仍存在；本规格不替代 legacy worker 规格。
- Admin disabled 路径没有 Admin 运维面。
- 未验证跨进程 recovery、长时双 Worker fencing、Docker、browser、真实 RSS/Bilibili/OpenCLI 或生产 SIGTERM 活跃 Attempt deadline。
- 不描述 Gateway、Redis、多主机、远程执行或 Worker Admin 持久化。
