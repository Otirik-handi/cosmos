---
parent: PROJECT-STATUS.md
range: 2026-08-08 ~ 2026-08-15(7 节)
sealed_at: 2026-09-11
tags: [project-status, history]
tokens_est: 4993
---

## 2026-08-08 本轮架构审查记录

本轮从用户配置和扩展生产者的角度检查了数据库、Adapter、Worker、Pipeline、LLM 和推荐链路，结论如下：

- 当前 Phase 1/1B 是可靠采集和最小离线信息库基础，不是完整的可编排知识平台。
- 当时先区分 `Domain`、`Run`、`Step`、`Job` 和 `DomainEvent`；2026-08-11 又将
  运行词汇细化为 Run、Activity、Job、Attempt 和可选 Step。
- 数据库是事实、状态、历史和用户真相的中心；插件和 Agent 通过版本化合同访问，不直接依赖 Prisma 表。
- 长期扩展需要统一 `ConnectionInstance`、`SecretStore` 和 `ConnectorStateStore`。Adapter 负责认证协议和状态 schema，但不自行决定 Secret 的持久化位置。
- 同一个连接可以拥有多个独立采集计划，例如 Bilibili 动态每 30 分钟、推荐流每 2 小时；每个计划分别拥有 Trigger、Workflow、checkpoint、预算、错误和重试边界。
- Ingest 本身是一种 Workflow；外部来源事实先完成 Observation/Entry/Revision/Asset 入库，不等待 LLM。
- Entry → Story 采用“同步确定性事实入库 + 异步可配置 Knowledge Workflow”。策略可以是批量全量 Agent，也可以是脚本优先后升级 Agent。
- Research 不直接耦合 Ingest；分析信号创建 Research Request，由 Trigger 启动独立 Research Workflow，研究结果重新经过 Observation → Entry。
- 推荐区分外部候选、Admission 和 Cosmos Ranking；代码负责硬约束和 LLM 不可用时的降级，LLM 提供可追溯的异步特征或受限 rerank。
- `nb-memory` 调研已经完成并写入研究文档；Cosmos 与其的 Adapter、共享存储生命周期和 Node 生产兼容性尚未实现或验收。
- 2026-08-10 完成 Task 05：RSS、Bilibili、AI HOT 输出统一内容合同；作者空 ID、listing/video 映射、指标无 Revision 刷新和 TemporalValue 持久化已有 focused 覆盖。
- 个性化配置不再按每个字段设计完整 producer/version/evidence 账本；一般 Story、关系、推荐特征和 Artifact 派生结果仍保留各自 provenance 合同。

本轮不扩大 Phase 1 实现范围。继续增加更多平台 Adapter 前，优先建立 Connection/Secret/State、脚本优先 Workflow API、持久子任务、Knowledge/Research Workflow、Proposal/Provenance 和 `nb-memory` Adapter 的实现 Task。

## 2026-08-11 Workflow Kernel 与队列架构修正

本轮从当前代码、`nb-workflow` 和原始 session 结论重新划定所有权：

- 当前 Cosmos Spike 没有基于 `nb-workflow`，两者是平行脚本实现；继续扩展会让
  fingerprint、Query journal、map/all、等待和恢复语义分叉。
- 新目标是 `nb-workflow` 提供类似 LangChain 的通用脚本 Kernel 和可选 Backend，
  Cosmos Worker 通过 Durable Backend/Host 组装它。
- 当前 Prisma Store、Job/Lease、Outbox、Worker Supervisor、双 fence、
  Source snapshot、checkpoint CAS、固定 Ingest 和生产证据保留，不推倒重写。
- 队列固定为 `TaskStore + WakeupBus`。SQLite/PostgreSQL 中的 Job/lease 是唯一
  真相；Redis Streams 可以唤醒 Worker，但 Worker 仍回 SQL claim。
- 当前 Worker 已有 slot 并发和多进程 lease 基础；Provider/Connection/Source/
  Model 资源限流、公平调度和 CollectionPlan overlap policy 尚未实现。
- Agent 调用属于可选 Extension；Harness 文档稳定前不接入。

已新增 ADR-0002 与 Task 06。此次只同步文档，没有修改两个仓库的运行时代码，
也没有实现 Redis、PostgreSQL、Migrator、远程 Worker 或 Harness Adapter。

## 2026-08-11 API/DTO 草案与五路审查

本轮从原始需求、PRD、信息模型、总体架构和当前实现反推完整公共能力，新增独立
[`docs/api/`](docs/api/README.md)：

- 公共 Header、分页、错误、幂等、ETag、ValueRef、SSE 和兼容规则；
- Product Service 的 Source/Connection/CollectionPlan、Workflow、Library、
  Story/Topic、Knowledge/Research、Feed、Workspace/Artifact、Board、
  Publication/Delivery 和数据运维 API/DTO；
- Worker Admin 的 liveness/readiness/status/capability/metrics/drain；
- Worker Gateway 的 bootstrap Session、long-poll claim、Attempt heartbeat、
  Receipt/Result、Value transfer、Secret reservation、replacement/resume 和
  backpressure；
- 用户、故障、Transport 和 Direct/Gateway conformance 场景。

五个隔离只读代理分别审查产品覆盖、durable runtime、Gateway 分布式协议、
运维安全/生命周期和 DTO/Zod 演进性，5/5 成功。主审后修订为 Draft v0.2：

- 分开实现成熟度与产品 Phase，明确 Phase 1 remainder；
- 补齐 Trigger/Research provenance、CollectionPlan discovery context、
  KnowledgeSignal disposition、协作审计和 Story 状态迁移；
- 补齐推荐解释、Workspace update、Artifact sandbox、Subscription 和数据生命周期；
- Gateway 使用 Attempt owner tuple + resume CAS/token rotation，增加 late evidence、
  persisted slot reservation、claim batch replay、Receipt CAS、deadline 和
  canonical bytes；
- 明确未认证 Product API 只允许本机/受信网络，公网/真实 Gateway/Secret Broker
  仍是独立 release gate。

详细发现、证据和 disposition 见
[`docs/api/0007-review-findings.md`](docs/api/0007-review-findings.md)。本轮没有修改
代码、数据库、migration 或测试；v0.2 不能被报告为已实现 API。

## 2026-08-11 文档收口与实施暂停（历史记录）

本轮将架构、API/DTO、ADR、Task 和项目入口统一为同一实施顺序：

```text
稳定 nb-workflow Kernel / conformance
-> 参考 Task 04 Spike 和 API Draft v0.2
-> 实现 Cosmos 本地 Worker / Durable Host
-> 实现 Worker Admin
-> 最后考虑远程 Worker Gateway
```

Task 04 继续作为历史 Spike、parity 和回滚证据，不再扩展为第二套规范 Kernel。
Task 06 当时处于暂停状态；该历史状态已由 `nb-workflow@0.2.0` 稳定发布解除，执行权
转交 Task 07。具体 Cosmos Host、Attempt 物理表和 Gateway 实现仍按后续阶段门禁验证。

以上仅记录 2026-08-11 的历史文档状态；当前基线和实施边界见下方 2026-08-15 记录。

本轮只修改 Markdown 并运行文档一致性检查，没有修改代码、Prisma、migration、
依赖、Docker 或测试，也没有 commit、push、PR、合并或远端操作。
## 2026-08-15 Task 07 阶段一基线（历史记录）

本节保留合入前的阶段一事实；它不是当前实现状态。Task 07 随后已以
`5ce628690ab0110b0525e8ebcbacbe673ced9c55` 本地快进合入 `master`。

- 当时实现 worktree 为 `feat/t07-activity-host@b678fb5`，dirty 边界为 13 个 modified、
  10 个 untracked 文件；当时 PR B 未提交、未创建 PR，文件内容 hash 未登记、未验证。
- 当时 PR A / PR #9 已合并到 `master = origin/master = b678fb5`，其 Prisma Backend、
  Blob ValueStore 和 `@notnotype/nb-workflow@0.2.0` 依赖是当时实现基线。
- 当时固定 `cosmos.ingest@1` parity、Activity Host 完整门禁、manifest-only Product API
  和 Worker Admin 均保持未完成/未验证；这些历史陈述不覆盖当前合入代码。
- PR #5 `96e27fd`、PR #6 `498018e`、T04 parity `dc78f05`、T04 runtime `9fe84f2` 和
  T05 `d0b8e03` 均为保护区；`t07-action-contract-convergence@61ed21e` 也不在本轮合入。

## 文档审查结论

### 已验证的 Task 04 Spike 基线（归档 WIP，不属于当前 master）

- Source execution snapshot focused：3 个测试文件、32 个测试通过；覆盖
  Source 查询态与执行态合同分离、相同幂等键不重读配置，以及真实 Prisma Run
  排队后修改 Source 配置仍使用首次快照。
- 当前全量 Vitest：39 个测试文件、285 个测试通过；packages/apps typecheck、
  Web lint、Prisma validate/generate 和 production build 已通过。
- 全新隔离 Data Root 已应用当前 4 条 migration，`db:status` 为 up to date。
  从真实 `origin/master` 的 3 条 migration 预置 Source、Checkpoint、Run、Job、
  DomainEvent 和 Observation 后升级到第 4 条，全部数据保留，checkpoint revision
  为 `0`，新增 Workflow 外键为 `null`，`PRAGMA foreign_key_check` 无错误。
- Phase 1 固定 Ingest Workflow 链路可运行：
  fixture/RSS → Workflow Run/Action Job → Observation/Entry/Revision/Asset →
  最小 Story projection → Search/Feed/Story 查询。
- 归档 WIP 的 Registry-enabled Node production smoke 曾验证 API/Worker、Workflow Worker registration、固定 Ingest、Feed/Search/Story、SSE、结构化日志关联和 registration token 不暴露。
- Next standalone 已在 Windows 上重建目录型内部 symlink；Node 24 可启动 standalone server。浏览器验收覆盖 Source 创建、Workflow 触发、SSE 自动刷新、
  Feed/Search/Story/Entry/Source/Revision/Observation、URL-free 内容、第二次运行
  幂等和健康状态，控制台无 error/warning。
- 代码和文档都保留了当前单用户最大产品权限、旧 Observation 不覆盖和 Web 不直接访问数据库/文件系统的边界。
- Round 86–97 已验证 Worker evidence 的版本化持久化、catalog admission
  Application port/Prisma bridge、独立 capability projection reducer、最小
  durable Prisma projection store、跨 client lease fencing、registration
  observation、checkedAt registry snapshot、有界 stale candidate query 和
  Maintenance Workflow command builder，以及保留 last-known snapshot 的
  `retiredAt`/tombstone CAS 和最小 Cleanup Workflow/Action Job 执行 seam。
  Round 97 又验证了 registration generation 递增、replacement 后旧 cleanup
  被拒绝，以及 Prisma 单条条件更新对 registration generation/terminal
  observation 的原子保护；availability API/scheduler、独立生产 consumer、
  自动 candidate 消费、真正 delete/purge 和 authority projection 仍未实现。

### 尚未完成

- 通用自定义 Workflow 的插件加载、稳定管理 API、Trigger/Binding 产品配置、
  Graph/IR 编译器和完整生产运维面。Task 04 有独立脚本 Runtime、
  WorkflowContext、Child Workflow 和恢复 Spike，但目标 `nb-workflow` Kernel 与
  Cosmos Host convergence 尚未实现。
- Connection、SecretStore、ConnectorStateStore、多个采集计划和 Adapter manifest/Source Operation。
- KnowledgeSignal、Knowledge Workflow、ResearchRequest、Research Workflow、
  通用 Trigger Consumer、Outbox 外部发布和完整事件消费恢复。
- `neuro-agent-harness`/`nb-memory` Adapter、Knowledge Manager Web/CLI、行为观察到程序配置的转换和推荐系统。

### 阻塞后续扩展的实现缺口

- 当前 discovery provenance 只表达 manual/schedule；关注账号、推荐流、搜索、
  公告监控和 Research 需要未来采集计划提供完整 discovery context。
- Source/Connection/多采集计划/StateStore 尚未真正建模；checkpoint 目前仍按
  Source 保存，不能表达一个 Connection 下多个独立计划。
- Source 删除与历史 Observation 保留、内容寻址 Blob orphan GC、Outbox 外部
  投递和通用 Consumer 恢复仍需单独设计和验收。
- 当前 `master` 尚未实现 Worker capability discovery/Registry、版本化持久 evidence、权威 availability projection、scheduler/consumer 消费或 `no_capable_worker`；归档标签 `b8a1701` 的 WIP 代码不属于当前主线，未来若恢复该方向必须在当前基线上重新实现并验收。
- URL-free fallback 尚无 `identityStrength`、`identityVersion` 和
  `identityBasis`；没有条目级稳定 locator 时，内容修订可能形成新 Entry。
- 固定 Ingest 会在 Job result、Invocation result、Step output 和后续 Action
  input 中重复保存 page/item；大 Feed/媒体前需要 value/reference 和 journal
  retention。
- Source 列表当前有 `1 + 2N` 的 legacy/Workflow 最近运行查询；Phase 1 小规模
  可运行，扩展更多来源前需要批量 projection。
- 当前 Product API 无认证并可绑定 `0.0.0.0`，Compose 发布 API 端口；只能视为
  本机/受信网络验收入口，不能作为公网模板。CORS 不等于认证。
- fixture Source 当前允许绝对 `fixturePath`；在远程暴露前必须限制到受控 fixture
  root，拒绝绝对路径、遍历和 symlink escape。
- 当前 Source/Job/Asset public projection 尚未证明完全移除 Secret、内部 config、
  arbitrary result、`storageKey` 和绝对路径；Controller 需要白名单 DTO。
- 当前已有本地 Worker Admin，但其 status、capabilities、drain 和 heartbeat 观测主要是进程内状态；Gateway owner handoff、late-evidence、Receipt CAS、claim capacity/replay/backpressure 和真实 bootstrap identity 仍未实现或验收。

### 项目级质量审查（历史记录）

以下结论来自 Task 07 合入前的 dirty worktree 审查，仅保留为历史证据；当前实现基线及
已验证/未验证边界以上述 2026-08-16 记录和 [`docs/spec/README.md`](docs/spec/README.md)
为准。

- 当时 `feat/t07-activity-host` 的 HEAD 为 `b678fb5`，有 13 个 modified、10 个
  untracked 文件，包含 PR B Activity Host WIP；该 WIP 当时尚未提交或通过完整门禁。
- 当前 Task 07 已在 `5ce6286` 本地合入；合入不等于完整 Activity Host recovery、固定
  Ingest parity、Docker/browser/真实来源或 Gateway/多主机门禁完成。
- PR A / PR #9 提供 Prisma Backend、Blob ValueStore 和 `0.2.0` package consumer 基线；
  历史保护区内容不能替代当前合入源码和行为测试。

已完成的架构拍板：

- `nb-workflow` 是规范 Kernel，Cosmos 是 Durable Host；
- Activity/ActionDefinition/Job/Attempt/Step 的职责；
- TaskStore/WakeupBus 与 Redis 非权威边界；
- API/Worker/Migrator 目标宿主边界；
- Agent Extension 等待 Harness 合同。

Task 06 的 Kernel 稳定门禁已解除，执行权转交 Task 07。URL-free identity
strength/version/basis、Source `1 + 2N`、Blob orphan GC 和 generic command payload
冲突继续作为独立债务；Task 07 已本地合入，但完整 parity、恢复和生产边界门禁仍未全部通过。

## 2026-08-15 Task 07 dirty worktree 实施证据（历史 Round 7）

以下只描述 `.worktree/t07-activity-host` 当时的未提交实现。Task 07 后来已本地合入
`master`；本节的 `131 tests` 与 Node production smoke 仅是 Round 7 历史证据，不是当前
合入提交的完整验收：

- `packages/application` 已分离 manifest/control 与 Worker executable；API catalog、健康探针、
  WorkflowRun 查询和白名单 Product projection 已实现。
- `packages/storage-prisma` 已从 Activity lifecycle DomainEvent 投影 AttemptSnapshot；Worker
  durable fixture smoke 已通过 source.fetch → library.ingest → source.checkpoint、领域写入、
  checkpoint revision、Search 和 Attempt 查询。
- 新增独立 `packages/worker-admin`，实现 direct loopback `/healthz`、`/readyz`、status、
  capabilities、drains 和 `/metrics`；非 loopback 绑定需要显式 authorize，drain 支持幂等和
  deadline timeout；Worker 主循环已接入 readiness/停止新 claim/关闭资源。

历史验证：`bunx vitest run` 为 22 个文件、131 个测试通过；根 `bun run typecheck` 和
`bun run build` 通过；隔离数据库上的 Node Worker production smoke 曾报告 `/healthz`、
`/readyz`、`/admin/v1/status`、`/metrics` 返回 200，drain 返回 202，进程 drain 后退出码 0。

Round 8 当时仍未验证完整固定 Ingest parity（重复/修订/媒体/abort/takeover/Feed/Search/Story）、
双 Worker 长时 fencing、跨进程 recovery、Worker Admin SIGTERM/活跃 Attempt deadline、真实来源、
browser、Docker、Gateway、Redis、多主机和共享分支合并。共享分支合并随后已发生；其余边界仍
按本文顶部当前状态保留。旧 IngestionWorker 路径继续作为回滚基线。
