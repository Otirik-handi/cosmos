# Task 20：媒体失败重试与保留期清理 v1（Phase 2 第十切片）

> 编号 20 由 Agent 建议、待维护者确认（任务拆分阶段用户授权「按重试 → 清理两片实现」，未显式指定编号）。

## User Request / Topic

2026-09-09 用户指示「完成Phase 2剩余条目之一：ING-009 自己剩的失败重试和保留期清理」。Task 19 只交付了 ING-009 的「按来源图片开关 + 单文件/单次预算」，保留期与失败重试仍缺。Proposal [`media-retry-retention-v1`](../../../docs/proposals/media-retry-retention-v1.md) 起草后列出四项裁决（重试触发方式、可重试范围、清理删除语义、清理执行载体）与实施授权问题；用户逐项确认推荐方案并授权创建 worktree/分支、按两片实现。稳定决定沉淀于 [`ADR-0015`](../../../docs/adr/0015-media-retry-retention-v1.md)，PRD §7.5 第十切片注记、架构 §6.4 注记与 ADR-0005/0014 Revisit Gate 已同步。

## Goal

交付 ING-009 的剩余两项：

```text
重试触发        -> 来源的常规采集 Run 内自动发生（cosmos.ingest@1 增加 media.retry@1）；手动入口复用既有手动采集
可重试判定      -> 机器可读 Asset.errorCode（只重试 timeout/network/http_error/budget_run），不解析展示文案
重试上限        -> 每来源 Source.config.media.retry.maxAttempts（含首次，缺省 3，0 = 关闭，上界 10）+ Asset.attemptCount
重试写入        -> 只原地改写 Asset 行，不产生新 EntryRevision；(assetId, attemptCount) CAS
重试预算        -> 与本次 Run 的新内容共享单次预算
保留期          -> 每来源 Source.config.media.retentionDays（1–3650，缺省永久保留）
清理触发        -> 显式命令 POST /api/v1/media-cleanups，先 dryRun 预览再确认，不随采集自动删除
清理语义        -> 只删 Blob 字节；Asset 回退 metadata_only + 原因，保留原文外链；公共 4 态不变；删除前做引用检查
清理载体        -> durable 维护 Workflow cosmos.media-cleanup@1（单 action media.cleanup@1），Worker 执行
```

## Scope / Non-goals

Scope：

- contracts：`sourceMediaPolicySchema` 新增 `retry`/`retentionDays`；`AssetSnapshot`/`normalizedAssetInputSchema` 新增 `errorCode`/`attemptCount`；`sourceFetchOutputSchema` 新增已用媒体字节；新增 `mediaCleanupCommandSchema` 与清理报告 DTO。
- domain：`NormalizedAssetInput` 新增 `errorCode`/`attemptCount`。
- storage：`Asset` 新增 `errorCode`/`attemptCount`/`lastAttemptAt`（migration）；重试候选查询与原地改写；保留期候选查询与清理写入；Blob 删除与引用检查。
- application：媒体获取写入 `errorCode`；`media.retry@1` 与 `media.cleanup@1` action；`cosmos.media-cleanup@1` 维护 Workflow。
- worker：注册维护 Workflow 与 action。
- API：清理命令端点与结果查询；Asset 投影补字段。
- Web：媒体策略表单补重试上限与保留天数；Asset 降级展示补尝试次数与「已按保留期清理」。
- 文档：`docs/spec`（contracts/application/storage/interfaces）、`docs/testing`、`PROJECT-STATUS`。

Non-goals（见 Proposal / ADR-0015）：

- 历史媒体回填；清理后自动重新下载。
- 音频/视频下载实体；单条目媒体数量上限；全局默认值的 env 化。
- 新增公共资产状态枚举。

## 权威合同

- Proposal [`media-retry-retention-v1`](../../../docs/proposals/media-retry-retention-v1.md)（accepted，2026-09-09，用户逐项确认）。
- ADR [`0015`](../../../docs/adr/0015-media-retry-retention-v1.md)；ADR [`0005`](../../../docs/adr/0005-media-boundary-v1.md) 决策 7 与 Revisit Gate；ADR [`0014`](../../../docs/adr/0014-per-source-media-policy-v1.md) Revisit Gate。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) ING-009 与 §7.5 第十切片注记。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §6.4。
- 现状 spec：contracts/0001、application/0001 与 0006、storage/0001 与 0005、interfaces/0002 与 0005。

## 实施切片（capability map，无环依赖）

1. **切片 1：失败重试**（contracts + domain + storage migration + application + worker + Web 展示）
   - `Asset.errorCode`/`attemptCount`/`lastAttemptAt` 与原因码写入；
   - 重试候选查询 + 原地改写（CAS）+ Blob 写入；
   - `media.retry@1` 接线进 `cosmos.ingest@1` 与预算共享；
   - 行为测试：缺省不重试（maxAttempts 缺省 3 会重试 → 明确语义）、达到上限停止、只重试可恢复原因、不产生新 Revision。
2. **切片 2：保留期清理**
   - `media.retentionDays` 配置 + 清理命令/报告 DTO + API 端点；
   - `cosmos.media-cleanup@1` 维护 Workflow + `media.cleanup@1` action + Worker 注册；
   - 引用检查 + Blob 删除 + Asset 回退；
   - Web 配置项与结果展示；浏览器 E2E。

## Current State

- 生命周期阶段：切片 1（失败重试）与切片 2（保留期清理）均已实现并通过门禁；文档（Proposal accepted / ADR-0015 / PRD / 架构 / ADR Gate / spec / testing / Task）已同步。**未 commit、未 push、未合并**（等待维护者授权）。
- 连贯目标：让用户能补救降级媒体、按来源回收已保存媒体，且两者都不静默。
- 可观察验收（≤3 条）：
  1. 一个因网络失败降级的图片，在来源下一次采集后变成 `saved`（图片可见），且条目没有新增 Revision；
  2. 把某来源 `retry.maxAttempts` 设为 0 后，该来源不再自动重试；
  3. 把某来源 `retentionDays` 设为 1 并执行清理命令后，到期媒体字节被删除、Asset 显示「已按保留期清理」且原文外链仍在，其它来源与未到期媒体不受影响。
- 依赖：Task 02（媒体边界 v1）、Task 19（按来源媒体策略 v1）。
- 受影响合同：contracts（来源配置 schema、Asset 快照、清理命令）、domain（Asset 输入）、storage（Asset 列与写入路径）、application（两个 action + 一个维护 Workflow）、worker、API、Web。
- 验证层级：focused（contracts/domain/application/storage）→ API/Worker 集成 → 浏览器 → 全量门禁。

## Decisions and Deviations

- 以 ADR-0015 十一条为稳定边界。
- 历史降级 Asset 的 `errorCode` 为 null，按 `unknown` 处理、不自动重试（无历史回填的代价，已知限制）。
- **偏差（相对 ADR-0015 初稿措辞）**：重试步骤排在 `library.ingest@1` **之前**而不是之后。原因是放在持久化之后会让「下一次采集重试」退化成「同一次 Run 里对刚入库的字节立刻再试一次」；实现过程中先红后绿测试暴露了这一点（首次运行就把失败图片重试成功），已把步骤前移并把 ADR/PRD/架构/ingest spec 同步为「只处理早先 Run 已存的降级 Asset」。
- **既有测试隔离修复**：`apps/worker/src/workflow-ingest.test.ts` 的「later run sees unchanged items」用例原先在 drain 前就把两个 Run 一起入队，两个 Run 会竞争；新增的重试步骤让第一个 Run 变长后竞争稳定复现。改为第一个 Run 完成后再入队第二个 Run（用例意图本来就是「后来的 Run 观察到已入库内容」）。
- **清理事件不设 idempotency key**：dryRun 与确认执行的报告 payload 不同，用固定 key 会触发 `appendDomainEvent` 的 payload 冲突；报告是追加事实，API 读最新一条，重复执行追加新事件即可。
- **`candidateBytes` 字段**：预览需要「可清理多少字节」，`cleanedBytes` 在 dryRun 下恒为 0，因此报告增加 `candidateBytes`（公共 schema 内新增字段，无兼容影响）。
- **共享 Blob 的删除归属**：同一 `storageKey` 的多条 Asset 依次处理，只有最后一个引用者真正删字节，因此 `sharedKeyCount` 是「被延迟到最后一个引用者的行数」而不是「跳过的行数」。

## Implementation Walkthrough

1. **migration**：`20260909200000_media_retry_retention_v1` 给 `Asset` 增加 `errorCode`/`attemptCount`/`lastAttemptAt` 与 `entryRevisionId` 索引；forward-only、无回填。
2. **contracts**：`assetErrorCodes`/`assetErrorCodeSchema`/`retryableAssetErrorCodes` 与 `mediaRetryCeiling`（base.ts）；`sourceMediaPolicySchema` 新增 `retry.maxAttempts` 与 `retentionDays`；`assetSnapshotSchema` 新增 `errorCode`/`attemptCount`；`normalizedAssetInputSchema` 新增同名字段；`sourceFetchOutputSchema` 新增可选 `mediaBytesUsed`；新增 `mediaRetry*` 与 `mediaCleanup*` schema/DTO。
3. **domain**：`NormalizedAssetInput` 新增 `errorCode`/`attemptCount`。
4. **application**：`media-acquisition.ts` 为每类降级写入原因码、`MediaPolicy` 带上 `retry`、`createMediaAcquirer` 同时实现 `MediaRetrier.retryAssets`（共享剩余预算）；`workflow-ingest.ts` 新增 `media.retry.fetch@1`（trusted_worker，读候选 + 下载 + BlobRef）与 `media.retry.apply@1`（host，fence 下 CAS 改写），工作流在持久化前执行这两步并把计数写入输出；新增 `media-cleanup.ts`（`cosmos.media-cleanup@1` + `media.cleanup@1` + 入队服务）；catalog 同步两个 Workflow 与六个 Action manifest，ingest manifest hash 升到 `source-snapshot-v2`。
5. **storage**：`toAssetSnapshot`/持久化写入新列；`listRetryableMediaAssets`、`applyMediaRetryOutcome`（`(assetId, attemptCount)` CAS + `media.retry.attempted.v1`）、`listRetentionCleanupCandidates`、`runMediaCleanup`（fence + 引用检查 + `FileBlobStore.delete` + `media.cleanup.completed.v1`）、`getMediaCleanupReport`。
6. **blob-store**：`FileBlobStore.delete(key)`（containment + ENOENT no-op）。
7. **worker**：注册维护 Workflow 与 action，并把 `mediaRetrier`/`retryCandidates` 注入 ingest actions。
8. **API**：`POST /api/v1/media-cleanups`（缺省 dryRun）与 `GET /api/v1/media-cleanups/:runId`；`config.media` 白名单已覆盖新字段（Task 19 的投影修复）。
9. **Web**：媒体策略表单新增「失败重试次数」「保留天数」；来源健康区新增「预览过期媒体 → 确认清理」两步面板；Story 面板降级媒体显示「已尝试 N 次」。
10. **文档**：ADR-0015 + ADR 索引 + ADR-0005/0014 Revisit Gate、PRD §7.5 第十切片注记、架构 §6.4 注记、`docs/spec`（contracts/application 0006 与新增 0009/storage 0001 与 0005/interfaces 0002 与 0005/spec README）、`docs/testing/README.md`、Task 导航、`PROJECT-STATUS.md`。

## Verification / Gate

验证（2026-09-09，实际运行）：

- `bun run typecheck` 全仓通过；`bun run lint:web` 0 error（2 个既有 warning）；`bun run build`（含 Next standalone）通过；`bun run docs:check` 381 文件 failures=[]；`git diff --check` 干净。
- focused：contracts 52/52（新增 retry/cleanup schema 4 例）、application media-acquisition 30/30（新增 retry 4 例 + 原因码 1 例）、transport-http 15/15、api controller 42/42（新增清理端点 4 例）、web media-policy 7/7、component-lab registry 12/12 全部通过。
- storage（串行 `bunx vitest run --no-file-parallelism packages/storage-prisma`）：14 文件 / 113 用例全部通过，含新增 `media-retry.test.ts` 5 例（候选过滤、原地改写不产生新 Revision、CAS、dryRun 不写数据、引用检查后删字节）。
- worker 组合：`apps/worker/src/workflow-ingest.test.ts` 4/4 通过，含新增「第二次采集自动恢复失败媒体、不产生新 Revision」端到端用例。
- 全量 `bun run test`：51 文件 / 468 用例，412 通过；56 例失败全部集中在 storage-prisma 的 `prisma migrate deploy` 5s 超时 + EBUSY（既有 Windows SQLite 并行负载抖动），串行复跑 113/113 通过。
- 浏览器产品 E2E：`COSMOS_E2E_WEB_PORT=4212 bunx playwright test --config playwright.config.ts` **17/17 通过**（新增清理预览用例：保存保留天数 → 预览报告 0 项且无确认入口）。
- 组件实验室浏览器：`bun run test:browser:component-lab` **13/13 通过**。
- Node 进程 E2E：`BUN_BINARY=<真实 bun.exe> bun run test:e2e` **4/4 通过**。
- 未运行：Windows Node smoke（`scripts/smoke-node.ps1`）、Docker/Compose、发布部署（均为既有后置边界）。

## Follow-ups

- 历史媒体回填、清理后自动重新下载按 ADR-0015 Revisit Gate 评估。
- 遗留文案：预算类降级原因硬编码「（10MB）」，来源收紧后数字不再准确（既有缺陷，非本切片引入）。
- legacy 泳道（`COSMOS_WORKFLOW_HOST_ENABLED=false`）不执行重试步骤，只有 durable 泳道具备该能力。
- Phase 2 需求清单其余条目：自动聚类/Knowledge Workflow（ORG-021）与平台面（RUN-004、Connection/StateStore、Trigger/SDK、OPS-003/004）。
