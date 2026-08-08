# ADR-0001：Durable Workflow Runtime

> 状态：Accepted design contract
>
> 日期：2026-08-08
>
> 关联架构：[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md)
>
> 后续实施：[`../tasks/04-workflow-runtime/README.md`](../tasks/04-workflow-runtime/README.md)

## Context

Cosmos 不只是定时抓取 RSS。未来同一个系统还需要编排来源采集、Entry 知识处理、跨渠道研究、Workspace 更新、摘要投递和用户/Agent 交互。它们都需要顺序、分支、等待、子任务、预算、重试、取消、租约和进程重启后的恢复。

当前 Phase 1/1B 已有固定 Source Ingest/Probe Job，但尚未实现通用 Workflow Runtime。继续增加 Adapter、LLM 或研究能力前，必须先固定运行控制层的 durable truth，否则会把每个功能做成一套不可恢复的专用队列。

另外，`neuro-agent-harness` 和 `nb-workflow` 都可以提供 Agent/脚本执行语义参考，但它们不应同时成为 Cosmos 领域状态、Job 租约和外部事实的持久权威。

## Decision

### 1. 使用 Job + Workflow 组合

- `Workflow` 负责描述和执行流程：顺序、条件、循环、fan-out/fan-in、等待、子 Workflow、预算和收口。
- `Run` 是一次 Workflow 执行；`Step` 是 Run 内的逻辑阶段；`Job` 是 Worker 可领取的持久执行单元。
- `Job` 负责 lease、heartbeat、retry、恢复和终态；Workflow 不能绕过 Job 直接创建不可恢复的进程内任务。
- `DomainEvent` 记录已经发生的领域事实；它辅助审计、SSE 和触发，不替代状态表，也不要求完整 Event Sourcing。

### 2. 脚本式 Workflow 是最低层执行语义

脚本式 Workflow 是 Runtime 的底层形态，允许开发者使用 TypeScript 表达复杂控制流和 Action 组合。Graph、IR、Comfy 类表达是上层编排格式，必须转换为脚本式 Workflow 语义，不建立第二套执行引擎。

所有表达最终共享同一套 Run、Step、Job、lease、retry、cancel、journal、Event 和恢复合同。Graph/IR 不能直接执行任意网络、文件或进程操作。

### 3. 固定四类版本化合同

- `WorkflowDefinition`：可执行流程的版本化定义。
- `ActionDefinition`：可复用能力的版本化输入/输出、Capability、幂等、超时、取消和恢复合同。
- `TriggerBinding`：何时启动、绑定哪个来源/输入、使用哪个 Workflow 版本以及并发/计划策略。
- `WorkflowRun`：保存定义版本、输入快照、触发原因、预算快照、父子关系、状态和输出引用。

已创建 Run 不因后来修改 Source、Connection、Trigger 或 Workflow 配置而改变含义。

### 4. Cosmos 持有 Workflow 的 durable truth

Cosmos 持有并持久化：

- Workflow、Run、Step、Job；
- lease token、lease expiry、heartbeat、retry 和 priority/lane/budget；
- checkpoint、等待原因、父子关系和取消状态；
- DomainEvent、Outbox、事件消费游标和领域状态；
- Observation、Entry、Revision、Asset、Story 等领域事实。

所有外部访问必须通过注册的 `ActionDefinition`/Connector；所有领域写入必须通过 Application Command/Service。Workflow 脚本不能直接导入 Prisma、SQLite、Blob Root、任意 HTTP Client 或任意进程 API。

### 5. Harness 不持有 Cosmos Job 的 durable truth

`neuro-agent-harness` 只负责 Agent Invocation、Session、Model Runtime、Profile、Agent 工具和 Agent 侧恢复能力。Cosmos 负责 Job、Lease、Workflow、Outbox、领域事件和信息库事实。

Phase 1 继续直接使用 `pi-ai`。Harness 稳定后，通过 Adapter/Port 接入，不把 Harness 运行时或 `nb-memory` 的内部存储复制进 Cosmos。

### 6. Lease fencing 覆盖整个写入窗口

Worker 领取 Job 后取得 `lease_token`。所有受保护写入都必须验证当前 token，包括：

- Observation、Entry、EntryRevision、Asset 和 Story projection；
- FTS/索引更新；
- DomainEvent、Outbox 和 checkpoint；
- Job/Step/Run 的中间状态和 terminal close。

lease 失效后，旧 Worker 必须被拒绝继续写入或推进 checkpoint。事实写入和 checkpoint 收口必须处于可验证的原子边界内；新 Worker 接管后，旧 Worker 不能覆盖其结果。

### 7. 单用户阶段直接运行，不建设审批 UI

当前单用户阶段按最大产品权限运行，不建设审批 UI 或细粒度权限模型。Capability、预算、Service Endpoint 和 Run 记录仍保留，用于可靠执行、数据范围、外部副作用审计和未来多人/远端/不可信扩展隔离。

### 8. Adapter 只通过 Source Operation/Action 接入

Adapter manifest 必须声明：

- Provider、版本、Source Operation 和 Action；
- 配置、输入/输出和稳定 external key 规则；
- `originLocator`、`discoveryContext`、媒体状态和 checkpoint 能力；
- SecretRef、ConnectorStateStore 命名空间、Capability、预算、超时、取消和恢复语义。

Adapter 不自行持久化 Secret，不直接写核心数据库。一个 Connection 可以绑定多个独立采集计划；每个计划拥有自己的 Trigger、WorkflowBinding、checkpoint、预算、错误和重试边界。

### 9. KnowledgeSignal 与 ResearchRequest 分离

`KnowledgeSignal` 只表示对内容的判断，例如 `urgent`、`needs_research`、`source_conflict` 或 `high_importance`。它保存证据、producer、版本、置信度和关联 Run，但不直接执行任务。

`ResearchRequest` 表示一次研究行动，保存 signal、目标、范围、priority、idempotency key、父 Run/Step、Workflow 版本、状态、预算、时间和结果引用。Trigger 根据 ResearchRequest 启动 Research Workflow。

Research Workflow 可以查询 Cosmos 信息库并访问已配置渠道；外部新发现必须重新通过统一 Ingest Command 进入 Observation → Entry，不能未经入库直接写 Story。

### 10. 当前实现边界

本 ADR 是设计合同，不宣称以下能力已经完成：

- 通用 Workflow Runtime 和 `WorkflowContext`；
- Connection、SecretStore、ConnectorStateStore 和多个采集计划；
- Knowledge/Research Workflow、Outbox Consumer 和循环保护；
- 完整 lease fencing、checkpoint 原子收口和旧 Worker 中途写入拒绝；
- Harness/`nb-memory` Adapter。

当前实现仍以固定 Ingest/Probe Job 和 Phase 1 最小 Story projection 为主。

## Consequences

### Positive

- Ingest、Knowledge、Research、Maintenance、Delivery 和 Interaction 可以共用一套恢复、优先级和观测语义。
- Graph/IR/Comfy 可以迭代为用户体验，而不增加第二套执行器。
- 外部 Adapter、LLM 和 Harness 的替换不会改变 Cosmos 的事实、Job 和 Service 合同。
- Research 结果重新进入 Observation → Entry，来源事实、修订和 provenance 保持一致。

### Costs and risks

- 需要先实现较完整的 Runtime、持久 journal、lease fencing、Outbox 和测试矩阵。
- 脚本式 Workflow 的可恢复语义、动态 Action 调用和版本兼容需要严格约束。
- 当前单用户最大权限会把安全重点放在可信扩展、数据边界和可追溯性，而不是审批流程。

## Alternatives considered

### 每类功能各自实现专用 Job 队列

拒绝。短期简单，但会复制重试、租约、取消、恢复和事件语义，研究和知识处理很快会与 Ingest 分叉。

### 只使用 Graph/IR Runtime

拒绝。Graph 适合可视化和配置，但难以自然表达复杂脚本、动态循环和逐步恢复；它应转换到脚本语义，而不是成为第二个底层 Runtime。

### 让 Harness 持有全部任务状态

拒绝。Harness 的 Session/Model Runtime 生命周期与 Cosmos 的领域事实、外部副作用和 Job lease 不同；两边同时持有 durable truth 会产生分叉和恢复冲突。

### 直接复制 `nb-workflow` 或 `neuro-agent-harness`

拒绝。它们可以提供语义参考和 Adapter 目标，但 Cosmos 还需要自己的 Service Endpoint、领域 Command、Job/Lease、Outbox、Blob 和数据库边界。

## Revisit Gate

在以下条件满足前不引入第二套 Runtime：

1. Durable Workflow Runtime 已通过 Run/Step/Job、lease fencing、重启接管、旧 Worker 拒绝和 checkpoint 行为测试。
2. 至少一个固定 Ingest Workflow、一个 Knowledge Workflow 和一个 Research Workflow 共用同一 Runtime。
3. Graph/IR 转脚本转换可以保存定义版本和输入快照，并保持 Action/Capability 边界。
4. Outbox、Event Consumer 和 SSE 恢复不会产生重复或丢失的领域更新。
5. Harness Adapter 已证明不会重复持有 Cosmos Job 的 durable truth。

## Verification requirements

- contract/domain：版本化 Definition、Context、稳定 external key、KnowledgeSignal/ResearchRequest 和错误码。
- runtime：幂等、lease fencing、heartbeat、接管、旧 Worker 拒绝中途写入、checkpoint 收口、优先级和预算。
- integration：Connector/Source Operation、Connection/Secret/State、Ingest/Knowledge/Research 链路和结果重新入库。
- recovery：进程重启、Outbox 重投、Event cursor、SSE `Last-Event-ID` 和 `snapshot_required`。
- production：Bun 开发、Node 生产、Docker/Compose、共享 Data Root 和独立 Worker。
