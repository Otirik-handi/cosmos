# Task 23：Trigger / SDK v1（Phase 2 第十三切片）

> 编号 23 由 Agent 建议、待维护者确认。

## User Request / Topic

2026-09-10 用户指示「继续平台面开发」，本切片为 Trigger/SDK（AUT-004、EXT-006/007）。Proposal [`trigger-sdk-v1`](../../../docs/proposals/trigger-sdk-v1.md) 起草后列出三项裁决（TriggerBinding 单绑定 + 从 config 迁移 scheduleIntervalMs、per-operation 声明放 SourceDefinitionManifest、EXT-003 保持现状）；用户接受并授权创建 worktree `.worktree/trigger-sdk` / 分支 `feat/t23-trigger-sdk`。稳定决定沉淀于 [`ADR-0018`](../../../docs/adr/0018-trigger-sdk-v1.md)，PRD 注记与 ADR 索引已同步。

## Goal

把定时触发显式建模为一等实体，并让 manifest 完整声明 Adapter 的认证/操作/状态/媒体：

```text
TriggerBinding   -> 实体（schedule/manual）+ 从 SourceInstance.config.scheduleIntervalMs 迁出 + 调度循环改读 listScheduleTriggers
SourceDefinition -> manifest 扩展 auth（none/oauth/cookie/secret_ref/external）+ operations（input/output/external key/discovery/media/stateStore）
EXT-003          -> 版本化 Command/Query/Event 保持现状
```

## Scope / Non-goals

Scope：

- Prisma：`TriggerBinding` 表 + migration `20260910140000_trigger_binding_v1`（JSON 回填 scheduleIntervalMs → TriggerBinding + 从 config 移除）。
- contracts：`triggerBindingSchema`/`triggerConfigSchema`/`triggerIntervalSchema`；`sourceSnapshotSchema.scheduleIntervalMs`（顶层）+ `createSourceCommandSchema`/`updateSourceCommandSchema` 的 `scheduleIntervalMs`；`sourceDefinitionManifestSchema` 的 `auth`/`operations`。
- application：`SourceDefinitionManifest` 接口扩展 + builtin catalog 补 auth/operations；`CosmosRepository.listScheduleTriggers()`；`queueScheduledSources` 改读 trigger。
- storage：`TriggerBinding` 读写（create/update source 建/改/删）、`listScheduleTriggers()`、`toSourceSnapshot.scheduleIntervalMs`。
- worker：`scheduling.ts` 改读 `listScheduleTriggers()`。
- API：`toPublicSource` 顶层回显 `scheduleIntervalMs`/`connectionId`。
- Web：来源表单定时字段移到顶层 `scheduleIntervalMs`；`source-actions` 读顶层。

Non-goals（见 Proposal / ADR-0018）：

- webhook/内部事件/条件变化/上游结果触发（AUT-004 完整形态）。
- 自定义 Trigger/Action 的插件运行时注册（AUT-005）。
- 多计划/overlap policy（随 CollectionPlan）。

## 权威合同

- Proposal [`trigger-sdk-v1`](../../../docs/proposals/trigger-sdk-v1.md)（accepted，2026-09-10）。
- ADR [`0018`](../../../docs/adr/0018-trigger-sdk-v1.md)；ADR [`0001`](../../../docs/adr/0001-durable-workflow-runtime.md)、ADR [`0017`](../../../docs/adr/0017-connection-secret-state-v1.md)。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) AUT-004/EXT-006/007 与 §7.5 第十三切片注记。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §4.1/§4.4。

## Current State

- 生命周期阶段：实现完成并通过聚焦测试 + 全仓类型检查；文档已同步。已合并 `master` 并推送（commit `e8c2f84`，无 PR，单开发者仓库）；worktree `.worktree/trigger-sdk` 与分支 `feat/t23-trigger-sdk` 已清理。
- 连贯目标：定时触发成为一等实体，manifest 完整声明 Adapter 合同。
- 可观察验收（≤3 条）：
  1. 创建带 `scheduleIntervalMs` 的来源会生成 schedule TriggerBinding，启用后 `listScheduleTriggers` 返回该绑定；
  2. `updateSource` 传 `scheduleIntervalMs` 会 upsert、传 null 会移除定时；
  3. `SourceDefinitionManifest` 回显 `auth` 与 `operations`（external key/discovery/media/stateStore 命名空间）。
- 依赖：Task 02（SourceInstance）、Task 22（Connection/Secret/State）。
- 受影响合同：contracts（trigger DTO、manifest 扩展、source 命令/投影）、application（catalog + listScheduleTriggers）、storage（TriggerBinding 表与读写）、worker（调度循环）、API（source 投影）、Web（source 表单/来源行）。
- 验证层级：focused（contracts/storage/worker/transport/web）→ 全量门禁。

## Decisions and Deviations

- 以 ADR-0018 三条为稳定边界。
- migration 用 SQLite `json_extract`/`json_remove` + 确定性 id `trigger:<sourceId>` 做 backfill；`TriggerBinding.enabled` 回填为来源 enabled。
- `sourceSnapshotSchema.scheduleIntervalMs` 用 `.optional()`（向后兼容），但 `toSourceSnapshot` 始终写入（未配置为 null）。
- `source-form` 的定时字段从 config 移到顶层，`readManifestFields` 不再渲染 `scheduleIntervalMs`（config 里已无此字段），改为硬编码的「定时抓取间隔（分钟）」字段。

## Implementation Walkthrough

1. **migration**：`20260910140000_trigger_binding_v1` 建 `TriggerBinding` + 回填 + 从 configJson 移除 scheduleIntervalMs。
2. **contracts**：trigger DTO + source 命令/投影加 `scheduleIntervalMs` + `sourceDefinitionManifestSchema` 的 `auth`/`operations`。
3. **application**：`SourceDefinitionManifest` 接口 + builtin catalog（`sourceOperation`/`noAuth`/`externalAuth` 辅助）；`CosmosRepository.listScheduleTriggers`；`queueScheduledSources` 改读 trigger。
4. **storage**：`createSource`/`updateSource` 事务内建/改/删 TriggerBinding；`listScheduleTriggers`；`toSourceSnapshot.scheduleIntervalMs`。
5. **worker**：`scheduling.ts` 的 `ScheduleQueueOptions.listScheduleTriggers` + main.ts 接线。
6. **API**：`toPublicSource` 顶层回显 schedule/connection。
7. **Web**：source-form 定时字段顶层化 + source-actions 读顶层 + product-fixtures manifest 补 auth/operations。

## Verification / Gate

验证（2026-09-10，实际运行）：

- `bun run typecheck` 全仓通过（含 apps/api、apps/worker、apps/web tsc --noEmit）。
- focused 测试：
  - contracts `trigger.test.ts` 4/4（trigger binding/config、source 命令 schedule、manifest auth/operations）；
  - storage `trigger-binding.test.ts` 2/2（create 建 trigger + 启用后 listScheduleTriggers、updateSource upsert/移除）；
  - worker `scheduling.test.ts` 4/4（改读 listScheduleTriggers）；
  - storage `index.test.ts`「queues a scheduled source once per interval bucket」修复后通过（schedule 移到顶层）。
- storage 串行：17 文件 / 125 用例，124 通过 + 1 例「queued scheduled source」因 schedule 迁移到顶层后修复为通过（复跑单例已绿）。
- 未运行：全量 `bun run test`、浏览器产品/组件实验室 E2E、Windows smoke、Docker、发布部署（均记为未运行/既有后置边界）。

## Follow-ups

- webhook/内部事件/条件/上游结果触发（AUT-004 完整形态）。
- 自定义 Trigger/Action 插件运行时（AUT-005，Phase 3）。
- CollectionPlan/多计划 + TriggerBinding 多绑定 + overlap policy。
- 真实认证 Adapter 接入（manifest auth 驱动登录生命周期 + Connection/SecretRef）。
- Phase 2 平台面最后一块：OPS-003/004（存储占用统计 + 备份/恢复/导出/清理）。
