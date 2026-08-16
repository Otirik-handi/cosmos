# Action Registry

## 状态

Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55

## 最后更新

2026-08-16

## 组件定位

`packages/application/src/action.ts` 提供四个应用层构件：

- `ActionRegistry`：进程内 Action 注册、解析、描述与执行入口。
- `ActionExecutionContext`：公开执行上下文。
- `HostActionExecutionFence`：仅供 host Action 执行时使用的宿主执行栅栏。
- `ActionExecutionError`：Action 查找、校验与执行失败的统一错误类型。

合同类型及其 canonical 定义以 [`ActionDefinition`、`ActionDescriptor`、action ref、execution placement、retry policy 和 action error schema](../contracts/0001-public-contracts.md) 为准；本文只描述本模块的运行时行为。

## 概念与定义

### ActionRegistry

`ActionRegistry` 内部使用进程内 `Map<string, RegisteredAction>`，以完整 versioned ref 为键保存定义与 handler。

构造函数可接收初始注册项，并逐项调用 `register`；构造期注册与后续显式注册遵循相同校验和重复检测规则。

### ActionExecutionContext

公开上下文只包含：

| 字段 | 约束 |
| --- | --- |
| `idempotencyKey` | 非空字符串 |
| `signal` | `AbortSignal` 实例 |

普通 handler 接收的上下文不包含 host fence。

### HostActionExecutionFence

host 执行栅栏包含：

| 字段 | 约束 |
| --- | --- |
| `workflowRunId` | 非空字符串 |
| `kernelRevision` | 安全的非负整数 |
| `activity` | 完整 `ActivityIdentity` |
| `activity.key` | 非空字符串 |
| `activity.path` | 非空字符串 |
| `activity.seq` | 由 `ActivityIdentity` schema 校验 |
| `activity.kind` | 由 `ActivityIdentity` schema 校验 |
| `activity.fingerprint` | 非空字符串 |
| `jobId` | 非空字符串 |
| `attempt` | 正整数 |
| `jobLeaseToken` | 非空字符串 |
| `runLeaseToken` | 非空字符串 |

该栅栏仅由 `dispatchHost` 接收，并且只添加到传给 host handler 的上下文中。

### ActionExecutionError

`ActionExecutionError` 携带合同定义的 `code` 和布尔值 `retryable`。合法错误码由 [`actionErrorCodeSchema`](../contracts/0001-public-contracts.md) 判定，本文不复制其 canonical 枚举定义。

## 外部行为

### 注册

`register` 按以下顺序建立注册项：

1. 要求 `handler` 为函数。
2. 使用 `actionDefinitionSchema.parse` 校验 definition。
3. 以完整 versioned ref 检查重复。
4. 将校验后的 definition 与 handler 写入进程内 Map。

同一完整 versioned ref 重复注册时立即抛出普通 `Error`。同一 base ref 的不同版本使用不同 Map 键，可以同时存在。

### 解析

`resolve(ref)` 先使用 `actionRefSchema` 校验 ref：

- 非法 ref：抛出 `ActionExecutionError`，`code` 为 `invalid_action_ref`，`retryable` 为 `false`。
- ref 合法但未注册：抛出 `ActionExecutionError`，`code` 为 `unknown_action`，`retryable` 为 `false`。
- ref 合法且已注册：返回对应注册项。

校验覆盖完整 versioned ref 要求；bare ref、版本 `0`、前导零版本、非安全整数版本，以及不满足合同分段规则的 ref 均不可解析。ref 的 canonical 语法见 [`action ref`](../contracts/0001-public-contracts.md)。

### 普通分发

`dispatch(ref, input, context)`：

1. 解析注册项。
2. 拒绝 `executionPlacement` 为 `host` 的 Action。
3. 校验公开 `ActionExecutionContext`。
4. 使用 Action 输入 schema 解析输入。
5. 调用 handler。
6. 使用 Action 输出 schema 解析 handler 返回值。
7. 返回解析后的输出。

`trusted_worker` 和 `remote_worker` placement 都通过此公开入口执行。本模块不会据此创建远程进程或进行跨进程传输。

### Host 分发

`dispatchHost(ref, input, context, fence)`：

1. 解析注册项。
2. 只接受 `executionPlacement` 为 `host` 的 Action。
3. 校验公开 `ActionExecutionContext`。
4. 校验完整 `HostActionExecutionFence`。
5. 使用 Action 输入 schema 解析输入。
6. 将已校验 fence 添加到仅供本次调用使用的 handler 上下文。
7. 调用 host handler。
8. 使用 Action 输出 schema 解析返回值。
9. 返回解析后的输出。

通过 `dispatch` 调用 host Action 时，不会自动转交给 `dispatchHost`，而是以 `invalid_input`、`retryable: false` 失败。

## 输入

`ActionRegistry` 接受以下输入：

| 入口 | 输入 |
| --- | --- |
| 构造函数 | 零个或多个 definition/handler 注册项 |
| `register` | 一个 [`ActionDefinition`](../contracts/0001-public-contracts.md) 和一个函数 handler |
| `resolve` | 完整 versioned action ref |
| `dispatch` | ref、未知类型的 Action 输入、公开执行上下文 |
| `dispatchHost` | ref、未知类型的 Action 输入、公开执行上下文、完整 host fence |

输入 payload 的实际结构由已注册 Action 的 executable input schema 判定，不由 Registry 预先固定。

## 输出

`dispatch` 与 `dispatchHost` 返回 Action handler 的结果，但只有在结果通过该 Action 的输出 schema 后才会返回。

`descriptors()` 返回按完整 ref 使用 `localeCompare` 排序的可序列化描述列表。每项是已注册 definition 的描述投影，包含 ref、version、可选 manifest hash、kind、description、capabilities、execution placement、幂等性、取消支持、超时和重试策略等合同字段；准确结构见 [`ActionDescriptor`](../contracts/0001-public-contracts.md)。

描述投影具有以下边界：

- 不输出 Zod executable input/output schemas。
- 数组字段创建副本。
- `retryableErrors` 创建副本。
- `actionManifestSchema` 在本模块中是 descriptor schema 的别名。

## 状态与持久化

Registry 的唯一所有状态是当前进程中的 Map：

- 不写入数据库、文件、缓存或消息系统。
- 不恢复之前进程中的注册项。
- 进程重启后必须重新执行 `register`。
- 不拥有 Action 重试次数、退避计划或重试队列。
- 不拥有 job lease、run lease 或 fence 生命周期。

descriptor 是当前内存注册状态的派生快照，不是持久化清单。

## 状态转换

| 当前状态 | 操作 | 条件 | 结果 |
| --- | --- | --- | --- |
| 未注册 | `register` | definition、handler 合法 | Map 新增完整 ref |
| 已注册 | `register` | 完整 ref 相同 | 立即抛出 `Error`，原注册项保持不变 |
| 已注册某版本 | `register` | base ref 相同、版本不同 | 新版本独立加入 Map |
| 已注册 | `resolve` | ref 合法且命中 | 返回注册项，不改变状态 |
| 任意 | `dispatch` / `dispatchHost` | 执行成功或失败 | Registry 注册状态不变 |
| 任意 | 进程退出 | 任意 | 全部注册状态丢失 |

本模块没有注销、覆盖、迁移或持久化恢复转换。

## 副作用

Registry 自身的副作用仅限于：

- 构造或注册时修改当前实例的内存 Map。
- 分发时调用已注册 handler。
- 失败时抛出错误。

Registry 本身不执行外部 I/O。handler 可能产生的副作用属于对应 Action 实现，不由 Registry 创建、提交或回滚。

## 错误与降级

| 失败来源 | 对外结果 |
| --- | --- |
| ref 不符合合同 | `invalid_action_ref`，不可重试 |
| ref 合法但未注册 | `unknown_action`，不可重试 |
| 公开 context 无效 | `invalid_input`，不可重试 |
| placement 与分发入口不匹配 | `invalid_input`，不可重试 |
| host fence 无效 | `invalid_input`，不可重试 |
| Action 输入 schema 解析失败 | `invalid_input`，不可重试 |
| Action 输出 schema 解析失败 | `malformed_payload`，不可重试 |
| handler 抛出 `ActionExecutionError` | 原错误对象及其分类保持不变 |
| handler 抛出的值带有合法 action error code | 包装为该 code；布尔 `retryable` 原样沿用，否则默认为 `true` |
| handler 抛出其他错误或值 | `internal_error`，不可重试 |

Registry 只负责错误归类，不执行重试、退避、熔断、降级调用或 lease 更新。

## 依赖

本模块直接依赖合同层提供的 schema 和类型，包括：

- [`ActionDefinition` 与 `ActionDescriptor`](../contracts/0001-public-contracts.md)。
- [`action ref` 与 execution placement](../contracts/0001-public-contracts.md)。
- [`retry policy 与 action error schema`](../contracts/0001-public-contracts.md)。
- `ActivityIdentity` 的运行时校验。
- Zod schema 的 `parse`/校验语义。
- 平台原生 `AbortSignal`。

Registry 不依赖远程 worker 客户端、持久化适配器、调度器或 lease 存储。

## 配置

本模块没有环境变量、配置文件或全局单例配置。

运行时行为由以下注册数据决定：

- 构造函数或 `register` 提供的 Action definition。
- 对应 executable input/output schemas。
- 对应 handler。
- definition 中声明的 execution placement、超时、取消、幂等与重试元数据。

这些元数据用于校验、路由限制和 descriptor 输出；Registry 不据此实现计时器、取消传播之外的控制器或重试执行器。

## 重建验收

以下条件必须全部可重复验证：

1. 构造 Registry 并提供初始注册项后，`resolve` 能立即解析这些项。
2. 注册同一 base ref 的两个不同正整数版本后，两个完整 ref 均可独立解析。
3. 第二次注册相同完整 versioned ref 时立即抛出 `Error`，且原注册项仍可解析。
4. bare ref、版本 `0`、前导零版本、非安全整数版本及非法分段 ref 均产生 `invalid_action_ref`，且不可重试。
5. 合法但未注册的完整 ref 产生 `unknown_action`，且不可重试。
6. 缺少、置空或伪造 `idempotencyKey`/`AbortSignal` 的公开 context 产生 `invalid_input`。
7. `dispatch` 可执行 `trusted_worker` 和 `remote_worker` Action，但不会创建远程进程。
8. `dispatch` 调用 host Action 产生 `invalid_input`，且不可重试。
9. `dispatchHost` 调用非 host Action 产生 `invalid_input`，且不可重试。
10. `dispatchHost` 缺失或破坏任一 fence 必需字段时产生 `invalid_input`。
11. host handler 能读取已校验 fence；普通 handler 的上下文中不存在 fence。
12. 输入 schema 失败产生 `invalid_input`；handler 不被调用。
13. 输出 schema 失败产生 `malformed_payload`，且不可重试。
14. handler 抛出的 `ActionExecutionError` 保持原样。
15. handler 抛出的合法 action error code 被保留；显式布尔 `retryable` 被保留，缺失或非布尔值时为 `true`。
16. handler 抛出无法识别的错误时产生 `internal_error`，且不可重试。
17. `descriptors()` 按完整 ref 的 `localeCompare` 顺序返回结果。
18. descriptor 不含 executable schemas，且数组与 `retryableErrors` 不与内部 definition 共享数组引用。
19. 创建新 Registry 实例或重启进程后，旧实例中的注册项不会自动恢复。
20. 任一分发失败都不会在 Registry 中创建 retry、lease 或其他 durable 状态。

## 实现与测试锚点

- 实现：[packages/application/src/action.ts](../../../packages/application/src/action.ts#L13-L247)，行 13-247。
- 测试：[packages/application/src/action.test.ts](../../../packages/application/src/action.test.ts#L59-L240)，行 59-240。
- 测试覆盖重点：版本 ref、重复注册、非法 ref、执行上下文、host fence 隔离、输入/输出 schema 和错误分类。
- 合同来源：[公共契约](../contracts/0001-public-contracts.md)。

## 非目标/边界

本模块明确不实现：

- remote worker 进程创建、发现、网络调用或调度。
- Registry 的持久化、复制、同步或跨进程共享。
- host fence 的跨进程序列化、传输或验证服务。
- retry 状态、重试调度、退避或熔断。
- job lease 或 run lease 的签发、续租、撤销与持久化。
- signals、timers、children 或 outbox。
- handler 外部副作用的事务管理、补偿或幂等存储。
