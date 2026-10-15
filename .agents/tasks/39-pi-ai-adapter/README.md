# Task 39：单独实现真实 pi-ai Adapter

> 状态：保留 Adapter 与默认关闭的 Worker Connection/SecretStore 实现；离线验收与一次隔离根目录中的真实 Connection/SecretStore-backed Provider 验收均已通过。历史真实请求使用旧环境变量凭证路径，不能替代本次新鲜证据。
>
> 编号 39 由维护者分配；本 Task 承接 Task 38 的 follow-up。

## User Request / Topic

单独实现真实 `pi-ai` Adapter，让 Cosmos 的 `agent.invoke@1` 可以通过既有 Invocation Port 调用真实模型 SDK，同时保持 Workflow/Job/Attempt/Lease 的 durable truth 不变。

## Goal

提供一个独立的 `@cosmos/agent-pi-ai` package，实现真实 `@mariozechner/pi-ai` 调用、凭证解析、响应 usage/finish reason 映射与受管错误映射。Adapter 不进入 `@cosmos/application` 的 provider-neutral owner，不执行工具，不建立第二套 Agent Runtime。

## Scope / Non-goals

### Scope

- 独立 `@cosmos/agent-pi-ai` package 与 Node-compatible build。
- `PiAiAgentInvocationAdapter` 实现 `AgentInvocationPort`。
- 注入式 `PiAiCredentialResolver`；secret 不进入 Agent input/output 或 durable payload。
- `pi-ai` SDK facade，便于无网络行为测试和后续 SDK 版本替换。
- 一次性 `complete()` 调用、请求映射、usage/stop reason/tool call 映射。
- `authentication_required`、`rate_limited`、`dependency_unavailable`、`timeout`、`budget_exhausted`、`cancelled`、`malformed_payload` 映射。
- package typecheck/build 与 focused behavior tests。
- 当前实现规格、Task walkthrough 和验证记录。

### Non-goals

- 不改造 `SecretStorePort` 为 credential lease；不新增数据库/migration。
- Worker 默认不启用真实 Adapter；仅显式启用且配置完整时注册，不 fallback 到 Fake。
- 不实现工具执行、流式输出、多轮 Session、Harness、Memory、Artifact、Workspace、Knowledge 或 Research。
- 不新增 Product HTTP API、Web 配置页面或模型管理 UI。
- 不提交 API key，不修改版本号或部署；每次真实 Provider 请求都需新的单独明确授权，历史批准不延续到本轮。

## Authority / Contracts

- Task 38：[`.agents/tasks/38-agent-invocation/README.md`](../38-agent-invocation/README.md)
- ADR：[`docs/adr/0030-agent-invocation-v1.md`](../../../docs/adr/0030-agent-invocation-v1.md)
- Agent Invocation spec：[`docs/spec/application/0010-agent-invocation.md`](../../../docs/spec/application/0010-agent-invocation.md)
- Invocation Port：`packages/application/src/agent-invocation.ts`
- SecretStore contract：`packages/application/src/secret-store.ts`
- External SDK reference：[`@mariozechner/pi-ai` docs](https://pt-act-pi-mono.mintlify.app/packages/ai)

## Current State

- 生命周期阶段：实现保留，已完成隔离 Connection/SecretStore→Worker Action→Adapter→fake SDK 的离线验收，以及一次单独批准的真实 Provider 验收。
- 已确认凭证边界：Adapter 注入最小 `PiAiCredentialResolver`，不接收原始 SecretStore 对象，不把凭证放进 `AgentInvocationInput`。
- 已确认调用边界：`complete()` 一次调用；工具只映射为 SDK tool 描述，不执行工具。
- 受影响合同：新增独立 package API；既有 `AgentInvocationPort`、`agent.invoke@1` 和 Workflow Host durable truth 不变。
- 无新增持久化、HTTP endpoint、Prisma migration 或第二 runtime。
- Worker 配置由 `apps/worker/src/config.ts` 解析；只在 `COSMOS_AGENT_ENABLED=true` 且 provider/model/API/baseURL/context/output limits/Connection ID 完整时加入 `agent.invoke@1`，默认关闭。
- 每次调用从配置 Connection 重新读取 active 状态与 SecretRef，再从 SecretStore 读取凭证并只在 callback 内传给 pi-ai；不使用环境变量或 Fake fallback。模型与 provider profile 按用户配置构造；部署者负责确认 Connection 凭证适用于所选 Provider。

## Implementation Slices

1. **SDK owner and port adapter**：新增 package、依赖、SDK facade、credential resolver、真实 response/error mapping。
2. **Behavior verification**：覆盖请求映射、secret 不进入结果、usage/finish/tool call、credential 缺失、认证/限流/依赖、timeout/cancel、malformed response。
3. **Spec and closeout**：同步当前实现规格、Task 证据与未运行项；执行 package build/typecheck 与 focused tests。

## Decisions and Deviations

- 采用独立 package 作为 `pi-ai` SDK 唯一 owner，避免 `@cosmos/application` 依赖具体 provider SDK。
- 采用注入式 `PiAiCredentialResolver` callback；不扩大 SecretStore 公共接口，不把短时 callback 称为强 lease。
- 真实 Adapter 不作为默认 fallback；未显式配置时不注册。
- pi-ai 的 assistant 历史消息由转换层包装为 SDK 所需完整消息；Cosmos 公共合同保持 provider-neutral。
- 已接受 Proposal [`Agent Provider Connection Credential v1`](../../../docs/proposals/agent-provider-connection-credential-v1.md) 后，Worker 通过单 profile 显式绑定 Provider 与 Connection ID；不把 `connectorId` 当模型 Provider，不从 secret 解析绑定关系。每次调用读取 active Connection 和 SecretRef，再读取 SecretStore；无效/取消时 fail closed。

## Verification

- 本轮命令、隔离路径、结果及未运行项统一记录于 [walkthrough](walkthrough.md)「重启：只读基线与已批准离线切片」及「最终隔离真实 Provider 验收」。
- 历史 `READY` 请求是旧环境变量凭证链路的记录；不能作为本次新鲜 Connection/SecretStore-backed 真实 Provider 验收证据。

## Final isolated real Provider evidence

- Prepared root: `.agent/tmp/task39-real-QmVMec`; the root and its whitelist-only evidence files remain retained.
- The single separately approved real request used `jijiapi` / `gpt-6-luna`, one user message `Reply with exactly: OK`, one transport send, and a five-minute model budget with a 305-second CLI signal budget.
- `result.json` records `status=completed`, `responseStatus=200`, `responseReturned=true`, `outputMatchesExpected=true`, `secretReads=1`, `credentialAbsentFromOutput=true`, and `providerBodyRecorded=false`.
- `diagnostic.json` records no first failure, one transport send, HTTP 200, `secretDelete=completed`, and `disconnect=completed`.
- This evidence covers one retained isolated root. It does not cover UI credential entry, other Providers, OAuth, streaming, tools, long-running Worker/Workflow scheduling, or production deployment.

## Provider/model 产品配置扩展

用户已整体接受 [Provider/model 配置与 Connection 选择提案](../../../docs/proposals/connection-credential-entry-v1.md)。本 Task 复用相同 Adapter/Worker 凭证链路承接新产品配置，不新建任务编号；原 Scope/Non-goals 描述 Adapter 历史切片，不是对本次扩展的隐式否决。

新范围为 Provider/model 管理、Provider-owned SecretStore 凭证、模型型 Connection 单选及对应 Worker 消费；当前仅进入技术合同/实施计划阶段，尚未开始业务实现。公共接口、schema 写入边界及旧配置退出按[过程续篇](walkthrough-provider-model.md)逐切片冻结。迁移执行、现有数据/凭证处置和每次真实请求仍需单独授权；Task 40、默认数据库、备份和 Git lifecycle 不在范围内。

## Follow-ups

- 本地 SecretStore 是受限权限明文文件，不提供加密、强 lease 或安全擦除；生产部署需按 ADR-0017 保护 Data Root 并评估部署环境风险。
- 真实请求前另报准确命令、Provider/model、发送文本、token 上限、隔离绝对路径、费用/数据副作用、日志检查和清理方法，并等待该次明确确认。当前 runner 支持默认 offline、无凭证 `prepare-real` 与真实终端 `real <prepared-root>`；real 需单独授权、终端确认和无回显输入，重定向输入拒绝执行。
- 验收 real 模式仅在 SDK 调用期间接管进程 fetch 与 OPENAI_LOG：限定 jijiapi chat/completions POST、最多一次传输发送、redirect=error、SDK 日志 off，结束后恢复；限 standalone CLI，不作为生产 adapter 行为。候选计划已增加这些字段，旧计划不匹配时拒绝执行。
- real 请求调用预算为 300000ms（5分钟），CLI 信号预算为 305000ms；real 尝试在 finally 输出并写入 `diagnostic.json`：仅固定阶段、首次失败类别（包括受管 Action 错误码）、底层 transport 调用次数、是否返回及 HTTP 状态码、SecretRef 删除/断开状态；不包含异常原文、堆栈或响应正文。transportSends 表示调用底层 fetch 的次数，不证明服务商收到请求；没有结果文件也不能证明未发送。清理失败单独记录，不覆盖首次失败。强制终止仍可能没有诊断文件。
- 不同 Provider、OAuth、流式结果、工具执行、常驻 Worker/Workflow 调度与生产部署仍未验证。
