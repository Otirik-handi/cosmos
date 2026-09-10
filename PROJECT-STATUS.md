# Cosmos Project Status

> 更新于 2026-09-10。Phase 2 第十四切片存储占用统计与备份/恢复 v1（Task 24）已合并 `master` 并推送（`27f249b`）。第十三切片 Trigger/SDK v1（Task 23）已合并（`e8c2f84`）；第十二切片 Connection/SecretStore/StateStore v1（Task 22）已合并（`9c4cf72`）；第十一切片 Run 控制 v1（Task 21，RUN-004）已合并（`1f879f4` + `da44743`）。第十切片媒体失败重试与保留期清理 v1（Task 20）已随 PR #3 合入（`0ad4d2b`）；第九/八/七切片（Task 19/18/17）此前已合入；第六切片（Task 16）、验收补完（Task 15）与可配置看板 v1（Task 14）此前已合入。Phase 2 平台面四块（RUN-004、Connection/StateStore、Trigger/SDK、OPS-003/004）全部落地，worktree 与分支均已清理。Phase 1 后置债仍按 2026-09-07 划线保留。

## 历史分册索引

历史切片与审查记录已按月/主题归档到 `PROJECT-STATUS/` 子目录(每册 ≤30 KB,封口后只读,勘误记入本文件勘误节或同级 `ERRATA.md`);
主文档只保留当前快照、活跃边界与分册索引——滚动归档只切历史,不切当前状态和有效决定。

| 分册 | 覆盖范围 | 大小 |
|---|---|---|
| [history-2026-09-1.md](PROJECT-STATUS/history-2026-09-1.md) | 2026-09-10 ~ 2026-09-09(9 节) | 22.7 KB |
| [history-2026-09-2.md](PROJECT-STATUS/history-2026-09-2.md) | 2026-09-09 ~ 2026-09-08(6 节) | 15.5 KB |
| [history-2026-09-phase1.md](PROJECT-STATUS/history-2026-09-phase1.md) | 2026-09-07 ~ 2026-09-01(5 节) | 13.1 KB |
| [history-2026-08-legacy.md](PROJECT-STATUS/history-2026-08-legacy.md) | 无日期 ~ (7 节) | 8.0 KB |
| [history-2026-08-completed.md](PROJECT-STATUS/history-2026-08-completed.md) | 无日期 ~ (1 节) | 12.3 KB |
| [history-2026-08-reviews.md](PROJECT-STATUS/history-2026-08-reviews.md) | 2026-08-08 ~ 2026-08-15(7 节) | 15.7 KB |

## 一句话结论

Source 身份/revision 持久化合同与默认验收调用方已完成本地 clean cutover：Product API/Web/Node E2E/Windows smoke 使用 `sourceDefinitionRef + operationId + config` 创建默认停用 Source，再以 revision CAS activation command 启用；产品路径不再提交 `kind`、`enabled` 或 `fixturePath`。本轮经五轴审查收口：激活同键重放持久化并返回首结果快照（新 migration `20260824100000_source_activation_result_snapshot`）、API 边界配置校验切换 canonical Zod schema（Bilibili feed 缺 profile 即拒）、未启用 Source 手动 Run 返回 409、RSS `feedUrl` 收紧 http(s)、Idempotency-Key 统一 1–300 字符、迁移回归测试临时目录修复。本地通过全仓类型检查、34 文件/249 单元测试、4 文件/4 Node 进程 E2E、8 个生产浏览器场景、12 个组件实验室浏览器场景和 Windows Node smoke。Docker CLI 不可用，Docker 验收未运行；真实 RSS/AI HOT/Bilibili、断网媒体验收和发布部署仍未完成（媒体边界 v1 的设计与实现已于 2026-09-04 合入 master，见下方“当前下一步”；未保存配置 Probe 与 schema 驱动 Web 配置流程已分别于 2026-09-02 以 PR #1、PR #2 合入；两块固定看板与来源健康切片已于 2026-09-03 快进合入 master）。

## 当前运维边界

- Worker Admin 的 `activePollCount` 只统计 `beginPoll` 到 `endPoll` 的 poll；`activeAttemptCount` 只统计 runtime 明确登记的真实 Attempt。Drain 等待 active poll/Attempt，deadline 到达返回 `timed_out` 且 `resourcesClosed=false`。
- `SIGINT`、`SIGTERM` 和 Admin drain 共用 WorkerRuntime shutdown 状态机；正常退出码为 0，force/failed shutdown 为 1。
- WorkflowRun 的 `sourceInstanceId`、`errorMessage` 是 durable projection 字段；来源查询同时考虑 legacy Run 和 WorkflowRun，不从 Kernel stateJson 猜错误文本。
- 旧 IngestionWorker 路径保留；显式 `COSMOS_WORKFLOW_HOST_ENABLED=false` 才回退旧路径。Gateway、Redis、多主机和远程 Worker 不属于当前实现。

## 当前下一步

（2026-09-09 更新：Phase 2 第十切片已随 PR #3 合入 `master`，见顶部记录。）

- Phase 2 第十切片媒体失败重试与保留期清理 v1（Task 20，ING-009 剩余部分）已随 PR #3 合入并推送 `master`（merge commit `0ad4d2b`）；worktree `.worktree/media-retry-retention` 与分支 `feat/t20-media-retry-retention`（本地与远端）已清理。
- Phase 2 第九切片按来源的媒体策略 v1（Task 19）已随 `a5a8005` 合入并推送 `master`；稳定文档（PRD/架构/ADR-0014/spec/testing）已同步。
- Phase 2 第八切片 Story subtype 受管注册表 v1（Task 18）已随 `087544b` 合入并推送 `master`；稳定文档（PRD/信息模型/ADR-0013/spec/testing）已同步。
- Phase 2 验收四条标准已全部满足（分类/Topic 浏览、Story 时间线、相关内容见顶部“Phase 2 验收补完”）；实现随 Task 15 合入 `master` 并推送。
- Phase 2 第六切片 Entry↔Story 证据关系 v1（Task 16）已随 `961e942` 合入并推送 `master`；接受后的稳定文档（PRD/信息模型/ADR-0011/spec/testing）已同步。
- Phase 2 第七切片 Story split v1（Task 17）已随 `8d44000` 合入并推送 `master`；稳定文档（PRD/信息模型/ADR-0012/spec/testing）已同步。
- Phase 2 第十一切片 Run 控制 v1（Task 21，RUN-004）已合并 `master` 并推送（`1f879f4` + `da44743`）；Proposal accepted + ADR-0016 + PRD 注记 + Task 已同步；worktree 与分支已清理。
- Phase 2 第十二切片 Connection/SecretStore/StateStore v1（Task 22）已合并 `master` 并推送（`9c4cf72`）；Proposal accepted + ADR-0017 + PRD 注记 + Task 已同步。
- Phase 2 第十三切片 Trigger/SDK v1（Task 23）已合并 `master` 并推送（`e8c2f84`）；Proposal accepted + ADR-0018 + PRD 注记 + Task 已同步。
- Phase 2 第十四切片存储占用统计与备份/恢复 v1（Task 24）已合并 `master` 并推送（`27f249b`）；Proposal accepted + ADR-0019 + PRD 注记 + Task 已同步；worktree 与分支已清理。
- Phase 2 平台面四块（RUN-004、Connection/StateStore、Trigger/SDK、OPS-003/004）已全部落地；下一切片候选仅剩自动聚类/Knowledge Workflow（ORG-021，依赖 Phase 3 Agent 边界）。ING-009 的剩余后置项（历史媒体回填、音频/视频下载实体、单条目媒体数量上限、全局默认值 env 化）按 ADR-0015 Revisit Gate 评估。
- 可配置看板 v1（Task 14）已合入本地 `master`（tip `2ea8939`）并推送至远端；worktree `.worktree/board-section-block` 与分支 `feat/t14-board-section-block` 已清理。
- 用户组织 v1（Task 13）已合入本地 `master`（tip `77ca54f`，状态记录提交 `31cfdbd`）并推送至远端；worktree `.worktree/user-organization` 与分支 `feat/t13-user-organization` 已清理。
- Entity/关系 v1（Task 12）已合入 `master`（`5b3e327`）并推送至远端（`origin/master` = `f44b4e9`）。
- Phase 1 后置债（Docker/Compose、发布部署、真实公网长时定时抓取、非 Windows 平台 smoke、长时间故障恢复）按维护者划线保留；其中任一项需要提前补做时单独开 Task/申请授权，不随后续切片顺带执行。
- 后续 Phase 2 切片候选（按 PRD 顺序）：Story split 完整生命周期、`evidence_for`/`mentions` 跨 Story 引用、自动聚类/Knowledge Workflow、Entity merge/dedup 后置；Topic/Entity/用户组织/看板流程的人工验收留待后续。
- 已知待补：多个 Feed Block 的独立取数（当前只有第一个渲染真实阅读流）；拖拽排序；批注 Artifact 目标与正文片段字符级锚点；Read State 驱动的「未读」过滤；相关内容的服务端排序与更大候选集（当前 Web 侧组合既有读端点、上限 5 条）。

## 当前架构基线

以下是 v0.21 的 Phase 0/Phase 1B/1C 基线；后续需求仍可通过记录理由调整：

- 服务器部署优先的模块化单体；逻辑上分 Web、API、Worker 和一次性 Migrator。
  当前 Web 可以独立部署，API/Worker 仍共享 SQLite/Data Root，只支持同机或共享卷。
- Web 使用 React + Next.js App Router；API 使用 NestJS；UI 初步使用 Tailwind、shadcn/ui、React Hook Form 和 Zod。
- Bun 用于开发，Node 用于生产；共享包和 Worker 运行路径保持 Node-compatible。
- Prisma + SQLite 保存核心元数据、关系、任务与用户状态；FTS5/BM25、虚拟表和
  触发器通过受控 SQL Adapter 使用。WAL/busy timeout 是 Local Durable 目标，
  当前尚未在代码/migration 中显式验证。
- `nb-workflow@0.2.0` 已提供稳定的规范脚本/Activity replay 语义；Task 07 合入提交
  `5ce628690ab0110b0525e8ebcbacbe673ced9c55` 已接入 Prisma Backend、Blob ValueStore、
  Durable Host、固定 Ingest durable path 和 Worker Admin direct loopback。完整 parity、
  跨进程 recovery、长时 fencing、SIGTERM 活跃 Attempt deadline 和部署/真实来源验收仍
  未完成或未验证。
- TaskStore 是 SQL 中的任务权威；本地默认自适应 polling，不要求 Redis。WakeupBus/Redis
  只做可选通知，真正多主机目标是 PostgreSQL + S3/MinIO + 可选 Redis；Redis、多主机
  实现当前不存在。
- 当前 Product API 已有 catalog/公开投影路径，Worker 独占 executable；manifest-only
  边界已有代码和测试，但完整 Docker/browser/真实来源生产验收仍未完成。
- 对外合同拆成 Product Service、Worker Admin 和 Worker Gateway。远程 Worker
  使用 HTTPS long-poll；Attempt owner 由 Session/owner epoch/lease token/expiry
  的持久 tuple 决定，resume 必须 TaskStore CAS 转移并轮换 token。真实 Gateway
  尚未实现。
- 服务器、客户端、客户端与服务分离三种模式共用版本化 Service Endpoint、Command、Query、Event 和 SSE Transport；客户端不直接访问 Prisma、SQLite 或 Data Root。
- 内容寻址 Blob Store 保存原始 payload、图片和附件；Artifact Root 保存版本化生成产物，Cache Root 可重建。
- 运行日志不写入 SQLite；API、Worker、Web 分别写入 `api.jsonl`、`worker.jsonl`、`web.jsonl`，默认使用 `<Data Root>/logs`，也可由 `COSMOS_LOG_ROOT` 指定，stdout + 文件双写，7 天保留和 256 MiB 总量上限。
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
- 当前单用户阶段知识管理者和 Agent 按最大产品权限运行，不建设审批 UI 或细粒度权限模型；未来再叠加远端/多人/不可信扩展的权限策略。
- 第一版扩展按本地可信代码处理，但继续使用 SDK/Command/Query/Event；Phase 1 从 RSS/RSSHub + fixture 开始。
- Phase 1B 的 Collector 核心只保存统一 `NormalizedIngestItem`：内容使用 `ContentKind`，作者使用允许空 `platformId` 的 `Publisher`，指标保存为 Entry 当前快照，时间使用证据优先的 `TemporalValue`；Connector 不直接访问 Prisma、SQLite 或 Blob Root。
- Bilibili v1 只支持受管 `hot`/`feed` 场景；AI HOT 只支持固定公开 endpoint 和服务 cursor。
- Ingest 通过固定 Durable Workflow 的 Run/StepRun/Action Job 执行，Probe
  暂时通过旧持久 Job 执行；两者的外部访问都只发生在 Worker，API 不执行
  Connector。
- 看板优先于推送实现；推送边界仍在架构中保留。
- Phase 1 只实现一个 Entry → 一个最小 Story projection；跨来源聚类、Story merge/split、Topic 维护和完整推荐后置。
- Phase 1 直接使用 `pi-ai`；`neuro-agent-harness` 继续独立去领域化演进，稳定后再接入 Cosmos。
- Agent 调用目标通过可选 `wf.agents.invoke` Extension 映射到
  `agent.invoke@1`；Harness 负责 Invocation/Session/Profile/Model，不能持有
  Cosmos Job durable truth。
- Workflow 是主动行为核心；脚本式 Workflow 是底层执行形态，Graph/IR/Comfy 类表达转换为脚本语义，不建立第二套 Runtime。
- Ingest、Knowledge、Research、Maintenance、Delivery 和 Interaction 使用同一 Runtime 的 `kind + tags` 分类。
- Ingest 先保存 Observation/Entry/Revision/Asset；Entry → Story 由可配置 Knowledge Workflow 处理，Research Workflow 通过 Research Request/Trigger 独立运行。
- `nb-memory` 作为 Knowledge Manager 的共享长期记忆/知识库候选；Cosmos 通过 Adapter/Port 接入，不直接依赖其内部文件。
- Knowledge Manager 的 Web Chat、`cosmos cli`、多个分身和 ingest/research 参与属于后续 Phase 3 方向，不是当前 Phase 1 已实现能力。
- 个性化配置由 Agent 记忆、Cosmos 行为观察和未来其它信号生成；平台推荐流可作为候选来源，但平台推荐信号暂不进入独立偏好模型。

## 后置决定

- “分类”是稳定导航分区、自由标签，还是二者的上位概念。
- 同一 Workspace 的并发更新、重复触发合并和取消/接管语义。
- Agent 候选 Revision 的接受/拒绝界面和字段保护最小实现。
- `updated_since_last_seen` 在不同 surface、Story split 和 merge 后的投影规则。
- 显式 state migration command 的批量操作、撤销和用户确认边界。
- 文本、图片、视频、私信和历史修订的默认保留预算。
- BiliBili 更深场景、X、Telegram、公众号、QQ群以及平台条款和长期稳定性。
- 多 Board、公网摘要链接、推送渠道和跨平台发布策略。
- Source、Trigger、Workflow、Action 的产品关系已确认；更细的实现边界、版本合同和持久运行行为统一转入 Workflow Runtime Task。
- Bun 开发与 Node 生产在 Next、Nest、Prisma、Worker 和 Harness Adapter 上的完整兼容矩阵。
- Prisma/SQLite 的 FTS5 migration、触发器、Raw SQL Adapter 和未来存储替换边界。
- 三种宿主模式的认证、Service Endpoint、SSE 恢复、Blob/Artifact 访问和版本协商。
- Desktop Shell 的具体技术、安装/升级/卸载生命周期，以及 `pi-ai` 到 Harness 的迁移门槛。
- SecretStore 第一版后端，以及 Adapter SecretRef/StateStore 的具体公共接口。
- 一个 Connection 下多个 SourceInstance/采集计划的 UI 和持久模型。
- 脚本优先 Workflow API、Context、Action 调用、Child Workflow、Journal、Graph/IR 转换和 kind/tags。
- Knowledge Manager Web Chat、`cosmos cli`、多分身共享记忆和 ingest 参与的具体运行合同；当前不建设审批 UI。
- Research Request、Trigger、Research Workflow、外部渠道访问、结果重新入库和失败恢复语义。
- `nb-memory` Adapter、存储根目录、tick/instant 映射和 Node 生产兼容性。
- Agent 记忆、行为观察和未来信号生成程序可读个性化配置的 schema、更新频率和人工覆盖边界。
- Entry → Story Proposal 的自动接受门槛、用户确认界面和 StoryMembership 迁移。
- Admission、Ranking、Impression、Feedback 和 LLM 异步特征的第一版预算。

## 尚未实现

- Docker/Compose 实际容器启动、共享卷和 healthcheck 验收；当前环境没有 Docker CLI。
- 真实 RSS/RSSHub 网络来源验收、跨平台 Node 验收和更长时间的 Worker 重启演练。
- Bilibili 登录态 feed 的限流、长期稳定性和跨环境登录态验收；feed 场景已于 2026-09-04 通过真实数据 E2E，Run 成功且 `itemCount=20`。
- 完整的 Source/Trigger/Workflow/Action 产品配置模型；Phase 1 只把固定 Ingest Workflow 接入生产，不包含用户自定义 Workflow 编辑/安装/管理。
- Activity Host 的跨进程 durable recovery、双 Worker 长时 fencing、Worker Admin SIGTERM/活跃 Attempt deadline 和完整生产 executable registration 验收；当前代码/测试已有部分 Activity Job、lease、completion 和 direct loopback 证据，不能替代这些边界。
- 固定 `cosmos.ingest@1` parity、Source snapshot/checkpoint 的完整矩阵验收；Worker Host 默认入口已统一开启，显式 `COSMOS_WORKFLOW_HOST_ENABLED=false` 才关闭。
- manifest-only API、executable-only Worker 和独立 Migrator 的完整生产验收；相应代码路径已有 Node smoke/focused 证据，但尚未完成 Docker、browser 和真实来源验收。
- API/DTO Draft v0.2 的 Zod schema、Product/Application/Transport 迁移、Gateway fake conformance、owner handoff、late evidence、Receipt CAS 和真实 bootstrap identity。
- SQLite WAL/busy timeout 的显式配置与并发行为验收。
- Connection/Secret/State 统一管理和 Adapter 登录生命周期。
- 可配置多采集计划、通用 Workflow 插件/管理产品面、LLM 子任务和
  Proposal/Provenance。
- 去重、Story 归并、Topic 成员、分类、关系和推荐系统。
- Agent 分析、Artifact、Workspace 和交互状态。
- 看板、推送、摘要图片和网页发布。

## 验证边界（历史证据与当前未验证项分开）

以下条目是 2026-08-15 之前的历史基线或 Spike 证据，不是当前合入提交的新验收；当前
Task 07 合入后的命令与边界见上方 2026-08-16 记录。本节保留历史数字，避免把历史
evidence 与当前验证混淆。

- `git diff --check`：历史基线曾通过；本轮未重跑。
- `bun install`：通过，生成根 `bun.lock`。
- `bun run db:validate`、`bun run db:generate`：通过，Prisma schema 合法并生成 Prisma Client 6.19.3。
- `bun run typecheck`、`bun run build`、`bun run lint:web`：通过。
- 当前最终全量基线：`bunx vitest run --reporter=dot` 通过，39 个测试文件、
  285 个测试；`bun run typecheck`、`bun run lint:web`、`bun run build`、
  `bun run db:validate` 和 `bun run db:generate` 通过。
- Task 05 基线：13 个测试文件、63 个测试通过；覆盖 Publisher、
  ContentKind、TemporalValue、指标持久化和包含 `sourceLocator` 的 URL-free
  fallback；无条目级稳定 locator 时的修订身份仍待显式建模。
- 当前隔离数据库已应用 4 条 migration，状态 up to date；真实 master 三条
  migration 携带既有数据升级到第 4 条也已通过。
- 归档 WIP 的启用 Prisma Definition/Worker Registry Node production smoke 曾通过；固定
  Ingest Run 产出 Feed 3 条、Search 1 条，并验证 Story、SSE、日志 correlation、
  API 400/404、Run/Probe 幂等重放与冲突、超长 key 拒绝和 Worker discovery；该证据不属于当前 `master`。
- Node production Connector smoke：通过；AI HOT 真实 GET 返回 200，Worker 真实保存 3 条 Entry；OpenCLI 内置入口返回版本 `1.8.6`。
- Bilibili doctor smoke：已运行；daemon 在端口 `19825`，但 Browser Bridge 为 `Extension: not connected`，真实 hot 采集未执行成功。
- Docker/Compose 仍因当前环境缺少 Docker CLI 未验证。
- Playwright 浏览器验收：通过来源创建、固定 Ingest Workflow、SSE 自动刷新、
  Feed 3 条、搜索 `Cosmos` 1 条、Story → Entry → Source/Revision/Observation、
  URL-free 内容、第二次 Run 幂等和健康检查；控制台 0 error、0 warning。
  Source execution snapshot 收口后没有改动 Web/Transport；归档 WIP 的 Registry-enabled Node
  production smoke 覆盖了当时的后端，不能作为当前主线 Registry 实现证据。
- `docker` 命令不存在，因此 Docker/Compose 验收保留为未运行。
- API/DTO 文档收口检查：全仓 48 个 Markdown 相对链接错误 0、未闭合围栏 0、
  EOF 缺失 0、尾随空白 0、conflict marker 0；PRD 164 个定义型需求 ID 无重复；
  原始需求只新增 22 行、删除 0 行；8 份 API 文档的 37 个 TypeScript 围栏合并后
  strict/noEmit syntax + semantic 检查为 0 diagnostics；staged files 0。
- API/DTO v0.2 本轮只运行文档与内嵌类型检查，没有重跑代码 typecheck/test/build、
  Node、browser、Docker、真实来源、恢复或 Gateway 多主机。
- 未运行：Docker/Compose、真实 RSS/RSSHub、Bilibili Browser Bridge 成功采集、跨平台 Node 和长时间故障恢复验收。

2026-08-11 文档收口只运行 Markdown 一致性、需求编号、append-only 和 dirty
文件边界检查；没有重新运行 typecheck、Vitest、build、Node、浏览器、Docker、
真实来源或 Agent。上面的代码/产品证据来自 Round 104–105 的既有 Spike 基线，
不是本轮新架构已经实现或重新验收的证据。

本轮文档验证结果：49 个 Markdown 的相对链接、围栏、EOF、尾随空白和冲突标记
错误均为 0；PRD 164 个定义型需求 ID 无重复；原始需求相对 `HEAD` 为
`+28/-0`；`git diff --check` 通过。编辑前后 77 个非文档 dirty 项的综合
SHA-256 均为
`7aa14ea29ec056cd6f8b81f991a57cbabac2803dbdba825d81b64aa90e0c6826`，
本轮未改变代码、migration、依赖、Docker 或既有删除状态。

此前 Phase 0 的远端仓库、许可证、研究文件 SHA-256 和 GitHub 配置检查结果仍保留在历史 Task 记录中；本次没有执行远端同步、commit、push 或发布。

此前根状态文档只记录 `b678fb5` / PR A 基线和 PR B dirty 边界；以下 Round 7/8
段落保留合入前的 worktree 证据，不代表当前分支状态。当前实现基线已变为
`5ce628690ab0110b0525e8ebcbacbe673ced9c55`；未验证的完整 Ingest parity、恢复、
browser/Docker、真实来源和多主机能力仍不能从历史证据推断为完成。

