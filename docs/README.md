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
- `tasks/07-deferred-workflow-host/README.md`：leader-controlled 的实现治理 Task，记录 nb-workflow Deferred Activity、Cosmos Host、固定 Ingest parity 和 Worker Admin 的阶段门禁；当前实现基线已推送到 `master=origin/master=3af886a0099bc778c32475513740b6562bb6e31f`。
- `tasks/07-deferred-workflow-host/walkthrough.md`：记录跨仓库基线、合入/规格化过程、每轮验证和偏差；历史 Spike 证据与当前验证严格分开。

当前实现基线为 `master=origin/master=3af886a0099bc778c32475513740b6562bb6e31f`（已提交、已 push、未部署）；`@notnotype/nb-workflow@0.2.0`、Durable
Host、固定 `cosmos.ingest@1`、WorkerRuntime、WorkflowRun durable projection 和 Worker
Admin 的已实现行为以源码、focused tests、property tests 和分层 E2E 为准。
规格入口为 [`spec/README.md`](spec/README.md)，测试入口为 [`testing.md`](testing.md)，只描述
已实现和已验证边界，不把需求、Draft、历史 Spike、Gateway、Redis 或多主机目标当作当前能力。

当前验证矩阵：`bun run db:validate`、`bun run db:generate`、`bun run typecheck`、
`bun run test:property`、`bun run test`、`bun run build`、`bun run lint:web`、
`bun run test:e2e`、`bun run test:browser` 和 Windows `scripts/smoke-node.ps1` 已通过。
Docker (`bun run test:docker`) 因当前机器缺少 Docker CLI 未运行；真实 RSS、AI HOT、Bilibili
命令因缺少显式外部前置未运行。完整 parity、长时双 Worker 压力、发布/部署仍不由这些门禁证明。

读取顺序通常是：实现规格索引 → 公共合同 → 所需组件 spec → 测试入口 → 相关 ADR/架构背景 →
对应 Task walkthrough。需求原文、PRD、架构、ADR、API Draft 和 Task 不互相替代；具体组件状态、
输入输出和验收请以 [`spec/README.md`](spec/README.md) 及其组件链接为准。
