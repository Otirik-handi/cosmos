# Proposal：Connection / SecretStore / StateStore v1（平台面基础设施）

> 状态：accepted
>
> 日期：2026-09-10
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) AUT-009、AUT-010、ING-012、OPS-009（关联 OPS-005）
>
> 关联设计：架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §4.2、§4.6、§5.2；ADR [`0001`](../adr/0001-durable-workflow-runtime.md)（checkpoint 属于未来采集计划 StateStore）
>
> 关联既有切片：Task 02（RSS 录入）、Task 21（Run 控制 v1）

## 1. 问题

PRD 把「平台面」的 Connection/StateStore 拆成四块相关能力：AUT-009（可复用 ConnectionInstance）、AUT-010（一个连接下多个独立采集计划）、ING-012（命名空间化版本化 StateStore 保存 cursor/ETag/token/速率状态）、OPS-009（SecretStore/ConnectorStateStore/Blob 的生命周期与所有权边界）。当前实现完全没有这一层：

- `SourceInstance`（`packages/storage-prisma/prisma/schema.prisma:10`）是唯一来源实体，`configJson` 里混存了 `feedUrl`/`scheduleIntervalMs`/`media`，Bilibili 还把 `profile`（OpenCLI 登录态引用）也放在 config 里。
- 没有 `Connection`/`ConnectionInstance`/`CollectionPlan`/`ConnectorState`/`SecretStore` 任何模型。
- `Checkpoint`（`schema.prisma:44`）按 `sourceInstanceId` 唯一保存 cursor，是「每来源一个游标」，不能表达「一个连接下多个独立计划」。
- 存储根已预留 `secretRoot`（`packages/storage-prisma/src/index.ts:156`，`.cosmos/secrets/`），但没有 SecretStore 实现。
- Bilibili 凭证走 OpenCLI Browser Bridge 的 profile 引用（`plugins/collectors/src/index.ts:232` 把 `config.profile` 传给 `OPENCLI_PROFILE`），是架构 §4.2 明确承认的「外部登录态管理例外」。

后果：继续加平台 Adapter 前，没有统一的地方放「用户登录态」（Connection + SecretRef）和「非秘密运行状态」（cursor/ETag/token/rate）。本切片建立这三块基础设施，为后续 Connection 复用、多采集计划、Trigger/SDK 和更多平台 Adapter 打底。

## 2. 目标与非目标

### 目标（v1 基础设施）

1. **ConnectionInstance**（AUT-009 部分）：可复用的连接实体；`SourceInstance` 新增可空 `connectionId`，多个来源可指向同一连接。公开读取投影展示连接状态、授权范围和失效原因。
2. **SecretStore**（待决定 16 + OPS-009）：第一版后端；`ConnectionInstance` 只保存不透明 `SecretRef`，凭证本体不进数据库/config/Job payload/DomainEvent/日志。
3. **ConnectorStateStore**（ING-012）：命名空间化 + 版本化的非秘密状态 KV，保存 ETag/分页 token/速率状态等；Adapter 可声明状态 schema，Cosmos 负责命名空间、版本、并发与恢复。

### 非目标（本切片明确后置）

- **CollectionPlan / 多采集计划**（AUT-010）：架构 §4.7 已冻结「当前以一个 SourceInstance 表达，不新增独立 CollectionPlan 持久对象，CollectionPlan 仍是后续扩展边界」。本切片不引入 CollectionPlan。
- **Checkpoint → ConnectorStateStore 迁移**：cursor 目前按 Source 保存是 ingest 专用（revision CAS + domain event），其按计划迁移随 CollectionPlan 一起做；v1 保留 `Checkpoint` 不变，新增的 `ConnectorStateStore` 覆盖 ETag/token/rate 等非 ingest 状态。
- 加密-at-rest、Secret 轮换/过期 UI、多用户认证、远程/云端同步、OS 凭据库集成。

## 3. 当前行为与证据

- `SourceInstance` 字段见 `packages/storage-prisma/prisma/schema.prisma:10-27`；`configJson` 是宽松 JSON，`kind`/`sourceDefinitionRef`/`operationId` 表达来源身份，`revision` 是并发令牌。
- `Checkpoint`（`schema.prisma:44-53`）`sourceInstanceId @unique`，cursor + `revision`（CAS）+ `workflowRunId`；`getCheckpointSnapshot`（`packages/storage-prisma/src/index.ts:695`）与 `setWorkflowIngestCheckpoint`（`:1777`）读写。
- 存储根 `resolveStorageRoots`（`:141`）已含 `secretRoot`，但无消费方。
- Bilibili profile 见 `plugins/collectors/src/index.ts:224-232`（`OPENCLI_PROFILE`）；RSS/fixture 无认证。
- 无任何 Secret/Connection/ConnectorState 相关 Prisma 模型、API 端点、DTO 或 Web 界面。

## 4. 方案

### 决策 1：`ConnectionInstance` 实体 + `SourceInstance.connectionId` 可空外键

新增 `ConnectionInstance` 模型：

```text
id, name, connectorId, account(可空), scopeJson(可空授权范围),
status(active|revoked|expired|error), secretRef(可空), lastError(可空),
createdAt, updatedAt
```

`SourceInstance` 新增可空 `connectionId`（`onDelete: SetNull`，删除连接不删除来源）。无认证来源（RSS/fixture）`connectionId` 为 null，行为不变。Bilibili 的 OpenCLI profile 继续作为外部登录态例外留在 `config.profile`（架构 §4.2 明确允许），不强制迁入 Connection。

**备选**：`SourceInstance.connectionId` 必填。拒绝：RSS/fixture 无认证，强制必填会破坏现有产品入口。

### 决策 2：SecretStore 第一版后端 = 受限权限明文文件（待决定 16）

第一版用**文件后端**（`secretRoot` 下按 `SecretRef` 命名的文件），写入时用 OS 权限限制（POSIX `0600`，Windows 用 ACL/只读隐藏，尽力而为），公开合同只暴露不透明 `SecretRef` 与能力受限的写入/读取/删除租约。**不加密**：v1 面向单个本地用户（OPS-007），威胁模型里没有多用户共享；加密-at-rest（OS 凭据库或加密文件）作为 Revisit Gate 后置。

**待维护者裁决（待决定 16）**：OS 凭据库 / 加密文件 / 受限权限明文文件 三选一；本提案默认「受限权限明文文件」。

**备选**：OS 凭据库（Windows Credential Manager / macOS Keychain / Linux Secret Service）。拒绝（v1）：三平台原生集成成本高，且 v1 无多用户威胁模型。

**备选**：加密文件。拒绝（v1）：需要密钥来源与轮换，超出 v1 范围；先以「分离 + 受限权限 + 不脱敏泄漏」满足 OPS-005 基线。

### 决策 3：`ConnectorStateStore` = 命名空间化 + 版本化 KV（新表），不迁移 Checkpoint

新增 `ConnectorState` 模型（`namespace` + `key` 复合唯一 + `valueJson` + `version` + `updatedAt`），命名空间形如 `connection:{id}` 或 `source:{id}`，版本是单调整数（CAS 条件写）。公开 `getState`/`putState(version CAS)` 合同；读取侧未知字段降级、不破坏。v1 不迁移 `Checkpoint`（见非目标）。

**备选**：把 `Checkpoint` 直接迁移进 StateStore。拒绝（v1）：cursor 的 ingest 专用 CAS + domain event 与「多计划」耦合，迁移应随 CollectionPlan 一起做，避免先迁一遍再改。

### 决策 4：公开合同与脱敏（OPS-005/009 边界）

`SecretRef` 只出不透明的引用；Secret 读取只在 Worker/Connector 边界通过能力受限租约发生；Secret 不进入 DomainEvent、Job payload、日志或普通 DTO。`ConnectorState` 的 `valueJson` 也不允许写入 Secret。所有权边界：Secret → SecretStore；cursor/ETag/token/rate → ConnectorStateStore；Blob/Artifact → 既有 Blob Root，三者互不混写，删除/备份/清理可分别定位。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| ConnectionInstance + SourceInstance.connectionId 可空 | 采纳（决策 1） |
| SourceInstance.connectionId 必填 | 拒绝（决策 1）：无认证来源 |
| SecretStore = 受限权限明文文件 | 采纳（默认，待维护者裁决） |
| OS 凭据库 | 拒绝（v1） |
| 加密文件 | 拒绝（v1，Revisit Gate） |
| ConnectorStateStore = 命名空间化版本化 KV（新表） | 采纳（决策 3） |
| 迁移 Checkpoint → StateStore | 拒绝（v1，随 CollectionPlan） |
| Bilibili profile 迁入 Connection | 拒绝（v1）：架构允许外部登录态例外 |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：Prisma schema 新增 `ConnectionInstance`、`ConnectorState` 两表；`SourceInstance` 新增可空 `connectionId`（forward-only migration，新增列可空，无回填，历史来源 connectionId=null）。
- **接口**：新增 Connection 的 Command/Query/DTO（创建/列表/详情/状态投影）与 `ConnectorState` 的 get/put（version CAS）合同；`SecretStore` 是应用层端口，不直接暴露 HTTP，SecretRef 只以不透明字符串出现在 Connection 投影。
- **安全**：Secret 文件落在 `secretRoot`（独立于数据库/config），写入尽力设受限权限；不加密；日志与事件不记录 Secret。ConnectorState 的 value 不写 Secret。
- **迁移与发布**：一次 forward-only migration；不涉及版本号、发布或部署。
- **回滚**：回滚代码后新增表/列成为未使用（无破坏）；无 Secret/State 数据丢失风险（v1 尚无真实消费者）。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements.md`：AUT-009/ING-012/OPS-009 行补 v1 形态；新增 Phase 2 第十二切片注记。
- `docs/architecture/0001-cosmos-foundation.md` §4.2/§5.2：补充 Connection/Secret/State 的 v1 边界与所有权。
- `docs/adr/0017-connection-secret-state-v1.md`（新）：冻结决策 1–4；同步 ADR 索引；更新 ADR-0001 的 checkpoint/StateStore 注记。
- `docs/spec/`：contracts（Connection/SecretRef/ConnectorState DTO）、application（SecretStore/StateStore 端口）、storage（两新表与写入路径）、interfaces（API 与 Web）。
- `.agents/tasks/{新编号}-connection-state-store/README.md`：由维护者分配编号后创建。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-10 | 起草，状态 `reviewing`，等待裁决决策 1/2/3/4 与实施授权 | Agent |
| 2026-09-10 | **确认**：ConnectionInstance 实体 + `SourceInstance.connectionId` 可空外键（决策 1）、SecretStore 第一版 = 受限权限明文文件（待决定 16，决策 2）、ConnectorStateStore = 命名空间化版本化 KV 新表、不迁移 Checkpoint（决策 3）、Secret 脱敏与所有权边界（决策 4）；并授权创建 worktree `.worktree/connection-state-store` / 分支 `feat/t22-connection-state-store` 实现与测试 | 用户（评审确认） |
