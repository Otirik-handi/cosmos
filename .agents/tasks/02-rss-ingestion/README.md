# Phase 1：RSS 录入与离线查询

## User Request / Topic

在完成技术选型和架构审查后，先更新文档，再进入项目初始化和脚手架搭建。第一条真实端到端切片使用 RSS/RSSHub 与本地 fixture，并为服务器部署优先、客户端模式和客户端与服务分离模式保留兼容边界。

## Goal

交付一条可验证的最小垂直链路：

```text
RSS/RSSHub 或 fixture
  -> Source / Trigger / Workflow / Action
  -> Observation / EntryRevision / Asset
  -> 最小 Story projection
  -> Prisma + SQLite / FTS5
  -> NestJS API / SSE
  -> Next.js Feed 与搜索
  -> 离线打开 Story -> Entry -> Source/Revision
```

完成后，系统应能在服务器部署模式下运行；客户端模式和客户端与服务分离模式只要求边界已经由稳定 Transport 合同保留，不要求本 Task 交付 Desktop Shell。

## Scope

- Bun 开发脚本、Node 生产启动路径，以及共享代码的 Node-compatible 约束。
- Next.js App Router Web、NestJS API 和独立 Worker 的最小宿主。
- 版本化 `contracts`：Command、Query、Event、错误、健康检查和 SSE 事件 payload。
- 最小 `domain` 与 `application`：Source、Trigger、脚本优先的 Workflow、Action、Run、Step、Job、Observation、Entry、EntryRevision、Asset 和 Story projection。
- Prisma + SQLite 持久化；SQLite FTS5/BM25、虚拟表和触发器通过受控 SQL Adapter 使用。
- Blob/Artifact/Cache Root 的最小本地文件存储边界。
- RSS/RSSHub Connector 与 fixture Connector。fixture 必须覆盖有 URL、无 URL、重复轮询、来源修订和媒体状态。
- 手动与定时 Trigger、checkpoint、业务幂等键、Job 租约、心跳、有界重试和重启恢复。
- 最小 Source/Run 状态页、Story-based Feed、搜索页和 Story → Entry → Source/Revision 详情。
- Docker 镜像/Compose 的服务器运行入口；若环境没有 Docker，只记录验证未运行。

## Non-goals

- 跨来源 Story 聚类、merge、split、复杂身份判定和完整 Story 维护。
- Topic、Entity、相关推荐、Spotlight、完整推荐排序和 embedding。
- 完整 Board/Section/Block 编辑器、Label、Annotation、Collection、Saved View。
- `agent.run`、Artifact/Workspace 生成和 `neuro-agent-harness` 接入。
- 通用用户自定义 Workflow 编辑器、Graph/Comfy UI、Research Workflow 和完整 Knowledge Workflow；Phase 1 只验证固定 Ingest Workflow 的公共边界。
- Desktop Shell 的具体技术、安装升级卸载和 Node sidecar 生命周期。
- 多用户、租户、云端同步、细粒度权限 UI 和不可信插件沙箱。
- 原始 RSS Phase 1 切片不包含真实 BiliBili、X、Telegram、公众号、IMAP 或 QQ 接入；BiliBili/AI HOT 仅在下方 Phase 1B 范围内推进。

## Phase 1B：Collector Runtime

Phase 1B 是在 RSS 最小闭环之上的后端扩展切片。它只扩展 API、Worker 和受管 Connector，不重新打开前端、AI、Harness 或 Desktop 范围。

### Goal

交付一条可以持续保存 `Entry` 的服务器端链路：

```text
受管 Bilibili/OpenCLI 或 AI HOT
  -> Worker Probe / Ingest Job
  -> Observation / EntryRevision / Asset
  -> Prisma + SQLite / FTS5
  -> API 查询 Job / Entry
```

### Scope

- `Source.kind` 使用业务来源类型：`rss`、`fixture-rss`、`bilibili`、`aihot`。
- OpenCLI 只作为 Bilibili Connector 内部的固定版本执行器，不作为通用命令执行平台。
- Bilibili v1 只支持公开 `hot` 和登录态 `feed` 两个受管场景；`search`、`user-videos` 和 `dynamic` 后置。
- OpenCLI 的 profile、配置目录和 Browser Bridge 由 OpenCLI 管理；Cosmos 不保存 Cookie、Token 或密码。
- AI HOT v1 只调用固定的 `https://aihot.virxact.com/api/v1/items`，使用服务返回的 cursor。
- API 只校验配置、创建 Job 和查询状态；Probe 与正式 Ingest 均由 Worker 执行。
- Probe 是 dry-run，只保存探测结果，不写 Observation、Entry、Asset，也不推进 checkpoint。
- 继续复用 Observation、EntryRevision、Asset、Blob Store、FTS5、幂等、租约、重试和 Worker heartbeat。
- 增加 `GET /api/v1/jobs/:jobId` 和最小 `GET /api/v1/entries` 验收接口。
- 先完成手动 Probe/Ingest；schedule 在手动链路稳定后接入。
- Docker 保证 API、Worker 和 AI HOT 的生产入口；Bilibili 需要宿主机或外部运行环境提供 Browser Bridge，依赖缺失时必须返回明确状态。

### Phase 1B Non-goals

- 不允许用户提交任意 OpenCLI command、任意 HTTP endpoint、任意 Header 或认证信息。
- 不在 API 进程执行外部 HTTP、浏览器桥或 OpenCLI。
- 不接入 LLM、`pi-ai`、`neuro-agent-harness`、Topic、推荐、聚类或前端。
- 不把 Cookie、Token、私密浏览器数据写入 Cosmos 数据库或日志。

## Current State

- Phase 0 需求、架构、信息模型和协作文档已经存在。
- `docs/requirements/0002-product-requirements.md` 已将 Phase 1 定义为最小 Story projection，而不是完整 Story/Topic 系统。
- `docs/architecture/0001-cosmos-foundation.md` 已定义 Next/Nest/Worker、Prisma/SQLite、Transport/SSE 和三种宿主模式的边界。
- 已建立 Bun workspace、根级 `bun.lock`、Next.js Web、NestJS API、Node Worker 和公共包边界。
- 已建立 Prisma SQLite schema、正式 migration、FTS5 SQL Adapter、RSS URL-free fixture、shadcn `components.json` 和最小 Story Feed 页面。
- 已建立 `docker/Dockerfile` 与 `docker/compose.yml`；API migration、standalone Web、healthcheck 和 API/Worker 共享卷已配置，Docker 本机不可用，尚未执行容器验收。
- Docker 当前环境不可用；后续 Docker/Compose 验收必须单独报告。

## Decisions and Deviations

- 第一优先级是服务器部署，但 Web 不直接访问数据库；所有宿主通过 Service Endpoint、Command、Query、Event 和流式 Transport 访问应用能力。
- Phase 1 允许一个 Entry 只有一个 Story，Story 先作为稳定的展示 projection；不要把这个 projection 描述成跨来源聚类完成。
- 普通 ORM 读写使用 Prisma；FTS5、BM25、虚拟表和触发器集中在受控 SQL Adapter，不能泄漏到 domain 或 contracts。
- 开发使用 Bun，生产使用 Node；不能因为 Bun 便利而把 Bun-only API 写入共享包、API 或 Worker 的生产路径。
- UI 使用 React、Next.js App Router、Tailwind、shadcn/ui、React Hook Form 和 Zod。shadcn 组件代码归项目源码所有，skill/CLI 是开发辅助。
- Agent 当前直接使用 `pi-ai` 的能力边界；`neuro-agent-harness` 继续在独立仓库演进，未来通过 ModelRuntime、SessionStore、Profile 和 Capability Adapter 迁移。
- Harness Core 去领域化，可逐步吸收 TSX Profile、常用工具和 SSE；NeuroBook 专属上下文、路径、配置、watcher 和 sidecar 不进入 Harness Core。
- Workflow 是主动行为核心；脚本式 Workflow 是底层执行形态，Graph/IR/Comfy 类表达后续转换为脚本语义，不建立第二套 Runtime。
- Ingest、Knowledge、Research、Maintenance、Delivery 和 Interaction 使用同一 Runtime 的轻量 kind/tags 分类。
- 任何自动结果、Run、Job、Revision、SSE 恢复和错误都必须有可追踪的 ID、版本或关联记录。

## Implementation Walkthrough

### 1. 初始化仓库工作区

建议的 Phase 1 目录边界：

```text
apps/
├─ web/
├─ api/
└─ worker/

packages/
├─ contracts/
├─ domain/
├─ application/
├─ storage-prisma/
└─ blob-store/

plugins/
└─ rss/

fixtures/
└─ rss/
```

完成标准：Bun 开发命令可以分别启动 Web、API、Worker；生产入口明确使用 Node；不创建没有实际消费者的空 package。

### 2. 固化公共合同

先定义并测试：

- `health`、协议版本和能力摘要。
- Ingest、Run、Search、Feed、Story、Entry、Asset 的 Query/Command DTO。
- Event ID、payload version、幂等键和错误码。
- SSE 事件、游标、重连和 `snapshot_required`。

完成标准：Web、API、Worker 只通过公共合同互相通信；合同测试不依赖 Prisma 具体实现。

### 3. 建立领域与应用用例

实现最小状态流：

```text
SourceInstance
  -> Trigger
  -> Workflow Run / Step / Job
  -> Observation
  -> Entry + EntryRevision
  -> Asset
  -> minimal Story projection
  -> Feed/Search Query
```

完成标准：每个状态修改都有 application use case、校验、幂等边界和可审计 Event；domain 不导入 Prisma、Nest 或 Next。

### 4. 实现 Prisma/SQLite 与文件存储

- 为核心元数据、关系、Run、Job、checkpoint、Asset 和最小 Story projection 建立 Prisma schema。
- 用隔离 Data Root 运行 migration 和测试。
- 通过 SQL Adapter 建立/维护 FTS5 projection 与 BM25 查询。
- 将原始 payload、图片和大文本交给 Blob Store；文件路径由服务端解析。

完成标准：测试可创建新的临时 Data Root；数据库、Blob Root 和 Cache Root 互不污染；删除可重建索引不会删除原始证据或用户真相。

### 5. 实现 RSS 与 fixture Connector

- RSS/RSSHub Connector 负责拉取并标准化外部 payload。
- fixture Connector 负责确定性重放测试样本。
- checkpoint 以来源稳定 ID/发布时间等结构化信息表达，不把 URL 当成唯一身份。
- 真实来源编辑生成新的 EntryRevision；重复轮询不产生新的稳定 Entry。

完成标准：fixture 能稳定重现有 URL、无 URL、重复、修订和媒体状态五类案例；替换 Connector 不改变 Observation/Entry 合同。

### 6. 实现 Worker 与恢复

- 支持手动和 schedule Trigger。
- Worker 使用持久 Job、租约、心跳、重试上限和业务幂等键。
- 旧 Worker 不能覆盖租约接管后的结果。
- 运行错误保留 Source、Run、Step、Action 和输入摘要的关联。

完成标准：已通过过期 lease 接管、旧 token 拒绝、有限重试、schedule bucket、Worker heartbeat 和 queued Run 端到端测试；真实进程中断后的长时间重启演练仍待执行。

### 7. 实现 NestJS API、SSE 与 Next.js UI

- NestJS API 暴露健康检查、Source/Run 状态、搜索、Feed、Story/Entry 详情和受控 Blob 访问。
- SSE 推送 Run/Job/Feed 更新；客户端重连使用游标，无法补齐时进入 `snapshot_required` 流程。
- Next.js Feed 以 Story 为入口，展开到 Entry、Source 和 Revision；搜索结果可定位到原始内容。
- 使用 React Hook Form + Zod 处理 Source 配置和查询参数；shadcn 组件按项目源码维护。

完成标准：已通过本机 Service Endpoint 的来源创建、queued Run、SSE ready、Feed、关键词/来源/时间/分页搜索、URL-free Story 详情和健康检查；UI 不读取 ORM 对象、绝对路径或数据库文件。离线数据路径由本地 SQLite/Blob 保证，浏览器 PWA 缓存仍非本 Task 范围。

### 8. 服务器交付与验收

- 提供 Node 生产启动路径。
- 提供 Dockerfile/Compose 入口，并明确 Data Root、Blob Root、Artifact Root、Cache Root 和 Secret 配置。
- 验证 API 健康检查、Worker 存活、迁移、重启、离线查询和错误展示。

完成标准：服务器模式的最小端到端链路可复现；未运行的 Docker、真实 RSS、浏览器或跨平台验收分别标注，不用 focused 测试替代。

### 9. Phase 1B Collector Runtime

先修正当前草稿的合同和生产闭合问题，再实现真实 Connector：

- 将 Connector Registry 的 key 固定为业务 `Source.kind`，移除任意 connector override。
- 让 `source-probe` 成为持久 Job；API 返回 `202` 和 Job Snapshot，Worker 执行 dry-run。
- 为 Job 补齐 payload、result、错误码、查询接口和旧租约拒绝提交语义。
- 用统一 `NormalizedIngestItem` 隔离 Bilibili、AI HOT 和 RSS 的字段差异。
- AI HOT 先用 fake fetch 测试，再做固定 endpoint 的真实 GET 和 cursor 验收。
- Bilibili 通过固定 `hot`/`feed` 场景调用 OpenCLI，支持内置版本和环境变量 executable 覆盖。
- Bilibili 的 Browser Bridge、profile 和登录前置条件必须在 Node smoke 与 Docker 说明中单独报告。
- 录入仍按“获取 -> 不可变 Observation -> 去重/Revision -> Asset -> Story projection -> FTS -> 成功后 checkpoint”顺序执行。

完成标准：API 不执行外部采集；Probe 无副作用；重复轮询不产生重复 Entry；来源修订追加 Revision；Worker 中断后任务可接管；AI HOT 可在 Docker 中运行；Bilibili 在满足 Browser Bridge 前置条件的 Node 环境中可诊断并保存 Entry。

### 10. 本轮用户视角架构审查

本轮确认 Phase 1/1B 只交付采集基础和最小离线信息库闭环，不等同于最终的可编排知识平台。Run、Step、Job、Domain 和 DomainEvent 的职责已经记录：

- Run 表示一次完整流程，Step 表示流程阶段，Job 表示 Worker 执行单元，DomainEvent 表示已经发生的持久事实。
- 数据库是事实、状态、历史和用户真相的持久中心；插件和 Agent 通过版本化合同访问数据库，不直接依赖 Prisma 表。
- Provider、Adapter、ConnectionInstance、SourceInstance、Trigger 和 WorkflowBinding 分开；一个连接可以复用多个采集计划。
- 凭证建议由 Cosmos SecretStore 统一管理，非秘密 cursor、ETag、分页 token 和限流状态由命名空间化 ConnectorStateStore 管理。
- “动态每 30 分钟、推荐流每 2 小时”应建模为同一连接下的两个独立采集计划，各自拥有 Trigger、Workflow、checkpoint、预算、错误和重试边界。
- Ingest 本身是一种 Workflow；外部来源事实先完成 Observation/Entry/Revision/Asset 入库，不等待 LLM。
- Entry → Story 是可由用户或 Agent 配置的 Knowledge Workflow，支持“批量全量 Agent”和“脚本优先、困难/强相关/重要内容升级 Agent”两类策略。
- Research 不直接耦合 Ingest；分析信号产生 Research Request，再由 Trigger 启动独立 Research Workflow；研究结果重新经过 Observation → Entry。
- 后续 Story 跨来源聚类需要 StoryMembership；推荐需要区分外部候选、Admission 和 Cosmos Ranking，普通 Feed 不能依赖在线 LLM。
- 本轮确认知识管理者是共享 `nb-memory` 之上的高权限系统角色，可以通过 Web Chat、`cosmos cli` 和 ingest/research Workflow 参与；它不是单一 Session。
- 个性化配置方向是“Agent 记忆 + Cosmos 观察到的用户行为 + 未来其它信号 → 程序可读配置”，当前不要求逐字段 provenance，也不把平台推荐信号独立建模为用户偏好。
- `nb-memory` 调研已记录在 [`docs/research/2026-08-08-nb-memory-research.md`](../../../docs/research/2026-08-08-nb-memory-research.md)；接入、Node 生产兼容性和行为映射均后置，不扩大本 Task。

这些方向暂不扩大本 Task 的实现范围。继续增加平台 Adapter 前，应先单独建立 Connection/Secret/State、脚本优先的 Workflow API、持久子任务、Knowledge Workflow、Research Request/Trigger 和 `nb-memory` Adapter 的实现 Task。

## Current implementation slice：配置优先的产品 E2E（2026-08-23）

- **生命周期阶段**：已接受 Proposal 后的产品入口设计与实施准备；当前只建立任务切片，不把未实现能力写成完成。
- **连贯目标**：让本地单用户从空数据根目录通过 Web 选择 `rss` Connector、填写实际 RSS URL、校验/测试/保存/启用配置，由 Worker 抓取并在两块固定最小看板（最新内容 Feed + 来源健康）中看到结果。
- **可观察验收**：
  1. 产品配置入口不再固定提交 `fixture-rss`/`fixturePath`；用户可读取 `rss` schema，填写实际 `feedUrl`，完成服务端校验、未保存配置测试、保存为停用 Source 和单独启用。
  2. 默认定时 30 分钟、用户可修改或关闭、测试立即执行、已排队 Run 使用创建时配置快照是本次选择的实现建议；具体调度字段与调度合同待冻结；配置错误、测试失败和来源健康状态在 Web 可见。
  3. 在隔离数据库/Data Root 中，真实产品 E2E 从用户填写的实际 RSS URL 开始，Worker 抓取后看板显示内容与来源健康；fixture、受控 HTTP 源、fake Blob 和直接 Worker Admin 调用只作为集成/管线测试。
 - **依赖**：已接受 [`first-usable-e2e-loop Proposal`](../../../docs/proposals/first-usable-e2e-loop.md)、现有 SourceDefinition/catalog、Product API、Worker durable Ingest、SSE、Feed/Story 查询；媒体实现依赖后续 Blob 流式端口、RSS 媒体提取/下载和 bytes/BlobRef 映射设计。
 - **受影响合同**：PRD AUT-001～AUT-003、ING-007～ING-011、BRD-001；架构 §4.7、§6.4 和 Phase 1 路线；第 4–7 项实现建议仍待冻结，不新增 `NormalizedIngestItem.localMediaRefs`，不直接冻结媒体公共 DTO、Prisma 字段或 Blob 端口。
- **预计核心文件**：`packages/contracts/src/base.ts`、`apps/api/src/app.controller.ts`/Source application ports、`apps/web/src/app/page.tsx` 与 Source 配置组件、HTTP transport client、相关 storage schema/repository；实际文件以合同设计和代码证据为准。
- **验证层级**：contracts/API focused tests；隔离数据库与 Blob/Data Root integration；Web 浏览器配置流程；Node API/Worker process smoke；真实 RSS URL 产品 E2E；断网阅读与媒体状态；fixture/受控 HTTP 只作为独立集成证据。

#### 合同切换登记（2026-08-24）

- 本切片采用版本化 `sourceDefinitionRef` 作为 SourceInstance 的唯一业务身份；Catalog manifest 必须显式提供运行时 `connectorId`，首批 operation 使用 `fetch`。新 Product API 不接受 `kind`，也不根据 kind 字符串隐式推导 ref。
- SourceInstance 不持久化 `connectorId`；Repository 注入 `CatalogPort`，按 ref 解析 manifest，并由 manifest 生成 `connectorId` 与迁移期 `kind` 运行时投影。API/Worker/Repository 不手工传入投影，也不按字符串猜测映射。
- 迁移期保留旧 `kind` 作为兼容投影，但它不是第二套身份真相；新建/更新 Source 时由 manifest 映射约束，旧数据先做显式 kind→ref/operation 预检。未知 kind、非唯一映射或 manifest 不可用必须阻断迁移并报告。
- SourceInstance 增加独立单调 `revision`，公开 Snapshot 提供不透明 `revisionId`。创建默认停用并从 revision 1 开始；配置更新与启用状态变更使用 CAS，过期 revision 返回当前 `conflict`，绝不使用 `updatedAt` 充当 revision。
- 本轮只冻结 Source 身份、并发、保存默认停用、完整配置替换和独立启用边界；不冻结 CollectionPlan、未保存 Probe、RSS 媒体范围、Blob 下载或未认证作用域。
- 实施状态（2026-08-24）：contracts/Catalog/Prisma/存储迁移/API/Web 入口已完成并通过全仓单元测试（34 文件 243 用例，含 stale no-op 激活回归）、`typecheck:packages`、`typecheck:apps`、`docs:check`、`git diff --check`。新增 forward migration `20260824000000_source_identity_revision`（显式 kind→ref 回填、未知 kind 阻断、保留 enabled、revision 从 1 起）与 `SourceActivationCommand` 幂等表；Storage 测试改用真实 `migrate deploy`，历史升级由 `source-identity-migration.test.ts` 覆盖。激活命令按唯一幂等键 + requestHash 事务化：同键同请求重放不递增 revision，同键不同请求或过期 revision 返回 conflict（含 no-op 意图——命令创建前先在事务内校验 revision），无状态变化且 revision 匹配的 no-op 命令记录 resultRevision 但不递增。Web 产品入口只提交 `source.rss@1/fetch + feedUrl`，创建默认停用后经 activation command 启用；未保存配置独立 Probe（`source-config-probe`）仍未实现，保持门控。
- Product API/运行时验收调用方同步完成（2026-08-24）：`e2e/ingest.e2e.test.ts`、`e2e/recovery.e2e.test.ts`、`e2e/scheduling.e2e.test.ts`、`e2e/browser/ingest.spec.ts`、`scripts/smoke-node.ps1`、`scripts/e2e/docker-flow.ts` 与 `scripts/e2e/real-source.ts` 均改为 `sourceDefinitionRef + operationId + config` 创建，再以 `baseRevisionId + Idempotency-Key` 独立激活；这些 Product API/运行时路径不再提交 `kind`、`enabled` 或 `fixturePath`。`e2e/component-lab/source-form.spec.ts` 不属于 Product API E2E：其 `renderSourceFormLab` 使用合成 props，并以 `event.preventDefault()` 阻断提交；本轮只将旧 `fixturePath/#fixture-path` 选择器迁移为 `feedUrl/#source-feed-url`。离线默认门禁使用受控本地 HTTP RSS：`bun run test:e2e` 4 文件/4 场景通过，`COSMOS_E2E_WEB_PORT=4183 bun run test:browser` 8/8 通过，`bun run test:browser:component-lab` 12/12 通过，Windows Node smoke 通过。Docker CLI 在本机不可用，因此 `test:docker` 未运行；真实 RSS/AI HOT/Bilibili 需要显式网络/OpenCLI 前置，本轮未运行。
- 代理支持（2026-08-24）：Worker 连接器（RSS/AIHOT 共用）接入 `apps/worker/src/proxy-fetch.ts`，遵循标准 `HTTP_PROXY/HTTPS_PROXY/NO_PROXY` 环境变量合同；有代理时统一走 undici `ProxyAgent`（Bun/Node 双运行时同一路径，避免 Bun fetch 忽略代理选项），环路地址与 `NO_PROXY` 命中一律直连（保护受控本地 RSS 验收源），代理 URL 仅接受 http(s) 且日志只输出脱敏 host:port。新增 `proxy-fetch.test.ts` 6 用例（进程内假代理走代理/环路直连/NO_PROXY/非法 scheme/凭据脱敏/无代理回退）。全量门禁 35 文件/255 用例、Node E2E 4/4 通过；未做真实外网抓取（需显式网络授权）。

### 切片：source-config-probe 未保存配置测试（2026-09-02）

- **生命周期阶段**：实施方案 v2 已经维护者批准（4 项决策拍板：结果含 `sampleTitles`、独立 GET 路由、沿用 Job 默认重试、POST 同步预校验）。本切片完成后端垂直实现；schema 驱动 Web 配置流程与探测结果展示归实施顺序第 4 步。
- **连贯目标**：让用户在保存 Source 之前提交 `sourceDefinitionRef + operationId + config`，由 Worker 真实抓取一页并返回统计与样例标题；全程无副作用。
- **可观察验收**：
  1. `POST /api/v1/source-config-probes` 同步预校验（canonical Zod schema + SourceDefinition 可用性），非法配置 400 且不建 Job；合法配置返回 202 + `source-config-probe` Job 快照，幂等键缺省 `config-probe:{uuid}`、请求头 `Idempotency-Key` 1–300 字符。
  2. Worker legacy 泳道认领 `source-config-probe`：`SourceConfigProbeService` 按 manifest 身份链（ref → manifest.connectorId → ConnectorRegistry）构造瞬态 `SourceSnapshot` 执行 dry-run，结果写回 Job（`sampleTitles` 最多 3 条、单条截断 200 字符）；执行失败走既有 Job 重试/终态机制。
  3. `GET /api/v1/source-config-probes/:jobId` 返回该类 Job，其他 kind 或不存在返回 404；服务构造上不持有任何 repository，结构性保证不写 Observation/Entry/Asset/checkpoint，也不产生新 Source。
- **依赖**：Task 02 配置优先切片（`sourceDefinitionRef` 合同、Catalog manifest、`SourceProbeService.validate`）、legacy Job 通道（claimNextJob/租约/completeJob）、canonical configuration schema 注册表。
- **受影响合同**：`jobKindSchema` 新增 `source-config-probe`；新增 `sourceConfigProbeCommandSchema`、`sourceConfigProbeJobPayloadSchema`、`sourceConfigProbeResultSchema`、`sourceConfigProbeJobSnapshotSchema`；`CosmosRepository` 新增 `createConfigProbeJob`。不新增媒体字段，不改 Prisma schema 与 migration。
- **实现偏差**：方案原计划将服务放在独立 `packages/application/src/config-probe.ts`；实施时与 `ConnectorProbeService` 同置 `packages/application/src/index.ts`，避免跨文件导出循环并保持两个 Probe 服务并列可读。
- **预计核心文件**：`packages/contracts/src/index.ts`、`packages/application/src/index.ts`、`packages/storage-prisma/src/index.ts`、`apps/api/src/app.controller.ts`、`apps/worker/src/main.ts` 及各层测试文件。
- **验证层级**：contracts/application/api focused tests；storage 隔离数据库测试（幂等重放 + 无持久化断言）；全仓 `typecheck`、`test`、`docs:check` 与默认门禁。真实外网 RSS 探测、Docker、发布部署不在本切片（未运行）。

### 切片：schema 驱动 Web 配置流程（2026-09-02，实施顺序第 4 步）

- **生命周期阶段**：实施方案已与维护者对齐并拍板三项决策——实施在 `.worktree/web-config-flow` 分支 `feat/t02-web-config-flow` 进行；表单暴露定时字段且默认 30 分钟；启用入口放在来源列表行内。本切片把第 3 切片完成的未保存配置 Probe 后端能力接入 Web 用户流程。
- **连贯目标**：让用户在 Web 上按"选择 `rss` → 填实际 `feedUrl`（可改定时/关闭）→ 校验 → 测试未保存配置 → 保存为停用 Source → 来源列表内单独启用"完成配置；产品入口只暴露 `rss`，不暴露 `fixture-rss`/`fixturePath`。
- **可观察验收**（最多三条）：
  1. 打开"新建来源"时页面读取 `GET /api/v1/source-definitions`，按 `source.rss@1` manifest 的 configurationSchema 渲染字段（`feedUrl` 必填、`scheduleIntervalMs` 可选默认 30 分钟，清空即关闭定时）；Catalog 不可用时表单显示错误并提供重试，不回退到硬编码字段。
  2. "测试配置"提交 `POST /api/v1/source-config-probes` 并轮询 `GET /api/v1/source-config-probes/:jobId`（间隔约 1.5s、上限约 30s），展示抓取条数、样例标题、耗时或失败原因；全程不产生 Source、不写事实数据。"保存来源"只创建停用 Source，不再自动启用。
  3. 来源列表对停用来源提供"启用"、对启用来源提供"停用"（同一 activation command，`baseRevisionId` + `Idempotency-Key`）；conflict 时提示冲突并刷新列表。
- **依赖**：第 3 切片后端（probe POST/GET、同步预校验、Worker 执行）、`GET /api/v1/source-definitions` Catalog 路由、`createSourceCommand`/`sourceActivationCommand` 合同、React Hook Form + Zod、shadcn 基础组件与组件实验室登记机制。
- **受影响合同**：contracts 新增 `sourceDefinitionManifestSchema` 与 Catalog 页响应 DTO（此前 Catalog 页响应只在 API 内部拼装，Web 读取需要版本化公开合同；manifest 结构与 `packages/application/src/catalog.ts` 现有投影一致，不新增字段）；transport-http 新增 `listSourceDefinitions`、`createSourceConfigProbe`、`getSourceConfigProbe`。不改 probe/activation/Prisma 合同。
- **预计核心文件**：`packages/contracts/src/index.ts`、`packages/transport-http/src/index.ts`、`apps/web/src/app/page.tsx`、`apps/web/src/components/cosmos/source-form.tsx`、`apps/web/src/components/cosmos/source-actions.tsx`、`apps/web/src/component-lab/registry.tsx`、`e2e/browser/ingest.spec.ts`、`e2e/component-lab/source-form.spec.ts`、`docs/spec/interfaces/0005-web-client.md` 及各层测试。
- **仍有后果的假设**：定时字段沿用 `config.scheduleIntervalMs` 现有消费路径，不冻结独立调度 Trigger 合同；probe 轮询上限后仍可手动重新"测试配置"；`停用` 操作随同一 activation command 一并暴露，不新增合同。
- **验证层级**：contracts/transport-http focused tests；组件实验室 spec；浏览器 e2e（新配置流程串联受控 RSS）；全仓 `typecheck`、`test`、`docs:check`、`git diff --check`。真实公网 RSS 探测、Docker 不在本切片（未运行）。
- **实施状态（2026-09-02）**：本切片已在 `.worktree/web-config-flow` 完成实现并通过全部本地门禁。页面接线完成后：打开表单读取 `GET /api/v1/source-definitions` 并定位 `source.rss@1`，表单按 manifest 的 string/integer 字段渲染（未知类型不渲染、无硬编码回退）；“测试配置”先触发 Zod 校验，再 POST probe 并按 1.5s 轮询 GET（上限 30s），`succeeded` 展示条数/耗时/样例标题/更多内容提示，`failed_terminal`/`cancelled` 显示错误文本，超时显示可重试提示；“保存来源（停用）”只创建默认停用 Source；来源列表行内提供启用/停用（幂等键 `web-activation:<id>:<revisionId>:enable|disable`），409 conflict 提示版本冲突并刷新列表。实现补充记录：probe 与保存提交同一份 config（含可选 `scheduleIntervalMs`，分钟输入 × 60000 换算，1–44640 分钟对应 canonical 1000–2678400000ms 边界）；任一表单字段变化或重新打开表单都会立即作废旧探测结果，避免旧结果误导保存决定；Feed URL 输入 id 由 `#source-feed-url` 变为 `#source-config-feedUrl`（字段由 manifest 驱动生成），定时字段 id 为 `#source-schedule-interval`。组件实验室为 SourceForm 登记 `definitionState`/`probeState` 两个控件与 probe-success/definition-error 两个合成场景（实验室仍无任何 Product API/SSE 请求），SourceActions fixture 补充启停回调。文档同步 `docs/spec/interfaces/0005-web-client.md`（流程、输入/输出、状态、转换、验收与非目标）。
- **验证记录（2026-09-02，全部实际运行）**：
  - `bun run typecheck`（全仓，含 Web/Apps/Packages）：通过。
  - focused：`bunx vitest run packages/contracts packages/transport-http`：3 文件 / 32 用例通过（含新增 catalog manifest/page DTO 与 probe POST/GET transport 用例）。
  - `bun run test` 全量：36 文件 / 285 用例通过；其中一轮出现 2 个组件实验室 registry 用例失败（场景 props 缺新控件值），修复后复跑通过；另有一次 `bun run test` 出现既有 SQLite 超时/EBUSY 抖动（与 `PROJECT-STATUS.md` 记录的 master 环境固有问题一致），重跑全绿。
  - `bun run db:generate`、`bun run build`：通过（新 worktree 首次构建，Next standalone 产物完成）。
  - `COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser:component-lab`：13/13 通过（新增 catalog/probe 反馈场景回归）。
  - `COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser`：8/8 通过；ingest 流程更新为“读取 catalog → 测试未保存配置（Worker 真实抓取受控 RSS 返回 3 条与样例标题）→ 保存停用 → 行内启用 → 手动录入 → Feed/Story → 搜索 → 移动端溢出”，console/page error/request failure 仍为 0。
  - `BUN_BINARY=<真实 bun.exe> bun run test:e2e`：4 文件 / 4 场景通过（Node 进程 E2E 无回归；Windows 下 `BUN_BINARY` 必须指向真实 bun.exe，npm shim 会 ENOENT）。
  - `bun run docs:check`：通过，checkedFiles=302；`git diff --check`：通过。
  - 未运行：真实公网 RSS 探测/录入、Docker/Compose、Windows Node smoke（`scripts/smoke-node.ps1`）、发布部署。Docker CLI 本机不可用。
- **维护者实测诊断与修复（2026-09-02，同日）**：维护者在本 worktree 以 `bun run dev` 实测发现两个错误——页面出现"服务请求失败（HTTP 500）"，向未保存配置 Probe 提交合法 RSS 配置（`https://www.ruanyifeng.com/blog/atom.xml`）时前端显示 400。API 结构化日志（`.cosmos/logs/api.jsonl`）定位根因：
  1. 500 与 400 同源：dev 数据根 `.cosmos/cosmos.sqlite` 未应用 migration，业务表（Source/Job/DomainEvent 等）不存在。页面初始 Feed/Sources/SSE 查询命中缺表 → Prisma 错误 → HTTP 500；probe 请求先通过同步预校验（证明用户配置合法），随后 `createConfigProbeJob` 落库命中缺表 → 存储异常被 `sourceCommandError` 兜底映射为 **400 `validation_failed`**，把服务端故障伪装成客户端配置错误，误导排查方向。
  2. 代码修复（`apps/api/src/app.controller.ts`）：新增私有 `validateSourceDefinition`——四个写端点（createSource/updateSource/activateSource/createSourceConfigProbe）的目录可用性与 canonical schema 预校验失败就地转为 400 `validation_failed`（既有测试锚定的契约不变）；`sourceCommandError` 的最终兜底由 400 改为 **500 `internal_error`**，存储/未知系统错误不再伪装成 400。新增单元测试：probe 落库抛普通 Error → `InternalServerErrorException`（API focused 26/26 通过）。
  3. 环境修复：dev 库当时只含 FTS5 影子表（启动时由受控 SQL Adapter 自动创建）、无 `_prisma_migrations`，`migrate deploy` 以"schema 非空且无基线"拒绝执行。确认库内无业务数据后，将原库重命名保留为 `.cosmos/cosmos.sqlite.bak-empty-fts-only`，重新 `bun run db:migrate` 全量建表并 `db:status` 确认 up to date。维护者实测配置在迁移后的库上以临时 API 实例验证：`POST /api/v1/source-config-probes` 返回 202 + queued Job 快照（该实例随后关闭；这条 Job 留在 dev 库中，Worker 启动后会真实抓取阮一峰 Feed，属预期）。
  4. 环境说明：本机 4310/4312 端口被 QQ 进程占用，`bun run dev` 的端口发现会自动跳到可用端口，无需手动配置；诊断过程中曾误将 curl 探测打到 QQ 的本地服务上（得到无意义 HTTP 200），已用 API 日志证据纠正。
  5. 修复后门禁复跑：全仓 `typecheck` 0 错误、全量 `bun run test` 36 文件/286 用例通过、`bun run docs:check` 302 文件通过、`git diff --check` 干净。Node E2E 与浏览器 E2E 未受影响（未改动运行时序）。

### 切片：两块固定看板与来源健康（2026-09-03，实施顺序第 5 步）

- **生命周期阶段**：实施方案已与维护者对齐并拍板三项决策——实施在 `.worktree/boards-source-health` 分支 `feat/t02-boards-source-health` 进行；durable 成功终态事件补发纳入本切片；看板布局沿用现有骨架（主栏 Feed + 侧栏健康看板）做增强。本切片达成“配置与看板”Checkpoint 的 Web/调度可解释部分。
- **连贯目标**：让用户在 Web 上从两块固定最小看板（“最新内容 Feed” + “来源健康”）读到 Worker 抓取结果与每个来源的调度健康；确认只有已启用且配置了定时的 Source 才参与定时调度，并把 SSE/Run/Job 状态解释为用户可读的看板文案。
- **可观察验收**（最多三条）：
  1. 来源健康看板逐行解释启用徽章、定时语义（启用+定时“每 N 分钟自动抓取”、启用无定时“未配置定时，仅手动录入”、停用“已停用，定时抓取暂停”或“已停用”）、上次运行时间与最近错误；启停与手动录入仍在行内完成。全部投影自既有 `SourceSnapshot` 字段，无合同新增。
  2. 停用/未配置定时的来源不产生 schedule Run（调度循环提取为 `apps/worker/src/scheduling.ts` 并以 focused 测试钉住）；一个来源排队失败不影响其它来源。
  3. Web 只监听存储层实际发出的 SSE 事件类型（`run.queued.v1`、`run.retry_wait.v1` 等修正后的清单）；durable Workflow Run 到达终态时补发 `run.succeeded.v1`/`run.failed.v1`/`run.cancelled.v1`（与 legacy `completeRun` 同类型同 payload，幂等键 `workflow-run:<id>:<status>`），零新增内容的成功 Run 也会刷新来源健康。
- **依赖**：Task 02 配置优先切片（`sourceDefinitionRef` 合同、activation command）、schema 驱动 Web 配置流程切片（表单定时字段、行内启停）、Worker durable Ingest 与 `IngestWorkflowControlService.enqueue`、存储层 domainEvent 复合唯一约束 `(workflowRunId, idempotencyKey)`。
- **受影响合同**：无新增/修改的公开 DTO 或 Prisma schema/migration。事件合同 `run.succeeded.v1`/`run.failed.v1`/`run.cancelled.v1` 的 payload 与既有 legacy `completeRun` 一致（`{runId, status, error}`），只是 durable 路径此前缺失发射；`appendWorkflowRunFailedEvent` 既有幂等键 `workflow-run:<id>:failed` 保持不变并被复用。
- **实现偏差**：方案原计划只修 Web 幻影监听；实施时确认 durable 路径成功终态完全无事件（失败仅有 host store 的 `failWorkflowRun`），零新增成功会导致“上次失败红字不消失”，经维护者批准把终态事件补发纳入本切片。发射点在 `PrismaWorkflowBackend` 的两个 Kernel 状态保存路径（事务内、仅 `updated.count===1` 时追加），复用 host store 的幂等键约定防重放；调度门禁同时从 `main.ts` 内联闭包提取为可测模块。
- **实现补充（dev 启动迁移，2026-09-03 同日）**：维护者在本 worktree 实测 `bun run dev` 再次遇到页面 500——新 worktree 无 `.cosmos` 数据根，`scripts/dev.ts` 直接拉起 API/Worker，API 启动自动创建只含 FTS5 影子表的 SQLite（无业务表、无 `_prisma_migrations`），此后 `migrate deploy` 以“schema 非空且无基线”拒绝（与 2026-09-02 诊断同源）。修复分两半：坏库（仅影子表，已核实无业务数据）改名保留为 `cosmos.sqlite.bak-shadow-only-20260903` 后重新 `db:migrate`；`scripts/dev.ts` 在拉起任何服务前先执行 `scripts/prisma.ts migrate deploy`（数据根环境一致，失败即拒绝启动），使每个新 worktree 的首次 dev 都在已迁移库上运行。
- **实现补充（来源健康 lastError 投影修复，2026-09-03 同日）**：维护者用两个 404 的 RSS URL 实测发现：页面出现“录入运行失败”提示，但来源健康没有红色错误行。诊断（读隔离库证据）：两条 durable failed run 的 kernel state 含 `state.error="RSS fetch failed with HTTP 404."`、本切片补发的 `run.failed.v1` payload 也携带该错误，但 `workflowRun.errorMessage` 为 `null`——kernel 失败终态只经 `PrismaWorkflowBackend` 状态保存更新 status/finishedAt，从不写 `errorMessage`（只有 dead-letter 恢复路径的 `failWorkflowRun` 会写），而来源健康 `lastError` 读的正是该字段。这是 Task 07 durable 路径合入以来的预置投影缺口，此前失败连事件都没有，故从未暴露。修复：`toUpdateData` 持久化 `state.error ?? null`（非失败保存保持 null，不会让运行中来源误显错误）；行为测试锚定“失败行写错误文本、运行中行保持 null”。修复前已存在的旧失败 run 行不回填，重新录入或下一轮定时抓取即会写入。
- **验证补充（2026-09-03 修复后复跑）**：`bunx vitest run packages/storage-prisma` 4 文件/63 用例通过（含新增 errorMessage 断言；过程中一轮整目录并行出现 4 个用例失败且单文件复跑全绿、目录复跑全绿，与 PROJECT-STATUS 记录的本机 SQLite 并发抖动特征一致，未复现第二次）；全仓 `typecheck`、全量 `bun run test` 37 文件/292 用例通过。真实浏览器复验（重启 dev 后重跑坏 URL 来源）由维护者执行。
- **预计核心文件**：`apps/worker/src/scheduling.ts`（新）、`apps/worker/src/scheduling.test.ts`（新）、`apps/worker/src/main.ts`、`packages/storage-prisma/src/workflow-backend.ts`、`packages/storage-prisma/src/workflow-backend.test.ts`、`apps/web/src/app/page.tsx`、`apps/web/src/components/cosmos/source-actions.tsx`、`apps/web/src/component-lab/{registry,product-fixtures}.tsx`、`e2e/browser/ingest.spec.ts`、`docs/spec/interfaces/0005-web-client.md`。
- **验证层级**：worker scheduling focused；storage-prisma focused（终态事件行为测试）；全仓 `typecheck`、`test`；浏览器 E2E（新增健康语义断言）；component-lab 浏览器回归；Node 进程 E2E 回归；`docs:check`、`git diff --check`。真实公网 RSS 定时抓取、Docker、发布部署不在本切片（未运行）。
- **验证记录（2026-09-03，全部实际运行）**：
  - `bun run typecheck`（全仓）：通过。
  - focused：`bunx vitest run apps/worker/src/scheduling.test.ts` 3 用例通过（停用/无定时不排队、间隔到期排队、单来源失败隔离）；`bunx vitest run packages/storage-prisma` 4 文件/63 用例通过（含 3 条新终态事件测试：成功发射、失败映射共享幂等键、取消映射与租约路径、重放防重、非终态不发射）。
  - 全量 `bun run test`：37 文件 / 292 用例通过，无既有 SQLite 抖动复现。
  - `bun run build`：通过（packages、API、Worker、Next standalone）。
  - `COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser`：8/8 通过；ingest 流程新增两条断言——保存停用后来源健康显示“已停用，定时抓取暂停”，行内启用后显示“每 30 分钟自动抓取”；console/page error/request failure 仍为 0。
  - `COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser:component-lab`：13/13 通过（SourceActions 新增 untimed 场景）。
  - `BUN_BINARY=<真实 bun.exe> bun run test:e2e`：4 文件 / 4 场景通过（Node 进程 E2E 无回归）。
  - `bun run docs:check`：通过，checkedFiles=304；`git diff --check` 干净。
  - 未运行：真实公网 RSS 定时抓取、Docker/Compose（本机无 Docker CLI）、Windows Node smoke（`scripts/smoke-node.ps1`）、发布部署。
- **Checkpoint 状态（配置与看板）**：配置入口、API、Worker 调度与两块看板已在隔离环境（受控本地 RSS、隔离 Data Root）形成可观察链路，focused/integration/browser 门禁分别通过；真实 RSS URL 产品 E2E 仍未通过，fixture/受控 HTTP 结果不写成应用可用。

 ### 实施顺序与检查点（复用本 Task，不新增 Task 编号）
1. 先以 contracts/API focused tests 固定 `sourceDefinitionRef`、`operationId`、revisionId、保存默认停用、完整配置替换、独立启用和错误映射；第 4–7 项实现建议先保持待冻结，不修改媒体公共合同。
2. 实现配置 API/持久化垂直切片：按显式 manifest 映射保存 Source，迁移旧 kind 前先预检，保存默认停用、独立启用/停用、完整配置替换、过期 revision 拒写和同步配置校验；产品路径只开放 `rss`，测试必须不写入事实数据。
 3. 接入未保存配置测试的独立垂直切片：定义 `source-config-probe` Job kind、`SourceConfigProbeJobSnapshot` POST/GET 状态查询、result、repository 创建与幂等、Worker acceptedKinds/dispatcher、Probe port、输入脱敏和 focused 无副作用验收；当前 `source-probe` 只处理已保存 Source，不得复用。
 4. 在上述后端能力完成后实现 schema 驱动 Web 配置流程，按“选择 `rss` → 填实际 `feedUrl` → 校验 → 测试未保存配置 → 保存为停用 Source → 单独启用”串联真实端点，不暴露 `fixture-rss`/`fixturePath`。
 5. 接入两块固定最小看板和来源健康；确认已启用 Source 才能调度，SSE/Run/Job 状态可解释。

**Checkpoint：配置与看板**

- 配置入口、API、Worker 调度和看板在隔离环境形成可观察链路；focused、integration、browser 门禁分别通过。
- 真实 RSS URL 产品 E2E 尚未通过前，不把 fixture/受控 HTTP 结果写成应用可用。

5. 单独完成媒体边界实现设计与必要的稳定文档/ADR：受控流式 Blob 端口、RSS 条目媒体提取/下载、安全/限额/失败状态、domain bytes 与 Workflow BlobRef 映射；设计通过前不改公共媒体字段。
6. 按批准设计实现阅读与媒体路径，最后用用户填写的实际 RSS URL 完成断网产品 E2E；媒体未保存时展示真实降级，不伪造离线成功。

### 切片：媒体边界设计 + 阅读与媒体路径实现（2026-09-03~04，实施顺序第 5/6 步完成）

- **生命周期阶段**：媒体边界设计经用户评审拍板，接受为 [`docs/proposals/media-boundary-v1.md`](../../../docs/proposals/media-boundary-v1.md)（accepted）；稳定文档同步 PRD ING-008、架构 §6.4、ADR-0005。实现已合入 master（2026-09-04，分支 `feat/t02-media-boundary`），公共媒体字段按批准变更已生效；docs/spec 文档同步待随断网验收一并收口。
- **冻结边界摘要**：RSS Connector 纯提取条目自身媒体（enclosure、media:content/thumbnail、正文媒体标签），不抓 `webUrl` 全文；Application 统一媒体获取步骤在 Worker fetch 边界受控下载图片（仅 image/enclosure+image mime），音视频与其它类型只存元数据+外链；全局预算默认 10MB/文件、50MB/Run（Run=一页），顺序执行、页内同 URL memo；下载经既有 domain bytes → Workflow BlobRef → Storage → Asset.storageKey 链路，公共 4 态与 Prisma 表结构不变，新增可空 `errorMessage` 最小透传（`Asset.errorMessage` 列已存在，无 migration）；降级显示真实状态+原因+原文外链，不自愈（修订不变不重试，重试/回填/per-source 策略归 ING-009）；`media-download` 作为公开 Connector 能力门控，fixture/probe 不触发下载。
- **实现摘要（2026-09-04）**：`packages/domain`/`contracts` 增加可空 `errorMessage`；`plugins/rss` 纯提取（enclosure/media:content/thumbnail+media:group/正文 img/audio/video，mime/medium 分类、相对 URL 解析、URL 去重）并声明 `media-download`；新增 `packages/application/src/media-acquisition.ts`（预算 10MB/50MB 常量、逐块计数超限中止、Content-Length/声明预检、魔数嗅探兜底、手动重定向 ≤3 复检、DNS 全公网校验含 IPv6、allowlist、单媒体超时、页内 memo、单媒体失败降级不打断条目、外层 abort 上抛）；接线 durable `source.fetch@1` 与 legacy `IngestionService`（能力门控）；storage 写入并投影 `Asset.errorMessage`；worker 读取 `COSMOS_MEDIA_ALLOWED_HOSTS`（默认空=拦截私网）；Web StoryPanel 附件区渲染 saved 站内图与 metadata_only/skipped/failed 降级文案+errorMessage+原文外链。
- **验证记录（2026-09-04，全部实际运行）**：全仓 `bun run typecheck` 通过；全量 `bun run test` 38 文件/321 用例通过（新增媒体获取 18、rss 提取 4、contracts errorMessage 3、fetch action 媒体接线 3、storage errorMessage 投影断言、workflow completion/product Run 计数 1）；`bun run build:packages` 通过；`BUN_BINARY=<真实 bun.exe> bun run test:e2e` 4/4；`COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser:component-lab` 13/13；`COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser` 8/8。维护者手动实测：真实 RSS 源图片下载并站内渲染成功；音视频受控源（`fixtures/rss/media-av.xml`）视频/音频仅元数据+外链符合预期；国内真实音频源（喜马拉雅 剧谈社 feed，audio/x-m4a）可用。
- **未运行/后置**：断网产品验收（2026-09-04 通过，Playwright 路由拦截模拟外部不可达，saved 图片从站内 `/api/v1/assets/:id` 加载成功）；Docker/Compose（本机无 Docker CLI）、发布部署明确不运行；docs/spec 已同步收口（errorMessage + 媒体测试说明）。**真实双源联网媒体验收已通过（2026-09-04，网络授权后隔离栈实测）**：爱范儿（https://www.ifanr.com/feed）与 阮一峰（https://www.ruanyifeng.com/blog/atom.xml）两源均 Run 成功并保存本地图片——爱范儿 20 条目/79 saved + 332 skipped（run 预算 50MB 用尽后按设计降级，errorMessage 保留外链）；阮一峰 3 条目/100 saved/0 降级；两源各抽一张 saved Asset 经 `GET /api/v1/assets/:id` 回读字节成功（image/png、image/webp）。

本切片不扩大为通用 Workflow 编辑器、可配置 Board/Section/Block、登录 UI、其它平台 Connector 或历史媒体回填。

### 发现：Durable workflow completion 与 Run 计数缺陷（2026-09-04，已修复）

- **现象**：`bun run test:real:aihot` 和 Bilibili hot 真实源验收里 Run 成功，但 API 返回 `itemCount = 0`；Connector 实际返回了数据（AI HOT 50 条，HTTP 200），首次观察时 Run 停在 waiting，没有继续执行 `library.ingest`。POST /api/v1/sources/:sourceId/runs 创建的是 durable WorkflowRun，不是 legacy Job。

- **影响**：通过 durable path 的真实采集已经保存 Entry，但 Run 状态和计数对外显示错误；若 completion 未恢复，AI HOT 和 Bilibili 真实源验收无法完成。

- **定位**：Workflow completion 创建后必须由 completion dispatcher 领取并交给 Kernel 恢复；Kernel 保存恢复状态时统一写入 `resumeRequired` 和 Run 状态。Run 行的 product 快照此前只记录 queued 状态，没有在 Workflow 输出 completed 时同步 `itemCount`、`createdEntryCount` 和 `revisedEntryCount`。

## Verification

已完成：

- Durable workflow 修复：`bunx vitest run packages/storage-prisma/src/workflow-backend.test.ts packages/storage-prisma/src/workflow-host-store.test.ts packages/application/src/workflow-host-runtime.test.ts packages/worker/src/workflow-ingest.test.ts` 通过（4 个文件 / 64 个用例）。
- `bun run typecheck:storage`、`bun run build:storage`、`bun run build:worker`、`bun run build:api`：通过。
- 真实源验收：`COSMOS_ALLOW_REAL_NETWORK=true bun run test:real:aihot` 通过；Run 成功，API 返回 `itemCount = 50`。
- 真实源验收：`COSMOS_ALLOW_REAL_NETWORK=true bun run scripts/e2e/real-source.ts bilibili-hot` 通过；Run `run_3411f039-9669-4191-a043-03c33f59688d` 成功，API 返回 `itemCount = 20`。
- 首次 Bilibili feed 真实源验收因 OpenCLI profile 未登录 Bilibili 返回空数组（`itemCount = 0`）；通过 `opencli bilibili login` 完成登录后复跑通过。
- 真实源验收：`COSMOS_ALLOW_REAL_NETWORK=true bun run scripts/e2e/real-source.ts bilibili` 通过；Run `run_f1c4cadc-84fe-4a1e-a6dc-281e8f63a394` 成功，API 返回 `itemCount = 20`。
- Bilibili/AI HOT 调度 focused 测试：`bunx vitest run apps/worker/src/scheduling.test.ts` 通过（4 用例），覆盖两源到期后按各自 interval 进入 scheduled Run 队列。

- `bun install`：通过。
- `bun run db:validate`、`bun run db:generate`：通过，Prisma schema 合法并生成 Prisma Client 6.19.3。
- `bun run typecheck`、`bun run build`、`bun run lint:web`：通过。
- `bun run test`：通过，覆盖 domain、Blob、RSS、Transport、API SSE、Prisma/FTS、Job lease、Worker、schedule 和分页过滤。
- `bun run db:migrate`：在隔离 Data Root 上通过。
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-node.ps1`：通过 Node API/Worker、migration、受控 HTTP RSS、创建后激活、queued Run、Probe、Search、Story 和 SSE 回放。
- `bun run test:e2e`：通过，4 文件/4 场景覆盖受控 RSS ingest、Worker recovery、调度失败隔离与 Admin 生命周期。
- `powershell -NoProfile -Command '$env:NODE_ENV=$null; bun run test:browser'`（`COSMOS_E2E_WEB_PORT=4183`）：通过，8/8 覆盖 RSS Feed URL 配置、创建后激活、queued Run、Feed/Story、console/page error/request failure 和主题；默认 4173 被用户运行的其它仓库服务占用，未终止该进程。
- `bun run test:browser:component-lab`：通过，12/12；组件实验室仅验证合成 SourceForm 的 `name/feedUrl` props、控件同步和提交阻断，无 Product API/SSE 请求；旧 `fixturePath` 选择器已迁移到 `feedUrl/#source-feed-url`。
- `bun run docs:check`、`git diff --check`：通过，`checkedFiles=298、ailures=[]、无空白错误。
- **2026-09-04 补充验证**：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-node.ps1 通过（媒体边界合入后 Node 生产路径确认无回归）；un run test:browser -- --grep offline 通过（断网验收，saved 图片从站内加载）；un run docs:check 通过（310 文件）。

实现阶段至少分开报告：

- contracts/domain/application focused tests。
- Prisma migration、隔离 Data Root、FTS5/BM25 和 Blob Store tests。
- Connector fixture 与真实 RSS 验收。
- Worker lease/retry/restart/idempotency tests。
- API/Transport/SSE tests。
- Next.js browser/Product 验收。
- Bun 开发与 Node 生产兼容性验收。
- Docker/Compose 和三种宿主模式验收。
- Phase 1B Connector 配置、Probe 无副作用、Job 查询、AI HOT cursor、Bilibili/OpenCLI 场景和 Browser Bridge 前置条件验收。

2026-09-04 补跑：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-node.ps1` 通过（媒体边界合入后 Node 生产路径确认无回归）；断网产品 E2E（`e2e/browser/offline.spec.ts`）通过。当前仍未运行：Docker/Compose（本机无 Docker CLI）、真实公网 RSS/RSSHub 定时抓取、非 Windows 平台 smoke 和长时间故障恢复验收。

## Follow-ups

- 确认 package manager workspace 组织方式，以及 Bun/Node 的构建、测试和生产脚本。
- 为 Prisma/SQLite 的 FTS5 migration、触发器和 Raw SQL Adapter 创建实现 Task/ADR。
- 细化 Service Endpoint 的认证、Blob/Artifact 访问、SSE 恢复和版本协商。
- 在 Phase 1 完成后再决定 Story 聚类、Topic、Board 编辑器和推荐的切片顺序。
- 在增加更多平台 Adapter 前，先验证 Connection/Secret/State、多个采集计划和通用 Trigger/Workflow/Action Runtime 的边界。
- 为 Entry → Story 的异步知识 Pipeline 建立独立 Task，先用确定性规则和 fake LLM 验证 Proposal、Evidence、用户确认和重算。
- 为脚本优先的 Workflow Runtime 建立独立 Task，定义 Workflow Context、Action 调用、Child Workflow、Journal、Graph/IR 转换和 kind/tags。
- 为 Research Workflow 建立独立 Task，定义 Research Request、触发原因、外部渠道访问、结果重新入库和失败恢复。
- 为推荐系统建立独立 Task，区分外部候选、Admission、Ranking、Impression、Feedback 和 LLM 异步特征。
- 为 Knowledge Manager 建立独立 Task，定义 Web Chat、`cosmos cli`、ingest 调用和共享 `nb-memory` 的 Service/Capability 边界。
- 为个性化配置建立独立 Task，先验证自然语言记忆、行为观察到程序配置的转换，不引入逐字段 provenance 账本。
- 评估 `pi-ai` 与 `neuro-agent-harness` 的 ModelRuntime 迁移门槛，不提前把 Harness 接入 Phase 1。
- 选择 Desktop Shell 技术并定义本地生命周期；不改变当前 Transport 与领域边界。
- 在 Phase 1B 后评估 Bilibili `dynamic`、搜索、用户视频和更多 OpenCLI 场景，不把它们提前变成通用命令转发。
