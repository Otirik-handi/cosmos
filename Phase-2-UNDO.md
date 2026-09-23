# Phase 2 UNDO（未完成清单）

> 复核日期：2026-09-20（2026-09-22 增量更新：P0-1 与 P0-2 已闭合）｜ 代码基线：`5cbb670`（2026-09-20 复核时的基线；当前 `master` 为 `89f86c4`，与 [`PROJECT-STATUS.md`](PROJECT-STATUS.md) 的最新快照同一基线）
>
> 本文只回答一件事：**按 PRD 口径，Phase 2 还差什么**。按优先级从高到低排列，每条给出「需求要求什么 / 现在实际是什么 / 证据 / 建议下一步」。
>
> 证据等级：**【代码核实】**= 本次直接读了实现、合同或数据库模型；**【文档核实】**= 只读了仓库记录，未运行验证；**【未验证】**= 没有可考察的路径。
>
> 最近更新：2026-09-22（P0-1 与 P0-2 均已交付并合并，见下方「当前暂停点」）

## 一句话结论

Phase 2 的功能主体（十四条切片 + 平台面四块）已交付，§12 四条验收标准里前三条有自动化与真人两层证据。**仍未闭合的是 3 行需求（全部为部分交付）和 1 条无法判定的验收条件**；另有 2 条已 accepted 但未落地的界面决定、3 条证据与门禁欠账。P0-1（AUT-010 一个连接下的多个采集计划）与 P0-2（AUT-004 的 webhook 形态）均已交付并合并，**P0 已清空**。

## 当前暂停点（2026-09-22 更新：P0-1 与 P0-2 均已交付）

**P0-2（AUT-004 的 webhook 形态）已交付并合并**：Task [`23`](.agents/tasks/23-trigger-sdk/README.md) 的切片 3–7，`--no-ff` 合并 `da932cd`。先按 2026-09-22 的口径裁定收窄——Phase 2 只欠 `webhook` 形态，`event`／`condition`／`dependency` 记 Phase 3（ADR [`0024`](docs/adr/0024-trigger-forms-v1.md)）；实现为「一个计划可持有多个触发器」（ADR [`0025`](docs/adr/0025-multi-trigger-per-plan.md)，取代 ADR-0018 的单绑定口径）＋入口标识与凭证（凭证进 SecretStore、明文只回显一次）＋独立于 `/api/v1` 的 inbound 端点（体积上限、速率上限、常量时间凭证校验、事件标识幂等）＋计划面板入口＋真实消费者验收。合并后门禁：单元 119 文件／685 用例、Node 进程 E2E 6 文件／11 用例、浏览器 E2E 29 用例、真实来源 `test:real:entry`（真实外网 RSS 经入口触发，20 条条目、证据匹配）全绿。

**P0-1（AUT-010 一个连接下的多个采集计划）已交付并合并**：Task [`33`](.agents/tasks/33-collection-plan/README.md)，`--no-ff` 合并 `4ef3636`。v1 形态按 ADR [`0023`](docs/adr/0023-collection-plan-v1.md)——`CollectionPlan` 与采集目标一对一，持有连接、触发器、媒体预算、计划级 checkpoint 与状态命名空间；迁移按 expand／backfill／read switch 落地，第 4 步 contract 单独排期与授权（不纳入该 Task）。产品面从「来源健康」改造为按连接分组的「采集计划」，新建计划可选连接与连接器、字段按 manifest 声明渲染。Task 33 的验证：全量测试 116 文件 / 656 用例、Node 进程 E2E 5 文件 / 6 用例、浏览器 E2E 28 用例全绿；真实来源验收 `test:real:bilibili` 在同一连接下跑通 hot 与 feed 两个 Bilibili 计划（各 `itemCount=20`，连续两次 exit 0）。过程、偏差与未运行项见 Task 33 walkthrough。

**本清单的下一个缺口**：按优先级从 P1-1（ING-012 状态备份／恢复／迁移）或 P1-3（AUT-009 连接可见性面板）继续；顺序尚未排定。

## 优先级总表

> P0-2（AUT-004 的 webhook 形态）已于 2026-09-22 交付并合并（见「当前暂停点」），因此不再列入下表；P0 已清空。

| 优先级 | 编号 | 缺口 | 性质 | 卡住什么 |
| --- | --- | --- | --- | --- |
| P1 | P1-1 | ING-012：Connector 状态的备份、恢复、迁移与范围隔离 | 部分交付 | 该行验收条件未满足 |
| P1 | P1-2 | EXT-006：manifest 多 operation 声明与登录状态展示 | 部分交付 | 该行验收条件未满足 |
| P1 | P1-3 | AUT-009：连接状态／授权范围／失效原因的可见性与来源绑定入口 | 部分交付（本次新增登记） | 该行验收条件未满足，此前未记入任何清单 |
| P2 | P2-1 | §12 第 4 条「重分析不覆盖用户批注和人工关系修正」＋ LIB-003 同类验收 | 无法判定 | Phase 2 验收第 4 条不能宣布通过；风险外溢到 Phase 3 |
| P3 | P3-1 | 界面职责重划：Topic／Entity／用户组织独立面板 | 已 accepted 未落地 | 真人验收第一条结论未解决；PRD／架构／ADR 未同步 |
| P3 | P3-2 | UI 文案专业化 | Proposal 仍 `reviewing` | 真人验收第三条结论未解决 |
| P4 | P4-1 | Phase 2 浏览器用例仍有未归因的间歇失败 | 证据可靠性 | 验收绿灯要打折 |
| P4 | P4-2 | 代码规模红线门禁欠账（8 个文件超 800 行） | 治理欠账 | 门禁口径不完整 |
| P4 | P4-3 | 看板没有撤销 | 观察项、未形成决定 | 真人验收提出，尚无归属 |

---

## P0：完全未交付（2026-09-22 已清空）

### P0-2 AUT-004 事件类触发 → 已交付（webhook 形态）

- **需求要求**（[`part-07-1.md`](docs/requirements/0002-product-requirements/part-07-1.md) §7.1）：Trigger 可由 Webhook、内部事件、条件变化或上游 Workflow 结果触发；每次触发保存触发原因、输入、时间和对应定义版本。
- **当时的现状【代码核实】**：触发器类型枚举只有「定时」和「手动」两种，代码注释明确写着 Webhook、内部事件与上游 Workflow 触发**已推迟**（`packages/contracts/src/base.ts` 的 `triggerKindSchema`）。Task 23 的标题写了 AUT-004，实际交付的是「单绑定 schedule／manual」这一半。
- **裁定（2026-09-22）**：按 ADR [`0024`](docs/adr/0024-trigger-forms-v1.md) 收窄——Phase 2 只交付 `webhook`，`event`／`condition`／`dependency` 记 Phase 3。裁定同时纠正了本文原先的判断：`event`／`condition` 并不依赖 Phase 3 的交付物（它们缺的是订阅分发与条件求值），只有 `dependency` 真依赖用户自定义 Workflow 产品面；三者后置的理由是价值峰值在 Knowledge Workflow 之后，而不是依赖关系。
- **交付**：Task [`23`](.agents/tasks/23-trigger-sdk/README.md) 切片 3–7，合并 `da932cd`（入口端点、一计划多触发器 ADR [`0025`](docs/adr/0025-multi-trigger-per-plan.md)、计划面板入口、真实消费者验收）；证据见 [`ERRATA.md`](docs/requirements/0002-product-requirements/ERRATA.md) 2026-09-22 的三条记录与 Task 23 的验证段。
- **剩余**：三种形态仍属 Phase 3；`dependency` 依赖用户自定义 Workflow 产品面，`event`／`condition` 依赖订阅分发与条件求值（见 ADR-0024 的 Revisit Gate）。

---

## P1：部分交付（验收条件未满足）

### P1-1 ING-012 Connector 状态的备份、恢复、迁移与范围隔离

- **需求要求**（[`part-07-1.md`](docs/requirements/0002-product-requirements/part-07-1.md) §7.4）：状态可备份、恢复、迁移，并按 Connection／Source／Workflow 范围隔离；Secret 不混入普通状态。
- **现状【代码核实】**：已交付的一半是真的——命名空间化、带版本号的状态存储已落地并被内置 RSS 连接器实际使用（保存 ETag／Last-Modified，写入按版本做冲突拒绝）。缺的一半是运维入口：备份只有整库复制（`POST /backups` 走 SQLite `VACUUM INTO`），没有按命名空间导出／恢复／迁移的入口；用户数据导出**明确排除**状态表（测试直接断言导出文本里不含状态值）。
- **影响**：换机、换来源命名空间、状态损坏后重建，目前都只能整库搬；NFR-012「可迁移」在这块没有兑现。
- **建议下一步**：这是一个独立小切片（导出／导入某个命名空间的 JSON + 范围过滤 + 与整库备份的关系说明），不需要新 Proposal，可直接复用 Task 22 或新开 Task。

### P1-2 EXT-006 manifest 多 operation 声明与登录状态展示

- **需求要求**（[`part-07-3.md`](docs/requirements/0002-product-requirements/part-07-3.md) §7.11）：manifest 可以声明多个 Source Operation、认证方式等；Web／API 可以根据声明展示配置**和登录状态**；增加新 Adapter 不需要改核心表或 Worker 专用分支。
- **现状【代码核实】**：声明面已交付（`auth` 与 `operations` 结构齐全，operation 是数组）。缺的是使用面：四个内置 manifest **都只声明了单个 `fetch` 操作**，`auth.kind` 只有「无认证」和「外部」两种，因此「按声明展示登录状态」没有数据可展示——登录状态要等真实认证 Adapter。
- **影响**：结构上支持多 operation，但没有任何一个真实 Adapter 用过；新 Adapter 的能力边界仍未被验证过一次，属于「合同先行、无人消费」。
- **建议下一步**：多 operation 的真正消费者是「一个连接下多个计划」，而 P0-1 已于 2026-09-22 交付（Task 33 的 Bilibili 计划仍只走 `source.bilibili@1` 的单一 `fetch` operation，没有用上多 operation）；本行闭合还差真实认证 Adapter 接入（Bilibili 从外部 profile 迁到连接），那是 Task 22 已登记的后续项。

### P1-3 AUT-009 连接状态／授权范围／失效原因的可见性与来源绑定入口

> **本条是本次复核新增登记的**：PROJECT-STATUS 与勘误台账此前都没有把 AUT-009 列为未闭合行。

- **需求要求**（[`part-07-1.md`](docs/requirements/0002-product-requirements/part-07-1.md) §7.1）：用户可以创建可复用的连接，并让多个来源／采集计划引用同一个连接；**用户能看到连接状态、授权范围和失效原因**；撤销凭证不删除已录入历史。
- **现状【代码核实】**：连接对象、凭证存储、API 与「撤销凭证不删历史」都已交付。产品界面仍缺一半：连接面板只显示**状态徽标、名称和账号**，不显示授权范围（`scopeJson`）与失效原因（`lastError`）。**绑定入口已由 2026-09-22 的采集计划 v1 补上**（Task 33 切片 2／3：新建采集计划时可选连接，计划列表按连接分组），本行剩下的只有连接自身的可见性面板。
- **影响**：用户看得到「已过期／错误」，看不到为什么；连接复用在产品面上不可操作，等于半个功能只有接口可用。
- **建议下一步**：小切片即可（连接面板补授权范围与失效原因两行），可与 P1-1 同批；若维护者认为「授权范围／失效原因」要等真实认证 Adapter，则应像 EXT-006 一样登记进勘误台账，而不是留成一条静默的部分交付。

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

- **现状【文档核实】**：`phase2-organization.spec.ts:103`（证据关系反向视图等待超时）与 `:417`（用户组织场景耗时异常）仍未归因；`media-policy.spec.ts` 的来源健康行等待超时只在「整轮变慢」的运行里出现。根因已查清并修掉的两条（`:539` 重复 key、陈旧刷新竞态）见 Task 30。症状、观察次数与建议次序只在 [`known-unstable-cases.md`](docs/testing/known-unstable-cases.md) 维护。
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
| Docker／Compose、发布部署、真实公网长时定时抓取、非 Windows smoke、长时故障恢复 | Phase 1 后置债，按 2026-09-07 划线保留 | PROJECT-STATUS「本次未纳入、仍开着的项」 |
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
- 本文新登记的 AUT-009 部分交付（P1-3）此前不在任何清单里，建议由维护者裁定后同步进 ERRATA 或 PROJECT-STATUS。
