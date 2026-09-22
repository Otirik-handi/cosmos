# Task 23：Trigger / SDK v1（Phase 2 第十三切片）

> 编号 23 经维护者 2026-09-21 确认。

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

- 内部事件／条件变化／上游 Workflow 结果触发（AUT-004 的其余三种形态，2026-09-22 裁定记 Phase 3）。
- 自定义 Trigger/Action 的插件运行时注册（AUT-005）。
- 多计划/overlap policy（随 CollectionPlan）。

切片 3–7 范围（AUT-004 Webhook 形态，2026-09-22 裁定与设计冻结，见 ADR [`0024`](../../../docs/adr/0024-trigger-forms-v1.md)）：

- contracts：触发类型新增 `webhook`（`triggerKindSchema` 与 `ingestTriggerKindSchema`）；触发证据新增可选的「触发来源」字段（绑定标识 + 外部事件标识）。
- application：`enqueue()` 接受并固化触发证据；Run 投影透出触发原因。
- storage/Prisma：`TriggerBinding` 增加入口标识（不可猜、唯一）与 `SecretRef`；migration 加列，仅 `kind = webhook` 的行写入。
- API：新增 inbound 端点（独立于 `/api/v1`），含凭证校验、幂等、限流、体积上限与请求体脱敏。
- Web：计划面板展示入口地址与凭证状态，支持生成／轮换／停用。
- 验收：API 行为测试、浏览器 E2E，以及「用户自己的自动化」真实消费者验收。

切片 3–7 的 Non-goals：平台推送（等真实认证 Adapter）、入口公网暴露与 TLS、入口凭证加密-at-rest、ADR-0023 的 contract 步，以及 `docs/spec/` 的同步（行为落地后再收敛）。

## 权威合同

- Proposal [`trigger-sdk-v1`](../../../docs/proposals/trigger-sdk-v1.md)（accepted，2026-09-10）。
- ADR [`0018`](../../../docs/adr/0018-trigger-sdk-v1.md)；ADR [`0001`](../../../docs/adr/0001-durable-workflow-runtime.md)、ADR [`0017`](../../../docs/adr/0017-connection-secret-state-v1.md)。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) AUT-004/EXT-006/007 与 §7.5 第十三切片注记。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §4.1/§4.4。

## Current State

- 生命周期阶段：实现完成并通过聚焦测试 + 全仓类型检查；文档已同步。已合并 `master` 并推送（commit `e8c2f84`，无 PR，单开发者仓库）；worktree `.worktree/trigger-sdk` 与分支 `feat/t23-trigger-sdk` 已清理。
- **本 Task 于 2026-09-22 被复用承接切片 2**（AUT-004 口径裁定与 Webhook v1 设计）：复用理由是其 Follow-ups 第一条正是本项，且本 Task 覆盖的合同（`TriggerBinding`／触发类型／manifest）未变，不需要新编号。切片 2 完成裁定与设计冻结；切片 3 已在 worktree `.worktree/trigger-webhook`（分支 `feat/t23-trigger-webhook`）实现并通过全量单元测试与类型检查，**尚未提交**。见下方「实施切片」。
- 连贯目标：定时触发成为一等实体，manifest 完整声明 Adapter 合同。
- 可观察验收（≤3 条）：
  1. 创建带 `scheduleIntervalMs` 的来源会生成 schedule TriggerBinding，启用后 `listScheduleTriggers` 返回该绑定；
  2. `updateSource` 传 `scheduleIntervalMs` 会 upsert、传 null 会移除定时；
  3. `SourceDefinitionManifest` 回显 `auth` 与 `operations`（external key/discovery/media/stateStore 命名空间）。
- 依赖：Task 02（SourceInstance）、Task 22（Connection/Secret/State）。
- 受影响合同：contracts（trigger DTO、manifest 扩展、source 命令/投影）、application（catalog + listScheduleTriggers）、storage（TriggerBinding 表与读写）、worker（调度循环）、API（source 投影）、Web（source 表单/来源行）。
- 验证层级：focused（contracts/storage/worker/transport/web）→ 全量门禁。

## 实施切片

1. **切片 1 Trigger/SDK v1**：✅ 已交付并合并 `master`（commit `e8c2f84`）——`TriggerBinding` 实体（`schedule`/`manual`）+ 从 `SourceInstance.config.scheduleIntervalMs` 迁移 + manifest 的 `auth`/`operations` 声明。过程与验证见上方 Implementation Walkthrough 与 Verification / Gate。
2. **切片 2 AUT-004 口径裁定与 Webhook v1 设计**：✅ 文档阶段完成（2026-09-22），**代码未实现**。裁定 Phase 2 只交付 `webhook` 一种剩余形态（`event`／`condition`／`dependency` 记 Phase 3，`poll` 不单列类型），并冻结入口的定位对象（`TriggerBinding`，`planId` 优先否则按来源）、不可猜的不透明标识、凭证走 SecretStore 并沿用明文-at-rest 边界、幂等／限流／体积上限／脱敏四项要求、触发的原因/输入/时间/定义版本四项证据落 Run 既有位置、v1 验收消费者取用户自己的自动化。权威合同：Proposal [`trigger-forms-v1`](../../../docs/proposals/trigger-forms-v1.md)（accepted）、ADR [`0024`](../../../docs/adr/0024-trigger-forms-v1.md)、架构主文档决定 86、PRD 勘误台账 2026-09-22 行。验证：`bun run docs:check` 通过（734 文件、`failures: []`）；`typecheck`／`test`／E2E 未运行（本切片无代码改动）。下一步：按 ADR-0024 拆实现切片（inbound 端点、绑定标识与凭证、触发证据扩展、计划面板的入口展示），开工前在下方记录本轮假设。
3. **切片 3 触发类型与证据扩展**：✅ 已实现（2026-09-22，worktree `.worktree/trigger-webhook`／分支 `feat/t23-trigger-webhook`，**未提交**）。`triggerKindSchema`／`ingestTriggerKindSchema`／`ingestCommandSchema` 加 `webhook`；新增 `ingestTriggerEvidenceSchema`（绑定标识 + 外部事件标识 + 收到时间，三个字段同进同出）；`ingestWorkflowInputSnapshotSchema` 新增可选 `triggerEvidence`（兼容既有 Run 快照），并**在入队边界拒绝没有证据的 webhook Run**；`enqueue()` 写入该证据，`RunSnapshot` 与 `toPublicWorkflowRun` 透出触发原因（无证据时显式 `null`）；`repository-port` 的三处触发类型与 storage 的两处签名改用合同的 `IngestTriggerKind`，legacy 行投影的断言同步放宽；Web 的触发类型展示名补 `webhook: "外部触发"`。偏差：计划里字段名叫 `trigger`，实现用 `triggerEvidence`（与 `runSnapshotSchema` 的读投影同名，避免两处各叫一个名字）；Web 展示名是临时文案，待 UI 文案批次（P3-2）确认。验证：`bun run typecheck` 全仓 PASS；`bun run test` 116 文件 / 664 用例全绿（基线 656，+8 为本切片新增）；`packages/contracts/entry-surface.txt` 按脚本重新生成（+2 行，值导出与类型导出各一）。未运行：Node 进程 E2E、浏览器 E2E、真实来源验收（本切片不涉及）。依赖：无。

`docs/spec/` 同步（2026-09-22，与切片 3 同批）：[`application/0005-ingest-workflow-control.md`](../../../docs/spec/application/0005-ingest-workflow-control.md)（canonical owner：enqueue 签名与证据规则、输入/输出/错误、重建验收三条、实现与测试锚点）与 [`contracts/0001-public-contracts.md`](../../../docs/spec/contracts/0001-public-contracts.md)（TriggerBinding kind、IngestCommand、TriggerEvidence、RunSnapshot）记录 webhook 与触发证据；[`application/0006-ingest-workflow.md`](../../../docs/spec/application/0006-ingest-workflow.md) 与 [`storage/0001-prisma-repository.md`](../../../docs/spec/storage/0001-prisma-repository.md) 的触发类型取值同步；[`docs/spec/README.md`](../../../docs/spec/README.md) 的术语表与跨组件约束同步。同批修掉一处既有偏差：0005 里 `manifestHash` 仍写 `source-snapshot-v1`，实现自 Task 20 起是 `v2`（字节中性修正）。未改 [`interfaces/0005-web-client.md`](../../../docs/spec/interfaces/0005-web-client.md)：它没有记录 Run 历史的触发类型展示名，且该文件已超 50 KB 红线。治理观察：`contracts/0001-public-contracts.md`（45.9 KB）、`storage/0001-prisma-repository.md`（51.6 KB）与 `interfaces/0005-web-client.md`（52.4 KB）都在基线内继续增长，门禁只报 warning；它们需要一次拆分（G 系列），本切片不做。
4. **切片 4 Webhook 绑定：入口标识与凭证**（未开始）：`TriggerBinding` 增加不可猜的唯一入口标识与 `SecretRef`（migration 加列，仅 `kind = webhook` 的行写入）；服务端生成凭证写入 SecretStore，公开快照只回显入口地址与「是否已配置」，不回显明文；计划命令支持生成／轮换／停用。验收：storage 断言标识唯一、凭证不进普通配置与日志；contracts 断言快照不含明文。依赖：切片 3。
5. **切片 5 inbound 端点**（未开始）：新增独立于 `/api/v1` 的入口路由（`apps/api` 的路由表断言测试同批更新）；凭证校验失败与绑定不存在返回同一结果、不泄露绑定是否存在；外部事件标识作为幂等键；单入口最小间隔与请求体上限；请求体不进日志与 DomainEvent payload，只记摘要；入队复用 `workflowControl.enqueue({ triggerKind: "webhook", ... })`。验收：正确凭证只入队一次、重复事件不产生第二个 Run、错误凭证与超限均不写入。依赖：切片 4。
6. **切片 6 计划面板入口展示**（未开始）：计划行/详情显示入口地址与凭证状态，提供生成／轮换／停用与调用示例。验收：浏览器 E2E——新建带 Webhook 触发的计划，调用入口后计划下出现触发原因为 webhook 的 Run。依赖：切片 5。
7. **切片 7 真实消费者验收**（未开始）：用本机脚本（`scripts/e2e/` 新增或扩展）作为 ADR-0024 决定 6 的「用户自己的自动化」调入口，跑通一次真实 RSS 抓取。依赖：切片 5（可与切片 6 并行）。

切片 3 开工前需要在 Task 里记录的三项实现细节（不在 ADR 层裁定）：请求体上限与最小间隔的具体值；外部事件标识是否必填；凭证明文只回显一次还是可重复查看（SecretStore 明文-at-rest 意味着技术上可重复读，产品行为需明确）。

环境偏差（2026-09-22，影响后续切片）：本机无法访问 `binaries.prisma.sh`，新 worktree 里 `bun run db:generate` 会失败、`bun install` 也不会落地引擎二进制。处理方式是从主工作区复用已生成的 Prisma client 与引擎：把 `node_modules/.bun/@prisma+client@6.19.3+*/node_modules/.prisma` 复制到 worktree 的 `node_modules/.prisma`，把 `schema-engine-windows.exe` 与 `query_engine-windows.dll.node` 复制到 worktree 的 `node_modules/@prisma/engines/`。复制前核对生成物的 `schema.prisma` 与当前 schema 一致（仅格式化差异），并确认主工作区 `typecheck:storage` 通过。缺引擎时 DB 类测试会以 `prisma migrate deploy` 超时失败（每个用例约 70 秒），不是代码回归。

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

- webhook 形态（AUT-004 的 Phase 2 部分）：设计已冻结（切片 2、ADR-0024）；切片 3（触发类型与证据）已实现并提交（`2bebe21`），切片 4–7 未开始。
- 内部事件／条件变化／上游 Workflow 结果触发：已按 2026-09-22 裁定记 Phase 3（消费者分别是 Knowledge Workflow 与用户自定义 Workflow 产品面）。
- 自定义 Trigger/Action 插件运行时（AUT-005，Phase 3）。
- CollectionPlan/多计划 + TriggerBinding 多绑定 + overlap policy。
- 真实认证 Adapter 接入（manifest auth 驱动登录生命周期 + Connection/SecretRef）。
- Phase 2 平台面最后一块：OPS-003/004（存储占用统计 + 备份/恢复/导出/清理）。
- 治理欠账（2026-09-22 登记，不随本 Task 执行）：`docs/spec/interfaces/0005-web-client.md`（52.4 KB）、`docs/spec/storage/0001-prisma-repository.md`（51.6 KB）已超 50 KB 红线，`docs/spec/contracts/0001-public-contracts.md`（45.9 KB）在警戒区；三者都在治理基线内，门禁只报 warning。需要一次 G 系列拆分，拆分前不要继续往这三个文件追加内容。
