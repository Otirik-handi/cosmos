# Worker Admin API 草案

> 状态：Convergence draft v0.2；`5ce628690ab0110b0525e8ebcbacbe673ced9c55` 已合入 direct mode
> 的独立 loopback Admin host、探针、状态、能力、指标和 drain；本文件保留未来 Gateway mode
> 与认证/部署边界，不等于稳定公共合同。
> 2026-08-16 的 focused/full 验证和最终 Node durable smoke PASS 已记录在 Task 07 文档；Docker、
> browser/e2e、真实来源、跨进程 recovery、Worker Admin SIGTERM/活跃 Attempt deadline 和
> Gateway/remote Worker 仍未完成或未验证。

> 基础路径：`/admin/v1`
>
> 公共约定：[`0001-common-contracts.md`](0001-common-contracts.md)
>
> 合入实现规格：[`../spec/README.md`](../spec/README.md)；Worker Admin 组件规格：
> [`../spec/runtime/0003-worker-admin.md`](../spec/runtime/0003-worker-admin.md)

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

- Worker Admin 使用独立 Node `http` 端口，不能与 Product API 共用 Router；Worker 生产入口默认
  `127.0.0.1:9091`，可由 `COSMOS_WORKER_ADMIN_HOST`、`COSMOS_WORKER_ADMIN_PORT` 覆盖。
- 默认绑定 loopback；绑定到 loopback 之外时 `createWorkerAdminServer` 要求显式授权回调，
  当前 Worker 入口通过可选 `COSMOS_WORKER_ADMIN_TOKEN` 提供 Bearer 校验。
- `/healthz`、`/readyz` 和 `/metrics` 以及 `/admin/v1/*` 由该独立 host 提供，不能假定它们
  与 Product API 的全局 prefix 或认证中间件共享。
- 当前 direct mode Worker Admin 已接线；Gateway mode、远程认证策略和容器编排探针仍是后置
  设计/验证边界。
- 配置关闭 Admin Server 时，Worker 执行能力不受影响；但生产编排必须使用其它可验证的探针。

## 3. 端点

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Current · direct mode | `GET` | `/healthz` | `WorkerLivenessSnapshot` |
| Current · direct mode | `GET` | `/readyz` | `WorkerReadinessSnapshot`；未 ready 返回 `503` |
| Current · direct mode | `GET` | `/admin/v1/status` | `WorkerStatusSnapshot` |
| Current · direct mode | `GET` | `/admin/v1/capabilities` | `WorkerCapabilitySnapshot` |
| Current · direct mode | `GET` | `/admin/v1/drains` | 当前/近期 drain page |
| Current · direct mode | `POST` | `/admin/v1/drains` | `202 WorkerDrainSnapshot`；幂等重放可返回 `200` |
| Current · direct mode | `GET` | `/admin/v1/drains/{id}` | drain 进度 |
| Reserved | `POST` | `/admin/v1/drains/{id}/deadline-extensions` | 受控延长期限 |
| Current · direct mode | `GET` | `/metrics` | Prometheus text exposition |

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

- 已实现 direct HTTP 行为：缺少/失败授权返回 `401`；无效 JSON、缺少 `Idempotency-Key`、非法 drain
  参数返回 `400`；未知端点或 drain 返回 `404`；不同 drain/已停止返回 `409`；请求体超过上限返回
  `413`；未 ready 的 `/readyz` 返回 `503`。当前 drain 超时记录在 `WorkerDrainSnapshot.status=
  "timed_out"`，不由已实现的 HTTP host伪造 `504`。
- `503 backend_unavailable`、`gateway_unavailable` 和 `504 drain_timeout` 可作为未来 mode/Transport
  约定保留，但不是当前 direct HTTP 实现的必然响应。

Admin Error 不回传 stack、token、Action input 或上游正文。

## 9. 当前实现与验证边界

合入基线 `5ce628690ab0110b0525e8ebcbacbe673ced9c55` 已包含 direct mode 的独立 loopback HTTP
Admin host、`/healthz`、`/readyz`、status、capability、metrics 和 drain；实现位于独立
`@cosmos/worker-admin` package，不依赖 Product API、Prisma 或 Connector executable。Worker
入口默认监听 `127.0.0.1:9091`，通过 `beginPoll/endPoll` 观测 poll，通过显式 Attempt 注册观测
真实 Attempt；没有 identity 时不得伪造 Attempt ID。Worker 默认 Durable Host、manifest evidence
和 Admin 装配见 `apps/worker/src/main.ts`。

Task 07 的 focused contract regression 为 4 files/47 tests，full Vitest 为 23 files/165 tests，
typecheck/lint/build/db gates 和最终 Node durable smoke 已记录 PASS。实现规格和测试锚点见
[`../spec/runtime/0003-worker-admin.md`](../spec/runtime/0003-worker-admin.md) 与
[`../spec/README.md`](../spec/README.md)。

最终 Node smoke 的可观察结果包括：6 条 migration 应用成功，`healthWorker=ready`、
`queuedStatus=queued`、`durableRunStatus=succeeded`、`feedItems=3`、`searchItems=1`、Run/Feed
SSE 事件、requestId bridge 以及 HTTP `404`/`400`；日志脱敏和无 serialized `undefined` 断言通过。

以下仍未验证或未实现：Docker 容器、browser/e2e、真实 RSS/Bilibili/OpenCLI、完整 parity、跨进程
recovery、双 Worker 长时 fencing、Worker Admin SIGTERM/活跃 Attempt deadline、Gateway/remote
Worker、Redis、多主机和远程认证。`activePollCount` 与真实 Attempt 分离、drain timeout 的
`resourcesClosed=false` 语义已由 focused Worker Admin 测试覆盖，但不替代这些边界验证。
