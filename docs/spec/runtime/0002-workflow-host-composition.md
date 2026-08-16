## 状态

Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55

## 最后更新

2026-08-16

## 组件定位

`apps/worker/src/workflow-host.ts` 中的 `createWorkflowHost` 是 Worker 进程内 durable workflow host 的组合根。

它负责：

- 校验可执行 Workflow definition 与 Action catalog 均非空。
- 构造 workflow 持久化、事件、值存储及 registry 依赖。
- 从已注册 Action descriptor 中提取显式 retry policy。
- 使用同一组 lane 依赖构造 run、activity 与 completion 三类执行组件。
- 返回供 Worker runtime 启动和协调的完整 host 对象。

相关契约与运行时边界见：

- [Workflow Host Contract](../application/0007-workflow-host-contract.md)
- [Action Registry](../application/0003-action-registry.md)
- [Worker Process](0001-worker-process.md)

## 概念与定义

- **组合根**：集中实例化对象并连接依赖的入口；不实现 workflow 业务语义，也不拥有 durable 状态。
- **Definition catalog**：调用方提供的 `readonly AnyWorkflowDefinition[]`，由 `MemoryDefinitionRegistry` 包装。
- **Action catalog**：调用方提供的 `readonly RegisteredAction[]`，由 `ActionRegistry` 包装。
- **Action retry policy**：仅从 `ActionRegistry.descriptors()` 返回的 descriptor 中读取；按 `descriptor.ref` 映射到非 `null` 的 `descriptor.retryPolicy`。
- **Lane options**：run lane、activity worker 与 completion dispatcher 共享的基础依赖和运行参数集合。
- **共享实例**：输出中的 backend、store、value store、event sink 和 registry 与各 lane 所接收的实例具有对象同一性，而不是独立重建的等价对象。

本文不复制 `WorkflowHostStore`、Action 或 Lease 的 canonical 定义；其语义以链接的规范为准。

## 外部行为

调用 `createWorkflowHost(options)` 时：

1. 若 `options.definitions.length === 0` 或 `options.actions.length === 0`，立即拒绝启动并抛出固定错误。
2. 非空 catalog 校验在 durable host 依赖构造之前完成。
3. 正常路径使用调用方提供的 Prisma client、blob store、definitions、actions 和可选运行参数组装 host。
4. 返回的 host 可供 application runtime 分别启动或调用 run lane、activity worker 与 completion dispatcher。
5. 组合根不执行 workflow、不注册隐式 Action，也不生成默认 definition。

固定错误文本为：

```text
COSMOS_WORKFLOW_HOST_ENABLED is reserved until this Worker registers its executable Workflow definitions and Actions; refusing to start an empty durable host.
```

## 输入

`WorkflowHostCompositionOptions` 的必需字段：

| 字段 | 类型 | 用途 |
|---|---|---|
| `prisma` | `PrismaClient` | 构造 Prisma workflow backend、event sink 和 host store |
| `blobs` | `FileBlobStore` | 构造 workflow value store |
| `definitions` | `readonly AnyWorkflowDefinition[]` | 构造内存 definition registry |
| `actions` | `readonly RegisteredAction[]` | 构造 Action registry |

可选字段：

| 字段 | 用途 |
|---|---|
| `owner` | 传递给共享 lane options |
| `workerId` | 传递给共享 lane options |
| `leaseMs` | 传递给共享 lane options |
| `runLeaseMs` | 传递给共享 lane options |
| `heartbeatMs` | 传递给共享 lane options |
| `heartbeatIntervalMs` | 传递给共享 lane options |
| `logger` | 传递给共享 lane options |
| `now` | 传递给共享 lane options |

这些可选字段的默认值由 application runtime 或接收它们的各依赖解释；本组件不定义、补全或推测默认值。

## 输出

`createWorkflowHost` 返回包含以下字段的对象：

| 字段 | 构造来源 |
|---|---|
| `backend` | `new PrismaWorkflowBackend(options.prisma)` |
| `store` | 使用共享 backend、event sink、value store 和 Action retry policy 构造的 `PrismaWorkflowHostStore` |
| `values` | `new BlobWorkflowValueStore(options.blobs)` |
| `events` | `new PrismaWorkflowEventSink(options.prisma)` |
| `definitions` | `new MemoryDefinitionRegistry(options.definitions)` |
| `actions` | `new ActionRegistry(options.actions)` |
| `runLane` | `new WorkflowRunLane(laneOptions)` |
| `activityWorker` | `new WorkflowActivityWorker({ ...laneOptions, actions })` |
| `completionDispatcher` | `new WorkflowCompletionDispatcher(laneOptions)` |

输出及内部执行组件共享：

- 同一个 `options.prisma`。
- 同一个 `options.blobs`。
- 同一个 backend 实例。
- 同一个 store 实例。
- 同一个 value store 实例。
- 同一个 event sink 实例。
- 同一个 definition registry 实例。
- 同一个 Action registry 实例。
- 同一组 lane 基础依赖。

## 状态与持久化

该组件没有自己的 durable 状态，也不定义独立的持久化模型。

它只组装依赖。实际状态分别由以下组件或边界拥有：

- workflow backend；
- workflow host store；
- workflow value/blob store；
- workflow event sink；
- 各 lane 的 owner 及其运行时状态。

`createWorkflowHost` 不缓存跨调用状态。每次正常调用都会创建一组新的 host 组件实例，但该组实例内部共享调用方传入的同一个 Prisma client 和 blob store。

## 状态转换

| 当前条件 | 输入/事件 | 下一状态或结果 |
|---|---|---|
| 尚未组合 | `definitions` 为空 | 抛出固定错误；不进入 durable host 构造 |
| 尚未组合 | `actions` 为空 | 抛出固定错误；不进入 durable host 构造 |
| 尚未组合 | definitions 与 actions 均非空 | 构造 registry、持久化依赖和三个 lane 组件，返回可用 host |
| host 已返回 | application runtime 使用输出组件 | 状态转换由对应 backend、store、value/blob、event 或 lane owner 处理 |

本组件本身不存在可持久化的生命周期状态机。

## 副作用

正常组合可能产生的进程内副作用仅限于对象构造和依赖连接：

- 基于同一个 Prisma client 创建 `PrismaWorkflowBackend`。
- 基于同一个 Prisma client 创建 `PrismaWorkflowEventSink`。
- 基于同一个 blob store 创建 `BlobWorkflowValueStore`。
- 创建 definition registry 与 Action registry。
- 读取 `actions.descriptors()`。
- 创建 `descriptor.ref → descriptor.retryPolicy` 映射，并忽略 `retryPolicy === null` 的 descriptor。
- 使用该映射配置 `PrismaWorkflowHostStore`。
- 创建 run lane、activity worker 和 completion dispatcher。

组合根不应在构造期间主动执行 workflow、领取 lease、派发 completion 或运行 Action。

## 错误与降级

当任一 catalog 为空时，组件必须抛出以下固定错误：

```text
COSMOS_WORKFLOW_HOST_ENABLED is reserved until this Worker registers its executable Workflow definitions and Actions; refusing to start an empty durable host.
```

约束如下：

- definitions 为空和 actions 为空使用同一错误。
- 两者均为空时仍使用同一错误。
- 拒绝必须发生在 durable host 构造之前。
- 不允许返回部分初始化的 host。
- 不允许以空 registry、空 worker、禁用 lane 或占位实现降级。
- 不允许采用空 catalog fallback。

其他构造错误由对应依赖直接暴露；本组合根不规定额外包装、重试或吞错行为。

## 依赖

正常路径的构造关系如下：

```text
options.prisma
├── PrismaWorkflowBackend
├── PrismaWorkflowEventSink
└── PrismaWorkflowHostStore 的 Prisma 持久化边界

options.blobs
└── BlobWorkflowValueStore

options.definitions
└── MemoryDefinitionRegistry

options.actions
└── ActionRegistry
    └── descriptors()
        └── 非 null retryPolicy
            └── actionRetryPolicies
                └── PrismaWorkflowHostStore options
```

共享 `laneOptions` 包含：

```text
store
backend
definitions
values
events
owner
workerId
leaseMs
runLeaseMs
heartbeatMs
heartbeatIntervalMs
logger
now
```

消费者为：

- `WorkflowRunLane(laneOptions)`；
- `WorkflowActivityWorker({ ...laneOptions, actions })`；
- `WorkflowCompletionDispatcher(laneOptions)`。

Action retry policy 只能来自 `ActionRegistry.descriptors()` 中 descriptor 明确声明的 `retryPolicy`。不得声称或实现从 workflow definition、store 默认值、Action 执行函数、环境配置或其他来源推断 retry policy。

## 配置

本组件接受的运行配置为：

- `owner`
- `workerId`
- `leaseMs`
- `runLeaseMs`
- `heartbeatMs`
- `heartbeatIntervalMs`
- `logger`
- `now`

配置规则：

- 这些字段原样进入共享 lane options。
- activity worker 在共享 lane options 基础上额外接收共享的 Action registry。
- `PrismaWorkflowHostStore` 接收从 Action descriptor 明确组装的 `actionRetryPolicies`。
- `null` retry policy 不进入 `actionRetryPolicies`。
- 本组件不解释可选 lane 配置的默认值。
- 默认值由 application runtime 或具体依赖负责。

## 重建验收

1. **给定** `definitions` 为空且其他必需输入有效，**观察** `createWorkflowHost` 抛出固定错误文本，**且不发生** Prisma backend、event sink、host store 或 blob value store 的构造。
2. **给定** `actions` 为空且其他必需输入有效，**观察** `createWorkflowHost` 抛出相同固定错误文本，**且不发生** durable host 的部分初始化或 fallback。
3. **给定** definitions 与 actions 均非空，**观察** 返回对象恰好提供 `backend`、`store`、`values`、`events`、`definitions`、`actions`、`runLane`、`activityWorker`、`completionDispatcher`，**且不发生**空 catalog 降级。
4. **给定**一个 `PrismaClient` 实例，**观察** backend、event sink 与 host store 均基于该实例组装，**且不发生**额外 Prisma client 创建或替换。
5. **给定**一个 `FileBlobStore` 实例，**观察** value store 基于该实例构造并由三个 lane 共享，**且不发生**额外 blob store 创建。
6. **给定**一组 definitions，**观察**只创建一个 `MemoryDefinitionRegistry` 且输出与三个 lane 引用同一实例，**且不发生**每个 lane 分别创建 registry。
7. **给定**一组 actions，**观察**只创建一个 `ActionRegistry` 且输出与 activity worker 引用同一实例，**且不发生**隐式 Action 注册。
8. **给定**多个 Action descriptor，其中部分 `retryPolicy` 为 `null`，**观察** `actionRetryPolicies` 仅包含非 `null` policy 并以 `descriptor.ref` 为键，**且不发生**从其他来源推断或补齐 retry policy。
9. **给定**完整的可选 lane 配置，**观察** run lane、activity worker 和 completion dispatcher 接收相同的基础 lane options，**且不发生**组合根改写或自行解释默认值。
10. **给定**正常完成的组合，**观察**三个 lane 共享 backend、store、values、events 和 definitions 实例，**且不发生**语义等价但对象不同的重复构造。
11. **给定**仅完成 `createWorkflowHost` 调用而未启动 runtime，**观察**返回已组装的 host 对象，**且不发生**workflow 执行、Action 执行、lease 领取或 completion 派发。

## 实现与测试锚点

- `apps/worker/src/workflow-host.ts`
  - `WorkflowHostCompositionOptions`
  - `createWorkflowHost`
  - 空 catalog 前置拒绝
  - backend、store、value store、event sink 与 registry 构造
  - Action descriptor retry policy 映射
  - 共享 lane options
  - host 输出对象
- `apps/worker/src/workflow-host.test.ts`
  - 空 definition catalog 拒绝
  - 空 Action catalog 拒绝
  - 共享 backend、store、value store、registry 和 lane 实例测试
  - Action retry policy 组装测试
- `apps/worker/src/workflow-ingest.test.ts`
  - composition 使用场景

## 非目标/边界

- 不规定业务 Action 的具体行为。
- 不展开 SQL fencing 的实现细节。
- 不规定 kernel replay 的算法或语义。
- 不保证或描述跨进程 recovery。
- 不提供空 catalog fallback。
- 不验证 Docker 环境。
- 不验证 browser 行为。
- 不声称已验证真实外部来源。
- 不复制 `WorkflowHostStore`、Action 或 Lease 的 canonical 定义。
- 不定义 application runtime 或各依赖对 lane 可选配置的默认值。
- 不负责启动、调度或停止 Worker 进程。
- 不负责执行 workflow、Action 或 completion。
- 不从 Action descriptor 之外的来源推断 retry policy。
