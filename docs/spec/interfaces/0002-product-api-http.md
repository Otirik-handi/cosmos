# Product API HTTP

## 状态

`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`。本文是当前
`AppController` 的 HTTP/SSE 重建合同，不是 `docs/api/` 中 Draft、Planned 或 Reserved
路由的实现声明。

## 最后更新

2026-08-16。

## 组件定位

Product API HTTP 是 Nest `AppController` 对外的产品查询、Source 控制、Workflow Run
投影、诊断和 Server-Sent Events（SSE）适配层。全局 prefix 由 runtime 设置为
`/api/v1`；除根 `/healthz` 和 `/readyz` 外，本文的相对路径都拼在该 prefix 后。

Controller 调用 Application/Repository/Catalog port，不直接让客户端访问 Prisma、Blob
Root 或 Worker claim/complete 接口。Source、Run、Job、Feed、Entry、Revision、Asset 和
SSE 的共享 DTO、枚举和 Zod schema 由 [`@cosmos/contracts` 公共合同](../contracts/0001-public-contracts.md)
拥有；但本 Controller 当前还返回三类没有 contracts schema 的 HTTP 局部投影：Catalog page、
CapabilitiesResponse 和 AttemptSnapshot/AttemptPage。本文件是这些 HTTP 投影的唯一字段定义，
它们不是 `@cosmos/contracts` DTO，也没有被 `HttpCosmosClient` 封装。

## 概念与定义

- **Product Run**：面向产品客户端的 Run 投影。Legacy `RunSnapshot` 和 Workflow
  envelope 都可以成为来源；Workflow envelope 的内部 `waiting` 公开为 `running`，
  `completed` 公开为 `succeeded`。
- **CatalogPage<T>**：Controller 为三个 manifest 列表和 Attempt 列表生成的 HTTP 局部页，
  唯一字段为 `items: T[]`、`nextCursor: null`、`snapshotAt: string`。`snapshotAt` 是该次
  响应生成时的 ISO 时间；当前没有 page `version` 字段，manifest 自身的 `version` 仍是
  manifest item 字段。
- **CapabilitiesResponse**：Controller 内联返回的 HTTP 局部对象，字段为
  `productProtocolVersion: "1"`、`workerProtocolVersions: ["1"]`、`features`、`limits`
  和 `serverTime`。它不是 contracts schema；字段详见“System 与 manifest catalog”。
- **AttemptSnapshot**：从持久 Domain Event 按一个 Workflow Activity Job 聚合出的公开尝试
  投影，不是 contracts DTO。它只含下文列出的 worker/时间/状态/error 字段，不含 lease token。
- **AttemptPage**：`CatalogPage<AttemptSnapshot>` 的 HTTP 形状；当前按 attempt number 升序、
  固定 `nextCursor: null` 返回。
- **公开投影**：由 Controller 或 Repository 当前返回的 DTO。Source 会白名单选择配置展示
  字段；Run、Job、Attempt 和内容查询不把 Worker lease token、Secret、Blob Root、绝对文件
  路径或任意内部执行 payload 作为 HTTP 控制输入。Asset 的 `storageKey` 是当前 contracts
  和存储投影确实会返回的例外，见 Asset 小节；它不是绝对路径，但其公开本身是安全/封装缺口，
  不能写成“已禁止”。
- **SSE cursor**：客户端通过 `Last-Event-ID` header 或 `after` query 指定的非负事件序号；
  事件 id 是持久 Domain Event 的 sequence 字符串。

详细 Source、Run、Feed、Entry、Revision、Asset、SSE 字段必须回看公共合同；本文件只在
没有 contracts owner 的地方定义 HTTP 局部投影。

## 外部行为
成功的 JSON Controller 响应由 Nest 默认序列化；正常 GET/PATCH 为 HTTP 200。创建
Source 和手动 Run 是 HTTP 201；Source probe 是显式 HTTP 202。SSE 是长连接 HTTP 200，
响应带 `Cache-Control: no-cache` 和 `Connection: keep-alive`。


### System 与 manifest catalog

| Method/path（`/api/v1` 下） | 输入 | 成功输出与副作用 |
| --- | --- | --- |
| `GET /health` | 无 | `HealthResponse`；调用 repository health，读取数据库探针/Worker heartbeat。 |
| `GET /connectors` | 无 | `ConnectorDescriptor[]`；只读 builtin catalog，不执行 Connector。该兼容路径当前仍保留。 |
| `GET /source-definitions` | 无 | `CatalogPage<SourceDefinitionManifest>`；页字段为 `items`、`nextCursor: null`、`snapshotAt`。 |
| `GET /source-definitions/:id` | path `id` | 单个 Source definition manifest；不存在返回 404。 |
| `GET /workflow-definitions` | 无 | `CatalogPage<WorkflowDefinitionManifest>`；只读 Workflow manifest。 |
| `GET /workflow-definitions/:id/versions/:version` | path `id`、`version` | 指定版本 Workflow manifest；不存在返回 404，版本非法 400。 |
| `GET /action-definitions` | 无 | `CatalogPage<ActionDefinitionManifest>`；只读 Action manifest。 |
| `GET /action-definitions/:id/versions/:version` | path `id`、`version` | 指定版本 Action manifest；不存在返回 404，版本非法 400。 |
| `GET /capabilities` | 无 | `CapabilitiesResponse`；读取 `COSMOS_SSE_REPLAY_LIMIT` 的数值并返回当前功能/限制/serverTime，无业务写副作用。 |

三个 manifest page 的 item 字段来自 Application `CatalogPort`，不是 contracts DTO：

- `SourceDefinitionManifest`：`id`、正整数 `version`、`ref`、`provider`、`displayName`、可空
  `description`、`manifestHash: { algorithm, value }`、`status`、`operationIds[]`、
  `capabilities[]` 和 `configurationSchema: { id, version, hash: { algorithm, value }, schema? }`。
- `WorkflowDefinitionManifest`：`id`、`version`、`ref`、`kind`、`provider`、`manifestHash`、
  `status`、`requiredActionRefs[]`、`requiredBackendCapabilities`（字符串到 boolean 的对象）、
  `inputSchema` 和 `outputSchema`（均为上述 JsonSchemaRef）。
- `ActionDefinitionManifest`：`id`、`version`、`ref`、`provider`、`manifestHash`、
  `effectMode`、`executionPlacement`、`requiredCapabilities[]`、`status`、`inputSchema` 和
  `outputSchema`。这些 schema ref 是 manifest metadata；Controller 不加载 executable Zod
  schema、Connector 或 Action。

`CapabilitiesResponse` 的真实内联字段为：

```text
{
  productProtocolVersion: "1",
  workerProtocolVersions: ["1"],
  features: {
    sourceDefinitions: { status: "enabled", version: "1" },
    workflowDefinitions: { status: "enabled", version: "1" },
    actionDefinitions: { status: "enabled", version: "1" },
    workflowIngest: { status: "enabled", version: "1" }
  },
  limits: {
    maxPageSize: 100,
    maxInlineValueBytes: 65536,
    maxUploadBytes: null,
    sseReplayLimit: Number(COSMOS_SSE_REPLAY_LIMIT ?? "100")
  },
  serverTime: <ISO string>
}
```

The controller does not apply the 1–1000 clamp used by the SSE polling path when it constructs
`limits.sseReplayLimit`; a nonnumeric environment value therefore is not repaired by this
endpoint (and may serialize as `null` through JSON). Catalog pages currently always use
`nextCursor: null` and a newly generated `snapshotAt`; the page has no `version` field.
Builtin catalog contains `rss`, `fixture-rss`, `bilibili`, `aihot`, Workflow `cosmos.ingest@1`,
and Actions `source.fetch@1`, `library.ingest@1`, `source.checkpoint@1`. These are readable
manifest entries, not an executable command allow-list.

`/connectors` remains a compatibility path while the manifest-only clean cutover is incomplete;
the current code has not removed it or replaced it with a permanent redirect.

### Source 资源

| Method/path | 输入 | 成功输出、状态和副作用 |
| --- | --- | --- |
| `GET /sources` | 无 | `SourceSnapshot[]`；按 repository 顺序读取，不写入。 |
| `GET /sources/:sourceId` | path `sourceId` | 单个 `SourceSnapshot`；不存在 404。 |
| `POST /sources` | JSON body `CreateSourceCommand` | HTTP 201，创建并返回 `SourceSnapshot`。先按 Zod 合同校验，再确认 `kind` 存在于 manifest catalog、校验通用 source config，最后写 Source。 |
| `PATCH /sources/:sourceId` | JSON body `UpdateSourceCommand`（当前只允许 `enabled: boolean`） | HTTP 200，更新 enabled 并返回 `SourceSnapshot`；不存在 404；body 不合法 400。 |
| `POST /sources/:sourceId/test` | 可选 `Idempotency-Key` header | HTTP 202，返回 `JobSnapshot`，创建 `source-probe` Job；API 进程不直接调用 Connector。未提供或空白 key 时生成随机 probe key。Source 不存在 404。 |
| `POST /sources/:sourceId/runs` | 可选 `Idempotency-Key` header | HTTP 201，返回 Product Run。Source 不存在 404；无 header 时生成随机 `manual:<sourceId>:<uuid>` key。优先通过 Workflow Control 入队 `cosmos.ingest@1`，否则走 legacy queued Run。 |

Catalog page 当前固定 `nextCursor: null`，`snapshotAt` 是响应生成时的 ISO 时间。Builtin
catalog 包含 `rss`、`fixture-rss`、`bilibili`、`aihot` Source definitions，Workflow
`cosmos.ingest@1`，以及 `source.fetch@1`、`library.ingest@1`、`source.checkpoint@1`
Action manifests；这些是当前实现锚点，不是允许客户端执行的命令列表。


`CreateSourceCommand` 的 `name` 是去空格后 1–200 字符，`kind` 是 1–100 字符，`config`
通过共享 schema；`enabled` 默认 true。具体 connector-specific config 仍由 manifest
和下游 Connector 边界决定。Source 公开 config 由 Controller 白名单投影：通用只保留
`feedUrl`、`scheduleIntervalMs`；Bilibili 另外保留 `mode`、`limit`、`profile`、
`schemaVersion`。不会把其它配置值原样回显。

`Idempotency-Key` 在 Controller 中按 trim 后使用；Source run 的 Workflow Control 会
按 key 复用同一 envelope，并在同 key 指向其它 source/trigger 时失败。HTTP 层没有单独
声明 Idempotency-Key 的长度 schema；下游入队合同要求非空。

### Run、Job、Attempt

| Method/path | 输入 | 成功输出与错误 |
| --- | --- | --- |
| `GET /runs/:runId` | path `runId` | 先查 Workflow Host envelope，存在则返回 Product Run；否则查 legacy `RunSnapshot`；两者都不存在 404。 |
| `GET /workflow-runs/:runId` | path `runId` | 当前实现别名，调用同一 `/runs/:runId` 查询和投影；不存在 404。 |
| `GET /jobs/:jobId` | path `jobId` | `JobSnapshot`，不含 lease token；不存在 404。 |
| `GET /jobs/:jobId/attempts` | path `jobId` | `AttemptPage`（`items`、`nextCursor: null`、`snapshotAt`），由持久 Domain Events 投影 Attempt；查询本身不 claim/renew/complete。 |
| `GET /attempts/:attemptId` | path `attemptId` | 单个 `AttemptSnapshot`；无法解析或不存在 404；不含 lease token。 |

Workflow Product Run 的字段包括 envelope run id、Source/trigger 投影、公开 status、
Definition identity、idempotency key、resumeRequired 和创建/更新时间；内部
`queued→queued`、`running→running`、`waiting→running`、`completed→succeeded`、
`failed→failed`、`cancelled→cancelled`。Legacy Run 使用 contracts 中的 `RunSnapshot`
字段（含 item/revision/error 计数）。HTTP 不提供 claim、heartbeat、completion、lease
renewal 或内部 Kernel state 写端点。

`AttemptSnapshot` 的唯一字段由 `WorkflowAttemptSnapshot` 端口结果原样投影：
`id`、`jobId`、正整数 `number`、`workerId`、`workerInstanceId`、`ownerEpoch`、可空
`ownerSessionId`、`status`（`leased`/`succeeded`/`failed`/`lease_lost`/`cancelled`/
`uncertain`）、`leaseAcquiredAt`、`leaseExpiresAt`、可空 `lastHeartbeatAt`、可空
`finishedAt` 和可空 `error`。`error` 若存在只有 `kind`（`aborted`/`retryable`/`terminal`/
`unknown`）、可空 `code`、`message`、`retryable`、可空 `occurredAt` 和固定 `detailsRef: null`。

Repository 的 `projectWorkflowAttempts` 只读取 `workflow.activity.<status>.v1` 事件，
忽略缺失、非安全整数或非正数 `payload.attempt`。事件按持久 sequence 升序读取，再按
`number` 升序输出；同一 number 的首个事件创建 `id = <jobId>:attempt:<number>`，后续
事件覆盖当前状态/worker/lease 时间，终态事件写入 `finishedAt`。`owner` 非空字符串
作为 `workerId` 与 `workerInstanceId`，否则为字面值 `"unknown"`；事件没有
`ownerSessionId`/`ownerEpoch`/heartbeat，所以当前投影分别是 `null`/`0`/`null`。
事件状态映射是：`leased → leased`、`succeeded → succeeded`、`cancelled → cancelled`、
`released → lease_lost`，其它状态（包括 `failed_terminal`、`retry_wait`）→ `failed`；
有 error 时 `retry_wait` 只影响 `error.kind=retryable`，`cancelled` 为 `aborted`，
`released` 为 `unknown`，其它为 `terminal`。事件没有 error 时保留此前 error。

Detail 查询要求 id 含 `:attempt:` 且前缀作为 job id；当前存储解析后缀使用
`Number.parseInt`，因此真正无法转成正的安全整数、空前缀、未知 job 或不存在 number 才
返回 404 `not_found`，而带数字前缀的脏后缀（例如 `1x`）可能被当前实现接受，这是待修复
的解析严格性缺口，不应被规格误写成已拒绝。列表不会先查 Job：空/未知 job id 当前可得
200 空 `AttemptPage`。

### Content query

| Method/path | 输入 | 成功输出与分页 |
| --- | --- | --- |
| `GET /feed` | query `cursor?`、`limit?` | `FeedPage`。limit 缺省 20；非数字回退 20，随后 clamp 到 1–100；cursor 交给 repository。按更新倒序返回 Story Feed，nextCursor 是偏移字符串或 null。 |
| `GET /search` | query `text?`（最多 500）、`sourceId?`、`publishedAfter?`、`publishedBefore?`（带 offset 的 ISO）、`cursor?`、`limit?`（1–100，默认 20） | `SearchPage`，FTS/过滤结果与 rank；Zod 解析失败 400。无写副作用。 |
| `GET /entries` | query `sourceId?`、`cursor?`、`limit?`（1–100，默认 50） | `EntryPage`；Zod 解析失败 400。 |
| `GET /stories/:storyId` | path `storyId` | `StoryDetail`（当前 Story 和一个最近 Entry projection）；不存在/无可投影内容 404。 |
| `GET /entries/:entryId` | path `entryId` | `EntryDetail`（当前 revision、revision 列表、observations）；不存在或无 current revision 404。 |
| `GET /revisions/:revisionId` | path `revisionId` | `RevisionDetail`；不存在 404。 |
| `GET /assets/:assetId` | path `assetId` | HTTP 200 二进制 `StreamableFile`，Content-Type 为保存的 mime type；没有可读取内容 404。响应不是 JSON DTO。 |

Feed/Search/Entry 的 cursor 是当前存储实现的偏移 cursor；非法/负 cursor 在存储层按
0 处理。Search date 仍会经过 contracts 的 offset datetime 校验；存储层无法构造有效
日期时也拒绝。Story、Entry、Revision 只读，不在 API 层修改事实。

### SSE events

| Method/path | 输入 | 成功输出与生命周期 |
| --- | --- | --- |
| `GET /events` | `Last-Event-ID` header 或 `after` query，二者同时存在时 header 优先 | HTTP 200 SSE；按事件序号增量 replay，并每 500ms 轮询。响应 headers 为 no-cache/keep-alive。断开时清理 timer。 |

cursor 会以非负整数解析；缺失、负数或无法解析时从 0 开始。`COSMOS_SSE_REPLAY_LIMIT`
默认 100，解析后限制在 1–1000。每次向 repository 请求 `replayLimit + 1` 条以判定
replay window：

1. 如果超过上限，Controller 查询最新 sequence，发一条 envelope `type: "snapshot_required"`、
   `version: "v1"`、`payload: { reason: "replay_limit", latestEventId }`，并把 cursor
   前移到 latestEventId；客户端必须重新读取 Feed/Source 等快照。
2. 如果窗口可覆盖，按 sequence 升序逐条发送 repository event。每条 SSE frame 的 Nest
   message `type` 是 `message`，`id` 为 sequence，`data` 是 JSON event envelope。
3. 如果本轮无事件且距上一次 keepalive 至少 10 秒，发送 `keepalive.v1` envelope，id
   保持当前 cursor，payload 为空。
4. repository 抛错会让 Observable error，由全局错误/日志管线记录；Controller 不
   把错误伪装成业务事件。客户端关闭订阅后不会再 poll。

SSE 数据可以包含当前持久 Domain Event 的业务 payload；HTTP Controller 不接受客户端
写入 payload。公开事件仍不得把 lease token、Secret、绝对路径放入 payload；事件内容
由持久化边界负责。

## 输入

所有 body/query 以 `unknown`/Nest query 输入后在 Controller 边界用 contracts Zod schema
解析。path id 当前不额外做格式 schema。JSON body 只在 POST/PATCH 资源需要时发送；
`Idempotency-Key` header 是大小写不敏感的 HTTP header，Controller 读取 Nest 的
`idempotency-key` 值并 trim。SSE 同时支持标准 `Last-Event-ID` 和 query `after`。

## 输出

JSON DTO 的 canonical shape、枚举和序列化规则只见 [Public Contracts](../contracts/0001-public-contracts.md)。错误由全局 filter 规范化为 `ServiceError`，通常包括
`code`、`message`、`requestId`、可选 details 和 retryable；细节见
[API Observability](0003-api-observability.md)。本文件拥有前文明确的 Catalog/Capabilities/
Attempt HTTP 局部投影，因为 contracts 当前没有它们的 schema。

成功响应不返回 Controller 内部的 workflow input snapshot、Kernel journal、lease
identity、lease token、Connector executable、Secret 或文件系统绝对路径。**当前 Feed、Search、
Entry 和 Revision/Story 内部 revision 的 AssetSnapshot 确实包含可空 `storageKey`**，因为
`packages/contracts/src/index.ts` 的 `assetSnapshotSchema` 和
`PrismaCosmosRepository.toAssetSnapshot` 都保留该字段；这是真实的公开投影安全缺口，不能在
当前规格中宣称 storage key 已被禁止或已脱敏。`storageKey` 是 Blob store 的相对内容寻址
键而非绝对路径，但 API 没有为它建立稳定的公开安全封装，调用方不应把它当可写路径。
`GET /assets/:assetId` 不返回 JSON Asset DTO，也不回显 storage key：Controller 调用
`readAsset`，成功时返回 `StreamableFile` 的原始 bytes 和保存的 `mimeType`（缺失 mime 时
repository 使用 `application/octet-stream`）；Asset 没有 storageKey 或 Blob 读取失败/不可读
时返回 404 或由全局 filter 映射为 500，具体取决于失败发生在 repository 查找还是 Blob 读取。
## 状态与持久化

Controller 本身无持久状态；SSE 的 cursor、poll timer 和 keepalive 时间戳仅存在于一次
连接的内存 Observable。权威状态在 repository、Workflow Host store、manifest catalog
（进程内只读）和 Domain Event 存储中：

- Source CRUD 写 SourceInstance；
- probe/run 命令创建 Job 或 Workflow envelope，并由 Worker/Host 推进；
- Feed/Search/Story/Entry/Revision/Asset 只读领域投影；
- SSE 从 Domain Event sequence replay，不在内存建立第二账本。

进程重启会丢失 SSE 连接，客户端可用 Last-Event-ID/after 重新 replay；replay 窗口不足
时必须按 `snapshot_required` 重读。

## 状态转换

- Source：`POST` 创建 enabled/disabled 快照 → `PATCH` 只改变 enabled；创建失败不写入。
- Probe：请求 → `source-probe` queued Job → Worker 后续推进；API 只返回 queued snapshot，
  不在本进程执行 probe。
- Workflow Run：`POST /sources/:id/runs` → queued envelope/legacy Run；Host 后续可
  变为 running（waiting 也公开 running）→ succeeded/failed/cancelled。重复 idempotency
  key 复用同一 workflow envelope；冲突由 Application 抛错。
- SSE：`connected(cursor)` → replay/keepalive 或 `snapshot_required` → 等待下一轮；
  unsubscribe → closed。发送 headers 后的流异常不回写第二个 JSON response。
- Query：读取已持久化 projection；不存在资源是 404，不会隐式创建。

## 副作用

- Source POST/PATCH 写 Source；probe/run POST 写 Job/Workflow envelope，并记录 `job.queued`
  或 `workflow.run.queued` 结构化日志。
- Feed/content 查询访问 Prisma/SQLite/Blob；Asset GET 读取受控 Blob store 并将 bytes
  流出。
- SSE 查询 Domain Event 并保留一个 500ms timer；连接关闭清理 timer。
- HTTP 请求、错误和 SSE 生命周期由 request logging interceptor/filter 记录；日志
  脱敏规则不由 Controller 重复实现。

## 错误与降级

### 400

- Create/Update Source body、Source kind/config、Search/Entries query 违反 Zod 合同；
- Workflow/Action manifest `version` 不是正的安全整数；
- Source catalog 不可用或配置不合法；
- repository/Application 把 Source enqueue 的普通错误映射为 `BadRequestException` 时，
  返回 `validation_failed`、`retryable: false`。

`feed.limit` 是兼容性 clamp，不因超出 1–100 抛 400；Search/Entries 的 schema limit
越界则是 400。未知资源不会以 400 伪装。

### 404

Source、Source definition、Workflow/Action definition、Run、Job、Attempt、Story、Entry、
Revision、Asset 查询找不到目标时返回 `NotFoundException`，错误码 `not_found`、
`retryable: false`。`workflow-runs/:id` 与 `runs/:id` 共享该语义。

### 其它错误

Repository、catalog、SSE polling 或 Blob 读取异常上抛到全局 filter，通常转 500/
`service_unavailable`；已发送 SSE headers 后只能结束流并记录失败。API 没有为客户端
提供 Worker lease 竞争、claim 或 completion 的重试端点。

## 依赖

- Nest decorators/HTTP adapter 与 RxJS Observable；
- `@cosmos/contracts` 的 Source、Health、Run、Job、Feed/Search/Entry/Story/Revision、SSE schema；
- `@cosmos/application` 的 repository、CatalogPort、IngestWorkflowControlService 和 WorkflowHostStore；
- `@cosmos/storage-prisma` 的查询/写入实现；
- `SourceProbeService` 的 manifest-only kind/config 校验；
- [Product API Runtime](0001-product-api-runtime.md) 的 global prefix、启动依赖；
- [API Observability](0003-api-observability.md) 的 request id、错误和日志投影。

## 配置

- 全局 prefix 由 runtime 固定为 `api/v1`；HTTP host/port/CORS 见 [Product API Runtime](0001-product-api-runtime.md)。
- `COSMOS_SSE_REPLAY_LIMIT` 在 SSE handler 中默认 100，解析后 clamp 到 1–1000；`/capabilities` 直接返回 `Number.parseInt` 结果（默认字符串为 `"100"`），不共享该 clamp。
- Catalog 来源为 builtin static catalog；当前没有 HTTP 上传/安装 manifest 的端点，且 `/connectors` 兼容路径仍存在。

## 重建验收

1. `GET /api/v1/connectors` 返回四个 builtin descriptor，并确认没有执行 Connector 或
   返回 executable path；`GET /api/v1/source-definitions` 返回 `items`、`nextCursor=null`
   和 ISO `snapshotAt`，且没有 page `version`。
2. 对 `GET /api/v1/workflow-definitions` 与 `/action-definitions`，确认 page item 字段
   是 CatalogPort manifest metadata，schema ref 不含 executable Zod 对象；对 `/capabilities`
   确认 `features`、`limits.maxPageSize=100`、`maxInlineValueBytes=65536`、
   `maxUploadBytes=null`、`serverTime` 和当前 env 数值均出现。
3. 对 `POST /api/v1/sources` 提交合法 fixture-rss command，观察 HTTP 201 和白名单
   SourceSnapshot；提交未知 kind 或非法 config，观察 HTTP 400 `validation_failed`。
4. 对不存在 Source 请求 GET/PATCH/test/run，观察 HTTP 404 `not_found`；对已存在 Source
   的 test 请求，观察 HTTP 202 queued `source-probe` Job 且 API 未调用 Connector。
5. 使用同一个 `Idempotency-Key` 两次触发同一 Source run，观察同一 Workflow identity
   被复用；把该 key 用于另一 Source，观察冲突错误而不是第二个不同快照。
6. 让 Workflow envelope 状态为 waiting/completed，分别请求 `/runs/:id`，观察公开状态为
   `running`/`succeeded`；响应中不存在 lease token、Secret、Kernel payload 或绝对路径。
7. 用 lifecycle Domain Events 请求 `/jobs/:id/attempts`，确认只产生按 number 升序的
   `AttemptPage`，字段没有 leaseToken；请求 malformed/unknown `/attempts/:id` 观察 404，
   并记录当前 `Number.parseInt` 对带数字前缀脏后缀的未严格拒绝缺口。
8. 请求 `/api/v1/feed?limit=0`、超大 limit、非法 limit，分别观察 clamp 到 1、100、20；
   请求非法 Search/Entries query，观察 HTTP 400。检查 Feed/Entry/Revision 资产投影仍有
   `storageKey`，并确认 Asset download 返回 bytes/mime 而非 JSON。
9. 用 `after=0` 建立 SSE，观察持久事件按 id 升序到达；设置 replay limit 为 1 并使窗口
   超过上限，观察一条 `snapshot_required` 且 `latestEventId` 等于存储最新序号。
10. 在无新事件连接保持至少 10 秒，观察 `keepalive.v1`；取消连接后观察不再新增 poll；
    查询不存在 Story/Entry/Revision/Asset，观察 HTTP 404。

## 实现与测试锚点

- 全部路由、投影、SSE poll/keepalive/replay：[`apps/api/src/app.controller.ts`](../../../apps/api/src/app.controller.ts)。
- Source catalog 校验：[`apps/api/src/source-probe.service.ts`](../../../apps/api/src/source-probe.service.ts)。
- Nest prefix/CORS/filter 安装：[`apps/api/src/main.ts`](../../../apps/api/src/main.ts)。
- Product DTO schemas：[`packages/contracts/src/index.ts`](../../../packages/contracts/src/index.ts) 与 [`packages/contracts/src/base.ts`](../../../packages/contracts/src/base.ts)。
- Catalog manifest port/builtin entries：[`packages/application/src/catalog.ts`](../../../packages/application/src/catalog.ts)。
- Workflow enqueue and `cosmos.ingest@1` snapshot：[`packages/application/src/workflow-control.ts`](../../../packages/application/src/workflow-control.ts)。
- Domain query/projection/event sequence：[`packages/storage-prisma/src/index.ts`](../../../packages/storage-prisma/src/index.ts)。
- SSE snapshot fallback、probe queue、Run mapping、Attempt projection：[`apps/api/src/app.controller.test.ts`](../../../apps/api/src/app.controller.test.ts)。

## 非目标/边界

- `docs/api/0002-product-service-api.md` 与 `0003-product-dtos.md` 中标为 Draft/Planned/
  Reserved 的 routes、plugins、connections、settings、workflow cancellation/signals、
  Gateway、Worker discovery 和远程执行均不是本文实现。
- 当前没有 Product API 的认证/授权、用户会话、CSRF、HTTPS、Range/ETag 目标合同或
  upload endpoint。
- Controller 不提供 Job claim/renew/complete、lease token 管理、Kernel journal 或
  arbitrary Workflow input API。
- 浏览器/e2e、Docker、真实 RSS/Bilibili/OpenCLI、跨进程 recovery 和多主机行为未由
  本文宣称已验证。
