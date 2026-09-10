# Proposal：媒体失败重试与保留期清理 v1（ING-009 剩余部分）

> 状态：accepted
>
> 日期：2026-09-09
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) ING-009（关联 ING-008）
>
> 关联设计：ADR [`0005`](../adr/0005-media-boundary-v1.md)（决策 7「不自愈」与 Revisit Gate 第一条）、ADR [`0014`](../adr/0014-per-source-media-policy-v1.md)（Revisit Gate 明确「失败重试与历史回填仍是未决部分」）、架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §6.4
>
> 关联既有切片：Task 02（媒体边界 v1）、Task 19（按来源的媒体策略 v1）

## 1. 问题

PRD ING-009 要求「用户可以按 SourceInstance 配置媒体类型、单文件/单次预算、**保留期**和**失败重试**」。Task 19 已交付前两项（`Source.config.media` 的 `images`/`maxFileBytes`/`maxRunBytes`），并明确把保留期与失败重试后置。当前缺口有两个：

1. **失败媒体不会自愈**。ADR-0005 决策 7 冻结了「不自愈」：条目内容指纹不变就不产生新 Revision，也就不会重新提取与下载媒体（`packages/application/src/media-acquisition.ts:88` 的 `acquireItemsSkippingUnchanged` 直接跳过 unchanged 条目的媒体）。后果是：一次网络抖动、一次 HTTP 5xx、或一次图集帖吃光整页预算导致的降级，会一直停在 `failed`/`skipped`，只有等条目本身修订才可能恢复。用户没有任何补救手段。
2. **已保存的媒体永不回收**。ADR-0005 没有保留期，Asset 一旦 `saved` 就永久占用 Blob Root。个人本地长期运行会持续增长，用户无法按来源设置「只保留最近 N 天」。

两项都需要 ADR-0005 明确拒绝在 v1 打开的新写路径：**不产生新 Revision 也能改写已存 Asset**（重试）和**删除已存媒体字节**（清理）。ADR-0014 的 Revisit Gate 已把这两项登记为未决部分，本 Proposal 就是进入它们的实现设计。

## 2. 目标与非目标

### 目标（对应 ING-009 的可观察验收）

1. **失败重试**：来源上瞬时失败的图片，在下一次该来源采集时自动重新尝试，成功后降级状态消失、图片可见；用户可以按来源配置重试次数上限，也可以关掉重试。
2. **保留期清理**：用户可以按来源设置保留天数；到期媒体的字节被删除，但条目、Asset 元数据与原文外链保留，界面明确显示「已按保留期清理」，不出现空白或假成功。
3. **两者都不静默**：改策略只影响之后的采集；删除只发生在用户显式发起并确认过的清理动作里；每次重试与清理都有可查的运行记录。

### 非目标（本切片明确后置）

- 历史媒体回填（把从未下载过的历史条目补下载）；
- 音频/视频下载实体（ADR-0005 决策 1 仍只下载图片）；
- 单条目媒体数量上限；
- 全局默认值的 env/配置化；
- 清理后自动重新下载（与「无历史回填」一致，清理是单向的）；
- 跨来源的全局保留策略与配额管理。

## 3. 当前行为与证据

- **Asset 表结构**：`packages/storage-prisma/prisma/schema.prisma:236` 只有 `status`/`sourceUrl`/`storageKey`/`mimeType`/`byteSize`/`errorMessage`/`createdAt`，没有尝试次数、没有机器可读原因码、没有 `updatedAt`。
- **降级原因只有中文文案**：`errorMessage` 由 `packages/application/src/media-acquisition.ts:466` 起的 `consumeImageBody` 等函数写入，原因包括超时、HTTP 错误、DNS 失败、非图片内容、安全拦截、超单文件/单次预算。目前无法在不解析文案的情况下判断「这次失败是否值得重试」。
- **媒体获取被 unchanged 短路**：`packages/application/src/workflow-ingest.ts:302` 只在条目内容变化时获取媒体；`acquireItemsSkippingUnchanged` 把 unchanged 条目原样返回。
- **Blob 无删除能力**：`packages/blob-store/src/index.ts` 的 `FileBlobStore` 只有 `put`/`read`/`exists`；blob 是内容寻址（`sha256/<2>/<62>`），同一字节内容被多条 Asset 共享同一个 key（`put` 的 `wx` + `EEXIST` 忽略即去重）。**删除必须先去重引用检查。**
- **Workflow journal value 与媒体共享同一个 Blob Root**：`BlobWorkflowValueStore` 复用同一个 `FileBlobStore`（`packages/blob-store/src/workflow-value-store.ts:22`），但它写入的是 canonical JSON，且 Asset 的 key 来自图片字节，同一 key 意味着字节完全相同。
- **采集入口已存在**：`POST /api/v1/sources/:sourceId/runs`（`apps/api/src/app.controller.ts:431`）触发一次手动采集，与定时采集走同一条 `cosmos.ingest@1`。
- **Asset 读取端点**：`GET /api/v1/assets/:assetId`（`apps/api/src/app.controller.ts:1577`）按 `storageKey` 读 Blob，`storageKey` 为空时返回 404 —— 清理置空 `storageKey` 后行为自然降级，不需要新端点。
- **公共状态是 4 态**：`packages/contracts/src/index.ts:163` 的 `assetStatusSchema`（saved/metadata_only/skipped/failed），ADR-0005 明确拒绝为「超预算」之类原因扩充枚举。

## 4. 方案

### 决策 1：重试发生在来源的常规采集 Run 内，手动入口复用既有「手动采集」

`cosmos.ingest@1` 在 `library.ingest@1` 之后、`source.checkpoint@1` 之前增加一步 `media.retry@1`：它按本次 Run 的来源查询「可重试的已存 Asset」，用同一份媒体策略重新下载并原地更新 Asset 行。定时采集与 `POST /sources/:id/runs` 走同一条路径，因此「下次采集会自动重试」和「用户点一下立即重试」是同一个机制，不需要新端点、新按钮、新 Run 类型。

顺序理由：新内容的媒体优先占用本次 Run 预算，重试排在其后。

**备选**：独立的维护 Workflow + 新端点。拒绝：为同一件「换一次网络机会」的动作复制 contracts/API/Web 三层合同，且来源已有采集入口。

**备选**：只做手动、不做自动。拒绝：PRD 要求按来源配置重试，手动模式下用户必须记得点；且来源本来就在定时轮询。

### 决策 2：新增机器可读的 `Asset.errorCode`，只有「可恢复」原因才重试

`Asset` 增加 `errorCode`（可空字符串），媒体获取组件在写入降级状态时同时写入原因码。重试判定只依赖状态 + 原因码，不解析中文文案。

| 原因码 | 触发场景 | 可重试 |
| --- | --- | --- |
| `timeout` | 单媒体超时 | 是 |
| `network` | 连接失败、DNS 解析失败 | 是 |
| `http_error` | 非 2xx（含 5xx/429） | 是 |
| `budget_run` | 单次 Run 预算用尽/剩余不足 | 是（下次预算重置） |
| `budget_file` | 超过单文件上限 | 否（除非用户收紧后又放宽，按新修订处理） |
| `not_image` | Content-Type/魔数不是图片 | 否 |
| `security_blocked` | 内网/环回地址、协议不允许、含账号信息 | 否 |
| `invalid_url` | URL 无法解析 | 否 |
| `unknown` | 历史数据或未分类 | 否 |

**备选**：不新增列，按 `errorMessage` 文案判断。拒绝：文案是面向用户的展示文本，随时可能改；用它做控制流是隐藏的耦合。

**备选**：只重试 `failed` 状态。拒绝：图集帖吃光预算导致的 `skipped` 正是最值得重试的一类。

### 决策 3：每来源 `media.retry.maxAttempts`，尝试次数记录在 Asset 上

`Source.config.media` 增加可选 `retry`：

```text
retry?: {
  maxAttempts?: integer   // 含首次尝试；缺省 3；0 = 关闭重试；上界 10
}
```

`Asset` 增加 `attemptCount`（整数，缺省 0）与 `lastAttemptAt`（可空时间）。每次下载尝试（含首次）都 +1；`attemptCount >= maxAttempts` 的 Asset 不再进入重试候选，直到条目修订产生新的 Asset 行（计数从 0 重新开始）。这与 ADR-0005「只有条目修订才重新提取」保持一致。

### 决策 4：重试只改写 Asset 行，不产生新 EntryRevision

重试成功时，在同一事务内写 Blob（内容寻址去重）、把该 Asset 更新为 `status: saved` + `storageKey` + `byteSize` + `mimeType` + `errorMessage: null` + `attemptCount`；重试失败时只更新 `errorCode`/`errorMessage`/`attemptCount`/`lastAttemptAt`。EntryRevision 的 `contentFingerprint` 不参与，因此**不会**产生新 Revision、不改变 Feed 排序、不影响已有 Observation。

并发保护：更新以 `(assetId, attemptCount)` 为 CAS 条件；两个 Worker 同时重试同一 Asset 时后到者放弃（幂等，不重复写 Blob）。

审计：每次重试产生一条 DomainEvent（`media.retry.attempted.v1`，payload 含 assetId/entryId/结果/尝试次数）与结构化日志；`actor` 记为 system。

### 决策 5：重试与本次 Run 的新内容共享单次预算

`source.fetch@1` 的输出增加一个可选的「本次已用媒体字节」字段（向后兼容），`media.retry@1` 用 `maxRunBytes - 已用` 作为自己的预算。重试超出的候选保持原状并记录 `budget_run`，留给下一次采集。

**备选**：重试独立用满一份 `maxRunBytes`。拒绝：一次 Run 的实际外网流量会翻倍且不可见。

### 决策 6：每来源 `media.retentionDays`，缺省永久保留

`Source.config.media` 增加可选 `retentionDays`（整数，1–3650；缺省/缺省 0 = 永久保留）。只作用于该来源的 `saved` 图片 Asset，按 `Asset.createdAt` 计算到期。

**备选**：全局保留天数。拒绝：PRD 要求按 SourceInstance 配置；不同来源价值密度差别很大。

### 决策 7：清理是显式命令，先预览再确认

新增命令（`POST /api/v1/media-cleanups`，请求体含可选 `sourceId` 与 `dryRun`）：

- `dryRun: true`（缺省）：返回候选条数、总字节、按来源分组的摘要与最多 N 条样例（assetId/来源/条目标题/大小/到期时间），**不做任何写入**。
- `dryRun: false`：执行删除并返回同一份报告 + 实际删除条数与字节数。

不做定时自动清理：PRD 的验收条件是「修改策略只影响后续采集或**明确的清理任务**，不静默删除已有数据」。

**备选**：随采集顺带清理。拒绝：静默删数据，违反验收条件。

**备选**：只提供 CLI。拒绝：产品验收要能在 Web 上完成；CLI 可以后续复用同一命令。

### 决策 8：清理只删字节，Asset 行保留并回退为 `metadata_only`

执行清理时对每个候选：删除 Blob 字节 → 把 Asset 更新为 `status: metadata_only`、`storageKey: null`、`byteSize: null`、`errorMessage: "已按保留期清理（保留 N 天）"`、`errorCode: "retention_expired"`，保留 `sourceUrl` 与 `mimeType`。界面沿用现有「仅记录元数据 + 原文外链」的展示，不需要新状态。

**备选**：新增第 5 个状态 `expired`。拒绝：ADR-0005 明确拒绝枚举膨胀；`metadata_only` + 原因文案已能表达，且读取侧无需改动。

**备选**：删除 Asset 行。拒绝：会丢掉「这里曾经有过一张图」的事实与原文外链，且删除行会让历史 Revision 的资产清单失真。

**备选**：清理后自动重新下载。拒绝：与「无历史回填」冲突，且会让清理变成无效动作。

### 决策 9：删除 Blob 前做引用检查

blob 是内容寻址且天然去重，多条 Asset（不同 Revision、不同来源）可能共享同一个 `storageKey`。删除前在同一事务内检查没有其它 Asset 引用该 key；仍有引用则只更新当前 Asset 行，不删字节。Workflow journal value 与媒体共享 Blob Root，但同一 key 意味着字节完全相同（JSON 与图片字节相同的概率可忽略），记录为已接受风险。

### 决策 10：清理由 Worker 执行，通过维护 Workflow 的 Run 承载

删除字节与数据库更新必须原子且不能在 API 进程里做。按架构「Maintenance 与 Ingest 使用同一 Runtime」的既定方向，清理实现为一个最小维护 Workflow（`cosmos.media-cleanup@1`，单 action `media.cleanup@1`），API 只负责创建 Run 与查询结果。

**备选**：复用 `source-config-probe` 那样的旧 Job 泳道。备选（改动更小，但旧泳道正在被 durable workflow 取代，会把新能力放到要退役的路径上）。**此项请维护者裁决**。

### 决策 11：清理不影响重试

清理只处理 `saved`；重试只处理 `failed`/`skipped`。被清理的 Asset 变成 `metadata_only`，不在重试范围内，因此不会「清了又下、下了又清」。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 采集内自动重试 + 手动复用采集入口（推荐） | 采纳：不新增端点/Workflow，手动与自动同一条路径 |
| 独立维护 Workflow 做重试 | 拒绝（决策 1） |
| 按 errorMessage 文案判断可重试性 | 拒绝（决策 2）：控制流不依赖展示文案 |
| 只重试 `failed` | 拒绝（决策 2）：预算类 `skipped` 才是高频场景 |
| 重试独立用满一份 Run 预算 | 拒绝（决策 5） |
| 清理只删字节、状态回退 `metadata_only`（推荐） | 采纳：不新增公共枚举 |
| 新增 `expired` 状态 | 备选（决策 8） |
| 删除 Asset 行 | 拒绝（决策 8） |
| 定时自动清理 | 拒绝（决策 7）：违反「不静默删除」 |
| 维护 Workflow 承载清理（推荐） | 采纳，待维护者确认（决策 10） |
| 旧 Job 泳道承载清理 | 备选（决策 10） |
| 历史媒体回填 | 后置（非目标） |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：Prisma schema 变更 —— `Asset` 新增 `errorCode String?`、`attemptCount Int @default(0)`、`lastAttemptAt DateTime?`；forward-only migration，新增列有默认值/null，**无历史回填**（历史降级 Asset 的 `errorCode` 为 null，按 `unknown` 处理、不自动重试，是已知限制）。无表删除、无列改写。
- **接口**：`rssSourceConfigSchema.media` 新增可选 `retry`/`retentionDays`（旧配置仍合法）；`sourceFetchOutputSchema` 新增可选已用字节字段；新增 `mediaCleanupCommandSchema` 与清理报告 DTO；`AssetSnapshot` 新增可选 `errorCode`/`attemptCount`（向后兼容）；新增清理 Run 的投影/端点。`assetStatusSchema` 不变。
- **安全**：重试沿用 ADR-0005 第 6 节的下载安全边界（http/https、公网地址、重定向、超时、魔数），不放宽；清理只删除本机 Blob Root 内由 `storageKey` 指向的内容寻址文件，删除前做引用检查，不触碰用户数据根以外的路径。
- **迁移与发布**：需要一次 migration；不涉及版本号、发布或部署。
- **回滚**：回滚代码后新增列成为未使用列（无破坏）；含 `retry`/`retentionDays` 的来源配置会被旧 strict schema 拒绝，回滚需要先清空这两个字段（与 Task 19 记录的回滚代价同型）。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0001-original-requirements.md`：追加本次用户原话（已在本轮完成）。
- `docs/requirements/0002-product-requirements.md`：新增 Phase 2 第十切片注记；ING-009 行补「重试与保留期 v1 形态」。
- `docs/architecture/0001-cosmos-foundation.md` §6.4：补充重试/清理的写入边界与生命周期注记。
- `docs/adr/0015-media-retry-retention-v1.md`（新）：冻结决策 1–11；同步 ADR 索引；更新 ADR-0005 与 ADR-0014 的 Revisit Gate 状态。
- `docs/spec/`：contracts（来源配置 schema、清理命令与 DTO）、application（重试 action、清理 action）、storage（Asset 新列与写入路径）、interfaces（API 与 Web）。
- `.agents/tasks/{新编号}-media-retry-retention/README.md`：由维护者分配编号后创建。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-09 | 起草，状态 `reviewing`，等待裁决决策 1/2/3/7/8/10 与实施授权 | Agent |
| 2026-09-09 | **确认**：重试在常规采集内自动发生且手动入口复用既有手动采集（决策 1）、可重试性用机器可读原因码判定（决策 2）、清理只删字节并把 Asset 回退 `metadata_only`（决策 8）、清理由 durable 维护 Workflow 承载（决策 10）；并授权创建 worktree/分支、按「重试 → 清理」两片实现 | 用户（评审确认） |
