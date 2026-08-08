# Phase 1：RSS 录入与离线查询

## User Request / Topic

在完成技术选型和架构审查后，先更新文档，再进入项目初始化和脚手架搭建。第一条真实端到端切片使用 RSS/RSSHub 与本地 fixture，并为服务器部署优先、客户端模式和客户端与服务分离模式保留兼容边界。

## Goal

交付一条可验证的最小垂直链路：

```text
RSS/RSSHub 或 fixture
  -> Source / Trigger / Flow / Action
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
- 最小 `domain` 与 `application`：Source、Trigger、Flow、Action、Run、Step、Job、Observation、Entry、EntryRevision、Asset 和 Story projection。
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
  -> Flow Run / Step / Job
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
- Provider、Adapter、ConnectionInstance、SourceInstance、Trigger 和 FlowBinding 分开；一个连接可以复用多个采集计划。
- 凭证建议由 Cosmos SecretStore 统一管理，非秘密 cursor、ETag、分页 token 和限流状态由命名空间化 ConnectorStateStore 管理。
- “动态每 30 分钟、推荐流每 2 小时”应建模为同一连接下的两个独立采集计划，各自拥有 Trigger、Flow、checkpoint、预算、错误和重试边界。
- Entry → Story 保留“同步确定性入库 + 异步知识 Pipeline”两条路径；LLM 通过 Proposal、Evidence、Capability、预算和审批约束参与，不直接改写 Observation。
- 后续 Story 跨来源聚类需要 StoryMembership；推荐需要区分外部候选、Admission 和 Cosmos Ranking，普通 Feed 不能依赖在线 LLM。
- 本轮确认知识管理者是共享 `nb-memory` 之上的高权限系统角色，可以通过 Web Chat、`cosmos cli` 和 ingest/research Workflow 参与；它不是单一 Session。
- 个性化配置方向是“Agent 记忆 + Cosmos 观察到的用户行为 + 未来其它信号 → 程序可读配置”，当前不要求逐字段 provenance，也不把平台推荐信号独立建模为用户偏好。
- `nb-memory` 调研已记录在 [`docs/research/2026-08-08-nb-memory-research.md`](../../research/2026-08-08-nb-memory-research.md)；接入、Node 生产兼容性和行为映射均后置，不扩大本 Task。

这些方向暂不扩大本 Task 的实现范围。继续增加平台 Adapter 前，应先单独建立 Connection/Secret/State、Job + Workflow Runtime、持久子任务、Proposal/Provenance 和 `nb-memory` Adapter 的实现 Task。

## Verification

已完成：

- `bun install`：通过。
- `bun run db:validate`、`bun run db:generate`：通过，Prisma schema 合法并生成 Prisma Client 6.19.3。
- `bun run typecheck`、`bun run build`、`bun run lint:web`：通过。
- `bun run test`：通过，覆盖 domain、Blob、RSS、Transport、API SSE、Prisma/FTS、Job lease、Worker、schedule 和分页过滤。
- `bun run db:migrate`：在隔离 Data Root 上通过。
- `pwsh -NoProfile -File scripts/smoke-node.ps1`：通过 Node API/Worker、migration、queued Run、fixture、Search、Story 和 SSE 回放。
- Playwright 浏览器验收：通过来源创建、queued Run、SSE、Feed、搜索、URL-free Story/Revision/Observation 和健康检查。
- 20 份仓库 Markdown、链接、代码围栏和 `git diff --check`：通过。

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

当前仍未运行：Docker/Compose、真实 RSS/RSSHub、跨平台 Node 和长时间故障恢复验收。

## Follow-ups

- 确认 package manager workspace 组织方式，以及 Bun/Node 的构建、测试和生产脚本。
- 为 Prisma/SQLite 的 FTS5 migration、触发器和 Raw SQL Adapter 创建实现 Task/ADR。
- 细化 Service Endpoint 的认证、Blob/Artifact 访问、SSE 恢复和版本协商。
- 在 Phase 1 完成后再决定 Story 聚类、Topic、Board 编辑器和推荐的切片顺序。
- 在增加更多平台 Adapter 前，先验证 Connection/Secret/State、多个采集计划和通用 Trigger/Flow/Action Runtime 的边界。
- 为 Entry → Story 的异步知识 Pipeline 建立独立 Task，先用确定性规则和 fake LLM 验证 Proposal、Evidence、用户确认和重算。
- 为推荐系统建立独立 Task，区分外部候选、Admission、Ranking、Impression、Feedback 和 LLM 异步特征。
- 为 Knowledge Manager 建立独立 Task，定义 Web Chat、`cosmos cli`、ingest 调用和共享 `nb-memory` 的 Service/Capability 边界。
- 为个性化配置建立独立 Task，先验证自然语言记忆、行为观察到程序配置的转换，不引入逐字段 provenance 账本。
- 评估 `pi-ai` 与 `neuro-agent-harness` 的 ModelRuntime 迁移门槛，不提前把 Harness 接入 Phase 1。
- 选择 Desktop Shell 技术并定义本地生命周期；不改变当前 Transport 与领域边界。
- 在 Phase 1B 后评估 Bilibili `dynamic`、搜索、用户视频和更多 OpenCLI 场景，不把它们提前变成通用命令转发。
