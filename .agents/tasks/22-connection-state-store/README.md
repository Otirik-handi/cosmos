# Task 22：Connection / SecretStore / StateStore v1（Phase 2 第十二切片）

> 编号 22 由 Agent 建议、待维护者确认。

## User Request / Topic

2026-09-10 用户指示「继续平台面开发」，下一块为 Connection/StateStore（AUT-009/AUT-010、ING-012、OPS-009、待决定 16）。Proposal [`connection-state-store-v1`](../../../docs/proposals/connection-state-store-v1.md) 起草后列出四项裁决（ConnectionInstance 可空外键、SecretStore 第一版后端、ConnectorStateStore 不迁 Checkpoint、Secret 脱敏与所有权边界）；用户接受四项默认并授权创建 worktree `.worktree/connection-state-store` / 分支 `feat/t22-connection-state-store`。稳定决定沉淀于 [`ADR-0017`](../../../docs/adr/0017-connection-secret-state-v1.md)，PRD 注记与 ADR 索引已同步。

## Goal

交付平台面三块基础设施，为连接复用、多采集计划、更多平台 Adapter 打底：

```text
ConnectionInstance -> 可复用连接身份 + SourceInstance.connectionId 可空外键（无认证来源 null，Bilibili profile 例外）
SecretStore        -> 第一版受限权限明文文件；公开合同只暴露不透明 SecretRef
ConnectorStateStore-> 命名空间化 + 版本化 KV（version CAS），覆盖 ETag/token/rate，不迁 Checkpoint
脱敏与所有权        -> Secret 不进 config/Job/Event/日志；Secret/State/Blob 互不混写
```

## Scope / Non-goals

Scope：

- Prisma：`ConnectionInstance`、`ConnectorState` 两表 + `SourceInstance.connectionId`（migration `20260910120000_connection_state_store_v1`）。
- contracts：`connectionInstanceSchema`/`createConnectionCommandSchema`/`updateConnectionCommandSchema` + `sourceSnapshotSchema.connectionId` + `updateSourceCommandSchema.connectionId`。
- application：`SecretStorePort`、`ConnectorStateStorePort`（+ `ConnectorStateConflictError`）、`CosmosRepository` 增 Connection CRUD 方法、`ConnectionNotFoundError`。
- storage：`FileSecretStore`、`PrismaConnectorStateStore`、`PrismaCosmosRepository` 的 Connection CRUD 与来源联动。
- API：`GET/POST /connections`、`GET/PATCH /connections/:id`、`POST /connections/:id/removals`。
- transport：`listConnections`/`getConnection`/`createConnection`/`updateConnection`/`deleteConnection`。
- Web：`ConnectionPanel`（列表 + 新建 + 删除）+ 组件实验室登记 + 产品页侧栏「连接」区。

Non-goals（见 Proposal / ADR-0017）：

- CollectionPlan / 多采集计划（AUT-010）；Checkpoint → ConnectorStateStore 迁移。
- 加密-at-rest、OS 凭据库、Secret 轮换/过期 UI、多用户认证。
- 真实认证类 Adapter 的登录生命周期（Bilibili 仍走 OpenCLI profile）。

## 权威合同

- Proposal [`connection-state-store-v1`](../../../docs/proposals/connection-state-store-v1.md)（accepted，2026-09-10，用户确认四项默认）。
- ADR [`0017`](../../../docs/adr/0017-connection-secret-state-v1.md)；ADR [`0001`](../../../docs/adr/0001-durable-workflow-runtime.md)。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) AUT-009/AUT-010/ING-012/OPS-009 与 §7.5 第十二切片注记。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §4.2/§5.2。

## Current State

- 生命周期阶段：实现完成并通过聚焦测试 + 全仓类型检查；文档已同步。已合并 `master` 并推送（commit `9c4cf72`，无 PR，单开发者仓库）；worktree `.worktree/connection-state-store` 与分支 `feat/t22-connection-state-store` 已清理。
- 连贯目标：让连接身份、凭证、非秘密状态第一次有统一归属。
- 可观察验收（≤3 条）：
  1. 创建、列出、读取、更新、删除一个 Connection，且其 `secretRef` 只以不透明字符串出现；
  2. 把一个来源链接到 Connection（`updateSource` 设 `connectionId`），删除 Connection 后来源回退 `connectionId: null` 且不删除来源；
  3. `ConnectorStateStore.putState` 用 version CAS：并发/过期版本写入被拒绝，不静默丢更新。
- 依赖：Task 02（SourceInstance/Checkpoint）、Task 21（Run 控制 v1）。
- 受影响合同：contracts（Connection DTO、Source DTO 加 connectionId）、application（两个新端口 + CosmosRepository 方法）、storage（两新表 + FileSecretStore）、API（Connection 端点）、transport（Connection 客户端）、Web（ConnectionPanel）。
- 验证层级：focused（contracts/storage/application/api/transport/web）→ 全量门禁。

## Decisions and Deviations

- 以 ADR-0017 四条为稳定边界。
- `sourceSnapshotSchema.connectionId` 用 `.optional()`（向后兼容：既有投影缺该字段仍可解析），但仓库 `toSourceSnapshot` 始终写入 `connectionId`（未链接为 null）。
- `SourceInstance.connectionId` 无 DB FK（SQLite `ALTER TABLE` 不能加约束，与既有 `WorkflowRun.sourceInstanceId` 迁移一致）；删除 Connection 的 SetNull 由仓库事务显式 `updateMany` 置空。
- `FileSecretStore` 复用与 `FileBlobStore` 相同的路径逃逸校验，写入 `mode: 0o600`（Windows 尽力而为）。
- Connection 的 Web 面板 v1 用自由文本 `connectorId`（缺省 `generic`），未做 catalog 强校验（真实认证 Adapter 后置）。

## Implementation Walkthrough

1. **migration**：`20260910120000_connection_state_store_v1` 建 `ConnectionInstance`/`ConnectorState` 两表 + `SourceInstance.connectionId`（forward-only、无回填）。
2. **contracts**：Connection DTO/命令 + `sourceSnapshotSchema.connectionId`（optional）+ `updateSourceCommandSchema.connectionId`。
3. **application**：`secret-store.ts`（`SecretStorePort`）、`connector-state-store.ts`（`ConnectorStateStorePort` + `ConnectorStateConflictError`）、`CosmosRepository` 增 Connection CRUD、`ConnectionNotFoundError`。
4. **storage**：`secret-store.ts`（`FileSecretStore`）、`connector-state-store.ts`（`PrismaConnectorStateStore`）、`PrismaCosmosRepository` 的 Connection CRUD + `toConnectionSnapshot` + `toSourceSnapshot`/`updateSource` 联动 connectionId。
5. **API**：五个 Connection 端点 + `connectionError` 漏斗。
6. **transport**：五个 Connection 客户端方法。
7. **Web**：`ConnectionPanel` + `renderConnectionPanelLab` + `registry.tsx` 登记 + page.tsx 侧栏「连接」区。

## Verification / Gate

验证（2026-09-10，实际运行）：

- `bun run typecheck` 全仓通过（含 apps/api、apps/worker、apps/web tsc --noEmit）；`git diff --check` 干净；`bun run docs:check` 402 文件 failures=[]。
- focused 测试：
  - contracts `connection.test.ts` 3/3；
  - storage `secret-store.test.ts` 2/2（put/read/delete + 路径逃逸拒绝）、`connection-state-store.test.ts` 3/3（Connection CRUD + 来源联动 SetNull + State version CAS 冲突）；
  - api `app.controller.connection.test.ts` 3/3；
  - transport-http 17/17（含 Connection 1 例）、web component-lab 27/27（含 ConnectionPanel 登记）。
- storage 串行（`bunx vitest run --no-file-parallelism packages/storage-prisma`）：16 文件 / 123 用例全部通过（含新增 5 例 + 全部既有用例，确认 migration 与 `toSourceSnapshot`/`updateSource` 改动无回归）。
- 未运行：全量 `bun run test`、浏览器产品/组件实验室 E2E、Windows smoke、Docker、发布部署（均记为未运行/既有后置边界）。

## Follow-ups

- CollectionPlan / 多采集计划（AUT-010）与 Checkpoint → 按计划的 ConnectorStateStore 迁移。
- 加密-at-rest / OS 凭据库、Secret 轮换/过期/审计，按 ADR-0017 Revisit Gate 评估。
- 真实认证类 Adapter 接入（Bilibili 从 OpenCLI profile 迁到 Connection + SecretRef）。
- Connection Web 面板的 connectorId 校验（改为 catalog 下拉）与「来源 → 连接」的绑定 UI。
- Phase 2 平台面其余切片：Trigger/SDK、OPS-003/004（按既定排序继续）。
