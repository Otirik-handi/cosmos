# ADR-0030：Agent Invocation 基础接入 v1

## Context

Cosmos Phase 3 需要 Agent 参与 Knowledge、Research、Artifact 和 Workspace，但当前仓库没有 Agent Action、模型依赖或 Agent Adapter。现有 Workflow Runtime 已经持有 Run、Activity、Job、Attempt、Lease、取消、重试、completion 和领域状态；Agent 若另建执行路径，会形成第二套恢复与任务终态。

总体架构已规定 Agent 是可选 Workflow Extension，在 Cosmos 中映射到版本化 `agent.invoke@1` Activity/Action/Job。Cosmos 持有 Workflow 与 Job 的 durable truth；具体 Agent Runtime 通过 Adapter 接入。`pi-ai`、`neuro-agent-harness` 和 `nb-memory` 的长期定位已经记录，但当前代码没有把其中任何一个接入 Agent Invocation。

本 ADR 冻结 Phase 3 第一切片的运行边界，不代表完整 Agent、Artifact 或 Workspace 已实现。

## Decision

### 1. Agent 使用普通 Workflow Action

第一版以完整版本化 ref `agent.invoke@1` 注册 Agent Invocation，沿用现有 `ActionDefinition`、`ActionRegistry`、Activity Job、Run/Job lease、retry policy、cancel 和 completion 合同。

`agent.invoke@1` 第一版执行位置固定为 `trusted_worker`。Agent 不进入 `nb-workflow` Core，也不增加旁路执行器。API 和 Web 不直接调用模型。

### 2. Invocation 合同与具体 Agent Runtime 分离

Agent Action 依赖 Cosmos 内部的 Invocation Port，不直接依赖具体模型 SDK、Harness 或记忆系统。Port 的输入和输出必须是 JSON-safe 的版本化合同：

- 输入表达 provider/model 标识、受控消息、已注册工具描述、单次调用预算和可审计 metadata；
- 输出表达内容或结构化结果、工具调用请求、provider/model、finish reason、usage 和可审计 metadata。

Secret、数据库对象、文件句柄、网络连接、进程对象和具体 SDK 类型不得进入 Action payload 或持久化 Workflow state。

### 3. Fake Adapter 先行

第一实现提供确定性的 Fake Adapter，用于验证 Action 和 Runtime 合同。它不模拟模型智能性，只返回预先配置的结构化结果或受控错误。

真实 `pi-ai` Adapter 是后续切片，必须实现同一个 Invocation Port。`neuro-agent-harness` 未来也必须通过同一 Port/Adapter 边界接入，不得让业务 Workflow 直接依赖它。

### 4. Cosmos 持有唯一 durable truth

Cosmos 持有 Workflow Run、Activity journal、Job、Attempt、Lease、fence、retry、cancel、completion 和领域状态。Agent Adapter 只持有当前调用所需的运行时上下文，不持有 Cosmos Job 的最终状态、租约或领域事实。

未来 Harness 的 Session、Profile、Model Runtime 和 Agent 侧恢复不能与 Cosmos 同时持有 Job durable truth。

### 5. 第一切片不接入长期记忆

`nb-memory` 作为知识管理者共享长期记忆/知识库的后续 Adapter。Agent Invocation 第一切片不引入记忆读取、记忆写入或个性化配置生成。

## Consequences

### Positive

- Agent 调用复用现有 Run、Job、Lease、取消、重试和恢复语义。
- 模型供应商、Harness 和长期记忆可以替换，不改变上层 Workflow 合同。
- Agent 不可用时，既有 Ingest、Feed、搜索和离线阅读路径不受影响。
- Fake Adapter 可以在没有真实模型、凭证和网络的环境中验证运行边界。
- 后续 Story Brief、Artifact、Knowledge Workflow 和 Research Workflow 有稳定的调用入口。

### Costs and risks

- 第一切片需要定义新的 Invocation input/output schema、Port 和 Adapter 注册方式。
- Fake Adapter 不能证明真实模型质量、真实 token 费用或真实 provider 行为。
- `pi-ai` 接入仍需单独处理 provider 配置、凭证、真实错误、usage 和 Node 生产兼容性。
- Harness Adapter 仍需验证 Session、等待、取消、usage 和恢复如何映射到 Cosmos Activity/Job 合同。
- Agent 工具执行、Artifact 持久化和安全页面隔离不在本 ADR 的实现范围内。

## Revisit Gate

仅在以下情况出现时重新评估本决定：

1. 现有 Action Registry 或 Workflow Host 无法表达 Agent 调用所需的取消、超时、预算、重试或恢复语义；
2. `agent.invoke@1` 无法同时承载 Fake Adapter、`pi-ai` Adapter 和 Harness Adapter 的共同合同；
3. `trusted_worker` 无法满足第一版 Agent Adapter 的数据与执行边界；
4. Harness 恢复模型无法在不取得 Cosmos Job durable truth 的前提下完成 Adapter 接入；
5. 真实工具调用证明当前 JSON-safe Invocation 合同无法表达受控输入、输出或 usage，而不是仅仅需要新增版本；
6. 需要引入长期记忆、Artifact 或 Workspace 时，新的需求证明 Invocation 与这些能力必须共享一份持久真相。

## Related

- Proposal：[`agent-invocation-v1`](../proposals/agent-invocation-v1.md)
- ADR：[`0001`](0001-durable-workflow-runtime.md)、[`0002`](0002-nb-workflow-kernel-cosmos-host.md)
- Architecture：[`0001-cosmos-foundation`](../architecture/0001-cosmos-foundation.md)
- Task：[`38-agent-invocation`](../../.agents/tasks/38-agent-invocation/README.md)
