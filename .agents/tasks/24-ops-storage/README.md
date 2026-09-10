# Task 24：存储占用统计与备份/恢复 v1（Phase 2 第十四切片）

> 编号 24 由 Agent 建议、待维护者确认。

## User Request / Topic

2026-09-10 用户指示「继续平台面开发」，本切片为最后一块 OPS-003/004。Proposal [`ops-storage-v1`](../../../docs/proposals/ops-storage-v1.md) 起草后列出四项裁决（分层统计、备份 = 复制 SQLite、恢复 = 覆盖 + 恢复前保护、清理沿用 media-cleanup）；用户接受并授权创建 worktree `.worktree/ops-storage` / 分支 `feat/t24-ops-storage`。稳定决定沉淀于 [`ADR-0019`](../../../docs/adr/0019-ops-storage-v1.md)，PRD 注记与 ADR 索引已同步。

## Goal

交付存储占用统计与数据库备份/恢复入口：

```text
占用统计   -> GET /storage-stats（DB/Blob/Artifact/Cache/Log/Secret 字节 + 分层 raw/user/rebuildable/cleanable，只读）
备份      -> POST /backups（VACUUM INTO 复制 SQLite 到数据根 backups/，不依赖源码 checkout）+ GET /backups
恢复      -> POST /backups/:id/restores（覆盖 SQLite + 恢复前保护备份，需重启生效）
清理      -> 沿用 media-cleanup 预览确认，不新增第二个清理命令
```

## Scope / Non-goals

Scope：

- contracts：`storageStatsSchema`/`backupSnapshotSchema`。
- application：`CosmosRepository.getStorageStats`/`listBackups`/`createBackup`/`restoreBackup`。
- storage：`fileSize`/`directorySize` 辅助 + 四个方法（`VACUUM INTO` + 文件复制）。
- API：`GET /storage-stats`、`GET/POST /backups`、`POST /backups/:id/restores`。
- transport：四个客户端方法。
- Web：`StoragePanel`（占用 + 备份列表 + 新建/恢复）+ 组件实验室登记 + 侧栏「存储」区。

Non-goals（见 Proposal / ADR-0019）：

- 导出（JSON/归档）、Artifact/Cache 清理（LIB-008 完整形态）。
- 增量/云端备份、备份加密、跨机迁移、Blob 备份。

## 权威合同

- Proposal [`ops-storage-v1`](../../../docs/proposals/ops-storage-v1.md)（accepted，2026-09-10）。
- ADR [`0019`](../../../docs/adr/0019-ops-storage-v1.md)；ADR [`0015`](../../../docs/adr/0015-media-retry-retention-v1.md)、ADR [`0017`](../../../docs/adr/0017-connection-secret-state-v1.md)。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) OPS-003/004 与 §7.5 第十四切片注记。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §5.2。

## Current State

- 生命周期阶段：实现完成并通过聚焦测试 + 全仓类型检查；文档已同步。已合并 `master` 并推送（commit `27f249b`，无 PR，单开发者仓库）；worktree `.worktree/ops-storage` 与分支 `feat/t24-ops-storage` 已清理。
- 连贯目标：用户能查看占用并做数据库备份/恢复。
- 可观察验收（≤3 条）：
  1. `GET /storage-stats` 返回非负字节与分层归类（cleanable = `saved` Asset 字节合计）；
  2. `POST /backups` 生成一个 `backups/backup-*.sqlite` 且 `GET /backups` 列出它；
  3. `POST /backups/:id/restores` 恢复后生成一个 `pre-restore-*.sqlite` 保护备份。
- 依赖：Task 02（Blob/Asset）、Task 20（media-cleanup）、Task 22（StorageRoots）。
- 受影响合同：contracts（storageStats/backup DTO）、application（CosmosRepository 方法）、storage（统计与备份写入）、API（四端点）、transport（客户端）、Web（StoragePanel）。
- 验证层级：focused（contracts/storage/transport/web）→ 全量门禁。

## Decisions and Deviations

- 以 ADR-0019 四条为稳定边界。
- `directorySize` 用迭代式目录遍历（BFS），`readdir` 失败（目录不存在）按 0 处理。
- `cleanable` 用 `asset.aggregate({ _sum: byteSize, where: status = "saved" })` 估算；这是「已存媒体字节」的上界，非精确保留期到期量。
- 备份 id = 文件名（时间戳）；`birthtime` 作为 createdAt。

## Implementation Walkthrough

1. **contracts**：`storageStatsSchema`（分层 categories）+ `backupSnapshotSchema`。
2. **application**：`CosmosRepository` 增四个方法。
3. **storage**：`fileSize`/`directorySize` 辅助；`getStorageStats`（各根遍历 + Asset 聚合）、`createBackup`（`VACUUM INTO`）、`listBackups`（读 `backups/`）、`restoreBackup`（`VACUUM INTO` 保护备份 + `copyFile` 覆盖）。
4. **API**：四个端点（restore 不存在映射 404）。
5. **transport**：四个客户端方法。
6. **Web**：`StoragePanel` + `renderStoragePanelLab` + `registry.tsx` 登记 + page.tsx 侧栏「存储」区。

## Verification / Gate

验证（2026-09-10，实际运行）：

- `bun run typecheck` 全仓通过（含 apps/api、apps/worker、apps/web tsc --noEmit）。
- focused 测试：storage `storage-ops.test.ts` 2/2（占用统计非负 + 分层；创建/列出/恢复备份 + 恢复前保护）、transport-http 17/17、web component-lab 27/27（含 StoragePanel 登记）。
- 未运行：全量 `bun run test`、浏览器产品/组件实验室 E2E、Windows smoke、Docker、发布部署（均记为未运行/既有后置边界）。

## Follow-ups

- 导出（JSON/归档）、Artifact/Cache 清理（LIB-008 完整形态）。
- Blob 备份、增量/云端备份、备份加密，按 ADR-0019 Revisit Gate 评估。
- 恢复后自动重连（当前需手动重启 API/Worker）。

至此 Phase 2 平台面四块（RUN-004、Connection/StateStore、Trigger/SDK、OPS-003/004）全部落地。
