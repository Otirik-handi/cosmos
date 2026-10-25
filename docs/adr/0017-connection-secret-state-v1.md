# ADR-0017：Connection / SecretStore / ConnectorStateStore v1

> 状态：Accepted design contract
>
> 部分取代：决定 1 的「Bilibili 的 OpenCLI profile 继续作为外部登录态例外留在 `config.profile`」由 ADR [`0027`](0027-connection-login-lifecycle-v1.md) 取代（2026-09-23，profile 归连接的非秘密配置 `configJson`）；决定 2/4 的 SecretStore 文件格式与 `put/read/delete(ref)` 公共接口不变。Agent provider connection 凭证使用合同由已接受 Proposal [`agent-provider-connection-credential-v1`](../proposals/agent-provider-connection-credential-v1.md) 细化。
>
> 部分取代（2026-10-23，Task 39）：凭证所有者从 Connection 移到 Provider——`ModelProvider` 独占指向 SecretStore 的 `secretRef`，模型由 `ConfiguredModel` 归属该 Provider（含上游模型标识与上下文的预算上限），模型型连接只保存所选 `modelId`、不带凭证。`agent.invoke@2` 每次调用按 **Connection → Model → Provider → SecretStore** 解析一致快照，再走调用边界；本文「单 Worker 部署 profile + `Connection.secretRef` 提供模型凭证」这条路已在 F 切片退出——Worker 不再读 `COSMOS_AGENT_*`、不再注册 `agent.invoke@1`，`agent.invoke@1` 只作为 Story 生成侧复用的端口与输入输出契约存在。仍然成立的部分：决定 2 的 SecretStore 文件格式（本机受限权限明文、`put/read/delete(ref)`、路径逃逸校验）、决定 4 的按次在 callback 作用域内读取与 fail closed（取消后不读、读取失败或状态非 `active` 即拒绝）、普通非模型连接继续携带自己的 `secretRef`、`SourceInstance.connectionId` 与 `ConnectorStateStore` 的归属划分。目标合同见已接受的 [Provider/model 产品配置](../proposals/connection-credential-entry-v1.md) 与 [API 0009](../api/0009-provider-model-configuration.md)。
>
> 日期：2026-09-10
>
> 关联：[`connection-state-store-v1 Proposal`](../proposals/connection-state-store-v1.md)、[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §4.2/§5.2、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) AUT-009/AUT-010/ING-012/OPS-009、ADR [`0001`](0001-durable-workflow-runtime.md)、ADR [`0026`](0026-connector-state-export-v1.md)（`ConnectorState` 的归属登记、导出与导入）

## Context

继续增加平台 Adapter 前需要统一三块基础设施：可复用的连接身份（ConnectionInstance）、凭证的归属（SecretStore）和非秘密运行状态（ConnectorStateStore）。当前 `SourceInstance` 用 `configJson` 混存配置，Bilibili 把 OpenCLI profile 引用也放在 config 里；`Checkpoint` 按 `sourceInstanceId` 唯一保存 cursor；存储根虽预留 `secretRoot` 但没有 SecretStore 实现。2026-09-10 用户裁决四项默认建议（ConnectionInstance 可空外键、SecretStore 第一版 = 受限权限明文文件、ConnectorStateStore 用新表不迁移 Checkpoint、Secret 脱敏与所有权边界），本文沉淀这些稳定决定。

## Decision

### 1. `ConnectionInstance` 实体 + `SourceInstance.connectionId` 可空外键

新增 `ConnectionInstance`（name、connectorId、account、scopeJson、status `active|revoked|expired|error`、secretRef、lastError）。`SourceInstance` 新增可空 `connectionId`（`onDelete: SetNull`，SQLite 无 DB FK，由仓库删除连接时显式置空）。无认证来源（RSS/fixture）`connectionId=null`。Bilibili 的 OpenCLI profile 继续作为外部登录态例外留在 `config.profile`（架构 §4.2 明确允许）。

### 2. SecretStore 第一版 = 受限权限明文文件（待决定 16）

文件后端，每个不透明 `SecretRef` 一个文件，落在 `secretRoot`（`.cosmos/secrets/`），写入 `mode: 0o600`（POSIX 生效、Windows 尽力而为），带路径逃逸校验。**不加密**：v1 面向单个本地用户（OPS-007），无多用户共享威胁模型。公开合同只暴露 `SecretStorePort`（put/read/delete by ref），Secret 不进数据库/config/Job payload/DomainEvent/日志。加密-at-rest（OS 凭据库或加密文件）作为 Revisit Gate。

### 3. `ConnectorStateStore` = 命名空间化 + 版本化 KV（新表），不迁移 Checkpoint

新增 `ConnectorState`（`(namespace, key)` 唯一 + `valueJson` + 单调 `version`）。`getState`/`putState(expectedVersion)` 用 version CAS；`expectedVersion: null` 表示「期望不存在」，不匹配抛 `ConnectorStateConflictError`。v1 **不迁移 `Checkpoint`**：cursor 的 ingest 专用 CAS + domain event 与「多计划」耦合，迁移随 CollectionPlan 一起做；`ConnectorStateStore` 覆盖 ETag/分页 token/速率等非 ingest 状态。

### 4. Secret 脱敏与所有权边界（OPS-005/009）

`SecretRef` 只出不透明引用；Secret 读取只在可信 Worker/Connector 执行边界发生。现有 `SecretStorePort` 是 `put/read/delete(ref)`，没有可撤销的租约句柄；Agent v1 使用按次的短时回调读取：每次 Invocation 重新读取 Connection 与 SecretStore，不缓存凭证；取消已触发时不读 Secret，状态非 `active`、无 `secretRef` 或读取失败时 fail closed。Secret 只在回调期间传给可信 pi-ai SDK，不进入 DomainEvent、Job payload、日志或普通 DTO；JavaScript 无法保证内存物理清零。调用已发出后，Connection 撤销不能保证 Provider 侧请求停止，只阻止后续读取；现有取消信号尽力中止本地 SDK 请求。`ConnectorState.valueJson` 不允许写 Secret。所有权：Secret → SecretStore；cursor/ETag/token/rate → ConnectorStateStore；Blob/Artifact → 既有 Blob Root，三者互不混写。

## Consequences

### Positive

- 连接身份、凭证、非秘密状态第一次有了统一归属，后续多采集计划、Trigger/SDK、更多平台 Adapter 有了可复用的地基。
- 凭证与普通配置/日志/事件彻底分离，满足 OPS-005/009 基线，且不引入加密/多用户复杂度。
- forward-only migration，无回填；无认证来源行为不变。

### Costs and risks

- SecretStore v1 是明文文件，仅靠文件系统权限；单用户本地场景可接受，多用户/远程/云端后需要重新评估（Revisit Gate）。
- `SourceInstance.connectionId` 无 DB FK（SQLite 限制），删除连接的 SetNull 由仓库事务显式保证；绕过仓库直接写库可能留下悬空引用。
- SecretStore v1 是本机受限权限明文文件，不加密；Windows 权限保护 best effort。部署者必须保护 Data Root。Worker 的 Agent profile 与 Connection ID 是非秘密部署配置，不持久化至 Agent payload；管理员显式确保 Connection 凭证适用于选定 Provider，系统不解析 Secret 以检测错配。
- Agent credential callback 缩小 Secret 引用存活范围，但不等同租约、内存清零或 provider 侧撤销；已开始请求可能继续执行。

## Alternatives considered

### SecretStore = OS 凭据库

拒绝（v1）。三平台原生集成成本高，且 v1 无多用户威胁模型。

### SecretStore = 加密文件

拒绝（v1）。需要密钥来源与轮换，超出 v1；先以「分离 + 受限权限 + 不脱敏泄漏」满足 OPS-005 基线。

### 迁移 Checkpoint → ConnectorStateStore

拒绝（v1）。cursor 的 ingest 专用 CAS + domain event 与「多计划」耦合，应随 CollectionPlan 一起迁移，避免先迁一遍再改。

### `SourceInstance.connectionId` 必填

拒绝。RSS/fixture 无认证，强制必填会破坏现有产品入口。

### Bilibili profile 迁入 Connection

拒绝（v1）。架构 §4.2 明确允许 OpenCLI 作为外部登录态例外，长期再映射到统一 Connection 合同。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 引入多用户、远程 Worker 或云端同步（SecretStore 需加密/OS 凭据库）；
- CollectionPlan / 多采集计划进入实现（Checkpoint 迁移到按计划的 ConnectorStateStore）；
- 多 Provider、多 Agent profile 或动态路由需要由产品层管理 Agent profile/Provider-to-Connection 绑定；（2026-10-23 更新：多 Provider 与「模型 → 连接」的产品层绑定**已由 Task 39 触发**，见本文顶部的部分取代段——凭证归 Provider、模型归 `ConfiguredModel`、`agent.invoke@2` 按 Connection → Model → Provider → SecretStore 解析，旧部署 profile 已随之退出。多 Agent profile 与动态路由仍未实现。）
- Agent Worker profile / Connection 凭证消费者需要超出当前单 profile、callback-scoped 读取合同的能力；
- 需要 Secret 轮换、过期、审计或细粒度授权。
