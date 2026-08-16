# Cosmos 文档体系

- `../CONTEXT.md`：产品共同语言，记录经常使用、跨模块或容易歧义的核心概念、关系和待讨论边界；不作为完整实体清单。
- `requirements/0001-original-requirements.md`：用户原始需求的 append-only 真相源。新增轮次追加原文，不修辞、不归纳、不把解释写回原文。
- `requirements/0002-product-requirements.md`：当前整理后的完整产品需求，维护需求编号、阶段、验收条件、使用场景和待决策项。
- `architecture/0001-cosmos-foundation.md`：总体架构、运行时、存储、扩展和阶段设计。
- `architecture/0002-information-model.md`：Entry、Story、Topic、相关推荐、热点、Workspace 与 Artifact 的详细模型。
- `api/`：Product Service、Worker Admin、Worker Gateway、DTO、失败场景和 conformance Draft v0.2；包含五路只读审查和主审 disposition。字段与端点只有进入公共 schema 和行为测试后才算已实现。
- `adr/`：已经稳定且改回成本较高的架构决定。
- `adr/0002-nb-workflow-kernel-cosmos-host.md`：当前 Workflow Kernel、可选 Backend、Cosmos Host、TaskStore/WakeupBus 和 Agent Extension 的稳定决定。
- `adr/0003-service-worker-api-boundaries.md`：Product Service、Worker Admin、Worker Gateway、HTTPS long-poll 和 Action execution placement 的稳定决定。
- `research/`：外部项目、数据源、算法和技术验证材料。
- `tasks/`：重大任务的持续 walkthrough，记录计划、实现、验证、偏差和实现级后续。
- `tasks/06-nb-workflow-kernel-convergence/README.md`：`nb-workflow@0.2.0` 已稳定发布，Kernel 稳定门禁解除，执行权转交 Task 07；Cosmos Host、固定 Ingest parity、manifest-only API 和 Worker Admin 的当前实现状态以合入代码和测试为准。
- `tasks/06-nb-workflow-kernel-convergence/walkthrough.md`：记录历史文档收口、实现偏差、未来输入和停止边界。
- `tasks/07-deferred-workflow-host/README.md`：leader-controlled 的实现治理 Task，记录 nb-workflow Deferred Activity、Cosmos Host、固定 Ingest parity 和 Worker Admin 的阶段门禁；Task 07 已以 `5ce628690ab0110b0525e8ebcbacbe673ced9c55` 本地合入 `master`，未 push、未创建远端 PR。
- `tasks/07-deferred-workflow-host/walkthrough.md`：记录跨仓库基线、合入/规格化过程、每轮验证和偏差；历史 Spike 证据与当前验证严格分开。

当前实现基线为 `master = 5ce628690ab0110b0525e8ebcbacbe673ced9c55`，父提交为
`b678fb5`，相对 `origin/master` ahead 1。`@notnotype/nb-workflow@0.2.0`、Durable
Host、固定 `cosmos.ingest@1` 和 Worker Admin 的已实现行为以该提交的源码/测试为准。
规格入口为 [`spec/README.md`](spec/README.md)，只描述已合入实现，不把需求、Draft、历史
Spike、Gateway、Redis 或多主机目标当作当前能力。

未验证或未完成边界仍包括：固定 Ingest 的完整 parity 矩阵、跨进程 recovery、双 Worker
长时 fencing、Worker Admin SIGTERM/活跃 Attempt deadline、Docker/browser/真实来源，以及
Gateway、Redis、多主机和远程 Worker。旧 IngestionWorker 路径保留为回滚/兼容边界。

读取顺序通常是：实现规格索引 → 公共合同 → 所需组件 spec → 相关 ADR/架构背景 → 对应
Task walkthrough。需求原文、PRD、架构、ADR、API Draft 和 Task 不互相替代；具体组件状态、
输入输出和验收请以 [`spec/README.md`](spec/README.md) 及其组件链接为准。
