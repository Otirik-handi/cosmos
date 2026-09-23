# Product API HTTP

## 状态

当前实现规格；后续代码变化应同步更新本文。本文是当前
`AppController` 的 HTTP/SSE 重建合同，不是 `docs/api/` 中 Draft、Planned 或 Reserved
路由的实现声明。

## 最后更新

2026-09-16。

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

### 在系统中的位置与作用
它是面向产品客户端的 HTTP/SSE 边界，位于 `AppController` 与 Application、Repository、Catalog port 之间。

### 解决的问题
它把查询、Source 控制、Run 投影、诊断和 SSE 统一投影为公开路径与状态，隔离客户端与 Prisma、Blob 及 Worker claim/complete 细节。

### 使用方式
客户端请求 `/api/v1` 下的已实现路由（健康根路径除外）；Controller 调用注入的 port，响应字段和错误按本文件及公共 contracts 解析，SSE 使用对应 event envelope。

### 典型情景
读取 Feed/Search/Story、创建或触发 Source、查询 Run/Job，或订阅 SSE 刷新页面时选择该 HTTP 接口；Draft/Planned/Reserved 路由不从本文推导为已实现。

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
  路径或任意内部执行 payload 作为 HTTP 控制输入。Asset 的 `storageKey` 也不再外发：六条公开
  读路由在返回前经 `toPublicAsset` 逐个挑字段，公开读 DTO 用 `publicAssetSnapshotSchema`
  描述；仓储内部的 `AssetSnapshot` 仍带该字段，见 Asset 小节。
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
  `capabilities[]`、`configurationSchema: { id, version, hash: { algorithm, value }, schema? }`
  和 `operations[]`（每项：`operationId`、`inputSchema`/`outputSchema`、可空
  `configurationSchema`——这个 operation 的用户可填配置，`null` 表示沿用定义级那份，
  `externalKey`、`discoveryContext`、`media`、可空 `stateStoreNamespace`）与 `auth`
  （认证方式 + `secretRefRequired` + `probeSupported`）。Bilibili 是当前唯一声明两个
  operation 的定义（`fetch` 沿用定义级 schema，`search` 自带 `query`/`limit`）。
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
| `POST /sources` | JSON body `CreateSourceCommand`（strict，无 `enabled`） | HTTP 201，创建默认停用的 Source（`revisionId` 从 `<id>:1` 起）并返回投影。先按 Zod 合同解析，再确认 ref 对应 enabled manifest 与 operationId，最后按 canonical 配置 schema 校验 `config` 后写库。 |
| `PATCH /sources/:sourceId` | JSON body `UpdateSourceCommand`：必填 `baseRevisionId`，可选 `name` 与完整替换的 `config` | HTTP 200，CAS 更新后返回投影；不存在 404；body 不合法或配置校验失败 400；revision 过期 409。`config` 存在时先经 canonical schema 校验。 |
| `POST /sources/:sourceId/activation-commands` | 必需非空且 ≤300 字符的 `Idempotency-Key` header；body `SourceActivationCommand` | HTTP 201 返回更新后投影。启用前按 canonical schema 校验已保存配置；同 key 同请求重放返回首次记录的结果快照；同 key 不同请求或过期 `baseRevisionId` 409；no-op 不递增 revision。 |
| `POST /sources/:sourceId/removals` | 必需非空且 ≤300 字符的 `Idempotency-Key` header；body `DeleteSourceCommand`：必填 `baseRevisionId`，可选 `actor`/`reason` | HTTP 200 返回删除后的投影（**墓碑**语义，AUT-001）：来源从列表/读取/调度中消失，已录入的 Entry/Observation/Revision 与媒体全部保留；删除移除调度绑定并写 `source.deleted.v1` 审计事件。命令天然幂等——重复调用返回同一份结果、不重复写事件；过期 `baseRevisionId` 409；来源不存在 404。 |
| `POST /sources/:sourceId/test` | 可选 `Idempotency-Key` header（≤300 字符） | 不变：HTTP 202 返回 `JobSnapshot`，创建 `source-probe` Job；未提供 key 时生成随机 probe key；Source 不存在 404。 |
| `POST /sources/:sourceId/runs` | 可选 `Idempotency-Key` header（≤300 字符） | HTTP 201 返回 Product Run；仅接受已启用 Source，未启用 409 `conflict`；Source 不存在 404；无 header 时生成随机 key。优先 Workflow Control 入队 `cosmos.ingest@1`，否则走 legacy queued Run。 |
| `POST /media-cleanups` | 可选 `Idempotency-Key` header（≤300 字符）；body `MediaCleanupCommand`（可选 `sourceId`、可选 `dryRun`，缺省 `dryRun: true`） | HTTP 201 返回 `MediaCleanupRunSnapshot`；入队 `cosmos.media-cleanup@1`。durable host 未启用时 409 `conflict`；未知字段或非法 body 400 `validation_failed`；同 key 不同 `{sourceId, dryRun}` 409 `conflict`。无 header 时生成随机 key。 |
| `GET /media-cleanups/:runId` | path `runId` | HTTP 200 返回 `MediaCleanupRunSnapshot`（`status` 为公开 Run 状态；`report` 在 Action 完成后由 `media.cleanup.completed.v1` 事件填充，未完成或未解析时为 `null`）；不存在 404。 |
| `GET /connections` | 无 | HTTP 200 返回 `ConnectionInstance[]`（按 createdAt 升序）。 |
| `GET /connections/:connectionId` | path `connectionId` | HTTP 200 返回 `ConnectionInstance`；不存在 404。 |
| `POST /connections` | body `CreateConnectionCommand` | HTTP 201 返回 `ConnectionInstance`（status 缺省 `active`）；非法 body 400 `validation_failed`。 |
| `PATCH /connections/:connectionId` | body `UpdateConnectionCommand`（全可选） | HTTP 200 返回更新后的 `ConnectionInstance`；不存在 404。 |
| `POST /connections/:connectionId/removals` | path `connectionId` | HTTP 200 返回 ack；同事务把引用该连接的 Source `connectionId` 置空，不删除来源。 |
| `POST /connections/:connectionId/probes` | path `connectionId`；可选 `Idempotency-Key` header（≤300 字符） | HTTP 202 返回 `ConnectionProbeJobSnapshot`，创建 `connection-probe` Job（ADR-0027 决定 2）；连接不存在 404；该连接的 Connector 没在 manifest 里声明 `auth.probeSupported` 时 409 `conflict`；无 header 时由 API 生成 `connection-probe:<uuid>` 幂等键。探测由 Worker 执行——API 不访问外部平台。 |
| `GET /connection-probes/:jobId` | path `jobId` | HTTP 200 返回 `ConnectionProbeJobSnapshot`；不存在或不是 `connection-probe` 的作业 404（不泄露其它种类的作业）。 |
| `GET /collection-plans` | 无 | HTTP 200 返回 `CollectionPlanSnapshot[]`（按 createdAt 升序；墓碑来源的计划不出现）。 |
| `GET /collection-plans/:planId` | path `planId` | HTTP 200 返回 `CollectionPlanSnapshot`；不存在或来源已删除 404。 |
| `PATCH /collection-plans/:planId` | body `UpdateCollectionPlanCommand`：必填 `baseRevisionId`，可选 `name`/`connectionId`/`scheduleIntervalMs`/`mediaPolicy`/`enabled` | HTTP 200 返回更新后投影；不存在 404；revision 过期 409；`enabled: true` 前先按 canonical schema 校验已保存的目标配置，不合法 400。`scheduleIntervalMs` 只增/改/删 schedule 触发器，不触碰 webhook 入口（ADR-0025）。 |
| `POST /collection-plans/:planId/webhook-entry` | path `planId` | HTTP 201 返回 `{ planId, entryPath, credential }`（ADR-0024）：入口标识与凭证一起生成或轮换，**明文凭证只在这个响应里出现一次**，旧凭证立即失效；不存在 404。不要求计划已启用——计划停用时由 inbound 端点拒绝请求。 |
| `DELETE /collection-plans/:planId/webhook-entry` | path `planId` | HTTP 200 返回撤销后的 `CollectionPlanSnapshot`（`webhook` 回到 `null`）：删除入口标识与凭证字节，幂等；不存在 404。 |

Webhook 入口的 `entryPath` 会出现在 URL 与日志里，所以它不是凭证；凭证本体只在生成/轮换响应里出现一次，读投影只回答 `credentialConfigured`（ADR-0024）。

Connection 的 `secretRef` 只以不透明字符串回显；凭证本体只在 SecretStore 内、经能力受限租约读写，不进入任何 HTTP DTO、DomainEvent、Job payload 或日志（ADR-0017）。`configJson` 是连接的**非秘密**适配器配置（Bilibili 的 OpenCLI profile 住在这里），创建与更新都可写、读取原样回显。`POST /source-config-probes` 接受可选 `connectionId`：未保存配置的探测没有来源与计划，需要登录态的操作靠它拿连接；不存在的连接当场 404 `not_found`。

| `GET /storage-stats` | 无 | HTTP 200 返回 `StorageStats`（数据库/Blob/Artifact/Cache/Log/Secret 字节 + 分层 `categories`）；只读。 |
| `GET /backups` | 无 | HTTP 200 返回 `BackupSnapshot[]`（数据根 `backups/` 下的数据库备份，按时间升序）。 |
| `POST /backups` | 无 | HTTP 201 返回 `BackupSnapshot`；用 `VACUUM INTO` 生成一致快照到 `backups/backup-<timestamp>.sqlite`（不依赖源码 checkout，Blob 不随备份）。 |
| `POST /backups/:backupId/restores` | path `backupId` | HTTP 200 返回 ack；恢复前生成 `pre-restore-*.sqlite` 保护备份后覆盖当前 SQLite；不存在 404；需重启 API/Worker 生效。 |
| `GET /exports/user-data` | 无 | HTTP 200 返回 JSON 附件（`UserDataExport`，`Content-Disposition: attachment; filename="cosmos-user-data-<exportedAt>.json"`，文件名里的 `:` 换成 `-`）；只读、不落盘、不改状态。 |
| `GET /connector-state/namespaces` | 无 | HTTP 200 返回 `ConnectorStateNamespaceSummary[]`；每个抽屉的 key 条数、归属（`planId`／`sourceId`／`connectionId`）与 `unattributed`；只读。 |
| `GET /exports/connector-state` | query `namespace`／`planId`／`connectionId`／`sourceId` 四选一，缺省 = 全部已归属 | HTTP 200 返回 JSON 附件（`ConnectorStateExport`，`filename="cosmos-connector-state-<exportedAt>.json"`）；只读、不落盘；同时给出多个范围参数按 400 `validation_failed` 拒绝。 |
| `POST /imports/connector-state` | body `ConnectorStateImportCommand` | HTTP 201 返回 `ConnectorStateImportResult`；默认 `skip-existing`，`overwrite` 时 `version = 本地 + 1`；body 超过 64 KB 返回 413 `payload_too_large`；`targetNamespace` 只在导出件含单个抽屉且目标抽屉已有归属登记时接受，否则 400 `validation_failed`。 |

`GET /exports/user-data` 的内容是七类用户真相对象（Label、Collection、Favorite、Annotation、Saved View、Board 树、Spotlight）加一份被引用目标的摘要（`targets`：目标类型、id、标题、条目的 `webUrl`）；字段直接复用各对象的公开读投影。它**不含**采集内容与派生投影、运行记录、连接与来源配置、Secret 字节、`ConnectorState` 与 `storageKey`；整库副本由 `POST /backups` 承担（ADR-0019 决策 5）。导出读取不加事务，是尽力而为的一致快照，`exportedAt` 是它的时间标记。

`GET /exports/connector-state` 只导出 `ConnectorState`：按抽屉（命名空间）切分，每项带归属快照与 `key`／`value`／`version`／`updatedAt`。归属来自 `ConnectorStateNamespace`，所以范围过滤是一次 join，不解析 manifest 模板；**未归属抽屉不属于任何一种范围**，默认不带走，只能按名字点名（`namespace`），此时导出件里 `owner` 为 `null`（ADR-0026）。它不含 Secret、连接配置、`Checkpoint` 与其它表；整库副本仍由 `POST /backups` 承担。

`POST /imports/connector-state` 只写 `ConnectorState`，不触发采集、不写事件、不改计划与连接。导入是数据写入：回滚代码不会撤销已经写进库的状态，需要时用同一入口的 `overwrite` 反向导入旧件，或整库恢复。非法输入（结构不符、超出体积上限）整批拒绝，不做部分写入；合法输入在单个事务内写完。

Catalog page 当前固定 `nextCursor: null`，`snapshotAt` 是响应生成时的 ISO 时间。Builtin
catalog 包含 `rss`、`fixture-rss`、`bilibili`、`aihot` Source definitions，Workflow
`cosmos.ingest@1` 与 `cosmos.media-cleanup@1`，以及 `source.fetch@1`、`media.retry.fetch@1`、
`media.retry.apply@1`、`library.ingest@1`、`source.checkpoint@1`、`media.cleanup@1`
Action manifests；这些是当前实现锚点，不是允许客户端执行的命令列表。


`CreateSourceCommand` 的 `name` 去空格后 1–200 字符；`sourceDefinitionRef` 必须命中当前
Catalog 的 enabled manifest，`operationId` 必须出现在其 operationIds 内；`config` 由
contracts 的 `getSourceConfigurationSchema(ref, operationId)` strict Zod schema 校验——这是
canonical 校验真相，manifest JSON Schema 只是发布投影。命令不接受 `enabled`：创建固定停用，
只能通过 activation command 启用。Source 公开 config 按**该 operation 声明的字段**投影：键取自
同一份 canonical schema（RSS 为 `feedUrl`；Bilibili `fetch` 为 `mode`/`limit`/`schemaVersion`，
`search` 为 `query`/`limit`/`schemaVersion`），未声明的键不回显；读不到 canonical schema 的来源
（历史 kind 投影）退回只保留 `feedUrl`。投影**不含**凭证：OpenCLI profile 住连接的 `configJson`，
不在来源 config 里。

`POST /sources/:sourceId/runs` 只接受已启用的 Source：未启用返回 409 `conflict`；
可选 `Idempotency-Key` 超过 300 字符按 400 `validation_failed` 拒绝，缺失时生成随机
`manual:<sourceId>:<uuid>` key。Workflow Control 仍按 key 复用 envelope 并在身份冲突时抛出
`WorkflowHostConflictError` 映射为 409。

### Run、Job、Attempt

| Method/path | 输入 | 成功输出与错误 |
| --- | --- | --- |
| `GET /runs` | 可选 `sourceId`、`limit` | 运行记录：按创建时间倒序返回最近 durable `RunSnapshot[]`（缺省 20 条、上界 100）；只含 durable `WorkflowRun`，不含 legacy Run 泳道。 |
| `GET /runs/:runId` | path `runId` | 先查 Workflow Host envelope，存在则返回 Product Run；否则查 legacy `RunSnapshot`；两者都不存在 404。 |
| `GET /runs/:runId/jobs` | path `runId` | `{ items: JobSnapshot[] }`（按 createdAt 升序，OPS-002）：`runId` 同时匹配 legacy `Job.runId` 与 durable `Job.workflowRunId`，因为两种 Run 共用同一个 Run 读端点。未知 Run 返回空列表而不是 404。这是产品面从 Run 走到 Job 的唯一入口；Attempt 明细仍由 `/jobs/:jobId/attempts` 提供。 |
| `GET /workflow-runs/:runId` | path `runId` | 当前实现别名，调用同一 `/runs/:runId` 查询和投影；不存在 404。 |
| `POST /runs/:runId/cancellations` | body 可选 `reason` | Run 控制 v1：非终态 Run 终态化 `cancelled` + fence；不存在 404，终态/并发 409；返回 `RunControlResult`（`run` + `reuse`/`sideEffects`）。 |
| `POST /runs/:runId/recoveries` | body 可选 `reason` | Run 控制 v1：无活动 lease 的非终态 Run 置 `resumeRequired` 送回恢复队列；活动 lease/终态 409，不存在 404。 |
| `POST /runs/:runId/re-runs` | 可选 `Idempotency-Key` header | Run 控制 v1：终态 Run 复用采集入队产生全新 Run；非终态 409、不存在 404、非 ingest 400 `invalid_state`；返回新 Run 的 `RunControlResult`。 |
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
| `GET /search` | query `text?`（最多 500）、`sourceId?`、`publishedAfter?`、`publishedBefore?`（带 offset 的 ISO）、`labelIds?`、`topicIds?`（逗号分隔 id）、`author?`（最多 200，按发布者 name/handle 子串、大小写不敏感）、`contentKind?`（受管内容形态）、`assetStatus?`（受管资产四态）、`cursor?`、`limit?`（1–100，默认 20） | `SearchPage`，FTS/过滤结果与 rank；label/topic 过滤为 any-of 语义（Story 级标签、active Topic 成员），`author`/`contentKind`/`assetStatus` 为单值等值条件、彼此 AND；`assetStatus` 命中「当前 Revision 的资产里存在该状态」的条目；Zod 解析失败 400。无写副作用。 |
| `GET /entries` | query `sourceId?`、`cursor?`、`limit?`（1–100，默认 50） | `EntryPage`；Zod 解析失败 400。 |
| `GET /stories/:storyId` | path `storyId` | `StoryDetail`：Story 摘要（含 `status`/`replacedBy` 与当前表示的 `timeRange`/`keyFacts`）、可空 `entry`（最近成员，兼容位）、`entries`（全部成员，updatedAt 倒序）、`entities`（关联 Entity 快照列表）与 `topics`（当前 Topic 成员）。旧 merge id 先解析到 canonical Story；split 历史壳保留自身 id 且可零成员；不存在/无当前 Revision 404。 |
| `POST /stories/:storyId/entry-moves` | body `MoveEntryToStoryCommand` | `StoryDetail`；Schema 失败 400，Entry/Story 缺失 404。 |
| `POST /stories/:storyId/revisions` | body `UpdateStoryRevisionCommand` | `StoryDetail`；Schema 失败 400（含 `end` 早于 `start`、事实超 20 条或单条超 500 字），Story 缺失 404，`baseRevisionId` 过期或目标是历史壳 409 conflict，subtype 不是该 kind 的可写注册项 400 `validation_failed`（ADR-0013）。body 的 `timeRange`/`keyFacts` 可选，**省略即清空**（全量提交，ADR-0021 决定 5）；内容无实质变化时 current 指针不动。 |
| `POST /stories/merges` | body `MergeStoriesCommand` | `StoryDetail`；Schema 失败 400，Story 缺失 404，归并自身/已 merge Story/历史壳 409 conflict。 |
| `POST /stories/:storyId/splits` | body `SplitStoryCommand` | `StoryDetail`（历史壳）；Schema 失败 400，Story 缺失 404，后继不足 2 个、映射不属于当前关系、跨后继重复、自关联或已是历史壳 409 conflict（ADR-0012），后继 subtype 不是该 kind 的可写注册项 400 `validation_failed`（ADR-0013）。每个后继可带自己的 `timeRange`/`keyFacts`，未带即为空；壳上的两项不复制给后继（ADR-0021 决定 6）。 |
| `POST /stories/:storyId/user-state-migrations` | body `MigrateStoryUserStateCommand`（目标 Story 与五类对象选择） | `StoryUserStateMigrationResult`（每类 `moved`/`deduped`）；Schema 失败 400，来源或目标 Story 缺失 404，两端不是同一 split 家族、同一 Story、或命名的行不在来源 Story 上 409 conflict（ADR-0020）。来源在 path、目标在 body，形态对齐 `/splits`。 |
| `GET /story-subtypes` | query `kind?`（核心 kind 枚举） | `StorySubtypePage`：受管理 subtype 目录（`active` + `deprecated`，`retired` 不返回）；未知 `kind` 400。只读，不写任何状态。 |
| `GET /topics` | query `cursor?`、`limit?` | `TopicPage`；limit 经 clampLimit，按 Topic `updatedAt` 倒序，nextCursor 为偏移字符串或 null。 |
| `GET /topics/:topicId` | path `topicId` | `TopicDetail`（topic 摘要 + 成员列表，含 removed/tombstone 成员）；旧 merge id 解析到 canonical Topic，不存在 404。 |
| `POST /topics` | body `CreateTopicCommand` | `TopicDetail`；Schema 失败 400，`seedStoryId` 不是有效 Story 404。 |
| `POST /topics/:topicId/revisions` | body `UpdateTopicCommand` | `TopicDetail`；Schema 失败 400，Topic 缺失 404，`baseRevisionId` 过期 409。 |
| `POST /topics/merges` | body `MergeTopicsCommand` | `TopicDetail`；Schema 失败 400，Topic 缺失 404，归并自身/已 merge Topic 409。 |
| `POST /topics/:topicId/members` | body `AddTopicMemberCommand` | `TopicDetail`；Schema 失败 400，Topic/Story 缺失 404。 |
| `POST /topics/:topicId/member-role-updates` | body `UpdateTopicMemberRoleCommand` | `TopicDetail`；Schema 失败 400，Topic/Story 缺失或成员已移除 404。 |
| `POST /topics/:topicId/member-removals` | body `RemoveTopicMemberCommand` | `TopicDetail`；Schema 失败 400，成员缺失 404。 |
| `POST /topics/:topicId/member-restorations` | body `RestoreTopicMemberCommand` | `TopicDetail`；Schema 失败 400，成员缺失 404。 |
| `GET /entities` | query `cursor?`、`limit?` | `EntityPage`；limit 经 clampLimit，按 Entity `updatedAt` 倒序，nextCursor 为偏移字符串或 null。 |
| `GET /entities/:entityId` | path `entityId` | `EntityDetail`（current name/type、aliases、关联 Story 列表、双向关系列表）；不存在 404。 |
| `POST /entities` | body `CreateEntityCommand` | `EntityDetail`；Schema 失败 400（未知 `type`/超长等）。 |
| `POST /entities/:entityId/revisions` | body `UpdateEntityCommand` | `EntityDetail`；Schema 失败 400，Entity 缺失 404，`baseRevisionId` 过期 409。 |
| `POST /entities/:entityId/aliases` | body `AddEntityAliasCommand` | `EntityDetail`；Schema 失败 400，Entity 缺失 404。 |
| `POST /entities/:entityId/alias-removals` | body `RemoveEntityAliasCommand` | `EntityDetail`；Schema 失败 400，Entity 缺失 404。 |
| `POST /story-entity-links` | body `LinkStoryEntityCommand` | `EntityDetail`；Schema 失败 400，Story/Entity 缺失 404。 |
| `POST /story-entity-links/removals` | body `UnlinkStoryEntityCommand` | `EntityDetail`；Schema 失败 400，Story/Entity 缺失 404。 |
| `POST /entity-relations` | body `CreateEntityRelationCommand` | `EntityDetail`；Schema 失败 400，未知关系类型/自环 409，端点 Entity 缺失 404。 |
| `POST /entity-relations/removals` | body `RemoveEntityRelationCommand` | `EntityDetail`；Schema 失败 400，from Entity 缺失 404。 |
| `POST /entry-story-links` | body `LinkEntryStoryCommand` | `StoryDetail`（canonical 目标 Story）；Schema 失败 400，Entry/Story 缺失 404，指向自己的主 Story 409。 |
| `POST /entry-story-links/removals` | body `UnlinkEntryStoryCommand` | `StoryDetail`；Schema 失败 400，Entry/Story 缺失 404；不存在的关系是幂等 no-op。 |
| `POST /entry-relations` | body `LinkEntryRelationCommand` | `EntryDetail`（`fromEntryId` 那一侧）；Schema 失败 400，端点 Entry 缺失 404，自关联或有向反向提交 409（对称类型的反向提交是覆盖写，不是冲突）。 |
| `POST /entry-relations/removals` | body `UnlinkEntryRelationCommand` | `EntryDetail`（`fromEntryId` 那一侧）；Schema 失败 400，端点 Entry 缺失 404；不存在的关系是幂等 no-op。 |
| `GET /labels` | 无 | `LabelList`；按 name 升序，含 `assignedCount`。 |
| `GET /labels/:labelId` | path `labelId` | `LabelDetail`（按类型分组的 `assignedStories`/`assignedEntries`/`assignedTopics`，各含解析后的标题）；不存在 404。 |
| `POST /labels` | body `CreateLabelCommand` | `LabelItem`；Schema 失败 400，重名 409。 |
| `POST /labels/:labelId/removals` | path `labelId` | `UserOrganizationAck`（`action: "label.deleted"`）；不存在 404。 |
| `POST /label-assignments` | body `LabelAssignmentCommand` | `UserOrganizationAck`（`action: "label.assigned"`）；Schema 失败 400（未知 `targetType`），Label 缺失 404，目标 Story/Entry/Topic 缺失 404。 |
| `POST /label-assignments/removals` | body `LabelAssignmentCommand` | `UserOrganizationAck`（`action: "label.unassigned"`）；错误同上；缺失附加为幂等 no-op。 |
| `GET /collections` | query `storyId?` | `CollectionList`；给出 `storyId` 时每项含 `containsStory`。 |
| `GET /collections/:collectionId` | path `collectionId` | `CollectionDetail`（成员 Story 含当前标题与 `addedAt`）；不存在 404。 |
| `POST /collections` | body `CreateCollectionCommand` | `CollectionSummary`；Schema 失败 400。 |
| `PATCH /collections/:collectionId` | body `UpdateCollectionCommand` | `CollectionSummary`；Schema 失败 400，不存在 404。 |
| `POST /collections/:collectionId/removals` | path `collectionId` | `UserOrganizationAck`（`action: "collection.deleted"`）；不存在 404。 |
| `POST /collections/:collectionId/items` | body `CollectionItemCommand` | `UserOrganizationAck`（`action: "collection.item_added"`）；Schema 失败 400，Collection/Story 缺失 404。 |
| `POST /collections/:collectionId/items/removals` | body `CollectionItemCommand` | `UserOrganizationAck`（`action: "collection.item_removed"`）；错误同上；缺失成员为幂等 no-op。 |
| `GET /favorites` | 无 | `FavoriteList`；按加入时间倒序。 |
| `POST /favorites` | body `FavoriteCommand` | `UserOrganizationAck`（`action: "favorite.set"`）；Schema 失败 400（`topic` 等非法目标），目标缺失 404。 |
| `POST /favorites/removals` | body `FavoriteCommand` | `UserOrganizationAck`（`action: "favorite.unset"`）；错误同上；缺失收藏为幂等 no-op。 |
| `GET /annotations` | query `targetType`、`targetId` | `AnnotationList`；目标按 canonical 解析，按 `createdAt` 升序；Schema 失败 400，目标缺失 404。 |
| `POST /annotations` | body `CreateAnnotationCommand` | `Annotation`；Schema 失败 400（未知 `targetType`、空 body），目标缺失 404。 |
| `PATCH /annotations/:annotationId` | body `UpdateAnnotationCommand` | `Annotation`；Schema 失败 400，批注缺失 404。 |
| `POST /annotations/:annotationId/removals` | path `annotationId` | `UserOrganizationAck`（`action: "annotation.deleted"`）；不存在 404。 |
| `GET /saved-views` | 无 | `SavedViewList`；按 `createdAt` 升序。 |
| `POST /saved-views` | body `CreateSavedViewCommand` | `SavedView`；Schema 失败 400（空名称、非法条件）。 |
| `PATCH /saved-views/:savedViewId` | body `UpdateSavedViewCommand` | `SavedView`；Schema 失败 400，不存在 404。 |
| `POST /saved-views/:savedViewId/removals` | path `savedViewId` | `UserOrganizationAck`（`action: "saved_view.deleted"`）；不存在 404。 |
| `GET /boards` | 无 | `BoardList`；按 `createdAt` 升序，含 `sectionCount`。 |
| `POST /boards/ensure-default` | 无 | `BoardDetail`；幂等 seed 默认看板（无任何 Board 时创建热点/精华/信息流三 Section）。 |
| `GET /boards/:boardId` | path `boardId` | `BoardDetail`（sections 与 blocks 各按 position 升序）；不存在 404。 |
| `POST /boards` | body `CreateBoardCommand` | `BoardDetail`；Schema 失败 400（空名称），name 冲突 409。 |
| `PATCH /boards/:boardId` | body `UpdateBoardCommand` | `BoardDetail`；Schema 失败 400，不存在 404，name 冲突 409。 |
| `POST /boards/:boardId/removals` | path `boardId` | `BoardCommandAck`（`action: "board.deleted"`）；级联删除配置树，不触碰内容对象；不存在 404。 |
| `POST /board-sections` | body `CreateSectionCommand` | `BoardDetail`；Schema 失败 400，Board 缺失 404。 |
| `PATCH /board-sections/:sectionId` | body `UpdateSectionCommand` | `BoardDetail`；Schema 失败 400，Section 缺失 404；`position` 提供时重排该 Board 的分区顺序。 |
| `POST /board-sections/:sectionId/removals` | path `sectionId` | `BoardCommandAck`（`action: "board_section.deleted"`）；连带其下 Block；不存在 404。 |
| `POST /board-blocks` | body `CreateBlockCommand` | `BoardDetail`；Schema 失败 400（未知 type、非法 config 白名单），Section 缺失 404。 |
| `PATCH /board-blocks/:blockId` | body `UpdateBlockConfigCommand` | `BoardDetail`；config 按已存 type 重新校验（失败 400），Block 缺失 404。 |
| `POST /board-blocks/:blockId/moves` | body `MoveBlockCommand` | `BoardDetail`；跨 Section 重排并紧凑化原 Section；目标 Section 缺失 404。 |
| `POST /board-blocks/:blockId/visibility` | body `SetBlockVisibilityCommand` | `BoardDetail`；隐藏只改 `visible`，不删除行。 |
| `POST /board-blocks/:blockId/duplications` | path `blockId` | `BoardDetail`；副本插在原块之后，复用同 type/config。 |
| `POST /board-blocks/:blockId/removals` | path `blockId` | `BoardCommandAck`（`action: "board_block.deleted"`）；不删除被引用的内容对象；不存在 404。 |
| `GET /spotlight-placements` | query 可选 `boardId` | `SpotlightPlacementList`（含解析后的 `targetTitle`）；按 `createdAt` 升序。 |
| `POST /spotlight-placements` | body `PinSpotlightCommand` | `SpotlightPlacement`；Schema 失败 400（未知 targetType、缺 boardId），目标或 Board 缺失 404，重复固定为幂等 no-op。 |
| `POST /spotlight-placements/:placementId/removals` | path `placementId` | `BoardCommandAck`（`action: "spotlight_placement.deleted"`）；物理解除；不存在 404。 |
| `GET /entries/:entryId` | path `entryId` | `EntryDetail`（当前 revision、revision 列表、observations）；不存在或无 current revision 404。 |
| `GET /revisions/:revisionId` | path `revisionId` | `RevisionDetail`；不存在 404。 |
| `GET /assets/:assetId` | path `assetId` | HTTP 200 二进制 `StreamableFile`，Content-Type 为保存的 mime type；没有可读取内容 404。响应不是 JSON DTO。 |

Feed/Search/Entry 的 cursor 是当前存储实现的偏移 cursor；非法/负 cursor 在存储层按
0 处理。Search date 仍会经过 contracts 的 offset datetime 校验；存储层无法构造有效
日期时也拒绝。Entry/Revision 只读（唯一的例外是 `entry-relations`，它写的是条目之间的重复/转载关系，不是条目本身）；Story 写操作仅限上述四个编排端点（entry-moves、revisions、merges、entry-story-links），Entity/关系写操作仅限上方
entities/revisions/aliases/alias-removals/story-entity-links/entity-relations 端点，用户组织写操作仅限
labels/label-assignments/collections/items/favorites/annotations/saved-views 端点，看板写操作仅限
boards/board-sections/board-blocks/spotlight-placements 端点，其余路径不在 API 层修改事实。

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
identity、lease token、Connector executable、Secret 或文件系统绝对路径。**Feed、Search、
Entry 和 Revision/Story 内部 revision 的 Asset 投影不含 `storageKey`**：六条公开读路由在
返回前经 `apps/api/src/app.controller/public-projection.ts` 的 `toPublicAsset` 逐个挑字段，
公开读 DTO 由 contracts 的 `publicAssetSnapshotSchema` 描述（从 `assetSnapshotSchema` 省略
`storageKey`）。仓储内部的 `AssetSnapshot`（`PrismaCosmosRepository.toAssetSnapshot`）仍保留
该字段，只服务 Blob 读写与内部用例；回归锚点是
`apps/api/src/app.controller.public-projection.test.ts`。
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

### 409

同一 `Idempotency-Key` 绑定不同 Source、trigger 或 Workflow 输入快照时，Application 抛出
`WorkflowHostConflictError`，Controller 返回 HTTP `409`，body 为 `{ code: "conflict", retryable: false, ... }`。
同一 key 与同一 identity 的重放仍返回原 Workflow Run，不创建第二个 durable envelope。

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
   请求非法 Search/Entries query，观察 HTTP 400。检查 Feed/Entry/Revision 资产投影不含
   `storageKey`（整份响应 JSON 都搜不到该字段名），并确认 Asset download 返回 bytes/mime 而非 JSON。
9. 用 `after=0` 建立 SSE，观察持久事件按 id 升序到达；设置 replay limit 为 1 并使窗口
   超过上限，观察一条 `snapshot_required` 且 `latestEventId` 等于存储最新序号。
10. 在无新事件连接保持至少 10 秒，观察 `keepalive.v1`；取消连接后观察不再新增 poll；
    查询不存在 Story/Entry/Revision/Asset，观察 HTTP 404。
11. 对一条 Story 提交带 `timeRange`（开始为准确时刻、结束留空）与两条有序 `keyFacts` 的
    revision 命令，观察返回的 `StoryDetail` 带这两项且 `revisionId` 前进；原样重复提交一次，
    观察 `revisionId` 不变（no-op）；不带这两项提交，观察两项清空且 `revisionId` 再次前进；
    用 `end` 早于 `start` 或 21 条事实提交，观察 HTTP 400 且 Story 保持上一次保存的状态。
12. 先建一个 Label 并挂到一个 Story 上，再请求 `GET /api/v1/exports/user-data`：观察响应带
    `Content-Disposition: attachment` 与 `cosmos-user-data-<exportedAt>.json` 文件名，body 通过
    `userDataExportSchema`，`data.labels` 含该 Label 且 `data.targets` 含被引用的 Story（标题来自
    当前 revision）；整份响应 JSON 搜不到 `secretRef`、`storageKey`、连接名或来源名。

## 实现与测试锚点

- 全部路由、投影、SSE poll/keepalive/replay：[`apps/api/src/app.controller.ts`](../../../apps/api/src/app.controller.ts) 门面与 [`apps/api/src/app.controller/`](../../../apps/api/src/app.controller) 下的资源分册（继承链）。
- Source catalog 校验：[`apps/api/src/source-probe.service.ts`](../../../apps/api/src/source-probe.service.ts)。
- Nest prefix/CORS/filter 安装：[`apps/api/src/main.ts`](../../../apps/api/src/main.ts)。
- Product DTO schemas：[`packages/contracts/src/index.ts`](../../../packages/contracts/src/index.ts) 与 [`packages/contracts/src/base.ts`](../../../packages/contracts/src/base.ts)。
- Catalog manifest port/builtin entries：[`packages/application/src/catalog.ts`](../../../packages/application/src/catalog.ts)。
- Workflow enqueue and `cosmos.ingest@1` snapshot：[`packages/application/src/workflow-control.ts`](../../../packages/application/src/workflow-control.ts)。
- Domain query/projection/event sequence：[`packages/storage-prisma/src/index.ts`](../../../packages/storage-prisma/src/index.ts)。
- SSE snapshot fallback、probe queue、Run mapping、Attempt projection：[`apps/api/src/app.controller.runs.test.ts`](../../../apps/api/src/app.controller.runs.test.ts)、[`apps/api/src/app.controller.sources.test.ts`](../../../apps/api/src/app.controller.sources.test.ts)。

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
