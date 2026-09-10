---
parent: .agents/tasks/04-workflow-runtime/README.md
range: §4.1–18(Convergence handoff、历史实施顺序、Spike A–J)
sealed_at: 2026-09-11
tags: [workflow-runtime, spikes]
tokens_est: 6881
---

## 4.1 Convergence handoff

截至 2026-08-11，本 Task 的执行方向由 ADR-0002 部分修正：

- 现有 Prisma Store、Job/Lease、Worker、Outbox、双 fence、checkpoint CAS 和
  固定 Ingest 保留。
- Cosmos `packages/workflow-runtime` 中的脚本 replay、path 和等待语义只作为
  parity 基线，不再新增 Knowledge/Research/Agent 能力。
- `nb-workflow` 的 Core/Runtime/Backend/Testing 拆分只是草案，实际代码调整在
  独立仓库 Task、分支和 worktree 中进行。
- SQL TaskStore 是任务权威；WakeupBus/Redis 只做可选通知。Redis、PostgreSQL 和
  S3 不在当前 Task 04 实现。
- `wf.agents.invoke` 属于可选 Agent Extension，等待 Harness 文档；Core 不依赖
  Harness。

Task 04 walkthrough 继续保存 Spike 的历史证据；Task 06 从这些证据建立
conformance/parity，不重写历史 Round。

## 5. 历史实施顺序

下列顺序记录 Task 04 Spike 的原始推进方式。ADR-0002 之后的规范 Kernel 和
Activity/Attempt 收敛顺序以 Task 06 为准。

### Step 1：术语和公共合同

- 统一使用 `Workflow`；旧 `Flow` 只在原始需求或历史迁移说明中保留。
- 定义 Definition、Binding、Run、Step、Job、Action、Trigger、Event、Error 和 Capability schema。
- 定义协议版本、输入快照、输出引用和错误可操作性。

### Step 2：Durable Run/Step/Job Runtime

- 持久状态表与 Application Service。
- Job claim、lease、heartbeat、retry、waiting、cancel 和 terminal close。
- priority/lane/budget 与父子关系。
- 基于持久状态恢复，不依赖内存队列。

### Step 3：Lease fencing 和恢复

- 所有受保护写入都检查 lease token。
- Ingest 事实写入、FTS、DomainEvent、Outbox 和 checkpoint 收口。
- 进程中断、租约过期、Worker 接管和旧 Worker 拒绝提交。
- 明确未知外部结果和不能自动重试的副作用。

### Step 4：Trigger、Connection 和采集计划

- TriggerBinding、schedule/poll/event/condition/dependency。
- Connection、SecretRef、SecretStore、StateStore。
- 一个连接多个采集计划的隔离 checkpoint、预算和错误。
- Trigger Consumer 与重复触发/循环保护。

### Step 5：Connector/Adapter manifest

- Source Operation/Action 注册。
- 输入、输出、稳定 external key、origin locator、discovery context 和媒体状态。
- Adapter 只能通过 Service/Command/Query/Action 访问核心能力。

### Step 6：Ingest identity/provenance

- 无 URL fallback key 使用 `sourceLocator`。
- Observation、Entry、Revision、Asset 和 Story provenance。
- `create`、`update`、`delete`、`snapshot`/tombstone 语义。
- Run 保存定义版本、Source 配置和输入快照。

### Step 7：KnowledgeSignal/ResearchRequest

- Knowledge Workflow 的 Proposal/Signal 输出。
- Research Request 状态机、幂等、priority、budget、父子关系和结果引用。
- Research 结果重新进入统一 Ingest Command。

### Step 8：Outbox 和事件消费者

- DomainEvent 持久化和 Outbox 投递。
- Consumer cursor、幂等和失败重投。
- Run、Job、Feed 和 Research 事件。
- 无法补齐事件时的 `snapshot_required`。

### Step 9：Graph/IR 转换边界

- Graph/IR schema 只表达可转换的 Workflow。
- 转换结果引用脚本 WorkflowDefinition 版本。
- 转换不得绕过 Action、Capability、lease、retry 和恢复。
- 不做反向脚本到 Graph 的强制转换。

### Step 10：Harness/`nb-memory` Adapter 预留

- Agent Invocation 与 Cosmos Job/Run 的映射。
- Session/Profile/Model Runtime 的边界。
- 共享记忆读写 Port、Node 生产兼容性和存储生命周期。
- 验证 Harness 不持有 Cosmos Job 的 durable truth。

## 9. Spike A：脚本式 Workflow 最小运行语义

### 9.1 目的

在不改动现有固定 Ingest Runtime 的前提下，验证脚本式 Workflow 是否可以通过统一的 `Run → Action Invocation → Job` 语义实现等待、恢复、幂等和租约 fencing。

### 9.2 实现

新增 `packages/workflow-runtime` spike 包：

- `WorkflowDefinition<I, O>`：版本化脚本 Workflow。
- `ActionDefinition<I, O>`：版本化可调用能力。
- `WorkflowContext`：`callAction`、`query`、`startChildWorkflow`、`waitForSignal`、`checkpoint`、`emit`、取消和预算读取。
- `WorkflowStore`：运行时依赖的持久化 Port。
- `InMemoryWorkflowStore`：只用于 spike 和行为测试，不作为生产存储。
- Workflow Run orchestration lease，以及 Action Job lease heartbeat。
- Action Invocation 与 Job 的稳定幂等键。
- 等待信号后的 resume。
- 已完成 Action 的 journal replay。
- 旧 lease token 拒绝 Job completion。

最小验证路径：

```text
Workflow
  → Action Job 执行一次
  → checkpoint
  → waitForSignal
  → signal + resume
  → journal replay
  → 不重复执行已完成 Action
```

### 9.3 结论与限制

- 脚本式 Workflow 可以建立在可替换 `WorkflowStore` 之上，后续可以用 Prisma 实现同一 Port。
- `callAction` 必须产生稳定 path/idempotency key；当前 spike 允许显式 `key`，未提供时才使用顺序 fallback。
- Graph/IR 不需要独立 Runtime，但需要编译为带稳定 path 的脚本 Workflow。
- 当前初始 Spike A 尚未实现持久 Outbox；后续 Spike B 已验证 Outbox 的持久化和基本投递控制，但仍未实现真实外部发布、Child Workflow 调度、非 Action 类型的 StepRun 和生产级恢复。
- 当前 spike 的 `InMemoryWorkflowStore` 不能被 API/Worker 直接使用，也不能替代当前 Cosmos Repository。

### 9.4 验证

- `bun run --cwd packages/workflow-runtime typecheck`：通过。
- `bun run test -- packages/workflow-runtime/src/index.test.ts`：2 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run test`：16 个测试文件、65 个测试通过。

## 10. Spike B：持久 Outbox 的 claim/ack/fail

### 10.1 目的

验证 DomainEvent 产生的 Outbox message 能否在 SQLite 中被 Worker 安全领取、接管、确认和失败重试，并且旧 Worker 不能在租约失效后继续改变投递状态。

### 10.2 实现

- `WorkflowOutboxMessage` 通过 `eventSequence` 与 DomainEvent 顺序关联。
- `WorkflowOutboxConsumerCursor` 持久保存 Consumer 的高水位位置。
- `WorkflowStore` 增加：
  - `claimOutbox`
  - `ackOutbox`
  - `failOutbox`
- InMemory 和 Prisma Store 都支持：
  - pending message claim；
  - 过期 lease takeover；
  - 旧 token ack/fail 拒绝；
  - retryable failure 返回 pending 并延迟 1 秒；
  - terminal failure 保持 failed，不再自动领取；
  - 按 `eventSequence` 严格顺序领取，前序 leased/pending/failed 会阻塞后续消息；
  - ack 与 cursor 推进在同一 Prisma transaction 中完成。
- 修复 InMemory Outbox 使用 event ID 与 message ID 混用导致的重复 pending 副本。

### 10.3 验证

- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、9 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、67 个测试通过。
- 在隔离 `COSMOS_DATA_ROOT` 下执行 `bun run db:migrate`：8 条 migration 全部通过。

### 10.4 偏差与限制

- 首次 focused test 暴露 InMemory message key 错误；修复后重新运行并通过。
- 顺序 focused test 暴露 InMemory 和 Prisma 都会跳过前序 leased message；修复为严格按 `eventSequence` 扫描后重新运行并通过。
- 还没有外部 publisher、Consumer crash/restart 全链路、指数退避、最大尝试次数、dead-letter 或 `snapshot_required`。
- 当前 cursor 只服务于 Outbox spike，尚未与 SSE `Last-Event-ID` 统一。

## 11. Spike C：per-Consumer Group Outbox delivery

### 11.1 目的

验证同一条 DomainEvent 能否被 Knowledge、Delivery、SSE 或其它独立 Consumer Group 各自消费，而不共享 message-level lease、ack 和 cursor。

### 11.2 实现

- 新增 `WorkflowOutboxDelivery(messageId, consumerId)`。
- Outbox message 保留事件事实和 payload；delivery 保存每个 Consumer Group 的：
  - status；
  - attempts；
  - availableAt；
  - lease owner/token/expiry；
  - last error；
  - publishedAt。
- `claimOutbox` 按 Consumer Group 懒创建 delivery，并对每个 Group 独立执行严格 `eventSequence` 领取。
- `ackOutbox`、`failOutbox` 通过 `consumerId + messageId + leaseToken` fencing。
- ack 与对应 Consumer cursor 仍在同一 Prisma transaction 中收口。
- InMemory Store 与 Prisma Store 保持同一行为合同。
- `failOutbox` 公共合同增加 `consumerId`，避免错误地修改其它 Consumer Group 的 delivery。

### 11.3 验证

- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、13 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、71 个测试通过。
- 在隔离 `COSMOS_DATA_ROOT` 下执行 `bun run db:migrate`：9 条 migration 全部通过。

### 11.4 偏差与限制

- 首次 Prisma focused test 暴露 Delivery 缺少 `publishedAt`；补齐 schema/migration 后重新运行并通过。
- 旧 `WorkflowOutboxMessage` 的 status/lease/attempt 字段仍保留在 schema 中，当前只作为历史兼容字段；per-Consumer delivery 才是新 claim/ack/fail 的事实来源。生产化前需要单独完成迁移、清理和监控语义收口。
- 仍没有外部 publisher、Consumer crash/restart 全链路、dead-letter、`snapshot_required` 或 SSE cursor 统一。

## 12. Spike D：bounded retry 与 exponential backoff

### 12.1 目的

验证 delivery 失败不应无限以固定间隔重试；重试策略需要有界、可计算，并在达到最大尝试次数后进入 terminal `failed`。

### 12.2 实现

- 新增 `WorkflowOutboxRetryPolicy`：
  - `maxAttempts`；
  - `baseDelayMs`；
  - `maxDelayMs`。
- 默认策略为：

```text
maxAttempts = 3
baseDelayMs = 1000
maxDelayMs = 60000
```

- `resolveWorkflowOutboxFailure` 统一计算 retryable failure 的状态和下一次可领取时间。
- 第一轮失败按 base delay，后续按指数退避并受 max delay 限制。
- 达到 `maxAttempts` 后，即使调用方仍标记 retryable，也进入 terminal `failed`。
- InMemory 和 Prisma Store 都在 lease fencing 下使用相同策略；Prisma failure close 在事务中读取 attempts 并条件更新。

### 12.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、15 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、73 个测试通过。
- 在隔离 `COSMOS_DATA_ROOT` 下执行 `bun run db:migrate`：9 条 migration 全部通过。

### 12.4 偏差与限制

- Retry policy 当前由调用方传入，是一次失败处理的输入快照；尚未作为 Consumer Definition/Binding 的持久版本化配置。
- terminal `failed` 仍会阻塞当前 Consumer Group 的 eventSequence，dead-letter/人工 skip 尚未实现。
- 外部 publisher 的未知结果、Consumer crash/restart 和 `snapshot_required` 仍未覆盖。

## 13. Spike E：generic Outbox Consumer Runner

### 13.1 目的

验证 Worker 如何使用同一套 Store Port 完成一次可恢复的 `claim → handler → ack/fail`，并把 handler 错误、重试和 lease 丢失显式返回给上层调度器。

### 13.2 实现

- 新增 `WorkflowOutboxConsumer`，每次 `runOnce()` 最多处理一条 delivery。
- handler 成功后调用 `ackOutbox`；ack 因 lease 失效被拒绝时返回 `lease_lost`。
- 提供：
  - `WorkflowOutboxRetryableError`；
  - `WorkflowOutboxTerminalError`；
  - 可替换的 `classifyError`；
  - `idle`、`published`、`retry_wait`、`failed_terminal`、`lease_lost` 结果。
- 未显式标记为 retryable 的未知异常默认按 terminal 处理，避免错误无限重试。
- Runner 只负责一次 tick 和状态收口，不负责长循环、外部 HTTP、SSE 或具体发布副作用。
- 增加 InMemory 和 Prisma Store 的 Runner 行为测试。

### 13.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、19 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、77 个测试通过。
- 本轮没有修改 Prisma schema；Round 11 已验证的隔离 Data Root migration（9 条）仍适用。

### 13.4 偏差与限制

- Runner 尚未提供长循环、并发 worker pool、consumer registration、事件过滤或 retention。
- handler 已经完成外部副作用但 ack 丢失时，恢复会再次执行 handler；这仍是 at-least-once，外部副作用必须由 Action/Publisher 自己提供幂等键或 receipt。
- Runner 没有把“外部结果未知”自动变成成功或失败；需要后续 Delivery/Receipt 合同。
- 仍未接入 API/Worker 的实际生产循环。

## 14. Spike F：Consumer Definition/Binding 与事件过滤

### 14.1 目的

把 Consumer Group 订阅哪些事件从 Runner 的隐含逻辑提升为版本化 Definition/Binding 合同，并确保不匹配的事件不会阻塞该 Consumer 的 cursor。

### 14.2 实现

- 新增版本化合同：
  - `WorkflowOutboxConsumerDefinition`；
  - `WorkflowOutboxConsumerBinding`。
- Definition 最小字段：
  - `id`；
  - `version`；
  - `eventTypes`；
  - `leaseMs`；
  - `retryPolicy`。
- `WorkflowOutboxConsumer` 可以从 Definition 读取 event filter、lease 和 retry policy。
- `claimOutbox` 支持 `eventTypes`：
  - 不匹配事件创建/更新为 `skipped` delivery；
  - 同一 Consumer cursor 在同一 Store 操作中推进；
  - 匹配事件继续走 claim → handler → ack/fail；
  - `skipped` 与 `published` 一样不会再次领取。
- InMemory 和 Prisma Store 保持同一过滤语义。

### 14.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、21 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、79 个测试通过。
- 本轮没有新增 Prisma migration；`skipped` 使用现有 String status 字段，Round 11 的 9 条 migration 仍适用。

### 14.4 偏差与限制

- Definition/Binding 当前是公共运行时合同，还没有 Consumer 注册表、持久版本绑定或 API。
- 已经 skipped 的历史事件不会因为 Definition filter 改变而自动重放；需要新 Consumer Group/Binding 或显式 replay 操作。
- `skipped` 会推进高水位 cursor，因此过滤器变更不能被当成无副作用的配置热更新。
- 仍未实现 event retention、订阅路由、dead-letter、snapshot_required 和真实 Trigger Consumer。

## 15. Spike G：持久 Consumer Registry/Binding

### 15.1 目的

验证 Consumer Definition/Binding 不应只存在于 Worker 进程内；Definition 版本和当前激活 Binding 需要可持久解析，Worker 重启后仍能得到同一配置。

### 15.2 实现

- 新增 `WorkflowOutboxConsumerDefinition` 表：
  - `(id, version)` 复合主键；
  - eventTypes；
  - lease；
  - retry policy；
  - created/updated 时间。
- 新增 `WorkflowOutboxConsumerBinding` 表：
  - `consumerId`；
  - 当前 definition id/version；
  - enabled；
  - 复合外键约束。
- 新增 `WorkflowOutboxConsumerRegistry` Port：
  - `registerDefinition`；
  - `getDefinition`；
  - `upsertBinding`；
  - `getBinding`；
  - `resolve`。
- 同一 Definition `(id, version)` 再次注册必须内容一致；不同内容会返回 conflict，禁止原地覆盖版本。
- Binding 可以从 v1 切换到已注册的 v2；禁用 Binding 后 Runner factory 拒绝构造。
- 新增 InMemory Registry、Prisma Registry 和 `createWorkflowOutboxConsumerFromRegistry`。

### 15.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、23 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、81 个测试通过。
- 在隔离 `COSMOS_DATA_ROOT` 下执行 `bun run db:migrate`：10 条 migration 全部通过。

### 15.4 偏差与限制

- Registry 目前没有 API、权限、审批或多租户隔离；当前单用户阶段只验证持久配置和版本不变量。
- Binding 切换版本不会自动重放旧 Consumer cursor/skipped delivery；需要显式新 Consumer Group 或 replay command。
- Registry 还没有 Definition 删除、retention、audit event、并发激活 fencing 和配置快照关联到 Workflow Run。

## 16. Spike H：Consumer Binding revision/CAS fencing

### 16.1 目的

防止两个管理动作或旧 Worker 同时更新 Consumer Binding 时互相覆盖；Binding 激活需要带 expected revision，并以 compare-and-set 方式推进。

### 16.2 实现

- `WorkflowOutboxConsumerBinding` 增加 `revision`，初始值为 `0`。
- `upsertBinding` 只负责首次创建或完全相同内容的幂等写入；不同内容必须使用 activation。
- 新增 `activateBinding`：
  - 输入 definition、enabled 和 `expectedRevision`；
  - 成功后 revision 原子递增；
  - expected revision 不匹配返回 `WorkflowConsumerBindingConflictError`。
- InMemory/Prisma Registry 都实现同一 CAS 语义。
- 新增 `20260808220000_workflow_consumer_binding_revision` migration。
- Zod 拆分 Binding input/output：初始化输入可省略 revision，持久化输出始终包含 revision。

### 16.3 验证

- `bun run db:validate`：通过。
- `bun run db:generate`：通过。
- `bun run typecheck:packages`：通过。
- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、23 个测试通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、81 个测试通过。
- 在隔离 `COSMOS_DATA_ROOT` 下执行 `bun run db:migrate`：11 条 migration 全部通过。

### 16.4 偏差与限制

- CAS 只保护 Binding 指针更新，还没有 Application Command、审计 DomainEvent、操作者/来源和 API。
- Definition/Binding 激活尚未与正在运行的 Worker lease 或 Workflow Run 配置快照绑定。
- 没有多用户权限、审批或远程不可信扩展隔离；这些仍是产品后置边界。

## 17. Spike I：wait_signal StepRun 持久语义

### 17.1 目的

验证 Workflow 等待外部 Signal 时，`WorkflowStepRun` 能与 Signal 消费保持一致，Worker 重启/Workflow replay 不会再次等待已经成功消费的 Signal。

### 17.2 实现

- `WorkflowStore` 新增 `consumeSignalStep`：
  - 校验 Workflow Run lease；
  - 创建或恢复 `wait_signal` StepRun；
  - 没有 Signal 时将 StepRun 置为 `waiting`；
  - 有 Signal 时在同一 Store transaction 内消费 Signal 并将 StepRun 置为 `succeeded`；
  - 已成功 StepRun replay 时直接返回保存的 output。
- Runtime 使用稳定 path：`wait_signal:<signalRef>`。
- InMemory 实现使用同一内存状态边界；Prisma 实现使用同一 transaction。
- 现有 waiting workflow 测试增加 StepRun 状态断言：
  - 等待时 `waiting`；
  - signal resume 后 `succeeded` 且 output 持久。

### 17.3 验证

- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、23 个测试通过。
- `bun run typecheck:packages`：通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、81 个测试通过。
- 本轮没有新增 Prisma migration；使用既有 `WorkflowStepRun` 表。

### 17.4 偏差与限制

- 当前只完成 `wait_signal` StepRun；`checkpoint`、`child_workflow` 仍没有独立 StepRun 状态。
- Signal 当前仍是每个 `(runId, signalRef)` 一个可覆盖值，没有 Signal history、超时、取消原因或多次排队语义。
- `consumeSignalStep` 只保护当前 Run lease；Signal producer 的授权、来源和审计仍未建模。

## 18. Spike J：checkpoint StepRun 原子收口

### 18.1 目的

验证 Workflow checkpoint 不应只修改 Run 的 checkpoint 字段；它还需要一个可追踪的 `checkpoint` StepRun，并与 Run checkpoint 在同一个持久事务中更新。

### 18.2 实现

- `WorkflowStore` 新增 `recordCheckpoint`：
  - 校验当前 Run lease；
  - 创建或恢复 `checkpoint` StepRun；
  - 写入 StepRun output/status；
  - 同时写入 Workflow Run checkpoint。
- Prisma 使用同一 transaction；InMemory 保持同一状态边界。
- `WorkflowContext.checkpoint` 支持可选 `{ key }`：
  - 显式 key 生成稳定 `checkpoint:<key>` path；
  - 未提供 key 时使用当前脚本执行内的 `checkpoint:<sequence>` fallback。
- 现有 waiting workflow 测试增加 `checkpoint:1` StepRun 的 succeeded/output 断言。

### 18.3 验证

- `bun run typecheck:packages`：通过。
- `bun run test -- packages/workflow-runtime/src/index.test.ts packages/storage-prisma/src/workflow-store.test.ts`：2 个测试文件、23 个测试通过。
- `bun run build`：通过，包含 packages、API、Worker 和 Next Web。
- `bun run test`：16 个测试文件、81 个测试通过。
- 本轮没有新增 Prisma migration；复用既有 `WorkflowStepRun` 表。

### 18.4 偏差与限制

- 未提供 key 的 checkpoint 仍依赖脚本执行顺序；Graph/IR 编译器必须生成显式稳定 key。
- `child_workflow` 当前只完成 start-only StepRun：可以原子创建并幂等复用子 Run，但尚未实现父子等待、结果绑定、失败传播、取消和恢复。
- Run checkpoint 仍只保存最新值，没有 checkpoint history 或独立 replay command。

