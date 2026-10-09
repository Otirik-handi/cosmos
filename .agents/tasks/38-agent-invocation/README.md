# Task 38：Agent Invocation 基础接入 v1

> 编号 38 由维护者 2026-10-08 分配。
>
> 状态：已闭合（2026-10-08）。

## User Request / Topic

Phase 3 的第一步建立 Agent 基础接入。维护者批准以 `agent.invoke@1` 作为版本化 Workflow Action 合同，先用 Fake Adapter 验证 Cosmos Runtime，再在后续切片接入真实 `pi-ai` Adapter；`neuro-agent-harness` 与 `nb-memory` 不进入本切片。

## Goal

在不建立第二套 Agent Runtime 或 durable truth 的前提下，让 Cosmos 能通过现有 Workflow Host 执行一次受控 Agent Invocation：

```text
Workflow Activity
  -> agent.invoke@1
  -> Invocation Port
  -> Fake Adapter
  -> JSON-safe Agent Result
```

## Scope / Non-goals

### Scope

- `agent.invoke@1` Action input/output schema 与 descriptor。
- Agent Invocation Port，以及 Fake Adapter 的注册/组合边界。
- 现有 Action Registry、Activity Worker、Run/Job lease、Attempt、completion、取消、超时、重试的接线与行为测试。
- Agent 结果的 JSON-safe 校验、provider/model/usage/finish reason 等审计字段。
- trusted Worker 执行位置和 Agent 不访问 Prisma/SQLite/Data Root/Secret 的能力边界。
- 实现规格、Task walkthrough 和验证报告。

### Non-goals

- `pi-ai` 真实 Adapter、`neuro-agent-harness` Adapter、`nb-memory` Adapter。
- Story 查询工具、Story → Markdown Brief、Artifact/Artifact Revision、Workspace。
- Knowledge Workflow、Research Request、Research Workflow、Web Chat、CLI。
- HTML/JS、图片、图表、代码执行、页面沙箱和多 Agent。
- 新增 Prisma 模型、migration、产品 HTTP 端点或既有 Ingest 行为改变。

## Authority / Contracts

- Proposal：[`docs/proposals/agent-invocation-v1.md`](../../../docs/proposals/agent-invocation-v1.md)
- ADR：[`docs/adr/0030-agent-invocation-v1.md`](../../../docs/adr/0030-agent-invocation-v1.md)
- 总体架构：[`docs/architecture/0001-cosmos-foundation.md`](../../../docs/architecture/0001-cosmos-foundation.md)
- Action Registry 规格：[`docs/spec/application/0003-action-registry.md`](../../../docs/spec/application/0003-action-registry.md)
- Workflow Host Runtime 规格：[`docs/spec/application/0008-workflow-host-runtime.md`](../../../docs/spec/application/0008-workflow-host-runtime.md)
- 公共合同入口：[`docs/spec/contracts/0001-public-contracts.md`](../../../docs/spec/contracts/0001-public-contracts.md)

## Current State

- 生命周期阶段：**已闭合**。
- 连贯目标：通过现有 Workflow Runtime 执行一次可验证、可取消、可重试、不会绕过 Cosmos durable truth 的 Agent Invocation。
- 可观察验收（≤3）：
  1. `agent.invoke@1` 可注册、解析、校验并由现有 Activity Worker 执行 Fake Adapter；结果通过 JSON-safe schema，并包含 provider/model/usage/finish reason。
  2. 成功、依赖不可用、认证缺失、超时、取消、超预算、malformed payload、Lease 丢失和重试边界都有行为测试，且旧 Ingest/Feed 路径不回归。
  3. Agent Action 不直接依赖 Prisma、SQLite、Data Root、Blob/Artifact Root、Secret 或具体模型 SDK；不新增数据库、产品 HTTP 端点或第二套 durable truth。
- 依赖：现有 `ActionRegistry`、`WorkflowActivityWorker`、`ActionDefinition`、`ActionDescriptor` 和 `nb-workflow@0.2.0`；Fake Adapter 不需要外部模型依赖。
- 受影响合同：新增 `agent.invoke@1` Action 合同和内部 Invocation Port；既有 Run/Job/Lease/Action 合同保持不变。
- 预计核心文件：`packages/contracts/src/`、`packages/application/src/`、`apps/worker/src/`、对应测试与 `docs/spec/`；精确文件由实现计划冻结。
- 验证层级：focused contracts/application tests → Worker/Runtime behavior tests → 全量 `bun run test` → typecheck/build → `docs:check` 与 `git diff --check`。

## Implementation Slices

1. **Contract and Port**：定义 `agent.invoke@1` 输入/输出 schema、Invocation Port、错误映射和 JSON-safe 边界；补合同测试。
2. **Fake Adapter and Registry**：注册 Agent Action、接入 Fake Adapter 和 manifest/catalog；补成功、失败、输出校验和能力边界测试。
3. **Runtime behavior**：通过现有 Activity Worker 验证 lease、cancel、timeout、retry、completion、重启/接管和 late result 行为；不改 durable truth owner。
4. **Spec and handoff**：同步当前实现规格，记录完整验证、未运行项、偏差和后续 `pi-ai` Adapter 边界。

## Decisions and Deviations

- 2026-10-08：维护者批准 Proposal [`agent-invocation-v1`](../../../docs/proposals/agent-invocation-v1.md)。
- 2026-10-08：维护者分配 ADR 0030 与 Task 38。
- 2026-10-08：冻结“`agent.invoke@1` 合同 + Fake Adapter 先行”；真实 `pi-ai` Adapter 后置。
- 2026-10-08：冻结 Agent 第一版执行位置为 `trusted_worker`；Cosmos 持有唯一 Workflow/Job durable truth。

## Verification

Task 已完成。完整命令、实际输出、非严格测试姿态、浏览器/真实来源是否运行、未运行项和偏差记录在 [`walkthrough.md`](walkthrough.md)。全量单元测试 139 个文件/798 个测试通过；typecheck、共享包构建、docs:check 和 `git diff --check` 通过。

## Follow-ups

- 单独设计和实现 `pi-ai` Adapter，包括 provider 配置、凭证、真实错误、usage 和 Node 生产兼容性。
- Agent 可用工具与 Capability 合同，先于 Story Brief 实现冻结。
- Story → Markdown Brief → Artifact Revision 作为后续 Phase 3 Task，不并入 Task 38。
- `neuro-agent-harness` Adapter、Session/Profile/Model Runtime 映射和恢复边界待其合同稳定后单独评估。
- `nb-memory` Adapter、知识管理者 Web/CLI 和多分身共享记忆后置。
