# ADR-0015：媒体失败重试与保留期清理 v1

> 状态：Accepted design contract
>
> 日期：2026-09-09
>
> 关联：[`media-retry-retention-v1 Proposal`](../proposals/media-retry-retention-v1.md)、[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §6.4、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ING-009、ADR [`0005`](0005-media-boundary-v1.md)、ADR [`0014`](0014-per-source-media-policy-v1.md)

## Context

ADR-0005 决策 7 冻结了媒体的「不自愈」生命周期：条目内容指纹不变就不产生新 Revision，也就不会重新提取与下载媒体。ADR-0014 交付了按来源的图片开关与预算收紧，并在 Revisit Gate 中把「失败重试与历史回填」登记为未决部分。PRD ING-009 的原始要求是「按 SourceInstance 配置媒体类型、单文件/单次预算、**保留期**和**失败重试**」，前两项已落地，后两项仍缺。

两个缺口都需要 ADR-0005 明确拒绝在 v1 打开的写路径：**不产生新 Revision 也能改写已存 Asset**（重试）与**删除已存媒体字节**（清理）。2026-09-09 用户裁决四项：重试在常规采集内自动发生、手动入口复用既有手动采集；可重试范围用机器可读原因码判定；清理只删字节并把 Asset 回退为 `metadata_only`（不新增公共状态枚举）；清理由 durable 维护 Workflow 承载。本文沉淀这些稳定决定。

## Decision

### 1. 重试发生在来源的常规采集 Run 内

`cosmos.ingest@1` 在 `source.fetch@1` 之后、`library.ingest@1` 之前增加 `media.retry.fetch@1` 与 `media.retry.apply@1` 两步：前者按本次 Run 的来源查询可重试的**已存** Asset 并重新下载，后者在 host fence 下原地更新 Asset 行。放在持久化之前，是因为「重试」的语义是**该来源的下一次采集**，而不是同一次 Run 里对同一批字节立刻再试一次。定时采集与 `POST /api/v1/sources/:sourceId/runs` 走同一条路径，因此自动重试与手动重试是同一个机制，不新增端点、按钮或 Run 类型。重试与本次 Run 新内容共享单次预算。

### 2. 可重试性由机器可读的 `Asset.errorCode` 决定

`Asset` 新增可空 `errorCode`。媒体获取组件在写入降级状态时同时写入原因码；重试判定只依赖 `status` + `errorCode`，不解析面向用户的 `errorMessage` 文案。可重试集合为 `timeout`、`network`、`http_error`、`budget_run`；`budget_file`、`not_image`、`security_blocked`、`invalid_url`、`retention_expired` 与历史未知值一律不重试。

### 3. 每来源重试上限，尝试次数记录在 Asset 上

`Source.config.media.retry.maxAttempts`（可选，含首次尝试，缺省 3，0 = 关闭，上界 10）。`Asset` 新增 `attemptCount` 与 `lastAttemptAt`；每次下载尝试（含首次）+1。`attemptCount >= maxAttempts` 的 Asset 不再进入重试候选，直到条目修订产生新的 Asset 行（计数从 0 重新开始），与 ADR-0005「只有条目修订才重新提取」一致。

### 4. 重试只改写 Asset 行，不产生新 EntryRevision

重试成功时在同一事务内写 Blob（内容寻址去重）并把该 Asset 更新为 `saved` + `storageKey`/`byteSize`/`mimeType` + `errorMessage: null`；失败时只更新 `errorCode`/`errorMessage`/`attemptCount`/`lastAttemptAt`。`contentFingerprint` 不参与，因此不产生新 Revision、不改变 Feed 排序、不影响已有 Observation。更新以 `(assetId, attemptCount)` 为 CAS 条件，并发重试后到者放弃。每次重试写 DomainEvent 与结构化日志，`actor` 记为 system。

### 5. 重试与本次 Run 的新内容共享单次预算

`source.fetch@1` 输出新增可选的已用媒体字节字段（向后兼容），重试步骤用 `maxRunBytes - 已用` 作为自己的预算；超出的候选保持原状并记 `budget_run`，留给下一次采集。重试不单独用满一份预算。

### 6. 每来源保留期，缺省永久保留

`Source.config.media.retentionDays`（可选，1–3650；缺省或 0 = 永久保留）。只作用于该来源的 `saved` 图片 Asset，按 `Asset.createdAt` 计算到期。

### 7. 清理是显式命令，先预览再确认

`POST /api/v1/media-cleanups` 接受可选 `sourceId` 与 `dryRun`。`dryRun: true`（缺省）只返回候选条数、总字节、按来源摘要与有限样例，不写任何数据；`dryRun: false` 执行删除并返回同一份报告加实际删除数。**不随采集自动删除**——PRD 的验收条件是「修改策略只影响后续采集或明确的清理任务，不静默删除已有数据」。

### 8. 清理只删字节，Asset 行保留并回退为 `metadata_only`

执行时删除 Blob 字节，并把 Asset 更新为 `status: metadata_only`、`storageKey: null`、`byteSize: null`、`errorMessage: "已按保留期清理（保留 N 天）"`、`errorCode: "retention_expired"`，保留 `sourceUrl` 与 `mimeType`。界面沿用既有「仅记录元数据 + 原文外链」展示；公共 `assetStatusSchema` 4 态不变（ADR-0005 拒绝枚举膨胀）。不删除 Asset 行，历史 Revision 的资产清单保持完整。清理后不自动重新下载（与「无历史回填」一致）。

### 9. 删除 Blob 前做引用检查

Blob 是内容寻址且天然去重，多条 Asset 可能共享同一个 `storageKey`。删除前在同一事务内确认没有其它 Asset 引用该 key；仍有引用则只更新当前 Asset 行、不删字节。Workflow journal value 与媒体共享 Blob Root，但同一 key 意味着字节完全相同（canonical JSON 与图片字节相同可忽略），记为已接受风险。

### 10. 清理由 durable 维护 Workflow 承载

新增最小维护 Workflow `cosmos.media-cleanup@1`（单 action `media.cleanup@1`），由 Worker 执行删除与数据库更新；API 只创建 Run 与查询结果。与架构「Maintenance 与 Ingest 使用同一 Runtime」的既定方向一致，不把新能力放进正在被取代的旧 Job 泳道。

### 11. 清理与重试互不干扰

清理只处理 `saved`，重试只处理 `failed`/`skipped`。被清理的 Asset 变为 `metadata_only`，不在重试范围内，因此不会「清了又下、下了又清」。

## Consequences

### Positive

- 用户第一次有了对降级媒体的补救手段：瞬时失败会自愈，预算饿死的图集帖有机会在后续采集补齐。
- 已保存媒体可以按来源回收，个人本地长期运行不会无限增长；清理前可预览、可审计。
- 公共状态枚举与既有读取投影不变；新增能力全部走已有路径（采集 Run、维护 Run、Asset 快照）。

### Costs and risks

- 新增一次 migration（`Asset` 三列）。历史降级 Asset 的 `errorCode` 为 null，按 `unknown` 处理、不自动重试，是已知限制（无历史回填）。
- `media.retry@1` 让每次采集多一次候选查询与可能的外网请求；上限由 `maxAttempts` 与单次预算共同约束。
- 清理是不可逆操作：字节删除后只能靠条目修订重新下载，没有「撤销」。
- Blob 引用检查在 SQLite 单写者下够用；引入多主机/对象存储后需要重新评估。

## Alternatives considered

### 独立维护 Workflow + 新端点做重试

拒绝（决策 1）。为同一件「换一次网络机会」的动作复制 contracts/API/Web 三层合同，而来源已有采集入口。

### 只做手动重试

拒绝（决策 1）。PRD 要求按来源配置重试，且来源本来就在定时轮询；手动模式要求用户记得点。

### 按 `errorMessage` 文案判断可重试性

拒绝（决策 2）。文案是面向用户的展示文本，用它做控制流是隐藏耦合。

### 只重试 `failed`

拒绝（决策 2）。图集帖吃光预算导致的 `skipped` 正是最值得重试的一类。

### 重试独立用满一份 Run 预算

拒绝（决策 5）。一次 Run 的实际外网流量会翻倍且不可见。

### 新增第 5 个公共状态 `expired`

拒绝（决策 8）。ADR-0005 明确拒绝枚举膨胀；`metadata_only` + 原因文案已能表达，读取侧无需改动。

### 删除 Asset 行

拒绝（决策 8）。会丢掉「这里曾经有一张图」的事实与原文外链，且让历史 Revision 的资产清单失真。

### 定时自动清理 / 随采集顺带清理

拒绝（决策 7）。静默删数据，违反 ING-009 的验收条件。

### 旧 Job 泳道承载清理

拒绝（决策 10）。旧泳道正在被 durable workflow 取代，新能力不应落在退役路径上。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 引入历史媒体回填，或需要清理后自动重新下载（改变「单向清理」语义）；
- 单条目媒体数量上限、音频/视频下载实体或全局默认值的 env 化进入实现（改变预算与生命周期语义）；
- 引入多用户、远程 Worker 或对象存储，Blob 引用检查与删除授权需要按新威胁模型重评；
- 维护 Workflow 的 Run 投影需要与 Ingest Run 分离为独立查询面。
