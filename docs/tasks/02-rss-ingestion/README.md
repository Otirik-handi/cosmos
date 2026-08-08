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
- 真实 BiliBili、X、Telegram、公众号、IMAP 或 QQ 接入。

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

当前仍未运行：Docker/Compose、真实 RSS/RSSHub、跨平台 Node 和长时间故障恢复验收。

## Follow-ups

- 确认 package manager workspace 组织方式，以及 Bun/Node 的构建、测试和生产脚本。
- 为 Prisma/SQLite 的 FTS5 migration、触发器和 Raw SQL Adapter 创建实现 Task/ADR。
- 细化 Service Endpoint 的认证、Blob/Artifact 访问、SSE 恢复和版本协商。
- 在 Phase 1 完成后再决定 Story 聚类、Topic、Board 编辑器和推荐的切片顺序。
- 评估 `pi-ai` 与 `neuro-agent-harness` 的 ModelRuntime 迁移门槛，不提前把 Harness 接入 Phase 1。
- 选择 Desktop Shell 技术并定义本地生命周期；不改变当前 Transport 与领域边界。
