## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

2026-08-16。本文仅描述当前代码中可验证的行为。

## 组件定位

`packages/worker-admin/src/index.ts` 提供进程内的 `WorkerAdminService`，用于维护 Worker 管理状态、健康状态、lane 计数、显式登记的活跃 Attempt、排空记录、能力证据和 Prometheus 文本指标。

同一源码提供基于 `node:http` 的独立 Admin server。它监听独立主机和端口，不复用任务处理或其他服务端口，并将 HTTP 请求映射到 `WorkerAdminService`。

Worker main 默认将 Admin server 绑定到 `127.0.0.1`，可用静态 Bearer token 授权，并通过 `onDrain` 回调触发 main shutdown。该集成不等同于跨进程管理、远程控制或完整的进程终止协调。


### 在系统中的位置与作用
它是 Worker 进程内的管理与观测入口，提供 `WorkerAdminService` 状态模型及独立 `node:http` Admin server。

### 解决的问题
它把健康、lane 计数、活跃 Attempt、能力证据、排空状态和 Prometheus 文本指标集中暴露，并为受控 shutdown 提供 drain 回调。

### 使用方式
Worker main 创建 service 并启动独立 Admin server；管理方按实际配置访问其 HTTP 端口，可用 Bearer token，发起 drain 后由 main 处理 shutdown。

### 典型情景
运维或本地开发需要查看 Worker 状态、读取指标或在更新前排空工作时使用它；它不是跨进程 Gateway 或完整远程终止协调器。

## 概念与定义

- `WorkerMode`：`direct | gateway`。这是类型和状态模型；存在 `gateway` 枚举值、健康项或能力证据，不证明 Gateway 执行链路已经实现。
- `ComponentStatus`：`ready | degraded | unavailable | disabled | unknown`。
- lane：Worker 的工作接收通道。默认配置为一个 `direct` lane，`configuredSlots=1`。
- poll：一次 lane 轮询活动，由 `beginPoll` 和 `endPoll` 配对计数。
- active Attempt：只有调用 `registerAttempt` 明确登记后才进入 `activeAttempts`；`finishAttempt` 将其删除。
- active poll 与 active Attempt：两套独立计数。`status` 同时输出 `activePollCount` 和 `activeAttemptCount`，源码注释明确二者不可互相推导。
- drain：停止接收新工作，并等待已登记 active polls 与 active Attempts 清零的内存状态机。
- FailureSnapshot：经过脱敏的失败快照，用于 lane 错误、近期错误和健康错误输出。
- capability evidence：本地可执行证据，固定为 `evidenceVersion=1`、`evidenceAuthority=local_executable`；它不是远程发现或 Gateway 注册结果。

## 外部行为

`WorkerAdminService` 提供以下核心行为：

- `markReady`：设置 `ready`，设置 `registeredAt` 和 `lastHeartbeatAt`；除非正在 draining，否则启用 `acceptingWork`。
- `markHeartbeat`：更新 `lastHeartbeatAt`。
- `markStopped`：设置 `stopped=true`、`ready=false`、`acceptingWork=false`、`draining=false`；不会替调用方完成或删除 active Attempts。
- `canAcceptWork`：仅当 Worker 已 ready、正在 accepting、未 draining、未 stopped，且至少有一个 enabled lane 时返回可接收。
- `beginPoll`、`endPoll`、`recordClaim`：维护全局及 lane 轮询、占用、时间和错误状态。
- `registerAttempt`、`finishAttempt`：显式维护 active Attempt 集合。
- `requestDrain`、`executeDrain`：创建排空快照、停止接收工作、等待活动归零并调用 `onDrain`。
- `liveness`、`readiness`、`status`、`capabilities`、`metrics`：生成管理面输出。

独立 HTTP server 暴露且仅暴露以下路由：

| 方法 | 路由 | 行为 |
|---|---|---|
| `GET` | `/healthz` | 返回 liveness |
| `GET` | `/readyz` | 返回 readiness；ready 为 `200`，否则为 `503` |
| `GET` | `/metrics` | 返回 Prometheus text |
| `GET` | `/admin/v1/status` | 返回 Worker 状态 |
| `GET` | `/admin/v1/capabilities` | 返回本地能力证据 |
| `GET` | `/admin/v1/drains` | 返回内存中的 drain 历史 |
| `POST` | `/admin/v1/drains` | 创建或幂等读取 drain |
| `GET` | `/admin/v1/drains/:id` | 按 ID 返回 drain |
| 任意 | 其他路径 | 返回 `404` |

`start` 和 `close` 具有近似幂等行为：重复 `start` 直接返回；server 未处于 listening 状态时调用 `close` 直接返回。

## 输入

构造 `WorkerAdminService` 时可提供 lane 配置。lane 标识重复，或 `configuredSlots` 不是正安全整数时，构造立即抛错。未提供 lane 时使用 `direct` lane 和一个 slot。

`beginPoll` 的 lane 必须存在且 enabled，并且 Worker 必须满足 `canAcceptWork`。Attempt 不会因 poll 或 claim 自动登记；调用方必须显式调用 `registerAttempt`。

`POST /admin/v1/drains` 要求：

- 请求头必须包含 `Idempotency-Key`；trim 后长度必须为 `1..200`。
- body 必须是 JSON object。
- `reason` trim 后长度必须为 `1..200`。
- `deadlineMs` 默认 `30000`；可为 `null` 表示无限等待；非 null 时必须是 `0..86400000` 的整数。
- `exitAfterDrain` 只接受 `true`。
- 默认最大请求体为 `64 KiB`；超过 `maxBodyBytes` 返回 `413`。

如果配置 `authorize`，所有 endpoint 都调用该授权逻辑。未配置 `authorize` 时仅允许 loopback 绑定；host 不是 `127.0.0.1`、`::1` 或 `localhost` 时，server 构造直接失败。

Worker main 默认 host 为 `127.0.0.1`。token 非空时，仅精确匹配 `Authorization: Bearer token` 的请求通过该静态 token 检查。

## 输出

liveness 始终输出 `status=alive`、`service=cosmos-worker` 和 Worker metadata。当前实现没有把 `stopped` 映射成 liveness 失败。

readiness 默认生成组件状态映射，并可通过异步 health 覆盖以下组件：`migration`、`taskStore`、`gatewaySession`、`definitionCatalog`、`actionRegistry`、`connectorRegistry`、`valueStore`。health 执行抛错时，所有核心组件输出为 `unavailable`，错误消息经过脱敏。

readiness 为 ready 必须同时满足：Worker 已 ready、未 stopped、未 draining、未 degraded、正在 accepting、至少一个 lane enabled，并且所有 required components 为 `ready` 或 `disabled`。

status 的总体状态按以下优先级选择：`stopped` → `draining` → `degraded` → `ready` → `starting`。输出包含 Worker metadata、lane、active Attempt、active poll、近期错误和 drain 信息；`registrationGeneration` 始终为 `null`。

capabilities 输出 enabled lanes、`genericCapabilities`、workflow/action/connector manifest evidence，以及默认限制：

| 字段 | 默认值 |
|---|---:|
| `maxConcurrency` | `1` |
| `maxInlineValueBytes` | `1048576` |
| `maxJobRuntimeMs` | `null` |

metrics 输出 Prometheus text，包括 Worker ready、accepting、active Attempts、active polls、drain，以及每 lane 的 active Attempts、polls、claim、poll duration 和 poll total。lease renewal、Gateway request 和 Attempt totals 是 unknown/zero 占位，不代表真实累计计数。

## 状态与持久化

服务在内存中维护 `ready`、`acceptingWork`、`draining`、`stopped`、`registeredAt`、`lastHeartbeatAt`、`activePolls`、`activeAttempts` map、`recentErrors`、`currentDrain`、`healthDegraded` 和 `degraded`。

lane 状态包括配置 slot、enabled 状态、活动和可接收 slot、poll/claim 次数与时间，以及最近错误。`beginPoll` 增加 `activePolls` 和 `pollCount`，并更新 lane 的 `activeSlots`、`acceptingSlots`、`idleSlots`、`lastPollAt`；`endPoll` 对应减少活动计数。

drain 记录只保存在当前进程内存中，最多保留 20 条历史。进程退出或服务重建后不会恢复 drain、幂等键、活动计数或近期错误。

## 状态转换

Worker 主状态转换遵循以下约束：

- 初始状态不是 ready；调用 `markReady` 后进入可 ready 状态，并在未 draining 时开始 accepting。
- `markHeartbeat` 只更新时间，不改变 active poll 或 active Attempt。
- `markStopped` 进入 stopped，关闭 ready、accepting 和 draining 标志，但保留尚未由 `finishAttempt` 删除的 active Attempts。
- status 状态选择严格采用 `stopped`、`draining`、`degraded`、`ready`、`starting` 的优先级。

首次 `requestDrain` 返回 `202` 的 `accepted` 快照，立即设置 `acceptingWork=false` 并进入内部 draining 状态。快照记录请求发生时的 `activeAttemptIds` 和 `activePollCount`。

同一 `Idempotency-Key` 且 reason/deadline 相同的请求返回已有快照：未终态返回 `202`，终态返回 `200`。同一 key 修改命令返回 `409`。已有其他 drain 正在执行时返回 retryable `409`；Worker 已 stopped 时也返回 `409`。

`executeDrain` 等待 active polls 和 active Attempts 都变为零。达到 deadline 时转为 `timed_out`，保留剩余 active IDs/count，并设置 `resourcesClosed=false`；它不会宣称这些 Attempts 已关闭。全部清零后调用 `onDrain`：成功转为 `succeeded` 且 `resourcesClosed=true`；异常转为 `failed` 并记录错误。

## 副作用

`beginPoll`、`endPoll`、`recordClaim`、`registerAttempt`、`finishAttempt` 和 drain 操作会修改当前进程内存状态及指标输出。

`endPoll` 收到 error 时记录脱敏的 lane FailureSnapshot 和 `recentErrors`；无 error 时清除该 lane 的错误。`recordClaim` 更新 `lastClaimAt` 和 `claimCount`。

成功排空后调用 `onDrain`。在 Worker main 集成中，该回调触发 main shutdown。Admin server 的 `start` 创建独立 `node:http` 监听端口，`close` 关闭该监听器。

## 错误与降级

JSON 解析失败、body 不是 object、缺少或非法字段返回 `400`；请求体超限返回 `413`；未知路由或不存在的资源返回 `404`；drain 幂等冲突、并发 drain 或 stopped 冲突返回 `409`；未分类内部错误返回 `500`。

错误响应 DTO 包含 `code`、`message`、`retryable`。内部异常和 health 异常对外输出前进行消息脱敏，不直接承诺暴露原始异常内容。

health 覆盖抛错时，readiness 将所有核心组件标记为 `unavailable`，从而不能通过 required-component 条件。liveness 不随 stopped、draining 或 readiness 降级而失败。

deadline 到期属于可观察的 `timed_out` 终态，不会强制删除 active Attempts、伪造活动已结束或把 `resourcesClosed` 标记为 true。

## 依赖

运行时直接依赖 Node.js `node:http` 提供独立 HTTP server，并依赖进程内时钟、计数器、Map 和回调完成状态维护。

readiness 的外部组件信息来自可选异步 health 提供者；`onDrain` 由宿主注入。Worker main 负责把 Admin drain 回调接到自身 shutdown，但 `WorkerAdminService` 不拥有任务执行器、Attempt 生命周期或容器编排器。

当前证据没有显示 Redis、Gateway 服务、远程控制面或其他主机参与 Admin 状态协调。

## 配置

| 配置 | 默认值或约束 |
|---|---|
| lane | 一个 `direct` lane |
| `configuredSlots` | 默认 `1`；必须是正安全整数 |
| Admin host | server 需满足无授权时仅 loopback；Worker main 默认 `127.0.0.1` |
| Admin port | `9091` |
| `maxBodyBytes` | `64 KiB` |
| `authorize` | 可选；提供时覆盖所有 endpoint |
| Worker main token | 非空时精确匹配 `Authorization: Bearer token` |
| drain `deadlineMs` | `30000`；`null` 为无限；最大 `86400000` |
| drain history | 最多 20 条内存记录 |
| capability `maxConcurrency` | `1` |
| capability `maxInlineValueBytes` | `1048576` |
| capability `maxJobRuntimeMs` | `null` |

## 重建验收

1. 给定未传 lane 的新服务→观察到一个 enabled 的 `direct` lane 且 `configuredSlots=1`→且不发生额外 Gateway 或远程注册。
2. 给定重复 lane 或非正安全整数的 `configuredSlots`→观察到构造立即抛错→且不发生带非法配置的服务启动。
3. 给定服务已 `markReady` 且至少一个 lane enabled→观察到 `canAcceptWork` 为 true→且不把 stopped、draining 或 disabled-only 状态视为可接收。
4. 给定一次成功的 `beginPoll` 与对应 `endPoll`→观察到全局及 lane poll/slot 计数先增后减→且不自动创建 active Attempt。
5. 给定显式 `registerAttempt` 后再调用 `finishAttempt`→观察到 `activeAttemptCount` 先增后减且与 `activePollCount` 分开→且不由 poll 数量推导 Attempt 数量。
6. 给定 `endPoll` 带错误→观察到脱敏 FailureSnapshot 和 recent error→且不泄露未经处理的内部错误；给定无错误结束→观察到 lane error 被清除→且不保留该 lane 的旧错误。
7. 给定 health 覆盖正常返回→观察到 readiness 使用对应组件状态→且不把 manifest evidence 当成组件健康；给定 health 抛错→观察到所有核心组件为 `unavailable`→且不返回 ready。
8. 给定 Worker 已 stopped→观察到 status 为 `stopped`、readyz 不通过，而 healthz 仍输出 `alive`→且不把 stopped 映射成 liveness 失败。
9. 给定合法 drain 请求和新的幂等键→观察到 `202 accepted`、立即停止 accepting，并记录当时 active IDs/count→且不立即宣称资源已关闭。
10. 给定相同 key、reason 和 deadline 的重复 drain 请求→观察到返回原快照且 HTTP 状态由是否终态决定→且不创建第二条 drain。
11. 给定同 key 但命令变化，或另一 drain 正在执行，或 Worker 已 stopped→观察到 `409` 错误 DTO→且不覆盖或并行执行现有 drain。
12. 给定 drain deadline 到期且仍有 active poll 或 Attempt→观察到 `timed_out`、保留剩余活动信息且 `resourcesClosed=false`→且不删除 Attempt 或声称排空成功。
13. 给定活动全部清零且 `onDrain` 成功→观察到 `succeeded` 和 `resourcesClosed=true`→且不在活动未清零时提前调用成功结果。
14. 给定 `onDrain` 抛错→观察到 `failed` 和脱敏错误→且不返回 `succeeded`。
15. 给定超过 `maxBodyBytes` 的请求体、非法 JSON 或未知路由→分别观察到 `413`、`400` 或 `404`→且不执行 drain。
16. 给定无 `authorize` 且绑定非 loopback host→观察到 server 构造失败→且不开放未授权的外部监听。
17. 给定配置静态 token→观察到仅精确的 `Authorization: Bearer token` 通过 Worker main 授权→且不接受近似、前后附加或其他 scheme。
18. 给定 metrics 请求→观察到真实的当前 gauge/lane poll 数据和 unknown/zero 占位项→且不把 lease renewal、Gateway request 或 Attempt totals 描述为真实累计指标。
19. 给定重复 `start` 或未 listening 时调用 `close`→观察到调用直接返回→且不创建重复监听器或因未监听而执行关闭失败。
20. 给定 Admin drain 触发 Worker main shutdown→观察到 `onDrain` 被调用→且不据此推断 main 已等待真实运行中 Attempts、完成 SIGTERM 协调或通过容器编排验收。

## 实现与测试锚点

- `packages/worker-admin/src/index.ts`：`WorkerMode`、`ComponentStatus`、`WorkerAdminService`、lane 校验与默认值、ready/heartbeat/stopped 状态、poll 与 Attempt 分离、readiness/liveness/status/capabilities/metrics、drain 状态机、授权边界、HTTP 路由、请求体限制及独立 `node:http` server。
- `packages/worker-admin/src/index.test.ts`：默认 lane 与构造校验；ready、heartbeat、stopped 和接收条件；poll/claim 计数与错误脱敏；显式 Attempt 登记及 poll/Attempt 分离；组件 health 覆盖和异常降级；status 优先级与 liveness；能力证据和默认 limits；Prometheus 指标及 unknown/zero 占位；drain 参数校验、幂等、冲突、成功、失败、超时和历史上限；HTTP 路由、状态码、body 限制、授权、非 loopback 防护及 server 生命周期。
- Worker main 集成证据：默认 `127.0.0.1`、精确 Bearer token 检查，以及 Admin `onDrain` 调用 main shutdown。该锚点只证明调用关系，不证明 Attempt 执行器或操作系统信号层面的完整排空。

## 非目标/边界

- 不提供已实现的 Gateway 数据面、Gateway 请求执行、Gateway 会话协调或远程 Admin 能力；相关 mode、健康项、证据字段和占位指标仅是本地模型。
- 不使用 Redis，不提供多主机状态共享、分布式锁、主从协调、跨进程 drain 幂等或远程 drain。
- 不持久化 drain 历史、幂等键、active Attempts、active polls、错误或注册状态。
- 不提供真实 lease renewal、Gateway request 或 Attempt total 累计指标；现有对应值是 unknown/zero 占位。
- 不自动发现真实运行中的 Attempt；只有 `registerAttempt` 明确登记的 Attempt 才参与 Admin drain。
- `markStopped` 不替调用方结束 Attempt，deadline 超时也不强制取消或关闭 Attempt。
- Admin `onDrain` 会触发 main shutdown，但 main 本身不等待真实 Attempts；当前测试不能证明活跃 Attempt 遇到 deadline 后的 SIGTERM 行为。
- Worker Admin 测试只证明内存服务和本地 HTTP 行为，未验证跨进程通信、多主机部署、操作系统信号竞态或容器编排生命周期。
