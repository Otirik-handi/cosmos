# Task 19：按来源的媒体策略 v1（图片开关 + 预算收紧，Phase 2 第九切片）

## User Request / Topic

2026-09-09 用户指示「继续下一片，选择 ing-009」。Proposal [`per-source-media-policy-v1`](../../../docs/proposals/per-source-media-policy-v1.md) 起草后列出三项裁决（v1 范围、预算方向、策略存放位置）与实施授权问题；评审问题未获即时回复时 Agent 按推荐默认推进（范围取「类型 + 预算」、来源只能收紧、策略放进来源配置），随后维护者确认接受这三项默认并授权提交、合并与推送。稳定决定沉淀于 [`ADR-0014`](../../../docs/adr/0014-per-source-media-policy-v1.md)，PRD §7.5 第九切片注记与架构 §6.4 注记已同步。

## Goal

交付 ING-009 的 v1 部分：

```text
策略位置        -> Source.config.media（images / maxFileBytes / maxRunBytes，全部可选）
有效值          -> 缺省跟随全局默认 10MB/50MB；来源只能收紧，不能放宽
生效边界        -> fetch 时从 Run 的 SourceExecutionSnapshot 解析；只影响后续采集
类型开关        -> images=metadata_only 时跳过下载，Asset 保持连接器给的 metadata_only
配置入口        -> Web 来源行「媒体策略」编辑（PATCH /sources/:id + baseRevisionId CAS）
```

## Scope / Non-goals

Scope：

- contracts：`sourceMediaPolicySchema` + `rssSourceConfigSchema.media` + `sourceConfigSchema.media` + `source.rss@1` manifest JSON Schema 声明。
- application：`MediaPolicy`/`resolveMediaPolicy`、`MediaAcquirer.acquireItems` 的 `policy` 参数与生效逻辑。
- worker：fetch action 从来源快照解析策略并传入。
- Web：来源行媒体策略编辑（开关 + 两个上限，留空跟随默认）与并发冲突提示。
- 文档：`docs/spec`（contracts/application/interfaces）、`docs/testing`、`PROJECT-STATUS`。

Non-goals（见 Proposal / ADR-0014）：

- 保留期与清理任务（删除已有媒体）。
- 失败重试与历史媒体回填。
- 音频/视频下载实体、单条目媒体数量上限。
- 全局默认值的 env/配置化。
- Prisma schema、migration、回填。

## 权威合同

- Proposal [`per-source-media-policy-v1`](../../../docs/proposals/per-source-media-policy-v1.md)（accepted，2026-09-09，Agent 默认推进）。
- ADR [`0014`](../../../docs/adr/0014-per-source-media-policy-v1.md)；ADR [`0005`](../../../docs/adr/0005-media-boundary-v1.md) 决策 5 与 Revisit Gate。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) ING-009 与 §7.5 第九切片注记。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §6.4。
- 现状 spec：contracts/0001、application/0001、interfaces/0002 与 0005。

## 实施切片（capability map，无环依赖）

1. **切片 1：策略合同与生效**（contracts + application + worker，无 UI）
   - `media` 配置 schema（含上界）与 manifest 声明；
   - 策略解析（缺省/收紧/min）与媒体获取组件的跳过逻辑；
   - fetch action 接线 + 行为测试（缺省不变、收紧生效、关闭下载不写实体）。
2. **切片 2：Web 媒体策略编辑 + 组件实验室 + 浏览器 E2E**
   - 来源行编辑表单、CAS 冲突提示、跟随默认/已收紧的展示；实验室 fixture 与浏览器用例。

## Current State

- 生命周期阶段：切片 1（合同 + 策略生效 + worker 接线）与切片 2（Web 编辑 + 组件实验室 + 浏览器 E2E）均已实现并通过门禁，已随 `a5a8005` 合入并推送 `master`（用户授权 commit/push/merge）。
- 连贯目标：让用户能按来源控制媒体下载的类型与预算，且只影响之后的采集。
- 可观察验收（≤3 条）：
  1. 把某来源的图片开关关掉后，该来源新采集条目的图片保持「仅记录元数据」，其它来源不受影响；
  2. 把某来源的单文件上限调到 1MB 后，超过 1MB 的图片在新采集中显示「超过单文件大小上限」，低于上限的照常保存；
  3. 修改策略不影响已存在的 Asset（不删除、不改写），且不影响已排队的 Run。
- 依赖：Task 02（媒体边界 v1：Connector 纯提取 + Application 统一获取 + 快照机制）。
- 受影响合同：contracts（来源配置 schema）、application（媒体获取策略参数）、worker（fetch 接线）、web（来源行编辑）。
- 验证层级：focused（contracts/application）→ API/Worker 集成 → 浏览器 → 全量门禁。

## Decisions and Deviations

- 以 ADR-0014 六条为稳定边界（配置存放、只能收紧、只控下载、快照解析、Web 编辑、保留期/重试后置）。
- 公共 schema 的上界（64KiB–10MB / 1MiB–50MB）同时承担「只能收紧」的校验与运行时默认值来源，避免两处常量漂移。
- **修复既有投影缺口（本切片范围内）**：API 的 `toPublicSource` 是白名单投影，只放行 `feedUrl`/`scheduleIntervalMs`/Bilibili 字段，会把新写的 `config.media` 丢掉，导致保存成功但列表仍显示「跟随默认」。浏览器用例先暴露了它，已把 `media` 加入白名单并补 API 测试。
- **测试隔离修复**：新增浏览器用例与断网用例共用 `/offline.xml`，断网用例原先只等「任意 Story 出现该标题」，会被新用例的 Story 提前满足；改为按来源名限定本来源的卡片（与 `phase2-organization` 同一做法）。

## Implementation Walkthrough（2026-09-09）

1. **contracts**：新增 `mediaPolicyCeilings`（10MB/50MB，单一数字来源）、`mediaPolicyImagesSchema`、`sourceMediaPolicySchema`（可选 `images`/`maxFileBytes`/`maxRunBytes`，上界即全局默认）；`rssSourceConfigSchema` 与通用 `sourceConfigSchema` 接受可选 `media`。
2. **application**：`mediaAcquisitionDefaults` 改为取自 `mediaPolicyCeilings`；新增 `MediaPolicy` 与 `resolveMediaPolicy`（缺省填充 + 与全局默认取最小）；`MediaAcquirer.acquireItems` 接受 `policy`，`images=metadata_only` 时原样返回 connector 输出，否则用来源预算覆盖本次 Run 的限额，完成日志带上生效策略。
3. **接线**：durable `source.fetch@1` 与 legacy `source-ingest` 都从各自的来源快照 `config.media` 解析策略后传入，行为一致。
4. **manifest**：`source.rss@1` 的 JSON Schema 声明 `media`（描述用，校验仍由 canonical Zod schema 拥有）。
5. **Web**：新增 `apps/web/src/lib/media-policy.ts`（MB 换算、收紧校验、摘要文案）；`SourceActions` 每行新增「媒体策略」入口与行内表单，`page.tsx` 用 `PATCH /sources/:id` + `baseRevisionId` 保存并在 409 时提示刷新；组件实验室新增 Media policy tightened 场景。
6. **文档**：ADR-0014 + ADR 索引 + ADR-0005 Revisit Gate 注记、PRD §7.5 第九切片注记、架构 §6.4 注记、`docs/spec`（contracts/application/interfaces 0005）、`docs/testing/README.md`、Task 导航与 `PROJECT-STATUS.md`。

## Verification / Gate

验证（2026-09-09，实际运行）：

- `bun run typecheck` 全仓通过；`bun run lint:web` 0 error（2 个既有 warning）；`bun run build`（含 Next standalone）通过；`bun run docs:check` 374 文件 failures=[]；`git diff --check` 干净。
- focused：contracts 36/36（新增 media schema 2 例）、application media-acquisition 24/24（新增策略 6 例）、worker workflow-ingest 3/3（新增快照策略 1 例）、api controller 38/38（新增投影 1 例）、web media-policy 6/6、component-lab registry 12/12 全部通过。
- 先红后绿：临时移除策略生效逻辑（`images=metadata_only` 短路与来源预算覆盖）后，application 与 worker 的 4 例策略用例全部失败；恢复后 26/26 通过。
- 全量 `bun run test`：50 文件 / 446 用例，389 通过；57 例失败全部集中在 storage-prisma 的 `prisma migrate deploy` 5s 超时 + EBUSY（既有 Windows SQLite 并行负载抖动），`bunx vitest run --no-file-parallelism packages/storage-prisma` 串行 13 文件 / 108 用例全部通过。
- 浏览器产品 E2E：`COSMOS_E2E_WEB_PORT=4206 bunx playwright test --config playwright.config.ts` **16/16 通过**（新增媒体策略两条：超默认值本地拒绝 + 保存后刷新仍生效；关闭图片下载后新采集的图片保持元数据终态）。首次运行暴露了 API 投影丢字段与跨 spec 等待条件两处问题，修复后全绿。
- 组件实验室浏览器：`bun run test:browser:component-lab` **13/13 通过**。
- Node 进程 E2E：`BUN_BINARY=<真实 bun.exe> bun run test:e2e` **4/4 通过**。
- 未运行：Windows Node smoke（`scripts/smoke-node.ps1`）、Docker/Compose、发布部署（均为既有后置边界）。

## Follow-ups

- 保留期/清理任务、失败重试与历史回填按 ADR-0014 Revisit Gate 评估。
- 若维护者否决「只能收紧」，改为硬上限方案（schema 上界调整 + 文档同步）。
- Phase 2 需求清单其余条目：自动聚类/Knowledge Workflow（ORG-021）与平台面（RUN-004、Connection/StateStore、Trigger/SDK、OPS-003/004）。
