---
parent: .agents/tasks/04-workflow-runtime/README.md
range: §53–63(Spike AS、变更记录、Spike AJ–AO(二段)、Round 68–70)
sealed_at: 2026-09-11
tags: [workflow-runtime, spikes]
tokens_est: 6212
---

## 53. Spike AS：AbortSignal 到 Ingest/Probe Connector

### 53.1 实现

将 cooperative signal 继续传递到 Application 的外部来源边界：

- `ConnectorProbeService.runSource(sourceId, signal?)`；
- `IngestionService.runSource/runExistingRunWithLease(..., signal?)`；
- `IngestionWorker.pollOnce(signal?)`；
- `IngestConnector.fetchItems({ source, cursor, signal? })`。

Supervisor stop → Poller Adapter → Ingest/Probe → Connector fetch 现在有一条
明确的可选 signal 链路。

### 53.2 语义边界

本轮没有自动把 AbortError 映射成某个 Job 状态，也没有自动推进/回退
checkpoint。Connector/Adapter 仍需要自行决定：

- 是否真正中断外部请求；
- 返回 retryable failure；
- 报告 unknown external result；
- 是否允许已经完成的副作用继续进入 durable 收口。

### 53.3 测试

- ConnectorProbe focused test 确认传入同一个 AbortSignal；
- Application Worker/Connector 既有测试继续通过；
- Supervisor 层仍验证 stop 时 signal aborted。

### 53.4 偏差与限制

- 内置 RSS/Collector 当前只是接收可选 signal，未必主动消费；
- parent-wake Consumer 的底层 delivery 尚未实现 signal-aware abort；
- checkpoint/Entry/Asset 写入没有新增 signal fencing；
- lease fencing 仍是最终正确性边界。

### 53.5 下一步

- 为 Connector/Consumer 定义 AbortError 和 retry/unknown 统一合同；
- 做中断中的 Ingest fixture，验证旧 checkpoint、Observation 和 Job lease；
- 将 Action effect receipt 与 abort 结果组合验证。

## 54. 变更记录

### 2026-08-08

- 建立 Workflow Runtime 持续 Task。
- 固定 `Job + Workflow`、脚本优先语义和 Cosmos/Harness durable truth 边界。
- 固定 Connection/Adapter/Knowledge/Research 的后续实现顺序。
- 完成 Spike A：验证脚本 Workflow 的 Action journal replay、等待恢复和 stale lease rejection。
- 完成 Fixed Ingest Workflow 接缝 spike，验证 `source.fetch → library.ingest → checkpoint/event`。
- 完成 Spike B：验证持久 Outbox 的 cursor、claim、lease takeover、ack、retryable failure 和 terminal failure。
- 完成 Spike C：验证 per-Consumer Group delivery、独立 lease/ack/cursor 和多消费者隔离。
- 完成 Spike D：验证 bounded retry、指数退避和 max attempts terminal close。
- 完成 Spike E：验证 generic Outbox Consumer Runner 的单次 tick、错误分类、ack/fail 和 lease-lost 恢复边界。
- 完成 Spike F：验证 Consumer Definition/Binding、event filter、skipped delivery 和 cursor 推进。
- 完成 Spike G：验证持久 Consumer Registry、Definition 版本不可变、Binding 激活和 Runner 解析。
- 完成 Spike H：验证 Consumer Binding revision/CAS fencing 和 stale activation rejection。
- 完成 Spike I：验证 `wait_signal` StepRun 的等待、Signal 消费、resume 和 replay 持久语义。
- 完成 Spike J：验证 checkpoint StepRun 与 Run checkpoint 的原子收口和稳定 path 边界。
- 完成 Spike K：验证 child Workflow start-only StepRun、父子 Run 关联、稳定 path replay 和 `wait: true` 的明确后置边界。
- 完成 Spike L：验证 queued/expired Workflow Run 的单次 durable dispatch tick、稳定领取顺序和无任务时的 idle 返回。
- 完成 Spike M：验证两个独立 Worker 共享 Store 时的单 lease claim fencing 和不重复执行。
- 完成 Spike N：验证旧 Worker lease 失效后不能覆盖新 Worker 的 terminal close。
- 完成 Spike O：验证 `WorkflowWorkerLoop` 的 processed/idle/lease_lost 结果和可停止 poll 生命周期。
- 完成 Spike P：验证 child terminal close 在同一 Store/transaction 内收口父级 child_workflow StepRun。
- 完成 Spike Q：验证 `startChildWorkflow(wait:true)` 的 waiting kind/ref、child completion requeue 和父脚本 replay。

### 2026-08-09

- 完成 Spike R：验证 `completeRun()` 原子写入 `workflow.run.terminal` DomainEvent/Outbox，且与显式业务事件共存、不重复。
- 完成 Round 26：修正固定 Ingest 对 terminal event 的旧事件数量假设，focused/full、Prisma 和文档验证重新通过。
- 完成 Spike S：验证 terminal Outbox 由独立 parent-wake Consumer 驱动父 StepRun 收口和 waiting Run requeue，且 ack 丢失重试不会重复推进。
- 完成 Spike T：统一 terminal Application Command，取消路径写入 terminal Event/Outbox，并用 lease fencing 拒绝旧 Worker 收口。
- 完成 Spike U：验证 child cancellation 经 terminal Outbox 和 parent-wake Consumer 驱动父 StepRun 收口、父 Run requeue 与父 replay failure。
- 完成 Spike V：验证持久 Workflow deadline、timeout sweep、迟到 terminal fencing 和 deadline migration。
- 完成 Spike W：验证 terminal Run 对 Action Job/Invocation/StepRun 的取消和 stale completion fencing。
- 完成 Spike X：将 terminal parent-wake Consumer 接入 `apps/worker` 的共享 Prisma/Data Root poll 链路，保留 Workflow Definition Runtime 后置边界。
- 完成 Spike Y：将 parent-wake Consumer 改为持久 Definition/Binding Registry 激活，验证版本不可变和 disabled binding 尊重。
- 完成 Spike Z：统一 InMemory/Prisma Action Invocation 的父 Run existence/terminal/deadline fencing，消除新 orphan Invocation。
- 完成 Spike AA：增加 InMemory/Prisma `WorkflowStore.auditIntegrity()` 只读完整性审计，覆盖 orphan 关系、Invocation/Job/StepRun 关联不一致和 terminal Run 的 active work 泄漏。
- 完成 Spike AB：父取消和 deadline timeout 递归收口未终态后代，每个 Run 独立写入 terminal Event/Outbox，并验证 stale child completion fencing。
- 完成 Spike AC：新增 `WorkflowActionReceipt` 持久模型，将 effectful Action 的 started/committed/unknown/compensated 证据与 Job attempt、稳定幂等键关联。
- 完成 Spike AD：增加 committed Receipt 的显式 reconciliation，按 Run deadline、active lease 和 attempt fencing 条件恢复 Job/Invocation/StepRun。
- 完成 Spike AE：为 ActionExecutionContext 增加 AbortSignal，同进程 cancel 立即通知，跨进程取消由 Job heartbeat 传播。
- 完成 Spike AF：将 Receipt reconciliation 包装为版本化 maintenance Workflow/Action，验证外部查询→恢复→后续处理的组合边界。
- 完成 Spike AG：为 WorkflowRun 增加持久 lane/priority，验证 Worker lane admission、priority 排序和 child 继承。
- 完成 Spike AH：新增 WorkflowLaneSupervisor，验证 lane slot 并发、业务失败隔离和 graceful stop 接缝。
- 完成 Spike AI：新增通用 WorkerPollerSupervisor，固定宿主 poller 的 slot、错误隔离和 graceful drain 合同。
- 完成 Round 68：新增 Workflow/Action metadata catalog 与 Workflow activation
  binding 的 InMemory/Prisma 最小 Port；固定 `(id, version)` 不可变、注册幂等、
  manifest hash、required Action refs 和 binding revision/CAS 边界。
- 完成 Round 69：为 Workflow Run 持久化 Definition/Action snapshot，并将本地
  executable admission 与 snapshot 做精确匹配；旧的 null snapshot Run 保持可恢复。
- 完成 Round 70：将可选持久 Definition/Action Registry 接入 Runtime；
  active binding 控制新提交，既有 Run 依据 snapshot 继续，Worker claim 校验
  catalog hash 与本地 executable metadata。
- 完成 Round 71：新增只读 `inspectWorkflowAdmissions()` diagnostics，显式报告
  executable/catalog/binding 的可执行性差异，不改变 Run durable 状态。
- 完成 Round 72：Worker bootstrap 在实际创建 Workflow Runtime 后输出结构化
  admission diagnostics；诊断失败隔离，不阻断 Worker 启动。
- 完成 Round 73：以 `COSMOS_WORKER_WORKFLOW_REGISTRY=prisma` 显式启用
  catalog-backed Worker；内置 receipt Workflow/Action 注册 manifest/binding，
  且尊重 disabled binding。

## 55. Spike AJ：统一取消、重试和未知结果合同

### 55.1 共享合同

`packages/contracts` 现在提供统一的执行失败分类：

```text
aborted
retryable
terminal
unknown
```

同时提供 `ExecutionAbortedError`、`isExecutionAbortedError()` 和
`throwIfExecutionAborted()`。Connector、Consumer 和 Action 可以识别同一种
cooperative cancellation，而不依赖某个宿主层的具体错误实例。

### 55.2 Ingest

- Worker 在停止 signal 已中止时不再创建 schedule Run 或 claim 新 Job；
- Connector/Run abort 不完成 Run；
- abort 不推进 checkpoint，也不把 Job 收口为 retry/terminal；
- Job lease expiry/reclaim 仍是恢复事实。

### 55.3 Outbox Consumer

`WorkflowOutboxConsumer.runOnce(handler, signal?)` 现在支持：

- signal 在 claim 前中止：返回 `aborted`，不 claim；
- handler 执行中或 ack 前中止：返回 `aborted`，不 ack/fail；
- handler 抛出 `WorkflowOutboxUnknownError`：返回 `unknown`，不安全重试；
- 只有明确 retryable/terminal 的错误才调用 `failOutbox()`。

### 55.4 验证与限制

- contracts/application/workflow-runtime focused：67 个测试通过；
- 三个 package typecheck 通过；
- Prisma 中断→租约到期→接管组合尚未验证；
- unknown delivery 当前依赖 lease expiry 和 handler 幂等，独立
  Outbox receipt reconciliation 后置。

## 56. Spike AK：Prisma Ingest abort 后的租约接管

新增真实 Prisma/SQLite 行为测试，验证：

```text
Connector abort
→ Run 保持 running
→ Job 不 complete/fail
→ lease 到期
→ 新 Worker reclaim
→ Entry / Run / checkpoint 成功收口
```

第一 Worker 在 Connector fetch 中止后不写入 Entry、不推进 checkpoint，也不把
Job 标记为 retry/terminal。短 lease 到期后，第二 Worker 使用新的 owner 和
lease token 接管同一 Job，并完成后续 Ingest。

验证：

- `bun run test -- packages/storage-prisma/src/index.test.ts --run`
  - 1 个测试文件、10 个测试通过；
- 既有 Prisma stale completion、retry 和 persistent worker 测试保持通过。

尚未覆盖：

- 部分 Observation 已写入后 abort 的去重/修订组合；
- Prisma Parent-wake 的 abort/unknown takeover；
- drain deadline 超时后的进程级重启接管。

## 57. Spike AL：部分 Observation 写入后的同 Run 重放去重

新增 Prisma/SQLite 行为测试，模拟一页包含两个条目的 Ingest：

```text
persist item-1
→ abort
→ lease expiry
→ replay same Run/page
→ item-1 no-op
→ item-2 creates Entry
→ checkpoint commit
```

最终验证：

- 2 个 Entry；
- 2 个 Observation；
- 同一 Run 的重放项没有新增 Observation 或 Entry；
- 新条目正常创建；
- checkpoint 成功推进到 `partial-cursor`；
- Run 成功收口。

这固定了两个不同的身份边界：

- `(sourceInstanceId, runId, externalKey)` 防止同一 Run 重放重复写 Observation；
- `(sourceInstanceId, canonicalExternalId)` 防止跨 Run 重复创建 Entry。

## 58. Spike AM：Prisma Outbox abort/unknown 接管

新增真实 Prisma/SQLite Outbox Consumer 行为测试：

```text
claim
→ abort/unknown
→ 不 ack、不 fail
→ lease 到期
→ 新 Worker reclaim
→ handler 重放
→ cursor 推进
```

验证结果：

- abort delivery 在 lease 未到期时不能被第二个 Worker 抢占；
- lease 到期后新 Worker 可以接管并 ack；
- unknown delivery 不进入 `retry_wait`；
- sequence cursor 只在明确 ack 后推进；
- Prisma Workflow Store focused 测试为 25 个，通过。

尚未覆盖事务中途 abort 的故障注入、Outbox receipt reconciliation 和多
Consumer Group 的独立 takeover。

## 59. Spike AN：Ingest Observation/Checkpoint lease fencing

此前只有 `startRun()` 和 `completeRun()` 验证 Job lease，item 写入和 checkpoint
没有统一携带 lease。现在：

- `persistIngestItem()` 接收当前 `JobLease`；
- `setCheckpoint()` 接收 `runId` 和当前 `JobLease`；
- Prisma 在 Blob preflight、Observation/Entry transaction 和 checkpoint
  transaction 中验证 lease；
- stale Worker 使用旧 token 不能创建 Entry、Observation 或 checkpoint；
- current Worker 使用新 token 可以继续收口。

验证：

- application/storage typecheck 通过；
- Prisma Ingest focused：12 个测试通过。

仍需处理 Blob preflight 与事务复核之间的极窄 race，以及 lease heartbeat 丢失后
Connector 的主动中断。

## 60. Spike AO：Job lease heartbeat 驱动 Ingest abort

`IngestionWorker` 现在为已领取 Job 建立 execution-local
`AbortController`：

```text
renewJobLease=false/throws
→ ExecutionAbortedError
→ Connector/Probe/Ingest signal.aborted
→ 不 complete/fail Job
→ lease fencing 兜底
```

宿主 stop signal 和 Job lease-loss signal 使用同一个 execution signal。新增
`leaseHeartbeatMs` 只作为测试接缝，默认生产 heartbeat 行为不变。

验证：

- application typecheck 通过；
- Application focused：17 个测试通过。

仍需验证真实 Prisma Worker 的 heartbeat 失效、Connector 中断，以及
Action/Research/Knowledge Workflow 对同一模式的复用。

## 61. Round 68：Definition/Action metadata catalog

### 61.1 目标

把 Round 67 识别出的“持久 catalog”和“进程内 executable registry”分开，
验证跨进程共享元数据所需的最小公共 Port，同时不把 TypeScript 函数或任意
运行时代码序列化进 SQLite。

### 61.2 实现

新增 `WorkflowDefinitionRegistry` 及其两个实现：

- `InMemoryWorkflowDefinitionRegistry`：用于行为测试和后续纯运行时组合；
- `PrismaWorkflowDefinitionRegistry`：持久化到 SQLite。

持久 catalog 分成三类数据：

```text
WorkflowDefinitionCatalog(id, version, kind, provider, manifestHash,
                          capabilities, requiredActionRefs, metadata)
ActionDefinitionCatalog(id, version, provider, manifestHash, capabilities,
                        effectMode, retryable, maxAttempts, metadata)
WorkflowDefinitionBinding(workflowId, definitionVersion, enabled, revision)
```

固定的行为合同：

- Definition/Action 的 `(id, version)` 是不可变内容；
- 相同内容重复注册是幂等；数组去重排序、metadata 按 key 规范化后比较；
- 同一版本内容不同会返回 conflict，不会原地覆盖；
- Binding 必须引用已存在的 Workflow catalog；
- `upsertWorkflowBinding` 只允许首次创建或完全相同的重复提交；
- 版本切换和启停必须通过 `expectedRevision` CAS，成功后 revision 加一；
- disabled binding 不解析为 active Workflow；
- catalog 只保存 manifest/能力/输入关系等元数据，可执行的
  `WorkflowDefinition`/`ActionDefinition` 函数仍由每个 Worker 进程本地注册。

新增 Prisma migration：

`20260809120000_workflow_definition_catalog`

### 61.3 验证

- `bun run db:validate`：通过；
- `bun run db:generate`：通过；
- `bun run test -- --run packages/workflow-runtime/src/definition-registry.test.ts
  packages/workflow-runtime/src/index.test.ts`：2 个文件、53 个测试通过；
- `bun run test -- --run packages/storage-prisma/src/definition-registry.test.ts`：
  1 个 Prisma/SQLite 测试通过；
- `bun run typecheck:workflow-runtime`：通过；
- `bun run typecheck:storage`：通过。
- 隔离 Data Root 的 `bun run db:migrate`：16 条 migration 全部通过；
- `bun run typecheck`：通过；
- `bun run test -- --run`：19 个测试文件、167 个测试通过；
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web；
- `git diff --check`、仓库 Markdown 结构检查：通过。

### 61.4 边界与后续

本轮仍未把 catalog 接入 `WorkflowRuntime.enqueue()` 或 `runNext()`。当前执行
admission 仍是本地已注册 Definition 的 `workflowRefs` 过滤；catalog 还没有：

- Definition manifest hash 与 Run 的 snapshot；
- required Action 的提交/claim 前静态解析；
- Worker executable registry 与持久 catalog 的差异诊断；
- unknown/blocked `definition_unavailable` 状态；
- activation audit、Application Command 和 API。

因此本轮证明的是“持久 metadata catalog 可以与 executable registry 分层”，
不是“插件 Workflow 已经可以跨 Worker 生产执行”。

## 62. Round 69：Workflow Run definition/action snapshot

### 62.1 目标

让一次 Run 记录“创建时实际选择了哪一版 Workflow 和 Action 元数据”，并让
Worker 在 claim 前检查本地 executable registry 是否与该 snapshot 一致。

### 62.2 实现

新增 `WorkflowRunDefinitionSnapshot`：

```text
workflowRef
manifestHash
actionDependencies: [{ actionRef, manifestHash }]
```

`WorkflowDefinitionMetadata` 新增可选的 `manifestHash` 和
`requiredActionRefs`；`ActionDefinitionMetadata` 新增可选的 `manifestHash`。

行为：

- `WorkflowRuntime.enqueue()` 解析 Workflow 的 required Action refs，校验
  Action 已注册，并把 Workflow/Action manifest hash 写入 Run snapshot；
- child Workflow 创建也保存自己的 snapshot；
- `runNext()` 将当前进程可执行的 snapshot 作为 claim admission；
- InMemory/Prisma Store 只领取 snapshot 完全匹配的 queued/expired Run；
- 旧数据库中 `definitionSnapshotJson = null` 的 Run 按 workflow ref 继续可领取，
  保持迁移前 Run 的恢复兼容；
- direct `resume()` 在 claim 前检查 snapshot，不会静默执行 hash 不一致的代码；
- Prisma 通过 `20260809130000_workflow_run_definition_snapshot` 保存 snapshot。

本轮没有把所有动态 `callAction()` 自动追加回 snapshot；只有 Workflow
manifest 声明的 `requiredActionRefs` 进入静态 admission。动态 Action 依赖仍需
后续通过显式 manifest 或运行中追加且受 lease fencing 的 snapshot 命令解决。

### 62.3 验证

- `bun run db:validate`、`bun run db:generate`：通过；
- Workflow snapshot focused：3 个 InMemory 测试通过；
- Prisma snapshot focused：1 个 SQLite 测试通过；
- Workflow Runtime/Prisma storage typecheck：通过；
- 初次 focused 失败原因是测试夹具未注册 required Action，补齐夹具后重新通过；
- Docker、浏览器、真实插件加载和跨进程 Worker restart：未运行。

## 63. Round 70：持久 catalog 接入 Runtime admission

### 63.1 目标

完成 Round 68/69 之间的最后一段接缝：让持久 catalog 不只是旁路 metadata，
而是参与 Workflow 提交和 Worker admission，同时不改变没有注入 Registry 的
内置旧路径。

### 63.2 实现

`WorkflowRuntimeOptions` 新增可选 `definitionRegistry`。

注入 Registry 时：

- `enqueue()` 和 child Workflow 创建必须解析 active Workflow binding；
- active catalog 的 `(id, version)`、Workflow manifest hash 和
  `requiredActionRefs` 必须与本地 executable Definition 一致；
- required Action 必须同时存在于本地 executable registry 和持久 Action catalog，
  manifest hash 必须一致；
- Run snapshot 使用 catalog 的 hash，而不是只相信提交进程的本地对象；
- `runNext()` 读取 exact `(workflowId, version)` catalog 做本地 executable
  admission，不要求历史 Run 仍处于 active binding；
- binding 被禁用后，新提交失败；已经创建且 snapshot 完整的 Run 仍可以继续；
- catalog 或本地 executable 不一致的 Worker 不 claim；
- 未注入 Registry 的内置 Runtime 仍使用 Round 69 的本地 snapshot/admission。

新增错误：

- `WorkflowDefinitionCatalogInactiveError`
- `WorkflowDefinitionCatalogMismatchError`

### 63.3 验证

- InMemory Runtime catalog focused：4 个测试通过；
- Prisma catalog + Workflow Runtime focused：2 个测试通过；
- 已覆盖 active enqueue、disabled binding 拒绝新 Run、existing snapshot Run
  继续执行、Workflow/Action hash mismatch admission；
- `bun run typecheck:workflow-runtime`、`bun run typecheck:storage`：
  通过；
- `git diff --check`：通过。
- 全量并行测试首次暴露默认 5 秒 timeout 下的 Prisma/SQLite cleanup 竞态；
  `vitest.config.ts` 将 test/hook timeout 调整为 15 秒后，`bun run test --
  --run`：21 个测试文件、174 个测试通过；
- `bun run typecheck`：通过；
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。

### 63.4 边界

本轮只接入 Runtime 的 metadata admission，不引入第二套执行器：

- catalog 仍不保存可执行代码；
- activation audit/API、blocked `definition_unavailable` projection 尚未实现；
- 动态 `callAction()` 仍需要显式 `requiredActionRefs` 或后续追加式 dependency
  合同；
- `apps/worker` 当前仍未默认开启通用 catalog-backed Workflow lane；
- Connection、Trigger、Secret、State 和 Adapter manifest 仍未接入。

