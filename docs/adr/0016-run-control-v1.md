# ADR-0016：Run 控制 v1（取消 / 重新运行 / 从安全步骤恢复）

> 状态：Accepted design contract
>
> 日期：2026-09-10
>
> 关联：[`run-control-v1 Proposal`](../proposals/run-control-v1.md)、[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §4、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) RUN-004、ADR [`0001`](0001-durable-workflow-runtime.md)、ADR [`0002`](0002-nb-workflow-kernel-cosmos-host.md)

## Context

PRD RUN-004 要求「用户可以取消、重新运行或从安全步骤恢复 Run」，且「UI/API 明确说明会重用哪些结果、产生哪些新副作用」。durable Workflow Host 已经具备运行期原语——lease fencing（`claimRun`/`heartbeatRun`/`releaseRun`）、恢复队列（`resumeRequired` + `listRunsForRecovery`）、Kernel `rerun()`——但这些能力没有形成任何用户/API 产品面：`apps/api` 只有「触发一次手动采集」和只读 Run 端点，没有 cancel/rerun/recover。2026-09-10 用户裁决四项默认建议（取消为用户覆盖式终态化、重新运行复用采集入队、恢复送回恢复队列、解释字段进控制响应 DTO），本文沉淀这些稳定决定。

## Decision

### 1. 取消是用户覆盖式终态化，不要求持有当前 lease

新增 host store 方法 `cancelWorkflowRun(runId)`：对非终态 Run 以 `status` 为 CAS 原子终态化为 `cancelled`，同时清空 `runLeaseOwner/Token/ExpiresAt`、置 `resumeRequired=false`、写 `finishedAt` 与 `errorMessage`，并追加 `run.cancelled.v1` DomainEvent。与 `failWorkflowRun` 的区别是**不校验调用方持有当前 lease**：取消是用户对 Worker 的显式覆盖，其 fence 效果来自「status → cancelled + 清 lease」——此后 Worker 的 `heartbeatRun`/`completeActivity`/`releaseRun` 全部因 lease CAS 失败而拒绝写入。已入库的 Observation/Entry/Revision 保留不回滚（幂等 dedup 保证重跑不重复）。取消是终态、不可撤销。

### 2. 重新运行 = 复用采集入队，产生全新 Run，`triggerKind` 记为 manual

`IngestWorkflowControlService.rerun(runId, idempotencyKey)`：读原 Run 的 `inputSnapshot.source.id`，复用既有 `enqueue` 用**新 idempotency key** 入队一个全新 `cosmos.ingest@1` Run。只对终态 Run（completed/failed/cancelled）开放，非终态返回 conflict。复用结果 = 既有库内已入库结果（`externalKey` 幂等去重）；新副作用 = 从来源**当前** checkpoint 重新 fetch + ingest（不用失败 Run 的旧 cursor）。重跑永远记为 `manual`（用户动作）。

### 3. 恢复 = 把失去活动 lease 的非终态 Run 送回恢复队列

新增 host store 方法 `recoverWorkflowRun(runId)`：对非终态且**当前无活动 lease**（lease 为空或已过期）的 Run，以 `status` 为 CAS 置 `resumeRequired=true` 并清空 lease。此后 `WorkflowRunLane.pollOnce` 的 execution claim 重新拿到它，按有无 Kernel 状态走 `rerun()`（有状态，从最后一个安全步骤续跑）或 `begin()`（无状态）。对仍持有活动 lease 的 Run 返回 conflict。恢复不是独立状态，是 `running` 的前置动作，公共五态不变。

### 4. 可解释性字段进 Run 控制响应 DTO，不改公共 Run 投影

三个动作各自返回 `runControlResultSchema`（`action`/`run`/`reuse`/`sideEffects`），其中 `run` 复用稳定 `runSnapshotSchema`，`reuse`/`sideEffects` 是面向用户的中文说明（复用哪些结果、产生哪些新副作用）。`runStatusSchema` 五态（queued/running/succeeded/failed/cancelled）不变，不新增「recovering」中间态。

## Consequences

### Positive

- 用户第一次能主动干预 Run：取消卡住的采集、从安全步骤恢复崩溃遗留、对失败 Run 一键重跑，且每个动作都解释清楚后果。
- 零数据迁移：不碰 Prisma schema，只改写 `WorkflowRun` 既有列；重跑产生的是普通 Run 行。
- 公共 Run 投影与状态枚举不变，既有读取消费者不受影响。

### Costs and risks

- 取消不要求持有 lease，意味着它能在 Worker 正执行时强制终态化；Worker 的在途外网请求可能已发出，其结果被 fence 拒绝写入（at-least-once + 幂等语义下是安全的，但「取消时可能已产生部分外部副作用」需要 UI 说明）。
- 恢复对「活动 lease」返回 conflict，因此对「Worker 还在跑但业务上已卡死、lease 尚未过期」的场景无法立即干预，只能等 lease 过期后自动恢复或再触发。
- 三个新端点是 durable `WorkflowRun` 专属；legacy SQL Run 泳道不受控，仍随 WorkflowHost 默认启用逐步淡出。

## Alternatives considered

### 取消复用 `failWorkflowRun` 写成 `failed`

拒绝（决策 1）。`cancelled` 与 `failed` 是不同终态；用户取消不能伪装成执行失败（对齐 RUN-005「不把不确定结果伪装成成功或失败」的精神）。

### 取消要求先持有当前 lease

拒绝（决策 1）。正在执行的 Run 的 lease 在 Worker 手里，用户拿不到；要求 lease 会让「取消一个正在跑的 Run」不可达。

### 重新运行复用失败 Run 的同一幂等键重放

拒绝（决策 2）。会撞幂等键冲突，且重放旧 cursor 无法表达「重新抓取」。

### 新做「重跑 Run」Workflow 类型

拒绝（决策 2）。`cosmos.ingest@1` 本身就是来源采集，重跑只是「再来一次」。

### 恢复直接复用 `markResumeRequired`

拒绝（决策 3）。它要求持有当前 lease，而用户恢复的恰是 lease 已丢失/过期的 Run，语义相反。

### 解释字段进公共 Run 投影

拒绝（决策 4）。解释只属于控制动作的响应，不属于只读 Run 投影，避免污染稳定读合同。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 需要从任意 Step 级粒度选择性重放（当前只恢复到 Kernel 最后持久化状态）；
- legacy `Run` 泳道需要同等的控制能力（当前仅 durable `WorkflowRun`）；
- 引入多主机/远程 Worker 后，「取消」的 fence 语义与在途外部副作用需要按新威胁模型重评；
- Run 投影需要暴露「恢复中/取消中」等可观察中间态（当前五态不变）。
