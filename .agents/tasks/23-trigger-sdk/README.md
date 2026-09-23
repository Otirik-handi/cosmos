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
- **本 Task 于 2026-09-22 被复用承接切片 2**（AUT-004 口径裁定与 Webhook v1 设计）：复用理由是其 Follow-ups 第一条正是本项，且本 Task 覆盖的合同（`TriggerBinding`／触发类型／manifest）未变，不需要新编号。切片 2 完成裁定与设计冻结；切片 3 已在 worktree `.worktree/trigger-webhook`（分支 `feat/t23-trigger-webhook`）实现并提交（`2bebe21`）；切片 4a／4b（`fa5c5c3`）与切片 5（`0b3754e`）已在同一分支实现并提交；切片 6 在同一分支实现并通过全量单元、Node 进程 E2E 与浏览器 E2E，**尚未提交**。见下方「实施切片」。
- 连贯目标：定时触发成为一等实体，manifest 完整声明 Adapter 合同。
- 可观察验收（≤3 条）：
  1. 创建带 `scheduleIntervalMs` 的来源会生成 schedule TriggerBinding，启用后 `listScheduleTriggers` 返回该绑定；
  2. `updateSource` 传 `scheduleIntervalMs` 会 upsert、传 null 会移除定时；
  3. `SourceDefinitionManifest` 回显 `auth` 与 `operations`（external key/discovery/media/stateStore 命名空间）。
- 依赖：Task 02（SourceInstance）、Task 22（Connection/Secret/State）。
- 受影响合同：contracts（trigger DTO、manifest 扩展、source 命令/投影）、application（catalog + listScheduleTriggers）、storage（TriggerBinding 表与读写）、worker（调度循环）、API（source 投影）、Web（source 表单/来源行）。
- 验证层级：focused（contracts/storage/worker/transport/web）→ 全量门禁。

## 实施切片

> 切片 2–7 的详细过程、验证与偏差记录（2026-09-22／23，原文与结论未改）已归档到 [`readme/slices-2026-09-22-23.md`](readme/slices-2026-09-22-23.md)；下面只留每片的结论。

1. **切片 1 Trigger/SDK v1**：✅ 已交付并合并 `master`（commit `e8c2f84`）——`TriggerBinding` 实体（`schedule`/`manual`）+ 从 `SourceInstance.config.scheduleIntervalMs` 迁移 + manifest 的 `auth`/`operations` 声明。
2. **切片 2 AUT-004 口径裁定与 Webhook v1 设计**：✅ 文档阶段完成（2026-09-22，无代码改动）。
3. **切片 3 触发类型与证据扩展**：✅ 已实现并提交（`2bebe21`）。
4. **切片 4a 一计划多触发器（数据模型）**：✅ 已实现并提交；稳定决定见 ADR [`0025`](../../../docs/adr/0025-multi-trigger-per-plan.md)。
5. **切片 4b Webhook 入口标识与凭证**：✅ 已实现并提交。
6. **切片 5 inbound 端点**：✅ 已实现并提交（`0b3754e`）。
7. **切片 6 计划面板入口展示**：✅ 已实现，浏览器 E2E 通过。
8. **切片 7 真实消费者验收**：✅ 已跑通（真实外网，经入口触发）；**AUT-004 的 Phase 2 部分至此闭合**，合并仍需维护者授权。
9. **切片 8 per-operation 配置 schema 与 Bilibili `search`**（Proposal [`connection-login-lifecycle-v1`](../../../docs/proposals/connection-login-lifecycle-v1.md) 决定 3，即该 Proposal 的「切片 2」；EXT-006 的「多 operation 有真实消费者」）：✅ 已完成、验证（2026-09-23，worktree `.worktree/ext-006-login-lifecycle`／分支 `feat/t22-ext-006-login-lifecycle`，**未提交**）。范围：`sourceOperationManifestSchema` 增可空 `configurationSchema`（`null` = 沿用定义级那份）；canonical 校验改按 `(sourceDefinitionRef, operationId)` 检索（`getSourceConfigurationSchema(ref, operationId)` + `sourceOperationConfigurationSchemas` 注册表 + `bilibiliSearchSourceConfigSchema`，未登记即回退定义级，所以 `source.rss@1` 与 `bilibili.fetch` 的校验结果不变）；catalog 里 Bilibili 声明 `operationIds: ["fetch", "search"]`，`search` 自带配置 schema（`query` 必填、`limit` 可选）、`discoveryContext: "search"`、`stateStoreNamespace: null`；连接器把执行决定抽成 `planBilibiliSearchExecution`／`planBilibiliFetchExecution`（命令参数、要不要带 profile、结果归类一次算清；搜索匿名可用、`kind = video`、`discoveryChannel = search`、locator mode 为 `search`）；API／transport 透传调用方提交的 `operationId`；Web 在 `operationIds` 多于一个时出操作选择器（默认第一个），字段按所选操作渲染、切换定义或操作都重置配置，保存与探测都提交所选 `operationId`（`fieldPresentation` 补「查询词」）。**没有**数据库迁移，也没有新路由。验证：`bun run typecheck` 全仓 PASS；`bun run test` **124 文件 / 725 用例全绿**（基线 720，+5 为本切片新增）；`bun run lint:web` 0 errors（79 条既有 warning）；组件实验室 E2E **19 passed**（含新增「按所选 operation 渲染字段」1 例）；浏览器产品 E2E 定向 `collection-plan-connectors.spec.ts` **3 passed**（含新增「按 manifest 声明的操作建出 Bilibili 搜索计划」1 例）；`docs:check` 759 文件 0 失败；size 门禁 PASS；`git diff --check` 干净。契约快照 `packages/contracts/entry-surface.txt` 按脚本重生成（+1 行：`bilibiliSearchSourceConfigSchema`）。未运行：Node 进程 E2E（本片不涉及 Job／Worker 路径）、`test:real:bilibili`（需本机 OpenCLI 登录态）、`test:real:entry` 与其余真实来源验收、Docker。依赖：切片 4a／4b（连接承载登录态与探测声明）。

**切片 8 验证暴露的既有问题（非本片引入，已在本分支修复）**：浏览器产品 E2E **全套件**曾在累积数据下不稳定——两次运行分别 32 passed／1 failed（`webhook-entry`）与 31 passed／2 failed（`webhook-entry` + `phase2-organization`），而这两例在同一构建上单独运行都通过。根因定位到布局而不是测试：1280×720 下左侧固定轨道（`lg` 300px／`xl` 330px）里的连接面板内容不收缩（`min-content` 实测 398px，授权范围写长 JSON 时 1015px），画到右侧计划列表上并挡住计划行的 Webhook 按钮，所以点击被拦截。修法是把 `min-w-0` 铺到连接面板那条 flex/grid 链上（面板根、列表、条目、`dl` 行）；修后 `aside.scrollWidth` 在两个断点都等于列宽（330／300），连接名仍截断、按钮仍在列内、长授权范围在栏内换行，浏览器全套件 **33 passed**（2.3m）。修复前的截图与 error-context 在 `.agent/tmp/browser-flake-2026-09-23/`，修复后的量测与截图在 `.agent/tmp/measure-sidebar.mjs`／`.agent/tmp/sidebar-after-1280.png`（诊断脚本与证据均不入库）。

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

- webhook 形态（AUT-004 的 Phase 2 部分）：切片 3–7 已实现并提交，切片 7 已在真实外网跑通；合并进 master 仍需维护者授权。
- 浏览器产品 E2E 的全套件稳定性（2026-09-23 切片 8 验证时登记，**同批已修**）：根因是固定宽度侧栏里的连接面板不收缩（`min-content` 398px，长授权范围 1015px）而画到计划列表上，导致 `webhook-entry` 的点击被拦截、`phase2-organization` 连带超时。已给连接面板的 flex/grid 链铺 `min-w-0`，全套件 33 passed。
- 内部事件／条件变化／上游 Workflow 结果触发：已按 2026-09-22 裁定记 Phase 3（消费者分别是 Knowledge Workflow 与用户自定义 Workflow 产品面）。
- 自定义 Trigger/Action 插件运行时（AUT-005，Phase 3）。
- CollectionPlan/多计划 + TriggerBinding 多绑定 + overlap policy。
- 真实认证 Adapter 接入（manifest auth 驱动登录生命周期 + Connection/SecretRef）。
- Phase 2 平台面最后一块：OPS-003/004（存储占用统计 + 备份/恢复/导出/清理）。
- 治理欠账（2026-09-22 登记，不随本 Task 执行）：`docs/spec/interfaces/0005-web-client.md`（52.4 KB）、`docs/spec/storage/0001-prisma-repository.md`（51.6 KB）已超 50 KB 红线，`docs/spec/contracts/0001-public-contracts.md`（45.9 KB）在警戒区；三者都在治理基线内，门禁只报 warning。需要一次 G 系列拆分，拆分前不要继续往这三个文件追加内容。
