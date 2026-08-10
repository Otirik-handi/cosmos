# Task 05：规范化内容模型

## User Request / Topic

多平台 Connector 的字段差异不能穿透 Observation、Entry、Revision 和 Story 边界。本 Task 固化唯一的 `NormalizedIngestItem` 输出合同，并完成 RSS、Bilibili、AI HOT 的标准化与持久化。

## Goal

Connector 返回一条可验证、可持久化、可回放的标准化内容：

```text
Provider
  -> IngestConnector
  -> NormalizedIngestItem
  -> Observation
  -> Entry / EntryRevision / Asset
  -> Story projection
```

## Contract

`NormalizedIngestItem` 包含：

- 内容身份：`externalId?: string | null`、`webUrl?`、`sourceLocator`。
- 内容属性：`title`、`summary`、`contentText`、`kind: ContentKind`。
- 发布者：`publisher: Publisher | null`；`platformId: string | null`，空白 ID 规范化为 `null`；`kind` 可为 `unknown`。
- 指标：`metrics: ContentMetrics | null`，存为 Entry 当前快照。
- 时间：`publishedAt: TemporalValue | null`、`updatedAt?: TemporalValue | null`。
- 证据与媒体：`rawPayload`、可选 MIME 类型和 `assets`。

`ContentKind` 与 Story 的 `StoryKind` 分开；通过显式映射投影。缺少内容 external ID 时，持久层使用 external ID、稳定 URL 或来源定位加规范化内容生成 fallback key。作者 ID 不参与内容身份。

`TemporalValue` 优先使用证据层 exact 时间并统一为 UTC；展示文本只在 exact 缺失时生成 fallback。旧 `sourcePublishedAt` 继续作为查询/API 的 exact UTC 投影。fallback 到 exact 的精度提升不创建 Revision。

## Implementation

- `packages/domain` 定义内容、发布者、指标、时间类型，提供作者规范化、时间解析和 ContentKind 到 StoryKind 的映射。
- `packages/contracts` 提供对应 Zod schema，并允许作者 ID 为空。
- `plugins/rss` 将 RSS `author`、`creator` 映射为 Publisher；无作者时返回 `null`，内容默认为 `article`。
- `plugins/collectors` 将 Bilibili 作者从摘要/正文移出；`hot` 为 `listing`，`feed` 为 `video`，并提取可用指标和作者 ID。
- `packages/storage-prisma` 保存 Observation 快照、Entry 当前指标、EntryRevision 的 Publisher/ContentKind/TemporalValue，并保留现有时间查询投影。
- `IngestConnector` 按 `Source.kind` 解析，负责配置校验、外部读取、标准化和 cursor，不直接访问 Prisma、SQLite 或 Blob。`SourceOperation` 留作未来操作粒度。

## Revision Rules

- 标题、摘要、正文、ContentKind 或 Publisher 发生语义变化时创建 EntryRevision。
- 指标变化只更新当前快照，不创建 Revision。
- 时间 fallback 被 exact 覆盖时只更新时间值，不创建 Revision。
- 作者平台 ID 缺失不会阻止入库，也不会改变内容 external key。

## Verification

- Domain/contract：作者空 ID、Publisher 缺失、精确时间优先、fallback 解析和 Story 映射。
- Connector：RSS 作者映射、Bilibili listing/video、作者 ID、指标和原有受管场景。
- Storage：Publisher JSON、ContentKind、TemporalValue、指标无 Revision 刷新、URL-free fallback key。
- 全部通过 `bun run test`、`bun run typecheck`、`bun run db:validate` 和 `git diff --check`。

## Non-goals

- 不新增平台，不实现 Connection、SecretStore、ConnectorStateStore 或完整 SourceOperation Runtime。
- 不引入任意 `extensions` 持久化。
- 不实现 Publisher 独立表、作者筛选 UI 或完整 Feed 作者展示。
