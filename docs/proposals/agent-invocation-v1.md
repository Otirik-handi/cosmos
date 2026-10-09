# Proposal：Agent Invocation 基础接入 v1

> 状态：accepted
>
> 日期：2026-10-08
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) AGT-001、AGT-002、AGT-009、AGT-014、RUN-006、RUN-007、NFR-003、NFR-007
>
> 关联设计：总体架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) 当前决定 44、53、55、56、58、72；信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §1、§11
>
> 关联 ADR：[`0001`](../adr/0001-durable-workflow-runtime.md)（Cosmos durable truth 与 Harness 边界）、[`0002`](../adr/0002-nb-workflow-kernel-cosmos-host.md)（Agent Extension 与 `agent.invoke@1`）
>
> 关联实现规格：[`Action Registry`](../spec/application/0003-action-registry.md)、[`Workflow Host Runtime`](../spec/application/0008-workflow-host-runtime.md)、[`Action Contract`](../spec/contracts/0001-public-contracts.md)

## 1. 问题

Phase 3 需要 Agent 参与 Knowledge、Research、Artifact 和 Workspace 工作，但当前仓库还没有 Agent Action、模型依赖或 Agent Adapter。现有 Workflow Runtime 已经拥有 Run、Activity、Job、Attempt、Lease、取消、重试和 Action Registry；如果 Agent 另建一套执行路径，会产生第二份任务状态、重复的恢复语义和无法统一的审计边界。

架构已经规定：Agent 是可选的 Workflow Extension，在 Cosmos 中映射到版本化 `agent.invoke@1` Activity/Action/Job；Cosmos 持有 Workflow 与 Job 的 durable truth，具体 Agent Runtime 通过 Adapter 接入。当前文档同时记录了 `pi-ai` 先行和 `neuro-agent-harness` 后续接入方向，但仓库中尚未有可执行的 Agent 合同。

本 Proposal 只解决 Agent Invocation 的基础边界，不提前实现完整 Phase 3 产品。

## 2. 目标与非目标

### 目标（v1 第一切片）

1. 建立版本化的 `agent.invoke@1` Action 合同，沿用现有 Action Registry 和 Workflow Host Runtime。
2. 建立 Agent Invocation Port/Adapter 边界，使上层 Workflow 不依赖具体模型 SDK、Harness 或记忆系统。
3. 提供 Fake Adapter，验证成功、失败、取消、超时、预算限制和输出校验等运行语义。
4. 证明 Agent 调用使用现有 Run、Activity、Job、Attempt、Lease、重试和取消合同，不建立第二套 durable truth。
5. 为后续 `pi-ai` Adapter、Story Brief、Knowledge Workflow 和 Research Workflow 留出稳定接入点。

### 非目标（明确后置）

- 不实现 Story 查询工具或 Story → Brief 产品流程。
- 不实现 Artifact、Artifact Revision 或 Workspace 数据模型。
- 不实现 Knowledge Workflow、Research Request 或 Research Workflow。
- 不接入 `neuro-agent-harness`。
- 不接入 `nb-memory`、Web Chat、`cosmos cli` 或多 Agent 分身。
- 不实现 HTML/JS、图片、图表、代码执行或生成页面沙箱。
- 不允许 Agent 直接写 Prisma、SQLite、Data Root、Blob/Artifact Root 或 Secret。
- 不改变既有 Ingest 行为；普通 Feed 不依赖 Agent 在线。
- 不把模型调用结果直接当作来源事实或最终用户真相。

## 3. 当前行为与证据

- `packages/contracts/src/action.ts` 已有 `actionKindSchema` 的 `agent` 值、版本化 Action ref、输入/输出 schema、能力列表、执行位置、取消和重试合同。
- `packages/application/src/action.ts` 已有进程内 `ActionRegistry`，负责 Action 注册、解析、输入/输出校验、公开分发与 host fence 分发。
- `packages/application/src/workflow-host-runtime.ts` 已有 Activity Worker：领取 Activity Job，取得 Run/Job lease，按 placement 分发 Action，处理取消、重试、完成和失败。
- `packages/application/src/catalog.ts` 已有 Action manifest 投影，但当前内置 Action 目录没有 `agent.invoke@1`。
- 根 `package.json` 当前只有 `@notnotype/nb-workflow` 运行时依赖，没有 `pi-ai` 或 `neuro-agent-harness` 依赖。
- 架构当前决定 44 规定 Phase 1 直接使用 `pi-ai`，`neuro-agent-harness` 独立演进后通过 Adapter 接入；当前决定 72 和 ADR-0002 规定 Agent 通过可选 Extension 映射到 `agent.invoke@1`，Core 不依赖 Harness。

因此，当前缺口是 Agent Invocation 合同和 Adapter 边界，不是重新建设 Workflow Runtime。

## 4. 方案

### 决策 1：Agent 作为普通 Workflow Action

以完整版本化 ref `agent.invoke@1` 注册 Agent Invocation。它使用现有 `ActionDefinition`、`ActionRegistry`、Activity Job、Run/Job lease、retry policy 和 completion 语义。Agent 不进入 `nb-workflow` Core，也不增加旁路执行器。

`agent.invoke@1` 的 v1 执行位置固定为 `trusted_worker`。原因是第一版只验证本地可信 Agent Adapter，且不应把模型调用伪装成 host 领域写入；未来远程执行位置仍通过已有 `executionPlacement` 合同另行裁定。

**备选**：在 API 或 Web 进程直接调用模型。拒绝：绕过持久 Runtime、Worker lease、取消和审计，违反现有 API manifest-only 与 Worker executable 边界。

### 决策 2：稳定合同与具体 Runtime 分离

新增 Agent Invocation Port，由 Action handler 依赖该 Port，而不直接导入模型 SDK。Port 的输入至少表达：

- provider 与 model 标识；
- 受控消息序列；
- 已注册工具描述；
- 单次调用预算；
- 可审计业务 metadata。

Port 的输出至少表达：

- `content` 或结构化结果；
- 工具调用请求及其参数引用；
- provider、model、finish reason；
- usage；
- 可审计的调用 metadata。

合同中的消息、工具、结果和 usage 必须是 JSON-safe 值。Secret、数据库对象、文件句柄、网络连接、进程对象和具体 SDK 类型不得进入 Action payload 或持久化 Workflow state。

**备选**：让 `pi-ai` 类型直接成为 Action 合同。拒绝：将模型供应商实现泄漏到公共合同，未来接入 Harness 或替换 provider 时需要改写 Workflow 和持久数据。

### 决策 3：Fake Adapter 先行

第一实现提供 Fake Adapter，作为确定性测试实现，不模拟模型智能性。它只返回预先配置的结构化结果或受控错误，用来证明 Runtime 与 Agent 合同的行为。

真实 `pi-ai` Adapter 另列后续切片。它应实现同一个 Port，不得让调用方分叉。

**备选**：合同与 `pi-ai` 同批实现。暂不采纳：模型依赖、凭证配置、真实网络失败和模型行为会与基础 Runtime 合同同时变化，难以区分问题来源。

### 决策 4：Cosmos 持有唯一 durable truth

Cosmos 持有：

- Workflow Run；
- Activity journal；
- Job、Attempt、Lease 和 fence；
- retry、cancel、completion 和领域状态。

Agent Adapter 只持有当前调用所需的模型客户端状态、请求上下文和可选的短期调用状态，不持有 Cosmos Job 的最终状态、租约或领域事实。未来 `neuro-agent-harness` 的 Session、Profile、Model Runtime 和 Agent 侧恢复必须通过 Adapter 映射到同一个 Cosmos Action 合同，不能形成第二个 Job 真相。

### 决策 5：第一版不接入长期记忆

`nb-memory` 保留为知识管理者共享长期记忆/知识库的后续 Adapter。第一切片不引入记忆读取、记忆写入或个性化配置生成，避免把 Agent Invocation、会话和长期记忆三个不同边界合并。

## 5. 运行与错误语义

- 输入无法通过 Action schema：`invalid_input`，不可重试。
- Adapter 未配置或依赖不可用：`dependency_unavailable`，是否重试由 Action retry policy 决定。
- 模型认证缺失：`authentication_required`，默认不可无限重试。
- 调用超时：`timeout`，由现有超时和 retry policy 处理。
- 调用被取消：沿用 Workflow Activity 的 cancelled completion 语义。
- 输出无法通过 Action schema：`malformed_payload`，不可重试。
- 预算耗尽：以明确、机器可读的错误结束，不产生伪造成功结果。
- Lease 丢失：中止协作式调用，不提交过期 Activity 结果；Job 按现有恢复语义保留可接管状态。
- Agent 不可用时：不影响既有 Ingest、Feed、搜索和离线阅读路径。

第一切片不定义降级为规则摘要的行为，也不创建任何 Artifact 版本。

## 6. 验收标准

1. `agent.invoke@1` 能通过现有 Action Registry 注册、解析、校验并生成 manifest descriptor。
2. 一条测试 Workflow 能通过现有 Activity Worker 执行 Fake Adapter，使用已有 Run、Job、Attempt、Lease、completion 和 retry 语义。
3. 测试覆盖成功、依赖不可用、认证缺失、超时、取消、超预算、malformed payload、Lease 丢失和重试边界。
4. Agent handler 只能通过已注入的 Invocation Port 工作；测试证明它不依赖 Prisma、SQLite、Data Root、Blob/Artifact Root、Secret 或宿主 API。
5. Action input/output 和 Fake Adapter 结果均经过 schema 校验，结果为 JSON-safe，并包含 provider/model/usage/finish reason 等审计所需信息。
6. Worker 重启、Job lease 接管或重复 completion 不产生第二份终态真相，也不提交过期 Attempt 的结果。
7. Agent Action 未注册或 Adapter 不可用时，既有 Ingest 与 Feed 测试保持通过。
8. 当前 `nb-workflow` Core、Cosmos domain 和现有 Ingest Action 不新增 `pi-ai`、Harness 或 `nb-memory` 依赖。

## 7. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：本切片不新增 Prisma 模型和 migration。Agent 调用结果只使用现有 Activity input/output、completion 和日志边界；长期 Artifact 数据留给后续切片。
- **接口**：新增版本化 `agent.invoke@1` Action input/output 合同和内部 Invocation Port；不新增产品 HTTP 端点，不改变既有 Product API。
- **安全**：Agent 只能在 trusted Worker 中执行；模型凭证不进入 Action payload、Workflow state、DomainEvent 或日志。工具能力只作为受控描述传入，实际工具执行不在本切片实现。
- **依赖**：Fake Adapter 不引入模型依赖；`pi-ai` 与 `neuro-agent-harness` 依赖分别由后续 Adapter 切片决定。
- **迁移**：无数据库迁移。
- **发布**：不修改版本号、不部署、不接入真实外部模型。
- **回滚**：移除 Agent Action 注册和 Adapter 即可回滚；既有 Workflow、数据库和 Ingest 数据不受影响。

## 8. 对 requirements / architecture / ADR / spec / Task 的预期改动

Proposal 接受后，预计需要：

- 在 [`docs/requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) 对 AGT-001/002/014 与 RUN-007 补充“第一切片为 Agent Invocation 基础接入”的实施注记，不改写原始需求或最终验收条件。
- 在 [`docs/architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) 同步 `agent.invoke@1`、Fake Adapter 先行和真实 Runtime Adapter 后置的当前实现边界；架构长期决定 44、72 保持不变。
- 新增 ADR，冻结 Invocation Port、Cosmos durable truth、Adapter 替换边界和第一版 trusted Worker placement；ADR 编号由维护者分配。
- 在 `docs/spec/contracts/`、`docs/spec/application/` 和必要的 `docs/spec/runtime/` 更新实现规格；不在 Proposal 接受前写入当前行为规格。
- 创建一个新的 Phase 3 Task，记录实现切片、验证证据和后续 `pi-ai` Adapter 的边界；Task 编号由维护者分配。

## 9. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-10-08 | 起草，状态 `reviewing`，等待 Proposal 评审 | Agent |
| 2026-10-08 | 批准进入 Proposal 起草；第一切片采用“`agent.invoke@1` 合同 + Fake Adapter 先行”，真实 `pi-ai` Adapter 后置 | 用户 |
| 2026-10-08 | 接受 Proposal；允许同步稳定文档并创建实现 Task；ADR 编号与 Task 编号待维护者分配 | 用户 |
