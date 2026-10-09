# Agent Invocation Action

## 状态

当前实现规格；描述 `agent.invoke@1` 与 Fake Adapter 的已实现行为。真实模型 Adapter 尚未实现。

## 最后更新

2026-10-08。

## 组件定位

`packages/application/src/agent-invocation.ts` 提供 Agent Invocation 的应用层端口、确定性 Fake Adapter 和版本化 Action 定义。它位于现有 Action Registry 与未来具体 Agent Runtime 之间：Action Registry 负责注册、输入输出校验和错误归类；本组件负责把一次 Agent 调用映射为 provider-neutral 的 Port 调用；Workflow Host 负责 Job、Lease、Attempt、取消、重试和 completion。

本组件不拥有 Workflow Job durable truth，不访问 Prisma、SQLite、Data Root、Blob/Artifact Root 或 Secret，也不执行工具调用。真实 `pi-ai`、`neuro-agent-harness` 和 `nb-memory` Adapter 不属于当前实现。

## 概念与定义

- **Agent Invocation Port（`AgentInvocationPort`）**：一次 Agent 调用的最小应用层接口，接收已解析的 `AgentInvocationInput` 和带 idempotency key/AbortSignal 的上下文，返回 `AgentInvocationOutput`。
- **Fake Agent Invocation Adapter（`FakeAgentInvocationAdapter`）**：确定性测试实现，可返回预配置成功结果或受控 Action 错误；不调用网络、模型或持久层。
- **Agent Action（`agent.invoke@1`）**：`kind` 为 `agent`、执行位置为 `trusted_worker`、能力为 `agent:invoke` 的普通 Action。

## 外部行为

1. 调用方通过 `ActionRegistry` 解析完整 ref `agent.invoke@1`。
2. Registry 校验公开执行上下文和 Action 输入。
3. Action handler 通过注入的 `AgentInvocationPort` 调用 Adapter。
4. 返回值再次经过 Agent output schema 校验和 Action output schema 校验。
5. Handler 抛出的受管 Action 错误保留其 code/message/retryable；未受管错误由 Registry 统一归类。
6. Activity Worker 接管 Job/Run lease、取消、重试和 completion；本组件不自行提交 Job 结果。

## 输入

`AgentInvocationInput` 是 strict JSON-safe 对象：

- `provider`、`model`：非空字符串；
- `messages`：至少一条消息，每条有 `role`（`system`/`user`/`assistant`/`tool`）和字符串 `content`，可选非空 `name`；
- `tools`：工具描述数组，默认空数组；每项有非空 `name`、`description` 和 JSON-safe `inputSchema`；
- `budget`：正整数 `maxDurationMs`、非负整数 `maxToolCalls`、正整数 `maxOutputTokens`；
- `metadata`：JSON-safe record，默认空对象。

Agent Action 的执行定义：`idempotent=false`、支持取消、无 Action 自带 timeout、最多 2 次尝试、退避 1000ms，并允许 `dependency_unavailable`、`timeout` 和 `rate_limited` 重试。实际 Activity Worker 仍按其已有 manifest policy 和 Job 状态机执行。

## 输出

`AgentInvocationOutput` 是 strict JSON-safe 对象：

- `content`：字符串；
- `toolCalls`：工具调用数组，每项包含非空 `name` 和 JSON-safe `arguments`；
- `usage`：非负整数 `inputTokens`、`outputTokens`、`totalTokens`；
- `provider`、`model`：非空字符串；
- `finishReason`：`stop`、`tool_call`、`length` 或 `cancelled`；
- `metadata`：JSON-safe record，默认空对象。

当前 Fake Adapter 只返回预配置 output；它不会自动生成工具调用或内容。

## 状态与持久化

本组件无持久状态。Port、Fake Adapter 和 Action definition 是进程内对象；进程重启后由 Worker 组合根重新注册。Run、Activity、Job、Attempt、Lease、completion 和恢复状态由 Workflow Host/TaskStore 持有，不由本组件复制。

## 状态转换

本组件自身没有持久状态转换。对外可观察的 Action/Job 状态由 Workflow Host 的既有状态机定义：成功进入 completion；可重试错误进入 `retry_wait`；不可重试错误进入 terminal failure；取消进入 cancelled completion；Lease 丢失时旧 owner 不得提交 Activity completion。

## 副作用

- Fake Adapter：无网络、文件、数据库、Blob、Secret 或进程副作用；只读取构造时的预配置响应。
- Agent Action：调用注入的 Port；不直接执行工具，不直接写领域状态。
- 日志、Job 状态、Lease、completion 和重试副作用由 Action Registry/Workflow Host 所有。

## 错误与降级

- 输入或输出 schema 失败：`invalid_input` 或 `malformed_payload`，不可重试；
- Fake Adapter 可返回 `dependency_unavailable`、`authentication_required`、`budget_exhausted` 或 `timeout`；
- 取消使用 `cancelled`，并显式标记不可重试；
- 无受控降级结果，不生成规则摘要或伪造成功输出；
- Agent Action 未注册或 Adapter 不可用不影响既有 Ingest、Feed、搜索和离线阅读路径。

Action Registry 的通用错误包装、Activity Worker 的重试 allow-list、Lease fencing 和 late result 处理分别由其 canonical spec 负责。

## 依赖

- [`Action Registry`](0003-action-registry.md)：注册、解析、输入输出校验和错误包装；
- [`Workflow Host Runtime`](0008-workflow-host-runtime.md)：Activity Job、Run/Job lease、取消、重试、completion 和恢复；
- [`@cosmos/contracts` 公共合同](../contracts/0001-public-contracts.md)：Agent input/output schema、Action ref 和错误码；
- `AgentInvocationPort` 的调用方负责注入 Adapter；真实模型 SDK 不由本组件直接依赖。

## 配置

Fake Adapter 没有环境变量或外部配置。`agent.invoke@1` 的执行位置和 retry policy 来自进程内 Action definition；manifest catalog 只提供可序列化声明，不包含 executable handler。

## 重建验收

1. 注册 `createAgentInvocationAction(new FakeAgentInvocationAdapter(success))` 后，`ActionRegistry.dispatch("agent.invoke@1", input, context)` 返回通过 schema 的 Agent output。
2. Fake Adapter 返回受管 dependency error 时，Registry 保留 error code、message 和 retryable，不产生 fallback output。
3. 已取消的 AbortSignal 进入 Fake Adapter 时，Action 结果使用 `cancelled` 且不可重试。
4. 将 Agent Action 放入 Activity Worker 后，成功结果进入 completion；retryable dependency error 进入既有 `retry_wait`；Worker 不需要新的 Job 或 Lease owner。
5. 输入、输出和 tool arguments 含 Date、Uint8Array、函数或其它非 JSON-safe 值时被拒绝。
6. catalog 可读取 `agent.invoke@1` 的 manifest descriptor，但 descriptor 不包含 executable handler 或 Zod schema 对象。

## 实现与测试锚点

- 实现：`packages/application/src/agent-invocation.ts`、`packages/contracts/src/agent.ts`、`packages/application/src/catalog.ts`；
- contracts 行为测试：`packages/contracts/src/agent.test.ts`、`packages/contracts/src/action.test.ts`；
- application 行为测试：`packages/application/src/agent-invocation.test.ts`；
- Activity Worker 行为测试：`packages/application/src/workflow-host-runtime.test.ts`。
