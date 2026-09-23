# Task 22：Connection / SecretStore / StateStore v1（Phase 2 第十二切片）

> 编号 22 经维护者 2026-09-21 确认。

## User Request / Topic

2026-09-10 用户指示「继续平台面开发」，下一块为 Connection/StateStore（AUT-009/AUT-010、ING-012、OPS-009、待决定 16）。Proposal [`connection-state-store-v1`](../../../docs/proposals/connection-state-store-v1.md) 起草后列出四项裁决（ConnectionInstance 可空外键、SecretStore 第一版后端、ConnectorStateStore 不迁 Checkpoint、Secret 脱敏与所有权边界）；用户接受四项默认并授权创建 worktree `.worktree/connection-state-store` / 分支 `feat/t22-connection-state-store`。稳定决定沉淀于 [`ADR-0017`](../../../docs/adr/0017-connection-secret-state-v1.md)，PRD 注记与 ADR 索引已同步。

**追加切片 2（2026-09-23，归属登记与状态导出／导入）**：Phase 2 缺口复核（[`Phase-2-UNDO.md`](../../../Phase-2-UNDO.md) P1-1）指出 ING-012 只兑现了一半——状态存储已交付且被 RSS 消费，但「状态可备份、恢复、迁移并按 Connection／Source 范围隔离」没有入口，而且**归属不是数据**：命名空间是宿主按 manifest 模板算出来的字符串，库里没有「这个抽屉属于谁」的记录，所以「按连接导出」必须每次绕道计划表 + 解析模板，「从命名空间反查归属」则完全做不到。用户在讨论中要求「不要每次靠计算绕道，改成表结构」，并认可 Proposal [`connector-state-export-v1`](../../../docs/proposals/connector-state-export-v1.md) 的 C 方案与全部推荐项（未归属抽屉默认排除、单抽屉可改名、导入默认只补缺失、入口为 API + transport + Web）。稳定决定沉淀于 [`ADR-0026`](../../../docs/adr/0026-connector-state-export-v1.md)。复用本 Task 的理由：`ConnectorState` 的合同与文件边界都在这里，本切片只增归属与导出／导入面，不新建编号。该切片已 `--no-ff` 合并 `1b5cabc`。

**追加切片 3（2026-09-23，连接可见性）**：用户选择做 [`Phase-2-UNDO.md`](../../../Phase-2-UNDO.md) 的 P1-3（AUT-009）。复核时发现缺口比缺口台账写的更深一层：面板确实没有「授权范围」与「失效原因」两行，但**这两个字段今天没有任何自动写入方**（`scopeJson` 只在建连接时可写、Web 表单没这个输入框；`lastError` 只有 `PATCH /connections/:id` 能写，全仓只有测试调用过），所以只补显示等于两行永远为空。用户裁决走「显示 + 补写入路径」，且**只用现有合同**（`createConnection.scopeJson`、`updateConnection.status`/`lastError`）——因此不需要 Proposal、不改公共 DTO。授权范围输入要求合法 JSON（`scopeJson` 是 JSON 字符串，将来真实 Adapter 写入时格式一致）。复用本 Task 的理由同上：`ConnectionInstance` 的合同与 `ConnectionPanel` 都在这里。

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

切片 2 追加 Scope：

- Prisma：`ConnectorStateNamespace` 表（namespace 主键 + planId + 时间戳）+ migration `20260923120000_connector_state_namespace_owner`（建表 + 从现有 distinct namespace 回填）。
- contracts：`connectorStateNamespaceSummarySchema`、`connectorStateExportSchema`（+ `ConnectorStateExportScope`）、`connectorStateExportQuerySchema`、`connectorStateImportCommandSchema`、`connectorStateImportResultSchema`；`entry-surface.txt` 显式重生成。
- application：`ConnectorStateStorePort.registerNamespace`（+ `ConnectorStateOwner`／`ConnectorStateNamespaceRegistration`）、`CosmosRepository` 增 `listConnectorStateNamespaces`／`exportConnectorState`／`importConnectorState`、`ConnectorStateImportRejectedError`；`IngestActionOptions.connectorState` 允许返回 Promise。
- storage：`PrismaConnectorStateStore.registerNamespace`、`PrismaCosmosRepositoryConnectorStateExport`（清单／导出／导入，导入在单事务内）。
- API：`GET /connector-state/namespaces`、`GET /exports/connector-state`、`POST /imports/connector-state`（64 KB 体积上限）。
- transport：`listConnectorStateNamespaces`／`exportConnectorState`／`importConnectorState`。
- Web：`StoragePanel` 的「连接器状态」一组（范围下拉 + 导出下载 + 文件导入 + 模式选择 + 结果条数）+ 组件实验室桩。

切片 2 追加 Non-goals（见 Proposal / ADR-0026）：

- 导出／导入 `ConnectorState` 以外的任何表；跨安装的批量命名空间重映射（v1 只支持单抽屉改名）。
- Workflow 级状态的归属（`ownerKind`／`ownerId` 泛化留给 Revisit Gate）；导出落盘产物、定时备份、加密、签名、压缩。
- 按 Adapter 声明的状态 schema 做值校验（该能力本身尚未落地）。

切片 3 追加 Scope：

- Web：`ConnectionPanel` 加「授权范围」输入（本地 JSON 校验、提交前规范化）、每行的「授权范围／失效原因」两行展示、以及「标记失效」（内联原因 + `status=error`）与「恢复可用」（`status=active` + 清空原因）。
- Web：组件实验室的连接面板夹具补 `updateConnection` 桩、示例连接补授权范围与一条失效连接。
- 测试：`e2e/component-lab/connection-panel.spec.ts`（渲染 + 内联输入 + 非法 JSON 拦截）、`e2e/browser/connection-visibility.spec.ts`（真实栈上的记录 → 标记失效 → 恢复）。

切片 3 追加 Non-goals：

- **不改任何公共 DTO**：全部用现有 `createConnection.scopeJson` 与 `updateConnection.status`/`lastError`；因此不需要 Proposal 与新 ADR。
- 授权范围的形状不做校验（只要求是合法 JSON）；`scopeJson` 仍只在建连接时可写，编辑入口留给真实认证 Adapter。
- 连接器的 catalog 下拉校验、「来源 → 连接」绑定 UI 仍后置。

## 权威合同

- Proposal [`connection-state-store-v1`](../../../docs/proposals/connection-state-store-v1.md)（accepted，2026-09-10，用户确认四项默认）。
- ADR [`0017`](../../../docs/adr/0017-connection-secret-state-v1.md)；ADR [`0001`](../../../docs/adr/0001-durable-workflow-runtime.md)。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) AUT-009/AUT-010/ING-012/OPS-009 与 §7.5 第十二切片注记。
- 架构 [`0001`](../../../docs/architecture/0001-cosmos-foundation.md) §4.2/§5.2。

## Current State

- 生命周期阶段：**切片 1 已完成并合并**（`master` commit `9c4cf72`）；**切片 2（2026-09-23）已完成、验证、`--no-ff` 合并 `1b5cabc` 并推送**；worktree `.worktree/connector-state-export` 与分支 `feat/t22-connector-state-export` 已清理。
- 连贯目标（切片 2）：让「这个抽屉属于哪个计划」成为数据，并补上状态的导出／导入入口，闭合 ING-012 的后半个验收条件。
- 可观察验收（切片 2，≤3 条）：
  1. 抽屉清单与导出按范围收窄：按连接／计划／来源导出只含该范围下的抽屉，未归属抽屉（如 `other-namespace`）默认不出现；
  2. 导入默认只补缺失、显式 `overwrite` 时 `version = 本地 + 1`，同一份文件重复导入结果相同；
  3. 真实 Worker 进程抓取一次后，`ConnectorStateNamespace` 里有指向该计划 id 的归属登记。
- 依赖：切片 1（`ConnectorState`）、Task 33（计划 id 与命名空间按计划解析）。
- 受影响合同（切片 2）：contracts（清单／导出信封／导入命令与结果／导出范围查询）、application（`ConnectorStateStorePort.registerNamespace` + 三个仓储方法 + 一个域错误）、storage（新表与 migration + 三个仓储方法 + `PrismaConnectorStateStore.registerNamespace`）、API（三条路由）、transport（三个客户端方法）、Web（`StoragePanel`）。
- 验证层级：focused（contracts/storage/application/api/transport/web）→ Node 进程 E2E → 全量门禁。
- 生命周期阶段（切片 3）：**已完成、验证、`--no-ff` 合并 `2cfe379` 并推送**；worktree `.worktree/connection-visibility` 与分支 `feat/t22-connection-visibility` 已清理。
- 连贯目标（切片 3）：让 AUT-009 的「用户能看到授权范围与失效原因」成立——不只是显示，还要有内容来源。
- 可观察验收（切片 3，≤3 条）：
  1. 建连接时记录的授权范围在连接行上按可读形式回显（`read: true · comment: false`），非法 JSON 在本地被拦下且不清空表单；
  2. 标记失效后该行同时显示「错误」徽标与失效原因，恢复可用后原因回到「未记录」；
  3. 全程只用现有合同（无公共 DTO 变化）。
- 依赖：切片 1（`ConnectionInstance`、`updateConnection`）、Task 33（计划按连接分组，绑定的另一半已交付）。
- 受影响合同（切片 3）：只有 Web（`ConnectionPanel`）与组件实验室夹具；contracts／application／storage／API／transport **零改动**。
- 验证层级：focused（web typecheck + lint）→ 组件实验室 E2E → 浏览器产品 E2E → 全量门禁。

## Decisions and Deviations

- 以 ADR-0017 四条为稳定边界。
- `sourceSnapshotSchema.connectionId` 用 `.optional()`（向后兼容：既有投影缺该字段仍可解析），但仓库 `toSourceSnapshot` 始终写入 `connectionId`（未链接为 null）。
- `SourceInstance.connectionId` 无 DB FK（SQLite `ALTER TABLE` 不能加约束，与既有 `WorkflowRun.sourceInstanceId` 迁移一致）；删除 Connection 的 SetNull 由仓库事务显式 `updateMany` 置空。
- `FileSecretStore` 复用与 `FileBlobStore` 相同的路径逃逸校验，写入 `mode: 0o600`（Windows 尽力而为）。
- Connection 的 Web 面板 v1 用自由文本 `connectorId`（缺省 `generic`），未做 catalog 强校验（真实认证 Adapter 后置）。

切片 2 追加：

- 以 ADR-0026 七条为稳定边界；归属只存 `planId`，来源／连接靠 join `CollectionPlan`（同一事实一个所有者）。
- `ConnectorStateExportScope` 只做类型、不做运行时 schema：范围由 `connectorStateExportQuerySchema`（HTTP 边界）把关，仓库收到的是已校验过的输入。
- 导出信封的 `scope` 用扁平的 `{kind, value}`，而应用层用带名字段的联合类型——前者是序列化形态，后者是调用形态，转换在仓库里一次完成。
- 导入命令把整份导出件作为 body 的一个字段（`{mode, targetNamespace?, export}`），而不是"原始文件 + 查询参数"：导入边界因此只有一个被校验的输入。
- **偏差（既有欠账，非本片引入）**：`packages/application/entry-surface.txt` 在 `master` 上已落后一行——Task 23 的 `CollectionPlanWebhookEntryTarget` 类型导出没进快照。本片必须重生成该文件（新增 2 个类型 + 1 个值），机械重生成顺带补齐了那一行；`entry-contract.test.ts` 只比对运行时值导出，所以这条类型漂移此前不会被测试拦住。
- **偏差（既有欠账）**：`docs/spec/storage/0001-prisma-repository.md` 的模型表此前没有 `ConnectorState`／`ConnectionInstance` 行。本片只补 `ConnectorState` 与新增的 `ConnectorStateNamespace`（新行引用了前者，不补会读不通），`ConnectionInstance` 仍缺，已记入 Follow-ups。

切片 3 追加：

- **不改公共 DTO**：`createConnection` 已有 `scopeJson`、`updateConnection` 已有 `status`/`lastError`，本片只补 Web 侧的入口与显示，因此不需要 Proposal 与新 ADR（准入表里这是「当前合同可判定的局部」，AUT-009 的验收条件本来就写着要能看到这两项）。
- 授权范围输入**只校验是不是合法 JSON**，不校验形状；提交前用 `JSON.stringify` 规范化，用户输入的空格与换行不进入存储值。
- 面板把「这两个字段今天没有自动写入方」当成产品事实处理：动作入口的措辞是用户视角的「标记失效／恢复可用」，而不是假装系统探测到了原因；将来真实 Adapter 接上后由系统写同一对字段，面板不用改。
- 授权范围的可读渲染只处理「顶层标量值对象」这一常见形状，其它形状（嵌套、数组）回退紧凑 JSON；解析不了的值原样显示，不隐藏手工改库写进来的内容。

## Implementation Walkthrough

1. **migration**：`20260910120000_connection_state_store_v1` 建 `ConnectionInstance`/`ConnectorState` 两表 + `SourceInstance.connectionId`（forward-only、无回填）。
2. **contracts**：Connection DTO/命令 + `sourceSnapshotSchema.connectionId`（optional）+ `updateSourceCommandSchema.connectionId`。
3. **application**：`secret-store.ts`（`SecretStorePort`）、`connector-state-store.ts`（`ConnectorStateStorePort` + `ConnectorStateConflictError`）、`CosmosRepository` 增 Connection CRUD、`ConnectionNotFoundError`。
4. **storage**：`secret-store.ts`（`FileSecretStore`）、`connector-state-store.ts`（`PrismaConnectorStateStore`）、`PrismaCosmosRepository` 的 Connection CRUD + `toConnectionSnapshot` + `toSourceSnapshot`/`updateSource` 联动 connectionId。
5. **API**：五个 Connection 端点 + `connectionError` 漏斗。
6. **transport**：五个 Connection 客户端方法。
7. **Web**：`ConnectionPanel` + `renderConnectionPanelLab` + `registry.tsx` 登记 + page.tsx 侧栏「连接」区。

切片 2（2026-09-23，归属登记与状态导出／导入）：

1. **Prisma**：`ConnectorStateNamespace`（namespace 主键、planId + FK 到 `CollectionPlan`、Cascade）+ migration `20260923120000_connector_state_namespace_owner`；回填按 `ConnectorState.namespace = CollectionPlan.id` 匹配（默认模板 `{id}` 的现状），匹配不到的保持未归属，`WHERE NOT EXISTS` 保证可重跑。
2. **contracts**：清单／导出信封／导入命令与结果／导出范围查询五个 schema（导出信封 strict，`scope` 只记 `kind` + `value`）；`ConnectorStateExportScope` 是类型（运行时不校验，范围由查询 schema 把关）；`entry-surface.txt` 用 `scripts/entry-export-surface.ts` 显式重生成（contracts +11 行）。
3. **application**：`ConnectorStateStorePort.registerNamespace` 返回 `"registered" | "conflict"`；`CosmosRepository` 三个方法；`ConnectorStateImportRejectedError`（`code = "validation"`）；`IngestActionOptions.connectorState` 改为可返回 Promise。
4. **storage**：`PrismaConnectorStateStore.registerNamespace`（唯一约束冲突时回读并区分「同计划重复登记」与「别的计划抢抽屉」）；`PrismaCosmosRepositoryConnectorStateExport` 作为新的 mixin 链尾，清单用 `groupBy` + 登记表 left join，导出按范围解析抽屉名，导入在单事务内按 `mode` 写。
5. **API**：三条路由 + 查询参数到范围的映射 + 64 KB 体积上限（`content-length` 与实际 body 双判，413 `payload_too_large`）；`exportFileName` 泛化成带前缀的版本，用户数据导出的文件名不变。
6. **transport**：三个客户端方法（范围 → 查询参数，缺省不带参数）。
7. **Web**：`StoragePanel` 并行加载抽屉清单；「连接器状态」一组提供范围下拉（含「未归属」标记）、导出下载、文件导入（本地先用 `connectorStateExportSchema` 解析）、模式选择与结果条数；组件实验室补三个桩。
8. **宿主接线**：`apps/worker/src/main.ts` 的 `resolveConnectorStateHandle` 改为 async，在解析句柄时登记归属，冲突与失败只记 `connector.state.owner_conflict`／`connector.state.registration_skipped`。
9. **文档**：Proposal 定稿 `accepted`、ADR-0026、ADR-0017 关联、ADR 索引、spec 五处、路由快照、PRD 注记与勘误台账、`PROJECT-STATUS.md`。

切片 3（2026-09-23，连接可见性）：

1. **Web**：`ConnectionPanel` 加三块——建连接表单的「授权范围」输入（本地 `JSON.parse` 校验、提交前 `JSON.stringify` 规范化）、每行 `dl` 里的「授权范围／失效原因」（空值显示「未记录」，范围按 `键: 值` 渲染）、行内动作「标记失效」（内联原因输入 + `updateConnection({status:"error", lastError})`）与「恢复可用」（`{status:"active", lastError:null}`）；动作入口按状态二选一显示。
2. **组件实验室**：连接夹具的示例连接补授权范围、新增一条失效连接（状态 `error` + 原因），夹具客户端补 `updateConnection` 桩。
3. **测试**：`e2e/component-lab/connection-panel.spec.ts` 两例（两行渲染 + 内联输入的启用/收起；非法 JSON 在本地被拦下且表单不清空）；`e2e/browser/connection-visibility.spec.ts` 一例（真实栈：建连接记录范围 → 回显 → 标记失效 → 原因与「错误」徽标 → 恢复可用 → 原因清空 → 删除连接）。
4. **文档**：Task 记录、`docs/spec/interfaces/0005-web-client.md`、`Phase-2-UNDO.md`、`PROJECT-STATUS.md`、`part-07-1.md` 的 AUT-009 注记；随后按维护者要求补勘误台账（5. 见下）。
5. **勘误台账归档与收口登记（2026-09-23，docs-only）**：`ERRATA.md` 已到 8,911/9,000 token，加不进新行，因此按 [`oversized-doc-splitting-v1`](../../../docs/proposals/oversized-doc-splitting-v1.md) §4.3／§4.5 做**滚动归档**——前 20 条（2026-09-15 ~ 2026-09-20）移入 `docs/requirements/0002-product-requirements/ERRATA/history-2026-09-15-20.md`（同目录同名子文件夹，封口后只读），主文档保留最近 5 条 + 分册索引表。搬迁**只搬位置**：除给 31 个相对链接各加一级 `../` 前缀外不改写内容；归档后主文档 27.5 KB → **11.9 KB（约 1,979 token）**，分册 20.9 KB（约 3,645 token），两册都在健康区。同批补四行口径：**LIB-004**（批注核心 Phase 2 已交付，Artifact 目标与片段字符级锚点改标 Phase 3）、**AUT-009**、**AUT-010**、**EXT-007** 的交付状态。维护者要求这三条收口行**逐条复核验收条件后**再写，复核结论落在各行里（AUT-010 的两处如实说明：来源操作由「计划与目标一对一」承接、迁移第 4 步单独排期；EXT-007 的「校验能力／版本／预算／恢复语义」四半句各自对应到代码锚点；LIB-004 说明 `quote` 只是文本快照、不是可定位的字符级锚点）。

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

切片 2 验证（2026-09-23，实际运行）：

- `bun run typecheck` 全仓通过（packages + apps/api、apps/worker、apps/web `tsc --noEmit`）；`bun run lint:web` 0 error（79 条既有 warning）。
- 全量单元测试 `bun run test`：**122 文件 / 698 用例全部通过**（切片 1 基线 119 文件 / 685 用例；本片新增 3 个测试文件与 13 个用例：storage `connector-state-export.test.ts` 4 例、storage `connector-state-namespace-backfill.test.ts` 1 例、api `app.controller.connector-state.test.ts` 6 例、transport `client-platform.test.ts` +2 例）。
- 迁移回填用例按真实迁移顺序两段式部署（`20260922140000_trigger_binding_webhook_entry` → 全部），断言默认模板 `{id}` 的抽屉登记到同名计划、`other-namespace` 不登记、状态行的 key/value/version 一字不动。
- Node 进程 E2E：`bunx vitest run --config vitest.e2e.config.ts e2e/conditional-fetch.e2e.test.ts` → 2/2 通过；用例新增一条断言（真实 Worker 抓取一次后 `ConnectorStateNamespace` 里有指向 `plan:<sourceId>` 的归属登记），证明宿主接线不是死代码。**注意**：本机跑 e2e 必须设 `BUN_BINARY` 指向 `bun.exe`（`scripts/e2e/helpers.ts` 用 `spawnSync("bun", …)`，PowerShell 环境下 `bun` 是 `.ps1` 垫片，会报 `spawnSync bun ENOENT`）。
- 浏览器 E2E：`bun run build` 后 `bunx playwright test --config playwright.config.ts e2e/browser/connector-state-export.spec.ts` → 1 passed；断言「导出连接器状态」下载的文件名与内容（`schemaVersion`、`counts` 与条目数一致、不含 `secretRef`），以及把同一份件回导时按默认模式全部跳过。
- 组件实验室 E2E：`bunx playwright test --config playwright.component-lab.config.ts` → 14 passed（`StoragePanel` 的夹具客户端已补三个新方法的桩）。
- `bun run docs:check`：747 文件 failures=[]；`git diff --check` 干净；路由表守卫 `app.controller.route-table.test.ts` 3/3（快照已按三条新路由更新）；`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` PASS（含既有基线内增长 warning；本片首次跑时 `PROJECT-STATUS.md` 因 token 轨道跨过 9k 触发「新增警戒区文件」FAIL，已通过精简本轮增补压回 8,735 token）。
- 未运行：`test:real:rss`／`test:real:bilibili` 等真实来源验收（本片不触碰连接器的抓取行为）、Windows smoke、Docker、发布部署。
- 合并后复跑（2026-09-23，主工作区，合并提交 `1b5cabc`）：`bun run typecheck` 0、`bun run test` 122 文件／698 用例、`docs:check` 755 文件 0 失败、size 门禁 PASS、`git diff --check` 干净。**第一次复跑失败**：typecheck 与 5 个用例报 `connectorStateNamespace` 不存在，根因是主工作区的 Prisma 客户端还是合并前的 schema 生成的；`bun run db:generate` 刷新后全绿——schema 变更合并后必须先重生成客户端。

切片 3 验证（2026-09-23，实际运行）：

- `bun run --cwd apps/web tsc --noEmit` 0 error；`bun run lint:web` 0 error（79 条既有 warning）；`bun run typecheck` 全仓通过。
- 组件实验室 E2E：`bunx playwright test --config playwright.component-lab.config.ts e2e/component-lab/connection-panel.spec.ts` → 2 passed（两行渲染与内联输入的启用/收起；非法 JSON 在本地拦下且表单不清空）。**注意**：跑实验室 dev server 前必须先 `bun run build:packages`，否则 Next 报 `Cannot find module '@cosmos/logging'`。
- 浏览器产品 E2E：`bun run build` 后 `bunx playwright test --config playwright.config.ts e2e/browser/connection-visibility.spec.ts` → 1 passed（真实栈：建连接记录授权范围 → 行上按 `read: true · comment: false` 回显 → 标记失效 → 「错误」徽标 + 原因 → 恢复可用 → 原因回到「未记录」→ 删除用例连接）。
- 未运行：全量浏览器 E2E（其余 spec）、`test:real:*`、Windows smoke、Docker、发布部署。
- 合并后复跑（2026-09-23，主工作区，合并提交 `2cfe379`）：`bun run typecheck` 0、`bun run test` 122 文件／698 用例、`docs:check` 757 文件 0 失败、size 门禁 PASS、`git diff --check` 干净。本片**没有 schema 变更**，所以不需要像切片 2 那样先 `bun run db:generate`。

## Follow-ups

- CollectionPlan / 多采集计划（AUT-010）与 Checkpoint → 按计划的 ConnectorStateStore 迁移。
- 加密-at-rest / OS 凭据库、Secret 轮换/过期/审计，按 ADR-0017 Revisit Gate 评估。
- 真实认证类 Adapter 接入（Bilibili 从 OpenCLI profile 迁到 Connection + SecretRef）。
- Connection Web 面板的 connectorId 校验（改为 catalog 下拉）与「来源 → 连接」的绑定 UI。
- Phase 2 平台面其余切片：Trigger/SDK、OPS-003/004（按既定排序继续）。

切片 3 追加 Follow-ups：

- `scopeJson` 仍只能在**建连接时**写入（`updateConnectionCommandSchema` 不含该字段）；编辑入口随真实认证 Adapter 一起定——那时它由系统写，用户手填的语义要重新裁定。
- 授权范围的形状没有校验（只要求合法 JSON）；真实 Adapter 接入时需要一份 scope schema 才能校验与展示。
- 连接面板仍没有编辑名称/账号的入口（既有边界，未在本片扩大范围）。

切片 2 追加 Follow-ups：

- Workflow 级状态的归属：出现第二个写入方时把 `planId` 泛化为 `ownerKind`／`ownerId`（ADR-0026 Revisit Gate）。
- 删除采集计划的入口出现时，裁定状态行与归属登记的清理语义（当前登记 Cascade、状态行没有删除路径）。
- 导出件落盘保留与清理、加密、签名、定时备份：需要新的需求行再评估。
- `docs/spec/storage/0001-prisma-repository.md` 的模型表此前没有 `ConnectorState`／`ConnectionInstance` 行（本片只补了 `ConnectorState` 与新增的 `ConnectorStateNamespace`）；`ConnectionInstance` 仍缺一行，属既有欠账。
