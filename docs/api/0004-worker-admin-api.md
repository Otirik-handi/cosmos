# Worker Admin API 草案

> 状态：Convergence draft v0.2；`feat/t07-activity-host` dirty worktree 已实现 direct mode
> 的独立 loopback Admin host、探针、状态、能力、指标和 drain；当前仍未 commit/merge。
> 2026-08-16 的 focused/full 验证和最终 Node durable smoke PASS 已记录在 Task 07 文档；Docker、
> browser/e2e 和真实来源仍未完成；Gateway/remote Worker 仍未实现。

> 基础路径：`/admin/v1`
>
> 公共约定：[`0001-common-contracts.md`](0001-common-contracts.md)

## 1. 责任

Worker Admin API 是单个 Worker 进程的内部运维面，供容器探针、编排器和运维工具
使用。它不属于 Web/CLI 的 Product API，也不是任务 Transport。

它负责：

- process liveness；
- execution readiness；
- 当前 mode、lane、slot、manifest 和 Backend/Gateway 状态；
- 指标；
- graceful drain。

它不负责：

- 通过 HTTP 指定某个 Job 立即执行；
- 暴露 Job input/output、Secret、session token 或 lease token；
- 调用任意 Connector、脚本、shell 或 Agent；
- 修改 Cosmos 领域对象；
- 取代 TaskStore claim。

## 2. 暴露方式

- Worker Admin 使用独立端口，不能与 Product API 共用 Router。
- 默认绑定 loopback；容器模式可显式绑定 pod/container 内部地址。
- `/healthz` 和 `/readyz` 可以供探针访问。
- `/admin/v1/*` 和 `/metrics` 的远程认证策略后置，但实现时必须保留独立 middleware
  边界，不能假定它们永远暴露公网。
- 非 loopback/container-internal 绑定必须显式配置认证和网络策略；Product API 的
  身份不能自动获得 Admin drain 权限。
- 配置关闭 Admin Server 时，Worker 执行能力不受影响；但生产编排必须使用其它可
  验证的探针。

## 3. 端点

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Convergence | `GET` | `/healthz` | `WorkerLivenessSnapshot` |
| Convergence | `GET` | `/readyz` | `WorkerReadinessSnapshot`；未 ready 返回 `503` |
| Convergence | `GET` | `/admin/v1/status` | `WorkerStatusSnapshot` |
| Convergence | `GET` | `/admin/v1/capabilities` | `WorkerCapabilitySnapshot` |
| Convergence | `GET` | `/admin/v1/drains` | 当前/近期 drain page |
| Convergence | `POST` | `/admin/v1/drains` | `202 WorkerDrainSnapshot` |
| Convergence | `GET` | `/admin/v1/drains/{id}` | drain 进度 |
| Reserved | `POST` | `/admin/v1/drains/{id}/deadline-extensions` | 受控延长期限 |
| Convergence | `GET` | `/metrics` | Prometheus text exposition |

不提供 `resume`。默认 drain 成功后 Worker 退出，由服务管理器重新启动；如果未来
需要不退出的 pause/resume，应建立独立状态机和决定，不能把 drain 语义改掉。

## 4. DTO

```ts
type WorkerMode = "direct" | "gateway";

type WorkerLivenessSnapshot = {
    status: "alive";
    service: "cosmos-worker";
    workerId: string;
    instanceId: string;
    version: string;
    processStartedAt: string;
    timestamp: string;
};

type WorkerReadinessSnapshot = {
    ready: boolean;
    workerId: string;
    instanceId: string;
    mode: WorkerMode;
    acceptingWork: boolean;
    draining: boolean;
    components: {
        migration: ComponentHealth;
        taskStore?: ComponentHealth;
        gatewaySession?: ComponentHealth;
        definitionCatalog: ComponentHealth;
        actionRegistry: ComponentHealth;
        connectorRegistry: ComponentHealth;
        valueStore: ComponentHealth;
    };
    checkedAt: string;
};

type WorkerLaneStatus = {
    lane: string;
    enabled: boolean;
    configuredSlots: number;
    acceptingSlots: number;
    activeSlots: number;
    idleSlots: number;
    lastClaimAt: string | null;
    lastPollAt: string | null;
    lastError: FailureSnapshot | null;
};

type WorkerActiveAttemptSummary = {
    attemptId: string;
    jobId: string;
    runId: string;
    actionRef: string;
    lane: string;
    slot: number;
    startedAt: string;
    leaseExpiresAt: string;
    cancellationRequested: boolean;
};

type WorkerStatusSnapshot = {
    workerId: string;
    instanceId: string;
    registrationGeneration: number | null;
    version: string;
    mode: WorkerMode;
    status: "starting" | "ready" | "draining" | "stopped" | "degraded";
    processStartedAt: string;
    registeredAt: string | null;
    lastHeartbeatAt: string | null;
    lanes: WorkerLaneStatus[];
    activeAttempts: WorkerActiveAttemptSummary[];
    /** Only explicitly registered runtime Attempts; active polls remain separate. */
    activeAttemptCount: number;
    activePollCount: number;
    recentErrors: FailureSnapshot[];
    drain: WorkerDrainSnapshot | null;
    timestamp: string;
};

type WorkerManifestEvidence = {
    ref: string;
    manifestHash: HashRef;
};

type WorkerCapabilitySnapshot = {
    workerId: string;
    instanceId: string;
    version: string;
    mode: WorkerMode;
    evidenceVersion: number;
    evidenceAuthority: "local_executable" | "catalog_admitted";
    lanes: string[];
    genericCapabilities: string[];
    workflowEvidence: WorkerManifestEvidence[];
    actionEvidence: (WorkerManifestEvidence & {
        executionPlacements: ("host" | "trusted_worker" | "remote_worker")[];
    })[];
    connectorEvidence: WorkerManifestEvidence[];
    limits: {
        maxConcurrency: number;
        maxInlineValueBytes: number;
        maxJobRuntimeMs: number | null;
    };
    generatedAt: string;
};

type CreateWorkerDrainCommand = {
    reason: string;
    deadlineMs?: number | null;
    exitAfterDrain?: true;
};

type WorkerDrainSnapshot = {
    id: string;
    workerId: string;
    instanceId: string;
    idempotencyKey: string;
    status:
        | "accepted"
        | "draining"
        | "succeeded"
        | "timed_out"
        | "failed";
    reason: string;
    activeAttemptIds: string[];
    /** Polls still inside beginPoll/endPoll; not an Attempt identity. */
    activePollCount: number;
    acceptedAt: string;
    deadlineAt: string | null;
    finishedAt: string | null;
    exitAfterDrain: true;
    resourcesClosed: boolean;
    error: FailureSnapshot | null;
};
```

`ComponentHealth`、`FailureSnapshot` 和 `HashRef` 从无 Product 依赖的 common
contracts 复用；Worker Admin 放在独立 package，不能因此依赖 Product DTO、Web 或
NestJS。

### 4.1 Active poll 与 Attempt identity

`activePollCount` 是 Worker Admin 对 `beginPoll` 到 `endPoll` 生命周期的观测：它统计仍在
执行的 poll，不表示已经领取了 Attempt。`activeAttemptCount`、`activeAttempts` 和 drain
快照中的 `activeAttemptIds` 只来自 runtime 明确注册的真实 Attempt，不能由 poll、slot、
Job ID 或计数推造。

当前 `apps/worker` 的 `pollOnce` 接口不暴露可安全注册的 Attempt identity，因此生产
状态中可能出现 `activePollCount > 0` 而 `activeAttemptCount = 0`；这是有意的保守边界，
不是漏报。Drain 原子停止新 poll，然后等待 active poll 与显式注册 Attempt；deadline
到达仍有任一项时返回 `timed_out`、保持 `resourcesClosed=false`，并保留剩余 poll 计数和
真实 Attempt IDs。没有真实 identity 时不得伪造 Attempt ID，也不得声称 drain 等待某个
Attempt。

## 5. Readiness 语义

### 5.1 Direct mode

ready 必须满足：

- migration/schema compatible；
- TaskStore/Application/ValueStore 可用；
- executable manifests 已加载并完成本地校验；
- 至少一个 lane 启用；
- 未进入 drain；
- Supervisor 可以启动或继续 claim。

Redis/WakeupBus 不可用不能单独让 Direct Worker not ready；fallback polling 仍能
保证执行。它可以让状态 degraded 并暴露指标。

### 5.2 Gateway mode

ready 必须满足：

- Worker Gateway 协议协商成功；
- Session 未 fenced/expired；
- manifest evidence 已被接受或明确处于可 claim 状态；
- 至少一个 lane 有可用 slot；
- 未进入 drain。

短暂没有 Job 不是 not ready。没有 capable Definition 可以显示 degraded/idle，
但只有配置错误或 catalog incompatibility 才阻止对应 lane。

## 6. Drain 状态机

```text
accepted
  -> draining
      -> succeeded -> process exit 0
      -> timed_out -> process remains for explicit termination / exit 1
      -> failed    -> process exit 1 or operator action
```

执行顺序：

1. 原子切换 `acceptingWork=false`。
2. Direct mode 停止新 claim；Gateway mode 向 Session 报告 draining。
3. 继续为当前 Attempt 和 Gateway Session heartbeat，等待其成功、失败、取消或
   主动释放；draining Session 保持可验证，但不能 claim 新 Job。
4. deadline 到达时向可取消 Action 发出 cooperative abort。
5. 仍有活跃 Attempt 时不得假装 resources closed。
6. 全部 slot 收口后停止 registration heartbeat，记录 stopped，关闭
   Backend/HTTP/logger，并退出。

Attempt heartbeat 的新 expiry 不得超过 Run/Action/drain deadline。deadline 到达后
仍无法停止的 external Action 进入 lease-lost/late-evidence/reconcile，不能靠延长
Session TTL 假装 drain 成功。

重复相同 `Idempotency-Key` 返回同一个 Drain；不同 payload 冲突。

Drain 不主动把外部副作用伪装成失败。若 Action 已开始外部操作而无法确认结果，
必须留下 `unknown` Receipt/Attempt 状态供 reconcile。

## 7. Metrics 基线

至少预留：

```text
cosmos_worker_ready
cosmos_worker_accepting_work
cosmos_worker_active_attempts{lane,action_ref}
cosmos_worker_active_polls{lane}
cosmos_worker_claim_total{lane,result}
cosmos_worker_attempt_total{action_ref,status}
cosmos_worker_attempt_duration_seconds{action_ref,status}
cosmos_worker_lease_renew_total{result}
cosmos_worker_gateway_request_total{operation,result}
cosmos_worker_poll_duration_seconds{lane}
cosmos_worker_drain_total{status}
```

标签不能包含 Source 名称、用户输入、URL、SecretRef、Job ID 或其它高基数/敏感值。
Job/Run 精确关联留在结构化日志和 Product Query。

## 8. 错误与幂等

- Admin 写操作使用 `Idempotency-Key`。
- `409 drain_in_progress`：已有不同 drain 正在执行。
- `409 already_stopped`：进程已进入不可逆 stop。
- `503 not_ready`：状态可查询，但当前不能承担执行。
- `503 backend_unavailable` / `gateway_unavailable`：按 mode 区分。
- `504 drain_timeout`：返回持久/内存 DrainSnapshot，不只返回字符串。

Admin Error 不回传 stack、token、Action input 或上游正文。

## 9. 当前实现与验证边界

当前 dirty `feat/t07-activity-host` 已有 direct mode 的独立 loopback HTTP Admin host、
`/healthz`、`/readyz`、status、capability、metrics 和 drain；实现不依赖 Product API、
Prisma 或 Connector executable。当前 contract regression 为 4 files/47 tests，full
Vitest 为 23 files/165 tests；最终 Node durable smoke 也 PASS，但这些证据仍不是 Docker、
browser/e2e、真实来源或 Task 07 完成证明。

最终 Node smoke 的完整命令与边界如下：

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'C:\Users\notnotype\Documents\CodeRepository\GithubProjects\cosmos\.worktree\t07-activity-host\scripts\smoke-node.ps1'"
cwd=C:/Users/notnotype/Documents/CodeRepository/GithubProjects/cosmos/.worktree/t07-activity-host
exitCode=0 wallTime=7.04s
fresh db:migrate: 6 migrations applied
  20260808003247_phase1_foundation
  20260808150000_collector_jobs
  20260810020829_normalized_content_model
  20260813160000_workflow_run_backend
  20260814090000_workflow_activity_host
  20260815090000_workflow_ingest
healthWorker=ready queuedStatus=queued durableRunStatus=succeeded durableRunSourceId=<source>
feedItems=3 searchItems=1 storyTitle=Fixture media metadata
sseHasRunEvent=true sseHasFeedEvent=true
apiStructuredRecords=21 workerStructuredRecords=33 durableLaneCompletedRecords=1
requestIdBridgedToDurableRun=1 requestIdBridgedToProbe=1 probeWorkerRecords=6
notFoundStatus=404 validationStatus=400
```

终端 JSON 成功输出表示 log redaction/serialized `undefined` 断言通过。`run.queued.v1` 是由
当前 build 后的 dist 持久化并经 SSE 回放的新 durable event；此前缺 event 是 stale dist 的
历史失败证据，不能归因于当前代码。

状态/Drain 中的 `activePollCount` 是 `beginPoll` 到 `endPoll` 的在途 poll 数量；
`activeAttemptCount`、`activeAttempts` 和 `activeAttemptIds` 只表示 runtime 明确注册并提供
真实 identity 的 Attempt。当前 `apps/worker` 的 `pollOnce` 不暴露安全 Attempt identity，所以
不能伪造 ID，也不能把 active poll 解释为 active Attempt。Drain 停止新 poll，等待 active poll
和显式注册 Attempt；deadline 到达仍有任一项时为 `timed_out`、`resourcesClosed=false`，保留
剩余计数/真实 ID。

最终 Node smoke 不改变上述 API 功能合同，也不覆盖 SIGTERM、活跃 Attempt deadline、Docker、
browser/e2e、真实来源、Gateway 或远程认证；这些仍需单独验证。当前 worktree 仍 dirty、未
提交、未 merge，不标记 Task 07 或生产完成。
