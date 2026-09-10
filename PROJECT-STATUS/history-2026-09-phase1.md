---
parent: PROJECT-STATUS.md
range: 2026-09-07 ~ 2026-09-01(5 节)
sealed_at: 2026-09-11
tags: [project-status, history]
tokens_est: 4227
---

## 2026-09-07：Phase 1 划线收口与 Phase 2 启动基线

Task 02（Phase 1）于 2026-09-04 close（`adec648`，记录断网产品验收与 Windows Node smoke 通过）。随后 5 个收尾提交合入 `master`（本地 = 远端 = `48deeb5`）：`ed22bf5`/`4199c09` 记录 Bilibili hot/feed real-source 验收、`7faf0dd` 增加 Bilibili/AI HOT 定时调度 focused 测试、`4407547` 修复媒体重复下载（fetch 前只读内容指纹预检，unchanged item 不触发媒体获取）、`48deeb5` 将浏览器断网验收改为本地受控源并确定性化。过程记录见 Task 02 walkthrough（2026-09-07 媒体重复下载修复与 offline 确定性切片）。

**维护者决策（进入 Phase 2 的划线，2026-09-07）**：以下 Phase 1 残留项明确记为后置债，不作为 Phase 2 阻塞：

- Docker/Compose 容器验收（本机无 Docker CLI，长期未运行）；
- 发布与部署（始终未授权）；
- 真实公网 RSS/RSSHub 长时定时抓取（真实单次与真实双源联网验收已过，长时间稳定性未验证）；
- 非 Windows 平台 smoke；
- 长时间故障恢复 / 跨进程接管压力验收。

**Phase 2 启动基线**：维护者确认 Phase 2 首切片为 Story 域模型——把 Phase 1 的“一个 Entry 一个 Story”最小投影升级为独立 Story 实体（多 Entry 主成员、版本化 Story Revision、受管 kind/subtype、最小 merge/alias），对齐 PRD Phase 2 完成标准“用户能打开一个多来源 Story”。Proposal [`docs/proposals/story-domain-v1.md`](docs/proposals/story-domain-v1.md) 已接受（2026-09-07，用户评审接受三项默认建议：自动单 Entry Story + 显式人工归并；Story Revision 展示字段实质变化时递增；merge 进首切片、split 后置）；自动聚类、Knowledge Workflow、Topic 与可配置看板不在首切片。进入 Phase 2 不改变路线图阶段定义，也不把现有 projection 表述为完整 Story 域能力。

**门禁留底（2026-09-07 实际运行，HEAD `48deeb5` 干净）**：`bun run typecheck` 全仓通过；`bun run docs:check` 通过（312 文件，failures=[]）；`bun run db:validate` 通过；`bun run test` 全量 38 文件/324 用例——首轮 1 例（`source-identity-migration.test.ts` backfill 用例）5s 超时 + EBUSY unlink 抖动失败，单独重跑 2/2 通过，与既有 Windows SQLite 环境固有问题记录一致；`bun run build` 通过（packages/API/Worker/Next standalone）；`git diff --check` 干净。浏览器 E2E、Node 进程 E2E 与 Windows Node smoke 本轮未运行（Task 02 已分别于 2026-09-04~09-07 实测通过，证据见 Task 02 walkthrough）。

## 2026-09-03：两块固定看板与来源健康切片合入

Task 02 实施顺序第 5 步在 `feat/t02-boards-source-health` 完成三块能力：其一，侧栏来源列表升级为“来源健康”看板，每行解释启用徽章、定时语义（启用+定时“每 N 分钟自动抓取”、启用无定时“未配置定时，仅手动录入”、停用“已停用，定时抓取暂停”）、上次运行时间与最近错误，全部投影自既有 `SourceSnapshot` 字段，无合同/Prisma 变更。其二，Worker 定时调度循环从 `apps/worker/src/main.ts` 提取为 `apps/worker/src/scheduling.ts`，门禁行为（只有已启用且配置 `scheduleIntervalMs` 的 Source 参与 schedule；单来源排队失败不隔离其它来源）首次有了 focused 行为测试；调度门禁代码本身语义未变。其三，Web 修正 SSE 幻影监听（`job.succeeded.v1`/`job.retry_wait.v1` 从未发出，替换为实际类型 `run.queued.v1`/`run.retry_wait.v1`），并在 `PrismaWorkflowBackend` 两个 Kernel 状态保存路径补发 durable Run 终态事件 `run.succeeded.v1`/`run.failed.v1`/`run.cancelled.v1`（payload 与 legacy `completeRun` 一致，幂等键 `workflow-run:<id>:<status>` 与 host store 失败路径共享，复合唯一约束 `(workflowRunId, idempotencyKey)` 防重放）；此前 durable 成功终态无事件，零新增内容的成功 Run 不会刷新 Web，“上次失败红字不消失”。`run.failed.v1` 到达时 Web 额外写失败提示。

本地验证（全部实际运行，2026-09-03）：`bun run typecheck` 全仓通过；focused `apps/worker/src/scheduling.test.ts` 3 用例、`packages/storage-prisma` 4 文件/63 用例通过；全量 `bun run test` 37 文件/292 用例通过；`bun run build` 通过；`COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser` 8/8 通过（ingest 流程新增“已停用，定时抓取暂停”与“每 30 分钟自动抓取”断言，console/page error/request failure 为 0）；component-lab 13/13 通过（SourceActions 新增 untimed 场景）；`BUN_BINARY=<真实 bun.exe> bun run test:e2e` 4/4 通过；`bun run docs:check` 304 文件通过；`git diff --check` 干净。未运行：真实公网 RSS 定时抓取、Docker/Compose（本机无 Docker CLI）、Windows Node smoke、发布部署。“配置与看板”Checkpoint 在隔离环境达成；真实 RSS URL 产品 E2E 仍待执行。

同日维护者实测补充修复（均已实测验证）：其一，新 worktree 的 `bun run dev` 因“API 先建库（仅 FTS5 影子表）后无 migration”整站 500，`scripts/dev.ts` 现已在拉起任何服务前先对数据根 `migrate deploy`，迁移失败即拒绝启动；其二，durable failed run 此前从不写 `workflowRun.errorMessage`（只有 dead-letter 路径会写），来源健康红字因此缺失——这是 durable 路径合入以来的预置投影缺口，被本切片的失败事件可见性暴露；`PrismaWorkflowBackend.toUpdateData` 现持久化 kernel `state.error`，非失败保存保持 null。

合并记录（2026-09-03）：分支 `feat/t02-boards-source-health`（实现提交 `e59dcde`、`96c593c`）经维护者授权快进合入 `master`（无 merge commit，tip `96c593c`）；本地分支与 worktree 已清理，fork 远端同名分支已删除；`master` 已推送至 fork 远端并与本地同步（`origin/master` = `54ddef8`）。

## 2026-09-02：source-config-probe 切片合入

Task 02 实施顺序第 3 步“未保存配置测试”已通过 PR #1 合入 `master`（merge commit `6f50990`，实现提交 `86b4db8`）。产品能力：`POST /api/v1/source-config-probes` 先同步预校验（canonical Zod schema + SourceDefinition 可用性，非法配置 400 且不建 Job），通过后返回 202 + `source-config-probe` Job（幂等键缺省 `config-probe:{uuid}`）；Worker legacy 泳道经 `SourceConfigProbeService` 按 manifest 身份链（ref → manifest.connectorId → ConnectorRegistry）构造瞬态 `SourceSnapshot` 执行 dry-run，结果（`itemCount`、`nextCursorAvailable`、`sampleTitles` 最多 3×200 字符）写回 Job；`GET /api/v1/source-config-probes/:jobId` 独立查询，其他 kind 返回 404。该服务不持有 repository，结构性保证不写 Observation/Entry/Asset/checkpoint；执行失败沿用 Job 默认重试/终态。合同变更：`jobKindSchema` 新增 `source-config-probe`、新增 `sourceConfigProbeCommandSchema`/`sourceConfigProbeJobPayloadSchema`/`sourceConfigProbeResultSchema`/`sourceConfigProbeJobSnapshotSchema`、`CosmosRepository.createConfigProbeJob`；无 Prisma schema/migration 变更。

本地验证：`bun run typecheck` 全仓通过；focused 测试 contracts 15 / application 11 / api 14 / storage 新增 1 全部通过；`bun run test:e2e` 4/4 通过（Windows 本机需 `BUN_BINARY` 指向真实 bun.exe，spawnSync 才能找到 bun）；`bun run docs:check` 302 文件通过；`git diff --check` 通过。全量 `bun run test` 在本机三次运行出现 1/4/2 个既有 SQLite 测试的 5s 超时 + EBUSY 抖动；在未改动 master 对照跑同样失败，判定为环境固有问题，与本切片无关（新增测试每轮均通过）。未运行：真实外网 RSS 探测、Docker/Compose、浏览器 E2E（本切片无 Web 改动）、发布部署。合并时远端仓库尚无任何 Actions 运行记录（历史 CI 编号属于上游原仓库）。探测结果的 Web 展示（“测试这条配置”按钮 + 样例标题列表）归实施顺序第 4 步 Web 切片。

## 2026-09-02：schema 驱动 Web 配置流程切片合入

Task 02 实施顺序第 4 步“schema 驱动 Web 配置流程”已通过 PR #2 合入 `master`（merge commit `fc05e4a`；实现提交 `c1f23be`，同分支另含 `443faf9` API 错误映射修复）。产品能力：打开“新建来源”读取 `GET /api/v1/source-definitions` 并定位 `source.rss@1` manifest，按 configurationSchema 渲染字段（`feedUrl` 必填、`scheduleIntervalMs` 可选默认 30 分钟，分钟输入 ×60000 换算、清空即关闭定时；未知字段类型不渲染且无硬编码回退，Catalog 不可用时显示错误并提供重试）；“测试配置”先触发 Zod 校验，再提交 `POST /api/v1/source-config-probes` 并按 1.5s 间隔轮询 `GET /api/v1/source-config-probes/:jobId`（上限 30s），展示抓取条数、耗时、样例标题或失败/超时可重试提示，任一表单字段变化或重开表单即作废旧探测结果；“保存来源（停用）”只创建默认停用 Source，不自动启用；来源列表行内提供启用/停用（同一 activation command，幂等键 `web-activation:<id>:<revisionId>:enable|disable`），409 conflict 提示版本冲突并刷新列表。产品入口只暴露 `rss`，不暴露 `fixture-rss`/`fixturePath`。合同变更：contracts 新增 `sourceDefinitionManifestSchema` 与 Catalog 页响应 DTO，transport-http 新增 `listSourceDefinitions`、`createSourceConfigProbe`、`getSourceConfigProbe`；不改 probe/activation/Prisma 合同。`443faf9` 修复维护者实测发现的错误映射：四个 Source 写端点的 Catalog/schema 同步预校验失败就地转 400 `validation_failed`（既有合同不变），`sourceCommandError` 最终兜底由 400 改为 500 `internal_error`，存储故障不再伪装成客户端配置错误。`docs/spec/interfaces/0005-web-client.md` 已同步该流程；组件实验室为 SourceForm 登记 `definitionState`/`probeState` 控件与 probe-success/definition-error 合成场景（实验室仍无 Product API/SSE 请求），Feed URL 输入 id 变为 `#source-config-feedUrl`、定时字段 id 为 `#source-schedule-interval`。

本地验证（全部实际运行，2026-09-02）：`bun run typecheck` 全仓通过；focused `bunx vitest run packages/contracts packages/transport-http` 3 文件/32 用例通过；全量 `bun run test` 36 文件/285 用例通过（一轮出现组件实验室 props 缺新控件的失败，修复后复跑通过；另一次出现既有 SQLite 超时/EBUSY 抖动，与 PROJECT-STATUS 已记录的 master 环境固有问题一致，重跑全绿）；`bun run db:generate`、`bun run build` 通过；`COSMOS_E2E_WEB_PORT=4183 bun run test:browser:component-lab` 13/13 通过；`bun run test:browser` 8/8 通过（ingest 流程更新为“读取 catalog → 测试未保存配置 → 保存停用 → 行内启用 → 手动录入 → Feed/Story → 搜索 → 移动端溢出”，console/page error/request failure 为 0）；`bun run test:e2e` 4/4 通过；`bun run docs:check` 302 文件通过；`git diff --check` 通过。未运行：真实公网 RSS 探测/录入、Docker/Compose（本机无 Docker CLI）、Windows Node smoke（`scripts/smoke-node.ps1`）、发布部署。

## 2026-09-01：Worker Registry 状态纠偏

本次核对发现：当前 `master`（核对基线 `9c6f513`）没有持久
`WorkflowWorkerRegistration`、对应 Prisma migration、`GET /api/v1/workflow-workers`
或 capability evaluator。当前实现中的 `Worker Admin` 是 Worker 进程内的管理与观测服务；
`status` 的 `registrationGeneration` 固定为 `null`，Prisma 当前只保存
`WorkerHeartbeat`。

完整的注册表、TTL/heartbeat、能力投影和查询实现存在于归档标签
`archive/t04-workflow-runtime-spike-wip-20260818` 的 `b8a1701`，但该提交不在当前
`master` 祖先链中。因此归档 Task walkthrough 中的 Round 78–97 证据只能作为历史 WIP
记录，不能作为当前主线能力或验收证据。当前 Worker Admin 的实现合同以
[`docs/spec/runtime/0003-worker-admin.md`](docs/spec/runtime/0003-worker-admin.md) 为准。

实现规格入口为 [`docs/spec/README.md`](docs/spec/README.md)，测试入口为 [`docs/testing/README.md`](docs/testing/README.md)，仓库生命周期与唯一完成定义位于 [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md)。

Task 09 React 组件实验室与 NeuroBook 主题系统已通过合并 `feat/t09-react-component-lab`（tip `e6bff3c`）进入 `master`，本次合并由用户明确授权；远端 run `32464307892` attempt 2 四个 job 全绿。2026-08-23 按授权首次快进推送 `master` 至远端 `1a258f0`；后续状态文档提交继续推送，GitHub 据此将 PR #10 自动标记为 MERGED（`mergedAt=2026-08-23T12:14:30Z`）；发布和部署未执行。

React 组件实验室 Proposal 已于 2026-08-20 接受；Task 09 在独立 `.worktree/react-component-lab` / `feat/t09-react-component-lab` 完成本地实现、P1 修复、本地最终门禁与修复后五轴审查。CI 配置现已加入隔离下游 job 的 `bun run db:generate` 和 `bun run test:browser:component-lab`；远端 CI run `32464307892` attempt 2 已验证四个 CI job 全部通过。

