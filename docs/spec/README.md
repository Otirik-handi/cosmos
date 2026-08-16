# Cosmos 已实现规格索引

> **唯一实现基线：** `5ce628690ab0110b0525e8ebcbacbe673ced9c55`（已合入 `master`）。
> 本索引以及将由本轮创建的组件规格，只能把该提交中实际存在、可从外部观察或为重建所必需的行为标为
> `Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`。
>
> 本文件是**规格索引**，不是任何一个组件的完整规格。下表列出的 29 个组件正文均已写入；表格状态使用
> `Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`，不再使用“待本轮文档收口”的状态。
> 每个组件正文仍以 `Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55` 记录实现基线。

## 1. 职责、事实来源与状态规则

### 1.1 spec 负责什么

`docs/spec/` 只回答一个问题：陌生 Agent 能否依据已合入实现，重建一个组件对外可观察的
职责、输入、输出、状态、持久化、副作用、错误/降级、依赖、配置和可判定验收。每个组件正文只写
一个组件；跨组件语义只在唯一 canonical owner 定义，其他正文链接引用。

规格正文不得把以下内容推断成当前能力：

- 需求、PRD、架构图或 ADR 中尚未进入 `5ce6286` 的目标设计；
- `Draft`、`Planned`、`Reserved` API、Gateway、远程 Worker、Redis、PostgreSQL/S3、多主机；
- 历史 Task 04 Spike、dirty worktree、保护区分支、旧草稿或没有在本基线重新验证的实现；
- 只存在于测试替身、fixture 或构建产物中的额外行为。

代码标识首次出现时写成“中文名（`CodeIdentifier`）”。自然语言先描述外部行为；源码符号、表名、
内部算法只在重建需要时作为锚点。每个已实现状态统一写：

`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`

未实现或未验证的内容必须单独放在“非目标/未验证边界”，不得混进组件的已实现合同。

### 1.2 文档体系的职责分工

| 文档 | 真相范围 | 不能替代什么 |
| --- | --- | --- |
| `docs/requirements/` | 用户想要什么、原话、产品阶段和验收意图 | 不能证明代码已实现 |
| `docs/architecture/` | 系统分层、设计方向、跨模块取舍和演进边界 | 不能替代当前组件输入/错误/状态合同 |
| `docs/adr/` | 已接受且改回成本高的架构决定 | 不能把未来决定升级成实现证据 |
| `docs/api/` | Product API、Worker Admin、Gateway、DTO 的目标草案和 conformance 场景 | Draft 字段/路径不是当前 API |
| `docs/tasks/` | 实施过程、决定、偏差、验证记录和后续工作 | Task 叙述不是组件运行时合同 |
| `docs/spec/` | 已合入实现的组件外部行为及可重建验收 | 不拥有新需求、不设计未来 API、不记录实施日记 |

相关入口：[`docs/README.md`](../README.md)、[`docs/api/README.md`](../api/README.md)、
[`docs/tasks/07-deferred-workflow-host/README.md`](../tasks/07-deferred-workflow-host/README.md)、
[`docs/architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md)、
[`docs/adr/0002-nb-workflow-kernel-cosmos-host.md`](../adr/0002-nb-workflow-kernel-cosmos-host.md) 和
[`docs/adr/0003-service-worker-api-boundaries.md`](../adr/0003-service-worker-api-boundaries.md)。

### 1.3 对陌生 Agent 的阅读顺序

1. 本索引：先确定基线、术语 owner、组件路径、覆盖表和未验证边界。
2. [`contracts/0001-public-contracts.md`](contracts/0001-public-contracts.md)：读取共享 DTO、Zod
   输入边界、状态枚举、Action 引用和可序列化投影。
3. 读取需求/架构/ADR 中与当前任务直接相关的背景，不把它们当实现证据。
4. 读取目标组件 spec；沿术语表链接只进入 canonical owner，不复制定义。
5. 反查“实现与测试锚点”中的源码区间和测试文件，确认行为与实现基线一致。
6. 按“重建验收”逐项执行；若验收超出本索引列出的证据或落入未验证边界，标记未验证而不是放宽
   合同。

### 1.4 从规格重建的方法

先画组件边界，再按“输入 → 状态/持久化 → 外部副作用 → 输出/错误”的顺序实现。对每个输入：

- 在边界立即把 `unknown` 校验成共享合同；不得用内部对象直接当公共 DTO。
- 记录默认值、空值、版本、幂等键、游标、lease/fence 和时间语义；这些跨组件约束不能靠调用者猜。
- 先实现正常路径，再实现可观察失败、重试/降级、旧 owner 拒写和幂等重放。
- 持久状态只由其 owner 写入；通知、SSE、日志和内存索引不能成为第二份 durable truth。
- 任何公开投影都应使用白名单；当前基线的 API/存储投影已排除 lease token、Secret 和绝对路径，但 Asset snapshot 仍可能包含 `storageKey`（见第 4 节事实说明），因此“公开投影不得含 storageKey”是尚未满足的安全目标，不得写成当前实现事实。
- 测试锚点验证行为边界，不用源码字符串匹配代替合同；未有测试的行为必须在规格中明确验收办法。

### 1.5 统一组件模板

每个组件文件必须按以下标题完整书写，标题不能因组件“简单”而省略：

1. `组件定位`：单一职责、消费者、与相邻组件的边界、实现状态。
2. `概念与定义`：只定义本组件拥有的概念；共享概念链接 canonical owner。
3. `外部行为`：按正常调用顺序描述可观察效果，不逐函数复述实现。
4. `输入`：类型/字段、版本、默认值、空值、校验、幂等和前置条件。
5. `输出`：成功投影、顺序、游标、事件或下载结果；公共输出是可序列化白名单。
6. `状态与持久化`：状态集合、权威存储、生命周期、恢复；无状态组件必须明写“无持久状态”。
7. `状态转换`：每个合法转换、触发条件、不可逆终态和旧 owner 行为。
8. `副作用`：数据库、Blob、外部网络、领域事件、日志和进程资源；说明事务/幂等边界。
9. `错误与降级`：可分类错误、HTTP/异常映射、重试 allow-list、降级和 fail-closed 条件。
10. `依赖`：端口/合同/实现依赖，说明谁拥有 durable truth。
11. `配置`：环境变量、默认值、范围、路径 containment、启动守卫和安全边界。
12. `重建验收`：每一条必须是可判定条件，例如“给定 X，观察到 Y，且 Z 不发生”。
13. `实现与测试锚点`：生产源码的文件和符号/行为区间，以及对应测试；测试不纳入生产覆盖表。

无持久状态的 Registry、Catalog、Transport 适配器、组合根等，仍须在第 6 节写出“无持久状态”，并说明
进程重启后哪些值由配置/manifest重新生成。

## 2. 术语注册表（唯一 canonical owner）

以下定义是导航性短释义，不是第二套合同；细节、字段、状态转换和例外只在链接的 owner spec
中维护。后续组件正文引用术语时必须链接这里的 owner，不能复制一份不同定义。

| 术语 | 导航性短释义 | canonical owner |
| --- | --- | --- |
| Source | 可被采集的来源实例及其执行快照；`kind` 指向 Connector 家族 | [`contracts/0001-public-contracts.md`](contracts/0001-public-contracts.md) |
| Connector | 针对 Source kind 的 validate/fetch 能力边界 | [`application/0001-connector-runtime.md`](application/0001-connector-runtime.md) |
| Trigger | 产生 Workflow 入队请求的触发类型；当前 ingest 有 manual/schedule | [`application/0005-ingest-workflow-control.md`](application/0005-ingest-workflow-control.md) |
| Workflow Definition | 带版本和 manifest hash 的可执行 Workflow 合同 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Workflow Run | 某 Definition 对一份不可变输入快照的一次 durable 执行 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Kernel | `@notnotype/nb-workflow` 负责脚本、Activity identity、journal replay、waiting/resume 的规范执行内核 | [`application/0008-workflow-host-runtime.md`](application/0008-workflow-host-runtime.md) |
| Durable Host | 将 Kernel、SQL TaskStore、Action、ValueStore、EventSink 和领域端口接成可恢复执行边界的 Cosmos 宿主 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Action | 带版本 ref、schema、placement 和 retry policy 的一次可调用能力 | [`application/0003-action-registry.md`](application/0003-action-registry.md) |
| Activity | Workflow journal 中一次需要稳定 identity、结果或恢复的交互 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Job | Host 为一个 Activity 创建、可被 worker claim 的 durable 任务 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Attempt | Worker 对 Job 的一次实际执行；拥有 lease 和 fencing 身份 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Lease | 有 owner、token、过期时间的有限执行权；不是公共 payload | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Fencing | 以 owner/token/revision/expiry 原子拒绝旧执行者写入的保护规则 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Completion | Activity 结果的 durable、单消费者投递记录 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Envelope | 保存 Run identity、Definition、idempotency、输入快照和产品投影的 Host 外壳 | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) |
| Checkpoint | Source 游标及其 revision 的 CAS 进度记录 | [`application/0006-ingest-workflow.md`](application/0006-ingest-workflow.md) |
| Observation | 外部来源捕获的不可变证据及其 provenance | [`domain/0001-normalized-content.md`](domain/0001-normalized-content.md) |
| Entry | 由稳定 external key 归并的本地内容身份 | [`domain/0001-normalized-content.md`](domain/0001-normalized-content.md) |
| Entry Revision | Entry 内容变更的追加式、带 fingerprint 的修订 | [`domain/0001-normalized-content.md`](domain/0001-normalized-content.md) |
| Asset | 与 Entry Revision 关联的媒体/附件及其保存状态 | [`domain/0001-normalized-content.md`](domain/0001-normalized-content.md) |
| Story | 当前实现中的最小 Entry 上层内容投影 | [`domain/0001-normalized-content.md`](domain/0001-normalized-content.md) |
| Blob | 受控 Blob Root 中按内容寻址保存的字节 | [`storage/0005-file-blob-store.md`](storage/0005-file-blob-store.md) |
| BlobRef | Workflow JSON 中的 strict 内容引用；contracts 唯一拥有 JSON wire shape，FileBlobStore 负责实际 bytes 的 SHA-256/hash 和 Blob Root containment verification | [`contracts/0001-public-contracts.md`](contracts/0001-public-contracts.md) |
| ValueRef | 与 BlobRef 不同：只引用外置的 JSON Workflow value（固定 `application/json`），由 ValueStore 负责 canonical JSON 与四重完整性读取，不代表媒体 bytes | [`storage/0006-workflow-value-store.md`](storage/0006-workflow-value-store.md) |
| Domain Event | 具备 type/version/payload/idempotency 的持久领域事件 | [`storage/0004-workflow-event-sink.md`](storage/0004-workflow-event-sink.md) |
| AttemptSnapshot | `WorkflowAttemptSnapshot` 的 Attempt 公开投影；由 Host 的 DomainEvent 生命周期重建，不是独立 Attempt 表 | [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) |
| CatalogPage | Product API 当前使用的 `{ items, nextCursor, snapshotAt }` 页面包装；不是独立 contracts DTO | [`interfaces/0002-product-api-http.md`](interfaces/0002-product-api-http.md)（组件正文 owner） |
| CapabilitiesResponse | `GET /capabilities` 当前 Controller 内联生成的能力/限制/时间投影；不是独立 contracts DTO | [`interfaces/0002-product-api-http.md`](interfaces/0002-product-api-http.md)（组件正文 owner） |
| IngestConnector | Application 的 validate/fetch 连接器端口；不直接拥有领域持久化 | [`application/0001-connector-runtime.md`](application/0001-connector-runtime.md) |
| WorkflowBlobStore | Ingest Workflow 把领域 bytes 转为 JSON BlobRef，并提供 verified read 所需的 Blob 端口 | [`application/0006-ingest-workflow.md`](application/0006-ingest-workflow.md)（组件正文 owner） |
| WorkflowIngestDomainPort | Ingest Workflow 向领域/仓储提交 item 与 checkpoint 的 fence/idempotency 端口 | [`application/0006-ingest-workflow.md`](application/0006-ingest-workflow.md)（组件正文 owner） |

| SSE | 带 event id、协议版本、replay cursor 和 snapshot_required 语义的 Server-Sent Events | [`interfaces/0002-product-api-http.md`](interfaces/0002-product-api-http.md) |
| Product API | 面向产品客户端的 Command、Query、Run 控制、查询和 SSE HTTP 面 | [`interfaces/0002-product-api-http.md`](interfaces/0002-product-api-http.md) |
| Worker Admin | Worker 的 loopback 运维面：liveness/readiness/status/capability/metrics/drain | [`runtime/0003-worker-admin.md`](runtime/0003-worker-admin.md) |
| Drain | 停止新 poll、等待已登记资源并按 deadline 给出终态的运维操作 | [`runtime/0003-worker-admin.md`](runtime/0003-worker-admin.md) |
| Manifest | 不含 executable 的可序列化 Definition/Action/Source 描述及稳定 hash | [`application/0004-manifest-catalog.md`](application/0004-manifest-catalog.md) |
| Capability | Manifest/Worker 可公开声明的能力布尔值或 capability 名称 | [`application/0004-manifest-catalog.md`](application/0004-manifest-catalog.md) |
### 2.1 Wire shape 与 semantic owner 分工

- **Wire shape owner：** [`@cosmos/contracts` 公共合同](contracts/0001-public-contracts.md) 负责跨 HTTP、Workflow JSON、事件和 manifest 边界的 Zod schema、字段/版本/JSON-safe 约束。`BlobRef` 的 JSON 形状由此唯一拥有；`ValueRef` 是另一种 JSON value 引用，不能与媒体 BlobRef 混用。
- **Domain semantic owner：** [`@cosmos/domain` 规范化内容](domain/0001-normalized-content.md) 负责 NormalizedIngestItem 的领域含义、Publisher/Temporal 语义、external key、revision fingerprint 和 Story projection。contracts 只规定这些对象过边界时的 wire shape，不拥有上述算法或业务语义。
- **Application mapping owner：** Connector/Workflow application spec 负责从 Connector/domain runtime 值映射到 contracts wire shape；其中 `WorkflowBlobStore` 将 `Uint8Array` 外置为 BlobRef，`WorkflowIngestDomainPort` 把带 fence/idempotency 的结果交给 durable owner。
- **Storage owner：** Prisma/Blob Store specs 负责 durable bytes、SQL 事实和投影读取；它们不得反向产生第二套公共 DTO 定义。`CatalogPage`、`CapabilitiesResponse` 和 `AttemptSnapshot` 是组件正文 owner 的局部投影名，不是未链接的新 contracts 定义。

## 3. 组件规格路径与文档状态

下表是本轮固定的 29 个组件路径；29 个组件正文均已存在。每行同时记录文档状态和实现基线：
`Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55` 表示正文已写入，`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55` 表示代码实现基线；二者均不表示未来 Draft 或 Reserved 能力。
组件正文写完后，索引只保留此路径和 owner 指针，不在此复制组件专有状态机。

### 3.1 contracts / domain

| 路径 | 组件 | 文档状态 |
| --- | --- | --- |
| [`contracts/0001-public-contracts.md`](contracts/0001-public-contracts.md) | `@cosmos/contracts`：公共 DTO、Zod 边界、Action/Blob/ValueRef 合同 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`domain/0001-normalized-content.md`](domain/0001-normalized-content.md) | `@cosmos/domain`：NormalizedIngestItem、Observation/Entry/Story 语义 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |

### 3.2 application

| 路径 | 组件 | 文档状态 |
| --- | --- | --- |
| [`application/0001-connector-runtime.md`](application/0001-connector-runtime.md) | ConnectorRegistry、ConnectorProbeService、IngestionService | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`application/0002-legacy-ingestion-worker.md`](application/0002-legacy-ingestion-worker.md) | 保留的 IngestionWorker rollback/probe lane | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`application/0003-action-registry.md`](application/0003-action-registry.md) | ActionRegistry 与 HostActionExecutionFence | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`application/0004-manifest-catalog.md`](application/0004-manifest-catalog.md) | StaticCatalog 与 builtin manifest catalog | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`application/0005-ingest-workflow-control.md`](application/0005-ingest-workflow-control.md) | IngestWorkflowControlService 与 enqueue 快照 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`application/0006-ingest-workflow.md`](application/0006-ingest-workflow.md) | 固定 `cosmos.ingest@1` 及三个 Action | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) | WorkflowHostStore/Run/Activity/Completion ports | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`application/0008-workflow-host-runtime.md`](application/0008-workflow-host-runtime.md) | Run lane、Activity worker、Completion dispatcher | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |

### 3.3 storage

| 路径 | 组件 | 文档状态 |
| --- | --- | --- |
| [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | PrismaCosmosRepository 与 SQLite 领域/旧 Job 持久化 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`storage/0002-workflow-backend.md`](storage/0002-workflow-backend.md) | PrismaWorkflowBackend 与 Kernel state CAS | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) | PrismaWorkflowHostStore 与双 lease 状态转移 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`storage/0004-workflow-event-sink.md`](storage/0004-workflow-event-sink.md) | PrismaWorkflowEventSink 与 event fencing/idempotency | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`storage/0005-file-blob-store.md`](storage/0005-file-blob-store.md) | FileBlobStore、BlobRef 校验与 Blob Root containment | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`storage/0006-workflow-value-store.md`](storage/0006-workflow-value-store.md) | BlobWorkflowValueStore 与 ValueRef 四重校验 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |

### 3.4 interfaces

| 路径 | 组件 | 文档状态 |
| --- | --- | --- |
| [`interfaces/0001-product-api-runtime.md`](interfaces/0001-product-api-runtime.md) | Nest API 入口、组合根、health/readiness、生命周期 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`interfaces/0002-product-api-http.md`](interfaces/0002-product-api-http.md) | AppController 当前 Product API HTTP/SSE 投影 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`interfaces/0003-api-observability.md`](interfaces/0003-api-observability.md) | request context、request id、日志 interceptor、异常 filter | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`interfaces/0004-http-client.md`](interfaces/0004-http-client.md) | HttpCosmosClient 与 CosmosTransportError | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | 当前 Phase 1 Next Web 与 UI primitives | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |

### 3.5 runtime

| 路径 | 组件 | 文档状态 |
| --- | --- | --- |
| [`runtime/0001-worker-process.md`](runtime/0001-worker-process.md) | Worker 进程、四条 poll lane、heartbeat、shutdown | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`runtime/0002-workflow-host-composition.md`](runtime/0002-workflow-host-composition.md) | createWorkflowHost 组合根 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`runtime/0003-worker-admin.md`](runtime/0003-worker-admin.md) | WorkerAdminService 与 loopback HTTP server | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`runtime/0004-structured-logging.md`](runtime/0004-structured-logging.md) | `@cosmos/logging` `log.v1` 与脱敏/轮转 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |

### 3.6 connectors / operations

| 路径 | 组件 | 文档状态 |
| --- | --- | --- |
| [`connectors/0001-rss.md`](connectors/0001-rss.md) | RSS、fixture RSS、sequence fixture Connector | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`connectors/0002-managed-collectors.md`](connectors/0002-managed-collectors.md) | Bilibili/OpenCLI、AI HOT builtin Connectors | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`operations/0001-deployment.md`](operations/0001-deployment.md) | Dockerfile、Compose、api/web/worker 部署 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |
| [`operations/0002-development-runtime.md`](operations/0002-development-runtime.md) | dev/prisma 脚本与 smoke 重建入口 | Documented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55; Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55 |

## 4. 跨组件重建约束

这些是从基线源码和测试抽出的、重建时不能遗漏的语义；字段和完整错误分类仍由组件 owner
spec 负责。

- **固定 Workflow：** 入队创建 `cosmos.ingest@1` 的 Definition、Source execution snapshot、
  checkpoint cursor/revision、triggerKind 和 idempotency key；执行顺序是
  `source.fetch@1 → library.ingest@1[] → source.checkpoint@1`。排队后修改 Source 不改变既有
  Run 的 fetch 输入；相同 idempotency key 必须复用相同快照，冲突必须拒绝。
- **Host 权威：** Kernel 只拥有脚本/journal 语义；SQL TaskStore 拥有 Run/Job/lease/retry/Completion
  状态。Wakeup、HTTP 连接、内存 Registry、SSE 和日志都不能另立终态。
- **双 fencing：** 写领域数据或 Domain Event 前同时验证 Workflow Run lease、Activity Job lease
  和所需 kernel revision；token 仅用于内部校验，不能进入 Job payload、Kernel state、Manifest、
  Product API 或 Worker Admin 投影。旧 owner 的 heartbeat/complete/write 必须 fail closed。
- **幂等与 at-least-once：** Envelope、Activity、Completion、Observation、Domain Event 和外部
  Action 都以显式 idempotency key/receipt 或 CAS 处理重复；不能宣称 exactly-once。
- **Projection：** Product Run 将内部 `waiting` 映射为公开 `running`，`completed` 映射为公开
  `succeeded`；Source 公开配置仍由 Controller 白名单化，但当前基线的 Asset snapshot 事实不同：`AssetSnapshot` schema 包含可空
  `storageKey`，`PrismaCosmosRepository.toAssetSnapshot` 直接复制它，Feed/Entry/Revision 等查询投影和当前 AppController 响应未将其移除。
  因此当前实现**可能返回 `storageKey`**；“公开 Asset 投影不得含 `storageKey`”的安全目标在本基线**未满足/验收失败**，后续代码修复前不得把它写成已实现约束。
  其余 lease token、Secret、绝对路径和任意 payload 的边界仍以对应组件正文与实际投影为准，不因该未满足项被掩盖或扩大。
  该事实来自 [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts)、[`packages/storage-prisma/src/index.ts`](../../packages/storage-prisma/src/index.ts) 和 [`apps/api/src/app.controller.ts`](../../apps/api/src/app.controller.ts)。
- **Blob/Value：** Blob Root 和 Data Root 必须 containment；Blob key 为 SHA-256 内容寻址。Workflow
  Value 使用 canonical JSON 和 `application/json`，读取时同时验证 key、hash、byteSize、mediaType，
  再返回 structured clone。
- **默认运行路径：** Worker 默认启用 Durable Host；只有显式
  `COSMOS_WORKFLOW_HOST_ENABLED=false` 才回退 legacy path。空 definitions 或 actions 的 Host 组合
  必须拒绝启动，不能以“空目录”伪装成功。
- **本地默认值：** `COSMOS_DATA_ROOT` 默认 `.cosmos`，Blob Root 默认 `.cosmos/blobs`；API 默认
  `127.0.0.1:4310`，Worker Admin 默认 `127.0.0.1:9091`；Worker poll 默认 30,000 ms、lease 默认
  120,000 ms。环境覆盖、取值范围和安全约束由相应组件 spec 详述。
- **Catalog 边界：** Product API 只读取 manifest、schema 和 capability；executable Action/Connector
  由 Worker 执行面加载。Source probe 可校验 manifest 与 config，但不能因为 probe 改写领域数据。
- **日志边界：** `log.v1` 结构化记录传递 request/run/job/activity context；Secret、token、query、
  payload、正文和外部输出必须脱敏/截断。日志不是 Domain Event，也不是业务账本。
- **Migration 顺序：** 当前 SQLite 基线按 `20260808003247_phase1_foundation`、
  `20260808150000_collector_jobs`、`20260810020829_normalized_content_model`、
  `20260813160000_workflow_run_backend`、`20260814090000_workflow_activity_host`、
  `20260815090000_workflow_ingest` 顺序应用；组件 spec 只说明其拥有的模型和转移，不复制完整 SQL。
### 4.1 当前公开投影安全验收事实

当前基线的可判定结果是：对 Feed、Entry、Revision 及其 Asset snapshot 的代码路径检查，可观察到 `storageKey` 字段仍由 contracts schema 定义、由 repository mapper 填充，并可能经 API 直接返回；因此 storageKey omission 这一安全验收项为**未满足**。这不是对未来修复的设计声明，也不把其余未验证边界（Docker、browser/e2e、真实来源、跨进程 recovery 等）改写成已验证。

## 5. 生产源码覆盖表

### 5.1 口径与重复归属规则

本表按实际目录枚举建立，覆盖 `apps/**`、`packages/**`、`plugins/**` 中的非测试生产代码、
Web 运行配置/静态资源，以及 Docker、Prisma schema/migrations、`scripts/` 运行脚本。以下不计入
生产源码覆盖：`*.test.ts`/`*.spec.ts`、`package.json`、`tsconfig*.json`、锁文件、`node_modules/`
和构建生成物；测试文件单列在第 6 节。Web 的 UI primitive 是 Web Client 的实现细节，不单独新建
组件规格。

一个文件只有在确实承载多个职责时才拆成“不重叠的符号/行为区间”。当前已解释的多职责文件是
`packages/application/src/index.ts`、`packages/storage-prisma/src/index.ts`、
`packages/blob-store/src/index.ts`、`apps/api/src/*` 和 `schema.prisma`/多职责 migration；
同一行列出的区间彼此不重叠。`re-export` 只算导出 wiring，不重新拥有被导出的行为。

### 5.2 apps/**

| 文件 + 导出符号/行为区间 | 唯一归属 spec | 覆盖说明 |
| --- | --- | --- |
| `apps/api/src/app.module.ts`：`cosmosLogger`、`cosmosRepository`、`cosmosCatalog`、`cosmosWorkflowStore`、`cosmosIngestControl`、`AppModule` 组合 | [`interfaces/0001-product-api-runtime.md`](interfaces/0001-product-api-runtime.md) | API 组合根和依赖注入，不重复拥有 Repository/Store 实现 |
| `apps/api/src/main.ts`：`bootstrap`、`/healthz`/`/readyz` 探针、全局 prefix/CORS、SIGINT/SIGTERM | [`interfaces/0001-product-api-runtime.md`](interfaces/0001-product-api-runtime.md) | 进程启动和关闭边界 |
| `apps/api/src/app.controller.ts`：`AppController` 及 `toPublic*`/catalog、Source、Probe、Run、Feed/Search、Story/Entry/Revision、Asset、SSE 行为 | [`interfaces/0002-product-api-http.md`](interfaces/0002-product-api-http.md) | Controller 的 HTTP/SSE 外部合同；不把 Draft 路由纳入 |
| `apps/api/src/source-probe.service.ts`：`SourceProbeService.list/validate` | [`interfaces/0001-product-api-runtime.md`](interfaces/0001-product-api-runtime.md) | Product API 的只读 manifest/config probe |
| `apps/api/src/request-logging.ts`：`requestContextMiddleware`、`createRequestId`、`RequestLoggingInterceptor`、`RequestExceptionFilter` | [`interfaces/0003-api-observability.md`](interfaces/0003-api-observability.md) | request id、错误 DTO、脱敏和 headers-sent 行为 |
| `apps/worker/src/main.ts`：环境读取、`heartbeat`、scheduled enqueue、`bootstrap`、poll/shutdown、Admin 装配 | [`runtime/0001-worker-process.md`](runtime/0001-worker-process.md) | Worker 四 lane 和生命周期；Host 具体组合另见下一行 |
| `apps/worker/src/workflow-host.ts`：`WorkflowHostCompositionOptions`、`WorkflowHostComposition`、`createWorkflowHost` | [`runtime/0002-workflow-host-composition.md`](runtime/0002-workflow-host-composition.md) | Backend/Store/ValueStore/EventSink/Registry/lane 组合根 |
| `apps/web/src/app/page.tsx`：`Home`、Feed/Source/Run/Search/Story 交互和加载/错误状态 | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | 当前 Phase 1 Web 外部行为 |
| `apps/web/src/app/layout.tsx`：`metadata`、`RootLayout` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | Web 根布局；无独立 durable 状态 |
| `apps/web/src/app/globals.css`：Web 全局样式变量和布局样式 | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 实现细节，不升格为领域合同 |
| `apps/web/src/instrumentation.ts`：`register`、`onRequestError`、Web logger 初始化 | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | Web 运行错误可观察性 |
| `apps/web/src/lib/utils.ts`：`cn` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | Web UI 工具，无持久状态 |
| `apps/web/next.config.ts`、`apps/web/postcss.config.mjs`、`apps/web/eslint.config.mjs`、`apps/web/next-env.d.ts`：Web 构建/运行配置与 Next 类型声明 | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | 配置影响 Web 运行边界；类型声明不构成产品能力 |
| `apps/web/public/file.svg`、`apps/web/public/globe.svg`、`apps/web/public/next.svg`、`apps/web/public/vercel.svg`、`apps/web/public/window.svg`、`apps/web/src/app/favicon.ico`：静态资源 | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | 展示资源；无独立状态/副作用 |
| `apps/web/src/components/ui/badge.tsx`：`Badge`、`badgeVariants` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 原子组件；不拆成额外 spec |
| `apps/web/src/components/ui/button.tsx`：`Button`、`buttonVariants` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 原子组件；不拆成额外 spec |
| `apps/web/src/components/ui/card.tsx`：Card primitives | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 原子组件；不拆成额外 spec |
| `apps/web/src/components/ui/field.tsx`：Field primitives | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 原子组件；不拆成额外 spec |
| `apps/web/src/components/ui/input.tsx`：`Input` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 原子组件；不拆成额外 spec |
| `apps/web/src/components/ui/label.tsx`：`Label` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 原子组件；不拆成额外 spec |
| `apps/web/src/components/ui/separator.tsx`：`Separator` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 原子组件；不拆成额外 spec |
| `apps/web/src/components/ui/textarea.tsx`：`Textarea` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) | UI 原子组件；不拆成额外 spec |

### 5.3 packages/**

| 文件 + 导出符号/行为区间 | 唯一归属 spec | 覆盖说明 |
| --- | --- | --- |
| `packages/contracts/src/base.ts`：协议版本、Content/Publisher/Temporal/Source config、Source/Entry 输入 schema | [`contracts/0001-public-contracts.md`](contracts/0001-public-contracts.md) | 公共 Zod 边界 |
| `packages/contracts/src/action.ts`：`actionRefSchema`、`ActionDefinition/Descriptor`、placement、retry/error schema | [`contracts/0001-public-contracts.md`](contracts/0001-public-contracts.md) | Action 公共可序列化合同；执行注册由 application owner 负责 |
| `packages/contracts/src/index.ts`：Connector/Run/Step/Job/Asset/Health/Error/Feed/Search/Story/Entry/Revision/Ingest/SSE schemas 与 base/action re-export | [`contracts/0001-public-contracts.md`](contracts/0001-public-contracts.md) | 全部公共 DTO；re-export 不重复拥有实现 |
| `packages/domain/src/index.ts`：NormalizedIngestItem、Publisher、TemporalValue、ContentMetrics、`deriveExternalKey`、`fingerprintEntryRevision`、`projectEntryToStory` | [`domain/0001-normalized-content.md`](domain/0001-normalized-content.md) | 领域规范化和稳定身份 |
| `packages/application/src/action.ts`：`ActionExecutionContext`、`HostActionExecutionFence`、`RegisteredAction`、`ActionRegistry`、`ActionExecutionError` | [`application/0003-action-registry.md`](application/0003-action-registry.md) | 进程内 schema/placement/handler dispatch；无持久状态 |
| `packages/application/src/catalog.ts`：manifest interfaces、`CatalogPort`、`StaticCatalog`、`createBuiltinManifestCatalog` | [`application/0004-manifest-catalog.md`](application/0004-manifest-catalog.md) | manifest hash、排序/查找/capability；无持久状态 |
| `packages/application/src/workflow-control.ts`：`IngestWorkflowControlService`、input snapshot、`enqueue` | [`application/0005-ingest-workflow-control.md`](application/0005-ingest-workflow-control.md) | 入队幂等、Source/checkpoint snapshot |
| `packages/application/src/workflow-ingest.ts`：`cosmos.ingest@1`、三个 Action ref/manifest、definition、`createIngestActions`、connector error mapping | [`application/0006-ingest-workflow.md`](application/0006-ingest-workflow.md) | 固定 Workflow 的 Action 行为和领域副作用 |
| `packages/application/src/workflow-host.ts`：WorkflowRun/Job/Completion status、Envelope、Run lease、Activity job/completion ports、Host errors | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) | Durable Host 持久边界，不描述 Prisma 细节 |
| `packages/application/src/workflow-host-runtime.ts`：`FixedRunIdGenerator`、`WorkflowRunLane`、`WorkflowActivityWorker`、`WorkflowCompletionDispatcher`、heartbeat/lease handling | [`application/0008-workflow-host-runtime.md`](application/0008-workflow-host-runtime.md) | 三 lane 调度、Kernel resume/retry/error |
| `packages/application/src/index.ts:24`：`export * from "./action.js"` wiring | [`application/0003-action-registry.md`](application/0003-action-registry.md) | 仅导出 wiring，不重新拥有 Action 行为 |
| `packages/application/src/index.ts:25`：`export * from "./catalog.js"` wiring | [`application/0004-manifest-catalog.md`](application/0004-manifest-catalog.md) | 仅导出 wiring，不重新拥有 Catalog 行为 |
| `packages/application/src/index.ts:26`：`export * from "./workflow-host.js"` wiring | [`application/0007-workflow-host-contract.md`](application/0007-workflow-host-contract.md) | 仅导出 wiring，不重新拥有 Host contract 行为 |
| `packages/application/src/index.ts:27`：`export * from "./workflow-host-runtime.js"` wiring | [`application/0008-workflow-host-runtime.md`](application/0008-workflow-host-runtime.md) | 仅导出 wiring，不重新拥有 lane 行为 |
| `packages/application/src/index.ts:29-63`：`PersistIngestItemResult`、`WorkflowAttemptSnapshot`、`RepositoryHealth` | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | Application 持久端口结果和健康投影，由 Repository owner 实现 |
| `packages/application/src/index.ts:64-95`：`LoggerContext`、`LoggerPort`、noop logger | [`runtime/0004-structured-logging.md`](runtime/0004-structured-logging.md) | 日志 port 和默认实现，不拥有日志存储 |
| `packages/application/src/index.ts:96-100`：`resolveLogger` wiring | [`runtime/0004-structured-logging.md`](runtime/0004-structured-logging.md) | 日志默认依赖 wiring，不拥有日志存储 |
| `packages/application/src/index.ts:101-224`：`CosmosRepository` port | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | Application 持久端口，由 Prisma Repository 实现 |
| `packages/application/src/index.ts:226-229`：`JobLease` | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | legacy Job lease 输入/输出形状 |
| `packages/application/src/index.ts:231-689`：`IngestConnector`、Connector errors、`ConnectorRegistry`、`ConnectorProbeService`、`IngestionService` | [`application/0001-connector-runtime.md`](application/0001-connector-runtime.md) | Connector/Probe/正常采集 runtime |
| `packages/storage-prisma/src/index.ts:2080-2252`：`assertJobLease`、`assertWorkflowActionFence`、`appendDomainEvent`、JSON/temporal/cursor/source-payload repository helpers | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | Prisma Repository 的 legacy lease、领域事件事务和投影解析辅助行为；不重复拥有 Workflow EventSink 实现 |
| `packages/application/src/index.ts:691-1105`：`IngestionWorkerOptions`、`WorkerJobResult`、`IngestionWorker`、legacy retry/lease lane | [`application/0002-legacy-ingestion-worker.md`](application/0002-legacy-ingestion-worker.md) | 旧回滚/Probe lane；不得写成规范 Kernel |
| `packages/application/src/index.ts:1107-1124`：`createHealthSnapshot` | [`interfaces/0001-product-api-runtime.md`](interfaces/0001-product-api-runtime.md) | API/Worker health projection helper |
| `packages/blob-store/src/index.ts:14-96`：`BlobStoreConfig`、`StoredBlob`、`createBlobStoreConfig`、`resolveBlobKey`、`FileBlobStore` | [`storage/0005-file-blob-store.md`](storage/0005-file-blob-store.md) | 内容寻址、受控 Blob Root、重复写/读取 |
| `packages/blob-store/src/index.ts:98`：`BlobWorkflowValueStore` re-export wiring | [`storage/0006-workflow-value-store.md`](storage/0006-workflow-value-store.md) | 仅 wiring，具体 ValueStore 实现见对应文件 |
| `packages/blob-store/src/index.ts:99-106`：BlobRef errors/`readVerifiedBlob` re-export wiring | [`storage/0005-file-blob-store.md`](storage/0005-file-blob-store.md) | 仅 wiring，具体完整性实现见对应文件 |
| `packages/blob-store/src/verify-blob-ref.ts`：`BlobRefLike`、`BlobRefNotFoundError`、`BlobIntegrityError`、`readVerifiedBlob` | [`storage/0005-file-blob-store.md`](storage/0005-file-blob-store.md) | Blob 四元完整性校验 |
| `packages/blob-store/src/workflow-value-store.ts`：`BlobWorkflowValueStore.put/get` | [`storage/0006-workflow-value-store.md`](storage/0006-workflow-value-store.md) | canonical JSON ValueRef 和读取校验 |
| `packages/storage-prisma/src/index.ts:53-2075`：`StorageRoots`、`resolveStorageRoots`、`createPrismaClient`、`resolveContainedPath`、`PrismaCosmosRepository`、Repository transaction/lease/domain projection helpers | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 领域表、旧 Job、FTS、Feed/Search/SSE query、Blob/lease 事务 |
| `packages/storage-prisma/src/index.ts:2076`：`PrismaWorkflowBackend` re-export wiring | [`storage/0002-workflow-backend.md`](storage/0002-workflow-backend.md) | 仅导出 wiring，不重复拥有 Backend 实现 |
| `packages/storage-prisma/src/index.ts:2077`：`PrismaWorkflowHostStore` re-export wiring | [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) | 仅导出 wiring，不重复拥有 Host Store 实现 |
| `packages/storage-prisma/src/index.ts:2078`：`PrismaWorkflowEventSink` re-export wiring | [`storage/0004-workflow-event-sink.md`](storage/0004-workflow-event-sink.md) | 仅导出 wiring，不重复拥有 Event Sink 实现 |
| `packages/storage-prisma/src/workflow-backend.ts`：`PrismaWorkflowBackend`、envelope marker、state validation/CAS | [`storage/0002-workflow-backend.md`](storage/0002-workflow-backend.md) | Kernel state durable backend |
| `packages/storage-prisma/src/workflow-host-store.ts`：`PrismaWorkflowHostStore` 及 Run/Job/Completion claim、heartbeat、terminalize、requeue/dead-letter | [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) | Host SQL 状态机和双 fencing |
| `packages/storage-prisma/src/workflow-event-sink.ts`：`PrismaWorkflowEventSink`、`emitWithLease`、idempotency/lease guard | [`storage/0004-workflow-event-sink.md`](storage/0004-workflow-event-sink.md) | Domain Event 原子写入 |
| `packages/transport-http/src/index.ts`：`CosmosEventSource`、`HttpCosmosClientOptions`、`CosmosTransportError`、`HttpCosmosClient` | [`interfaces/0004-http-client.md`](interfaces/0004-http-client.md) | HTTP/DTO/SSE client；无服务端持久状态 |
| `packages/logging/src/index.ts`：`logSchemaVersion`、Logger/配置、`createLogger`、serialize/sanitize、RuntimeLogger、RotatingFileSink | [`runtime/0004-structured-logging.md`](runtime/0004-structured-logging.md) | `log.v1`、stdout/file/both、脱敏和轮转 |
| `packages/worker-admin/src/index.ts`：Worker snapshots、`WorkerAdminService`、`createWorkerAdminServer`、request/error helpers | [`runtime/0003-worker-admin.md`](runtime/0003-worker-admin.md) | loopback Admin 状态/Drain/metrics；内存状态重启即失 |

### 5.4 plugins/**

| 文件 + 导出符号/行为区间 | 唯一归属 spec | 覆盖说明 |
| --- | --- | --- |
| `plugins/rss/src/index.ts`：`rssConnectorId`、`fixtureRssConnectorId`、`createRssConnector`、`createFixtureRssConnector`、`createSequenceFixtureConnector`、`parseRssXml` | [`connectors/0001-rss.md`](connectors/0001-rss.md) | RSS/Atom、fixture、cursor、raw payload、enclosure Asset |
| `plugins/collectors/src/index.ts:33-377`：Bilibili/OpenCLI runner、`createBilibiliConnector`、`createAiHotConnector` 及 normalizers | [`connectors/0002-managed-collectors.md`](connectors/0002-managed-collectors.md) | 外部依赖、退出码、timeout/maxBuffer、格式/限流错误 |
| `plugins/collectors/src/index.ts:379-818`：`createBuiltInConnectorRegistry`、四个 builtin connector 注册和解析 helpers | [`connectors/0002-managed-collectors.md`](connectors/0002-managed-collectors.md) | Registry wiring；API 只能看 manifest |

### 5.5 Docker、Prisma 与 scripts

| 文件 + 模型/行为区间 | 唯一归属 spec | 覆盖说明 |
| --- | --- | --- |
| `docker/Dockerfile`：Bun build、Node runtime 镜像和生产启动命令 | [`operations/0001-deployment.md`](operations/0001-deployment.md) | 部署构建配置；容器验收仍未验证 |
| `docker/compose.yml`：api/web/worker、卷、migration/health 依赖和环境映射 | [`operations/0001-deployment.md`](operations/0001-deployment.md) | 部署编排配置；容器验收仍未验证 |
| `packages/storage-prisma/prisma/schema.prisma:251-259`：WorkflowRun Kernel state、revision、status、resumeRequired、definition identity | [`storage/0002-workflow-backend.md`](storage/0002-workflow-backend.md) | Backend state 与 projection |
| `packages/storage-prisma/prisma/schema.prisma:260-278`：WorkflowRun idempotency/input/product envelope、Run lease、timestamps 和 Host relations | [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) | Host envelope/lease durable state；与 Backend 区间不重叠 |
| `packages/storage-prisma/prisma/schema.prisma:10-75`：SourceInstance、Checkpoint、Run、Step 模型 | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 领域与 legacy Run/Step 持久模型 |
| `packages/storage-prisma/prisma/schema.prisma:76-79,82-98,102`：Job 的 legacy 字段、关系和基础索引 | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 旧 Connector/Probe Job 模型；Host 扩展字段见下一行 |
| `packages/storage-prisma/prisma/schema.prisma:80-81,99-100,103-105`：Job 的 `workflowRunId`/kernel revision、Host 关系和索引 | [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) | Workflow Activity Job 扩展；与 legacy Job 区间不重叠 |
| `packages/storage-prisma/prisma/schema.prisma:107-116`：WorkerHeartbeat 模型 | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | Worker 存活投影 |
| `packages/storage-prisma/prisma/schema.prisma:117-126`：DomainEvent 基础字段与 Run 关系 | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 旧领域事件基础模型 |
| `packages/storage-prisma/prisma/schema.prisma:127-135`：DomainEvent workflowRun/idempotency 字段与约束 | [`storage/0004-workflow-event-sink.md`](storage/0004-workflow-event-sink.md) | Event fencing/idempotency projection，无重复归属 |
| `packages/storage-prisma/prisma/schema.prisma:137-250`：Observation、Entry、EntryRevision、Asset、Story、StoryRevision | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 不可变观察、修订、媒体和最小 Story |
| `packages/storage-prisma/prisma/sql/fts5.sql`：`entry_search` FTS5 virtual table definition | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | Search index schema；不拥有领域事实 |
| `packages/storage-prisma/prisma/schema.prisma:279-303`：WorkflowCompletion | [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) | Completion durable delivery record |
| `packages/storage-prisma/prisma/migrations/20260808003247_phase1_foundation/migration.sql`：基础 Source/Run/Job/Observation/Entry/Asset/Story/Event 表 | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 初始领域 schema |
| `packages/storage-prisma/prisma/migrations/20260808150000_collector_jobs/migration.sql`：legacy Job payload/result/error 字段 | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 旧 Connector/Probe Job 投影 |
| `packages/storage-prisma/prisma/migrations/20260810020829_normalized_content_model/migration.sql`：Entry/Revision/Observation normalized 字段和索引 | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 规范化内容与不可变 Observation |
| `packages/storage-prisma/prisma/migrations/20260813160000_workflow_run_backend/migration.sql`：WorkflowRun stateJson/kernelRevision/status/resumeRequired/definition projection | [`storage/0002-workflow-backend.md`](storage/0002-workflow-backend.md) | Backend 初始持久状态 |
| `packages/storage-prisma/prisma/migrations/20260814090000_workflow_activity_host/migration.sql:1-18,24-50`：WorkflowRun envelope/lease、Job workflow 关联、WorkflowCompletion | [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) | Host Run/Activity/Completion durable state；与下一行按 SQL 区间拆分 |
| `packages/storage-prisma/prisma/migrations/20260814090000_workflow_activity_host/migration.sql:19-23`：DomainEvent workflowRun/idempotency 字段和唯一约束 | [`storage/0004-workflow-event-sink.md`](storage/0004-workflow-event-sink.md) | Event Sink 专属扩展，无重复归属 |
| `packages/storage-prisma/prisma/migrations/20260815090000_workflow_ingest/migration.sql`：Checkpoint revision/workflowRun、Observation workflow provenance/ingest command/result | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | 固定 Ingest 领域事实与 checkpoint CAS |
| `scripts/dev-env.ts`、`scripts/dev-port.ts`、`scripts/dev-service.ts`、`scripts/dev.ts`：根目录解析、端口选择、Web URL 注入、三进程启动/停止和 Windows 进程树 | [`operations/0002-development-runtime.md`](operations/0002-development-runtime.md) | 开发运行时；不是产品 API |
| `scripts/prisma.ts`：Prisma CLI wrapper、Data Root/DATABASE_URL 解析 | [`operations/0002-development-runtime.md`](operations/0002-development-runtime.md) | migration/generate/validate 入口 |
| `scripts/smoke-node.ps1`：隔离 Data/Blob Root 的 Node durable smoke 验收流程 | [`operations/0002-development-runtime.md`](operations/0002-development-runtime.md) | 仅为重建验收锚点，不描述成产品组件 |
| `packages/storage-prisma/prisma/migrations/migration_lock.toml`：SQLite Prisma provider lock | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) | Migration tool input；不含业务状态 |

## 6. 测试锚点（不计入生产覆盖表）

测试文件归入对应组件正文的“实现与测试锚点”，不能因此扩大生产源码覆盖或能力声明。当前已枚举
的测试归属如下：

| 测试文件 | 对应 spec |
| --- | --- |
| `packages/contracts/src/index.test.ts`、`packages/contracts/src/action.test.ts` | [`contracts/0001-public-contracts.md`](contracts/0001-public-contracts.md) |
| `packages/domain/src/index.test.ts` | [`domain/0001-normalized-content.md`](domain/0001-normalized-content.md) |
| `packages/application/src/action.test.ts` | [`application/0003-action-registry.md`](application/0003-action-registry.md) |
| `packages/application/src/workflow-ingest.test.ts` | [`application/0006-ingest-workflow.md`](application/0006-ingest-workflow.md) |
| `packages/application/src/workflow-host-runtime.test.ts` | [`application/0008-workflow-host-runtime.md`](application/0008-workflow-host-runtime.md) |
| `packages/application/src/index.test.ts` | [`application/0001-connector-runtime.md`](application/0001-connector-runtime.md)、[`application/0002-legacy-ingestion-worker.md`](application/0002-legacy-ingestion-worker.md)（按测试 describe 区间） |
| `packages/blob-store/src/index.test.ts` | [`storage/0005-file-blob-store.md`](storage/0005-file-blob-store.md) |
| `packages/blob-store/src/workflow-value-store.test.ts` | [`storage/0006-workflow-value-store.md`](storage/0006-workflow-value-store.md) |
| `packages/storage-prisma/src/index.test.ts` | [`storage/0001-prisma-repository.md`](storage/0001-prisma-repository.md) |
| `packages/storage-prisma/src/workflow-backend.test.ts` | [`storage/0002-workflow-backend.md`](storage/0002-workflow-backend.md) |
| `packages/storage-prisma/src/workflow-host-store.test.ts` | [`storage/0003-workflow-host-store.md`](storage/0003-workflow-host-store.md) |
| `packages/transport-http/src/index.test.ts` | [`interfaces/0004-http-client.md`](interfaces/0004-http-client.md) |
| `packages/logging/src/index.test.ts` | [`runtime/0004-structured-logging.md`](runtime/0004-structured-logging.md) |
| `packages/worker-admin/src/index.test.ts` | [`runtime/0003-worker-admin.md`](runtime/0003-worker-admin.md) |
| `apps/api/src/app.controller.test.ts` | [`interfaces/0002-product-api-http.md`](interfaces/0002-product-api-http.md) |
| `apps/api/src/request-logging.test.ts` | [`interfaces/0003-api-observability.md`](interfaces/0003-api-observability.md) |
| `apps/worker/src/workflow-host.test.ts` | [`runtime/0002-workflow-host-composition.md`](runtime/0002-workflow-host-composition.md) |
| `apps/worker/src/workflow-ingest.test.ts` | [`runtime/0001-worker-process.md`](runtime/0001-worker-process.md)、[`application/0006-ingest-workflow.md`](application/0006-ingest-workflow.md)（按 lane/ingest describe 区间） |
| `plugins/rss/src/index.test.ts` | [`connectors/0001-rss.md`](connectors/0001-rss.md) |
| `plugins/collectors/src/index.test.ts` | [`connectors/0002-managed-collectors.md`](connectors/0002-managed-collectors.md) |
| `apps/web/src/instrumentation.test.ts` | [`interfaces/0005-web-client.md`](interfaces/0005-web-client.md) |
| `scripts/dev-port.test.ts` | [`operations/0002-development-runtime.md`](operations/0002-development-runtime.md) |

基线记录（来源为本轮权威 `local://spec-baseline.md`）：focused 4 files/47 tests、full 23 files/165 tests、
typecheck、lint:web、build、db:generate/db:validate 和 Node smoke 均通过；这些是既有基线证据，
本次仅写文档，未重跑全量测试、lint、构建或 smoke。

## 7. 当前非目标与未验证边界

下列事项必须在规格中明确写成“未验证/未实现”，不能作为当前能力、重建验收通过条件或
`Implemented` 状态：

| 边界 | 当前准确表述 |
| --- | --- |
| Docker 容器/Compose 实际启动 | Dockerfile/Compose 已纳入覆盖表，但当前机器未运行容器验收；配置检查不等于容器通过 |
| browser/e2e | 当前基线没有以 browser/e2e 证据替代 Node smoke；不得声称浏览器交互已验收 |
| 真实 RSS | fixture/sequence Connector 的行为可测试；本基线未运行真实外网 RSS 采集 |
| 真实 Bilibili/OpenCLI | Connector 代码和输入错误分类存在；未运行真实 OpenCLI、doctor/profile、Bilibili 账号/限流链路 |
| 跨进程 recovery | SQL 状态和 reclaim 代码存在；当前记录不证明跨进程重启后的完整 waiting/Activity recovery |
| 长时双 Worker fencing | focused 双客户端/租约证据不等于长时双 Worker takeover、时钟漂移和压力验收 |
| Worker Admin SIGTERM + 活跃 Attempt deadline | Drain/admin 状态和 active poll/Attempt 区分已实现；此特定 SIGTERM 活跃 Attempt deadline 场景未验证 |
| Worker Gateway/远程 Worker | Gateway Session、long-poll、owner epoch、late evidence 和远程 Secret 仍是边界设计，不是实现 |
| Redis/WakeupBus | 当前本地路径不以 Redis 持有 Job truth；Redis adapter 未实现/未验证 |
| PostgreSQL/S3/多主机 | 目标架构保留替换路径；SQLite/Data/Blob Root 的多主机部署不是当前能力 |
| 完整 Ingest parity/产品全量范围 | 固定 Workflow 主链已接线；完整 parity、Source 删除、完整计划/诊断、全部未来 Knowledge/Research/Delivery 仍不应从规格索引推断 |

任何组件重建若需要上述边界以外的行为，必须先补充实现和独立验证，再更新对应 spec 和基线
引用；不能把 `Draft`、`Planned` 或历史 Spike 当作已实现证据。
