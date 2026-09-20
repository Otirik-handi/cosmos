# Task 24：存储占用统计与备份/恢复 v1（Phase 2 第十四切片）

> 编号 24 由 Agent 建议、待维护者确认。

## User Request / Topic

2026-09-10 用户指示「继续平台面开发」，本切片为最后一块 OPS-003/004。Proposal [`ops-storage-v1`](../../../docs/proposals/ops-storage-v1.md) 起草后列出四项裁决（分层统计、备份 = 复制 SQLite、恢复 = 覆盖 + 恢复前保护、清理沿用 media-cleanup）；用户接受并授权创建 worktree `.worktree/ops-storage` / 分支 `feat/t24-ops-storage`。稳定决定沉淀于 [`ADR-0019`](../../../docs/adr/0019-ops-storage-v1.md)，PRD 注记与 ADR 索引已同步。

**追加切片（2026-09-20，用户数据导出）**：用户在 Phase 2 缺口复核后指示「完成最高优先级项」，即 LIB-008 与 OPS-004 共同缺的「导出」。Proposal [`user-data-export-v1`](../../../docs/proposals/user-data-export-v1.md) 起草后由用户裁决两项——导出范围 = 七类用户真相对象 + 被引用目标摘要；交付形态 = 单条只读下载路由（不落盘）——并授权创建 worktree `.worktree/user-data-export` / 分支 `feat/t24-user-data-export`。按[准入决策表](../../../docs/standards/repository-workflow.md#准入决策表)，用户（维护者）的直接请求替代公开 Issue 的记录与实现授权；本条即该请求的记录。

## Goal

交付存储占用统计与数据库备份/恢复入口：

```text
占用统计   -> GET /storage-stats（DB/Blob/Artifact/Cache/Log/Secret 字节 + 分层 raw/user/rebuildable/cleanable，只读）
备份      -> POST /backups（VACUUM INTO 复制 SQLite 到数据根 backups/，不依赖源码 checkout）+ GET /backups
恢复      -> POST /backups/:id/restores（覆盖 SQLite + 恢复前保护备份，需重启生效）
清理      -> 沿用 media-cleanup 预览确认，不新增第二个清理命令
导出      -> GET /exports/user-data（七类用户真相对象 + 被引用目标摘要，JSON 附件，只读不落盘）[追加切片]
```

## Scope / Non-goals

Scope：

- contracts：`storageStatsSchema`/`backupSnapshotSchema`；追加切片新增 `userDataExportSchema`/`userDataExportTargetSchema`。
- application：`CosmosRepository.getStorageStats`/`listBackups`/`createBackup`/`restoreBackup`；追加切片新增 `exportUserData`。
- storage：`fileSize`/`directorySize` 辅助 + 四个方法（`VACUUM INTO` + 文件复制）；追加切片新增 `PrismaCosmosRepositoryUserDataExport`（继承链末端，复用各分区公开投影 + 目标摘要解析）。
- API：`GET /storage-stats`、`GET/POST /backups`、`POST /backups/:id/restores`；追加切片新增 `GET /exports/user-data`。
- transport：四个客户端方法；追加切片新增 `exportUserData()`。
- Web：`StoragePanel`（占用 + 备份列表 + 新建/恢复）+ 组件实验室登记 + 侧栏「存储」区；追加切片在同一面板加「导出用户数据」下载按钮。

Non-goals（见 Proposal / ADR-0019）：

- Artifact/Cache 清理（LIB-008 完整形态的剩余半边）。
- 导出落盘产物、导出内容库、导入/恢复导出件。
- 增量/云端备份、备份加密、跨机迁移、Blob 备份。

## 权威合同

- Proposal [`ops-storage-v1`](../../../docs/proposals/ops-storage-v1.md)（accepted，2026-09-10）；追加切片 Proposal [`user-data-export-v1`](../../../docs/proposals/user-data-export-v1.md)（accepted，2026-09-20）。
- ADR [`0019`](../../../docs/adr/0019-ops-storage-v1.md)（含 2026-09-20 补的决策 5：导出）；ADR [`0015`](../../../docs/adr/0015-media-retry-retention-v1.md)、ADR [`0017`](../../../docs/adr/0017-connection-secret-state-v1.md)。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) OPS-003/004 与 §7.5 第十四切片注记、§7.10 OPS-004 导出注记；LIB-008 导出注记见 [`part-07-1.md`](../../../docs/requirements/0002-product-requirements/part-07-1.md)。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §5.2。

## Current State

- 生命周期阶段：**活跃（追加切片 2：用户数据导出）**。切片 1（占用统计与备份/恢复）已实现、验证并合并 `master`（commit `27f249b`，无 PR，单开发者仓库）；其 worktree `.worktree/ops-storage` 与分支 `feat/t24-ops-storage` 已清理。切片 2 在 worktree `.worktree/user-data-export` / 分支 `feat/t24-user-data-export` 上实现，`--no-ff` 合入 `master`（merge `d7af0cc`）并推送（CI run `35515892820` 五个 job 全绿）；worktree 与分支（含远端）已清理。
- 连贯目标：用户能查看占用、做数据库备份/恢复，并把自己创作的数据带走。
- 可观察验收（切片 1，≤3 条）：
  1. `GET /storage-stats` 返回非负字节与分层归类（cleanable = `saved` Asset 字节合计）；
  2. `POST /backups` 生成一个 `backups/backup-*.sqlite` 且 `GET /backups` 列出它；
  3. `POST /backups/:id/restores` 恢复后生成一个 `pre-restore-*.sqlite` 保护备份。
- 可观察验收（切片 2，≤3 条）：
  1. `GET /exports/user-data` 返回 `Content-Disposition: attachment` 的 JSON 附件，body 通过 `userDataExportSchema`，`counts` 与各分区长度一致；
  2. 导出件含七类用户真相对象与被引用目标摘要（标题、条目 `webUrl`），且整份 JSON 不含 `secretRef`/`storageKey`/连接名/来源名；
  3. Web 存储面板「导出用户数据」触发浏览器下载，文件名 `cosmos-user-data-<exportedAt>.json`。
- 依赖：Task 02（Blob/Asset）、Task 20（media-cleanup）、Task 22（StorageRoots）、Task 13/14（用户真相对象与看板树）。
- 受影响合同：contracts（storageStats/backup DTO + userDataExport DTO）、application（CosmosRepository 方法）、storage（统计与备份写入 + 导出读取）、API（五端点）、transport（客户端）、Web（StoragePanel）。
- 验证层级：focused（contracts/storage/API/transport）→ 全量门禁 → 浏览器产品 E2E。

## Decisions and Deviations

- 以 ADR-0019 四条为稳定边界；追加切片以 ADR-0019 决策 5（导出 = 只读 JSON 下载）为稳定边界。
- `directorySize` 用迭代式目录遍历（BFS），`readdir` 失败（目录不存在）按 0 处理。
- `cleanable` 用 `asset.aggregate({ _sum: byteSize, where: status = "saved" })` 估算；这是「已存媒体字节」的上界，非精确保留期到期量。
- 备份 id = 文件名（时间戳）；`birthtime` 作为 createdAt。
- 导出复用各对象的公开读投影（`labelDetail`/`collectionDetail`/`boardDetail`/`toAnnotation` 等），不新建导出专用对象定义——这样某分区加字段时导出不会漏字段。
- 导出**不加事务**：SQLite 单写者下是尽力而为的一致快照，`exportedAt` 是它的时间标记（与 `storage-stats` 同一取舍）。
- 悬空引用（收藏/标签指向已删除的 Story）在导出里保留引用、`title` 为 null，不因悬空失败。
- 文件名把 `exportedAt` 里的 `:` 换成 `-`：`:` 在 Windows 上是非法文件名字符。

## Implementation Walkthrough

切片 1（2026-09-10）：

1. **contracts**：`storageStatsSchema`（分层 categories）+ `backupSnapshotSchema`。
2. **application**：`CosmosRepository` 增四个方法。
3. **storage**：`fileSize`/`directorySize` 辅助；`getStorageStats`（各根遍历 + Asset 聚合）、`createBackup`（`VACUUM INTO`）、`listBackups`（读 `backups/`）、`restoreBackup`（`VACUUM INTO` 保护备份 + `copyFile` 覆盖）。
4. **API**：四个端点（restore 不存在映射 404）。
5. **transport**：四个客户端方法。
6. **Web**：`StoragePanel` + `renderStoragePanelLab` + `registry.tsx` 登记 + page.tsx 侧栏「存储」区。

切片 2（2026-09-20，用户数据导出）：

1. **contracts**：`userDataExportSchema`（`schemaVersion`/`exportedAt`/`counts`/`data`，分区引用既有 schema）+ `userDataExportTargetSchema`；`entry-surface.txt` 按仓库脚本显式重生成（新增 2 个值导出 + 2 个类型导出，diff 只有这四行）。
2. **application**：`CosmosRepository.exportUserData()`。
3. **storage**：新增 `repository/user-data-export.ts` 的 `PrismaCosmosRepositoryUserDataExport`，接在继承链末端；聚合七类对象（`listLabels`/`listCollections`/`listFavorites`/`listSavedViews`/`listBoards` + 逐项 `label`/`collection`/`getBoard` 详情 + 全量 `annotation` 查询 + `listSpotlightPlacements({})`），并解析被引用目标的标题与条目链接；分区与目标都按 id 排序，输出稳定可 diff。
4. **API**：`GET /exports/user-data` 用 `StreamableFile` 返回附件（`disposition` 带文件名），路由快照 `route-snapshot-app.controller.txt` 同批登记（并顺手修正该文件里过期的路由计数 117 → 120）。
5. **transport**：`exportUserData()`。
6. **Web**：`StoragePanel` 加「导出用户数据」按钮，把返回的导出件序列化为文件交给浏览器下载，并显示各类条数；组件实验室 fixture 同步补 `exportUserData` 桩。
7. **测试**：storage `user-data-export.test.ts`（3 例：完整导出 + 目标摘要；排除 Secret/连接/来源/内部键；悬空引用与确定性）、API `app.controller.export.test.ts`（附件头 + 文件名 + body 校验）、transport `client-platform.test.ts` 追加 1 例、浏览器 `e2e/browser/user-data-export.spec.ts`（点按钮 → 下载文件 → 内容断言，并在结束时删掉用例创建的标签，避免污染共享栈）。

## Verification / Gate

切片 1 验证（2026-09-10，实际运行）：

- `bun run typecheck` 全仓通过（含 apps/api、apps/worker、apps/web tsc --noEmit）。
- focused 测试：storage `storage-ops.test.ts` 2/2（占用统计非负 + 分层；创建/列出/恢复备份 + 恢复前保护）、transport-http 17/17、web component-lab 27/27（含 StoragePanel 登记）。
- 未运行：全量 `bun run test`、浏览器产品/组件实验室 E2E、Windows smoke、Docker、发布部署（均记为未运行/既有后置边界）。

切片 2 验证（2026-09-20，worktree `.worktree/user-data-export`，实际运行）：

- `bun run typecheck`：全仓 0（packages 与 apps 全链）。
- `bun run test`：**108 文件 / 637 用例全绿**（新增 storage 3 例、API 1 例、transport 1 例）。
- 首次全量跑出 3 处失败，全部在 `packages/storage-prisma/src/prisma-cli.test.ts`：原因是当时为绕开沙箱把 `TEMP` 指到了 worktree 内，`os.tmpdir()` 因此落在真实仓库里，解析器向上找到了真实 Prisma CLI。去掉 `TEMP` 覆盖后该文件 7/7 通过，全量复跑全绿——不是代码问题。
- 路由快照守卫 `app.controller.route-table.test.ts` 3/3（含 120 条路由的方法+路径集合与 handler 名比对）。
- `entry-contract.test.ts`（contracts/storage-prisma/transport-http）全绿：contracts 的导出面变化是显式重生成的结果。
- `bun run build` 通过（`test:browser` 的前置）；浏览器产品套件 **25 passed**（24 条既有 + 新增 1 条），组件实验室套件 **14 passed**——均无回归。
- `bun run test:e2e`（Node 进程 E2E）5 文件 / 6 用例全绿；`bun run test:property` 3 文件 / 4 用例全绿。
- 合并后复核（主工作区，merge `d7af0cc`）：`bun run docs:check` 708 文件 0 失败；三个受影响测试文件 7/7 通过。
- 远端 CI（fork `Otirik-handi/cosmos`，run `35515892820`）：Quality、Docs、Browser E2E、Node process E2E、Windows Node smoke **五个 job 全绿**。
- 未运行：Docker/Compose、发布部署（既有后置边界）。

## Follow-ups

- Artifact/Cache 清理（LIB-008 完整形态的剩余半边），按 ADR-0019 Revisit Gate 评估。
- Blob 备份、增量/云端备份、备份加密，按 ADR-0019 Revisit Gate 评估。
- 恢复后自动重连（当前需手动重启 API/Worker）。
- 导出件若要包含内容库、落盘产物或支持导入，先按 ADR-0019 Revisit Gate 重评（需要先定正文/媒体的脱敏与体积预算）。

至此 Phase 2 平台面四块（RUN-004、Connection/StateStore、Trigger/SDK、OPS-003/004）全部落地；追加切片补齐了 OPS-004 与 LIB-008 的「导出」。
