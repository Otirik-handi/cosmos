# Proposal：LIB-008/OPS-004 用户数据导出 v1

> 状态：accepted
>
> 日期：2026-09-20
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) LIB-008（`part-07-1.md` §7.4）、OPS-004（`part-07-3.md` §7.10）
>
> 关联设计：ADR [`0009`](../adr/0009-user-organization-v1.md)（用户真相对象 = Label/Annotation/Collection/Saved View）、ADR [`0010`](../adr/0010-board-section-block-v1.md)（Board/Section/Block/Spotlight）、ADR [`0019`](../adr/0019-ops-storage-v1.md)（备份/恢复，Revisit Gate 第一条即「引入导出」）
>
> 关联既有切片：Task 13（用户组织 v1）、Task 14（可配置看板 v1）、Task 24（存储占用与备份/恢复 v1）

## 1. 问题

LIB-008 要求「用户可以**查看、导出和删除**自己拥有的持久数据」，OPS-004 要求「系统提供明确的备份、恢复、**导出**和清理入口」。当前实现只覆盖了其中的查看与删除：

- 查看/删除：Label、Collection、Favorite、Annotation、Saved View、Board/Section/Block、Spotlight 均有读路由与单对象删除路由（`apps/api/src/app.controller/organization.ts`）。
- 备份/恢复：`POST/GET /backups`、`POST /backups/:id/restores`（ADR-0019 / Task 24）。
- **导出：不存在**。全仓没有 export 路由，也没有任何把用户真相对象聚合成一份可带走文件的实现；Task 24 的 Non-goals 与 ADR-0019 §4 都把它记为后置，ADR-0019 的 Revisit Gate 第一条正是「引入导出（JSON/归档）」。

后果：用户无法把自己的标签、收藏夹、批注、查询视图与看板配置带出 Cosmos；需求表里 LIB-008 与 OPS-004 两行因此仍未闭合。

## 2. 目标与非目标

### 目标（v1）

1. 提供一条导出入口，产出一份**人可读、可长期保存**的 JSON 文件，包含用户自己创作与配置的持久数据。
2. Web 存储面板提供下载入口（用户不必使用命令行）。
3. 明确写出导出**不含**什么，避免被读成「可完整迁移」。

### 非目标（明确后置）

- 导入/恢复导出文件（需求表没有对应行；恢复由 `POST /backups/:id/restores` 承担）。
- 导出采集内容库与派生投影（Observation/Entry/Story/Topic/Entity 及 revisions、Asset 字节）。
- 导出运行与事件记录（Run/Job/WorkflowRun/DomainEvent）。
- 导出 Secret 字节、SecretRef 以外的凭据、ConnectorState、日志。
- Artifact/Cache 清理（LIB-008 完整形态的另一半，仍按 ADR-0019 后置）。

## 3. 当前行为与证据

- 用户真相对象的持久化：`Label`/`LabelAssignment`、`Collection`/`CollectionItem`、`Favorite`、`Annotation`、`SavedView`、`Board`/`BoardSection`/`BoardBlock`、`SpotlightPlacement`（`packages/storage-prisma/prisma/schema.prisma` 第 564–713 行）。
- 读投影已存在且是公开合同：`labelListSchema`/`collectionListSchema`/`favoriteListSchema`/`annotationListSchema`/`savedViewListSchema`（`packages/contracts/src/user-organization.ts`）、`boardListSchema`/`boardDetailSchema`/`spotlightPlacementListSchema`（`packages/contracts/src/board.ts`）。导出应复用这些投影，不新建第二套对象定义。
- 枚举能力：`listLabels`/`listCollections`/`listFavorites`/`listSavedViews`/`listSpotlightPlacements({})` 可全量枚举；`listAnnotations` 目前**要求** `targetType`+`targetId`（`packages/storage-prisma/src/repository/annotations.ts:115`），导出需要新增一条「全量批注」读取。
- 附件响应的既有形态：`GET /assets/:assetId` 用 `StreamableFile`（`apps/api/src/app.controller/content.ts:645`）；Nest 11 的 `StreamableFile` 支持 `disposition`（`Content-Disposition`）。
- 敏感面：`ConnectionInstance.secretRef` 是不透明引用，凭据字节在 SecretStore（`secrets/`）；`Asset.storageKey` 是内部 Blob key。导出白名单必须排除这些字段与整张表。

## 4. 方案

### 决策 1：导出范围 = 用户真相对象（待裁决：三个候选）

| 候选 | 内容 | 取舍 |
| --- | --- | --- |
| **1（推荐）** | 七类用户真相对象 + **被引用目标的可读摘要**（Story/Topic 标题、Entry 标题与 `webUrl`），不含正文与媒体 | 导出文件自解释：看到一条收藏能知道收藏的是哪条内容；体积小；不复制内容库 |
| 2 | 只导出七类对象原始记录（引用目标只有 id） | 最小实现；但离开 Cosmos 后 id 不可读，导出件难以理解 |
| 3 | 用户真相 + 完整内容库（Entry/Story/Topic/Entity 与 revisions、正文） | 接近「可移植全量导出」；但体积大、与 SQLite 备份重叠，且要为正文/媒体再定一套脱敏与体积预算 |

理由（推荐 1）：ADR-0009 已把「用户真相 + 人工操作」定义为这七类对象；采集内容可由来源重新获取、派生投影可重建，整库副本已由 `POST /backups` 承担。加一层目标摘要即可让导出件脱离 Cosmos 仍可读，成本很低。

### 决策 2：交付形态（待裁决：两个候选）

| 候选 | 形态 | 取舍 |
| --- | --- | --- |
| **A（推荐）** | 单条只读路由 `GET /exports/user-data` 直接返回 JSON 附件（`Content-Disposition: attachment`），Web 存储面板加「导出用户数据」下载按钮 | 无新数据根目录、无保留/清理负担；入口明确；符合「只读 Query」边界 |
| B | 落盘 `dataRoot/exports/user-data-<timestamp>.json` + `POST /exports` 创建 + `GET /exports` 列表 + `GET /exports/:id` 下载（镜像 backups 模式） | 产物可被脚本/运维直接取用；代价是多一个数据根目录、多两条路由，且需要回答「导出文件何时清理」 |

理由（推荐 A）：OPS-004 要的是「明确的导出入口」，不是「导出文件管理」；备份已经提供落盘产物，导出再落盘会与 `backups/` 形成两个相似但语义不同的目录。

### 决策 3：导出件格式（不待裁决，随方案冻结）

```json
{
  "schemaVersion": 1,
  "exportedAt": "<ISO-8601>",
  "counts": { "labels": 0, "collections": 0, "favorites": 0, "annotations": 0, "savedViews": 0, "boards": 0, "spotlightPlacements": 0 },
  "data": {
    "labels": [], "collections": [], "favorites": [], "annotations": [],
    "savedViews": [], "boards": [], "spotlightPlacements": [],
    "targets": []
  }
}
```

- 字段复用既有公开投影（第 3 节列出的 schema），`boards` 用 `boardDetailSchema`（含 Section/Block 树）。
- 记录按 id 升序，输出稳定可 diff。
- `schemaVersion` 是唯一版本位；后续扩展（决策 1 的候选 3、配置导出）通过升版本表达，不改已有字段含义。
- `targets` 是决策 1 的摘要清单：`{ targetType, targetId, title, webUrl }`，只读，不写入。

### 决策 4：安全边界（不待裁决）

- 白名单：只读第 3 节列出的七类表，逐字段投影；不 `select *`。
- 绝不导出：Secret 字节、`ConnectionInstance.secretRef`、`SourceInstance`/`TriggerBinding`/`ConnectorState`、`Asset.storageKey`、日志、lease/token 类字段。
- 路由只读、无副作用、不需要幂等键；不做「导出即删除」之类组合动作。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 导出范围 = 用户真相 + 目标摘要 | 待裁决（推荐） |
| 导出范围 = 仅 id | 待裁决 |
| 导出范围 = 含完整内容库 | 待裁决（v1 倾向拒绝：与备份重叠、需另定脱敏与体积预算） |
| 交付 = 单条下载路由 | 待裁决（推荐） |
| 交付 = 落盘 + 列表 + 下载 | 待裁决 |
| 复用既有公开投影而非新建导出 DTO | 采纳（避免第二套对象定义） |
| 导出 Secret / 连接配置 | 拒绝（安全边界） |
| 导入导出文件 | 拒绝（v1 无需求行；恢复走 backups） |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：无 Prisma schema 变更、无 migration；候选 A 不新增数据根目录，候选 B 新增 `dataRoot/exports/`。
- **接口**：候选 A 新增 `GET /exports/user-data`；候选 B 新增 `POST /exports`、`GET /exports`、`GET /exports/:id`。新增 contracts 导出信封 schema。路由快照（`.agents/tasks/governance/G03-api-controller/route-snapshot-app.controller.txt`）需同批登记。
- **安全**：只读；白名单投影；不触碰 Secret 与内部 key。导出文件由用户自行保管，Cosmos 不代管。
- **迁移与发布**：无 migration；不涉及版本号、发布、部署。
- **回滚**：回滚代码后新路由消失；候选 B 已生成的导出文件留在 `exports/` 无害。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements/part-07-1.md`（LIB-008）与 `part-07-3.md`（OPS-004）：补 v1 形态注记；勘误台账 `ERRATA.md` 登记两行从「未闭合/部分交付」转为已交付。
- `docs/adr/0019-ops-storage-v1.md`：Revisit Gate 第一条被触发，需按导出形态更新（新增决策或在 ADR-0019 内补一条导出决策）。
- `docs/spec/`：`contracts/0001-public-contracts.md`（导出信封）、`storage/0001-prisma-repository.md`（导出读取）、`interfaces/0002-product-api-http.md`（新路由）、`interfaces/0004-http-client.md` 与 `0005-web-client.md`（客户端与存储面板）。
- `.agents/tasks/24-ops-storage/`（复用，理由：导出是 OPS-004 缺的那一半，且 Task 24 已拥有 `storage-stats`/`backups` 的合同与文件边界）或由维护者另指定 Task。
- `PROJECT-STATUS.md`：Phase 2 未闭合行减少后的状态同步。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-20 | 起草，状态 `reviewing`；待裁决决策 1（导出范围）、决策 2（交付形态），以及 Task 归属与 worktree 授权 | Agent |
| 2026-09-20 | **确认**：导出范围 = 决策 1 候选 1（七类用户真相对象 + 被引用目标的可读摘要，不含正文与媒体）；交付形态 = 决策 2 候选 A（单条只读路由 `GET /exports/user-data` 返回 JSON 附件 + Web 存储面板下载按钮）；实现挂 Task 24 追加切片；授权创建 worktree `.worktree/user-data-export` / 分支 `feat/t24-user-data-export` | 用户（评审确认） |
