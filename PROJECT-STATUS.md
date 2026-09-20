# Cosmos Project Status

> 更新于 2026-09-18。代码基线 `b9e596f`（Task 32 合并与状态记录；功能基线 `da7d656`，CI run [`35313175640`](https://github.com/Otirik-handi/cosmos/actions/runs/35313175640) 五个 job 全绿）。**Task 31 与 Task 32 均已合并并推送（本地 = `origin/master` = `b9e596f`）**；`.worktree/` 已清空。**Phase 1 表内已无未闭合项**（Gateway 三行改标 Phase 3、`EXT-008` 与 AUT-001「删除凭据」按维护者 2026-09-18 裁定收口，见下），Phase 2 已收口（见分册索引首行），G01–G08 治理暂停，Phase 1 后置债按 2026-09-07 划线保留。

## 历史分册索引

历史切片与审查记录已按月/主题归档到 `PROJECT-STATUS/` 子目录(每册 ≤30 KB,封口后只读,勘误记入本文件勘误节或同级 `ERRATA.md`);
主文档只保留当前快照、活跃边界与分册索引——滚动归档只切历史,不切当前状态和有效决定。

| 分册 | 覆盖范围 | 大小 |
|---|---|---|
| [history-2026-09-4.md](PROJECT-STATUS/history-2026-09-4.md) | 2026-09-16 ~ 2026-09-15(3 节) | 5.3 KB |
| [history-2026-09-3.md](PROJECT-STATUS/history-2026-09-3.md) | 2026-09-15 ~ 2026-09-11(2 节,含 2026-08-24 被取代快照原文) | 7.8 KB |
| [history-2026-09-1.md](PROJECT-STATUS/history-2026-09-1.md) | 2026-09-10 ~ 2026-09-09(9 节) | 22.7 KB |
| [history-2026-09-2.md](PROJECT-STATUS/history-2026-09-2.md) | 2026-09-09 ~ 2026-09-08(6 节) | 15.5 KB |
| [history-2026-09-phase1.md](PROJECT-STATUS/history-2026-09-phase1.md) | 2026-09-07 ~ 2026-09-01(5 节) | 13.1 KB |
| [history-2026-08-legacy.md](PROJECT-STATUS/history-2026-08-legacy.md) | 无日期 ~ (8 节，含 2026-09-15 移入的「2026-08-15 之前的历史基线」) | 12.6 KB |
| [history-2026-08-completed.md](PROJECT-STATUS/history-2026-08-completed.md) | 无日期 ~ (1 节) | 12.3 KB |
| [history-2026-08-reviews.md](PROJECT-STATUS/history-2026-08-reviews.md) | 2026-08-08 ~ 2026-08-15(7 节) | 15.7 KB |

## 一句话结论

Source 身份/revision 持久化合同仍以「`sourceDefinitionRef + operationId + config` 创建默认停用 Source、再以 revision CAS activation command 启用」为产品路径，产品路径不提交 `kind`、`enabled` 或 `fixturePath`。Phase 2 已收口：十四条切片与平台面四块全部落地，PRD §12 Phase 2 的四条验收标准中前三条（按来源/分类/时间/全文/Topic 浏览、多来源 Story 的时间线与相关内容、可调整看板且删除 Block 不删除底层信息）已有实现、浏览器自动化与真人验收三层证据，第三条的专问由维护者明确回答「完好」。第四条「重分析不覆盖用户批注和人工关系修正」仍只靠「Phase 2 尚无自动重分析写入路径」在结构上成立、未被真正考验，Phase 3 的 Knowledge Workflow 落地后需重新回归。真人验收同时暴露三条界面方向（Topic/Entity/用户组织缺独立面板、看板需要拖拽、文案过于专业化），已登记为待 Proposal 的新方向。ORG-021 已改标 Phase 3。本轮验证数字与未运行项见「验证边界」。

> 本条原为 2026-08-24 的 Source 身份/revision clean cutover 快照；该快照原文（含当日 migration `20260824100000_source_activation_result_snapshot`、五轴审查收口项与 34 文件/249 用例等验证数字）随 2026-09-15 刷新移入 [history-2026-09-3.md](PROJECT-STATUS/history-2026-09-3.md) 附节留存。

## 当前运维边界

- Worker Admin 的 `activePollCount` 只统计 `beginPoll` 到 `endPoll` 的 poll；`activeAttemptCount` 只统计 runtime 明确登记的真实 Attempt。Drain 等待 active poll/Attempt，deadline 到达返回 `timed_out` 且 `resourcesClosed=false`。
- `SIGINT`、`SIGTERM` 和 Admin drain 共用 WorkerRuntime shutdown 状态机；正常退出码为 0，force/failed shutdown 为 1。
- WorkflowRun 的 `sourceInstanceId`、`errorMessage` 是 durable projection 字段；来源查询同时考虑 legacy Run 和 WorkflowRun，不从 Kernel stateJson 猜错误文本。
- 旧 IngestionWorker 路径保留；显式 `COSMOS_WORKFLOW_HOST_ENABLED=false` 才回退旧路径。Gateway、Redis、多主机和远程 Worker 不属于当前实现。
- 远端 `master` 当前**没有分支保护或 ruleset**（2026-09-17 用 GitHub API 核实，`branches/master/protection` 返回 404、rulesets 为空）：CI 只是事后信号，不阻止直接推送或合并；是否启用 required checks 待维护者决定。
- 产品当前 **PC 优先、不做移动端适配**（维护者 2026-09-17：移动端等 PC 端做好后再适配）：390px 页面级横向溢出检查**暂停执行**，PC/平板宽度（768/1024/1440px）继续断言；恢复条件写在 `e2e/support/viewports.ts`，恢复前先给两处溢出断言补失败现场打印（见已知不稳定用例表第 2、3 条）。
- 工具链与依赖源已固定（2026-09-17，Task 29）：bun 版本 **1.4.2** 在 `package.json` 的 `packageManager`、CI 的 `BUN_VERSION`、`docker/Dockerfile` 基础镜像三处一致；依赖源显式写在 `bunfig.toml`（npmmirror，与 `bun.lock` 里 1,026 条地址一致，实测已有条目不会被改写、配置只决定新解析条目写哪个地址）；锁文件仅补回 `configVersion` 一行，依赖解析零变化。Docker 基础镜像的版本切换**未做容器实跑**（本机无 Docker CLI，tag 存在性已用 API 核实）。

## 当前下一步

**2026-09-18 复核与决定**：先清文档口径、并修掉唯一被判定为验收失败的公开投影安全项（Task [`31`](.agents/tasks/31-public-asset-projection/README.md)，已合入）；Phase 2 需求表尾巴、Phase 1 产品缺口与已 accepted 的界面职责重划之间的先后顺序**尚未排定**。

**Phase 1 缺口复核的收口（2026-09-18，本次）**：对 PRD §7 所有 `Phase 1`/`Phase 1B`/`Phase 1C` 行与 §12 验收逐条核对后，已交付与已划线分开登记（勘误台账 [`ERRATA.md`](docs/requirements/0002-product-requirements/ERRATA.md)）；**Phase 1 表内已无未闭合项**，三项原待裁定已由维护者 2026-09-18 裁定并落地：

- **Gateway 三行（RUN-010/RUN-011/OPS-010）**：排除出 Phase 1 并改标 `Phase 3`（与插件运行时、Agent 执行位置同批）。
- **`EXT-008`**：记为 Phase 1 已交付（前两条验收条件已有行为测试与结构性证据）；「独立构建/部署实跑」并入既有的「manifest-only API、executable-only Worker 与独立 Migrator 完整生产验收」一条。
- **AUT-001「删除凭据」**：补实现——删除 Connection 时连带删除 SecretStore 中的密钥字节；同批修掉 `FileSecretStore` 把 `secret:` 前缀误判为路径逃逸的缺陷（该缺陷会让任何真实凭据都写不进去）。

**Phase 2 收口与尾巴的完成记录（2026-09-15/16）**：Phase 2 收口四条（Story split 用户状态迁移与撤销、看板 UI 缺口与拖拽排序、四条主流程真人验收、ORG-021 改标）、ORG-017、远端 CI 收尾、`db:validate` 阻塞修复与界面职责重划的实现尝试作废，整段移入 [`PROJECT-STATUS/history-2026-09-4.md`](PROJECT-STATUS/history-2026-09-4.md)；本文只保留仍然有效的当前状态与决定。

**真人验收产生的新方向（有效决定；细节在 Proposal）**：

- **界面职责重划**：Proposal [`docs/proposals/ui-surface-ownership-v1.md`](docs/proposals/ui-surface-ownership-v1.md) 已 **accepted**（维护者 2026-09-15 裁定六项）：三层分工冻结为「首页看 / 独立页面管 / Story 抽屉读」，新页面为 Topic 页、Entity 页、用户组织页，不含 Artifact/Workspace（Phase 3 另议）；接受时未冻结的细节（新建标签 / 新建收藏夹的不对称处理）与 2026-09-15 实现尝试作废的经过分别在 Proposal 的「已裁定（六项）」与 [`attempt-and-void-2026-09-15.md`](docs/proposals/ui-surface-ownership/attempt-and-void-2026-09-15.md)。PRD §8 / 架构 §11.4 / 新 ADR 与 Task 的更新在 `master` 上**尚未执行**。
- **UI 文案审查**：Proposal [`docs/proposals/ui-copy-review-v1.md`](docs/proposals/ui-copy-review-v1.md) 维持 `reviewing`。判据 R0（展示名必须忠实反映概念的实际意义）已确立，术语对照表 v1（A–E 组；B 组只保留 `Story` 和 `Entity`）已由维护者逐行裁定、可直接执行，E 组等「分类」概念定义；仍未接受的是判据 R1–R5 本身、术语表落点与实施归属。改动需与 5 个浏览器 spec 里 205 处按文案定位的断言同批修改。**推论（未获维护者确认）**：UI 整体重做在前，逐屏文案批次应同批后置。

**Phase 2 尾巴遗留状态（2026-09-16 起）**：

- **ING-006 与需求表改标（2026-09-16/17）**：ING-006 已合并并推送（`c308733`，维护者手动验收通过，ADR [`0022`](docs/adr/0022-entry-duplicate-relations-v1.md)）；改标明细在 PRD 勘误台账 [`ERRATA.md`](docs/requirements/0002-product-requirements/ERRATA.md)。合并与清理的完整记录移入 [`history-2026-09-4.md`](PROJECT-STATUS/history-2026-09-4.md)。改标后 §7 中仍标 `Phase 2` 而未闭合的是 **AUT-004、AUT-010、ING-012、LIB-004、LIB-008、OPS-004**，EXT-006 的「登录状态展示」等真实认证 Adapter。

**本次未纳入、仍开着的项**（不随 Phase 2 收口顺带执行）：

- Entity merge/dedup；批注的正文片段字符级锚点；`size-governance.py --check` 的行数阈值（G 系列暂停时留下的门禁欠账，完整口径下仍有 8 个文件超红线）。
- **搜索 FTS5 语法字符导致 500：已合并**（`04ecbfc`）。原因：`search` 把用户输入原样交给 `entry_search MATCH ?`，`-` 在 FTS5 里是 NOT 运算符，`绝不匹配-212c82` 因此变成畸形查询、SQLite 返回语法错误。现按维护者裁定「全当字面文本」处理：输入按空白切词、每段作字面短语，多词保持 AND，无词可搜时退回无文本条件。**代价**：搜索框不再是 FTS5 查询接口，`OR`/`NEAR`/前缀通配不再是运算符。
- **已知不稳定的测试用例**（2026-09-17 更新）：`phase2-organization.spec.ts:539` 搜索用例**已归因并修复**（根因是 Feed 卡片列表用 `storyId` 当 React key、同一 Story 多张成员卡片导致重复 key 残留"幽灵卡片"，改用 `entryId`），同一次排查还修掉一个陈旧刷新覆盖搜索结果的竞态；过程见 Task [`30`](.agents/tasks/30-feed-stale-response-race/README.md)。**仍未归因**：同文件 `:103`、`:417` 与整套慢跑时 `media-policy.spec.ts` 的来源健康行等待超时；两处 390px 断言随移动端适配后置**暂停执行**。症状与建议次序只在 [`known-unstable-cases.md`](docs/testing/known-unstable-cases.md) 维护。
- ING-009 剩余后置项（历史媒体回填、音频/视频下载实体、单条目媒体数量上限、全局默认值 env 化）按 ADR-0015 Revisit Gate 评估。
- Read State 驱动的「未读」过滤、相关内容的服务端排序与更大候选集（当前 Web 侧组合既有读端点、上限 5 条）属 Phase 4 推荐体系；批注的 Artifact 目标属 Phase 3。
- Phase 1 后置债（Docker/Compose、发布部署、真实公网长时定时抓取、非 Windows 平台 smoke、长时间故障恢复）按维护者 2026-09-07 划线保留；其中任一项需要提前补做时单独开 Task/申请授权，不随后续切片顺带执行。

**Phase 3 入口条件（2026-09-15 复核，尚未满足）**：Phase 3 目前没有 Proposal、ADR 或 Task。架构约定的 Agent 运行时 `neuro-agent-harness` 与共享记忆 `nb-memory` 仍是外部候选，仓库内没有 LLM/Agent 依赖、没有 Artifact/Workspace/Agent Session 数据模型，可执行 Action 只有 `cosmos.ingest@1` 与 `cosmos.media-cleanup@1`（`agent`/`artifact` 只是 `actionKindSchema` 的枚举值，注册表里没有对应实现；给新 Action 用的注册、重试策略、执行位置与宿主栅栏管道已具备）。PRD §12 Phase 3 的 5 条范围与主文档「后置决定」中的 6 项尚未收敛为 Proposal。

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
- **Phase 1 收口（2026-09-18，Task [`32`](.agents/tasks/32-phase1-closure/README.md) 五切片，已合并 `cd7f7bb`）**：AUT-001 删除来源（墓碑，历史保留）、LIB-001 三个过滤维度、ING-004 发现渠道、AUT-003 条件请求（顺带补上 ING-012 的一半）、OPS-002 的 Run→Job 产品面均已交付；ING-008 按 ADR-0005 走勘误收窄。**Gateway（RUN-010/011、OPS-010）改标 `Phase 3`**；OPS-002 的「预算」收窄为媒体预算。`EXT-008` 与 AUT-001「删除凭据」按同日裁定收口（见「当前下一步」）。
- Activity Host 的跨进程 durable recovery、双 Worker 长时 fencing、Worker Admin SIGTERM/活跃 Attempt deadline 和完整生产 executable registration 验收；当前代码/测试已有部分 Activity Job、lease、completion 和 direct loopback 证据，不能替代这些边界。
- 固定 `cosmos.ingest@1` parity、Source snapshot/checkpoint 的完整矩阵验收；Worker Host 默认入口已统一开启，显式 `COSMOS_WORKFLOW_HOST_ENABLED=false` 才关闭。
- manifest-only API、executable-only Worker 和独立 Migrator 的完整生产验收；相应代码路径已有 Node smoke/focused 证据，但尚未完成 Docker、browser 和真实来源验收。**`EXT-008` 的验收条件「在没有 Connector executable 的 API 构建中仍可工作」既无测试也无独立构建实跑。**
- API/DTO Draft v0.2 的 Zod schema、Product/Application/Transport 迁移、Gateway fake conformance、owner handoff、late evidence、Receipt CAS 和真实 bootstrap identity。
- SQLite WAL/busy timeout 的显式配置与并发行为验收。
- 真实认证 Adapter 的登录生命周期；Connection/SecretStore/ConnectorStateStore 地基已由 Task 22 交付，Checkpoint 迁移与加密-at-rest 未做。
- 可配置多采集计划、通用 Workflow 插件/管理产品面、LLM 子任务和
  Proposal/Provenance。
- 推荐系统（Admission/Ranking/Impression/Feedback、推荐页、相关内容的服务端排序）；跨来源重复/转载关系只做人工标记与展示，不参与排序和去重（ADR-0022）。
- Agent 分析、Artifact、Workspace 和交互状态。
- 推送、摘要图片和网页发布（Phase 5）；看板已随 Phase 2 交付（可配置 Board/Section/Block、Spotlight 人工固定、区块拖拽排序）。

## 验证边界（历史证据与当前未验证项分开）

**当前验证**：各切片的完整命令与数字在对应 Task walkthrough（Task 10 的切片 4、Task 14 拖拽排序、Task 17/20 的 split 用户状态迁移、Task 26 的 ING-006）；本节只留仍然有效的边界与缺口。

- 最近一次全量证据（2026-09-18，主工作区，HEAD `b9e596f` + 本轮未提交改动；先执行 `bun install` 补齐缺失依赖、`bun.lock` 无改动）：`bun run typecheck` **全仓 0**、`bun run test` **106 文件 / 632 用例全绿**、`bun run build` 通过、`bun run docs:check` **701 文件 0 失败**、size 门禁 PASS、`git diff --check` 干净；`bunx playwright test --config playwright.config.ts`（`COSMOS_E2E_WEB_PORT=4183`）**24 passed**；`COSMOS_REAL_RSS_URL=https://www.ruanyifeng.com/blog/atom.xml COSMOS_ALLOW_REAL_NETWORK=true bun run test:real:rss` 通过（item count 3，见 Task 32 walkthrough）。上一轮为 Task 32 worktree 内的 105 文件 / 624 用例。**主工作区的 `node_modules` 与 lockfile 不一致问题已由本轮 `bun install` 解除**，typecheck/test/build 不再需要在 worktree 内跑。
- **Phase 1 交付项的验证缺口（2026-09-18 复核登记）**：Task 32 的 AUT-001 删除来源 Web 入口与 LIB-001 三个新过滤控件已于 2026-09-18 补上浏览器用例（[`e2e/browser/source-lifecycle-and-search-filters.spec.ts`](e2e/browser/source-lifecycle-and-search-filters.spec.ts)，整套 **24 passed**）；AUT-003 的条件请求已有真实公网 RSS 验收（Run `run_b562e08e…`，item count 3），但该脚本只跑一次抓取，**304 短路本身仍只有 `plugins/rss` 的 fixture 证据**。
- **公开 Asset 投影的内部 Blob key 已剥离**（同批，Task [`31`](.agents/tasks/31-public-asset-projection/README.md)，已 `--no-ff` 合入 `3ded765`）：泄漏的是内部 Blob 内容寻址 key（非绝对路径、没有可直接利用的路径），按[准入决策表](docs/standards/repository-workflow.md#准入决策表)第 25 行当安全合同修复处理，**不开公开 Issue**；六条公开读路由经 `toPublicAsset` 挑字段，公开读 DTO 改用 contracts 的 `publicAssetSnapshotSchema`，过程与回归锚点在 Task 31。
- **浏览器产品 E2E 整套仍有失败**（Task 26 起，`:103`/`:186`/`:417`/`:539` 之间漂移、单跑即过）：`:539` 的根因已查明并修复（Task [`30`](.agents/tasks/30-feed-stale-response-race/README.md)）；其余失败点与整套慢跑时 `media-policy` 的等待超时仍未归因。症状、观察次数与建议次序只在 [`known-unstable-cases.md`](docs/testing/known-unstable-cases.md) 维护。
- 拖拽手势本身未自动化（指针坐标在该布局下不可靠），由维护者真人验收覆盖（Task 14 的已知边界）。
- 本机未运行：property、Node 进程 E2E、Windows Node smoke、Docker/Compose、发布部署、真实来源联网验收（前三项由远端 CI 覆盖）；`db:validate` 本轮已在本机通过。

2026-08-15 之前的历史基线与 Spike 证据（含当时的分册完成记录、Task 05/07 基线与浏览器
验收数字、Round 7/8 的 worktree 证据）整段移入 [`PROJECT-STATUS/history-2026-08-legacy.md`](PROJECT-STATUS/history-2026-08-legacy.md) 的
「2026-08-15 之前的历史基线（自 PROJECT-STATUS 主文档移入）」一节；本次分册切片只切历史，
不改动当前快照与有效决定。
