# Task 21：Run 控制 v1（Phase 2 第十一切片）

> 编号 21 由 Agent 建议、待维护者确认（用户授权「创建 worktree/分支并在其中实现与测试」，未显式指定编号）。

## User Request / Topic

2026-09-10 用户指示「完成Phase 2剩余切片：平台面（RUN-004、Connection/StateStore、Trigger/SDK、OPS-003/004）」，并按 PROJECT-STATUS 既定排序从 RUN-004 开始。Proposal [`run-control-v1`](../../../docs/proposals/run-control-v1.md) 起草后列出四项裁决（取消语义、重跑语义、恢复语义、可解释性归属）；用户接受四项默认建议并授权创建 worktree `.worktree/run-control` / 分支 `feat/t21-run-control`。稳定决定沉淀于 [`ADR-0016`](../../../docs/adr/0016-run-control-v1.md)，PRD RUN-004 注记与 ADR 索引已同步。

## Goal

交付 RUN-004 的三个控制动作，让用户能主动干预 durable `WorkflowRun`：

```text
取消      -> POST /runs/:id/cancellations   用户覆盖式终态化 cancelled + fence Worker 后续写入（不要求持有当前 lease）
重新运行  -> POST /runs/:id/re-runs         复用采集入队产生全新 Run（新幂等键 + manual），复用已入库结果、从当前 checkpoint 重新 fetch
恢复      -> POST /runs/:id/recoveries      把失去活动 lease 的非终态 Run 置 resumeRequired 送回恢复队列，Kernel rerun() 续跑
可解释    -> 响应携带 reuse/sideEffects 面向用户说明；公共 Run 五态与投影不变、零数据迁移
```

## Scope / Non-goals

Scope：

- contracts：`cancelRunCommandSchema`/`recoverRunCommandSchema`/`rerunRunCommandSchema` + `runControlResultSchema`（复用 `runSnapshotSchema`）。
- application：`WorkflowHostStore` 新增 `cancelWorkflowRun`/`recoverWorkflowRun`（workflow-host.ts 端口 + 类型）；`IngestWorkflowControlService.rerun`。
- storage：`PrismaWorkflowHostStore.cancelWorkflowRun`/`recoverWorkflowRun`（status CAS + 清 lease + `run.cancelled.v1` 事件）。
- API：`POST /runs/:runId/cancellations`、`/recoveries`、`/re-runs` 三端点 + `GET /runs` 运行记录列表 + 错误漏斗 `runControlError`。
- transport：`HttpCosmosClient.cancelRun`/`recoverRun`/`rerunRun`/`listRuns`。
- Web：`RunControl` 组件（状态 + 三按钮 + 复用/副作用说明）+ `RunHistory` 组件（Run 列表 + 详情 + 控制接线）+ 组件实验室登记 + 产品页「运行记录」面板。

Non-goals（见 Proposal / ADR-0016）：

- Step 级选择性重放；legacy `Run` 泳道的控制。
- 定时/批量取消或重跑；重跑队列管理。
- 公共 Run 状态枚举变更（五态不变）。

## 权威合同

- Proposal [`run-control-v1`](../../../docs/proposals/run-control-v1.md)（accepted，2026-09-10，用户确认四项默认）。
- ADR [`0016`](../../../docs/adr/0016-run-control-v1.md)；ADR [`0001`](../../../docs/adr/0001-durable-workflow-runtime.md)、ADR [`0002`](../../../docs/adr/0002-nb-workflow-kernel-cosmos-host.md)。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) RUN-004 与 §7.5 第十一切片注记。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §4。

## Current State

- 生命周期阶段：实现完成并通过聚焦测试 + 全仓类型检查；文档（Proposal accepted / ADR-0016 / PRD / ADR 索引 / Task）已同步。已提交并推送 `feat/t21-run-control`（commit `1f879f4`），未合并 `master`。
- 连贯目标：让用户能取消、重跑、恢复一个 Run，并明确看到每个动作的后果。
- 可观察验收（≤3 条）：
  1. 取消一个运行中的 Run 后，其状态变为 `cancelled`、旧 Worker 的心跳/写入被 fence 拒绝；
  2. 对一个终态 Run 重新运行后，得到一个新的 `manual` Run，且复用已入库内容、从当前 checkpoint 重新抓取；
  3. 恢复一个失去活动 lease 的非终态 Run 后，其 `resumeRequired` 置真、可被 Worker 重新认领续跑。
- 依赖：Task 04（Workflow Runtime）、Task 07（Deferred Workflow Host）。
- 受影响合同：contracts（Run 控制命令/结果 DTO）、application（WorkflowHostStore 端口）、storage（Run 控制写入路径）、API（三端点）、transport（客户端方法）、Web（RunControl 组件）。
- 验证层级：focused（contracts/application/storage/api/transport/web）→ 全量门禁。

## Decisions and Deviations

- 以 ADR-0016 四条为稳定边界。
- **取消不要求持有当前 lease**（用户覆盖）：fence 效果来自「status → cancelled + 清 lease」，Worker 后续 `heartbeatRun`/`completeActivity`/`releaseRun` 因 lease CAS 失败而拒绝写入。
- **重跑从 `inputSnapshot.source.id` 取来源**（不读 `productRun`），并复用既有 `enqueue`，保证「从当前 checkpoint 重新抓取」而非重放旧 cursor。
- **恢复对活动 lease 返回 conflict**：Worker 还在执行的 Run 不触发恢复，避免抢占正在进行的正常执行。
- **解释字段只进 `runControlResultSchema`**，不改 `runSnapshotSchema`/`runStatusSchema`。

## Implementation Walkthrough

1. **contracts**（`index.ts`）：`runControlActionSchema`、三个命令 schema、`runControlResultSchema`。
2. **application**（`workflow-host.ts`）：`CancelWorkflowRunInput`/`RecoverWorkflowRunInput` 类型 + `WorkflowHostStore.cancelWorkflowRun`/`recoverWorkflowRun` 端口；`workflow-control.ts` 新增 `IngestWorkflowControlService.rerun`。
3. **storage**（`workflow-host-store.ts`）：实现 `cancelWorkflowRun`/`recoverWorkflowRun`（事务内 status CAS），新增 `appendWorkflowRunCancelledEvent`（`run.cancelled.v1`）。
4. **API**（`app.controller.ts`）：三个 `POST` 端点 + `GET /runs` 列表 + `runControlError` 错误漏斗（not_found→404 / conflict→409 / invalid_state→400）+ `requireWorkflowStore`/`toRunControlResult` 辅助。
5. **transport**（`index.ts`）：`cancelRun`/`recoverRun`/`rerunRun`/`listRuns` 客户端方法。
6. **Web**：`components/cosmos/run-control.tsx` + `run-history.tsx`（列表自取数 + 详情展开 RunControl + 控制后重取）+ `product-fixtures.renderRunControlLab` + `registry.tsx` 登记 + page.tsx「运行记录」面板（`runRefreshToken` 驱动刷新）。

## Verification / Gate

验证（2026-09-10，实际运行）：

- `bun run typecheck` 全仓通过（含 apps/api、apps/worker、apps/web tsc --noEmit）；`git diff --check` 干净；`bun run docs:check` 388 文件 failures=[]。
- focused 测试：
  - contracts `run-control.test.ts` 4/4；
  - application `workflow-control.test.ts` 4/4（重跑入队、非终态 conflict、缺失 not_found、非 ingest invalid_state）；
  - storage `workflow-host-store.test.ts` 26/26（含 Run control 4 例 + `listWorkflowRuns` 1 例：倒序/limit/sourceId 过滤）；
  - api `app.controller.run-control.test.ts` 7/7（含 `listRuns` 2 例）；
  - transport-http 16/16（含 `listRuns` 1 例）、application 全量 92/92、web component-lab 27/27。
- 全量 `bun run test`：54 文件 / 485 用例，437 通过；48 例失败全部是既有 Windows SQLite 并行负载抖动（`migrate deploy` 5s 超时 + EBUSY），串行复跑 storage 14 文件 / 117 用例全部通过。
- 未运行：浏览器产品/组件实验室 E2E、Windows smoke、Docker、发布部署（均记为未运行/既有后置边界）。

## Follow-ups

- Step 级选择性重放、legacy Run 泳道控制按 ADR-0016 Revisit Gate 评估。
- 运行记录列表只含 durable `WorkflowRun`（`GET /runs`），legacy SQL Run 泳道不纳入列表；后续如需统一需在 `GET /runs` 合并两泳道。
- 运行记录面板暂不支持分页/按来源筛选 UI（后端 `sourceId`/`limit` 已就绪），需要时再接筛选控件。
- Phase 2 平台面其余切片：Connection/StateStore、Trigger/SDK、OPS-003/004（按既定排序继续）。
