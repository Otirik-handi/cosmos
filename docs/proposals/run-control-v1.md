# Proposal：Run 控制 v1（取消 / 重新运行 / 从安全步骤恢复）

> 状态：accepted
>
> 日期：2026-09-10
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) RUN-004（关联 RUN-001/002/003/008）
>
> 关联设计：ADR [`0001`](../adr/0001-durable-workflow-runtime.md)（durable Run/Job、lease fencing、恢复语义）、ADR [`0002`](../adr/0002-nb-workflow-kernel-cosmos-host.md)（Kernel `rerun()` 与恢复边界）、架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §4（Workflow Run 与 TriggerBinding）
>
> 关联既有切片：Task 04（Workflow Runtime）、Task 07（Deferred Workflow Host）、Task 20（媒体失败重试与保留期清理）

## 1. 问题

PRD RUN-004 要求「用户可以取消、重新运行或从安全步骤恢复 Run」，且「UI/API 明确说明会重用哪些结果、产生哪些新副作用」。当前 durable Workflow Host 已经具备运行期所需的大部分原语（lease fencing、恢复队列、Kernel `rerun()`），但这些能力**没有形成任何用户/API 产品面**：

- `apps/api/src/app.controller.ts` 只有「触发一次手动采集」`POST /sources/:sourceId/runs`（`:437`）和只读的 `GET /runs/:runId`（`:497`）、`GET /workflow-runs/:runId`（`:513`）；
- 没有取消、重新运行、恢复/续跑的端点，也没有在响应里向用户解释「重跑会复用/重新产生什么」。

后果：Run 卡住或失败后，用户只能等 Worker 自动恢复（`WorkflowRunLane.pollOnce` 的 claim → begin/rerun），无法主动干预；失败 Run 想重跑只能回到来源页再点一次「手动采集」，无法从 Run 详情发起。

## 2. 目标与非目标

### 目标（对应 RUN-004 的可观察验收）

1. **取消**：用户可取消一个非终态 Run；取消后 Run 进入终态 `cancelled`，已入库的 Observation/Entry/Revision 保留不回滚，后续 Worker 写入被 fence 拒绝。
2. **重新运行**：用户可从 Run 详情对一个终态（failed/cancelled/completed）Run 重新运行，得到一个全新 Run；响应明确说明复用既有入库结果、并产生新的 fetch + ingest 副作用。
3. **恢复**：用户可把一个非终态但已失去活动 lease 的 Run 强制送回恢复队列，Worker 从最后一个安全步骤续跑（Kernel `rerun()`）。
4. **可解释**：三个动作的响应都携带面向用户的「复用/新副作用」说明，UI 能直接展示，不用猜。

### 非目标（本切片明确后置）

- 从任意 Step 级粒度选择性重放（只跑某几步）；v1 恢复到 Kernel 最后持久化状态这一「安全步骤」粒度。
- 定时/批量取消或重跑、重跑队列管理；
- legacy `Run`（旧 SQL 泳道）的控制；v1 只针对 durable `WorkflowRun`（WorkflowHost 默认启用）；
- Trigger/Connection/StateStore 等其它平台面（后续切片）。

## 3. 当前行为与证据

- **Run 状态机已存在**：`packages/application/src/workflow-host.ts:16` 定义 `queued/running/waiting/completed/failed/cancelled`；`WorkflowRun` 行 `packages/storage-prisma/prisma/schema.prisma:633` 已有 `status`、`resumeRequired`、`runLeaseOwner/Token/ExpiresAt`、`manifestHash`、`idempotencyKey`。
- **lease fencing 已存在**：`claimRun`/`heartbeatRun`/`releaseRun`（`workflow-host.ts:112` 的 `WorkflowRunLeasePort`）；`claimRun`（`workflow-host-store.ts:261`）以 status + `previousRunLeaseGuard` 为 CAS，旧 Worker 过期后被新 Worker 接管。
- **已有两个接近但不够用的终态化/恢复原语**：
  - `failWorkflowRun`（`workflow-host-store.ts:1161`）把非终态 Run 经当前 lease 终态化为 `failed` —— 语义是「失败」，不是「用户取消」，且要求调用方持有当前 lease。
  - `markResumeRequired`（`workflow-host-store.ts:1204`）经当前 lease 把 `resumeRequired` 置真 —— 面向崩溃恢复，同样要求持有当前 lease。
- **恢复回路已存在**：`WorkflowRunLane.pollOnce`（`workflow-host-runtime.ts:355`）用 `purpose:"execution"` claim `queued`/`running`/`waiting+resumeRequired`（lease 为空或过期）的 Run，再按有无 Kernel 状态走 `begin` 或 `rerun`（`:393-395`）。
- **手动采集入口已存在**：`IngestWorkflowControlService.enqueue`（`packages/application/src/workflow-control.ts:48`）从 `sourceId`+`triggerKind`+`idempotencyKey` 生成一次 `cosmos.ingest@1` 入队。
- **无任何控制端点**：`apps/api/src/app.controller.ts` 全文无 cancel/rerun/recover 路由。

## 4. 方案

### 决策 1：取消 = 用户覆盖式终态化，不要求持有当前 lease

新增 host store 方法 `cancelWorkflowRun(runId)`：对**非终态** Run 以 status 为 CAS 原子终态化为 `cancelled`，同时清空 `runLeaseOwner/Token/ExpiresAt`、置 `resumeRequired=false`、写 `finishedAt`，并追加一条 `workflow.run.cancelled.v1` DomainEvent。

与 `failWorkflowRun` 的关键区别：**不校验调用方持有当前 lease**。取消是用户对 Worker 的显式覆盖，其 fence 效果来自「status → cancelled + 清 lease」——此后 Worker 的 `heartbeatRun`/`completeActivity`/`releaseRun` 全部因 lease CAS 失败而拒绝写入，已入库的 Observation/Entry/Revision 不回滚（幂等 dedup 保证重跑不重复）。

**备选**：复用 `failWorkflowRun` 只把状态写成 `failed`。拒绝：`cancelled` 与 `failed` 是不同终态，用户取消不能伪装成执行失败（对应 RUN-005 的「不把取消伪装成失败」精神）。

**备选**：取消需要先拿到当前 lease 再终态化。拒绝：正在执行的 Run 的 lease 在 Worker 手里，用户拿不到；要求 lease 会让「取消一个正在跑的 Run」不可达。

### 决策 2：重新运行 = 复用采集入队，产生全新 Run，`triggerKind` 记为 manual

新增 `POST /runs/:runId/re-runs`：读原 Run 的 `sourceInstanceId`（从 `productRunJson`/`inputSnapshotJson` 解析），复用 `IngestWorkflowControlService.enqueue` 用**新 idempotency key** 入队一个全新 Run。

- 只对**终态** Run（failed/cancelled/completed）开放；非终态返回 conflict（先取消再重跑）。
- 复用结果 = 既有库内已入库结果（`externalKey` 幂等去重）；新副作用 = 从来源**当前** checkpoint 重新 fetch + ingest（不用失败 Run 的旧 cursor）。
- 重跑永远记为 `manual`：它是用户动作，不沿用原 `schedule` 触发语义。

**备选**：复用失败 Run 的同一 idempotency key 重放。拒绝：会撞幂等键冲突，且重放旧 cursor 无法表达「重新抓取」。

**备选**：新做一个「重跑 Run」Workflow 类型。拒绝：`cosmos.ingest@1` 本身就是来源采集，重跑只是「再来一次」。

### 决策 3：恢复 = 把失去活动 lease 的非终态 Run 送回恢复队列

新增 host store 方法 `recoverWorkflowRun(runId)`：对**非终态**且**当前无活动 lease**（lease 为空或已过期）的 Run，以 status 为 CAS 置 `resumeRequired=true` 并清空 lease。此后 `WorkflowRunLane.pollOnce` 的 execution claim 会重新拿到它，按有无 Kernel 状态走 `rerun()`（有状态）或 `begin()`（无状态），即从最后一个安全步骤续跑。

- 对仍持有**活动 lease** 的 Run 返回 conflict（它正在被正常执行，无可恢复）。
- 对 `queued` 的 Run，`resumeRequired` 无实际影响，但语义一致（显式确认其进入队列）。

**备选**：直接复用 `markResumeRequired`。拒绝：它要求持有当前 lease，而用户恢复的恰是「lease 已丢失/过期」的 Run；语义相反。

**备选**：恢复通过 `failWorkflowRun` + 新建 Run 模拟。拒绝：丢掉了 Kernel 已持久化的进度，不是「从安全步骤恢复」。

### 决策 4：可解释性字段进入 Run 控制响应，不改公共 `runStatusSchema`

三个动作各自返回一个 `runControlResult` DTO（含 `runId`/`action`/`status`/`reuse`/`sideEffects`/`reason`），`reuse`/`sideEffects` 为面向用户的中文说明。重跑返回的是**新 Run 的投影**，取消/恢复返回原 Run 的投影。公共 `runStatusSchema` 五态不变（`queued/running/succeeded/failed/cancelled`），不新增「recovering」之类中间态——恢复是 `running` 的前置动作，不单独成态。

**备选**：给 `runSnapshotSchema` 加解释字段。拒绝：解释只属于控制动作的响应，不属于只读 Run 投影，避免污染稳定读合同。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 取消 = 用户覆盖式终态化（不要求持有 lease） | 采纳（决策 1） |
| 复用 `failWorkflowRun` 写成 `failed` | 拒绝（决策 1） |
| 取消要求先拿当前 lease | 拒绝（决策 1） |
| 重新运行 = 复用采集入队 + 新 idempotency key + manual | 采纳（决策 2） |
| 复用失败 Run 同一幂等键重放 | 拒绝（决策 2） |
| 新做「重跑 Run」Workflow 类型 | 拒绝（决策 2） |
| 恢复 = 送回恢复队列（无活动 lease 前置） | 采纳（决策 3） |
| 直接复用 `markResumeRequired` | 拒绝（决策 3） |
| 解释字段进 Run 控制响应 DTO | 采纳（决策 4） |
| 给公共 Run 投影加解释字段 | 拒绝（决策 4） |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：**无 Prisma schema 变更、无 migration**。取消/恢复只改写 `WorkflowRun` 既有列（status/resumeRequired/lease/finishedAt/updatedAt）；重跑产生一条新的 `WorkflowRun` 行。
- **接口**：新增三个 `POST` 端点与 `runControlResultSchema` DTO；`runStatusSchema` 与 `runSnapshotSchema` 不变。
- **安全**：三个动作只作用于本机 durable Run 行，不改 Secret、不读 Blob 内容、不触碰用户数据根之外的路径；取消/恢复是单 Run 级命令，无批量删除面。
- **迁移与发布**：无 migration；不涉及版本号、发布或部署。
- **回滚**：回滚代码后新增端点消失，新 DTO 未使用；无数据破坏（取消/恢复只改状态列，重跑产生的是普通 Run 行）。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements.md`：RUN-004 行补「v1 形态」；新增 Phase 2 第十一切片注记。
- `docs/architecture/0001-cosmos-foundation.md` §4：补充 Run 控制三动作（cancel/rerun/recover）与可解释性边界。
- `docs/adr/0016-run-control-v1.md`（新）：冻结决策 1–4；同步 ADR 索引；ADR-0001 恢复语义补一句「用户可主动触发恢复」。
- `docs/api/`：新增 Run 控制三端点与 conformance 场景（api-and-interface-design 冻结后）。
- `docs/spec/`：contracts（runControl 命令/DTO）、application（cancel/recover/rerun 编排）、storage（cancel/recover 写入路径）、interfaces（API 与 Web）。
- `.agents/tasks/{新编号}-run-control/README.md`：由维护者分配编号后创建。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-10 | 起草，状态 `reviewing`，等待裁决决策 1/2/3/4 与实施授权 | Agent |
| 2026-09-10 | **确认**：取消为用户覆盖式终态化（不要求持有当前 lease，决策 1）、重新运行 = 复用采集入队 + 新幂等键 + manual（决策 2）、恢复 = 送回恢复队列（无活动 lease 前置，决策 3）、解释字段进 Run 控制响应 DTO（决策 4）；并授权创建 worktree `.worktree/run-control` / 分支 `feat/t21-run-control` 实现与测试 | 用户（评审确认） |
