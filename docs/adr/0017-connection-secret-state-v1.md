# ADR-0017：Connection / SecretStore / ConnectorStateStore v1

> 状态：Accepted design contract
>
> 日期：2026-09-10
>
> 关联：[`connection-state-store-v1 Proposal`](../proposals/connection-state-store-v1.md)、[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §4.2/§5.2、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) AUT-009/AUT-010/ING-012/OPS-009、ADR [`0001`](0001-durable-workflow-runtime.md)

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

`SecretRef` 只出不透明引用，Secret 读取只在 Worker/Connector 边界通过能力受限租约发生；Secret 不进入 DomainEvent、Job payload、日志或普通 DTO；`ConnectorState.valueJson` 不允许写 Secret。所有权：Secret → SecretStore；cursor/ETag/token/rate → ConnectorStateStore；Blob/Artifact → 既有 Blob Root，三者互不混写。

## Consequences

### Positive

- 连接身份、凭证、非秘密状态第一次有了统一归属，后续多采集计划、Trigger/SDK、更多平台 Adapter 有了可复用的地基。
- 凭证与普通配置/日志/事件彻底分离，满足 OPS-005/009 基线，且不引入加密/多用户复杂度。
- forward-only migration，无回填；无认证来源行为不变。

### Costs and risks

- SecretStore v1 是明文文件，仅靠文件系统权限；单用户本地场景可接受，多用户/远程/云端后需要重新评估（Revisit Gate）。
- `SourceInstance.connectionId` 无 DB FK（SQLite 限制），删除连接的 SetNull 由仓库事务显式保证；绕过仓库直接写库可能留下悬空引用。
- 本切片是基础设施，v1 没有真实认证 Adapter 消费 Connection/Secret（Bilibili 仍走 OpenCLI profile）；价值在合同与地基，不在即时可见功能。

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
- 出现真实认证类 Adapter（Connection.secretRef 被实际写入/读取，需登录生命周期与撤销语义）；
- 需要 Secret 轮换、过期、审计或细粒度授权。
