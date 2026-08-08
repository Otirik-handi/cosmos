# Cosmos Project Status

> 截至 2026-08-08。

## 一句话结论

Cosmos 已建立公开 GitHub 仓库和 v0.10 Phase 0 架构基线，并完成 Phase 1 服务器模式的最小可验收闭环：fixture RSS → 持久 Ingest Job → Observation/Revision/Asset/Story → Prisma/SQLite/FTS5 → Nest API → Next Feed/Search/Story。Docker 容器验收和真实 RSS/RSSHub 验收仍待环境与来源条件。

## 已完成

- 初始化本地 `master` 分支。
- 建立需求、架构、ADR、研究和 Task 文档体系。
- 逐字保存项目初始需求与本轮需求。
- 整理完整产品需求文档，建立需求编号、阶段范围、验收条件、主要界面和原始需求追踪。
- 完善根目录 README，作为项目介绍、能力概览、使用场景和路线入口。
- 形成 Source / Trigger / Flow / Action、信息库、Story、Topic、Workspace、Artifact、看板和后续投递的架构草案。
- 新增独立信息领域模型，拆开同一事件聚类、宽泛相关推荐、Topic 组织和 Workspace 持续体验。
- 明确 Timeline 是视图、Spotlight 是展示决定、“精华”是 Board 策展角色。
- 整理本地单用户阶段的混合召回、可解释排序和多样性推荐基线。
- 接受 `Subject -> Topic` 与 `Feature -> Workspace`。
- 确认每个 Entry 默认拥有一个主 Story，Story 以 event/document/media/thread 等 kind 表达规范内容，允许单 Entry Story。
- 确认 Agent 自动创建 Topic 需要至少两个不同 Story，或命中用户明确跟踪规则。
- 确认 Topic 不自动过期，人工归档后置。
- 确认人类、Agent 和系统按协作者记录 actor/revision。
- 确认 Workspace UI 按 kind 使用栏目、专题、学习计划或工作区。
- 确认核心 Story kind 保持稳定，media 等内容通过 subtype 细分。
- 确认 Topic、维护、Board 放置、Spotlight 和订阅使用独立关系。
- 确认自动 Spotlight 使用可续期 TTL，人工固定可以不设 TTL。
- 确认第一版权限与预算保持简单，只保留 actor/revision、全局日预算、单次 Run 上限和紧急保留预算。
- 确认一个 Entry 只有一个主 Story，但可以关联多个其它 Story。
- 确认 Story/Topic merge 保留 canonical ID、旧 alias 和历史引用。
- 确认 Story subtype 使用受管理注册表，核心 kind 合同保持稳定，未知 subtype 可降级读取。
- 确认 Story split 保留旧 Story 历史壳，以 `replaced_by[]` 指向全部后继，不做模糊单目标重定向。
- 确认 v1 不建立 Topic 父子层级，使用 Relation、标签或 Workspace/Board 组织。
- 确认一个 `(Topic, Story)` 只有一个当前成员角色，历史修改保存在 revision history。
- 确认 Story 当前标题、摘要、关键事实和时间范围使用不可变 Story Revision 与当前指针。
- 确认 Feed 曝光和主要反馈按 Story/surface 记录，Entry 交互在展开具体信源后补充。
- 确认 Agent 不能静默移除人类明确加入或确认的 Topic 成员。
- 确认 Workspace 输入使用多对多 binding 和可选主要锚点。
- 确认 Spotlight 使用分离信号、版本化 policy、迟滞、TTL 和人工覆盖。
- 补充 Workspace Update/Run：用户应能看到 Agent 更新状态、操作者、步骤和最近结果，运行态不与生命周期或 Board 状态混写。
- 确认 Workspace Update 使用六种状态，失败/取消保留上一成功版本，成功时原子发布。
- 确认人类接受的 Story/Workspace 字段可以保护，Agent 先生成候选 Revision。
- 确认 Read State 保存 `last_seen_revision_id`，新 Revision 派生“有更新”。
- 确认 merge 将当前用户状态解析到 canonical；split 不自动扇出状态和 Topic membership。
- 确认 Spotlight 人工覆盖绑定具体 Placement，直到用户解除；不同 kind 共用 policy 合同。
- 确认 v1 和默认产品合同面向单个本地用户，未来协作只保留 actor/revision 扩展位。
- 确认 Agent 可维护用户配置范围内的内部对象；创建外部 Source、扩大数据范围和外部发送需要显式配置/批准。
- 确认第一版不建设细粒度权限 UI 或不可信插件沙箱，只运行本地可信扩展。
- 确认 Phase 1 首条真实 Connector 使用 RSS/RSSHub，并配套 fixture Connector。
- 初步确认 React + Next.js App Router、Tailwind、shadcn/ui、React Hook Form、Zod、NestJS、Prisma + SQLite、Docker；技术选择允许在实现验证后调整。
- 初步确认 Bun 用于开发、Node 用于生产，并要求共享代码和 Worker 保持 Node-compatible。
- 初步确认服务器部署优先，同时保留客户端模式和客户端与服务分离模式；三种模式共用版本化 Service Endpoint、Command、Query、Event 和 SSE Transport。
- 初步确认 Phase 1 先直接使用 `pi-ai`；`neuro-agent-harness` 独立演进，后续通过适配合同接入；sidecar 移出 Harness Core。
- 将 Phase 1 的实现范围收紧为 RSS/RSSHub + fixture + 最小 Story projection，并建立持续 walkthrough。
- 初始化 Bun workspace、TypeScript 基线和根级 lockfile。
- 建立 `apps/web`、`apps/api`、`apps/worker`，并验证 Next.js、NestJS API 健康端点和 Node Worker 生产产物。
- 建立 `contracts`、`domain`、`application`、`storage-prisma`、`blob-store` 和 `plugins/rss` 最小包边界。
- 建立 Prisma SQLite schema、受控 FTS5 SQL、URL-free RSS fixture，以及 Dockerfile/Compose 服务器入口。
- 按 shadcn skill 初始化 `components.json`，加入 `button`、`card`、`badge` 源码组件和最小 Story Feed 页面。
- 固化 `Source`、`Run`、`Job`、`Feed`、`Search`、`Story`、`Entry`、`Revision`、`Asset`、错误、健康检查和 SSE Event Envelope 合同，并提供 HTTP Service Client。
- 完成 Prisma migration、`COSMOS_DATA_ROOT`/`DATABASE_URL` 数据边界、隔离 Data Root、内容寻址 Blob Store 和 FTS5/BM25 受控 SQL Adapter。
- 完成 fixture/RSS Connector 的 URL、无 URL、重复轮询、来源修订和媒体元数据路径；重复录入不产生重复 Entry，来源变化追加 Revision，原始 Observation 保留。
- API 已提供 Source 创建/查询/启停/测试、手动 queued Run、Run 状态、Feed、Search、Story/Entry/Revision 详情和受控 Asset 读取。
- Worker 已接入持久 Job claim、租约 token、过期接管、旧 token 拒绝、有限指数退避、schedule bucket、heartbeat 和 checkpoint。
- SSE 已提供持久 Domain Event、游标回放、`Last-Event-ID`/`after`、keepalive 和 `snapshot_required`；Web 会自动刷新并展示服务/SSE 状态。
- Web 已通过 Service Endpoint 完成来源表单、真实健康检查、队列触发、Feed、关键词/来源/时间/分页搜索和 Story → Entry → Source/Revision 展开。
- Node 生产冒烟和 Playwright 浏览器链路已通过；浏览器验证覆盖来源创建、队列触发、Feed、搜索、URL-free Story 详情和服务状态。
- 结束本次 grilling；实现级未决问题转入后置清单。
- 确认第一版聚类和相关推荐不使用 embedding。
- 将 `CONTEXT.md` 收缩为产品共同语言，只维护经常使用、跨模块或容易歧义的核心概念；实现级对象留待真实开发需要时再定义。
- 迁移并精简适用于 Cosmos 的 Agent、Task、worktree 和验证约定。
- 将 neuro-book 的通用协作流程去领域化迁移到 Cosmos：补充双语贡献指南、Issue 分流、标签清单、PR 模板和安全报告入口；未复制依赖 neuro-book 运行时代码、发布脚本或产品专用 CI 的 workflow。
- 确认 Cosmos 按 GNU Affero General Public License v3.0 only（AGPL-3.0-only）发布，并复制许可证全文到根目录 `LICENSE`。
- 补足协作主路径、远端同步、Windows worktree 清理、RSS/RSSHub 首条切片和公开贡献权利说明；GitHub Actions 仍按本阶段决定保持不变。

## 当前架构基线

以下是 v0.10 的 Phase 0 基线；后续需求仍可通过记录理由调整：

- 服务器部署优先的模块化单体；逻辑上分 Web、API 和 Worker，第一阶段不引入微服务治理或消息队列集群。
- Web 使用 React + Next.js App Router；API 使用 NestJS；UI 初步使用 Tailwind、shadcn/ui、React Hook Form 和 Zod。
- Bun 用于开发，Node 用于生产；共享包和 Worker 运行路径保持 Node-compatible。
- Prisma + SQLite + WAL 保存核心元数据、关系、任务与用户状态；FTS5/BM25、虚拟表和触发器通过受控 SQL Adapter 使用。
- 服务器、客户端、客户端与服务分离三种模式共用版本化 Service Endpoint、Command、Query、Event 和 SSE Transport；客户端不直接访问 Prisma、SQLite 或 Data Root。
- 内容寻址 Blob Store 保存原始 payload、图片和附件；Artifact Root 保存版本化生成产物，Cache Root 可重建。
- 原始 Observation 不可变，外部 URL 可选；派生分析和索引可重建并保留 provenance。
- Entry 是稳定信息条目；每个 Entry 默认拥有一个主 Story，Story 使用稳定 kind 和受管理 subtype 注册表；Topic 只组织 Story。
- Workspace 保存长期体验、维护策略和交互状态；Artifact 保存不可变的版本化输出。
- Topic、Workspace、Spotlight 和 Feed 等上层体验以 Story 为内容单位，不直接使用 Entry。
- Story 聚类与相关推荐使用不同判定；第一版推荐以显式关注、BM25、Entity/关系、时间、引用、新颖性和本地反馈为主，不使用 embedding。
- Agent 自动创建 Topic 需要两个不同 Story 或明确跟踪规则；Topic 不自动过期。
- 人类、Agent 和系统均作为协作者，每次修改记录 actor、revision、理由和关联 Run。
- 第一版预算只限制全局日额度、单次 Run 的时间/token/工具调用和紧急保留预算，超预算时降级。
- TopicMaintenanceBinding、BoardPlacement、SpotlightPlacement 和 Subscription 相互独立；自动 Spotlight 使用可续期 TTL。
- Entry 可通过 evidence_for/mentions 关联多个其它 Story；Story/Topic merge 保留 canonical ID 与 alias。
- Story split 保留旧历史壳和 `replaced_by[]`；Topic v1 不使用父子层级，Topic membership 只有一个当前角色并保存 revision history。
- Story 当前表示由不可变 Story Revision 和 `current_revision_id` 维护；历史产物引用精确 Revision。
- Feed 反馈与被排序的 Story/surface 对齐；Agent 对人类确认的 Topic 成员只能提出移除建议。
- Workspace 输入是多对多 binding，可有主要锚点；Workspace Update/Run、生命周期、内容新鲜度、Placement 和 Interaction State 分开。
- Spotlight 自动策略保存分离信号、policy/version、迟滞和 TTL，人工覆盖优先。
- Workspace Update 失败/取消不替换上一成功版本；人类保护字段优先于 Agent 候选 Revision。
- Read State 使用 `last_seen_revision_id`；merge/split 的状态迁移保持 canonical 与历史壳边界。
- v1 和默认产品合同是个人本地优先，不实现多人同步、多租户或复杂权限系统。
- Agent 内部维护受用户配置范围约束；新增外部来源、数据范围和发送行为需要显式配置/批准。
- 第一版扩展按本地可信代码处理，但继续使用 SDK/Command/Query/Event；Phase 1 从 RSS/RSSHub + fixture 开始。
- 看板优先于推送实现；推送边界仍在架构中保留。
- Phase 1 只实现一个 Entry → 一个最小 Story projection；跨来源聚类、Story merge/split、Topic 维护和完整推荐后置。
- Phase 1 直接使用 `pi-ai`；`neuro-agent-harness` 继续独立去领域化演进，稳定后再接入 Cosmos。

## 后置决定

- “分类”是稳定导航分区、自由标签，还是二者的上位概念。
- 同一 Workspace 的并发更新、重复触发合并和取消/接管语义。
- Agent 候选 Revision 的接受/拒绝界面和字段保护最小实现。
- `updated_since_last_seen` 在不同 surface、Story split 和 merge 后的投影规则。
- 显式 state migration command 的批量操作、撤销和用户确认边界。
- 文本、图片、视频、私信和历史修订的默认保留预算。
- BiliBili、X、Telegram、公众号、QQ群和 AIHOT 的合法、稳定接入方式。
- 多 Board、公网摘要链接、推送渠道和跨平台发布策略。
- Source、Trigger、Flow、Action 的产品关系已暂定，更细的实现边界等待真实用例推动。
- Bun 开发与 Node 生产在 Next、Nest、Prisma、Worker 和 Harness Adapter 上的完整兼容矩阵。
- Prisma/SQLite 的 FTS5 migration、触发器、Raw SQL Adapter 和未来存储替换边界。
- 三种宿主模式的认证、Service Endpoint、SSE 恢复、Blob/Artifact 访问和版本协商。
- Desktop Shell 的具体技术、安装/升级/卸载生命周期，以及 `pi-ai` 到 Harness 的迁移门槛。

## 尚未实现

- Docker/Compose 实际容器启动、共享卷和 healthcheck 验收；当前环境没有 Docker CLI。
- 真实 RSS/RSSHub 网络来源验收、跨平台 Node 验收和更长时间的 Worker 重启演练。
- 完整的 Source/Trigger/Flow/Action 产品配置模型；Phase 1 只实现 fixture/RSS ingest 所需最小合同。
- 去重、Story 归并、Topic 成员、分类、关系和推荐系统。
- Agent 分析、Artifact、Workspace 和交互状态。
- 看板、推送、摘要图片和网页发布。

## 验证边界

本次脚手架初始化后已完成以下 focused 检查：

- `git diff --check`：通过。
- `bun install`：通过，生成根 `bun.lock`。
- `bun run db:validate`、`bun run db:generate`：通过，Prisma schema 合法并生成 Prisma Client 6.19.3。
- `bun run typecheck`、`bun run build`、`bun run lint:web`：通过。
- `bun run test`：通过，当前 6 个测试文件、14 个测试通过，覆盖 contracts/domain、Blob、RSS、Transport、API SSE、Prisma/FTS、Job lease、Worker、schedule 和分页过滤。
- `bun run db:migrate`：在隔离 Data Root 上通过；迁移前会创建空 SQLite 文件，FTS5 由 Repository 初始化的受控 SQL 建立。
- `pwsh -NoProfile -File scripts/smoke-node.ps1`：通过；Node API/Worker、migration、queued Run、fixture 3 条、Search、Story 和 SSE 回放均通过。
- Playwright 浏览器验收：通过来源创建、手动 queued Run、SSE ready、Feed 3 条、搜索 2 条、URL-free Story/Revision/Observation 和健康检查。
- `docker version`：未运行，当前环境没有 Docker CLI，因此 Docker/Compose 验收保留为待执行。
- 20 份仓库 Markdown：代码围栏成对、无尾随空白、文件末尾无多余空行；PRD 126 个需求编号无重复。
- 62 个仓库内相对 Markdown 链接中，61 个有效；原始需求保留的 1 个仓库外技能路径 `C:\Users\notnotype\.agents\skills\grilling\SKILL.md` 未改写。
- 未运行：Docker/Compose、真实 RSS/RSSHub、跨平台 Node 和长时间故障恢复验收。

此前 Phase 0 的远端仓库、许可证、研究文件 SHA-256 和 GitHub 配置检查结果仍保留在历史 Task 记录中；本次没有执行远端同步、commit、push 或发布。
