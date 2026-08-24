# Product Service API 草案

> 状态：Draft v0.2；目标合同，等待 `nb-workflow` Kernel 门禁后实施
>
> 基础路径：`/api/v1`
>
> 公共约定：[`0001-common-contracts.md`](0001-common-contracts.md)

除 `/healthz`、`/readyz` 和表中显式写出的完整路径外，下列资源 Path 均相对于
`/api/v1`。

## 1. 边界

Product Service API 面向 Web、CLI、Desktop、知识管理者工具和受控插件。它是应用
Command/Query/Event 的 HTTP/SSE 映射，不是 Prisma Repository 的远程外观。

Controller 只能调用 Application Port。API 可以读取 manifest/schema/capability，
但不加载或执行 Workflow、Action、Connector 或 Agent executable。

未认证模式只面向 loopback/明确受信网络。能够从其它主机访问的 Product API 必须
在独立部署 Task 中固定 HTTPS、身份、Session/Token 生命周期和受控文件访问；CORS
不能替代这条边界。

## 2. System 与 Capability

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Convergence | `GET` | `/healthz` | `LivenessSnapshot`；无数据库访问 |
| Convergence | `GET` | `/readyz` | `ReadinessSnapshot`；API 可读写能力 |
| Current | `GET` | `/api/v1/health` | `ServiceHealthSnapshot` |
| Convergence | `GET` | `/api/v1/capabilities` | `ServiceCapabilitySnapshot` |
| Planned | `GET` | `/api/v1/settings` | 非秘密的产品设置与 revision |
| Planned | `PATCH` | `/api/v1/settings` | 基于 `If-Match` 更新产品设置 |

API readiness 不要求 Worker 在线。`ServiceHealthSnapshot` 可以同时显示：

- API/Storage/Migration ready；
- 当前无 capable Worker；
- 某些 Action/SourceDefinition unavailable；
- 已保存 Feed/Search 仍然可用。

## 3. Catalog 与插件 manifest

### 3.1 插件

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/plugins` | `Page<PluginManifestSummary>` |
| Planned | `GET` | `/plugins/{pluginId}` | `PluginManifestDetail` |
| Reserved | `POST` | `/plugin-installations` | 创建受控安装/启用流程 |
| Reserved | `GET` | `/plugin-installations/{id}` | 安装/校验状态 |
| Reserved | `DELETE` | `/plugin-installations/{id}` | 停用或卸载；不隐式删数据 |

插件安装涉及代码执行和发布生命周期，只有独立 Task 明确校验来源、版本、hash、
权限和回滚后才实现。Catalog Query 本身不加载 executable。

### 3.2 Definition catalog

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Convergence | `GET` | `/source-definitions` | `Page<SourceDefinitionSummary>` |
| Convergence | `GET` | `/source-definitions/{id}` | `SourceDefinitionDetail` |
| Convergence | `GET` | `/source-definitions/{id}/operations` | `Page<SourceOperationDefinition>` |
| Convergence | `GET` | `/workflow-definitions` | `Page<WorkflowDefinitionSummary>` |
| Convergence | `GET` | `/workflow-definitions/{id}/versions/{version}` | `WorkflowDefinitionDetail` |
| Convergence | `GET` | `/action-definitions` | `Page<ActionDefinitionSummary>` |
| Convergence | `GET` | `/action-definitions/{id}/versions/{version}` | `ActionDefinitionDetail` |
| Planned | `GET` | `/trigger-definitions` | `Page<TriggerDefinitionSummary>` |
| Planned | `GET` | `/story-subtypes` | `Page<StorySubtypeDefinition>` |
| Planned | `GET` | `/workspace-view-definitions` | `Page<WorkspaceViewDefinition>` |
| Planned | `GET` | `/board-block-definitions` | `Page<BoardBlockDefinition>` |

`SourceDefinition` 取代当前 `/connectors` 的对外语义。它只返回用户可配置 operation、
schema 和能力，不暴露 OpenCLI command、可执行路径或进程对象。

## 4. Connection、Source、CollectionPlan 与 Trigger

### 4.1 Connection

Connection 表示用户在一个 Provider 上可复用的登录/授权关系。Secret 值不通过本
API 返回。

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/connections` | `Page<ConnectionSummary>` |
| Planned | `POST` | `/connections` | `ConnectionSnapshot` |
| Planned | `GET` | `/connections/{id}` | `ConnectionDetail` |
| Planned | `PATCH` | `/connections/{id}` | 新 revision 的 `ConnectionSnapshot` |
| Planned | `POST` | `/connections/{id}/authorization-sessions` | `202 AuthorizationSessionSnapshot` |
| Planned | `GET` | `/authorization-sessions/{id}` | 登录/OAuth/device/browser 状态 |
| Planned | `POST` | `/authorization-sessions/{id}/cancel` | 取消未完成授权 |
| Planned | `POST` | `/connections/{id}/probes` | `202 ProbeSnapshot` |
| Planned | `POST` | `/connections/{id}/revocations` | 撤销 Secret，不删历史 Entry |
| Planned | `DELETE` | `/connections/{id}` | 只允许已撤销且无活动引用时删除配置 |

Browser Bridge/OpenCLI profile 可以投影为一种外部管理的 Connection，不把 Cookie
复制进 Cosmos。

### 4.2 Source

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Current (legacy) | `GET` | `/sources` | `SourceSnapshot[]`；按 repository 顺序读取，不写入 |
| Current (legacy) | `POST` | `/sources` | `SourceSnapshot`；当前实现允许省略 `enabled` 并默认启用，不能作为配置优先产品合同 |
| Planned · Phase 1 product cutover | `POST` | `/sources` | `SourceSnapshot`；保存后强制 `enabled=false`，不接受客户端 `enabled` |
| Current (legacy) | `GET` | `/sources/{id}` | `SourceSnapshot`；不存在返回 404 |
| Current (legacy) | `PATCH` | `/sources/{id}` | `SourceSnapshot`；当前只支持 `enabled` |
| Planned · Phase 1 product cutover | `PATCH` | `/sources/{id}` | `SourceSnapshot`；目标合同编辑名称/完整配置，不改变 `enabled` |
| Planned · Phase 1 remainder | `POST` | `/source-configuration-validations` | 同步校验未保存的 `sourceDefinitionRef + config`；成功返回 validation snapshot；失败沿用当前 `validation_failed` 合同，具体 HTTP 状态待实现验证 |
| Planned · Phase 1 remainder | `POST` | `/source-probes` | `202 SourceConfigProbeJobSnapshot`；创建独立的 `source-config-probe` Job，不能复用当前 `source-probe` |
| Planned · Phase 1 remainder | `POST` | `/sources/{id}/activation-commands` | 独立启用/停用 Command；返回更新后的 `SourceSnapshot` |
| Convergence | `POST` | `/sources/{id}/probes` | `202 ProbeSnapshot`；已保存 Source 的规范 Probe 路径 |
| Current compatibility | `POST` | `/sources/{id}/test` | `202 JobSnapshot`；保留已保存 Source Probe 语义，不接受未保存 `kind + config` |
| Current | `POST` | `/sources/{id}/runs` | `202 WorkflowRunSnapshot`；创建对应的 Workflow Run |
| Planned | `GET` | `/sources/{id}/observations` | 来源 Observation page |
| Planned | `GET` | `/sources/{id}/entries` | 来源 Entry page |
| Planned · Phase 1 remainder | `GET` | `/sources/{id}/health` | 来源状态、最近成功/错误和计划摘要 |
| Planned · Phase 1 remainder | `GET` | `/source-probes/{probeId}` | `SourceConfigProbeJobSnapshot`；只读独立未保存 Probe 的 status/error/result，不返回配置输入 |

### 4.2.1 配置优先产品流程合同（Phase 1 remainder）

本切片以一个 `SourceInstance` 同时保存来源名称、版本化 `sourceDefinitionRef`、`operationId`、已校验配置、revision 和可选调度字段；`sourceDefinitionRef` 是唯一业务身份，不新增独立 `CollectionPlan` 持久对象或第二套 Draft 状态机。`CollectionPlan` 仍是后续扩展边界。

产品流程固定为：

```text
读取 SourceDefinition/schema
→ POST /source-configuration-validations
→ POST /source-probes（未保存配置）
→ POST /sources（服务端保存为 disabled）
→ POST /sources/{id}/activation-commands（独立启用）
```

Command 约束：

- `config` 在服务端按该 ref 对应的 canonical strict Zod schema 校验（manifest JSON Schema 只是发布投影）；产品 API 不接受任意 passthrough 字段，也不把未知字段静默持久化或回显。RSS 首版允许 `feedUrl` 和可选 `scheduleIntervalMs`，`feedUrl` 必须是 http(s) URL。
- `POST /sources` 的创建 Command 不包含 `enabled`；请求若携带该字段必须按 `validation_failed` 拒绝，而不是忽略。校验失败不创建 Source。
- `PATCH /sources/{id}` 必须携带 `baseRevisionId`（或等价的必填 `If-Match`；本 DTO 草案采用 `baseRevisionId`）作为乐观并发保护；配置是完整替换值，不做未经声明的浅合并。允许修改名称和完整 `config`，`sourceDefinitionRef` 不可变，`enabled` 只能通过独立 activation Command 改变。revision 过期必须返回现有冲突合同，不能静默覆盖；修改不改写已排队 Run 的输入快照。
- `POST /sources/{id}/activation-commands` 使用必需且不超过 300 字符的 `Idempotency-Key`，body 为 `{ enabled: boolean, baseRevisionId: string }`；重复同一意图可重放并返回首次记录的结果快照，同 key 不同请求或冲突返回 409。启用前必须存在有效且已保存的配置；停用只阻止未来调度，不删除历史事实。状态实际变化时递增 revision；过期 `baseRevisionId` 沿用 `conflict` 合同。
- `POST /source-probes` 使用必需的 `Idempotency-Key`，body 只含 `sourceDefinitionRef` 与 `config`；目标是返回独立的 `source-config-probe` Job（`sourceId=null`），但该 Job kind、repository 创建/幂等、Worker acceptedKinds/dispatcher、Probe port、输入脱敏和结果投影尚未实现，不能复用当前 `source-probe`。在该垂直切片完成前，不把此端点标为 Current，也不声称 Worker 可以执行它。
- 未保存 Probe 的目标语义是允许创建独立 Job 和 `job.queued` 事件，但不得创建 Source、Run、Observation、Entry、Asset、Checkpoint 或推进任何事实游标；同一幂等键复用同一 Probe Job，不同配置沿用当前 `conflict` 合同。以上均为待实现合同，不是当前行为。
- 现有 `POST /sources/{id}/test` 继续只接收已保存 `sourceId` 和可选幂等 Header，作为兼容路径；它不能通过改名、增加 body 或复用实现来替代未保存配置测试。
- `scheduleIntervalMs` 仍是可选配置字段，范围沿用公共 schema；30 分钟默认、时区/间隔校验和修改生效时机仍是实现建议/待冻结，不在本次 DTO 中写死默认值。

统一错误边界：输入/schema/manifest 校验沿用当前 `validation_failed` 错误合同；资源不存在为 `404 not_found`；幂等键与已有不同 payload 冲突沿用当前 `conflict` 合同。Draft 中的 `idempotency_conflict` 仍需单独与当前实现统一，不在本切片新增错误码。配置校验的具体 HTTP 状态、字段级 details 形状、独立 `source-config-probe` 的执行失败映射和是否扩展 `ServiceError` code，均需在实现设计与行为测试中确认。测试期间的外部连接/解析失败写入独立 Probe Job 状态，不由 API 进程直接执行或伪装成保存成功。

`POST /sources/{id}/runs` 是 Ingest 的产品快捷入口，仅接受已启用的 Source（未启用返回 409 `conflict`）；规范行为仍是创建 `WorkflowRun`，它不建立第二种 Run。入队时捕获 Source execution snapshot，之后修改 Source 不改变已排队 Run 的输入。

身份与迁移边界：`sourceDefinitionRef` 必须精确匹配不可变 Catalog manifest；manifest 显式声明运行时 `connectorId`，SourceInstance 不持久化 `connectorId`，旧 `kind` 只作由注入 Catalog 生成的迁移期兼容投影。新 Product API 不接受 `kind`，也不根据 kind 字符串隐式生成 ref。旧数据迁移必须先对已知 kind、ref 和首批 `fetch` operation 做显式预检；未知或不唯一映射阻断迁移。SourceInstance 的 `revision` 是独立单调并发令牌，公开 `revisionId` 是不透明投影，`updatedAt` 不参与并发判断。

Repository/Application 必须通过注入的 `CatalogPort` 完成 ref→manifest→connectorId/kind 投影；调用方不得把投影字段作为创建输入传给 Repository。

错误映射固定为：输入、manifest 或配置 schema 错误使用当前 `validation_failed`（HTTP 400）；资源不存在使用 `not_found`（HTTP 404）；过期 revision、幂等键复用不同 payload 或其它状态冲突使用当前 `conflict`（HTTP 409）。
### 4.2.2 未保存配置 Probe 的完整待实现垂直切片

`POST /source-probes` 在以下边界全部实现并通过 focused 验收前保持 `Planned`，不能作为当前可调用端点或现有 `source-probe` 的别名：

1. **公共 Job 合同**：为 `source-config-probe` 定义独立 Job kind、`SourceConfigProbeJobSnapshot` 状态/结果投影和错误映射；`sourceId`、`runId` 固定为 `null`，输入配置不回显。该 kind 必须与当前 `@cosmos/contracts` 的 `source-probe` 明确区分。
2. **Application Probe port**：定义接收已校验 `sourceDefinitionRef + config` 的独立 Probe port，按 manifest 解析 Connector 并执行 dry-run；不得调用只接收已保存 `sourceId` 的 `SourceProbeService.runSource`，不得拥有领域持久化。
3. **Repository 创建与幂等**：提供独立 Job 创建方法，保存受控输入快照和规范化 payload fingerprint；相同幂等键/相同 payload 重放同一 Job，不同 payload 返回当前 `conflict` 合同；创建只能写 Job 与 queued Event。
4. **Worker acceptedKinds/dispatcher**：acceptedKinds 新增该 kind；dispatcher 按 `sourceDefinitionRef + config` 解析输入并调用新 Probe port，不能按 payload 读取 `sourceId`。租约、重试、完成和失败结果必须复用既有 Job fencing 语义。
5. **输入脱敏与结果投影**：配置中的凭据引用、URL 查询敏感值和完整外部 payload 不进入普通日志或 Job/HTTP 结果；成功结果只返回 connector/source definition 标识、计数、游标可用性和检查时间等受控字段。
6. **查询路径**：`GET /source-probes/{probeId}` 返回同一 `SourceConfigProbeJobSnapshot`，只读 status/error/result，不返回配置输入；现有 `GET /jobs/{jobId}` 继续只服务 legacy `JobSnapshot`/`JobDetail`，不隐式承载新 kind。
7. **行为验收**：补充 contracts/API/repository/worker focused tests，覆盖有效/无效 manifest 与 config、同/异 payload 幂等、旧 `source-probe` 回归、Worker dispatcher 正确分派、租约失败、POST→GET 状态读取，以及 Source/Run/Observation/Entry/Asset/Checkpoint 均未写入。

完成上述切片后，才决定是否把该端点从 `Planned` 提升为 `Convergence`，并同步 `@cosmos/contracts`、Product API、HTTP client、Worker 和 Task 证据。

### 4.3 CollectionPlan

CollectionPlan 是用户可见的独立采集目标。一个 Connection 可以有多个计划，各自
拥有 Trigger、checkpoint、预算、错误和 overlap policy。

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/collection-plans` | `Page<CollectionPlanSummary>` |
| Planned | `POST` | `/collection-plans` | `CollectionPlanSnapshot` |
| Planned · Phase 1 remainder | `GET` | `/collection-plans/{id}` | `CollectionPlanDetail` |
| Planned · Phase 1 remainder | `PATCH` | `/collection-plans/{id}` | 新 revision Snapshot |
| Planned | `DELETE` | `/collection-plans/{id}` | 停止未来触发，不删历史事实 |
| Planned · Phase 1 remainder | `POST` | `/collection-plans/{id}/runs` | 手动触发绑定 Workflow |
| Planned · Phase 1 remainder | `GET` | `/collection-plans/{id}/checkpoint` | `CheckpointSnapshot` |
| Reserved | `POST` | `/collection-plans/{id}/checkpoint-resets` | 高影响重置 Command/预览 |

Source 与 CollectionPlan 的最终关系仍可在实现 Task 调整，但 API 不允许用户直接
配置 Worker ID。Phase 1 完整范围可以先为每个 Source 创建一个默认 CollectionPlan，
只开放 manual/schedule、预算、checkpoint 和 overlap；Phase 2 再开放同一
Connection 下的多 Operation/多计划管理。默认计划不是第二套调度模型。

### 4.4 TriggerBinding 与 Webhook

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/trigger-bindings` | `Page<TriggerBindingSummary>` |
| Planned | `POST` | `/trigger-bindings` | `TriggerBindingSnapshot` |
| Planned | `GET` | `/trigger-bindings/{id}` | `TriggerBindingDetail` |
| Planned | `PATCH` | `/trigger-bindings/{id}` | 新 revision Snapshot |
| Planned | `DELETE` | `/trigger-bindings/{id}` | 停止未来触发 |
| Planned | `POST` | `/hooks/{bindingId}` | 经 binding-specific 校验的外部触发 |

Webhook payload 先存受控引用和触发证据，再创建 Run；不能把未校验 payload 直接
当 Workflow input 或 Event。

## 5. Workflow 控制与运行诊断

### 5.1 Definition Binding

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Convergence | `GET` | `/workflow-bindings` | 当前启用的 Definition version |
| Convergence | `PUT` | `/workflow-bindings/{workflowId}` | revision-protected version binding |
| Convergence | `DELETE` | `/workflow-bindings/{workflowId}` | 停用未来 Run，不改变历史 |

### 5.2 WorkflowRun

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Convergence | `GET` | `/workflow-runs` | 按 kind/status/ref/correlation/time 分页 |
| Convergence | `POST` | `/workflow-runs` | `202 WorkflowRunSnapshot` |
| Current | `GET` | `/workflow-runs/{id}` | 通用 Run Snapshot；当前路径为 `/runs/{id}` |
| Convergence | `POST` | `/workflow-runs/{id}/cancellations` | 级联取消 Command |
| Planned | `POST` | `/workflow-runs/{id}/reruns` | 新 Run，声明重用/失效策略 |
| Planned | `POST` | `/workflow-runs/{id}/resumptions` | 从安全等待/恢复点创建恢复 Command |
| Convergence | `POST` | `/workflow-runs/{id}/signals` | 写入版本化 Signal |
| Convergence | `GET` | `/workflow-runs/{id}/activities` | `Page<ActivitySnapshot>` |
| Convergence | `GET` | `/workflow-runs/{id}/steps` | 可选 UI projection |
| Convergence | `GET` | `/workflow-runs/{id}/jobs` | `Page<JobSnapshot>` |
| Convergence | `GET` | `/workflow-runs/{id}/events` | Run-scoped Event page |
| Convergence | `GET` | `/workflow-runs/{id}/usage` | budget/usage Snapshot |

`POST /workflow-runs` 输入只接受 catalog 中存在并启用的 `workflowRef`、合法 input、
correlation 和允许的预算覆盖。客户端不能伪造 definition snapshot、lease、Job
或 admission result。Run Snapshot 同时保存不可变 Trigger cause、原始触发输入
引用/指纹和映射后的 Workflow input；两者不能在执行时重新读取当前配置。

### 5.3 Activity、Job、Attempt 与 Receipt

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Convergence | `GET` | `/activities/{id}` | `ActivityDetail` |
| Current | `GET` | `/jobs/{id}` | `JobDetail` |
| Convergence | `GET` | `/jobs/{id}/attempts` | `Page<AttemptSnapshot>` |
| Convergence | `GET` | `/attempts/{id}` | 不含 lease token 的 AttemptDetail |
| Convergence | `GET` | `/jobs/{id}/receipts` | 外部副作用 Receipt 历史 |
| Planned | `POST` | `/jobs/{id}/retry-requests` | 用户请求重试；由 Policy 决定新 Attempt |

Product API 不提供 claim、renew、complete 或 fail Job 的写端点。那些操作只存在于
Cosmos Backend 或 Worker Gateway。

### 5.4 Worker discovery

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Current | `GET` | `/workflow-workers` | Worker discovery envelope |
| Planned | `GET` | `/workflow-workers/{id}` | registration/capability 投影，不含 token |

Worker discovery 是诊断，不是 assignment 或 Run owner。

## 6. 信息库

### 6.1 Observation

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/observations` | 来源、Run、时间、event kind 分页 |
| Planned | `GET` | `/observations/{id}` | `ObservationDetail` |
| Planned | `GET` | `/observations/{id}/payload` | 受控原始 payload/ValueRef |

Observation 不提供 PATCH。合法删除只能通过数据保留/删除计划，并保留允许的
tombstone/audit。

### 6.2 Entry 与 Revision

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Current | `GET` | `/entries` | `Page<EntrySummary>` |
| Current | `GET` | `/entries/{id}` | `EntryDetail` |
| Planned | `GET` | `/entries/{id}/revisions` | `Page<EntryRevisionSnapshot>` |
| Planned | `GET` | `/entries/{id}/observations` | provenance page |
| Planned | `GET` | `/entries/{id}/relations` | Entry 到 Story/Entity/Entry 关系 |
| Current | `GET` | `/entry-revisions/{id}` | 当前路径暂为 `/revisions/{id}` |

来源修订通过 Ingest Command 产生，不允许用户用普通 PATCH 改写 EntryRevision。
用户批注、标签和修正 Proposal 使用独立资源。

### 6.3 Asset、Blob 与文件

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Current | `GET` | `/assets/{id}` | 已保存内容流；支持 ETag/Range 的目标合同 |
| Planned | `GET` | `/assets/{id}/metadata` | `AssetSnapshot` |
| Planned | `POST` | `/assets/{id}/save-requests` | 尝试补存远端媒体 |
| Planned | `GET` | `/blobs/{ref}` | 只接受受控 capability/ref，不暴露 storage key |

## 7. Search、Feed 与用户交互

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Current | `GET` | `/search` | `LibrarySearchQuery` → `Page<SearchHitSnapshot>`；当前实现字段仍较少 |
| Current | `GET` | `/feed` | `FeedQuery` → `Page<FeedItemSnapshot>`；默认 Story Feed |
| Planned | `GET` | `/feeds/{surface}` | 指定 SavedView/Ranking Policy 的 Story Feed |
| Planned | `GET` | `/stories/{id}/related` | 相关但不同 Story，带解释 |
| Planned | `POST` | `/interactions` | impression/open/read/save/hide/not_interested 等 |
| Planned | `GET` | `/read-states` | 按 Story/surface 查询 |
| Planned | `PUT` | `/read-states/{storyId}` | 更新 last seen revision |

Feed 返回 Story，不把同一 Story 的多个 Entry 算成多次曝光。展开具体来源后才记录
Entry interaction。

## 8. Story、Topic、Entity 与关系

### 8.1 Story

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Current | `GET` | `/stories/{id}` | Phase 1 最小 StoryDetail |
| Planned | `GET` | `/stories` | kind/subtype/topic/entity/time 分页 |
| Planned | `GET` | `/stories/{id}/revisions` | Story Revision page |
| Planned | `POST` | `/stories/{id}/revision-proposals` | 人类/Agent 候选表示 |
| Planned | `GET` | `/stories/{id}/memberships` | Entry membership/current/history |
| Planned | `POST` | `/story-merge-commands` | canonical merge |
| Planned | `POST` | `/story-split-commands` | 历史壳 + successors |
| Planned | `POST` | `/story-membership-commands` | accept/reject/move/correct |
| Planned | `POST` | `/story-state-migration-previews` | merge/split 后用户状态与 Topic membership 影响预览 |
| Planned | `POST` | `/story-state-migration-commands` | 显式 apply/revert；保存 actor、依据和关联 Run |

merge/split 和 membership 修改要求 base revision、actor、reason 和 evidence。

### 8.2 Topic

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/topics` | Topic page |
| Planned | `POST` | `/topics` | Topic + initial revision |
| Planned | `GET` | `/topics/{id}` | TopicDetail |
| Planned | `PATCH` | `/topics/{id}` | 新 Topic Revision |
| Planned | `POST` | `/topics/{id}/archive-commands` | 明确人工归档；后置 |
| Planned | `GET` | `/topics/{id}/memberships` | 当前角色与历史 |
| Planned | `POST` | `/topic-membership-commands` | add/change/remove/propose_remove |
| Planned | `GET` | `/topics/{id}/relations` | typed Topic relations |
| Planned | `POST` | `/topic-relation-commands` | 不建立父子层级 |
| Planned | `GET` | `/topics/{id}/maintenance-binding` | 独立维护绑定 |
| Planned | `PUT` | `/topics/{id}/maintenance-binding` | 更新维护 Workflow/预算 |

### 8.3 Entity 与 Relationship

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/entities` | type/name/alias 查询 |
| Planned | `GET` | `/entities/{id}` | EntityDetail |
| Planned | `GET` | `/relationships` | target/type/evidence 查询 |
| Planned | `POST` | `/relationship-proposals` | 自动或人工关系候选 |
| Planned | `POST` | `/relationship-commands` | accept/reject/correct |

## 9. 用户真相：Label、Annotation、Collection、SavedView

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET/POST` | `/labels` | Label CRUD |
| Planned | `GET/PATCH/DELETE` | `/labels/{id}` | revision-protected |
| Planned | `GET/POST` | `/annotations` | 支持 ResourceRef/fragment |
| Planned | `GET/PATCH/DELETE` | `/annotations/{id}` | 不随派生刷新丢失 |
| Planned | `GET/POST` | `/collections` | Collection CRUD |
| Planned | `GET/PATCH/DELETE` | `/collections/{id}` | stable identity |
| Planned | `POST` | `/collection-membership-commands` | 显式成员变更 |
| Planned | `GET/POST` | `/saved-views` | 保存 Query/Feed 条件 |
| Planned | `GET/PATCH/DELETE` | `/saved-views/{id}` | revision-protected |

## 10. Knowledge、Proposal 与 Research

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/knowledge-signals` | target/kind/producer/status 分页 |
| Planned | `GET` | `/knowledge-signals/{id}` | 不可覆盖的判断 |
| Planned | `GET` | `/knowledge-signals/{id}/dispositions` | 接受、忽略、转研究等独立处理记录 |
| Planned | `POST` | `/knowledge-signals/{id}/dispositions` | 追加 disposition；不覆盖 Signal |
| Planned | `GET` | `/proposals` | Story/Topic/Relation/Workspace 候选 |
| Planned | `GET` | `/proposals/{id}` | evidence 和 producer |
| Planned | `POST` | `/proposals/{id}/decisions` | accept/reject/supersede |
| Planned | `GET` | `/research-requests` | status/priority/target 分页 |
| Planned | `POST` | `/research-requests` | `202 ResearchRequestSnapshot` |
| Planned | `GET` | `/research-requests/{id}` | 关联 Run、结果和错误 |
| Planned | `POST` | `/research-requests/{id}/cancellations` | 取消对应 Research Run |

KnowledgeSignal 不直接启动执行。ResearchRequest 经 Trigger/Workflow 执行；外部发现
重新进入统一 Ingest。`KnowledgeSignalDispositionSnapshot` 是独立追加记录，不把
KnowledgeSignal 改成可变任务状态。ResearchRequest 通过 `runRef` 连接 Trigger、
Activity/Action/Attempt、预算、失败恢复和结果 provenance，不在 Request 中复制
一份运行时 journal。

## 11. 知识管理者与 Agent 交互

知识管理者不是一个 Session，但 Web Chat/CLI 的每条对话仍需要稳定 conversation
和 Run 引用。

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Reserved | `GET` | `/knowledge-manager` | 角色、可用入口、共享 memory 状态摘要 |
| Planned | `POST` | `/agent-conversations` | 创建一个交互分身/conversation |
| Planned | `GET` | `/agent-conversations/{id}` | ConversationSnapshot |
| Planned | `GET` | `/agent-conversations/{id}/messages` | message page |
| Planned | `POST` | `/agent-conversations/{id}/messages` | `202` 创建 Agent Invocation Run |
| Planned | `POST` | `/agent-conversations/{id}/cancellations` | 取消当前 invocation |

对话中执行 GUI 等价操作仍调用普通 Product Command；Agent 不能获得 Prisma 或任意
内部路由旁路。具体 Session/Profile/Model DTO 等 Harness 文档稳定后再收口。

## 12. Workspace 与 Artifact

### 12.1 Workspace

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET/POST` | `/workspaces` | Workspace page/create |
| Planned | `GET/PATCH` | `/workspaces/{id}` | stable identity + config revision |
| Planned | `GET` | `/workspaces/{id}/revisions` | config/content revisions |
| Planned | `GET` | `/workspaces/{id}/input-bindings` | many-to-many inputs |
| Planned | `POST` | `/workspace-input-binding-commands` | add/change/remove |
| Planned | `GET` | `/workspaces/{id}/updates` | WorkspaceUpdate page |
| Planned | `POST` | `/workspaces/{id}/updates` | `202` 启动维护 Workflow |
| Planned | `POST` | `/workspace-updates/{id}/cancellations` | 取消但保留上次成功版本 |
| Planned | `GET/PUT` | `/workspaces/{id}/maintenance-binding` | Trigger/Workflow/预算/Agent 绑定 |
| Planned | `GET/PUT` | `/workspaces/{id}/interaction-state` | schema-versioned user progress |

### 12.2 Artifact

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/artifacts` | target/producer/workspace 分页 |
| Planned | `GET` | `/artifacts/{id}` | Artifact identity/current revision |
| Planned | `GET` | `/artifact-revisions/{id}` | immutable revision metadata |
| Planned | `GET` | `/artifact-revisions/{id}/manifest` | 文件清单、hash、provenance |
| Planned | `GET` | `/artifact-revisions/{id}/files/{path}` | 受控文件读取 |
| Planned | `POST` | `/artifact-revisions/{id}/render-capabilities` | 短期隔离渲染 capability |

Workspace Update 只有成功时原子切换 current Artifact/Workspace Revision。
HTML/交互 Artifact 默认只能在独立 origin、sandbox 和 CSP 下渲染，禁止访问宿主
DOM、文件系统、Secret、数据库和未声明网络。`executable: boolean` 不能替代
RenderProfile/SandboxPolicy；放宽能力保持 `Reserved`，需要单独审计。

## 13. Board 与 Spotlight

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET/POST` | `/boards` | Board page/create |
| Planned | `GET/PATCH` | `/boards/{id}` | revision-protected config |
| Planned | `GET` | `/boards/{id}/render` | 当前授权 Snapshot |
| Planned | `POST` | `/board-layout-commands` | Section/Block move/add/remove/configure |
| Planned | `GET` | `/spotlight-placements` | target/board/status |
| Planned | `POST` | `/spotlight-placement-commands` | pin/exclude/release |
| Planned | `GET` | `/spotlight-policies` | policy/version/config |
| Planned | `PUT` | `/spotlight-policies/{id}` | revision-protected |

删除 Board Block 不删除它引用的 Story、Workspace、Artifact 或 SavedView。

## 14. Publication、Subscription 与 Delivery

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/subscriptions` | Topic/Workspace/Publication subscription |
| Planned | `POST/PATCH/DELETE` | `/subscriptions...` | 独立于 Topic/Placement |
| Planned | `GET` | `/publications` | Publication page |
| Planned | `POST` | `/publications` | 冻结 Board/Query/Revision Snapshot |
| Planned | `GET` | `/publications/{id}` | immutable content refs |
| Planned | `GET` | `/publication-revisions/{id}` | 网页/图片/正文同一快照 |
| Planned | `POST` | `/publications/{id}/deliveries` | `202 DeliveryIntentSnapshot` |
| Planned | `GET` | `/delivery-intents/{id}` | Attempt/receipt/uncertain |
| Planned | `POST` | `/delivery-intents/{id}/retry-requests` | 受 policy 控制 |
| Planned | `POST` | `/delivery-intents/{id}/reconciliations` | 查询外部渠道收口 |

Subscription 保存 schedule/timezone/misfire policy、目标、Channel capability、
授权状态、优先级和用户规则。Publication/Delivery 只消费冻结的
PublicationRevision；每天 08:00 之类的调度不能只存在于 Worker 内存。

## 15. 存储、备份、导出、删除与完整性

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Planned | `GET` | `/storage/usage` | DB/Blob/Artifact/Cache/Log 分项 |
| Planned | `GET` | `/storage/roots` | 只返回逻辑类别和状态，不返回绝对路径 |
| Planned | `POST` | `/backups` | `202 BackupSnapshot` |
| Planned | `GET` | `/backups/{id}` | 内容范围、hash、状态 |
| Planned | `POST` | `/restores` | 独立高风险恢复计划 |
| Planned | `POST` | `/exports` | `202 ExportSnapshot` |
| Planned | `GET` | `/exports/{id}` | 下载能力和保留时间 |
| Planned | `POST` | `/deletion-plans` | 先生成影响预览 |
| Planned | `GET` | `/deletion-plans/{id}` | 引用、不可恢复项、预计回收 |
| Planned | `POST` | `/deletion-plans/{id}/executions` | 显式确认后执行 |
| Planned | `POST` | `/cleanup-runs` | Cache/Blob GC/retention maintenance |
| Planned | `GET` | `/integrity-reports` | orphan、引用和 Runtime 一致性 |
| Planned | `POST` | `/integrity-audits` | `202` 只读审计 Run |
| Planned | `GET` | `/migration-status` | schema compatibility |

restore、delete 和 repair 不由普通 PATCH 表达，必须有预览、幂等、Run、审计和失败
恢复。备份清单必须明确数据库、Observation payload、Blob、Artifact、用户真相、
日志/缓存和 Secret 的包含/排除规则；恢复顺序和版本兼容不能从文件夹拷贝隐式推断。

## 16. Event Stream

| 成熟度 | Method | Path | 结果 |
| --- | --- | --- | --- |
| Current | `GET` | `/events` | SSE，支持 `Last-Event-ID`/`after` |

Event 类型至少覆盖：

- Source/Connection/CollectionPlan 状态；
- Workflow Run/Activity/Job/Attempt/Receipt；
- Observation/Entry/Story/Topic/Knowledge/Research；
- Feed/Spotlight/Workspace/Artifact/Board；
- Publication/Delivery；
- storage/integrity/backup/export；
- `snapshot_required.v1`。

高频 progress 可以压缩或采样，但终态和外部副作用不能只存在于易丢失的 transient
stream。

## 17. 当前路径迁移

当前分支尚未发布稳定 v1，建议在实现前直接收敛：

| 当前路径 | 规范路径 |
| --- | --- |
| `/api/v1/connectors` | `/api/v1/source-definitions` |
| `/api/v1/sources/{id}/test` | `/api/v1/sources/{id}/probes` |
| `/api/v1/runs/{id}` | `/api/v1/workflow-runs/{id}` |
| `/api/v1/revisions/{id}` | `/api/v1/entry-revisions/{id}` |

如果在迁移前已经出现外部消费者，再通过有限期限 alias 和 deprecation Header
迁移；目前不为未发布路径永久维护两份 canonical route。
