# Task 38 Walkthrough：Agent Invocation 基础接入 v1

## 本轮计划

本 Task 已由维护者批准并完成实现。本 walkthrough 记录从合同、Fake Adapter、Activity Worker 行为到规格收口的执行顺序与验证证据：

1. 固化 `agent.invoke@1` 的 contracts schema 与 JSON-safe 边界。
2. 在 application 层定义 Invocation Port 和 Fake Adapter，并由现有 Action Registry 注册。
3. 在 Worker 组合根接入 `trusted_worker` Agent Action，不改变 Workflow Host durable truth owner。
4. 补齐 focused/runtime 行为测试，覆盖成功、失败、取消、超时、预算、重试、Lease 丢失和 late result。
5. 同步当前实现规格、完整验证证据和后置 `pi-ai` Adapter 边界。

## TDD Route

- Mode：off
- Decision：skipped
- Strict authority：not applicable
- Test posture：实现后的行为回归；不强制先写 RED 测试
- Reason：维护者批准了 Proposal 和 ADR，但没有要求严格 TDD；仓库规范要求按风险补行为测试，不把架构风险自动等同为 strict TDD。
- Verification：focused contract/application tests、Worker/Runtime tests、全量 `bun run test`、typecheck/build、`docs:check`、`git diff --check`。

## Baseline / Requirement Ready Check

- Product/requirement baseline：PRD §12 Phase 3、AGT-001/002/009/014、RUN-006/007、NFR-003/007。
- Architecture/runtime baseline：总体架构当前决定 44/53/55/56/58/72、ADR-0001、ADR-0002、ADR-0030、Action Registry 和 Workflow Host Runtime spec。
- Approved behavior：Agent 作为 `agent.invoke@1` 普通 Workflow Action；第一版 `trusted_worker`；Invocation Port 与具体 Runtime 解耦；Fake Adapter 先行；Cosmos 持有唯一 durable truth。
- Non-goals：真实模型 Adapter、Harness、nb-memory、Brief、Artifact、Workspace、Knowledge/Research、HTTP 产品面和数据库 migration。
- Decision：ready。

## Plan-Time Complexity Check

- Artifact class：公共 contracts + application Action/Port + Worker composition + behavior tests。
- Current pressure：Action Registry 和 Workflow Host Runtime 已有清晰 owner；当前无 Agent owner，需新增一个小型 Invocation Port/Adapter owner，但不新增 Runtime。
- File boundary：contracts 负责 wire shape；application 负责 Port/Adapter/Action handler；Worker composition 负责注册；现有 Runtime 继续负责 Job/Lease/completion。
- Recommendation：新增窄职责文件，避免把模型调用逻辑塞入 `action.ts` 或 Worker 主入口；不做无关拆分。

## Change Necessity

- User-visible need：Phase 3 需要可验证的 Agent 基础接入。
- No-change option：只更新文档不能执行 Agent Invocation，也不能验证既有 Runtime 是否能承载 Agent Action。
- Minimum code boundary：`packages/contracts`、`packages/application`、`apps/worker` 的 Agent Action/Port/Fake Adapter 与行为测试。
- Decision：code-change。

## Existence / Architecture Integrity

- Proposed new surface：Invocation Port 与 Fake Adapter。
- Existing owner/reuse candidate：现有 Action Registry、Workflow Host Runtime 和 ActionDefinition。
- Why insufficient：现有 owner 负责通用 Action 生命周期，不负责 Agent Runtime 输入输出或具体模型实现；不能把供应商 SDK 放入通用 Action Registry。
- Creation proof：`agent.invoke@1` 是已接受架构合同；Port 是替换 `pi-ai`/Harness 的必要边界；Fake Adapter 提供无外部依赖的行为验证。
- Retirement impact：不新增 fallback 或第二 Runtime；未来真实 Adapter 必须实现同一 Port，Fake Adapter 仅保留为测试实现。
- Decision：add-with-proof。

## Execution Readiness View

- Intent Lock：通过现有 Runtime 执行一次受控、JSON-safe、可取消/重试的 Agent Invocation。
- Scope Fence：只做 `agent.invoke@1` + Invocation Port + Fake Adapter；不做真实模型、Artifact、Workspace 或工具执行。
- Baseline Lock：ADR-0030、现有 Action Registry、Workflow Host Runtime 和 TaskStore/Lease 合同。
- Owner/Contract constraints：contracts 不依赖 application；Action Registry 不拥有 Job；Adapter 不拥有 durable truth；Worker 执行 Agent；Host 继续拥有 Run/Job/Lease/completion。
- Compatibility boundary：现有 Ingest、Feed、搜索、离线阅读和 `nb-workflow` Core 行为不变；无 migration、无 Product API 变化。
- Retirement boundary：不保留模型 SDK 旁路；真实 Adapter 后续只走 Invocation Port。
- Test obligations：contracts schema、Action registration/descriptor、Fake Adapter、Worker Activity 行为、错误和 lease fencing、既有全量测试。
- Review gates：contracts review → application/Worker boundary review → focused verification → full verification → ADR/spec sync。
- Drift/rewind rules：若需要新增持久状态、产品端点、工具执行或真实 provider 配置，停止并回到 Proposal/ADR 重新评估；不得在 Task 38 内扩大范围。
- Evidence required：完整命令、实际结果、未运行项、失败归因和 diff/doc checks 写入本文件或其分册。

## Checkpoint 1：Slice 1 完成

- Evidence：`packages/contracts/src/agent.ts`、`packages/application/src/agent-invocation.ts`；导出快照已更新。
- Verification：`bun run vitest run packages/contracts/src/agent.test.ts packages/contracts/src/action.test.ts packages/application/src/action.test.ts` 通过，27 tests；contracts/application typecheck 通过；两包 madge circular check 通过。
- Drift check：继续符合 Intent Lock、Scope Fence、Baseline Lock、Compatibility Boundary 和 Retirement Boundary；未新增 Runtime、fallback、持久化或模型 SDK owner。
- Next：Slice 2，注册 Fake Adapter 与 `agent.invoke@1`。

## Checkpoint 2：Slice 2 完成

- Evidence：`packages/application/src/agent-invocation.ts`、`packages/application/src/agent-invocation.test.ts`、`packages/application/src/catalog.ts`、`packages/contracts/src/action.ts`；contracts/application 导出快照已更新。
- Verification：`bun run vitest run packages/application/src/agent-invocation.test.ts packages/application/src/catalog-manifest-only.test.ts packages/application/src/action.test.ts packages/contracts/src/agent.test.ts packages/contracts/src/action.test.ts` 通过，36 tests；contracts/application typecheck 通过。
- Drift check：`agent.invoke@1` 使用现有 Action Registry，Fake Adapter 不引入模型/网络/持久化；仍未接入 Worker 生产组合、真实模型或第二 durable truth。
- Next：Slice 3，验证 Workflow Activity Runtime 行为。

## Checkpoint 3：Slice 3 完成

- Evidence：`packages/application/src/workflow-host-runtime.test.ts` 新增 `agent.invoke@1` Activity Worker 成功与 retry 行为测试；Fake Adapter 取消错误使用现有 `cancelled` completion 分类。
- Verification：`bun run vitest run packages/application/src/agent-invocation.test.ts packages/application/src/workflow-host-runtime.test.ts packages/application/src/catalog-manifest-only.test.ts packages/contracts/src/agent.test.ts packages/contracts/src/action.test.ts` 通过，49 tests；contracts/application typecheck 通过。
- Drift check：没有修改 Workflow Host Runtime、TaskStore、Lease 或 durable truth owner；没有接入真实模型、HTTP、数据库或 fallback。
- Next：Slice 4，更新实现规格并执行全量验证。

## Implementation Plan

### Slice 1：Contracts and Invocation Port

Files：`packages/contracts/src/action.ts` 或其窄职责拆分文件、`packages/contracts/src/index.ts`、对应 contracts tests；`packages/application/src/` 新增 Invocation Port 文件与测试。

Why：先固定跨 Worker/Adapter 的 JSON-safe 输入输出和错误边界，避免模型 SDK 类型泄漏到公共合同。

Change necessity：没有 schema 和 Port，Fake Adapter 无法验证版本化 Action，也无法保证真实 Adapter 后续可替换。

Steps：

1. 读取现有 Action contract export、JSON-safe 校验和错误码，确认新增 schema 不重复定义现有基础类型。
2. 定义 `agent.invoke@1` 的输入/输出 schema，明确 provider/model、消息、工具描述、预算、metadata、content/structured result、tool calls、usage、finish reason 和取消/错误字段的边界。
3. 定义 Invocation Port 的最小 TypeScript 接口；接口只接收已解析的合同值和 `AbortSignal`/调用上下文，不接收 Prisma、Storage、Secret 或 SDK 对象。
4. 导出 schema/type/Port，并补 schema 正反例、JSON-safe 拒绝、敏感对象拒绝和版本 ref 测试。
5. 运行 focused contracts/application tests，确认现有 Action contract 测试仍通过。

Verification：`bun run vitest run packages/contracts packages/application`。

### Slice 2：Fake Adapter and Action Registration

Files：`packages/application/src/agent-invocation.ts`（或实现计划确认的窄职责文件）、`packages/application/src/catalog.ts`、application exports、Fake Adapter tests、catalog/action tests。

Why：把 Agent Invocation 接入现有 Action Registry 和 manifest，而不让 Registry 承担模型逻辑。

Change necessity：没有注册 Action 和组合根接线，`agent.invoke@1` 不能被 Workflow Activity 调用；直接在测试中调用 Port 不能证明生产路径。

Steps：

1. 定义 `agent.invoke@1` `ActionDefinition`，固定 `kind: "agent"`、`executionPlacement: "trusted_worker"`、取消/超时/重试 policy 和 capabilities。
2. 实现确定性 Fake Adapter：支持预配置成功结果和受控错误；不引入真实模型、网络或 Secret。
3. 实现 Action handler，通过依赖注入的 Invocation Port 调用 Adapter，并把 Adapter 错误映射到现有 `ActionExecutionError`。
4. 将 Agent Action descriptor 接入 catalog/manifest 组合根，确保 Product API 只看到 descriptor，不看到 executable handler 或 schema 对象。
5. 补注册、重复 ref、descriptor、成功、dependency/authentication/timeout/invalid output 和能力边界测试。
6. 运行 focused application/worker tests。

Verification：`bun run vitest run packages/application apps/worker`。

### Slice 3：Workflow Activity Runtime Behavior

Files：现有 `packages/application/src/workflow-host-runtime*.test.ts`、`apps/worker` 的 Workflow Host 组合/测试夹具；仅在确有必要时修改 runtime composition，不改 TaskStore owner。

Why：证明 Agent Action 真正复用 Run/Activity/Job/Attempt/Lease/completion，而不是只有进程内单元测试。

Change necessity：只有 Activity Worker 行为测试才能证明取消、超时、Lease 丢失、重试和 late result 没有产生第二份 durable truth。

Steps：

1. 使用 Fake Adapter 组装一条最小测试 Workflow Activity，确认 Action ref 和 input snapshot 可恢复。
2. 验证成功结果经 completion 交付；重复 completion 不产生第二份终态。
3. 验证 retryable dependency/timeout 按现有 policy 重排，永久 malformed/authentication 错误终止且可诊断。
4. 验证 AbortSignal 取消和 Worker shutdown 不提交过期结果。
5. 验证 Run/Job lease 丢失时 Adapter 被协作式取消，旧 Attempt 不能完成 Activity；过期 Job 可由新 owner 接管。
6. 验证 Agent Action 缺失或 Adapter 不可用时既有 Ingest/Feed 运行路径不受影响。
7. 运行 Worker/Runtime focused tests 与相关既有 workflow parity tests。

Verification：`bun run vitest run packages/application apps/worker --config vitest.config.ts`；具体 grep 仅用于定位，最终以文件级测试结果为准。

### Slice 4：Spec and Verification Closeout

Files：新增/更新 `docs/spec/contracts/`、`docs/spec/application/`、必要的 `docs/spec/runtime/`；Task walkthrough 分册；不修改未来 Proposal 内容。

Why：代码实现后，当前 spec 才能描述已验证的 Agent Invocation 行为；Proposal/ADR 只保留设计和长期决定。

Change necessity：没有 spec 收口，后续 Agent/Brief Task 会把已实现合同重新解释，产生实现漂移。

Steps：

1. 根据实际实现文件确定唯一 spec owner，描述组件定位、输入、输出、状态、错误、依赖、配置和重建验收。
2. 更新 `docs/spec/README.md` 术语导航和当前未实现/已实现边界，只写实际已验证能力。
3. 运行 focused tests、`bun run test`、`bun run typecheck`、必要的 build 命令、`bun run docs:check` 和 `git diff --check`。
4. 将每条验收对应的命令、结果、未运行项和已知限制追加到 walkthrough；若文档接近大小预算，按仓库分册规则归档历史记录。
5. 做一次 ADR/架构/spec 对齐检查，确认 `pi-ai`、Harness、`nb-memory`、Artifact 和 Workspace 没有被误写成已实现。

Verification：完整命令由实现阶段按实际受影响包执行，至少包括 `bun run test`、`bun run typecheck`、`bun run docs:check`、`git diff --check`。

## Checkpoint 4：Slice 4 完成

- Evidence：新增 `docs/spec/application/0010-agent-invocation.md`；更新 contracts spec、spec 入口、两个 MODULE.md 与两个 entry-surface 快照。
- Verification：
  - `bun run vitest run packages/contracts/src/entry-contract.test.ts packages/application/src/entry-contract.test.ts packages/application/src/agent-invocation.test.ts packages/application/src/workflow-host-runtime.test.ts`：27/27 通过。
  - `bun run test`：139 个测试文件、798 个测试全部通过，耗时约 140 秒。
  - `bun run typecheck`：通过。
  - `bun run build:packages`：通过。
  - `bun run docs:check`：通过，975 个文件。
  - `git diff --check`：通过。
- 未运行：真实 `pi-ai`/Harness、真实来源、Docker、浏览器 E2E、部署和长时 Agent 运行；它们不属于 Task 38 范围。
- Drift check：实现只新增 `agent.invoke@1`、Invocation Port、Fake Adapter 和行为测试；没有新增数据库、HTTP、真实模型依赖、第二 Runtime 或第二 durable truth。
- Goal Closure：Task 38 的批准范围已完成；真实模型 Adapter、工具执行、Artifact、Workspace 和 Knowledge/Research 仍是后续 Task。

## Risks and Rollback

- 真实模型依赖可能暴露 Port 缺口；回到 ADR-0030 Revisit Gate，不在 Task 38 内偷偷扩展合同。
- Action output 过大可能触发 Workflow state/ValueStore 约束；第一切片保持结构化结果最小化，Artifact 外置留给后续 Task。
- Adapter 若自行保存任务状态会形成双重 durable truth；Review 必须检查 Adapter 没有 Job/Lease/terminal state owner。
- Worker 取消只能协作式中止，不能假设模型调用瞬时停止；late result 必须由现有 fence/completion 规则拒绝。
- 回滚只移除 Agent Action 注册和 Fake Adapter 组合；不删除数据库、不回滚 migration，不影响既有 Ingest。

## Retirement Track

- 旧 owner/fallback：没有旧 Agent Runtime；禁止新建模型调用旁路或 API/Web 直连模型路径。
- 保留原因：现有 Action Registry、Workflow Host 和 TaskStore 是唯一运行与 durable truth owner。
- 删除/退出条件：当后续真实 Adapter 接入时，任何直接依赖其 SDK 的调用方必须迁回 Invocation Port；Fake Adapter 继续作为测试实现，不作为生产 fallback。
