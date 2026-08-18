# Prisma 领域仓储（`PrismaCosmosRepository`）

## 状态

当前实现规格；后续代码变化应同步更新本文。本文记录当前实现中 `@cosmos/storage-prisma` 的领域仓储行为，不把需求、Draft 或历史 Spike 当作实现。

## 最后更新

2026-08-16

## 组件定位

`PrismaCosmosRepository` 实现 application 的 `CosmosRepository` 端口，负责 SQLite/Prisma 中的 Source、legacy ingestion Run/Step/Job、Checkpoint、规范化内容、Blob 元数据、DomainEvent、Feed/Search/Story/Entry/Revision 查询、Worker heartbeat 与存储健康投影。API、`IngestionService`、`IngestionWorker` 只通过 application 端口访问它；Connector 不直接访问 Prisma。

它不拥有 Durable Host 的 Kernel state CAS、Workflow Run lease、Activity Job/Completion 生命周期或 EventSink 的 Run lease 合同；这些行为分别见 [`0002-workflow-backend.md`](0002-workflow-backend.md)、[`0003-workflow-host-store.md`](0003-workflow-host-store.md) 和 [`0004-workflow-event-sink.md`](0004-workflow-event-sink.md)。共享 DTO 只引用 [`../contracts/0001-public-contracts.md`](../contracts/0001-public-contracts.md)，规范化内容只引用 [`../domain/0001-normalized-content.md`](../domain/0001-normalized-content.md)。

### 在系统中的位置与作用
它是 SQLite/Prisma 领域持久化层，实现 application 的 `CosmosRepository` 端口，承接 Source、legacy ingest、内容查询和领域写入。

### 解决的问题
它把规范化内容、Checkpoint、Blob metadata、DomainEvent、Feed/Search/Story 等读写放进事务和统一查询入口，避免 API、Worker 或 Connector 各自操作数据库。

### 使用方式
API、`IngestionService` 和 legacy `IngestionWorker` 只调用 application port，由本 Repository 执行 SQL/Prisma；Connector 先经 application/domain，Durable Host 的 Backend/lease 行为则调用相邻 storage 组件。

### 典型情景
保存一次 legacy ingest 结果、读取 Feed/Search/Story，或提供 Worker heartbeat/存储健康投影时，选择本 Repository。


## 概念与定义

- **Source（来源实例）**：`SourceInstance` 行，保存名称、Connector kind、JSON 配置和启用状态；公共 Source snapshot/config 的唯一 DTO 定义由 contracts owner 持有。
- **Checkpoint（来源游标）**：每个 Source 至多一行的 cursor 记录。`revision`、`workflowRunId` 是 Workflow ingest 路径增加的 CAS/provenance 字段；旧 `setCheckpoint` 不使用 CAS。
- **Legacy Run、Step、Job**：旧采集 lane 的 durable 账本。Run 属于 Source，Step 按 `(runId, position)` 唯一，Job 可关联 Run/Step，也可独立作为 probe；`kind = workflow-activity` 的 Job 不应被本仓储的 legacy worker claim。
- **Observation（观察）**：一次来源捕获的不可变证据，带来源定位、内容、external key、raw payload Blob key 和 provenance；其领域字段/身份规则由 domain owner 定义。
- **Entry、Entry Revision**：Entry 是由 Source 与稳定 canonical external key 归并的本地内容身份；修订按 `(entryId, revision)` 追加，Entry 的 `currentRevisionId` 指向当前修订。
- **Asset、Story**：Asset 从属于 EntryRevision，保存媒体元数据和可选 Blob key；Story 是当前实现中的最小 Entry 上层投影，StoryRevision 追加标题/摘要并由 current revision 指针选中。
- **Domain Event**：`DomainEvent` 是 append-only 事件账本；SQLite 自增 `sequence` 是 replay 游标，`eventId` 唯一，payload 以 JSON 字符串保存。Workflow event 的 idempotency/lease 细节由 EventSink spec 拥有。
- **FTS、Feed、Search、SSE replay**：仓储在初始化时创建 `entry_search` FTS5 表；Feed/Search 从当前 Entry/Revision/Story 关系读取，SSE 只消费按 DomainEvent sequence 查询出的事件，连接、keepalive 和 snapshot_required 由接口组件负责。

## 外部行为

### 存储根和连接

`resolveStorageRoots(dataRoot = COSMOS_DATA_ROOT 或 `.cosmos`, workspaceRoot = COSMOS_WORKSPACE_ROOT 或 `process.cwd()`)` 将相对 data root 锚定到 workspace，并派生 `cosmos.sqlite`、`blobs`、`artifacts`、`cache`、`logs`、`secrets`。`createPrismaClient` 使用 `DATABASE_URL` 覆盖派生的 SQLite URL，否则使用该 database path。`initialize()` 连接 Prisma 并执行：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entry_search USING fts5(
    entry_id UNINDEXED, title, content_text, tokenize = 'unicode61'
)
```

初始化或 `$connect` 失败会抛出原异常；`close()` 断开 Prisma，失败也向上抛出。

### Source、legacy Run/Step/Job

- `createSource` 将 config JSON 化后创建 Source，`enabled` 缺省为 `true`；`listSources` 按 `createdAt ASC`；`getSource` 缺失返回 `null`；`setSourceEnabled` 只更新 enabled。
- Source snapshot 会解析 `kind/config`，并额外查询最新 Run：`lastRunAt` 优先取 `finishedAt`，否则取该 Run 的 `createdAt`；`lastError` 取最新 Run 的 `errorMessage`。
- `createRun` 在同一事务内创建 `running` Run、position 0 的 `running` Step 和 `leased` 的 `source-ingest` Job；Job owner 为 `synchronous-ingest`、attempts 为 1、lease 为当前时间后五分钟，并写 `run.queued.v1`。
- `createQueuedRun` 在同一事务内创建 `queued` Run、`queued` Step 和 `queued` 的 `source-ingest` Job，并写 `run.queued.v1`。有 idempotency key 时，若同 key 已存在且关联 Run，则直接返回原 Run；新 Job 的 payload 至少包含 `sourceId`。
- `createProbeJob` 按 idempotency key 查已有 Job，否则创建独立的 `source-probe`/`queued` Job 并写 `job.queued.v1`。Probe 的成功结果只写 Job，不持久化 Entry 或 Checkpoint。
- `claimNextJob` 只在调用者提供的 `acceptedKinds` 集合内选择，候选为到期可执行的 `queued`/`retry_wait` 或 lease 已过期的 `leased`，按 `createdAt ASC` 取一条。更新谓词包含候选原 status；对已 leased 候选还包含旧 lease owner/token/expiry。成功后 attempts 加一、生成新的随机 lease token、保存 owner/expiry、清空 nextAttemptAt。
- `renewJobLease` 只按 Job id、token、status=`leased` 更新 expiry，并以受影响行数是否为 1 返回 boolean。`completeJob` 只接受当前 token/status，并在事务中写状态、result/error、清空 lease；`retry_wait` 的 nextAttemptAt 默认是当前时间后 30 秒，也可使用调用方给的 retryDelayMs。
- Legacy Job 的实现状态值为 `queued`、`leased`、`retry_wait`、`succeeded`、`failed_terminal`、`cancelled`；claim 发现 attempts 已达到 maxAttempts 时，会在事务内把 Job 置为 `failed_terminal`、清租约、若有关联 Run 则将 Run 置为 `failed` 并写 `job.failed_terminal.v1`，然后返回 `null`。
- `startRun`、`completeRun`、`resetRunForRetry` 在事务内同步更新 Run 和关联 Step 并写事件。传入 legacy `JobLease` 时，先用 Job id、Run id、token、status=`leased` 校验；stale token 会拒绝写入。`completeRun` 无 lease 时还会把该 Run 的 Job 清除租约并映射为 succeeded/cancelled/failed_terminal；带 lease 时不主动清除其它 Job。

### Observation、Entry、Revision、Asset、Story

`persistIngestItem` 和 `persistWorkflowIngestItem` 先使用 domain 规则计算 external key、Entry revision fingerprint、时间/Publisher/Metrics JSON；raw payload 先在数据库事务外写入 Blob Store，状态为 `saved` 且带内容的 Asset 也在事务外写入 Blob。随后一个 Prisma transaction 完成领域写入：

1. Workflow 路径先校验 Run lease、Activity Job lease、attempt 和 kernel revision fence；`ingestCommandId` 已存在时返回已有 `ingestResultJson`，不重复领域写入。legacy Run 内若已有同 `(sourceInstanceId, runId, externalKey)` Observation，也返回 duplicate。
2. 创建 Observation，记录 source/run/workflow provenance、`ingestCommandId`、external id/key/revision、eventKind、source locator/discovery JSON、正文、标题、URL、内容 fingerprint、content kind、Publisher/Metrics/Temporal JSON、exact sourcePublishedAt 和 raw payload Blob key。
3. 找不到 Entry 时创建 Entry。若已有 current revision 的 fingerprint 相同，不追加 EntryRevision，只允许刷新 metrics 和发生变化的 published/updated 时间，并将此次 Observation/Run 结果标为 duplicate；fingerprint 改变时按 current revision 加一追加 EntryRevision。
4. 新修订会 upsert `story:<entryId>` Story，追加 StoryRevision，更新 Entry/Story current revision，写入该修订的 Asset 行，并删除后重新插入该 Entry 的 FTS5 行。
5. 写 `entry.created.v1` 或 `entry.revised.v1`，并写 `feed.updated.v1`。legacy Run 递增 item/created/revised/duplicate 计数；Workflow 路径不使用 legacy Run 计数。返回 `createdEntry`、`revisedEntry`、`duplicateObservation` 三个 boolean。

Raw payload/Asset Blob 写入发生在数据库事务前；数据库事务失败时没有跨系统补偿删除这些已写入 Blob 的实现。FileBlobStore 对同一内容 key 使用不覆盖写入，但本仓储不会为已存在的 Blob 再次做完整性验证。

### Checkpoint、领域查询、事件 replay

- `getCheckpoint` 返回 cursor；`getCheckpointSnapshot` 返回 cursor 与 revision；缺失行投影为 `null` 与 `0`。
- legacy `setCheckpoint` 使用 upsert，只替换 cursor，不检查 revision。
- `setWorkflowIngestCheckpoint` 在一个 transaction 中先校验 Workflow Action fence，再检查 Workflow domain event 的 `(workflowRunId, idempotencyKey)`。同 key 已存在时读取并返回其结果；当前 revision 不等于 expectedRevision 时保留当前 cursor/revision，写 `source.checkpoint.superseded.v1`，返回 `committed=false`；匹配时把 revision 加一、写 cursor/workflowRunId 和 `source.checkpoint.committed.v1`，返回 `committed=true`。
- `feed` 按 Entry `updatedAt DESC` 使用非负 offset cursor，查询 `limit + 1` 行判断是否有 nextCursor；只投影有 current EntryRevision 与 Story current revision 的 Entry。`entries` 同样按 `updatedAt DESC`，可按 Source 过滤，并返回修订/观察计数与当前 Asset。
- `search` 的文本条件使用 `entry_search MATCH ?` 和 `bm25(entry_search)`，按 rank 升序再按 Entry updatedAt 倒序；无文本时按 Entry updatedAt 倒序。可按 Source、publishedAfter、publishedBefore 过滤，日期必须能解析为合法 ISO 时间。Search/Feed/Entries 都返回 offset 形式 nextCursor。
- `story`、`entry`、`revision` 返回 contracts 规定的白名单投影；不存在、或 Story/Entry 没有 current revision 时返回 `null`。修订与观察按实现中的时间/修订排序读取。
- `readAsset` 查 Asset 的 storageKey，再从 Blob Store 读取 bytes 并返回 mimeType；Asset 缺失或没有 storageKey 返回 `null`，Blob read 错误向上抛出。
- `events({afterSequence, limit})` 读取 `sequence > afterSequence`、按 sequence 升序的 DomainEvent，事件 id 投影为 sequence 字符串；`latestEventSequence` 返回最大 sequence 或 0。这是 SSE replay 的持久查询，不负责 SSE 连接或 snapshot_required。
- `touchWorkerHeartbeat` 按 instanceId upsert status/version/lastSeenAt，status=`stopped` 时写 stoppedAt。`health()` 先执行 `SELECT 1`，再读最新 heartbeat；没有 heartbeat 为 unknown，lastSeenAt 超过 90 秒为 stopped，存储查询失败为 storage/migration failed。

## 输入

- Source、Run、Job、Feed、Search、Story、Entry、Revision、Asset、Event、Health 的公共输入/输出由 [`../contracts/0001-public-contracts.md`](../contracts/0001-public-contracts.md) 与 application 的 `CosmosRepository` 端口拥有；仓储不复制 DTO。
- `NormalizedIngestItem`、`NormalizedAssetInput`、Publisher、TemporalValue、ContentMetrics、`deriveExternalKey` 与 fingerprint 规则由 [`../domain/0001-normalized-content.md`](../domain/0001-normalized-content.md) 拥有。仓储将已规范化对象 JSON 化后写入列。
- `claimNextJob` 的 `acceptedKinds` 为空时立即返回 `null`；legacy worker 通过 `source-ingest`、`source-probe` 白名单隔离 `workflow-activity`。Job lease 必须为正整数；本仓储不声明默认 lease 配置。
- Feed/Search/Entries 的非法、负数或非数值 cursor 由 `parseCursor` 按 offset 0 处理；Search 日期解析失败抛出明确错误。
- Source/Run/Job/Checkpoint/Asset id 为字符串。查询缺失通常返回 `null`，Prisma `update` 找不到目标时保留底层异常，不统一包装为公共 NotFound DTO。

## 输出

成功输出是 contracts/application 端口定义的快照、页和事件白名单；内部 Prisma row、数据库 URL、绝对路径、secret 不作为公开 API 输出。仓储内部的 Asset snapshot 可能携带 storageKey，Product API 的公开投影另行剥离。Feed/Search/Entries 使用 `nextCursor = offset + limit` 或 `null`；DomainEvent replay 的 id 为 sequence 字符串。

## 状态与持久化

SQLite Prisma schema 是权威 durable truth。当前模型/关系的重建要点如下：

| 模型 | 代码可证的关键字段/约束 | 关系/删除边界 |
| --- | --- | --- |
| `SourceInstance` | id、name、kind、configJson、enabled、createdAt、updatedAt | 拥有 observations、runs、checkpoint、entries；Observation/Entry/Checkpoint 级联，Run 外键为 RESTRICT |
| `Checkpoint` | sourceInstanceId 唯一、cursor、revision、workflowRunId、updatedAt | 属于 Source；WorkflowRun 删除时 workflowRunId SET NULL |
| `Run` | source、triggerKind、status、created/started/finishedAt、item/created/revised/duplicate 计数、errorCode/errorMessage | 拥有 Step/Job/Observation/DomainEvent；子记录按 schema 级联或 SET NULL |
| `Step` | runId、position 唯一、kind/status/attempts、input/output/error/时间 | 属于 Run，删除级联；Job 可关联 Step |
| `Job` | 可选 runId/stepId/workflowRunId、可选 workflowKernelRevision、kind/status、payload/result、全局唯一 idempotencyKey、attempts/maxAttempts、lease owner/token/expires、nextAttemptAt/error | 同时承载 legacy 与 Activity Job；WorkflowCompletion 以 jobId 唯一关联 |
| `WorkerHeartbeat` | instanceId 唯一、status/version、startedAt/lastSeenAt/stoppedAt | 独立心跳行 |
| `DomainEvent` | 自增 sequence、eventId 唯一、type/version/payload/occurredAt、aggregate、runId、workflowRunId、idempotencyKey | Run/WorkflowRun 关联可 SET NULL；Workflow `(workflowRunId,idempotencyKey)` 唯一 |
| `Observation` | Source/run/workflow、ingestCommandId 唯一、entry、external key/revision、locator、内容/时间/Blob/metrics | Source 删除级联；Run/Workflow/Entry 关联 SET NULL；`(sourceInstanceId,runId,externalKey)` 唯一 |
| `Entry` | `(sourceInstanceId,canonicalExternalId)` 唯一、currentRevisionId 唯一、storyId、metricsJson | 拥有 revisions/observations；Source 删除级联，Story 删除 SET NULL |
| `EntryRevision` | `(entryId,revision)` 唯一、title/summary/content/fingerprint/url/contentKind/Publisher/Temporal/createdAt | Entry 删除级联；Asset 从属于修订 |
| `Asset` | revision、kind/status、sourceUrl/storageKey/mimeType/byteSize/error | EntryRevision 删除级联 |
| `Story`/`StoryRevision` | Story id/kind/subtype/currentRevisionId；Revision title/summary | Story 拥有 revisions/entries；Revision 删除级联 |
| `WorkflowRun`/`WorkflowCompletion` | 同库存在，但 kernel state、Run lease、Activity Completion 字段由后续 Host specs 拥有 | 本组件不定义其状态机 |

`entry_search` 不是 Prisma model，而是在 `initialize()` 中创建的 FTS5 virtual table，当前写入列为 `entry_id`、`title`、`content_text`。

## 状态转换

- Source：创建时 enabled 缺省 true；只通过 `setSourceEnabled` 改变 enabled。
- Legacy Run：`createRun` 直接进入 running；`createQueuedRun` 进入 queued；`startRun` 进入 running；`completeRun` 进入 succeeded/failed/cancelled 终态并写 finishedAt；`resetRunForRetry` 回到 queued 并清空 startedAt/finishedAt。仓储不实现新的 cancel request 状态。
- Step：随 Run 的 queued/running/终态同步，startRun 增加 attempts。
- Legacy Job：queued 或到期 retry_wait → leased；当前 lease 可转 succeeded、retry_wait、failed_terminal；过期或旧 token 不可覆盖。达到 maxAttempts 时由 claim 直接转 failed_terminal。
- Observation：创建后作为证据保留；同一 legacy Run/external key 重放返回 duplicate。相同 Entry fingerprint 不追加修订，指标准确时间可刷新；不同 fingerprint 追加修订。
- Checkpoint：legacy upsert 可直接替换 cursor；Workflow checkpoint 只有 expected revision 匹配才递增，失配只产生 superseded 结果。
- DomainEvent：append-only，sequence 不复用；Workflow key 的同 type/version/payload 可幂等重放，不同 payload 由 Workflow event helper 冲突拒绝。

## 副作用

- Prisma transaction：Run/Step/Job 与 queued/leased/completion event；Observation/Entry/EntryRevision/Story/StoryRevision/Asset/FTS 与 ingest events；Workflow checkpoint 与 checkpoint event。
- 文件系统：raw payload 和 saved Asset 先写 Blob Root；`readAsset` 从 Blob Root 读取。
- FTS：初始化确保表存在；每次新 Entry 修订删除旧 entry_search 行再插入新标题/正文。
- 事件/日志：DomainEvent 是持久账本；结构化 logger 记录初始化、claim 竞争、terminal Job、存储错误和 health 阶段。日志不替代事件。
- 没有跨 Blob/SQLite 的事务补偿，也没有外部 outbox、消息发送或 exactly-once 发布。

## 错误与降级

- JSON/config/DTO 解析失败、日期过滤非法、FTS/Prisma/Blob I/O 失败一般按原异常向上抛出。
- stale legacy Job 的 renew/complete 返回 `false`；空 acceptedKinds 返回 `null`；竞争导致条件更新为 0 时 claim 返回 `null` 并记录 debug。
- maxAttempts 到达后 legacy Job terminalize，关联 Run 失败；具体 connector 错误是否可重试由 application worker 决定，本仓储只保存结果与 errorCode。
- `health()` 对数据库查询失败或 heartbeat 查询失败返回失败状态而不是抛出；其它健康查询成功时 worker heartbeat 超时只投影为 stopped。
- FTS virtual table 缺失会在初始化时创建；没有后台修复损坏 FTS 行的独立能力。

## 依赖

依赖 Prisma Client/SQLite、`@cosmos/contracts`、`@cosmos/domain`、`@cosmos/application` 的 `CosmosRepository`/日志/Host fence 类型以及 `@cosmos/blob-store`。Application 拥有端口和 legacy worker 合同，Domain 拥有规范化身份/内容规则，Blob Store 拥有文件路径和内容完整性；本组件拥有 SQL 领域表、事务和查询。

## 配置

- `COSMOS_DATA_ROOT`：默认 `.cosmos`；相对路径以 `COSMOS_WORKSPACE_ROOT` 或当前工作目录为基准。
- `COSMOS_WORKSPACE_ROOT`：只控制相对 Data Root 锚定。
- `DATABASE_URL`：覆盖派生 SQLite URL；当前实现基于 SQLite Prisma schema，不声明 PostgreSQL/MySQL 行为。
- Data Root 派生 `databasePath/blobRoot/artifactRoot/cacheRoot/logRoot/secretRoot`；`resolveContainedPath` 拒绝相对路径逃出受控根。

## 重建验收

1. 在隔离空 Data Root 应用六条 migration，构造仓储并调用 `initialize()`；查询 `sqlite_master` 能看到 `entry_search`，`health()` 的 storage/migration 为 `ready`，`close()` 能断开客户端。
2. 创建 Source，连续两次以同一 idempotency key 调用 `createQueuedRun`；两次返回同一 Run，Job 表只有一个关联 Job，DomainEvent 中只有一个对应 `run.queued.v1`。
3. 让 owner A claim 一个 legacy Job 后使其 expiry 过去，再由 owner B claim；A 用旧 token 完成返回 `false`，B 的 lease 才能写入终态。
4. 持久化同 external key 且 fingerprint 不变的两项；第二项返回 duplicate、EntryRevision 数仍为 1，但 metrics/精确时间可更新；改变正文 fingerprint 后 revision 数为 2，Feed/Search 读到最新投影。
5. 持久化含 `saved` Asset 的 item；Asset 有 Blob storageKey 且 `readAsset` 读回原 bytes。执行 Probe Job 后，Entry 数和 Checkpoint cursor 保持不变。
6. 用错误 expected revision 写 Workflow checkpoint；返回 `committed=false`、不覆盖当前 cursor/revision 并生成 superseded event；用当前 revision 写入时 revision 恰加一并生成 committed event。
7. 对新 Entry 执行 Feed、FTS Search 和 DomainEvent replay；Feed/Search 返回正确 page/nextCursor，events 严格按 sequence 升序，latest sequence 等于最大 event sequence。
8. 用隔离 fake 让 `SELECT 1` 或 heartbeat 查询失败；`health()` 返回 `storageStatus = failed`，并记录对应阶段而不是返回 ready。

## 实现与测试锚点

- `packages/storage-prisma/src/index.ts:53-110`：StorageRoots、Prisma client、Data Root containment；`:113-166`：仓储构造、initialize、close。
- `packages/storage-prisma/src/index.ts:168-757`：Source、Run、Step、legacy Job、claim/renew/complete/reset；`:760-1268`：raw/asset Blob、Observation/Entry/Revision/Story/FTS、Workflow ingest item 与 checkpoint CAS；`:1288-1847`：Run completion、Feed/Search/Entries/Story/Entry/Revision/Event/Asset/heartbeat/health；`:1849-2252`：快照投影、attempt projection、Job/Workflow fence、DomainEvent helper。
- `packages/storage-prisma/prisma/schema.prisma`：所有模型、字段、索引、唯一约束和关系；六条 migration 按 `20260808003247_phase1_foundation`、`20260808150000_collector_jobs`、`20260810020829_normalized_content_model`、`20260813160000_workflow_run_backend`、`20260814090000_workflow_activity_host`、`20260815090000_workflow_ingest` 顺序应用。
- `packages/storage-prisma/src/index.test.ts:58-219`：Data Root、Observation/Revision/Asset/Story/FTS；`:221-332`：metrics 不新建修订；`:334-409`：legacy Job 幂等、租约、事件；`:411-462`：Activity Job 与 legacy claim 隔离；`:464-566`：claim 竞争、max attempts、health 日志；`:568-822`：worker/probe/connector failure/schedule；`:823-912`：Workflow checkpoint 双 fence/CAS。

## 非目标/边界

不提供 Kernel WorkflowRun state CAS、Workflow Run/Activity/Completion lease 状态机、durable signals/timers/child workflows、外部 event outbox、跨进程锁或多主机数据库语义；不把 FTS 当作独立编辑 API。Blob 写入和数据库事务没有跨系统回滚；legacy `setCheckpoint` 没有 CAS。真实 RSS/Bilibili/OpenCLI、Docker、Browser/E2E、跨进程长时 recovery 和多数据库后端未由本组件测试证明。
