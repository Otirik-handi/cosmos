# ADR-0026：连接器状态的归属、导出与导入 v1

> 状态：Accepted design contract
>
> 日期：2026-09-23
>
> 关联：[`connector-state-export-v1 Proposal`](../proposals/connector-state-export-v1.md)、ADR [`0017`](0017-connection-secret-state-v1.md)（ConnectorStateStore）、ADR [`0019`](0019-ops-storage-v1.md)（备份/恢复/导出）、ADR [`0023`](0023-collection-plan-v1.md)（状态命名空间按计划隔离）、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ING-012/OPS-009、[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) P1-1

## Context

ING-012 的验收条件是「状态可备份、恢复、迁移并按 Connection／Source／Workflow 范围隔离」。Task 22 交付了命名空间化 + 版本化的 `ConnectorState`（ADR-0017），Task 33 把命名空间从来源 id 切到计划 id（ADR-0023 决策 2），内置 RSS 连接器已实际用它保存 ETag／Last-Modified。缺的是后半个验收条件：

- 没有任何按命名空间导出／恢复／迁移的入口。备份只有整库 `VACUUM INTO`（ADR-0019），用户数据导出明确排除 `ConnectorState`（ADR-0019 决策 5）。
- 更要紧的是**归属不是数据**：命名空间是宿主按 manifest 模板算出来的字符串，库里没有"这个抽屉属于谁"的记录。所以"按连接／来源导出"必须每次绕道——查计划表 → 读来源定义 manifest → 拼字符串 → 再回状态表；而"从命名空间反查归属"完全做不到。

2026-09-23 用户裁决：归属要落成表里的事实（而不是每次现算），并授权本片实现。

## Decision

### 1. 归属登记在 `ConnectorStateNamespace`，只存 `planId`

新增 `ConnectorStateNamespace(namespace 主键, planId, createdAt, updatedAt)`，`planId` 带指向 `CollectionPlan` 的外键（`onDelete: Cascade`）。**只存 `planId`**：来源与连接通过 join `CollectionPlan` 得到，同一事实只有一个所有者（ADR-0023 决策 2 的口径）；计划改连接时这张表不需要同步。

清单以**实际存在的抽屉**为准（`ConnectorState` 的 distinct namespace），登记表只回答"属于谁"；登记了但一条状态都没有的抽屉不出现在清单里。

### 2. 宿主在解析状态句柄时登记，`putState` 与 CAS 路径不变

`ConnectorStateStorePort` 增 `registerNamespace(namespace, owner)`，宿主在准备句柄时调用一次（`apps/worker/src/main.ts` 的 `resolveConnectorStateHandle`，那里已经算出命名空间、手里也有 `planId`）。连接器看到的 `ConnectorStateHandle` 不变（仍只有 `get`／`put`），它依旧不知道命名空间、计划与连接。

登记是**尽力而为的元数据**：失败或冲突都只记日志，不让采集失败——状态写入本来就允许降级（连接器把 CAS 冲突吞成 `connector.state.write_skipped`）。

### 3. `ConnectorState.namespace` 不加指向登记表的外键

两张表刻意解耦。加了外键之后，未登记的抽屉根本写不进去：登记失败或遗留抽屉会让状态写入撞 FK 报错，把"尽力而为的元数据"变成"写入的前置条件"。代价是查询写成两步或一条 join，不能写成 Prisma 嵌套 `where: { namespaceOwner: ... }`。

### 4. 归属冲突保留首个登记

同一抽屉被两个计划登记（未来某个 manifest 的模板不含 `{id}`）时，保留首个登记，`registerNamespace` 返回 `conflict`，宿主记 `connector.state.owner_conflict` 日志，**不拒绝写入**。为归属冲突让采集失败不划算。

### 5. 导出按范围寻址，未归属抽屉只能点名

`GET /exports/connector-state` 的范围四选一（`namespace`／`planId`／`connectionId`／`sourceId`），缺省 = 全部已归属。未归属抽屉不属于任何一种范围，默认**不带走**；要导出必须按名字点名（`namespace`），此时导出件里 `owner` 为 `null`。清单接口把它们标 `unattributed`。

### 6. 导入默认只补缺失

`POST /imports/connector-state` 的 `mode` 默认 `skip-existing`：本地已有该 `(namespace, key)` 就不动；没有则按导出件的 `version` 建行（保留 CAS 连续性）。显式 `overwrite` 才覆盖，且 `version = 本地 + 1`——照搬导出件的 version 会让持有旧 CAS 令牌的写入方以为自己的写入仍然有效，从而静默覆盖刚恢复的状态。

导出件只含一个抽屉时，导入可带 `targetNamespace` 把它落到本地另一个抽屉（换机后计划／来源 id 不同）；目标抽屉必须已有归属登记，否则拒绝——那说明新环境没有计划的模板会算出这个名字，导进去没人会读。多抽屉一律按原样导入。

### 7. 与整库备份、用户数据导出三分工

| 入口 | 内容 | 场景 |
| --- | --- | --- |
| `POST /backups` | 整库 SQLite 快照 | 同机灾难恢复 |
| `GET /exports/user-data` | 用户真相对象；不含 `ConnectorState` | 用户带走自己创作的数据 |
| `GET /exports/connector-state` | 只有 `ConnectorState`，按抽屉切分 | 跨环境搬状态、重建单个抽屉、排障 |

三者互补，不互相替代；本片不改变前两者的范围。

## Consequences

### Positive

- 「按 Connection／Source 范围隔离」有了可自动化断言的证据，ING-012 的验收条件闭合。
- 归属是数据，清单与导出都是一次 join，不再依赖 manifest 模板现算；将来模板变复杂也不会让归属算不出来。
- `ConnectorState` 表结构与连接器的写入路径都没变，RSS 的条件请求行为不变。

### Costs and risks

- 新增 1 个 migration（建表 + 回填）。回填只覆盖默认模板 `{id}` 的现状：内置 manifest 的模板都是 `{id}`、计划 id 形如 `plan:<sourceId>`，所以现有抽屉名就等于计划 id；非默认模板写出的抽屉靠首次写入登记补上。
- 登记发生在"准备句柄"时，所以一个计划即使这一轮没写任何状态也会被登记（清单里不出现，因为它以实际存在的抽屉为准）。
- 导入是数据写入：回滚代码不会撤销已经写进库的状态，需要时用同一入口的 `overwrite` 反向导入旧件，或整库恢复。
- `ConnectorState.namespace` 与登记表之间没有数据库级一致性约束：绕过仓库直接写库仍可能留下未登记的抽屉（清单会把它标成未归属）。

## Alternatives considered

### 归属每次现算（不建表）

拒绝。每次都要读 manifest 模板并绕道计划表，而且"从命名空间反查归属"仍然做不到——导出件里的抽屉名要判断属于谁时没有答案。

### 只按命名空间字符串，不解析归属

拒绝。「按 Connection／Source 范围隔离」拿不出可展示的证据。

### 给 `ConnectorState` 每行加 `planId`

拒绝。归属是抽屉级属性，写在每行上是冗余；同一抽屉出现两行不同 `planId` 时数据自相矛盾，没有裁决位置。

### 给 `CollectionPlan` 加 `stateNamespace` 列

拒绝。只让"正查"快一点，仍不能从抽屉名反查归属，遗留抽屉一点没解决。

### `ConnectorState.namespace` 加外键指向登记表

拒绝。见决定 3。

### 导入时照搬导出件的 version

拒绝。会让旧 CAS 令牌静默生效（见决定 6）。

### 把 `ConnectorState` 并进用户数据导出

拒绝。ADR-0019 决策 5 已明确排除；用户真相对象与可重建运行状态的用途和生命周期不同。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 出现**第二个写入方**（Workflow 级状态、Agent 状态）：归属需从 `planId` 泛化为 `ownerKind`／`ownerId`，本片的查询接口形状不变；
- 出现**删除采集计划的入口**：裁定状态行与归属登记的清理语义（当前登记 Cascade、状态行没有删除路径）；
- 需要导出件落盘保留与清理、加密、签名或定时备份：需要新的需求行再评估。
