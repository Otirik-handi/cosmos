# Workflow Host Store（`PrismaWorkflowHostStore`）

## 状态

当前实现规格；后续代码变化应同步更新本文。本文是 Prisma Host 持久边界的实现合同；Run/Activity/Completion 公共类型与状态名以 [`../application/0007-workflow-host-contract.md`](../application/0007-workflow-host-contract.md) 为唯一 owner，本文只说明 SQL 条件、事务、fence、投影和恢复行为。

## 最后更新

2026-08-18

## 组件定位

`PrismaWorkflowHostStore` 将 Host 的 Workflow Envelope、Run lease、Activity Job 和 Completion 持久化到 `WorkflowRun`、`Job`、`WorkflowCompletion` 与 `DomainEvent`。它是 Kernel Runner、Activity worker、Completion dispatcher 和 application Host runtime 的 durable source of truth；内存 wakeup、进程存活和 worker loop 都不能替代这些行。

legacy `Run`/`Job` lane 仍由 `PrismaCosmosRepository` 拥有；本组件只处理 `WorkflowRun` 关联且 `kind = "workflow-activity"` 的 Job，不会把 Activity Job 交给 legacy claim。`PrismaWorkflowBackend` 负责同一 WorkflowRun 的 Kernel state CAS，本组件只在需要时读取/验证它并保存 Host projection。

### 在系统中的位置与作用
它是 Workflow Host 的 durable source of truth，负责把 Envelope、Run lease、Activity Job 和 Completion 落到 Prisma 表，并服务于 Runner、Activity worker、Completion dispatcher。

### 解决的问题
它让工作在进程重启后仍有可查询的领取、租约、重排和恢复依据，并以 token/expiry fencing 阻止过期持有者继续写入。

### 使用方式
Host runtime 按 port 先 claim，再在 lease 内 renew/complete/requeue；Kernel state CAS 交给 `PrismaWorkflowBackend`，一般 Workflow event 交给 `PrismaWorkflowEventSink`，legacy Job 仍由 Repository 管理。

### 典型情景
Worker 启动后领取 queued Run、Activity 或 Completion，或需要根据 durable 行恢复未完成工作时，选择本组件。


## 概念与定义

- **Envelope（Workflow 外壳）**：`WorkflowRun` 中的 runId、Definition key/version/manifestHash、immutable inputSnapshot、productRun snapshot、Host status/resumeRequired/时间、可选 idempotencyKey、可选 `sourceInstanceId` 和失败时的 `errorMessage`；Kernel 采用前由 marker 占据 stateJson。
- **Run claim**：`claimRun` 获得 `{runId, owner, leaseToken, leaseExpiresAt}`。`purpose` 有 `execution`、`activity`、`completion` 三类；三者共享同一 Run lease 字段，但候选和可否改变 status 不同。
- **Activity Job/Attempt**：Job 是一个 pending Activity 的 durable SQL 行；每次 claim 递增 attempts 并产生一个 lease，生命周期事件由 `DomainEvent` 投影为 Attempt。Job payload 只含可 JSON 序列化的 Activity identity、Action ref、input、options、idempotencyKey 和可选 retryPolicy。
- **Completion**：每个 terminal Activity Job 至多一个 `WorkflowCompletion`（`jobId`、receipt 唯一），是单消费者 durable delivery record，不等于 Kernel 已接受；dispatcher 只有观察到 state 中相同 completion 且持有当前 Run lease 后才能标记 delivered。
- **双 fencing**：Activity 写入同时需要 Run lease owner/token/expiry、Job lease owner/token/expiry、claim 时保存的 `workflowKernelRevision` 和 pending Activity identity；Completion delivery 还需要 Completion lease 与当前 Run lease，并验证 Kernel state revision/receipt/fingerprint。
- **RetryPolicy**：Host 可从构造参数的 `actionRetryPolicies[Action ref]` 读取并把 policy/maxAttempts 持久化到 Activity Job；payload 中的 retryPolicy 是可审计快照，定义内容由 contracts/application owner 负责。

## 外部行为

### Envelope

`createWorkflowEnvelope(input)` 立即校验 runId、可选 idempotencyKey、Definition 三元组、inputSnapshot/productRun JSON、可选 `sourceId` 和 createdAt。事务内先按 idempotencyKey 查找，再按 runId 查找：同一 identity 返回已有 Envelope；同 key 绑定其它 identity 或同 runId 已存在其它 identity 抛 `WorkflowHostConflictError`。新行写入精确 marker `{"kind":"cosmos.workflow-envelope","version":1,"runId"}`、status=`queued`、kernelRevision=0、无 lease，并在同一事务写一次 `run.queued.v1`，其 idempotency key 为 `workflow-run:<runId>:queued`。`sourceId` 归一化后写入 `WorkflowRun.sourceInstanceId`，供来源状态投影使用。

唯一键竞争后会重新读取 winner 并重新校验 identity；找不到 durable winner 则抛 `WorkflowHostError("unavailable")`。`findWorkflowEnvelopeByIdempotencyKey` 缺失返回 null。`loadWorkflowEnvelope` 可读取 marker 或 adopted Kernel row，但会解析 state/projection 并在损坏时 fail closed；`hasWorkflowKernelState` 在 row 存在且 state 不是精确 marker 时返回 true。

### 三类 Run claim

`claimRun({owner, leaseMs, runId?, purpose?, now?})` 要求 owner 非空、leaseMs 是正整数、now 有效。`purpose` 默认 `execution`；`activity`/`completion` 必须指定 runId。

- `execution` 无指定 runId 时按 `(createdAt ASC,id ASC)` 扫描 status=`queued`、`running` 或 `waiting && resumeRequired`，且 lease 为空或已到期的 Run；指定 runId 只限该行。成功以条件 update 生成新 token/expiry，status 变为 `running`，保留 resumeRequired，startedAt 只在原值为空时设置。
- `activity`/`completion` 只针对指定 Run。非 terminal Run 可 claim；terminal Run 只有存在由同 owner 持有且未过期的 leased Completion 时才可作为辅助 delivery claim。Run lease 为空/完整过期时可接管；如果该 purpose 的相同 owner/token lease 仍有效，返回同一 lease；其它 owner 的有效 lease 返回 null。辅助 claim 不把 status 改为 running，但会在 startedAt 为空时写入 now。
- `heartbeatRun` 只允许 status=`running`/`waiting` 且 owner/token 匹配、expiry 严格大于 now；更新 expiry 并以行数 1 返回 true，否则 false。`releaseRun` 同样要求当前 owner/token 和未过期 lease，只清除三个 lease 字段，不改变 Run status。

### Activity Job

`startAction(request)` 规范化 Activity identity（key/path/kind/fingerprint 非空、seq 为非负 safe integer）、runId、versioned Action ref、JSON input/options 和 idempotencyKey。它读取该 WorkflowRun；缺失返回 `not_found`，terminal Run 返回 `conflict`。新 Job 在事务内使用随机 id、kind=`workflow-activity`、status=`queued`、workflowRunId、payloadJson canonical JSON、workflowKernelRevision=null、attempts=0、maxAttempts=`retryPolicy.maxAttempts` 或 3，并使用 request context idempotencyKey 的全局唯一约束。

重复 startAction 通过完整 identity canonical JSON 比较：相同 identity 对 queued/leased/retry_wait 返回同一个 pending receipt；succeeded 返回 `{status:"completed", result}`；failed_terminal/cancelled 仍返回同一 pending receipt，等待 durable Completion；不同 run、Activity identity、input/options、ref、fingerprint 或 retryPolicy 复用同 key 时抛 conflict。Job payload 不包含 executable schema、Run lease token 或 Host fence。

`claimActivityJob({owner, leaseMs, now?})` 只扫描 `workflow-activity`、所属 WorkflowRun 非 terminal 且 status 为 due queued/retry_wait 或已过期 leased 的 Job。若 Run 有其它 owner 的有效 Run lease，候选跳过；若 state 是 envelope marker，或 `pendingActivities` 中不存在同时匹配 key/path/seq/kind/fingerprint/reference/receipt 的条目，Job 留在 queued，不执行 orphan Activity。Activity payload/state JSON 损坏会抛 `serialization`，事务回滚且不会把该 Job 交给 worker。

若 attempts 已达到 maxAttempts，claim 在同一事务中将 Job 写为 `failed_terminal`，创建 status=`queued` 的失败 Completion，追加 `workflow.activity.failed_terminal.v1`，然后继续处理其它候选；该 Job 不作为 leased claim 返回。其它候选 update 条件包含原 status 和旧 lease（若候选原来 leased），成功后 status=`leased`、attempts 加一、保存当前 WorkflowRun.kernelRevision、owner/token/expiry，并写 `workflow.activity.leased.v1`。更新竞争失败跳过该候选。返回的 claim 包含 payload、kernelRevision、attempts/maxAttempts 和 lease，但 fence 不写入 payload。

`heartbeatActivityJob` 要求 Job kind/status、owner/token 匹配且 expiry > now，成功延长 expiry；`releaseActivityJob` 同样要求未过期当前 lease，成功后将 Job 置 `queued`、清 lease、nextAttemptAt=now，可写 errorCode=`lease_unavailable`/reason，并追加 `workflow.activity.released.v1`。旧 owner 返回 false。

### Activity terminal completion

`completeActivity` 在一个 transaction 内依次验证：Job 存在且 kind 正确；Job.workflowRunId 与 Run lease.runId 相同；terminal result 合法；Completion identity 与 payload 的 activityKey/receipt/reference/fingerprint 相同；Run 存在、未进入 completed/failed/cancelled 且 Run lease 当前；state 中 pending Activity 相同；Job.workflowKernelRevision 非空且等于 Run.kernelRevision；Job lease owner/token 未过期。

Job lease 失效、Run lease 失效、Run terminal、revision 改变、pending identity 消失或 fence 不匹配都返回 `{accepted:false, jobStatus, completion:null}`，不会写 Job/Completion。若已有同 Job Completion 且 incoming completion canonical identity 相同，允许重复调用返回 accepted；不同 completion 抛 conflict。

- `result.status = retry_wait`：completion 必须省略；Job 写 retry_wait、清 lease、nextAttemptAt=now+retryDelayMs（缺省 30 秒），追加 terminal lifecycle event，返回 accepted 且 completion=null。
- `succeeded`：必须提供 status=`completed`、有 JSON result、无 error 的 completion，且 result 与 Job result canonical 相等。Job 写 succeeded/result、清 lease，然后创建 status=`queued` Completion。
- `failed_terminal`：必须提供 status=`failed`、非空 error、无 result，且 error 与 Job error 相等；Job 写 failed_terminal/error 并创建失败 Completion。
- `cancelled`：Completion status 必须 cancelled 且不得有 result/error；Job 写 cancelled 并创建 Completion。

每个 Completion 初始 attempts=0、maxAttempts=5、availableAt=now、无 completion lease。Completion 创建因 jobId unique race 失败时读取 winner；同 identity 返回 winner，不同 identity conflict。

### Completion dispatcher

`claimWorkflowCompletion` 扫描 availableAt <= now 且 status=`queued` 或 leased expiry 已到期的 Completion，按 availableAt/createdAt/id 升序。达到 attempts 上限的记录仍由 dispatcher 领取；dispatcher 取得对应 Run lease 后调用 `deadLetterWorkflowCompletion`，再以当前 Run lease 调用 `failWorkflowRun`，避免 claim 阶段丢失 Run 失败投影。
`heartbeatWorkflowCompletion` 只接受当前 completion owner/token 且 expiry > now。`deliverWorkflowCompletion` 必须同时验证 Completion lease、当前 Run lease 和 Kernel 已接受的 completion identity；CAS false 返回 false，不得报告为成功。
`requeueWorkflowCompletion` 只接受当前未过期 Completion lease；未达 maxAttempts 时清 lease、status=`queued`、写 lastError、availableAt 默认按 attempt 指数退避（1s、2s、4s…上限 30s），也可传显式时间；达到上限由 dispatcher 的 dead-letter 路径处理。`deadLetterWorkflowCompletion` 要求当前未过期 lease，写 dead_letter/lastError 并清 lease。`failWorkflowRun({ runLease, error, now? })` 仅在 owner/token 未过期且 Run 非终态时 CAS 写入 `status=failed`、`errorMessage`、`finishedAt`，清除 lease 并幂等追加 `run.failed.v1`；stale lease/CAS false 不改变其它 owner。
`markResumeRequired` 只在非 terminal Run 的 current Run lease 下把 resumeRequired 设为 true。`listRunsForRecovery` 默认 limit=100，按 updatedAt/id 返回 queued/running/waiting 中 marker 行或 resumeRequired 行。

## 输入

- Envelope、Run lease、Activity request/payload、Completion、RetryPolicy 和错误 code 引用 [`../application/0007-workflow-host-contract.md`](../application/0007-workflow-host-contract.md) 及 contracts owner；本组件只校验并持久化，不重定义公共 DTO。
- 所有 input/product/payload/result/completion JSON 必须通过 `assertJsonValue`；canonical JSON 用于 identity 与冲突比较。options 必须是 object，undefined 字段被跳过；`timeoutMs` 若存在必须为非负 safe integer，option `key` 若存在必须是 string。
- leaseMs 必须是正 safe integer；id/owner/token/key/reference/fingerprint 等 required string 不能为空；日期必须有效。
- `retry_wait` 不得带 Completion；其它 terminal Job status 必须带与 payload/result/error 一致的 Completion。

## 输出

- Envelope 是 immutable snapshot、status、resumeRequired、时间和 Definition 的白名单对象；marker 只在 `loadWorkflowEnvelope` 输出，不进入 Kernel state。
- Run claim/Activity claim/Completion claim 只返回对应 lease 和内部 worker 数据；lease token 不进入 Job payload、Kernel state、Manifest 或公开 Product API。
- `startAction` 返回 pending receipt 或已完成 inline result；`completeActivity` 返回 accepted、最终 Job status 和 Completion（如创建）；heartbeat/release/deliver/requeue/deadLetter 返回 boolean。
- Attempts 由 DomainEvent lifecycle 持久事件重建为 application 的 `WorkflowAttemptSnapshot`；Host Store 本身不伪造 attempt 行，也不提供独立 Attempt 表。

## 状态与持久化

核心 schema 字段/约束如下：

| 表 | 关键字段 | 持久关系/约束 |
| --- | --- | --- |
| `WorkflowRun` | id、stateJson、kernelRevision、status、resumeRequired、definitionKey/version/manifestHash、idempotencyKey 唯一、inputSnapshotJson、productRunJson、`sourceInstanceId`、`errorMessage`、runLeaseOwner/token/expires、startedAt/finishedAt、created/updatedAt | 可选关联 SourceInstance；拥有 Workflow Job、Completion、Checkpoint、Workflow observations、Workflow events |
| `Job` | workflowRunId、workflowKernelRevision、kind/status、payload/result、idempotencyKey 全局唯一、attempts/maxAttempts、lease owner/token/expiry、nextAttemptAt/error | Activity Job 与 WorkflowRun 级联；legacy run/step 关联仍存在，legacy claim 通过 kind 白名单隔离 |
| `WorkflowCompletion` | id、workflowRunId、jobId 唯一、activityKey、receipt 唯一、reference/fingerprint、completionJson、status、attempts/maxAttempts、availableAt、lease/error/time | WorkflowRun/Job 删除级联；status/availableAt 和 workflowRunId 有索引 |
| `DomainEvent` | sequence、eventId、type/version/payload、aggregate、workflowRunId、idempotencyKey | `(workflowRunId,idempotencyKey)` 唯一；Activity lifecycle 和 queued event 使用它 |

WorkflowRun marker 的 stateJson 与 Host snapshot 是两个阶段：marker 表示 envelope-only；Kernel Backend adoption 后同一行 stateJson 变为实际 state，但 Host snapshot、source projection、errorMessage 和 lease 字段仍由本组件维护。
## WorkflowRun 来源投影

`WorkflowRun.sourceInstanceId` 是 nullable 的 durable 来源身份；创建 ingest envelope 时从 `sourceId` 写入。`toSourceSnapshot()` 同时读取 legacy `Run` 与 durable `WorkflowRun`，按创建/更新时间选择较新的 Run 投影，并从 `WorkflowRun.errorMessage` 读取 `lastError`。因此来源查询不会只依赖 legacy Run，也不会把错误文本从 Kernel `stateJson` 猜出。Migration `20260818000000_workflow_run_source_projection` 在 fresh 数据库和已有 Host 数据上 forward-only 增加 `sourceInstanceId`、`errorMessage` 及来源/时间索引。

## 状态转换

### Run

`queued → running` 由 execution claim；`running`/`waiting` 可由 execution claim 重新获得过期 lease；`waiting` 只有 resumeRequired 才参与 execution 扫描；`completed`、`failed`、`cancelled` 为 terminal，不能 startAction 或 Activity claim。activity/completion purpose 不把 status 改为 running。Lease 的获取/接管不改变 Kernel revision。

### Activity Job

`queued → leased → succeeded | retry_wait | failed_terminal | cancelled`；`retry_wait` 到 nextAttemptAt 后可再次 leased；leased expiry 后可被其它 owner 接管。`releaseActivityJob` 是 leased → queued。orphan/marker/pending identity 不匹配时保持 queued。Activity maxAttempts 的失败 Job 在 claim 阶段转为 `failed_terminal` 并创建 queued 失败 Completion，不在 claim 阶段返回 leased。

### Completion

`queued → leased → delivered`；leased 到期可重新 claim；leased 可 `requeue` 回 queued 或 `dead_letter`；达到 maxAttempts 的 claim/requeue 进入 dead_letter。delivered/dead_letter 不再被 claim。Completion delivery 不以 Run terminal 单刀切，条件是 Kernel 已接受且 Run lease 当前。

### 幂等与不可逆边界

Envelope key、Activity Job idempotencyKey、Completion jobId/receipt 和 DomainEvent `(workflowRunId,idempotencyKey)` 都有显式查重/唯一约束。相同 identity 的重复调用返回 durable winner；不同载荷 conflict。没有 exactly-once 执行保证，Activity/Completion 是 at-least-once worker 语义。

## 副作用

- Envelope 创建、Job claim/terminalize、Activity completion、Completion claim/delivery/requeue/dead-letter 都使用 Prisma transaction，状态更新和对应 lifecycle/queued event 在同一 transaction 内。
- 每次 Activity claim/release/terminalize 追加 `workflow.activity.<status>.v1`，Event payload 可包含 owner/attempt/leaseExpiresAt/error，但不包含 lease token；Run envelope 创建追加 `run.queued.v1`。
- Activity payload、result、completion 和 snapshots 以 canonical JSON 保存；读取时重新解析/校验并 structured clone。
- logger 只记录 resume_required、max attempts 等运营信息；不把内存 poll、HTTP 或日志当作 durable 状态。

## 错误与降级

- 输入字段/日期/leaseMs/JSON 非法：`WorkflowHostError(code="invalid_state" 或 "serialization")`。
- 缺失 WorkflowRun/Job/Completion：`not_found` 或返回 null/false，取决于入口；unique race 无 winner：`unavailable`。
- idempotency、Envelope、Activity identity、Completion identity、result/error mismatch：`WorkflowHostConflictError`/`code="conflict"`。
- lease/token/expiry、Run status、kernel revision、pending Activity 不匹配：Activity completion 返回 `accepted=false`；Run/Event helper 以 `lease_lost` fail closed；不会降级成无 fence 写入。
- claim 竞争更新行数为 0 时跳过候选/返回 null；Completion 超过 maxAttempts 进入 dead_letter，不无限重试。
- marker/orphan Job 不会被执行；它保留给 Run recovery，需后续 Kernel state adoption 后再 claim。

## 依赖

依赖 Prisma Client/SQLite、`@notnotype/nb-workflow` 的 Activity/JSON/fingerprint 类型、`@cosmos/application` Host ports/lease/error、`@cosmos/contracts` RetryPolicy。Workflow Backend 负责 Kernel state CAS；EventSink 负责在 Run lease 下写一般 Workflow event；Repository 负责 legacy Run/Job 与领域写入。

## 配置

构造参数接收 PrismaClient、可选 LoggerPort 和 `actionRetryPolicies: Record<ActionRef, RetryPolicy>`。未找到 ref policy 时 Activity Job 使用 maxAttempts=3；Completion maxAttempts 固定为 5。leaseMs、retryDelayMs、completion availableAt 由调用者传入或使用实现默认（Activity retry 30 秒、Completion backoff 固定 1 秒）。数据库必须先应用 Host migrations，包括 `20260814090000_workflow_activity_host`、`20260815090000_workflow_ingest` 和 `20260818000000_workflow_run_source_projection`；没有独立环境变量或跨数据库配置。

## 重建验收

1. 创建 Envelope 后检查同一事务结果：WorkflowRun 是 marker、status=`queued`、无 Run lease，并且同 runId 只有一个 `run.queued.v1`；同 idempotency key 重放返回相同 Envelope，不同 snapshot 返回 conflict。
2. 让两个 owner 竞争一个 queued Run；只有一个获得 execution lease，另一方为 null；让 lease 过期后新 owner 接管，旧 owner heartbeat/release 返回 false。
3. 在 state 没有 pending Activity 时调用 startAction 后 claim；Job 保持 queued 且 claim 为 null。Kernel 写入精确 pending identity 和 receipt 后，claim 才返回 leased，并保存当前 kernelRevision。
4. 同一 Activity request 调用 startAction 两次返回同 receipt；改变 input/ref/fingerprint 复用 key 必须 conflict；成功 completion 后重放 startAction 返回同一 result。
5. 对当前 Job 用正确 Run lease+Job lease+revision 提交 succeeded；Job 变 succeeded、Completion 恰有一行 queued，重复 complete 返回同一 Completion，修改 completion result 必须 conflict；retry_wait 不创建 Completion。
6. 使 Run lease 或 Job lease 过期/改 owner，或递增 WorkflowRun.kernelRevision；completeActivity 返回 accepted=false，Job/Completion 不被旧 worker 覆盖。
7. 让两个 dispatcher 竞争 Completion，只有一个得到 leased；使第一个 completion lease 过期并接管，旧 delivery false；current Run lease 与 Kernel accepted completion 都匹配时 delivery true，即使 Run status 已 terminal。
8. 将 Completion attempts/maxAttempts 设为相等；claim 或 requeue 后状态是 dead_letter，不再产生新 claim。错误 delivery/requeue 不清除仍有效的 lease。
9. 调用 listRunsForRecovery 时，marker 或 resumeRequired 的 queued/running/waiting Run 返回；普通 running 且 resumeRequired=false 和 terminal Run 不返回；limit 非正整数被拒绝。

## 实现与测试锚点

- `packages/storage-prisma/prisma/migrations/20260814090000_workflow_activity_host/migration.sql`：Host snapshot/lease 字段、workflow Job link、kernel revision、Workflow Event idempotency unique、WorkflowCompletion 表；`20260815090000_workflow_ingest/migration.sql`：Workflow provenance/checkpoint 扩展；`20260818000000_workflow_run_source_projection/migration.sql`：`sourceInstanceId`、`errorMessage` 与来源/时间索引。
- `packages/storage-prisma/prisma/schema.prisma:76-135`：Job/DomainEvent 字段与索引；`:251-303`：WorkflowRun/WorkflowCompletion 字段、唯一约束和关系。
- `packages/storage-prisma/src/workflow-host-store.test.ts:45-130`：迁移、EventSink lease、旧数据库升级；`:132-212`：两个 Prisma client 竞争与旧 Completion lease；`:214-374`：Envelope idempotency、terminal/lost revision completion；`:376-478`：orphan Job、Run takeover、resumeRequired；`:480-650`：Activity idempotency、success/retry、旧 lease；`:652-727`：crash window reclaim、Completion max attempts；`:729-885`：stale delivery、requeue/dead-letter、terminal Run delivery；`:887-941`：ingest lookup、retry policy 持久化、max Activity attempts completion。

## 非目标/边界

不提供独立 Attempt 表、Kernel journal 重建、Action executable dispatch、远程 Activity、durable signal/timer/child workflow、外部 outbox 或 exactly-once。Activity claim 的 orphan Job 只保留待 recovery；跨进程长时 recovery、双 Worker 长时间竞态、真实外部 Action 与 Worker Admin SIGTERM deadline 未由本组件测试证明。
