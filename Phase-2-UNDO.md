# Phase 2 UNDO（未完成清单）

> 复核日期：2026-09-20（2026-09-22 增量：P0 已清空；2026-09-23 增量：P1 已清空）｜ 代码基线：`5cbb670`（2026-09-20 复核时的基线；当前 `master` 为 `8a1b2f2`，与 [`PROJECT-STATUS.md`](PROJECT-STATUS.md) 的最新快照同一基线）
>
> 本文只回答一件事：**按 PRD 口径，Phase 2 还差什么**。按优先级从高到低排列，每条给出「需求要求什么 / 现在实际是什么 / 证据 / 建议下一步」。
>
> 证据等级：**【代码核实】**= 本次直接读了实现、合同或数据库模型；**【文档核实】**= 只读了仓库记录，未运行验证；**【未验证】**= 没有可考察的路径。
>
> 最近更新：2026-09-23（P1-2 交付并合并，**P1 已清空**，见下方「当前暂停点」）

## 一句话结论

Phase 2 的功能主体（十四条切片 + 平台面四块）已交付，§12 四条验收标准里前三条有自动化与真人两层证据。**P0 与 P1 均已清空**——P0-1（AUT-010 多采集计划）、P0-2（AUT-004 的 webhook 形态）与 P1 的三行部分交付需求（ING-012、EXT-006、AUT-009）全部收口。**仍未闭合的是 1 条无法判定的验收条件**（P2-1）、**2 条已 accepted 但未落地的界面决定**（P3-1／P3-2）与 **3 条证据与门禁欠账**（P4）。需求表里 Phase 2 只剩 LIB-004（正文片段字符级锚点，已改标 Phase 3，见附表）。

## 当前暂停点（2026-09-23 更新：P0 与 P1 均已清空）

**P1-2（EXT-006）已交付并合并**：Task [`22`](.agents/tasks/22-connection-state-store/README.md) 的切片 4a／4b 与 Task [`23`](.agents/tasks/23-trigger-sdk/README.md) 的切片 8，`--no-ff` 合并 `da5ae84`，已推送到 `origin` 与 `upstream`。4a 让连接成为登录态载体（OpenCLI profile 进 `ConnectionInstance.configJson`，执行快照随入队冻结连接投影，`feed` 的登录态校验从建目标时改到连接器读投影时）；4b 让登录状态有自动写入方（manifest 的 `auth.probeSupported` 声明驱动探测入口，`connection-probe` Job 由 Worker 执行，结论写回 `status`／`account`／`lastError`／`lastCheckedAt`；ADR [`0027`](docs/adr/0027-connection-login-lifecycle-v1.md) 部分取代 ADR-0017 决策 1）；切片 8 补齐「多 operation 的真实消费者」——operation 可自带配置 schema、canonical 校验按 `(ref, operationId)` 检索、Bilibili 声明第二个 operation `search`（匿名可用）并在 Web 上可选，**没有**数据库迁移也没有新路由，正是「加 Adapter 不改核心表／Worker 专用分支」那条验收。验收中另修掉本片自己的两个缺口（API 的 Source `config` 投影按 connectorId 白名单会丢掉第二个 operation 的字段；侧栏溢出盖住计划列表的确定性布局缺陷）。合并后门禁：单元 124 文件／726 用例、Node 进程 E2E 6 文件／11 用例、组件实验室 19 passed、浏览器整套一次 33 passed、真实来源验收四条全绿（含新增的 `test:real:bilibili-search`：20 条真实搜索结果且不带 profile）、`docs:check` 768 文件 0 失败、size 门禁 PASS、路由表守卫 3/3。

**P0-2（AUT-004 的 webhook 形态）与 P0-1（AUT-010 一个连接下的多个采集计划）已交付并合并**：Task [`23`](.agents/tasks/23-trigger-sdk/README.md) 切片 3–7（`--no-ff` 合并 `da932cd`）与 Task [`33`](.agents/tasks/33-collection-plan/README.md)（`--no-ff` 合并 `4ef3636`）。原始缺口描述、口径裁定与逐条验证证据已随 P0 清空归档到 [`Phase-2-UNDO/history-2026-09-22-p0.md`](Phase-2-UNDO/history-2026-09-22-p0.md)；仍在生效的结论只有两条——AUT-004 的 `event`／`condition`／`dependency` 三种形态属 Phase 3（ADR [`0024`](docs/adr/0024-trigger-forms-v1.md)），AUT-010 迁移的第 4 步 contract 单独排期与授权（ADR [`0023`](docs/adr/0023-collection-plan-v1.md)）。

**本清单的下一个缺口**：P1 已清空。按优先级剩下的是 **P2-1**（§12 第 4 条「重分析不覆盖用户批注和人工关系修正」无法判定，风险会外溢到 Phase 3 的 Knowledge Workflow）、**P3-1／P3-2**（已 accepted 但未落地／未同步的界面决定）与 **P4** 的三条证据与门禁欠账。是否现在处理请维护者裁定。

## 优先级总表

> P0-2（AUT-004 的 webhook 形态）已于 2026-09-22 交付并合并（见「当前暂停点」），因此不再列入下表；P0 已清空。

| 优先级 | 编号 | 缺口 | 性质 | 卡住什么 |
| --- | --- | --- | --- | --- |
| P1 | P1-1 | ING-012：Connector 状态的备份、恢复、迁移与范围隔离 | **已交付并合并 `1b5cabc`** | 已闭合 |
| P1 | P1-2 | EXT-006：manifest 多 operation 声明与登录状态展示 | **已交付并合并 `da5ae84`** | 已闭合；两条验收条件全部满足（凭证载体见下文的如实说明） |
| P1 | P1-3 | AUT-009：连接状态／授权范围／失效原因的可见性与来源绑定入口 | **已交付并合并 `2cfe379`** | 已闭合；验收条件四条全部满足 |
| P2 | P2-1 | §12 第 4 条「重分析不覆盖用户批注和人工关系修正」＋ LIB-003 同类验收 | 无法判定 | Phase 2 验收第 4 条不能宣布通过；风险外溢到 Phase 3 |
| P3 | P3-1 | 界面职责重划：Topic／Entity／用户组织独立面板 | 已 accepted 未落地 | 真人验收第一条结论未解决；PRD／架构／ADR 未同步 |
| P3 | P3-2 | UI 文案专业化 | Proposal 仍 `reviewing` | 真人验收第三条结论未解决 |
| P4 | P4-1 | Phase 2 浏览器用例仍有未归因的间歇失败 | 证据可靠性 | 验收绿灯要打折 |
| P4 | P4-2 | 代码规模红线门禁欠账（8 个文件超 800 行） | 治理欠账 | 门禁口径不完整 |
| P4 | P4-3 | 看板没有撤销 | 观察项、未形成决定 | 真人验收提出，尚无归属 |

---

## P0：完全未交付（2026-09-22 已清空，历史见分册）

P0-2（AUT-004 的 webhook 形态）的原始缺口描述、口径裁定与交付证据已随本轮清空归档到 [`Phase-2-UNDO/history-2026-09-22-p0.md`](Phase-2-UNDO/history-2026-09-22-p0.md)；P0-1（AUT-010）的交付证据在同处与上方「当前暂停点」。

---

## P1：部分交付（验收条件未满足）

### P1-1 ING-012 Connector 状态的备份、恢复、迁移与范围隔离

- **需求要求**（[`part-07-1.md`](docs/requirements/0002-product-requirements/part-07-1.md) §7.4）：状态可备份、恢复、迁移，并按 Connection／Source／Workflow 范围隔离；Secret 不混入普通状态。
- **现状【代码核实】**：已交付的一半是真的——命名空间化、带版本号的状态存储已落地并被内置 RSS 连接器实际使用（保存 ETag／Last-Modified，写入按版本做冲突拒绝）。缺的一半是运维入口：备份只有整库复制（`POST /backups` 走 SQLite `VACUUM INTO`），没有按命名空间导出／恢复／迁移的入口；用户数据导出**明确排除**状态表（测试直接断言导出文本里不含状态值）。
- **影响**：换机、换来源命名空间、状态损坏后重建，目前都只能整库搬；NFR-012「可迁移」在这块没有兑现。
- **建议下一步**：这是一个独立小切片（导出／导入某个命名空间的 JSON + 范围过滤 + 与整库备份的关系说明），不需要新 Proposal，可直接复用 Task 22 或新开 Task。
- **交付（2026-09-23，`--no-ff` 合并 `1b5cabc`）**：讨论中确认了本行原先没写出来的第二个问题——**归属不是数据**：命名空间是宿主按 manifest 模板算出来的字符串，库里没有「这个抽屉属于谁」的记录，所以「按连接导出」必须每次绕道计划表 + 解析模板，「从命名空间反查归属」完全做不到。用户裁定改为表结构方案（而不是每次现算）：新增 `ConnectorStateNamespace`（namespace 主键 + `planId`，migration `20260923120000_connector_state_namespace_owner` 建表并回填默认模板的现状），宿主在解析状态句柄时登记一次；`GET /connector-state/namespaces` 给清单与归属，`GET /exports/connector-state` 按命名空间／计划／连接／来源四选一导出（未归属抽屉只能点名），`POST /imports/connector-state` 默认只补缺失、显式 `overwrite` 时 `version = 本地 + 1`、单抽屉可改名；Web 存储面板提供导出下载与导入上传。决定见 Proposal [`connector-state-export-v1`](docs/proposals/connector-state-export-v1.md)（accepted）与 ADR [`0026`](docs/adr/0026-connector-state-export-v1.md)；实现与验证记录见 Task [`22`](.agents/tasks/22-connection-state-store/README.md) 追加切片 2（全量单元 122 文件／698 用例、Node 进程 E2E 2/2、浏览器 E2E 1 passed、组件实验室 14 passed、`docs:check` 0 失败）。

### P1-2 EXT-006 manifest 多 operation 声明与登录状态展示

- **需求要求**（[`part-07-3.md`](docs/requirements/0002-product-requirements/part-07-3.md) §7.11）：manifest 可以声明多个 Source Operation、认证方式等；Web／API 可以根据声明展示配置**和登录状态**；增加新 Adapter 不需要改核心表或 Worker 专用分支。
- **现状【代码核实】**：声明面已交付（`auth` 与 `operations` 结构齐全，operation 是数组）。缺的是使用面：四个内置 manifest **都只声明了单个 `fetch` 操作**，`auth.kind` 只有「无认证」和「外部」两种，因此「按声明展示登录状态」没有数据可展示——登录状态要等真实认证 Adapter。
- **影响**：结构上支持多 operation，但没有任何一个真实 Adapter 用过；新 Adapter 的能力边界仍未被验证过一次，属于「合同先行、无人消费」。
- **建议下一步**：多 operation 的真正消费者是「一个连接下多个计划」，而 P0-1 已于 2026-09-22 交付（Task 33 的 Bilibili 计划仍只走 `source.bilibili@1` 的单一 `fetch` operation，没有用上多 operation）；本行闭合还差真实认证 Adapter 接入（Bilibili 从外部 profile 迁到连接），那是 Task 22 已登记的后续项。
- **交付（2026-09-23，`--no-ff` 合并 `da5ae84`，已推送 `origin` 与 `upstream`）**：按 Proposal [`connection-login-lifecycle-v1`](docs/proposals/connection-login-lifecycle-v1.md)（accepted）的两个切片落地。**登录状态半边**——4a 让连接成为登录态载体：OpenCLI profile 从来源配置迁进 `ConnectionInstance.configJson`（迁移 `20260923180000_connection_adapter_config`），执行快照随入队冻结连接投影（AUT-016 点名 Connection），`feed` 的「必须有登录态」从建目标时改到连接器读投影时；4b 让登录状态有自动写入方：manifest 的 `auth.probeSupported` 声明驱动探测入口（API 的 409 与 Web 的按钮都按声明判断，不硬编码 connectorId），`connection-probe` Job 由 Worker 执行，结论写回 `status`／`account`／`lastError`／`lastCheckedAt`（迁移 `20260923190000_connection_last_checked_at`）；决定见 ADR [`0027`](docs/adr/0027-connection-login-lifecycle-v1.md)（部分取代 ADR-0017 决策 1）。**多 operation 半边**——Task 23 的切片 8：operation 可自带配置 schema（`null` = 沿用定义级），canonical 校验按 `(sourceDefinitionRef, operationId)` 检索，Bilibili 声明第二个 operation `search`（查询词必填、匿名可用、`discoveryChannel = search`）作为真实消费者，连接器按 `operationId` 分派，Web 出操作选择器；**没有**数据库迁移、没有新路由——这正是「加 Adapter 不改核心表或 Worker 专用分支」那条验收。验收中还修掉本片自己的两个缺口（Source `config` 投影会丢掉第二个 operation 的字段、侧栏溢出盖住计划列表）。逐条门禁与证据见上方「当前暂停点」与 [`ERRATA.md`](docs/requirements/0002-product-requirements/ERRATA.md) 2026-09-23 的 EXT-006 收口行。
- **如实说明（本行收口时仍缺的一半）**：Proposal 决定 4 的**凭证载体只冻结合同、未实现**——没有 `SecretRef` 的第一个真实来源、没有租约（lease）与凭证命令；登录态今天仍是「外部登录态 + 非秘密 profile」，即 Cosmos 自己不持有凭证。因此本行满足的是**两条验收条件**（Web／API 按声明展示配置和登录状态；加 Adapter 不改核心表／Worker 分支），不是「Cosmos 自己管理凭证」。真实凭证来源仍是 Task 22 的 Follow-up，也是 `PROJECT-STATUS.md`「尚未实现」里的一条。

### P1-3 AUT-009 连接状态／授权范围／失效原因的可见性与来源绑定入口

> **本条是本次复核新增登记的**：PROJECT-STATUS 与勘误台账此前都没有把 AUT-009 列为未闭合行。

- **需求要求**（[`part-07-1.md`](docs/requirements/0002-product-requirements/part-07-1.md) §7.1）：用户可以创建可复用的连接，并让多个来源／采集计划引用同一个连接；**用户能看到连接状态、授权范围和失效原因**；撤销凭证不删除已录入历史。
- **现状【代码核实】**：连接对象、凭证存储、API 与「撤销凭证不删历史」都已交付。产品界面仍缺一半：连接面板只显示**状态徽标、名称和账号**，不显示授权范围（`scopeJson`）与失效原因（`lastError`）。**绑定入口已由 2026-09-22 的采集计划 v1 补上**（Task 33 切片 2／3：新建采集计划时可选连接，计划列表按连接分组），本行剩下的只有连接自身的可见性面板。
- **影响**：用户看得到「已过期／错误」，看不到为什么；连接复用在产品面上不可操作，等于半个功能只有接口可用。
- **建议下一步**：小切片即可（连接面板补授权范围与失效原因两行），可与 P1-1 同批；若维护者认为「授权范围／失效原因」要等真实认证 Adapter，则应像 EXT-006 一样登记进勘误台账，而不是留成一条静默的部分交付。
- **交付（2026-09-23，`--no-ff` 合并 `2cfe379`）**：复核时发现缺口比本行写的更深一层——面板确实缺两行，但**这两个字段今天没有任何自动写入方**（`scopeJson` 只在建连接时可写、Web 表单没有这个输入框；`lastError` 只有 `PATCH /connections/:id` 能写，全仓只有测试调用过），所以只补显示等于两行永远为空。用户裁决走「显示 + 补写入路径」，且**只用现有合同**（`createConnection.scopeJson`、`updateConnection.status`/`lastError`），因此不需要 Proposal、不改公共 DTO：建连接可填授权范围（要求合法 JSON、提交前规范化），每行显示授权范围（顶层标量对象按 `键: 值` 渲染）与失效原因（空值「未记录」），行内可「标记失效」（填原因 → `status=error`）与「恢复可用」（`status=active` + 清空原因）。实现与验证记录见 Task [`22`](.agents/tasks/22-connection-state-store/README.md) 追加切片 3（web typecheck 0、组件实验室 E2E 2 passed、浏览器产品 E2E 1 passed）。AUT-009 的四条验收条件（可创建可复用连接并被多个来源／计划引用、能看到状态／授权范围／失效原因、撤销凭证不删历史、普通配置与日志不含凭证明文）至此全部满足；「真实认证 Adapter 自动写这两个字段」仍属 P1-2。

---

## P2：验收条件无法判定（风险会外溢到 Phase 3）

### P2-1 §12 第 4 条「重分析不覆盖用户批注和人工关系修正」＋ LIB-003 同类验收

- **需求要求**（[`part-10-12.md`](docs/requirements/0002-product-requirements/part-10-12.md) §12 Phase 2 验收第 4 条）：重分析不覆盖用户批注和人工关系修正。LIB-003 的验收是同一件事的另一种说法：「重新分析、重新索引或刷新 Artifact 后，用户数据不丢失」。
- **现状【代码核实】**：Phase 2 里**没有任何自动重分析写入路径**（自动聚类、知识处理已改标 Phase 3），所以这条验收目前只是「结构上成立」，从未被真正考验：既没有保护合同，也没有对应回归测试。全仓检索不到任何「人工字段保护」「人工修正优先」的实现或测试。
- **风险**：Phase 3 的 Knowledge Workflow 一旦开始写入，这条验收标准会**第一次被真正使用**——而那时它没有判据、没有测试，等于以未定义行为落地；一旦自动结果覆盖了人工修正，就是数据损坏级问题（NFR-004 数据完整性）。
- **建议下一步**：把「用户真相保护」写成 Phase 3 的**入口硬前置**——先定合同（哪些字段人工优先、自动结果如何降级为建议）与回归测试，再开 Knowledge Workflow 的实现。这比事后补测试便宜得多。

---

## P3：已 accepted 但未落地／未同步的决定

### P3-1 界面职责重划：Topic／Entity／用户组织独立面板

- **来源**：2026-09-15 真人验收的第一条结论（功能全部堆在 Story 面板）；Proposal [`ui-surface-ownership-v1.md`](docs/proposals/ui-surface-ownership-v1.md) 已 **accepted**（六项裁定），实现尝试因布局问题当日作废。
- **现状【代码核实】**：Proposal 要求的三项稳定文档改动在 `master` 上都没有执行——PRD §8 里没有「Topic 页／Entity 页／用户组织页」的注记，架构 §11.4 没有「深入页 v1 落地范围」的注记，`docs/adr/` 里没有对应的 ADR，仓库里也没有承接实施的 Task（作废分支 `feat/t25-ui-surface-ownership` 在本地与远端均已不存在）。
- **影响**：这不是「UI 还没重做」那么简单——**已接受的架构决定没有沉淀**。下次重做 UI 时，三层分工（首页看／独立页面管／Story 抽屉读）与「同一件事只有一个可写入口」只能从 Proposal 里重新考古，容易被重新讨论甚至推翻。
- **建议下一步**：把「落地 UI」和「记录决定」拆开。UI 重做按维护者节奏排期；但 PRD／架构注记与 ADR 属于已 accepted 决定的记录义务，可以现在就低成本补上。

### P3-2 UI 文案专业化

- **来源**：真人验收第三条结论；Proposal [`ui-copy-review-v1.md`](docs/proposals/ui-copy-review-v1.md) 维持 `reviewing`。
- **现状【文档核实】**：判据 R0（展示名必须忠实反映概念的实际意义）已确立，术语对照表 v1 的 A–E 组已逐行裁定、可直接执行；未接受的是判据 R1–R5 本身、术语表的落点与实施归属。执行面还有一个硬约束：5 个浏览器 spec 里有约 205 处断言按文案定位，改文案必须与断言同批修改。
- **推论（未获维护者确认）**：界面整体重做在前，逐屏文案批次应与之同批后置——否则要改两遍。
- **建议下一步**：先只裁定 R1–R5 与落点（不写代码），让 Proposal 离开 `reviewing`；实施与 P3-1 的 UI 重做同批。

---

## P4：证据与门禁欠账

### P4-1 Phase 2 浏览器验收仍有未归因的间歇失败

- **现状【文档核实】**：`phase2-organization.spec.ts:103`（证据关系反向视图等待超时）与 `:417`（用户组织场景耗时异常）仍未归因；`ingest.spec.ts:119` 的 `toBeFocused`（关抽屉后焦点未归还触发按钮）与 `media-policy.spec.ts` 的来源健康行等待超时只在「整轮变慢」的运行里出现。根因已查清并修掉的三条（`:539` 重复 key、陈旧刷新竞态，以及 2026-09-23 查明的 `webhook-entry.spec.ts` 点击被溢出的连接面板拦截——那一次**不是抖动而是确定性布局缺陷**）见 Task 30 与 Task 22／23 的记录。症状、观察次数与建议次序只在 [`known-unstable-cases.md`](docs/testing/known-unstable-cases.md) 维护（2026-09-23 补记了两次整套运行的观察）。
- **影响**：Phase 2 的浏览器验收绿灯目前是「重跑／单跑即过」的结论，不是稳定绿灯；同一份记录里还怀疑与「SQLite WAL／busy timeout 未显式配置」同根因。
- **建议下一步**：按该文件第 1 条的建议次序先做诊断（WAL 与 busy timeout 显式配置 + 记录请求与提交顺序），再决定是修测试环境隔离还是按 Bug 处理。**不要用重跑结案。**

### P4-2 代码规模红线门禁欠账

- **现状【代码核实】**：代码规模治理的行数阈值没有进门禁（G 系列治理任务暂停时留下的欠账）。本次实际扫描：**8 个源码文件超过 800 行红线**——`packages/application/src/workflow-host-runtime.ts`（1125）、`packages/worker-admin/src/index.ts`（982）、`apps/web/src/components/cosmos/board-view.tsx`（917）、`apps/web/src/component-lab/product-fixtures.tsx`（903）、`packages/application/src/media-acquisition.ts`（868）、`packages/storage-prisma/src/workflow-backend.ts`（844）、`apps/worker/src/workflow-ingest.test.ts`（824）、`apps/web/src/components/cosmos/story-panel.tsx`（813）。其中三个是 Phase 2 的 Web 文件（看板、Story 面板、组件实验室夹具）。
- **说明**：文档体积门禁本身是好的——本次按 CI 口径实跑 `python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new`，结果 **PASS（含 6 条基线内增长 warning）**。欠的是**代码行数**这一轨。
- **建议下一步**：属治理任务（G 系列），不随 Phase 2 尾巴顺带做；重启时优先拆 Phase 2 新增的三个 Web 文件，它们同时是 P3-1 界面重做的改动对象。

### P4-3 看板没有撤销

- **现状【代码核实】**：看板编辑只有「上移／下移／拖拽／移到／隐藏／复制／删除」，没有撤销入口；真人验收脚本 D 流程专门问过「改错一步能不能撤销（当前没有撤销）」，记录表里没有形成决定（只确认了拖拽排序必做，拖拽已于 2026-09-16 交付）。
- **影响**：删除区块虽不删底层信息（已真人验证），但误操作只能手工重建区块配置。
- **建议下一步**：属「说得清但不好用」，按准入规则需要先出 Proposal 或明确记入 Phase 3 之后的切片；**不建议**在没有决定的情况下直接实现。

---

## 附：已裁定后置，不计入本次缺口

以下项目容易与上面的缺口混淆，但都已有明确裁定，列在此处只为避免重复讨论：

| 项目 | 归属／裁定 | 依据 |
| --- | --- | --- |
| BRD-006 的「排序配置」 | Phase 4（推荐体系） | [`ERRATA.md`](docs/requirements/0002-product-requirements/ERRATA.md) 2026-09-18 |
| BRD-007 的「差异对比」与 Agent 产物 | Phase 3 | 同上 |
| REC-008 相关内容的服务端排序与更大候选集 | Phase 4 | Task 15 Non-goals |
| LIB-005「未读」过滤 | Phase 4（依赖 Read State） | ERRATA 2026-09-16 |
| ORG-021 与 ORG-003／004／022 的**自动半边** | Phase 3（依赖 Knowledge Workflow、Agent 候选 Revision、预算模型） | ERRATA 2026-09-15／09-18 |
| ING-009 剩余五项 | 逐项已定归属：历史回填冻结、音视频实体→Phase 4、数量上限与默认值 env 化→Phase 3 | ERRATA 2026-09-18 |
| 跨分区拖拽 | **不做**（分区是「关注方面」语义容器，跨区重归类保留显式「移到」入口） | ADR-0010 决定 7 |
| 移动端 390px 适配 | 暂停（PC 优先），恢复条件写在 `e2e/support/viewports.ts` | PROJECT-STATUS 当前运维边界 |
| Entity merge／dedup | 未纳入 Phase 2 验收，仍开着 | PROJECT-STATUS「本次未纳入、仍开着的项」 |
| Docker／Compose、发布部署、真实公网长时定时抓取、非 Windows smoke、长时故障恢复 | Phase 1 后置债，按 2026-09-07 划线保留 | PROJECT-STATUS「本次未纳入、仍开着的项」；其中 Docker／Compose 于 2026-09-23 **首次实跑并失败**（镜像构建缺 Prisma client 生成步骤），根因与修复候选见 [`docs/research/2026-09-23-docker-acceptance-run.md`](docs/research/2026-09-23-docker-acceptance-run.md)，修复待单开 Task |
| LIB-004 的正文片段字符级锚点与 Artifact 批注目标 | 已改标 Phase 3（批注目前只能挂整条 Story／Entry／Topic） | PROJECT-STATUS Phase 2 尾巴遗留状态 |

---

## 复核方法与证据边界

**本次做了什么**

- 通读 PRD §12 Phase 2 与 §7 需求表（全部仍标 `Phase 2` 的 37 行逐行过一遍）、勘误台账 [`ERRATA.md`](docs/requirements/0002-product-requirements/ERRATA.md)、[`PROJECT-STATUS.md`](PROJECT-STATUS.md) 与 Task 15／22／23／24 的记录。
- 对每条缺口做了代码侧交叉验证：触发器类型枚举、调度绑定唯一约束、数据库模型清单、四个内置 manifest 的 operation 声明、批注目标类型枚举、用户数据导出的排除项、连接面板渲染字段、看板拖拽实现、Web 路由清单。
- 实跑一条门禁：`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` → **PASS（含 warning）**；另按行数口径扫描源码得到 8 个超红线文件（见 P4-2）。

**未运行**

- `bun run typecheck`、`bun run test`、`bun run build`、`docs:check`、浏览器与 Node 进程 E2E 均未在本次复核中运行（本次是文档复核，未改代码）。上一次全量证据仍是 PROJECT-STATUS 记录的 2026-09-20 那一轮。
- 205 处「按文案定位的断言」未逐条核对，按 PROJECT-STATUS 与 Proposal 的记载引用。
- 8 个超红线文件的行数按本次扫描结果列出，未逐个评估拆分方案。

**复核结论的适用范围**

- 本文是**缺口台账**，不替代 [`PROJECT-STATUS.md`](PROJECT-STATUS.md)（当前快照与有效决定）和 [`ERRATA.md`](docs/requirements/0002-product-requirements/ERRATA.md)（需求表口径更正）。三者的关系：PROJECT-STATUS 记现状，ERRATA 记需求表怎么读，本文记还差什么。
- 本文新登记的 AUT-009 部分交付（P1-3）此前不在任何清单里：**已由维护者裁定并同步**——AUT-009 与 ING-012、EXT-006 的收口都已进 ERRATA 与 PROJECT-STATUS。

**2026-09-23 增量的边界（只改台账，未做新复核）**

- 本次只做两件事：把 P1-2（EXT-006）从「部分交付」改成已交付（证据取自该片的合并前验证与合并后主工作区门禁），以及把 P4-1 的间歇失败清单按当天的实际观察更新（新增 `ingest.spec.ts:119`，并把已查明为确定性布局缺陷的 `webhook-entry` 从「间歇」里剔除）。
- 没有重跑 P2／P3／P4-2／P4-3 的判定依据；它们的证据等级与「未运行」清单仍是 2026-09-20 复核时的那一份，除 P4-1 外未更新。需求表逐行复核（37 行）也没有重做——那一轮的结论仍以 ERRATA 为准。
