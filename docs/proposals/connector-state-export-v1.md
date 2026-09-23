# Proposal：ING-012 连接器状态导出／导入 v1

> 状态：accepted
>
> 日期：2026-09-23
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) ING-012（`part-07-1.md` §7.3）、OPS-009（`part-07-3.md` §7.10）
>
> 关联设计：ADR [`0017`](../adr/0017-connection-secret-state-v1.md)（ConnectorStateStore = 命名空间化版本化 KV）、ADR [`0019`](../adr/0019-ops-storage-v1.md)（备份/恢复/导出，决策 5 = 用户数据导出）、ADR [`0023`](../adr/0023-collection-plan-v1.md)（状态命名空间按计划隔离）
>
> 关联既有切片：Task 22（Connection/SecretStore/StateStore v1）、Task 24（存储占用与备份/恢复 + 用户数据导出）、Task 33（采集计划 v1）
>
> 缺口来源：[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) P1-1

## 1. 问题

ING-012 的验收条件是「Adapter 不直接写核心数据库；**状态可备份、恢复、迁移并按 Connection／Source／Workflow 范围隔离**；Secret 不混入普通状态」。当前只兑现了前半句：

- 已交付：`ConnectorState` 表（`(namespace, key)` 唯一 + `valueJson` + 单调 `version`）、`ConnectorStateStorePort`／`PrismaConnectorStateStore`（version CAS）、宿主按 manifest 的 `stateStoreNamespace` 解析命名空间；内置 RSS 连接器已实际在 `http-cache` 键下保存 ETag／Last-Modified。
- 未交付：没有任何按命名空间导出／恢复／迁移的入口。备份只有整库复制（`POST /backups` 走 SQLite `VACUUM INTO`）；用户数据导出**明确排除** `ConnectorState`（ADR-0019 决策 5，测试断言导出文本不含状态值）。

后果：换机、换状态命名空间、状态损坏后重建，今天都只能**整库搬**。整库搬会连带覆盖目标环境上更新的用户数据、内容库与运行记录，而用户想搬的只是那一小块可重建的状态；NFR-012 的「可迁移」在这块没有兑现。

第二个问题在实现这一片时才暴露：**归属不是记录的事实**。命名空间是运行时按 manifest 模板算出来的字符串，库里没有"这个命名空间属于谁"的记录，所以"按连接／来源导出"必须绕道——计划表 → 来源定义 manifest → 拼字符串 → 再回状态表；而"从命名空间反查归属"根本做不到。本片同时把归属变成表里的事实。

## 2. 目标与非目标

### 目标（v1）

1. 把 `ConnectorState` 按命名空间导出成一份**人可读、可长期保存**的 JSON 文件，选择范围可以是「某个计划／连接／来源」或「某个命名空间」。
2. 把导出件导入回来：默认只补缺失，可显式覆盖；导入结果给出条数。
3. Web 存储面板提供导出下载与导入上传入口（用户不必使用命令行）。
4. 让「按 Connection／Source 范围隔离」有可自动化的验收证据。
5. 归属成为持久化事实，查询不再依赖 manifest 模板现算。
6. 写清它与整库备份、用户数据导出三者的分工。

### 非目标（明确后置）

- 导出／导入 `ConnectorState` 以外的任何表（内容库、运行记录、用户真相对象、连接与来源配置、Secret 字节）。
- 跨安装的**批量**命名空间重映射（多对多改名映射表）。
- `Checkpoint`（采集游标）迁移：ADR-0017／0023 已把 cursor 与 ConnectorState 定为两套，cursor 的按计划迁移不并入本片。
- Workflow 级状态的归属：今天只有计划写状态；`ownerKind`／`ownerId` 的泛化见 Revisit Gate。
- 定时／自动备份、导出件落盘保留与清理、加密、签名、压缩。
- 按 Adapter 声明的状态 schema 做值校验（该能力本身尚未落地）。

## 3. 当前行为与证据

**数据形状**（`packages/storage-prisma/prisma/schema.prisma` 第 112–121 行）：`ConnectorState(id, namespace, key, valueJson, version, updatedAt)`，`@@unique([namespace, key])`。库里真实的数据形状（取自迁移测试 `collection-plan-state-namespace.test.ts`）：

| namespace | key | valueJson | version |
| --- | --- | --- | --- |
| `plan:source-feed` | `http-cache` | `{"etag":"W/\"1\""}` | 1 |
| `plan:source-hot` | `page` | `{"cursor":"c-1"}` | 2 |
| `other-namespace` | `page` | `{"cursor":"x"}` | 1 |

- **命名空间不是目录、不是独立表，就是这一列的一个字符串值**；它把不同写入方的同名 key 分开。
- 端口与实现：`packages/application/src/connector-state-store.ts`、`packages/storage-prisma/src/connector-state-store.ts`。端口只有 `getState`／`putState`——**没有"列出某个命名空间下所有条目"的能力**，导出必须先补这一块。
- 命名空间由宿主**运行时算出**：manifest 声明模板，Worker 把 `{id}` 换成采集计划 id（`apps/worker/src/main.ts` 第 39–56 行）；四个内置 manifest 都用默认模板 `{id}`（`packages/application/src/catalog.ts` 第 188–206 行）。
- 计划 id 的形状是 `'plan:' || sourceId`（migration `20260920140000_collection_plan_backfill`），命名空间迁移只把 `source:<x>` 重写成 `plan:<x>`，非本模板写出的命名空间原样保留（migration `20260921160000_collection_plan_state_namespace`）。
- 归属今天可推导但未记录：`namespace → planId → plan.sourceId → plan.connectionId`（`CollectionPlan.sourceId` 唯一、`connectionId` 可空，schema 第 70–89 行）。推导需要读 manifest 模板，因此依赖代码而不是数据。
- **今天没有删除采集计划的入口**（`apps/api/src/app.controller/sources.ts` 只删 Webhook 入口）；来源删除是墓碑（`SourceInstance.deletedAt`），计划行保留。也没有任何代码删除 `ConnectorState` 行。
- 现有边界：备份/导出端点 `apps/api/src/app.controller/sources.ts` 第 413–458 行；用户数据导出实现 `packages/storage-prisma/src/repository/user-data-export.ts`，其排除断言在 `packages/storage-prisma/src/user-data-export.test.ts` 第 95 行起。

## 4. 方案

### 决策 1：归属记录在表里（已裁决：候选 C）

新增 `ConnectorStateNamespace`：一个抽屉一条归属记录，写入侧登记，读侧直接 join，不再解析 manifest 模板。

```prisma
// 命名空间归属（ING-012「按 Connection/Source/Workflow 范围隔离」）：抽屉名是运行时按
// manifest 模板算出来的字符串，宿主准备状态句柄时把「这个抽屉属于哪个计划」登记在这里，
// 归属因此是记录的事实，而不是每次反查计划表 + 解析模板现算。
model ConnectorStateNamespace {
    namespace String         @id
    planId    String
    createdAt DateTime       @default(now())
    updatedAt DateTime       @updatedAt
    plan      CollectionPlan @relation(fields: [planId], references: [id], onDelete: Cascade)

    @@index([planId])
}
```

被否决的两个候选：

| 候选 | 否决理由 |
| --- | --- |
| 给 `ConnectorState` 每行加 `planId` 列 | 归属是**抽屉级**属性，写在每行上是冗余；同一抽屉出现两行不同 `planId` 时数据自相矛盾，没有裁决位置 |
| 给 `CollectionPlan` 加 `stateNamespace` 列 | 只让"正查"快一点，**仍不能从抽屉名反查归属**；导出件里的抽屉名要判断属于谁时依然没有答案 |

**只存 `planId`**：来源与连接通过 join `CollectionPlan` 取得——同一事实只有一个所有者（ADR-0023 决策 2 的口径）。计划改连接时这张表不需要同步。

**登记时机**：宿主准备状态句柄时登记一次（`apps/worker/src/main.ts` 第 39–56 行，那里已算出命名空间、手里也有 `source.planId`）：

```ts
// ConnectorStateStorePort 新增；putState 签名与 CAS 路径不变
registerNamespace(namespace: string, owner: { planId: string }): Promise<void>
```

连接器看到的 `ConnectorStateHandle` 完全不变（仍只有 `get`／`put`），它依旧不知道命名空间、计划与连接。

**不加外键**：`ConnectorState.namespace` **不**加指向登记表的外键。登记是尽力而为的元数据（失败只记日志，不影响采集），一旦成为写入前置条件，登记失败或遗留抽屉会让状态写入撞 FK 报错。两张表解耦，代价是查询写成两步或一条 join，不能写成 Prisma 嵌套 `where: { namespaceOwner: ... }`。

**归属冲突**（同一抽屉被两个计划登记，未来模板不含 `{id}` 时）：保留首个登记并记 `connector.state.owner_conflict` 日志，**不拒绝写入**——状态写入本来就允许失败降级，为它让采集失败不划算。该行为写入 spec。

**删除计划**：归属登记 `onDelete: Cascade`（登记随计划消失，抽屉回到未归属）。今天没有删除计划的入口，出现该入口时要连同"状态行如何清理"一起裁定。

**回填**：migration 从现有 `ConnectorState` 的 distinct namespace 推导并登记，匹配不到的保持未归属：

```sql
INSERT INTO "ConnectorStateNamespace" ("namespace", "planId", "createdAt", "updatedAt")
SELECT DISTINCT cs."namespace", cp."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ConnectorState" cs
JOIN "CollectionPlan" cp ON cs."namespace" = cp."id"   -- 默认模板 {id}：抽屉名 == 计划 id
WHERE NOT EXISTS (
    SELECT 1 FROM "ConnectorStateNamespace" n WHERE n."namespace" = cs."namespace"
);
```

migration 注释必须写明：这条 SQL 只覆盖默认模板 `{id}` 的现状（今天全部真实数据），非默认模板的抽屉靠首次写入登记补上。**回填后未归属抽屉在现有数据上应为零**，剩余的是防御性边界（手工改库、将来换模板）。

### 决策 2：未归属抽屉默认排除、可点名（已裁决）

- 默认导出**不带**未归属抽屉；它们在抽屉清单里以 `unattributed` 标出（附原因），想导必须按名字显式点名。
- 避免把不知道来源的状态搬进新环境（已删来源的遗留、手工改库、将来模板变化）。
- 清单以**实际存在的抽屉**为准（从 `ConnectorState` 取 distinct namespace），归属从登记表 left join；"登记了但一条状态都没有"的抽屉不出现在清单里。

### 决策 3：导入改名只支持单抽屉（已裁决）

- 场景：换机后计划／来源 id 与导出环境不同，导出件里的 `plan:source-old` 在新环境没有任何计划会读它——原样导入等于把状态搬进死抽屉。
- 导出件只含**一个**抽屉时，导入可带 `targetNamespace`；**目标抽屉必须已登记**（即新环境确实有计划的模板会算出这个名字），否则拒绝并提示先建计划。多抽屉一律按原样导入，批量映射后置。

### 决策 4：导入冲突语义（已裁决）

`mode: "skip-existing" | "overwrite"`，默认 `skip-existing`。

- `skip-existing`：本地已有该 `(namespace, key)` 则不动；没有则按导出件的 `version` 建行（保留 CAS 连续性）。
- `overwrite`：本地已有则该行 `value` 覆盖、`version = 本地 version + 1`。不照搬导出件的 version——那会让持有旧令牌的写入方误以为 CAS 仍有效，从而静默覆盖刚恢复的状态。行不存在时同 `skip-existing`。
- 幂等：同一份文件在 `skip-existing` 下重复导入结果与首次相同。
- `updatedAt` 不还原，以导入时间为准；导出件里的 `updatedAt` 只是信息。
- 非法输入（结构不符、超出体积上限）整批拒绝，不做部分写入；合法输入在单个事务内写完。

### 决策 5：入口形态（已裁决）

| 路由 | 语义 |
| --- | --- |
| `GET /connector-state/namespaces` | 只读清单：每个抽屉的 key 条数、归属（planId／sourceId／connectionId）与未归属标记 |
| `GET /exports/connector-state` | 范围参数四选一（`namespace`／`planId`／`connectionId`／`sourceId`），缺省 = 全部已归属；返回 JSON 附件，文件名 `cosmos-connector-state-<exportedAt>.json`；只读、不落盘 |
| `POST /imports/connector-state` | body = 导出件 + `mode` + 可选 `targetNamespace`；返回各类条数（created／skipped／overwritten／namespaces） |

配套：transport 客户端三个方法；Web 存储面板加「导出连接器状态」（范围下拉 + 下载）与「导入连接器状态」（文件选择 + 模式 + 结果摘要）。

### 决策 6：导出件格式（随方案冻结）

```json
{
  "schemaVersion": 1,
  "exportedAt": "<ISO-8601>",
  "scope": { "kind": "namespace|plan|connection|source|attributed", "value": "<id 或 null>" },
  "counts": { "namespaces": 0, "keys": 0 },
  "namespaces": [
    {
      "namespace": "plan:source-feed",
      "owner": { "planId": "plan:source-feed", "sourceId": "source-feed", "connectionId": null },
      "entries": [
        { "key": "http-cache", "value": { "etag": "W/\"1\"" }, "version": 1, "updatedAt": "<ISO-8601>" }
      ]
    }
  ]
}
```

- 抽屉与其中的条目都按名字升序，输出稳定可 diff。
- `owner` 为 `null` 表示未归属（只在按名字点名导出时可能出现）。
- `schemaVersion` 是唯一版本位；扩展通过升版本表达，不改已有字段含义。
- 导出件**不含**任何 Secret、连接配置或其它表的字段。

### 决策 7：安全与写入边界（不待裁决）

- 只读写 `ConnectorState` 与 `ConnectorStateNamespace` 两张表；绝不导出 Secret 字节、`ConnectionInstance`、`SourceInstance`、`Checkpoint`、`Asset.storageKey`。
- 导出是只读 Query，无副作用、无落盘产物，文件由用户自行保管。
- 导入是外部输入：以 `unknown` 接收、按契约 schema 校验后再写；只写 `ConnectorState`，不触发采集、不写事件、不改计划与连接。
- 导入需要显式体积上限（避免超大 body 打爆 API），具体常量在实现时按既有端点口径确定并记入 spec。
- 导入是**数据写入**：回滚代码不会撤销已经写进库的状态。

### 决策 8：与整库备份、用户数据导出的分工（不待裁决，写进文档）

| 入口 | 内容 | 适用场景 |
| --- | --- | --- |
| `POST /backups` | 整库 SQLite 快照（含一切表，不含 Blob） | 同机灾难恢复 |
| `GET /exports/user-data` | 七类用户真相对象 + 被引用目标摘要；**不含** `ConnectorState` | 用户带走自己创作的数据 |
| `GET /exports/connector-state` | 只有 `ConnectorState`，按命名空间切分 | 跨环境搬状态、重建单个命名空间、排障时读可读快照 |

三者互补，不互相替代；本片不改变前两者的范围。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 归属登记在表里（决策 1 C） | 采纳 |
| 归属每次现算（决策 1 A） | 拒绝（每次绕道读 manifest，且无法反查） |
| 只按命名空间字符串（决策 1 B） | 拒绝（范围隔离没有可展示证据） |
| `ConnectorState` 每行加 `planId` | 拒绝（抽屉级属性冗余、矛盾无裁决位置） |
| `CollectionPlan` 加 `stateNamespace` | 拒绝（不能反查归属） |
| `ConnectorState.namespace` 加外键 | 拒绝（登记失败会让状态写入失败） |
| 未归属默认排除、可点名（决策 2） | 采纳 |
| 单抽屉可改名导入（决策 3） | 采纳 |
| 导入默认 `skip-existing`，显式 `overwrite`（决策 4） | 采纳 |
| API + transport + Web 存储面板（决策 5） | 采纳 |
| 导出落盘产物、定时备份、加密与签名 | 拒绝（v1 无需求行） |
| 导入时照搬导出件的 version | 拒绝（会让旧 CAS 令牌静默生效） |
| 把 `ConnectorState` 并进用户数据导出 | 拒绝（ADR-0019 决策 5 已明确排除；用途与生命周期不同） |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：新增 `ConnectorStateNamespace` 表 + 1 个 migration（建表 + 回填）；`ConnectorState` 结构不变。回填是幂等的（`WHERE NOT EXISTS`）。
- **接口**：新增 3 条路由 + 3 个 contracts schema（清单、导出信封、导入结果）+ transport 3 个方法 + Web 存储面板两个入口。路由快照（`.agents/tasks/governance/G03-api-controller/route-snapshot-app.controller.txt`）与 `packages/contracts/entry-surface.txt` 需同批重生成。
- **应用合同**：`ConnectorStateStorePort` 增 `registerNamespace`；新增列出抽屉与条目的读取能力。`ConnectorStateHandle`（连接器可见面）不变。
- **安全**：白名单两表；不触碰 Secret 与内部 key；导入按外部输入校验并设体积上限。
- **迁移与发布**：1 个 migration，随代码一起部署；不涉及版本号、发布、部署。
- **回滚**：回滚代码后新路由与面板入口消失，登记表成为无人读的普通表（无害）；**已经导入的状态是数据，不会自动撤销**——需要时用同一入口的 `overwrite` 反向导入旧件，或整库恢复。这一条写进 spec 的导入语义。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements/part-07-2.md`：ING-012 行补 v1 形态注记（归属表、导出／导入入口与范围隔离口径）。
- `docs/requirements/0002-product-requirements/ERRATA.md`：ING-012 从「部分交付、仍未闭合」转为已交付（实现合入后登记，附证据）。
- ADR：新增 `docs/adr/0026-connector-state-export-v1.md`（归属记录、范围寻址、导入模式、与备份的分工、Revisit Gate），并在 ADR-0017 的关联处补一条指向。
- `docs/spec/`：`contracts/0001-public-contracts.md`（清单／导出信封／导入结果）、`storage/0001-prisma-repository.md`（归属表与读写事务）、`application/0001-connector-runtime.md`（登记时机与冲突行为）、`interfaces/0002-product-api-http.md`（三条新路由）、`interfaces/0004-http-client.md`、`interfaces/0005-web-client.md`（存储面板）。
- `.agents/tasks/22-connection-state-store/`（复用，理由：Task 22 是 ConnectorState 合同与文件的 owner，本片只增归属与导出／导入面，不新建编号）。
- `PROJECT-STATUS.md`：Phase 2 未闭合行减少后的状态同步。

## 8. Revisit Gate

- 出现**第二个写入方**（Workflow 级状态、Agent 状态）时：归属需从 `planId` 泛化为 `ownerKind`／`ownerId`，本片的查询接口形状不变。
- 出现**删除采集计划的入口**时：裁定状态行与归属登记的清理语义（当前登记 Cascade、状态行无删除路径）。
- 导出件落盘保留与清理、加密、签名、定时备份：需要新的需求行再评估。

## 9. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-23 | 起草，状态 `reviewing`；待裁决决策 1（范围隔离实现）、决策 2（未归属默认处理）、决策 3（导入改名） | Agent |
| 2026-09-23 | **确认**：入口形态 = API + transport + Web 存储面板（决策 5）；导入冲突语义 = `mode` 参数、默认 `skip-existing`（决策 4） | 用户（评审确认） |
| 2026-09-23 | **确认**：决策 1 = 候选 C（新增 `ConnectorStateNamespace` 归属表，只存 `planId`，宿主准备句柄时登记，`putState` 与 CAS 路径不变，**不给 `ConnectorState.namespace` 加外键**，冲突保留首个并记日志，删除计划 Cascade）；决策 2 = 未归属默认排除、可点名；决策 3 = 支持改名但仅限单抽屉。状态转 `accepted` | 用户（评审确认） |
| 2026-09-23 | 授权创建 worktree `.worktree/connector-state-export` / 分支 `feat/t22-connector-state-export`，实现挂 Task 22 追加切片 | 用户（评审确认） |
