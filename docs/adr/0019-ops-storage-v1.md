# ADR-0019：存储占用统计与备份/恢复 v1（OPS-003/004）

> 状态：Accepted design contract
>
> 日期：2026-09-10
>
> 关联：[`ops-storage-v1 Proposal`](../proposals/ops-storage-v1.md)、[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §5.2、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) OPS-003/004、ADR [`0015`](0015-media-retry-retention-v1.md)、ADR [`0017`](0017-connection-secret-state-v1.md)

## Context

OPS-003 要求用户能查看 Blob/Artifact/缓存/数据库占用并分层归类；OPS-004 要求明确的备份/恢复/导出/清理入口，清理前预览、备份不依赖源码 checkout。存储根已预留各目录，media-cleanup 已实现保留期清理，但无占用统计、无备份/恢复端点。2026-09-10 用户裁决四项默认建议（分层统计、备份 = 复制 SQLite、恢复 = 覆盖 + 恢复前保护、清理沿用 media-cleanup），本文沉淀这些稳定决定。

## Decision

### 1. `GET /storage-stats` 分层统计（OPS-003）

新增 `getStorageStats()` + `GET /storage-stats`：遍历各存储根返回 `databaseBytes`/`blobBytes`/`blobFileCount`/`artifactBytes`/`cacheBytes`/`logBytes`/`secretBytes`，并按「原始数据（Blob + DB）/ 用户数据（DB）/ 可重建缓存（Cache + Log）/ 可清理旧产物（`saved` Asset 字节合计）」分层。只读、不删除；`secretBytes` 只报字节数不列内容。

### 2. 备份 = 复制 SQLite 到数据根 `backups/`（OPS-004）

`POST /backups` 用 SQLite `VACUUM INTO` 把当前数据库生成到 `dataRoot/backups/backup-<timestamp>.sqlite`（一致快照、不依赖源码 checkout）；`GET /backups` 列出备份（name/byteSize/createdAt）。v1 只备份数据库，Blob/媒体不随备份（可重建/可重新下载，记录为已知限制）。

### 3. 恢复 = 覆盖当前 SQLite + 恢复前保护

`POST /backups/:id/restores`：先用 `VACUUM INTO` 做一次 `pre-restore-<timestamp>.sqlite` 保护备份，再把所选备份文件复制覆盖当前数据库。恢复后需重启 API/Worker 使新连接生效（高风险操作，端点返回影响说明）。

### 4. 清理沿用 media-cleanup「预览 → 确认」模式

占用统计只读；清理入口复用 Task 20 的 `media-cleanup`（保留期清理，dryRun 预览），本切片不新增第二个清理命令。Artifact/Cache 清理与导出后置（LIB-008 完整形态）。

## Consequences

### Positive

- 用户第一次能看到数据根占用并分层，能判断「什么可安全清理」。
- 数据库有了本地备份/恢复入口，数据根损坏前可备份、误操作后可恢复。
- 只读统计 + 一致快照备份，不引入复杂的一致性协议。

### Costs and risks

- `VACUUM INTO` 依赖 SQLite；恢复是文件级覆盖，绕过了 Prisma 连接，需重启才生效（高风险，端点返回影响说明）。
- 备份只含数据库、不含 Blob；Blob 损坏无法从备份恢复（可重新下载/可重建）。
- 恢复覆盖当前数据库，若备份本身损坏会导致数据丢失（已用「恢复前保护」降低风险）。

## Alternatives considered

### 备份整个数据根（含 Blob）

拒绝（v1）。Blob 是内容寻址可重建/可重新下载，且会显著放大备份体积；先做数据库备份。

### 只报总数不分类

拒绝。OPS-003 明确要求「原始数据、用户数据、可重建缓存和可清理旧产物分别统计」。

### 不提供恢复端点

拒绝。OPS-004 明确要求「恢复」入口。

### 新增第二个清理命令

拒绝（v1）。media-cleanup 已实现「预览 → 确认 + 引用检查」，复用即可。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 引入导出（JSON/归档）或 Artifact/Cache 清理（LIB-008 完整形态）；
- 引入增量/云端备份、备份加密、跨机迁移或 Blob 备份；
- 数据库改用 WAL 模式或引入多进程并发写，`VACUUM INTO`/文件复制的一致性假设需重评。
