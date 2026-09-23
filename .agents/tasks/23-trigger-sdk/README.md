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
- **本 Task 于 2026-09-22 被复用承接切片 2**（AUT-004 口径裁定与 Webhook v1 设计）：复用理由是其 Follow-ups 第一条正是本项，且本 Task 覆盖的合同（`TriggerBinding`／触发类型／manifest）未变，不需要新编号。切片 2 完成裁定与设计冻结；切片 3 已在 worktree `.worktree/trigger-webhook`（分支 `feat/t23-trigger-webhook`）实现并提交（`2bebe21`）；切片 4a／4b 在同一分支实现并提交（`fa5c5c3`）；切片 5 在同一分支实现并通过单元与 Node 进程 E2E，**尚未提交**。见下方「实施切片」。
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

`docs/spec/` 同步（2026-09-22，与切片 4a／4b 同批）：[`storage/0001-prisma-repository.md`](../../../docs/spec/storage/0001-prisma-repository.md) 的模型表补 `CollectionPlan` 与 `TriggerBinding` 两行（后者的唯一约束改为 `(sourceId, kind)`／`(planId, kind)`，并记录 webhookToken/secretRef 只由 webhook 行使用）；[`interfaces/0002-product-api-http.md`](../../../docs/spec/interfaces/0002-product-api-http.md) 补采集计划的 5 条路由（含新增的 `POST`／`DELETE /collection-plans/:planId/webhook-entry`）与「入口地址不是凭证、明文只回显一次」的边界；[`contracts/0001-public-contracts.md`](../../../docs/spec/contracts/0001-public-contracts.md) 的 TriggerBinding 条目补多绑定口径。同批发现两处既有缺口并一并补上：模型表原先没有 `CollectionPlan` 行、API 规格原先没有任何采集计划路由（Task 33 的同步欠账）。治理观察更新：`storage/0001-prisma-repository.md` 52.4 KB、`interfaces/0002-product-api-http.md` 49.0 KB，仍超/近红线；这两个文件的拆分仍待 G 系列，拆分前不宜继续追加。

切片 5 的验证（2026-09-22，实际运行）：`bun run typecheck` 全仓 PASS；`bun run test` **119 文件 / 684 用例全绿**（基线 672，+12 为本切片新增）；Node 进程 E2E **6 文件 / 11 用例全绿**（含新增 `e2e/webhook-entry.e2e.test.ts` 的 5 例：入口不在 `/api/v1` 下、读投影只回答已配置且保留定时、正确凭证入队并留下证据、重复事件返回同一个 Run、错误凭证与不存在入口响应一致、缺事件标识 400 与超体积 413 均不入队、撤销后失效且凭证不进日志）；`bun run build:api` 与 `build:worker` 通过。未运行：浏览器 E2E（入口面板属切片 6）、真实来源验收（切片 7）、组件实验室、Docker。

切片 5 的 `docs/spec/` 同步（**随任务分支合并，不在 master 文档批**）：新增 `docs/spec/interfaces/0006-webhook-entry-http.md` 作为入口的 canonical owner（按组件模板写全 13 节：定位、概念、外部行为、输入/输出、状态、转换、副作用、错误、依赖、配置、重建验收、实现与测试锚点），`docs/spec/README.md` 的术语表登记「Webhook 入口」。这两处要引用 `apps/api/src/hook.controller.ts`、`e2e/webhook-entry.e2e.test.ts` 等只存在于分支的文件，放在 master 会让 master 的 `docs:check` 断链，所以与代码同批提交。**没有**往 `interfaces/0002-product-api-http.md` 追加：入口不在产品 API 版本前缀内，产品 API 规格也已近红线；入口的 4xx/5xx 码（`payload_too_large`/`rate_limited`/`not_found`/`validation_failed`/`conflict`）是入口自己的错误面，不加入产品 API 的 `ServiceError` 枚举。
4. **切片 4a 一计划多触发器（数据模型）**：✅ 已实现（2026-09-22，worktree `.worktree/trigger-webhook`／分支 `feat/t23-trigger-webhook`，**未提交**）。唯一约束由「每来源／计划一行」改为「每来源／计划、每种类型一行」（migration `20260922120000_trigger_binding_multi_trigger`：drop 两个唯一索引、建 `(sourceId, kind)` 与 `(planId, kind)`）；计划的触发器读写按 kind 寻址（调度只读 schedule 行；`updateCollectionPlan.scheduleIntervalMs` 只增／改／删 schedule 行）；计划读投影不再暴露触发器 id。稳定决定：ADR [`0025`](../../../docs/adr/0025-multi-trigger-per-plan.md)（取代 ADR-0018 决定 1 的单绑定口径）、架构主文档决定 87、ADR-0023 的 Revisit Gate 第 3 条标记为已触发并处理。
5. **切片 4b Webhook 入口标识与凭证**：✅ 已实现（2026-09-22，**未提交**）。`TriggerBinding` 增加 `webhookToken`（唯一）与 `secretRef`（migration `20260922140000_trigger_binding_webhook_entry`；只有 webhook 行写这两列）；`rotateCollectionPlanWebhookEntry` 生成／轮换入口标识与凭证（凭证字节先写进 SecretStore 的**新**引用，换行引用成功后再删旧引用——任何一步失败都不会留下「行上的引用指向被覆盖掉的凭证」），`revokeCollectionPlanWebhookEntry` 幂等撤销（删行 + 删字节）；计划快照新增 `webhook: { entryPath, credentialConfigured } | null`，明文凭证只在生成／轮换响应里出现一次；API 新增 `POST`／`DELETE /collection-plans/:planId/webhook-entry`，`apps/api` 的路由表快照同批更新。依赖：切片 3、4a。
6. **切片 5 inbound 端点**：✅ 已实现（2026-09-22，**未提交**）。新增 `HookController`：`POST /hooks/collection-plans/:token`，路由**不在** `/api/v1` 下（`main.ts` 用与控制器共用的 `WEBHOOK_ENTRY_ROUTE_PATH` 常量把它排除在全局前缀外）；四道闸门——体积上限 16 KB（413）、单入口 30 次/分钟（429，进程内存滑动窗口、桶数上限 512）、常量时间凭证校验（缺凭证直接拒绝、不调用校验；入口不存在与凭证不对返回同一个 404 与同一响应体）、外部事件标识必填（trim 后 1–300 字符，直接作为幂等键）；计划或触发器停用、durable host 未启用都是 409（legacy 泳道记不下触发原因，所以拒绝而不是降级）；入队带触发证据，202 返回 Product Run 投影，重复事件返回同一个 Run。验收：单元 12 例 + 端到端 5 例（见下）。依赖：切片 4a／4b。
7. **切片 6 计划面板入口展示**（未开始）：计划行/详情显示入口地址与凭证状态，提供生成／轮换／撤销与调用示例。验收：浏览器 E2E——新建带 Webhook 触发的计划，调用入口后计划下出现触发原因为 webhook 的 Run。依赖：切片 5。
8. **切片 7 真实消费者验收**（未开始）：用本机脚本（`scripts/e2e/` 新增或扩展）作为 ADR-0024 决定 6 的「用户自己的自动化」调入口，跑通一次真实 RSS 抓取。依赖：切片 5（可与切片 6 并行）。

切片 3 开工前需要在 Task 里记录的三项实现细节（不在 ADR 层裁定）：请求体上限与最小间隔的具体值；外部事件标识是否必填；凭证明文只回显一次还是可重复查看（SecretStore 明文-at-rest 意味着技术上可重复读，产品行为需明确）。**已裁定第二项与第三项**：凭证由 Cosmos 生成、明文只在生成／轮换响应里回显一次（维护者 2026-09-22）；外部事件标识是否必填留到切片 5。

环境偏差（2026-09-22，影响后续切片）：本机无法访问 `binaries.prisma.sh`，新 worktree 里 `bun run db:generate` 会失败、`bun install` 也不会落地引擎二进制。处理方式是从主工作区复用已生成的 Prisma client 与引擎：把 `node_modules/.bun/@prisma+client@6.19.3+*/node_modules/.prisma` 复制到 worktree 的 `node_modules/.prisma`，把 `schema-engine-windows.exe` 与 `query_engine-windows.dll.node` 复制到 worktree 的 `node_modules/@prisma/engines/`。复制前核对生成物的 `schema.prisma` 与当前 schema 一致（仅格式化差异），并确认主工作区 `typecheck:storage` 通过。缺引擎时 DB 类测试会以 `prisma migrate deploy` 超时失败（每个用例约 70 秒），不是代码回归。**切片 4 补充**：schema 改动后必须重新生成 client，而 CLI 还会去下载引擎的 `.sha256` 校验文件；离线解法是按现有二进制算出摘要，写成 `query_engine-windows.dll.node.sha256` 与 `schema-engine-windows.exe.sha256`（与二进制同目录，64 位小写十六进制、无换行），此后 `bun run db:generate` 可离线成功（本次实际生成成功，schema 校验通过）。

**切片 5 补充**：Node 进程 E2E 的 helper 用 `spawnSync("bun", ...)` 跑迁移，而本机 PATH 上的 `bun` 只有 PowerShell shim（`bun.ps1`），会以 `spawnSync bun ENOENT` 失败。解法是给 E2E 进程设 `BUN_BINARY=C:\Program Files\nodejs\node_modules\bun\bin\bun.exe`（helper 已支持该环境变量），随后 `bunx vitest run --config vitest.e2e.config.ts` 全绿。**这不是代码问题，CI 上 bun 是可执行文件，无需设置。**

**切片 4 的数据模型裁定（2026-09-22，维护者选择 A：一个计划可持有多个触发器）**：切片 4 曾无法按 ADR-0024 字面开工——「webhook 入口挂在 `TriggerBinding`（`kind = webhook`）」与「一个计划只有一行触发器」冲突。三条已核实事实：

1. `TriggerBinding` 原来对 `sourceId` 与 `planId` 各有一个唯一索引（ADR-0018 的 v1 单绑定）：一个计划只能有一行触发器。
2. `listScheduleTriggers` 只取 `kind === "schedule"` 且 `enabled` 的绑定（[`sources.ts`](../../../packages/storage-prisma/src/repository/sources.ts)）：把这一行的 kind 改成 `webhook` 会让该计划的定时抓取**静默停止**。
3. ADR-0024 决定 2 的原文是「入口以 `TriggerBinding` 为定位对象（`kind = webhook`）」；而 ADR-0023 的 Revisit Gate 第 3 条要求在「AUT-004 的事件类触发开始接入计划（触发形态从 schedule／manual 扩展）」时重新评估。

裁定结果与落地见切片 4a／4b；被拒绝的备选（B 单绑定 + 入口作为附加字段、C 单计划单触发方式）的理由记在 ADR-0025 的 Alternatives。切片 4 的验证：`bun run typecheck` 全仓 PASS；`bun run test` 117 文件 / 672 用例全绿（基线 664，+8 为切片 3／4 新增）；`packages/contracts/entry-surface.txt` 按脚本重新生成（切片 4b 再 +3 行：entry schema、路径构造、类型）；`apps/api` 路由表快照新增两条路由。未运行：Node 进程 E2E、浏览器 E2E、真实来源验收（切片 5 起才涉及入口端点）。

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
