# Cosmos 文档体系

- `../CONTEXT.md`：产品共同语言，记录经常使用、跨模块或容易歧义的核心概念、关系和待讨论边界；不作为完整实体清单。
- `requirements/0001-original-requirements.md`：用户原始需求的 append-only 真相源。新增轮次追加原文，不修辞、不归纳、不把解释写回原文。
- `requirements/0002-product-requirements.md`：当前整理后的完整产品需求，维护需求编号、阶段、验收条件、使用场景和待决策项。
- `architecture/0001-cosmos-foundation.md`：总体架构、运行时、存储、扩展和阶段设计。
- `architecture/0002-information-model.md`：Entry、Story、Topic、相关推荐、热点、Workspace 与 Artifact 的详细模型。
- `api/`：Product Service、Worker Admin、Worker Gateway、DTO、失败场景和
  conformance Draft v0.2；包含五路只读审查和主审 disposition。字段与端点只有
  进入公共 schema 和行为测试后才算已实现。
- `adr/`：已经稳定且改回成本较高的架构决定。
- `adr/0002-nb-workflow-kernel-cosmos-host.md`：当前 Workflow Kernel、可选
  Backend、Cosmos Host、TaskStore/WakeupBus 和 Agent Extension 的稳定决定。
- `adr/0003-service-worker-api-boundaries.md`：Product Service、Worker Admin、
  Worker Gateway、HTTPS long-poll 和 Action execution placement 的稳定决定。
- `research/`：外部项目、数据源、算法和技术验证材料。
- `tasks/`：重大任务的持续 walkthrough，记录计划、实现、验证、偏差和实现级后续。
- `tasks/06-nb-workflow-kernel-convergence/README.md`：`nb-workflow@0.2.0` 已稳定发布，
  Kernel 稳定门禁解除，执行权转交 Task 07；Cosmos Host、固定 Ingest parity、
  manifest-only API 和 Worker Admin 仍按阶段门禁推进。
- `tasks/06-nb-workflow-kernel-convergence/walkthrough.md`：记录历史文档收口、
  实现偏差、未来输入和停止边界。
- `tasks/07-deferred-workflow-host/README.md`：leader-controlled 的实现治理 Task，
  记录 nb-workflow Deferred Activity、Cosmos Host、固定 Ingest parity 和 Worker
  Admin 的阶段门禁；PR A / PR #9 已合并到 `b678fb5`，PR B Activity Host 当前为
  dirty、未提交、未验证 WIP。
- `tasks/07-deferred-workflow-host/walkthrough.md`：记录跨仓库基线、代理边界、
  每轮验证和偏差；历史 Spike 证据与当前验证严格分开。

根状态基线（2026-08-15）：PR #5 `96e27fd`、PR #6 `498018e`、T04 parity `dc78f05`、
T04 runtime `9fe84f2`、T05 `d0b8e03` 和 `t07-action-contract-convergence@61ed21e`
均为保护区或只读重建来源；两个 dirty t07 worktree 的文件内容 hash 尚未登记或验证。

后续顺序是 `nb-workflow` Kernel/conformance → Activity Host durable recovery → 固定
`cosmos.ingest@1` parity → manifest-only Product API → Worker Admin → 远程 Worker
Gateway。Draft、Spike 和 dirty WIP 都不能写成当前已交付能力。

读取顺序通常是：需求原文 → `CONTEXT.md` 中的产品共同语言 → 当前 PRD → 当前架构 → 对应 Task → 相关 ADR / Research。
