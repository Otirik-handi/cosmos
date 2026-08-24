# ADR-0004：SourceInstance 身份与 revision 并发边界

> 状态：Accepted design contract
>
> 日期：2026-08-24
>
> 关联：[`0003-service-worker-api-boundaries.md`](0003-service-worker-api-boundaries.md)、[`../api/0002-product-service-api.md`](../api/0002-product-service-api.md)、[`../../.agents/tasks/02-rss-ingestion/README.md`](../../.agents/tasks/02-rss-ingestion/README.md)

## Context

`SourceInstance` 表示用户保存的一条具体来源配置，包含名称、来源类型、配置、启用状态以及与 Run、Observation、Entry、Checkpoint 的关联。当前数据库只有 `kind`、`configJson`、`enabled` 和时间字段；Worker 的 `ConnectorRegistry` 也按 `kind` 查找 Connector。

Catalog 已经为来源定义提供版本化 `ref`，例如 `source.rss@1`，并为每个定义提供配置 schema。只有保存 `kind` 无法证明某条 SourceInstance 使用了哪一版配置规则，也无法让排队 Run 稳定重放创建时的来源定义。当前没有独立 revision；`updatedAt` 是时间投影，不是并发令牌，不能承担过期写保护。

## Decision

### 1. SourceDefinitionRef 是 SourceInstance 的唯一业务身份

目标合同中的 SourceInstance 保存：

- `sourceDefinitionRef`：精确匹配不可变 Catalog manifest，例如 `source.rss@1`；
- `operationId`：当前首批内置来源使用 `fetch`；
- 已通过对应 strict schema 的配置；
- 启用状态和独立 revision。

`connectorId` 不作为 SourceInstance 持久字段。Repository/Application 通过注入的
`CatalogPort` 按 `sourceDefinitionRef` 取得不可变 manifest，再生成 `connectorId`
和迁移期 `kind` 运行时投影。API、Worker 和 Repository 不得由调用方手工传入这两个
投影，也不得通过字符串截断、拼接或其它隐式规则猜测映射。

新 Product API 只接受 `sourceDefinitionRef`，不接受 `kind`。

### 2. Manifest 显式声明运行时 Connector

每个可执行 SourceDefinition manifest 必须显式声明运行时 `connectorId`。Worker 通过：

```text
SourceDefinitionRef -> injected CatalogPort -> immutable manifest -> connectorId -> ConnectorRegistry
```

解析 Connector。旧 `kind` 在迁移期只作为由 manifest 生成的兼容投影保留，不是第二套业务身份真相。

### 3. Revision 是独立的单调并发令牌

SourceInstance 持久化从 `1` 开始的单调整数 `revision`，公开 Snapshot 提供不透明 `revisionId`。服务端可以用 Source id 与 revision 生成该投影，但客户端不得依赖其格式。

- 创建从 revision 1 开始，且 `enabled=false`；
- 配置更新要求 `baseRevisionId`，使用数据库条件更新（CAS）；
- 启用/停用 Command 也要求 `baseRevisionId` 和 `Idempotency-Key`；实际状态变化时递增 revision；
- revision 不匹配返回当前 `conflict` 合同（HTTP 409）；
- `updatedAt` 只用于时间排序和展示，永远不能作为 revision 或 CAS 条件。

完整配置替换表示：当更新配置时，提交的 config 是该 SourceDefinition schema 下的完整配置对象，不做未声明的浅合并。`sourceDefinitionRef` 与 `operationId` 在本切片中不可变。

### 4. 迁移先预检，再回填

现有数据迁移必须使用登记的显式映射，例如：

```text
rss         -> source.rss@1         + fetch
fixture-rss -> source.fixture-rss@1 + fetch
bilibili    -> source.bilibili@1   + fetch
aihot       -> source.aihot@1       + fetch
```

未知 kind、一个 kind 对应多个不明确 manifest、manifest 不可用或 operation 不存在时，迁移必须阻断并报告。不得写入 nullable ref、不得静默生成 ref、不得把 `updatedAt` 转成 revision。已存在来源的启用状态保持原值；只有新 Product API 的创建默认停用。

### 5. 排队 Run 使用不可变配置快照

Run 入队时保存 `sourceDefinitionRef`、`operationId`、完整 config 和当时的 Source revision。之后修改 Source 不改变已创建 Run 的输入。Worker 依赖快照执行，不重新读取当前 Source 配置来替换已排队输入。

## Consequences

### Positive

- API、数据库和 Worker 对来源版本有单一业务身份。
- `source.rss@1` 与未来的 `source.rss@2` 可以拥有不同 schema 或 Connector 映射。
- 并发编辑和启用操作有明确的失败闭合边界，不会用时间戳伪装版本。
- 迁移失败是可诊断的，不会把未知旧数据变成错误来源。
- 排队 Run 的执行含义不会被后续 Source 编辑静默改变。

### Costs and risks

- 首轮 Prisma migration 需要对旧 kind 做显式预检和回填。
- contracts、Catalog、Repository、Worker 快照和现有测试需要同步切换。
- 迁移完成前仍会有兼容 kind 投影；它必须被限制在内部运行时边界，不能回流到 Product API。
- 这条决定不包含 CollectionPlan、未保存配置 Probe、媒体下载、Blob 流式能力或未认证作用域合同。

## Alternatives considered

### 继续只保存 kind

拒绝。无法保存 manifest 版本，不能稳定解释历史配置和排队 Run。

### 同时把 kind 和 sourceDefinitionRef 当作独立真相

拒绝。两个字段会出现不一致，迁移和更新必须额外解决谁覆盖谁的问题。保留 kind 只作为受 manifest 约束的兼容投影。

### 让 API 根据 kind 派生 sourceDefinitionRef

拒绝。它无法记录用户实际选择的 manifest 版本，也会把隐式映射变成未声明的公共行为。

### 使用 updatedAt 作为 revision

拒绝。时间字段不是单调配置版本，也不能可靠表达并发写入的 CAS 语义。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- SourceDefinition manifest 需要在同一个 ref 下可变发布，而不是不可变版本 ref；
- 一个 SourceInstance 需要同时绑定多个 operation 或多个 CollectionPlan；
- 兼容 kind 投影可以从所有运行时和迁移路径中移除；
- 多用户授权或远程 Worker 要求 revision token 携带新的作用域或签名语义。
