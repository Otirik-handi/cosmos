# @cosmos/domain 规范化内容

## 状态

`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`。

## 最后更新

2026-08-16。

## 组件定位

`@cosmos/domain` 是来源采集结果进入 Cosmos 内容模型前的纯规范化和身份投影层。它定义 `NormalizedIngestItem`、Publisher、TemporalValue、ContentMetrics、Asset input，以及 external key、修订 fingerprint 和最小 Story projection 的语义。

Connector 调用这些纯函数生成规范化 item；application 只负责 Connector/Workflow 边界和 JSON/Blob 转换；storage 负责把观察、Entry、修订、Asset、Story 和事件写入事务。本组件不拥有公共 Zod DTO；跨 Workflow 的 JSON-safe wire shape 由[公共合同](../contracts/0001-public-contracts.md)唯一规定。domain 的接口和算法是语义层，不能替代 contracts 的边界解析，也不反向调用 contracts schema。

## 概念与定义

### 内容、发布者和采集 item

- **ContentKind** 是领域语义词汇：`post`、`article`、`video`、`audio`、`image`、`comment`、`listing`。这些值与[公共合同](../contracts/0001-public-contracts.md)的 wire enum 对齐，但本文件只规定 domain 如何消费它们，不复制 Zod 校验。
- **StoryKind** 固定为 `event`、`document`、`media`、`thread`。
- **PublisherKind** 是领域语义词汇：`user`、`channel`、`subreddit`、`official-account`、`org`、`unknown`；wire 形状和边界解析由[公共合同](../contracts/0001-public-contracts.md)拥有。
- **NormalizedAssetInput** 是领域侧附件输入：`kind`、可空 `sourceUrl`、`status`（`saved`/`metadata_only`/`skipped`/`failed`）、可空 `mimeType`、可空 `byteSize` 和 `content: Uint8Array | null`。这里的 bytes 是领域运行时值，不是 Workflow JSON 字段；Workflow 中的 BlobRef wire shape 只由[公共合同](../contracts/0001-public-contracts.md)定义，bytes 的 hash/containment 校验由[FileBlobStore](../storage/0005-file-blob-store.md)负责。
- **NormalizedIngestItem** 包含可选可空 `externalId`、`title`、可空 `summary`、`contentText`、可空 `webUrl`、`kind`、可空 `publisher`、可空 `metrics`、可空 `publishedAt`、可选可空 `updatedAt`、`sourceLocator: Record<string, unknown>`、`rawPayload`、可选 `rawPayloadMimeType` 和只读资产数组。URL 可以为 null；没有 URL 仍可凭 externalId 或 sourceLocator 建立身份。进入 Workflow JSON 前由 contracts schema 做 wire 校验，domain 不再定义第二套边界规则。

### Publisher

**PublisherMetrics** 是领域侧发布者指标语义：可选可空的 `followers`、`following`、`statuses`、`voteup` 数值和 `reliable`（`high`/`low`/`unknown`）。**Publisher** 有可空 `platformId`、`handle`、`profileUrl`、非空 `name`、`kind` 和可选可空 `metrics`。相同字段在 Workflow/HTTP 中的 wire shape 由[公共合同](../contracts/0001-public-contracts.md)校验；domain 只负责下述归一化算法。

`normalizePublisher` 不把缺失字段升级为身份：输入为 null/undefined 返回 null；name 不是字符串或 trim 后为空时整个 Publisher 返回 null；文本字段 trim，空白转 null；不在 PublisherKind 集合中的 kind 归为 `unknown`；platformId 缺失保持 null；返回对象总是显式带 platformId、name、handle、profileUrl、kind、metrics，其中 metrics 是输入值或 null。

### TemporalValue 与时间精度

**TemporalPrecision** 为 `second`、`minute`、`hour`、`day`、`week`、`month`、`year`、`unknown`；**TemporalConfidence** 为 `high`、`inferred`、`uncertain`。**TemporalFallback** 记录 `raw`、`lowerBound`、`precision`、`timezone` 和 `confidence`；**TemporalValue** 记录 `exact`（ISO 字符串或 null）、`exactPrecision`（只有 `second` 或 null）和 `fallback`。这些是 domain 语义输入/输出接口；对应的 datetime、nullable 和证据约束由[公共合同](../contracts/0001-public-contracts.md)在 wire 边界执行。

exact 是可投影的准确时间；fallback 只表达来源文本和一个下界，不等于准确发布时间。代码的所有回推和截断使用 UTC；传入 timezone 只是结果中的记录字符串，不执行时区换算。

### ContentMetrics

**ContentMetrics** 是领域侧指标语义：`values`（可选可空的 likes/views/reposts/comments/collects/score）、`raw: Record<string, string>`、`reliability`（`high`/`low`/`unknown`）和 `capturedAt`。domain 没有独立 metrics 构造函数；现有 Connector 会保留原文本，在去掉逗号后尝试转换为有限数值，至少有一个非空 raw 字段时才建立 metrics，并使用 `reliability: "unknown"` 与当前 ISO 时间。公共 wire schema 只由[公共合同](../contracts/0001-public-contracts.md)拥有；这里不复制其 Zod 规则。

### 身份、观察、Entry、修订与 Story

- **external key** 是在单个 domain item 上为来源内容选择的稳定字符串；storage 再把 source instance 纳入唯一约束。
- **revision fingerprint** 是内容修订的 SHA-256 十六进制摘要。
- **Observation** 表示一次来源捕获的不可变证据，包含 externalId、externalKey、sourceLocator、URL、捕获时间、来源发布时间及事件类型。当前持久化路径从 item 产生 `create` 或 `update`。
- **Entry** 是同一 Source instance 下由 canonical external key 归并的本地内容身份。
- **Entry Revision** 是 Entry 的追加式内容快照；变化时 revision number 增加，当前指针移动到新快照。
- **Asset** 是附着在修订上的媒体/附件持久投影；领域输入中的 bytes 在 application/storage 边界外置到 Blob 后才进入持久资产 metadata。
- **Story** 是当前实现中的最小 Entry 上层投影，身份为 `story:${entryId}`，内容取当前修订的 title/summary。Story 事务由 storage 执行，domain 只产生纯 projection。

## 外部行为

所有导出的函数都是同步纯函数，除 `createTemporalValue` 在未提供 now 时读取当前时钟外，不访问外部资源。Connector 先把各来源字段转换为本模型，再由 storage 用 external key 和 fingerprint 判断是否新建、重复或追加修订。

`createTemporalValue` 优先使用 exact；exact 无效时保留原始时间文本并创建 fallback。`deriveExternalKey` 先选稳定 externalId，再选 URL，最后用规范化字段生成 hash。`fingerprintEntryRevision` 对修订内容字段做确定性摘要。`projectEntryToStory` 只生成八个字段的最小投影。

## 输入

### NormalizedIngestItem 与资产

领域输入允许 `sourceLocator` 中存在任意未知值，也允许 `NormalizedAssetInput.content` 为 `Uint8Array`。调用者必须提供 title、contentText、kind 等字段；webUrl 可为空；externalId 也可为空，但 item 至少应有 externalId、URL 或 sourceLocator 中的定位证据。跨 Workflow 时，application 先把领域值转换为[公共合同](../contracts/0001-public-contracts.md)的 strict JSON-safe wire shape；domain 算法本身不执行该 schema 校验。

### Publisher 输入

`normalizePublisher` 接受 null/undefined 或字段值为 unknown 的记录。只有可转换为非空文本的 name 才能生成 Publisher；platformId、handle、profileUrl 不是必需身份字段。

### Temporal 输入

`createTemporalValue` 接受可选 unknown `exact`、可选可空字符串 `raw`、可选 `Date now` 和可选可空 `timezone`。exact 可以是 finite number、数字字符串或 Date 可解析字符串；raw 在 exact 失败后作为显示/来源证据。

### 身份和 Story 输入

`deriveExternalKey` 接受 optional externalId/webUrl、必需 title、可选 contentText/publishedAt/sourceLocator。`fingerprintEntryRevision` 只接受 title、summary、contentText、webUrl、kind、publisher。`projectEntryToStory` 接受 entryId、revisionId、title 和可选 summary/kind/subtype/contentKind。

## 输出

### Publisher 输出

有效输入得到带显式 `platformId`、`name`、`handle`、`profileUrl`、`kind`、`metrics` 的 Publisher；无效或空 name 得到 null。不会生成平台 ID、不会替换成任意 profile URL。

### TemporalValue 输出

exact 成功时返回 `{ exact: ISO, exactPrecision: "second", fallback: null }`。exact 失败但 raw 非空时返回 exact/exactPrecision 为 null 的 fallback；raw 为空时返回 null。`temporalProjection` 只返回 exact ISO；fallback-only value 投影为 null。

### 身份与 Story 输出

`deriveExternalKey` 返回：`external:<trimmed externalId>`、`url:<trimmed webUrl>`，或 `fallback:<64位 sha256 hex>`。`fingerprintEntryRevision` 返回 64 位 SHA-256 十六进制字符串。

`projectEntryToStory` 返回 `MinimalStoryProjection` 的八个字段：`id`、`kind`、`subtype`、`title`、`summary`、`entryId`、`revisionId`。id 固定为 `story:${entryId}`；显式 kind 优先；否则 video/audio/image 映射为 media、comment 映射为 thread、post/article/listing 映射为 document，缺省为 document；subtype 和 summary 默认 null，title 与 ID 原样保留。

## 状态与持久化

本组件无数据库、Blob 或文件持久状态。Publisher、TemporalValue、metrics、item、external key 和 fingerprint 在调用中即时生成；进程重启后不恢复任何值。领域 durable truth 由 storage owner 保存：

- Observation 保存每次来源捕获的 externalId/externalKey/sourceLocator/webUrl/capturedAt/sourcePublishedAt 等证据。
- Entry 在 `(sourceInstanceId, canonicalExternalId=externalKey)` 上保持稳定身份。
- EntryRevision 追加 title、summary、contentText、webUrl、kind、publisher、时间 JSON、sourcePublishedAt、fingerprint 和 revision number。
- Asset 记录修订下的 kind/status/sourceUrl/storageKey/mimeType/byteSize；bytes 通过 application/storage 的 Blob 边界保存。
- Story/StoryRevision 保存最小 Story 投影及当前指针。

## 状态转换

domain 函数本身没有可变状态机；storage 按这些语义转换 durable 内容：

1. 首次遇到一个 Source instance + external key 时，创建 Observation、Entry、revision 1，并生成 `story:${entryId}` 的 Story 投影。
2. 同一 run 和 external key 再次出现时，返回 duplicate observation 结果，不追加同一次运行的重复观察。
3. 已有 Entry 的当前修订 fingerprint 相同时，不追加内容 revision；实现可以更新新的 exact 发布时间、updatedAt JSON 或 metrics。
4. fingerprint 改变时追加 revision number +1，并使新修订成为 current；Observation 的 eventKind 为 update。
5. Story 事务以当前 title/summary 追加或更新 StoryRevision 并移动 current 指针；该写入由 storage transaction 完成，不是 domain 函数副作用。
6. 公共 Observation DTO 虽然允许 `delete`/`snapshot`，但当前 item persist 路径只产生 `create`/`update`，不能把枚举值写成已实现的来源处理能力。

## 副作用

`normalizePublisher`、`createTemporalValue`、`temporalProjection`、`mapContentKindToStoryKind`、`deriveExternalKey`、`fingerprintEntryRevision` 和 `projectEntryToStory` 不写数据库、不写 Blob、不发网络请求、不写日志、不发 Domain Event。唯一的时间外部输入是 createTemporalValue 在缺少 now 时读取本地进程时钟；hash 使用 `node:crypto`。

Connector 读取外部来源的网络/进程副作用属于 Connector；storage 将 item 写入数据库、保存 raw payload/asset bytes、更新 run 计数、写事件属于 storage/application。不能把这些邻接副作用归入 domain。

## 错误与降级

- `normalizePublisher` 对 null/undefined 或无有效 name 降级为 null；未知 Publisher kind 降级为 `unknown`，不会抛出或虚构身份。
- `createTemporalValue` 对无效 exact 降级到 raw fallback；无有效 exact 且 raw 为空返回 null；无法识别的 raw 保留原文、当前时间下界、`unknown` 精度和 `uncertain` 置信度。
- 非法日期不会被当作合法日期；月日候选只选当前年或前一年中的合法日期，且选距 now 最近者。
- fingerprint 和 external key 不因缺 URL 失败：externalId、URL 都缺时使用 fallback hash；sourceLocator 参与 hash 以减少同标题碰撞。
- domain 不负责把 storage 冲突、Blob 完整性、Connector malformed payload 或 workflow lease 错误转换为公共错误；这些由相应 owner 处理。

## 依赖

- `node:crypto` 的 `createHash("sha256")`。
- Connector：`plugins/rss/src/index.ts` 的 `parseRssXml` 使用 Publisher/Temporal 规范化并生成 article；`plugins/collectors/src/index.ts` 的 `normalizeBilibiliOutput` 与 `normalizeAiHotItem` 使用 Publisher、Temporal、metadata Asset 和 metrics。
- Application：`packages/application/src/index.ts` 的 `IngestConnector` 返回 readonly NormalizedIngestItem 且不持久化；`packages/application/src/workflow-ingest.ts` 的 `toJsonItem/fromJsonItem` 在 JSON wire shape 与 Blob bytes 之间转换。
- Storage：`packages/storage-prisma/src/index.ts` 的 `persistIngestItemInternal` 使用 external key、fingerprint 和 exact temporal projection；Prisma schema 的 Observation、Entry、EntryRevision、Asset、Story、StoryRevision 是 durable owner。
- 跨边界 JSON schema：[公共合同](../contracts/0001-public-contracts.md)。该 schema 是 wire owner；本文件保留 domain 语义算法和运行时接口，不另立一套边界解析规则。

## 配置

本组件没有环境变量、配置文件、路径或网络端点。时间函数可通过调用参数传入 `now` 和 `timezone`；缺失时 now 使用当前 Date，timezone 记录为 `UTC`。Connector 的来源配置、fixture 路径和 OpenCLI/HTTP 参数不属于 domain 配置。

## 重建验收

1. **External ID 优先**：给定 externalId 为 `"  guid-1 "`，即使 title/URL 存在，也观察到 `external:guid-1`，且不访问网络或写存储。
2. **URL 与无 URL fallback**：给定无 externalId 但 URL 为 `" https://example.test/a "`，观察到 `url:https://example.test/a`；给定二者皆无且 title/content/exact/sourceLocator 有值，观察到 `fallback:` 后 64 位小写十六进制摘要，且不因 URL 缺失返回 null。
3. **Fallback 稳定性**：给定相同 title/content/exact/sourceLocator（对象键顺序不同），两次 external key 相同；给定 sourceLocator 值变化，观察摘要变化；不允许使用未排序对象 JSON 导致顺序敏感。
4. **Revision fingerprint**：给定只改变 contentText 的两个输入，观察 fingerprint 不同；给定相同六字段，观察 fingerprint 相同；改变 metrics、assets、raw payload、fallback 或 updatedAt 不应改变该函数输入之外的 fingerprint。
5. **Publisher 清洗**：给定空白 platformId、空 handle、null profileUrl 和有效 name，观察返回 platformId/handle/profileUrl 均为 null、metrics 为 null；给定未知 kind 观察 kind 为 `unknown`；给定空 name 观察整体返回 null，不生成 platform ID。
6. **Exact 时间优先**：给定数值 `1_786_170_123` 与 raw `3小时前`，观察 exact 为 `2026-08-08T06:22:03.000Z`、precision 为 second 且 fallback 为 null；不应先使用 raw。
7. **时间单位精度**：给定 now=`2026-08-10T12:00:00.000Z` 和 `3小时前`，观察 fallback precision=hour、lowerBound=`2026-08-10T09:00:00.000Z`；给定 `2周前`，观察 precision=week、lowerBound=`2026-07-27T00:00:00.000Z`；给定 `07-29湖南`，观察 precision=day、lowerBound=`2026-07-29T00:00:00.000Z`。不得把 lowerBound 作为 exact。
8. **时间降级**：给定非法 exact 且 raw 为空，观察返回 null；给定未知 raw，观察 fallback precision=unknown、confidence=uncertain、lowerBound 等于传入 now 的 ISO；给定 timezone=`Asia/Shanghai`，观察其只出现在 fallback 字段，不改变 UTC 回推结果。
9. **Temporal projection**：给定 exact TemporalValue，观察 `temporalProjection` 返回 exact；给定 fallback-only value，观察返回 null；storage 的 publishedAt 不得把 fallback lowerBound 当准确 DateTime。
10. **Story projection**：给定 entry-1/revision-1/title，观察 id=`story:entry-1`、kind=document、subtype/summary 为 null；给定 contentKind=video，观察 kind=media；给定显式 kind，观察其优先于 contentKind；不额外生成非八个字段。
11. **修订持久语义**：在 storage 测试中给定同 source/run/external key 的重复观察，观察 duplicateObservation=true 且不追加 revision；给定 fingerprint 改变，观察 revision number 增加 1 且 current 指向新修订；给定 fingerprint 不变但 exact 时间变化，观察只更新允许的时间/metrics字段，不产生内容 revision。
12. **纯函数边界**：调用所有 domain 导出函数并比较调用前后的数据库、Blob Root、网络请求和日志计数，观察均无 domain 直接副作用；进程重启后不应从 domain 模块恢复任何 durable state。

## 实现与测试锚点

- `packages/domain/src/index.ts`：`storyKinds`、`contentKinds`、`publisherKinds`、`temporalPrecisions`、`TemporalFallback`/`TemporalValue`/`Publisher`/`ContentMetrics`/`NormalizedAssetInput`/`NormalizedIngestItem` 类型；`deriveExternalKey`、`fingerprintEntryRevision`、`normalizePublisher`、`createTemporalValue`、`temporalProjection`、`mapContentKindToStoryKind`、`projectEntryToStory`。
- `packages/domain/src/index.ts`：`parseExactTimestamp`、`parseTemporalFallback`、`stableStringify` 是重建时间精度、UTC 和 external key 稳定性的内部锚点。
- `packages/domain/src/index.test.ts`：ingestion identity 测试覆盖 external id、无 URL fallback key、内容变化 fingerprint、Publisher 缺 platform id、exact numeric timestamp、`3小时前`、`07-29湖南`、`2周前`、stable story id 和 video→media。
- `plugins/rss/src/index.ts:243-322`：`parseRssXml` 的 RSS 字段到 NormalizedIngestItem 映射；`:366-380` 的 enclosure metadata asset。
- `plugins/collectors/src/index.ts:433-524`、`:527-610`、`:730-779`：Bilibili/AI HOT item、metadata asset、ContentMetrics 的来源映射。
- `packages/application/src/index.ts:231-254`：IngestConnector 端口；`packages/application/src/workflow-ingest.ts:351-417`：JSON item 与 BlobRef 往返。
- `packages/storage-prisma/src/index.ts:806-1166`：`persistIngestItemInternal` 的 external key/fingerprint、duplicate/revision、exact time 和事务投影；`:1489-1699`：Entry/Story/Revision/Observation 读取投影。
- `packages/storage-prisma/prisma/schema.prisma:137-249`：Observation、Entry、EntryRevision、Asset、Story、StoryRevision 持久模型字段和关系。

## 非目标/边界

- 不把领域 `NormalizedAssetInput.content: Uint8Array` 直接当 Workflow JSON；bytes 的 BlobRef 转换由 application/storage 和[公共合同](../contracts/0001-public-contracts.md)负责。
- 不把 URL 当必填身份字段；URL 可为空，externalId、sourceLocator 或 fallback hash 仍可构成 key。domain 函数本身不把 source instance 拼入 key，跨来源唯一性由 storage 约束。
- 不把 fallback lowerBound 当 exact 发布时间；只有 exact 可由 `temporalProjection` 写入 sourcePublishedAt 的准确投影，fallback 证据仍保存在 JSON 语义中。
- 不把 metrics、assets、raw payload、Temporal fallback 或 updatedAt 纳入 `fingerprintEntryRevision`，除非实现的六字段输入本身发生变化。
- 不声称 domain 处理 delete/snapshot observation；公共 DTO 的枚举比当前 persist item 路径更宽。
- 不把 Story projection 扩展为聚类、合并、推荐或完整事件模型；当前实现只提供 `story:${entryId}` 的最小投影。
- 不把 Connector 网络、OpenCLI、Prisma 事务、Blob Root、Workflow lease、SSE 或日志副作用归入 `@cosmos/domain`。
