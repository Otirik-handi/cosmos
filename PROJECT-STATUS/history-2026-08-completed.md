---
parent: PROJECT-STATUS.md
range: 无日期 ~ (1 节)
sealed_at: 2026-09-11
tags: [project-status, history]
tokens_est: 4009
---

## 已完成

- 初始化本地 `master` 分支。
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
- 确认当前单用户阶段知识管理者和 Agent 按最大产品权限运行，不建设审批 UI 或细粒度权限模型；未来再叠加远端/多人/不可信扩展的权限策略。
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
- 完成第一版运行诊断日志：API、Worker、Connector、存储和 Web 服务端统一输出 `log.v1` JSONL，支持 request/Run/Job/Source/Connector 关联、脱敏、轮转和本地保留。
- 按 shadcn skill 初始化 `components.json`，加入 `button`、`card`、`badge` 源码组件和最小 Story Feed 页面。
- 固化 `Source`、`Run`、`Job`、`Feed`、`Search`、`Story`、`Entry`、`Revision`、`Asset`、错误、健康检查和 SSE Event Envelope 合同，并提供 HTTP Service Client。
- 完成 Prisma migration、`COSMOS_DATA_ROOT`/`DATABASE_URL` 数据边界、隔离 Data Root、内容寻址 Blob Store 和 FTS5/BM25 受控 SQL Adapter。
- 完成 fixture/RSS Connector 的 URL、无 URL、重复轮询、来源修订和媒体元数据路径；重复录入不产生重复 Entry，来源变化追加 Revision，原始 Observation 保留。
- API 已提供 Source 创建/查询/启停/测试、手动 queued Run、Run 状态、Feed、Search、Story/Entry/Revision 详情和受控 Asset 读取。
- Worker 已接入持久 Job claim、租约 token、过期接管、旧 token 拒绝、有限指数退避、schedule bucket、heartbeat 和 checkpoint。
- API 手动 Source Run 与 schedule 已统一通过 Prisma atomic
  `WorkflowCommandRepository` 创建 `cosmos.ingest@1` Run；Worker 默认执行
  `source.fetch@1 → library.ingest@1[] → source.checkpoint@1`，Probe 与兼容入口
  暂时保留旧 Source Job。
- 固定 Ingest 的领域事务同时验证 Workflow Run lease 与 Action Job lease；
  Observation、Entry/Revision、Asset、最小 Story、FTS、DomainEvent/Outbox 和
  checkpoint 的 stale Worker 写入均有 Prisma 行为测试。
- URL-free fallback identity 已包含规范化 `sourceLocator`；Observation 保存
  manual/schedule、Workflow ref 和稳定 Action command key。缺少条目级稳定
  locator 时，内容修订仍可能生成新 Entry。
- Workflow Run 保存 definition/input/correlation、lane/priority/budget 以及真实
  started/finished 时间；Source 查询通过 correlation 投影最近一次 Ingest
  Workflow 状态。
- 固定 Ingest Run 保存独立 `SourceExecutionSnapshot`、cursor、checkpoint revision
  和 trigger；`source.fetch@1` 不再重新查询当前 Source。InMemory 与 Prisma
  行为测试证明排队后修改 Source 配置不会改变该 Run，幂等重放也不会读取新配置。
- Source checkpoint 保存单调 revision；并发旧 Run 的 CAS 失败会记录
  `source.checkpoint.superseded.v1`，保留已经采集的 Observation，但不会回滚
  新 cursor。
- Action 的 `retry_wait` 通过 `nextAttemptAt` 参与 Run claim；重试到期前不会让
  父 Run 被 Worker 高频反复领取。
- 当前 Worker Admin 提供独立 loopback `healthz`、`readyz`、status、capabilities、metrics 和 drain；它只维护进程内状态与本地 executable evidence，不是持久 Worker Registry。
- 当前 `master` 不提供持久 `WorkflowWorkerRegistration`、TTL 注册生命周期、版本化注册表 evidence 或 `GET /api/v1/workflow-workers`；`Worker Admin.status()` 的 `registrationGeneration` 固定为 `null`。
- 修复 Worker process heartbeat 的 fire-and-forget race，Supervisor drain 现在等待
  `ready` observation 后再写入 `stopped`。
- Worker capability discovery、持久 evidence、capability evaluator、availability projection、`no_capable_worker` 和 cleanup consumer 当前均未在 `master` 实现；归档标签中的对应内容不能作为当前能力证据。
- 增加 Phase 1B 受管 Collector Runtime：`bilibili`、`aihot`、`rss`、`fixture-rss` 使用业务 Source kind，OpenCLI 不暴露为通用来源类型。
- Probe 已改为异步持久 Job；API 只创建/查询 Job，Worker 执行 dry-run，Probe 不写 Observation、Entry、Asset 或 checkpoint。
- 完成 OpenCLI 固定版本 `1.8.6`、外部 executable 覆盖、版本校验、Browser Bridge doctor 前置检查和 profile 引用边界；Cosmos 不保存 Cookie/Token。
- 完成 AI HOT 固定 endpoint `https://aihot.virxact.com/api/v1/items`、cursor 采集、统一 Entry 标准化和错误恢复。
- 真实 AI HOT Worker smoke 已通过：隔离 SQLite 中 queued Run 成功并保存 3 条 Entry。
- SSE 已提供持久 Domain Event、游标回放、`Last-Event-ID`/`after`、keepalive 和 `snapshot_required`；Web 会自动刷新并展示服务/SSE 状态。
- Web 已通过 Service Endpoint 完成来源表单、真实健康检查、队列触发、Feed、关键词/来源/时间/分页搜索和 Story → Entry → Source/Revision 展开。
- Node 生产冒烟和 Playwright 浏览器链路已通过；浏览器验证覆盖来源创建、队列触发、Feed、搜索、URL-free Story 详情和服务状态。
- 结束本次 grilling；实现级未决问题转入后置清单。
- 确认第一版聚类和相关推荐不使用 embedding。
- 完成 `nb-memory` 本地调研：确认其适合作为知识管理者共享长期记忆/知识库，不替代 Cosmos 的 Workflow、Job 或来源事实运行时。
- 确认知识管理者是共享 `nb-memory` 之上的高权限系统角色，可通过 Web Chat、`cosmos cli` 和 ingest/research Workflow 参与；它不是单一 Session。
- 修正个性化配置方向为“Agent 记忆 + Cosmos 观察到的用户行为 + 未来其它信号 → 程序可读配置”，暂不要求逐字段 provenance，也不独立建模平台推荐偏好信号。
- 确认运行控制采用 `Job + Workflow` 组合；脚本式 Workflow 是底层执行形态，Graph/IR/Comfy 类表达转换为脚本语义。
- 确认 `nb-workflow` 是规范脚本 Kernel，持久化通过可选 Backend 组合；Cosmos
  保留 Run/Journal、TaskStore、Job/Lease、Outbox、Worker 和领域事务。
- 确认队列拆为 SQL TaskStore 与可选 WakeupBus；Redis Streams 只做唤醒、限流
  和缓存，不成为 Job/lease 的第二权威。
- 确认 Activity 是 journal 单元、ActionDefinition 是能力合同、Job 是可领取
  任务、Attempt 是持有 lease 的一次执行，Step 降为可选逻辑/UI 投影。
- 确认 `wf.agents.invoke` 属于可选 Agent Extension，具体 Harness Adapter 等
  `neuro-agent-harness` 文档稳定后接入，Core 不依赖 Harness。
- 确认 Workflow 是主动行为核心；Ingest、Knowledge、Research、Maintenance、Delivery 和 Interaction 使用同一 Runtime 的轻量分类。
- 确认 Ingest 不等待 LLM；Entry → Story 是用户/Agent 可配置的 Knowledge Workflow，Research 通过 Request/Trigger 与 Ingest 解耦。
- 将 `CONTEXT.md` 收缩为产品共同语言，只维护经常使用、跨模块或容易歧义的核心概念；实现级对象留待真实开发需要时再定义。
- 迁移并精简适用于 Cosmos 的 Agent、Task、worktree 和验证约定。
- 将 neuro-book 的通用协作流程去领域化迁移到 Cosmos：补充双语贡献指南、Issue 分流、标签清单、PR 模板和安全报告入口；未复制依赖 neuro-book 运行时代码、发布脚本或产品专用 CI 的 workflow。
- 确认 Cosmos 按 GNU Affero General Public License v3.0 only（AGPL-3.0-only）发布，并复制许可证全文到根目录 `LICENSE`。
- 补足协作主路径、远端同步、Windows worktree 清理、RSS/RSSHub 首条切片和公开贡献权利说明；GitHub Actions 仍按本阶段决定保持不变。
- 将开发治理资料收敛到 `.agents/`：原 `docs/tasks/` 的 11 个 Markdown 文件完整迁入 `.agents/tasks/`，历史编号和正文保留，活跃链接一次性切换；新增 `.local/` 用户本地资产边界，以及 `docs/proposals/`、`docs/standards/`、`docs/testing/` 三个治理入口。
- 新增无外部依赖的 `bun run docs:check` 并接入 CI quality job；审查后补齐 Proposal/Issue/Task 准入矩阵、Task 证据唯一写入位置、动态状态单一真相源、Agent 治理入口可达性以及 POSIX/Windows 绝对路径和治理文档扫描。2026-08-19 本地验证 `failures=[]`、`checkedFiles=256`，聚焦治理测试 1 个文件 / 8 个测试、全仓类型检查和全量单元测试 29 个文件 / 193 个测试均通过。该治理变更未运行 build、Node E2E、浏览器、Docker 或真实来源验收。

