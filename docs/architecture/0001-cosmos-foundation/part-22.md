---
parent: docs/architecture/0001-cosmos-foundation.md
range: §22
sealed_at: 2026-09-11
tags: [architecture, cosmos-foundation]
tokens_est: 4442
---

## 22. 变更记录

### v0.23 - 2026-08-16

- 记录 `5ce628690ab0110b0525e8ebcbacbe673ced9c55` 合入后的实现事实：
  `@notnotype/nb-workflow@0.2.0` Durable Host、manifest-only Product API catalog 和
  direct Worker Admin loopback host 已存在并有源码/测试锚点。
- 保留完整 parity、跨进程 recovery、Docker/browser/真实来源、Gateway/Redis/多主机和
  独立 Migrator 的未实现或未验证边界；实现规格统一从 [`../spec/README.md`](../spec/README.md) 进入。

### v0.22 - 2026-08-11

- 固定 Kernel-first 实施门禁：先独立稳定 `nb-workflow`，再实现 Cosmos 本地
  Worker/Durable Host。
- 明确 Task 04 是历史 Spike/验收证据，`docs/api/` Draft v0.2 是后续接口输入，
  两者都不是当前已交付的规范 Runtime 或 Worker API。
- 将 Worker Admin 放在本地 Worker 收敛之后，将远程 Worker Gateway 保持为后续
  分布式实施；本轮只同步文档，不冻结包发布、Attempt 物理表或 Gateway 实现。

### v0.21 - 2026-08-11

- 根据五路 API/DTO 审查收口 Gateway Attempt owner tuple、Session resume CAS、
  token/epoch 轮换和旧 owner fencing。
- 增加 lease-lost late-evidence capability、Receipt revision CAS、幂等 claim
  batch replay、持久 slot reservation、deadline 和 backpressure 不变量。
- 明确 bootstrap identity/Secret Broker/公网认证仍是实现 gate；未认证 API 只能
  用于本机或明确受信网络。
- API 草案更新为 v0.2；补齐 Trigger/Research provenance、KnowledgeSignal
  disposition、协作审计、Story 状态迁移、推荐解释、Artifact sandbox、
  Workspace update 和 Publication/数据生命周期 DTO。

### v0.20 - 2026-08-11

- 分离 Product Service API、Worker Admin API 和 Worker Gateway API；Product 与
  Gateway 初期可同宿主但协议独立。
- 固定远程 Worker v1 使用 HTTPS long-poll；Gateway 先在 SQL TaskStore claim，
  Session/Redis/HTTP 连接不拥有任务终态。
- 为 ActionDefinition 增加 `host`、`trusted_worker`、`remote_worker` execution
  placement，保持领域写入和远程执行边界。
- 明确 API readiness 与 Worker availability 分离，Worker 下线时已保存内容仍可
  读取。
- 增加独立 [`docs/api/`](../api/README.md) API/DTO/场景草案和
  [`ADR-0003`](../adr/0003-service-worker-api-boundaries.md)。
- 本轮仍只定义合同，不代表 Worker Admin/Gateway、远程 Secret、PostgreSQL/S3 或
  manifest-only API 已实现。

### v0.19 - 2026-08-11

- 将 `nb-workflow` 从“语义参考”提升为规范脚本 Kernel；Cosmos 保留 Durable
  Backend/Host、TaskStore、Job/Lease、Outbox、Worker 和领域事务，不再继续扩展
  平行 replay 内核。
- 用 Activity/ActionDefinition/Job/Attempt/Step 重新划分执行词汇，Step 降为可选
  逻辑/UI 投影。
- 固定 SQL `TaskStore + WakeupBus`：本地默认 SQLite 自适应轮询，Redis Streams
  只做可选唤醒、限流和缓存，不持有 Job/lease 终态。
- 补充 Worker slot、多进程、Workflow 内并发、资源级限流和 CollectionPlan
  overlap policy 五层并发边界。
- 明确 Web 当前可独立部署，API/Worker 当前仍受共享 SQLite/Data Root 约束；
  目标增加 manifest-only API、executable Worker、独立 Migrator、可信直连 Worker
  和远程 Worker Gateway。
- 将 `wf.agents.invoke()` 放入可选 Agent Extension，等待
  `neuro-agent-harness` 稳定合同；Core 不依赖 Harness。
- 增加 Phase 1C/Task 06 convergence gate，并明确本轮只更新设计合同，未实现
  Kernel 迁移、Redis、PostgreSQL、Migrator 或 Harness Adapter。
- 修正 SQLite WAL 的状态：它是 Local Durable 目标，当前尚未在代码/migration
  中显式验证，不能作为已实现能力。

### v0.18 - 2026-08-10

- 为固定 Ingest 增加独立 `SourceExecutionSnapshot`；Run 排队后 Source 配置变化
  不再改变 fetch，幂等重放复用首次 Source/cursor/checkpoint 输入。
- 固化 Run/Probe 幂等冲突、持久 budget、legacy checkpoint CAS 和版本化
  Workflow journal value codec 的正确性边界。
- 将尚未进入 `origin/master` 的 Workflow spike migration 压缩为一个增量
  migration；全新数据库使用 4 条 migration，且真实 master 三条 migration
  携带数据升级后保持外键完整。
- 降级“URL-free stable identity 已完成”的过度表述：当前 fallback 已包含
  `sourceLocator`，但缺少条目级稳定 locator 时仍需 identity strength/version
  合同。
- 记录大 Feed/媒体下 journal value/reference 与 retention，以及 Source 查询
  `1 + 2N` 投影的后续扩展风险。

### v0.17 - 2026-08-10

- 将 `cosmos.ingest@1` 接到 API 手动触发、schedule、生产 Worker 和 Prisma atomic
  command repository。
- 固化 Workflow Run/Action Job 双 lease fencing、Source checkpoint revision/CAS、
  correlation、真实 started/finished 时间和 retry_wait claim 去抖。
- 接入 Worker Registry/discovery envelope、版本化 capability evidence 和
  capability projection/retirement seam，同时保持 Registry 与 Run ownership 分离。
- 完成 Node production、Windows standalone 和浏览器最小闭环验收，并保留
  Docker、真实 RSS/RSSHub 和跨平台验收边界。

### v0.16 - 2026-08-10

- 固化 Phase 1B `NormalizedIngestItem` 的唯一实现合同：`ContentKind`、`Publisher`、`ContentMetrics` 和 `TemporalValue`。
- 明确 `Publisher.platformId` 可为 `null`，空白 ID 不参与内容身份；作者类型允许 `unknown`。
- 明确 `ContentKind` 与 `StoryKind` 的映射、指标快照不进 Revision、fallback 时间升级不进 Revision。
- 明确当前 Connector 是按 `Source.kind` 解析的运行时边界，`SourceOperation` 保留为未来操作粒度。

### v0.15 - 2026-08-08

- 正式统一使用 `Workflow`；`Flow` 仅保留为原始需求或历史迁移说明中的旧称。
- 补充 Workflow Definition、Action Definition、Trigger Binding、Workflow Run 和 `WorkflowContext` 的关系。
- 固定脚本式 Workflow 为最低层执行语义，Graph/IR/Comfy 只转换为脚本语义，不建立第二套 Runtime。
- 补充 Job/Workflow 的 durable truth、lease fencing、checkpoint 收口和旧 Worker 拒绝中途写入的不变量。
- 补充 Connection、SourceInstance、采集计划、SecretStore、ConnectorStateStore、Adapter manifest 和 Source Operation 的边界。
- 分离 `KnowledgeSignal` 与 `ResearchRequest`，明确 Research Workflow 的触发、预算、优先级、幂等和结果重新入库路径。
- 明确上述通用 Runtime、Connection/Secret/State、Knowledge/Research、Outbox/Trigger Consumer 和 Harness Adapter 仍是设计合同，不是当前实现能力。

### v0.15 maintenance note - 2026-08-10

- 记录 Round 97 的 `registrationGeneration`：同一 `workerId` replacement
  递增 generation，heartbeat 不递增。
- 明确 capability projection retirement 的 Prisma 条件更新同时校验
  generation、terminal observation 和 projection revision，防止旧 cleanup 在
  registration replacement 后写入旧 tombstone。
- 明确该 guard 只覆盖同一 SQLite Data Root 的 capability projection cleanup，
  不代表完整 Ingest lease fencing 或生产自动 cleanup subsystem 已完成。

### v0.14 - 2026-08-08

- 将 Workflow 明确为 Cosmos 的主动行为核心，脚本式 Workflow 作为底层执行形态。
- 明确 Graph/IR/Comfy 类表达转换为脚本语义，不建立第二套执行 Runtime。
- 将 Ingest、Knowledge、Research、Maintenance、Delivery 和 Interaction 定义为同一 Runtime 下的轻量 Workflow 分类。
- 将 Entry → Story 明确为可由用户或 Agent 配置的 Knowledge Workflow。
- 将 Research 与 Ingest 解耦：研究信号创建 Research Request，再由 Trigger 启动独立 Research Workflow；研究结果重新经过 Observation → Entry。
- 记录当前单用户阶段按最大产品权限运行，不建设审批 UI 或细粒度权限模型。

### v0.13 - 2026-08-08

- 引入 `nb-memory` 调研结论和知识管理者共享记忆/知识库边界。
- 明确知识管理者的 Web Chat、`cosmos cli`、多个分身和 ingest/research 参与方向；不把它建模为单一 Session。
- 确认个性化配置由 Agent 记忆、Cosmos 行为观察和未来其它信号生成，并简化逐字段 provenance 要求。
- 确认 `Job + Workflow` 组合，以及脚本式 Workflow 与 Workflow IR 的双表示。
- 明确平台推荐信号暂不建模为独立用户偏好输入。

### v0.12 - 2026-08-08

- 记录从用户角度对数据库、Provider/Adapter、Connection/Secret/State、采集计划和 Worker 关系的审查方向。
- 明确 Run、Step、Job、Domain 与 DomainEvent 的职责边界。
- 增加 ConnectionInstance、SecretStore、ConnectorStateStore 和多采集计划的架构边界。
- 明确 Entry → Story 的同步确定性入库、异步知识 Pipeline、LLM Proposal/Provenance 和持久子任务方向。
- 明确外部平台推荐、Admission、Cosmos Ranking、代码规则与 LLM 特征之间的边界。

### v0.11 - 2026-08-08

- 增加 Phase 1B Collector Runtime。
- 固化受管 Bilibili `hot`/`feed`、固定 AI HOT endpoint、异步 Probe 和 Worker-only 外部执行边界。
- 明确 OpenCLI profile/Browser Bridge 前置条件与不保存 Cookie/Token 的约束。

### v0.10 - 2026-08-07

- 对齐 React/Next.js App Router、NestJS、独立 Worker、Prisma + SQLite、Bun 开发/Node 生产的初步技术基线。
- 增加服务器、客户端、客户端与服务分离三种宿主模式，以及版本化 Service Endpoint、Command、Query、Event、SSE Transport 边界。
- 将 Phase 1 明确为 RSS/RSSHub + fixture + 最小 Story projection；跨来源 Story 维护和 Topic 后置。
- 记录 `pi-ai` 先行、`neuro-agent-harness` 独立演进、sidecar 移出 Harness Core，以及 Desktop Shell/Docker 的后置边界。

### v0.9 - 2026-08-07

- v1 和默认产品合同确认为个人本地优先，未来协作仅保留 actor/revision 扩展位。
- Agent 可维护已配置范围内的内部对象；新外部来源、扩大数据范围和外部发送需要显式配置/批准。
- 第一版不建设细粒度权限 UI 或不可信插件沙箱，只运行本地可信扩展。
- Phase 1 首条真实 Connector 确认为 RSS/RSSHub + fixture。
- 本次 grilling 结束，未解决问题转入后置清单。

### v0.8 - 2026-08-07

- Workspace Update 正式采用六种状态，失败/取消保留上一成功内容，成功时原子发布。
- 人类接受字段优先于 Agent 候选 Revision，受保护字段不能被静默覆盖。
- Read State 使用 `last_seen_revision_id` 和 `updated_since_last_seen`。
- merge/split 用户状态迁移采用 canonical 解析与显式 migration，不自动扇出。
- Spotlight 人工覆盖绑定具体 Placement，直到用户解除；不同 kind 共用 policy 合同。

### v0.7 - 2026-08-07

- Story 当前表示采用不可变 Story Revision 和 `current_revision_id`。
- Feed 曝光与主要反馈按 Story/surface 记录。
- Agent 只能直接移除未被人类确认的自动 Topic 成员。
- Workspace 输入采用多对多 binding 和可选主要锚点。
- Spotlight 采用分离信号、版本化 policy、迟滞、TTL 和人工覆盖。
- 新增 Workspace Update/Run 状态边界，更新运行态不再与 Workspace 生命周期或看板状态混写。

### v0.6 - 2026-08-07

- subtype 正式采用受管理注册表，核心 kind 合同保持稳定。
- Story split 正式采用历史壳 + `replaced_by[]` + 显式成员转移，不做模糊单目标重定向。
- v1 不建立 Topic 父子层级，改用 Relation、标签或 Workspace/Board 组织。
- Topic membership 正式采用一个当前角色与 revision history。

### v0.5 - 2026-08-07

- 核心 Story kind 保持稳定，细分通过可扩展 subtype。
- 正式采用 TopicMaintenanceBinding、BoardPlacement、SpotlightPlacement 和 Subscription 解耦。
- 确认自动 Spotlight 使用可续期 TTL，人工固定可以不设 TTL。
- 第一版简化权限与预算：保留 actor/revision/理由/Run，使用全局日预算、单次 Run 上限和紧急保留预算。
- Entry 只有一个主 Story，可通过 evidence_for/mentions 关联其它 Story。
- Story/Topic merge 使用 canonical ID + alias/redirect，保留历史引用。

### v0.4 - 2026-08-07

- Story 扩展为带 kind 的统一规范内容单元，每个 Entry 默认拥有一个主 Story。
- Agent 自动创建 Topic 需要至少两个不同 Story，或命中用户明确跟踪规则。
- Topic 不自动过期，人工归档后置。
- 人类、Agent 和系统统一按协作者记录 actor/revision。
- 接受分层多维维护预算、召回缺口度量和 Workspace 按 kind 显示中文名称。
- 提出将维护、Board 放置、Spotlight 和订阅从 Topic 字段中拆出的候选方案。

### v0.3 - 2026-08-07

- 接受 `Subject -> Topic` 与 `Feature -> Workspace`。
- 每个事件型 Entry 默认创建或加入 Story，允许单 Entry Story。
- Topic 只收录 Story；Topic、Workspace、Spotlight 等语义聚合体验使用 Story，不直接使用 Entry，普通 Feed 的内容单位待确认。
- Agent 创建 Topic 默认激活。
- 第一版聚类和相关推荐不使用 embedding。
- Topic 与 Spotlight 的过期、合并和每日维护预算可配置，并允许 Agent 维护。

### v0.2 - 2026-08-06

- 将同一事件的 Story 聚类与宽泛相关推荐分开。
- 用 Topic 替代 Subject，强调目的驱动、可持续且主观的内容范围。
- 用 Workspace 替代 Feature，Artifact 继续表示版本化输出。
- 明确 Timeline 是视图，热点是 Spotlight 决定，精华是 Board 策展角色。
- 将详细判定规则拆分到 [`0002-information-model.md`](0002-information-model.md)。

### v0.1 - 2026-08-06

- 历史版本使用 Source / Trigger / Flow / Action 模型。
- 将 URL 调整为可选来源属性。
- 建立 Observation、EntryRevision、Asset、Story、Subject、Artifact、Feature 和 Board 模型。
- 把广采集 Admission 与看板 Ranking 分开。
- 明确 Agent Artifact、交互状态、持久运行和后续投递边界。
