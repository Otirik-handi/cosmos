# Proposal：OPS-003/004 存储占用统计与备份/恢复/清理 v1（平台面最后一块）

> 状态：accepted
>
> 日期：2026-09-10
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) OPS-003、OPS-004（关联 OPS-009、LIB-008）
>
> 关联设计：架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §5.2；ADR [`0005`](../adr/0005-media-boundary-v1.md)、ADR [`0015`](../adr/0015-media-retry-retention-v1.md)（media-cleanup）、ADR [`0017`](../adr/0017-connection-secret-state-v1.md)（所有权边界）
>
> 关联既有切片：Task 02（Blob/Asset）、Task 20（media-cleanup）、Task 22（StorageRoots/所有权）

## 1. 问题

OPS-003 要求「用户可以查看 Blob、Artifact、缓存和数据库占用」，并区分「原始数据、用户数据、可重建缓存、可清理旧产物」。OPS-004 要求「系统提供明确的备份、恢复、导出和清理入口」，且「清理前列出影响范围；备份不依赖源码 checkout」。当前实现：

- 存储根 `resolveStorageRoots`（`packages/storage-prisma/src/index.ts:141`）已预留 `blobRoot`/`artifactRoot`/`cacheRoot`/`logRoot`/`secretRoot` 与 `databasePath`，但**没有**任何占用统计端点。
- `FileBlobStore` 是内容寻址去重（`packages/blob-store/src/index.ts`），`Asset.byteSize` 记录已存图片字节；`media-cleanup`（Task 20）已有「预览 → 确认删除」的保留期清理，但只覆盖媒体 Blob。
- 无备份、恢复、导出端点；数据库是单个 SQLite 文件（`cosmos.sqlite`）。

后果：用户无法知道数据根占用、也无法在数据根损坏前做备份；「清理前预览」目前只覆盖媒体，没有统一的占用/清理入口。

## 2. 目标与非目标

### 目标（v1）

1. **占用统计**（OPS-003）：`GET /storage-stats` 返回数据库、Blob、Artifact、Cache、Log 的字节占用，并按「原始数据 / 用户数据 / 可重建缓存 / 可清理旧产物」分层归类。
2. **备份 / 恢复**（OPS-004）：`POST /backups`（把 SQLite 数据库复制到数据根内的 `backups/`，命名带时间戳）、`GET /backups`（列出备份）、`POST /backups/:id/restores`（从备份恢复 SQLite）。备份只复制数据库文件，不依赖源码 checkout。

### 非目标（本切片明确后置）

- 导出（JSON/归档）与 Artifact 清理（LIB-008 完整形态）。
- 增量/云端备份、备份加密、跨机迁移。
- Cache/Artifact 的自动清理（v1 只做占用统计 + 媒体清理已有 + 数据库备份/恢复）。

## 3. 当前行为与证据

- 存储根布局见 `resolveStorageRoots`（`packages/storage-prisma/src/index.ts:141-158`）：`dataRoot/cosmos.sqlite` + `blobs/` + `artifacts/` + `cache/` + `logs/` + `secrets/`。
- `FileBlobStore`（`packages/blob-store/src/index.ts`）内容寻址 `sha256/<2>/<62>`；`Asset.byteSize` 是图片字节；`BlobWorkflowValueStore` 复用同一 Blob Root。
- `media-cleanup`（Task 20 / ADR-0015）已实现「dryRun 预览 → 确认删除」+ 引用检查 + Asset 回退，但只处理媒体保留期。
- 无 `GET /storage-stats`、无 backup/restore/export 端点。

## 4. 方案

### 决策 1：`GET /storage-stats` 分层统计（OPS-003）

新增 `StorageStatsService` + `GET /storage-stats`：遍历各存储根统计字节数，返回：

```text
databaseBytes（SQLite 文件大小）
blobBytes / blobFileCount（内容寻址，含 workflow journal value）
artifactBytes / cacheBytes / logBytes / secretBytes
分层归类：rawData（DB + Blob）、userData（Label/Collection/Annotation 等，计入 DB）、rebuildable（Cache + workflow journal）、cleanable（可按保留期清理的媒体 Blob 估算）
```

只读、不删除；`secretBytes` 只报字节数、不列内容。

**备选**：只报总数不分类。拒绝：OPS-003 明确要求「原始数据、用户数据、可重建缓存和可清理旧产物分别统计」。

### 决策 2：备份 = 复制 SQLite 到数据根内 `backups/`（OPS-004）

`POST /backups`（可带 `idempotency-key`）：用 SQLite `VACUUM INTO` 或文件复制，把当前数据库生成到 `dataRoot/backups/<timestamp>.sqlite`（不依赖源码 checkout）。`GET /backups` 列出备份（文件名 + 字节 + 时间）。备份只包含数据库；Blob/媒体不随备份（记录为已知限制，导出后置）。

**备选**：备份整个数据根（含 Blob）。拒绝（v1）：Blob 是内容寻址可重建/可重新下载，且会显著放大备份体积；先做数据库备份，Blob 备份后置。

### 决策 3：恢复 = 从备份文件替换当前 SQLite

`POST /backups/:id/restores`：停止写入后把备份 SQLite 覆盖为当前数据库文件（先做一次「恢复前备份」保护当前状态），恢复后要求 Worker/API 重连。恢复是高风险操作，端点返回确认前的「影响说明」。

**备选**：不提供恢复端点，只提供备份。拒绝：OPS-004 明确要求「恢复」入口。

### 决策 4：清理沿用「预览 → 确认」模式（对齐 media-cleanup）

占用统计只读；清理入口复用 Task 20 的 `media-cleanup`（保留期清理，dryRun 预览），本切片不新增第二个清理命令。Artifact/Cache 清理后置（LIB-008 完整形态）。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 占用统计分层（raw/user/rebuildable/cleanable） | 采纳（决策 1） |
| 只报总数 | 拒绝（OPS-003 要求分层） |
| 备份 = 复制 SQLite（不依赖源码） | 采纳（决策 2） |
| 备份整个数据根（含 Blob） | 拒绝（v1，Blob 可重建/重新下载） |
| 恢复 = 从备份覆盖 SQLite + 恢复前保护 | 采纳（决策 3） |
| 不提供恢复端点 | 拒绝（OPS-004 要求恢复） |
| 清理沿用 media-cleanup 预览确认 | 采纳（决策 4） |
| 新增第二个清理命令 | 拒绝（v1） |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：无 Prisma schema 变更、无 migration；新增 `dataRoot/backups/` 目录（备份产物）。
- **接口**：新增 `GET /storage-stats`、`POST /backups`、`GET /backups`、`POST /backups/:id/restores`。
- **安全**：统计只读；备份只复制本机数据根内 SQLite；恢复覆盖当前数据库（先做保护性备份）；Secret 只报字节数不列内容。
- **迁移与发布**：无 migration；不涉及版本号/发布/部署。
- **回滚**：回滚代码后新端点消失；备份文件留在 `backups/` 无害。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements.md`：OPS-003/004 行补 v1 形态；新增 Phase 2 第十四切片注记。
- `docs/architecture/0001-cosmos-foundation.md` §5.2：补占用统计与备份/恢复/清理边界。
- `docs/adr/0019-ops-storage-v1.md`（新）：冻结决策 1–4；同步 ADR 索引。
- `docs/spec/`：contracts（storageStats/backup DTO）、application（StorageStats/Backup 服务）、storage（统计与备份写入路径）、interfaces（API）。
- `.agents/tasks/{新编号}-ops-storage/README.md`：由维护者分配编号后创建。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-10 | 起草，状态 `reviewing`，等待裁决决策 1/2/3/4 与实施授权 | Agent |
| 2026-09-10 | **确认**：占用统计分层（raw/user/rebuildable/cleanable，决策 1）、备份 = 复制 SQLite 到数据根 `backups/`（决策 2）、恢复 = 从备份覆盖 SQLite + 恢复前保护（决策 3）、清理沿用 media-cleanup 预览确认（决策 4）；并授权创建 worktree `.worktree/ops-storage` / 分支 `feat/t24-ops-storage` 实现与测试 | 用户（评审确认） |
