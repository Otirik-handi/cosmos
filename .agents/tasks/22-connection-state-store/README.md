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

切片 4（2026-09-23，连接登录生命周期）按 Proposal [`connection-login-lifecycle-v1`](../../../docs/proposals/connection-login-lifecycle-v1.md)（accepted）的「切片 1」再拆两半：**4a 连接承载 profile**、**4b 登录探测**。EXT-006 由本 Task 的 4a/4b 与 Task 23 的切片 2（per-operation 配置 schema + Bilibili `search`）共同闭合。

- 生命周期阶段（切片 4a）：**代码、验证与权威文档同步完成**（2026-09-23；worktree `.worktree/ext-006-login-lifecycle`、分支 `feat/t22-ext-006-login-lifecycle`，基线 `61ac764`）。剩余动作是**合并**（需维护者授权）与合并后的 `PROJECT-STATUS.md` 更新（沿用仓库惯例：进行中的状态记在 Task，合并后写状态快照）。
- 连贯目标（切片 4a）：让「连接」在运行时真实存在——`ConnectionInstance` 新增非秘密适配器配置字段，OpenCLI profile 从 `Source.config.profile` 迁到连接，执行快照带连接投影，连接器从连接读 profile。
- 可观察验收（切片 4a，≤3 条）：
  1. 迁移后来源配置不再有 `profile`；同一 profile 的多个来源合并到同一条连接，且这些计划的 `connectionId` 指向它；迁移可重复执行且结果相同；
  2. `feed` 的「必须有登录态」校验从「配置里必须有 profile」改为「来源必须绑定有用 profile 的连接」，绑定后连接器收到的 profile 与迁移前一致（既有连接器行为测试不改断言）；
  3. 执行快照冻结当轮连接的 `{id, connectorId, configJson}`，排队后再改连接配置不改变已创建 Run 的输入（AUT-016）；公开 DTO、Job payload 与日志里没有凭证明文（本片不引入凭证）。
- 依赖：Proposal（accepted）；ADR-0017 决策 1（本片部分取代它）；Task 33（计划持有 `connectionId`）。
- 受影响合同（切片 4a）：contracts（`connectionInstanceSchema` + 创建/更新命令、`sourceExecutionSnapshotSchema` 的连接投影、Bilibili canonical config schema 去掉 profile）；storage（Prisma 加列 + 三段式迁移 + 投影填充）；`plugins/collectors`（Bilibili 读连接而非 `config.profile`）；API（`toPublicSource` 的连接投影与命令校验）。
- 验证层级（切片 4a）：focused（contracts/storage/collectors/api）→ 全量 `bun run test` → 真实来源 `test:real:bilibili`（需本机 OpenCLI，不满足则记未运行）→ `docs:check` 与 size 门禁。
- **本轮假设与后果（实施前记录）**：AUT-016 明确写「排队后修改 Source、**Connection** 或 Workflow 配置不会改变已创建 Run 的输入」，因此连接的非秘密配置必须**随入队冻结进执行快照**，而不是抓取时现查库。后果有二：①`sourceExecutionSnapshotSchema`（以及产品读投影 `sourceSnapshotSchema`）要带连接投影，且冻结的是身份与非秘密配置，**不含** `status`/`lastError` 这类活诊断；②未保存配置的 `source-config-probe` 路径没有连接，`feed` 的登录态校验因此会改变该入口的语义——本片裁定处理方式并在此记录。

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

切片 4a 追加：

- **连接投影随入队冻结，不是抓取时查库**：AUT-016 明确写「排队后修改 Source、**Connection** 或 Workflow 配置不会改变已创建 Run 的输入」，所以执行快照带 `{id, connectorId, configJson}`；只冻身份与非秘密配置，`status`/`lastError` 这类活诊断不进（冻下来只会让后来读它的人以为那是当轮状态）。
- 连接投影在 schema 里是 `.optional()` 而不是 required-nullable：未保存配置的探测与 legacy 路径**真的没有连接**，与本文件已记录的 `sourceSnapshotSchema.connectionId` 同一理由。
- **迁移里「复用已存在的同 profile 连接」不可达**：`configJson` 是本迁移才加的列，迁移前不可能有连接带着 profile，所以去重只靠确定性 id（`connection:bilibili:<profile>`）+ `INSERT OR IGNORE`；没有为测不到的分支写测试，也不留那段代码。
- **行为变化（用户可见）**：`feed` 的「必须有登录态」判断从**建目标时**（配置 schema 要求 `config.profile`）推迟到**测试配置/抓取时**（连接器读连接投影）。原因是 profile 已不在配置里，而只有连接器知道 `mode=feed` 需要登录态；在 API 里写 Bilibili 专用判断正是 EXT-006 要消灭的「核心表/Worker 专用分支」。`apps/api` 的旧用例按新合同重写，collectors 侧新增正反两向断言。
- 墓碑（`deletedAt` 非空）来源的配置**不改写**：它是历史记录，且已删除的目标不会再抓取；只有 live 来源参与建连接、补绑定与移除 profile。
- 只读回调而非仓储：`SourceConfigProbeService` 仍旧拿不到 `CosmosRepository`，「未保存配置的探测结构上无法持久化」这条性质不变。

## Implementation Walkthrough

> 切片 1 与切片 2 的实施步骤已归档到 [`readme/slices-2026-09-10-23.md`](readme/slices-2026-09-10-23.md)（历史，只搬位置，不改内容）。

切片 3（2026-09-23，连接可见性）的实施步骤已归档到 [`readme/slices-2026-09-23.md`](readme/slices-2026-09-23.md)（历史，只搬位置）。

切片 4a（2026-09-23，连接承载 profile）：

1. **contracts**：`connectionInstanceSchema` 增 `configJson`（+ 创建/更新命令各增可选字段）；新增 `sourceConnectionProjectionSchema` 并挂到 `sourceExecutionSnapshotSchema.connection`；`bilibiliSourceConfigSchema` 去掉 `profile` 与 feed 条件必填；`sourceConfigProbeCommandSchema` 增可选 `connectionId`；profile 的格式规则提为 `openCliProfileSchema` 并从包入口导出（`entry-surface.txt` 显式重生成，+1 值 +1 类型）。
2. **Prisma + 迁移** `20260923180000_connection_adapter_config`：`ConnectionInstance` 加 `configJson` 列；按 profile 建连接（确定性 id `connection:bilibili:<profile>` + `INSERT OR IGNORE`）、计划只在 `connectionId` 为空时补绑定、从 live 来源配置 `json_remove` 掉 `profile`。
3. **storage**：`createConnection`/`updateConnection` 写 `configJson`；`toConnectionSnapshot` 带出它；`toSourceSnapshot` 的计划查询 `include: { connection: true }` 并填冻结点。
4. **collectors**：profile 从连接投影读（与本文件同期搬走的合同规则共用 `openCliProfileSchema`），`feed` 需要「带 profile 的连接」、`hot` 仍匿名可用；新增断言证明 profile 到达版本检查、doctor 与业务命令三条子进程调用。
5. **application**：`SourceConfigProbeService` 增只读 `resolveConnection` 回调（服务仍拿不到仓储），未保存配置的探测把连接投影交给连接器；给了连接却解析不到按 `invalid_configuration` 拒绝。
6. **API**：`POST /source-config-probes` 对 `connectionId` 做存在性检查（与 `createSource` 同例 404）；`toPublicSource` 的 Bilibili 白名单去掉 `profile`。
7. **Worker**：`configProbe` 注入读连接的解析器。
8. **Web**：连接面板增「适配器配置」输入（本地 JSON 校验、提交前规范化、非法则拦下且不清空表单）与每行的「适配器配置」展示；来源表单发探测请求时带上所选连接。来源表单的 profile 输入框随 manifest 消失（`catalog.ts` 的 `configurationSchema` 与组件实验室夹具同步）。
9. **夹具与脚本**：组件实验室连接夹具、transport 连接夹具、`apps/api` 的建目标用例（按新合同重写）、collectors 夹具、浏览器 E2E（连接表单填 profile + 回显断言）、`scripts/e2e/real-bilibili-plans.ts`（profile 进连接的 `configJson`）、`real-source.ts` 的 `bilibili-hot` 配置。
10. **权威文档同步**：`docs/spec/contracts/0001`（连接 DTO 的 `configJson`、执行快照的 `connection` 投影、探测命令的 `connectionId`、Bilibili 配置去掉 profile）、`application/0001-connector-runtime`（冻结的连接投影与探测的只读 `resolveConnection`）、`application/0004-manifest-catalog`（Bilibili 配置属性表）、`connectors/0002-managed-collectors`（profile 归连接的输入表、feed 的连接要求与重建验收 3/7）、`interfaces/0002-product-api-http`（`configJson` 与探测的 `connectionId`／404）、`interfaces/0005-web-client`（表单不再收适配器配置、探测带连接、连接面板的适配器配置输入与展示）、`storage/0001-prisma-repository`（补上缺失的 `ConnectionInstance` 模型行并记 `configJson`）、`docs/api/` 的 Draft 两处现状注记、架构 §4.2、新增 ADR [`0027`](../../../docs/adr/0027-connection-login-lifecycle-v1.md)（含 ADR-0017 的「部分取代」与 ADR-0018 Revisit Gate 的命中标注）与勘误台账的 §12 口径注记。

## Verification / Gate

> 切片 1 与切片 2 的验证记录（含合并后复跑）已归档到 [`readme/slices-2026-09-10-23.md`](readme/slices-2026-09-10-23.md)。

切片 3 验证（2026-09-23，实际运行）已归档到 [`readme/slices-2026-09-23.md`](readme/slices-2026-09-23.md)。

切片 4a 验证（2026-09-23，实际运行）：

- `bun run build:packages` → `bun run typecheck` 全仓 **0 error**；`bun run lint:web` **0 error**（79 条既有 warning）。
- 全量单元测试 `bun run test`：**123 文件 / 704 用例全部通过**（切片 3 基线 122 文件 / 698 用例；本片新增 1 个测试文件与 6 个用例——contracts `connection.test.ts` +1、`source.test.ts` +2、application `connector-probe.test.ts` +2、storage `connection-adapter-config-backfill.test.ts` +1）。
- 迁移回填用例按真实迁移顺序两段式部署（`20260923120000_connector_state_namespace_owner` → 全部），断言：同一 profile 的两个来源收敛到同一条连接、另一个 profile 单独一条、匿名来源既不建连接也不绑定、来源配置里的 profile 被移除、墓碑来源的配置与绑定原样、RSS 计划不受影响。
- 浏览器产品 E2E：`bun run build` 后 `bunx playwright test --config playwright.config.ts e2e/browser/collection-plan-connectors.spec.ts` → **2 passed**（连接表单填适配器配置 → 行上按 `profile: chrome-main` 回显 → 同一连接下建出 hot/feed 两个计划）。
- 组件实验室 E2E：`bunx playwright test --config playwright.component-lab.config.ts e2e/component-lab/connection-panel.spec.ts` → **3 passed**（新增一例：非法 JSON 的适配器配置在本地被拦下且表单不清空）。
- `bun run docs:check`：754 文件 0 失败；`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` PASS；`git diff --check` 干净。
- **环境事实（本片踩到并记录）**：新建 worktree 里没有 `node_modules/@cosmos/*`，包名导入会沿目录回溯到**主工作区**的 workspace 包，于是 worktree 里的类型检查与跨包测试实际测的是主工作区的代码（假绿灯、假红灯）。正确顺序是 worktree 内 `bun install --frozen-lockfile` → `bun run db:generate`（install 会覆盖刚生成的 Prisma 客户端）→ `bun run build:packages` → 才跑 typecheck/测试。锁文件未被改动。
- 未运行：`test:real:bilibili`／`test:real:rss` 真实来源验收（需要本机 OpenCLI + Browser Bridge，本片改了 feed 的登录态来源，建议合并前在本机跑一次）、Windows smoke、Docker、发布部署；Node 进程 E2E 未新增配置探测用例（该路径由 `connector-probe.test.ts` 的行为测试覆盖）。

## Follow-ups

- CollectionPlan / 多采集计划（AUT-010）与 Checkpoint → 按计划的 ConnectorStateStore 迁移。
- 加密-at-rest / OS 凭据库、Secret 轮换/过期/审计，按 ADR-0017 Revisit Gate 评估。
- 真实认证类 Adapter 接入（Bilibili 从 OpenCLI profile 迁到 Connection + SecretRef）。
- Connection Web 面板的 connectorId 校验（改为 catalog 下拉）与「来源 → 连接」的绑定 UI。
- Phase 2 平台面其余切片：Trigger/SDK、OPS-003/004（按既定排序继续）。

切片 4a 追加 Follow-ups：

- **「连接变更后作废探测结果」没有实现**：既有代码里 `watchedConfig`／`watchedScheduleInterval` 只声明未使用（属既有 lint warning），`probeConfigKeyRef` 实际只是「有没有在跑的探测」标志；连接现在也影响探测结果，应与配置一并纳入作废条件。
- 连接面板**只在建连接时**能写 `configJson`（命令已支持 `updateConnection.configJson`，面板没有编辑入口）；填错 profile 的用户今天只能删了重建。编辑入口与切片 4b 的登录探测一起定——那时系统会读它，改错要能改。
- `configJson` 只要求「合法 JSON」，profile 的形状由连接器读时裁决；接入更多 Adapter 时需要一份 per-connector 的连接配置 schema（与 `sourceConfigurationSchemas` 同构）。

切片 3 追加 Follow-ups：

- `scopeJson` 仍只能在**建连接时**写入（`updateConnectionCommandSchema` 不含该字段）；编辑入口随真实认证 Adapter 一起定——那时它由系统写，用户手填的语义要重新裁定。
- 授权范围的形状没有校验（只要求合法 JSON）；真实 Adapter 接入时需要一份 scope schema 才能校验与展示。
- 连接面板仍没有编辑名称/账号的入口（既有边界，未在本片扩大范围）。

切片 2 追加 Follow-ups：

- Workflow 级状态的归属：出现第二个写入方时把 `planId` 泛化为 `ownerKind`／`ownerId`（ADR-0026 Revisit Gate）。
- 删除采集计划的入口出现时，裁定状态行与归属登记的清理语义（当前登记 Cascade、状态行没有删除路径）。
- 导出件落盘保留与清理、加密、签名、定时备份：需要新的需求行再评估。
- `docs/spec/storage/0001-prisma-repository.md` 的模型表此前没有 `ConnectorState`／`ConnectionInstance` 行（本片只补了 `ConnectorState` 与新增的 `ConnectorStateNamespace`）；`ConnectionInstance` 仍缺一行，属既有欠账。
