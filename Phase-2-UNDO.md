# Phase 2 UNDO（未完成清单）

> 复核日期：2026-09-20（2026-09-22 增量：P0 已清空；2026-09-23 增量：P1 已清空；2026-09-25 增量：P4-1 的待归因点已结清）｜ 代码基线：`5cbb670`（2026-09-20 复核时的基线；当前 `master` 为 `8a1b2f2`，与 [`PROJECT-STATUS.md`](PROJECT-STATUS.md) 的最新快照同一基线）
>
> 本文只回答一件事：**按 PRD 口径，Phase 2 还差什么**。按优先级从高到低排列，每条给出「需求要求什么 / 现在实际是什么 / 证据 / 建议下一步」。
>
> 证据等级：**【代码核实】**= 本次直接读了实现、合同或数据库模型；**【文档核实】**= 只读了仓库记录，未运行验证；**【未验证】**= 没有可考察的路径。
>
> 最近更新：2026-09-25（P4-1 的四个待归因点全部结清：两点测试缺陷、一点产品缺陷已修，`media-policy` 那条降级为「历史观察、当前不可复现」）

## 一句话结论

Phase 2 的功能主体（十四条切片 + 平台面四块）已交付，§12 四条验收标准里前三条有自动化与真人两层证据。**P0、P1 与 P2 均已清空**——P0-1（AUT-010 多采集计划）、P0-2（AUT-004 的 webhook 形态）、P1 的三行部分交付需求（ING-012、EXT-006、AUT-009）与 **P2-1**（§12 第 4 条 ＋ LIB-003，2026-09-24 由 ADR [`0028`](docs/adr/0028-user-truth-protection-v1.md) 定义合同并落地保护与回归测试）全部收口。**仍未闭合的是 2 条已 accepted 但未落地的界面决定**（P3-1／P3-2）与 **3 条证据与门禁欠账**（P4）；其中 **P4-1 的四个待归因点已于 2026-09-25 全部结清**（`:103` 与 `collection-plan-multi.spec.ts:63` 是测试缺陷、`:417` 是产品缺陷，均已修；`media-policy` 的来源健康行降级为「历史观察、当前不可复现」）。需求表里 Phase 2 只剩 LIB-004（正文片段字符级锚点，已改标 Phase 3，见附表）。

## 当前暂停点（2026-09-25 更新：P4-1 的待归因点已结清）

**P1-2（EXT-006）已交付并合并**：Task [`22`](.agents/tasks/22-connection-state-store/README.md) 的切片 4a／4b 与 Task [`23`](.agents/tasks/23-trigger-sdk/README.md) 的切片 8，`--no-ff` 合并 `da5ae84`，已推送到 `origin` 与 `upstream`。4a 让连接成为登录态载体（OpenCLI profile 进 `ConnectionInstance.configJson`，执行快照随入队冻结连接投影，`feed` 的登录态校验从建目标时改到连接器读投影时）；4b 让登录状态有自动写入方（manifest 的 `auth.probeSupported` 声明驱动探测入口，`connection-probe` Job 由 Worker 执行，结论写回 `status`／`account`／`lastError`／`lastCheckedAt`；ADR [`0027`](docs/adr/0027-connection-login-lifecycle-v1.md) 部分取代 ADR-0017 决策 1）；切片 8 补齐「多 operation 的真实消费者」——operation 可自带配置 schema、canonical 校验按 `(ref, operationId)` 检索、Bilibili 声明第二个 operation `search`（匿名可用）并在 Web 上可选，**没有**数据库迁移也没有新路由，正是「加 Adapter 不改核心表／Worker 专用分支」那条验收。验收中另修掉本片自己的两个缺口（API 的 Source `config` 投影按 connectorId 白名单会丢掉第二个 operation 的字段；侧栏溢出盖住计划列表的确定性布局缺陷）。合并后门禁：单元 124 文件／726 用例、Node 进程 E2E 6 文件／11 用例、组件实验室 19 passed、浏览器整套一次 33 passed、真实来源验收四条全绿（含新增的 `test:real:bilibili-search`：20 条真实搜索结果且不带 profile）、`docs:check` 768 文件 0 失败、size 门禁 PASS、路由表守卫 3/3。

**P0-2（AUT-004 的 webhook 形态）与 P0-1（AUT-010 一个连接下的多个采集计划）已交付并合并**：Task [`23`](.agents/tasks/23-trigger-sdk/README.md) 切片 3–7（`--no-ff` 合并 `da932cd`）与 Task [`33`](.agents/tasks/33-collection-plan/README.md)（`--no-ff` 合并 `4ef3636`）。原始缺口描述、口径裁定与逐条验证证据已随 P0 清空归档到 [`Phase-2-UNDO/history-2026-09-22-p0.md`](Phase-2-UNDO/history-2026-09-22-p0.md)；仍在生效的结论只有两条——AUT-004 的 `event`／`condition`／`dependency` 三种形态属 Phase 3（ADR [`0024`](docs/adr/0024-trigger-forms-v1.md)），AUT-010 迁移的第 4 步 contract 单独排期与授权（ADR [`0023`](docs/adr/0023-collection-plan-v1.md)）。

**P4-1（Phase 2 浏览器验收的间歇失败）已结清待归因点**（2026-09-25）：四个点各归各位——`:103` 与 `collection-plan-multi.spec.ts:63` 是**测试缺陷**、`:417` 是**产品缺陷**（均已修），`media-policy` 的来源健康行**当前代码上未复现**、降级为「历史观察、当前不可复现」。过程另修掉三个产品缺陷（计划/连接读取风暴、新建连接后来源表单下拉不刷新、运行失败事件不刷新计划列表）。逐点证据见下方 P4-1 段落；改动尚未提交、未建分支。

**本清单的下一个缺口**：P1 与 P2 已清空（P2-1 于 2026-09-24 收口）。按优先级剩下的是 **P3-1／P3-2**（已 accepted 但未落地／未同步的界面决定）与 **P4-2／P4-3** 两条门禁与裁定欠账。是否现在处理请维护者裁定。

## 优先级总表

> P0-2（AUT-004 的 webhook 形态）已于 2026-09-22 交付并合并（见「当前暂停点」），因此不再列入下表；P0 已清空。

| 优先级 | 编号 | 缺口 | 性质 | 卡住什么 |
| --- | --- | --- | --- | --- |
| P1 | P1-1 | ING-012：Connector 状态的备份、恢复、迁移与范围隔离 | **已交付并合并 `1b5cabc`** | 已闭合 |
| P1 | P1-2 | EXT-006：manifest 多 operation 声明与登录状态展示 | **已交付并合并 `da5ae84`** | 已闭合；两条验收条件全部满足（凭证载体见下文的如实说明） |
| P1 | P1-3 | AUT-009：连接状态／授权范围／失效原因的可见性与来源绑定入口 | **已交付并合并 `2cfe379`** | 已闭合；验收条件四条全部满足 |
| P2 | P2-1 | §12 第 4 条「重分析不覆盖用户批注和人工关系修正」＋ LIB-003 同类验收 | **已闭合**（2026-09-24） | 唯一现存的自动写入路径（ingest 的 Entry→Story 投影）已受保护并有回归测试；「批注」与「人工关系修正」两类今天无自动写入方，属无威胁对象，其保护规则已进合同、考验随 Phase 3 写入方落地 |
| P3 | P3-1 | 界面职责重划：Topic／Entity／用户组织独立面板 | 已 accepted 未落地 | 真人验收第一条结论未解决；PRD／架构／ADR 未同步 |
| P3 | P3-2 | UI 文案专业化 | Proposal 仍 `reviewing` | 真人验收第三条结论未解决 |
| P4 | P4-1 | Phase 2 浏览器验收的间歇失败（待归因点已结清） | 数据库线已证伪（Task 34）；前端线四个待归因点**已全部结清**：`:103`／`collection-plan-multi:63` 是测试缺陷、`:417` 是产品缺陷（均已修），`media-policy` 的来源健康行当前代码上未复现 | **已结清待归因点**（4/4 有结论；`media-policy` 降级为「历史观察、当前不可复现」） |
| P4 | P4-2 | 代码规模红线门禁欠账 | **非 UI 侧已清零**（G08–G16） | 余 3 个 Web 文件按裁定留到 UI 重做同批 |

---

## P0：完全未交付（2026-09-22 已清空，历史见分册）

P0-2（AUT-004 的 webhook 形态）的原始缺口描述、口径裁定与交付证据已随本轮清空归档到 [`Phase-2-UNDO/history-2026-09-22-p0.md`](Phase-2-UNDO/history-2026-09-22-p0.md)；P0-1（AUT-010）的交付证据在同处与上方「当前暂停点」。

---

## P1：部分交付（2026-09-23 已清空，历史见分册）

P1-1（ING-012）、P1-2（EXT-006）与 P1-3（AUT-009）的原始缺口描述、口径裁定与交付证据已归档到 [`Phase-2-UNDO/history-2026-09-23-p1.md`](Phase-2-UNDO/history-2026-09-23-p1.md)。

---

## P2：验收条件（已闭合）

### P2-1 §12 第 4 条「重分析不覆盖用户批注和人工关系修正」＋ LIB-003 同类验收

- **需求要求**（[`part-10-12.md`](docs/requirements/0002-product-requirements/part-10-12.md) §12 Phase 2 验收第 4 条）：重分析不覆盖用户批注和人工关系修正。LIB-003 的验收是同一件事的另一种说法：「重新分析、重新索引或刷新 Artifact 后，用户数据不丢失」。
- **现状【代码核实】**：Phase 2 里**没有任何自动重分析写入路径**（自动聚类、知识处理已改标 Phase 3），所以这条验收目前只是「结构上成立」，从未被真正考验：既没有保护合同，也没有对应回归测试。全仓检索不到任何「人工字段保护」「人工修正优先」的实现或测试。
- **风险**：Phase 3 的 Knowledge Workflow 一旦开始写入，这条验收标准会**第一次被真正使用**——而那时它没有判据、没有测试，等于以未定义行为落地；一旦自动结果覆盖了人工修正，就是数据损坏级别问题（NFR-004 数据完整性）。
- **建议下一步**：把「用户真相保护」写成 Phase 3 的**入口硬前置**——先定合同（哪些字段人工优先、自动结果如何降级为建议）与回归测试，再开 Knowledge Workflow 的实现。这比事后补测试便宜得多。
- **交付（2026-09-24，分支 `feat/t04-user-truth-protection`，合并补记见下）**：**先纠正本行「现状」的判断**——「Phase 2 里没有任何自动重分析写入路径」不成立。Knowledge 路径确实不存在（`kind: "knowledge"` 只是 `actionKindSchema` 的枚举值），但 ingest 的 Entry→Story 投影（[`helpers-4.ts`](packages/storage-prisma/src/repository/helpers-4.ts)）**已经是一条自动写入路径**：来源发布内容修订时它无条件改写 `Story.kind`、用 Entry 的标题/摘要顶掉当前 Revision，并把人工填的时间范围与关键事实落 `NULL`；它不检查写入者身份，全仓也没有对应测试。所以这条验收不是「结构上成立」，而是**「已有一条会覆盖用户编辑的路径在跑」**。**合同**：Proposal [`user-truth-protection-v1`](docs/proposals/user-truth-protection-v1.md)（accepted）与 ADR [`0028`](docs/adr/0028-user-truth-protection-v1.md) 冻结四个决定——判据是写入者身份（`StoryRevision.producer`，服务端按写入方赋值、调用方不可传；`actorJson` 今天区分不了人工与自动，因为 Web 编辑根本不传它）、v1 保护粒度是整条当前 Revision（含 `Story.kind`）、自动结果按写入方**分两类降级**（确定性投影跳过并记 `story.representation_projection_skipped.v1`；派生分析只能产生候选 Revision 且不得改 `currentRevisionId`）、`producer = "human"` 的关系行不可被自动方删除或改写（跨对象合同）。**实现**：migration `20260924100000_story_revision_producer` 加列并按 `story.revision_created.v1` 领域事件回填 `human`（该事件只由 `updateStoryRevision` 与 `splitStory` 的后继发出，投影不发）；`StoryDetail.story.producer` 进公开读合同，Story 面板显示「人工已修改 · 自动更新已暂停」。**残留（如实）**：本条验收点名的「用户批注」与「人工关系修正」两类今天**没有任何自动写入方会碰它们**，所以它们是「无威胁对象、未被考验」，不是「已通过」——保护规则已进合同，考验随 Phase 3 第一个会碰它们的自动写入方落地；LIB-003 的「刷新 Artifact」依赖 Phase 3 的 Artifact 对象，今天无法判定。**验证**：typecheck 0、单元 126 文件／731 用例全绿（新增 5 例，保护回归先红后绿）、组件实验室浏览器 20 passed、产品浏览器 33 passed、`docs:check` 767 文件 0 失败、size 门禁 PASS、`git diff --check` 干净、`build` 0。记录见 Task [`04`](.agents/tasks/04-workflow-runtime/walkthrough.md) 的 Round 109。
- **合并补记（2026-09-24）**：分支 `feat/t04-user-truth-protection` 已 `--no-ff` 合入 `master`（合并提交 `f66ee27`）并推送 `origin`；合并后按仓库教训先 `bun run db:generate` 再重跑门禁——typecheck 0、单元 126 文件／731 用例全绿、`docs:check` 776 文件 0 失败、size 门禁 PASS、`git diff --check` 干净；任务 worktree 与分支已清理。**未做**：`20260924100000_story_revision_producer` 未对真实数据根执行（迁移属数据生命周期变更，需单独授权）；推送只到 `origin`，未推 `upstream`。

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

### P4-1 Phase 2 浏览器验收的间歇失败（2026-09-25：待归因点已结清）

- **现状【实测归因，2026-09-25 第二轮】**：四个待归因点**逐一复现或放大后都给了结论**——`:103` 与 `collection-plan-multi.spec.ts:63` 是**测试缺陷**（已修）；`:417` 归到**产品缺陷**（已修）；`media-policy.spec.ts` 的来源健康行**未能在当前代码上复现**（不写"已修"）。手段：整套连跑 5 轮（1 红 4 绿，红的那轮同时命中 `:103` 与 `ingest.spec.ts:119`）+ 定向放大（`page.route` 扣住某次读取的响应、页面内记录提示语变化）。
- **先修掉的产品缺陷（读取风暴）**：`page.tsx` 每次渲染新建的 workspace context 让 `use-source-workspace` 的挂载 effect 每次渲染都重跑。实测**一个页面会话对 `/api/v1/collection-plans` 发 313 次、`/api/v1/connections` 发 314 次读取**（3 秒静置窗口里 629 次）。修法：context 用 `useMemo` 固化身份，六处调用共用。修后同一窗口 ≤ 8 次；确定性回归 `e2e/browser/list-state-race.spec.ts`（修前 629 次 / 修后 ≤ 8 次）。**边界**：它是真实缺陷与持续负载，但**不能**说它就是台账里"整轮明显变慢"的成因——修后同 33 例的整套用时是 164 秒左右，与修前的 160–162 秒基本一致；而历史那次 2.9 分钟的慢轮本身就包含一次 120 秒超时，慢是超时的**结果**而不是前置条件。
- **点 1｜`phase2-organization.spec.ts:103`（证据关系反向视图）——测试缺陷，已修**：现象是 `getByRole("dialog").locator('[data-story-member-id=…]')` 10 秒找不到。run1 的 trace 给出机制：面板打开那一刻本来源只录入 1/3 条（`entries?limit=50` 响应 20 条、本来源 1 条；1.3 秒后同一请求 22 条、本来源 3 条），被选中的条目属于**上一个 spec 的来源**（陈旧响应）、标题 `Fixture media metadata`，在候选里正好排第 1（`selectOption({index:1})`）；回找卡片用的是"本来源名 + 标题"，而所有来源共用同一组 fixture 标题，于是打开的是本来源同名的另一条 Story，那条 Story 里没有这个条目。修法：`ingestFeed` 等本来源三条 fixture 卡片都出现，证据条目改成**按来源身份**挑。验证：修前整套 run1 红；修后定向 8/8、整套见下。
- **点 2｜`phase2-organization.spec.ts:417`（用户组织场景，单次 5.1 分钟）——产品缺陷，已修**：5.1 分钟 = 动作等满 300 秒测试预算 + 收尾。确定性放大（扣住首屏 `/api/v1/entities?limit=50` 的响应 6 秒：请求立刻发出、快照是"建实体之前"的）：建完实体、侧栏按钮已出现，7 秒后该项数量 **0** 且**不会自己回来**。机制是**先发起的读取晚落地**，把刚建的实体／Topic 抹掉；`:417` 正是"建 Entity/Topic → 侧栏点它"，元素在断言与点击之间被抹掉时点击就等满预算。修法：`list-write-guard` 增加**读取序号**规则（只有最新一次读取的快照能落地，且期间没有本地写入），覆盖 `entities`／`topics`／`plans`／`connections`／`sources`，原有 `labels`／`collections`／`savedViews` 一并升级到同一闸门。验证：guard 规则 6 条 node 测试 + 确定性 e2e 修前红修后绿。**边界**：那一次 5.1 分钟没有留下 trace，所以是"同类机制 + 症状吻合"，不是逐帧回放。
- **点 3｜`collection-plan-multi.spec.ts:63`（等「录入任务已排队」15 秒）——测试缺陷，已修**：页面内记录 4 次触发，坏来源的排队提示**只存在 480–554ms**，且失败提示（`run.failed.v1` →「一次录入运行失败…」）**可能先于它出现**（4 次里 2 次先到）。这条断言用轮询等一个亚秒级、且按设计会被替换的单槽位提示语，慢轮里一次轮询就能跨过整个窗口。修法：新增 `e2e/support/notice-log.ts`（页面内记录提示语变化），该行改成断言"记录里出现过这段文字"——要求不变，不再依赖轮询撞上窗口。**未复现红**：3 轮整套 + 4 次定向触发 + 20× CPU 降频 + 主线程占住 1.5 秒都没能让它落空；红是从窗口量化推出的。
- **点 3 顺带修掉的两个产品缺陷（删掉读取风暴后才暴露，此前被 300+ 次重读掩盖）**：① 新建连接后来源表单的连接下拉不刷新（`ConnectionPanel` 增 `onConnectionsChanged`，页面重读计划/连接列表）；② `run.failed.v1` 只刷新 Feed 不刷新计划列表，"请在计划行内查看错误信息"指的那一行永远没有错误（SSE 处理里同时重读计划列表）。
- **点 4｜`media-policy.spec.ts` 的来源健康行——当前代码上未复现，不写"已修"**：已排除计划列表的陈旧读取——确定性放大（扣住首屏 `/collection-plans` 响应）下该行不会被抹掉（修读取风暴前页面每秒重读约 10 次计划列表，任何陈旧写入都在 ~50ms 内被纠正，这正是历史观察能自愈的原因）。本轮 5 轮整套与 Task 34 的 8 轮整套都没有再出现该行缺失；该观察最后一次实测是 **2026-09-17**，早于侧栏溢出修复（`3ce3322`，2026-09-23）与多轮重构，现场没有留下 trace。另外，台账原先"只在整轮明显变慢的运行里出现"这一判断不成立：那次 2.9 分钟的慢轮本身包含一次 120 秒超时，慢是超时的结果。结论：**降级为"历史观察、当前不可复现"，继续观察，不列为待归因项，也不声称已修**。
- **另一条本次顺带归因的**：`ingest.spec.ts:119` 的 `toBeFocused` 是**测试缺陷**——该用例自己会归并并改标题，Feed 按更新时间重排，`.first()` 从被点的卡片移到另一张（trace 实测顺序 `[media, message, scaffold]` → `[merged, merged, scaffold]`），焦点还给了被点的那个节点。修法：断言绑到被点击的节点本身。验证：修前整套 run1 红、修后通过。
- **上一轮已修的那条（标签丢失更新，`phase2-organization.spec.ts:30`）**：机制、证据链与修法见提交 `a30a0ea` 与 `list-write-guard.ts` 的注释；本次只把它并入统一的写入闸门（新增读取序号轴），不再重复叙述。
- **未做**：`media-policy` 的历史现场无法回放（没有 trace、代码已多次变更）；`:417` 那一次 5.1 分钟同样没有 trace，机制是确定性复现出来的、不是那次现场的逐帧回放。
- 症状、观察次数与其余条目仍只在 [`known-unstable-cases.md`](docs/testing/known-unstable-cases.md) 维护；数据库线（WAL／busy timeout）已在 Task 34 证伪，不再是候选根因。

### P4-2 代码规模红线门禁欠账

- **现状【代码核实】**：代码规模治理的行数阈值没有进门禁（G 系列治理任务暂停时留下的欠账）。本次实际扫描：**8 个源码文件超过 800 行红线**——`packages/application/src/workflow-host-runtime.ts`（1125）、`packages/worker-admin/src/index.ts`（982）、`apps/web/src/components/cosmos/board-view.tsx`（917）、`apps/web/src/component-lab/product-fixtures.tsx`（903）、`packages/application/src/media-acquisition.ts`（868）、`packages/storage-prisma/src/workflow-backend.ts`（844）、`apps/worker/src/workflow-ingest.test.ts`（824）、`apps/web/src/components/cosmos/story-panel.tsx`（813）。其中三个是 Phase 2 的 Web 文件（看板、Story 面板、组件实验室夹具）。
- **说明**：文档体积门禁本身是好的——本次按 CI 口径实跑 `python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new`，结果 **PASS（含 6 条基线内增长 warning）**。欠的是**代码行数**这一轨。
- **建议下一步**：属治理任务（G 系列），不随 Phase 2 尾巴顺带做；重启时优先拆 Phase 2 新增的三个 Web 文件，它们同时是 P3-1 界面重做的改动对象。

### P4-3 看板没有撤销（2026-09-24 已裁定，移入文末「已裁定后置」）

已按准入规则先出 Proposal（[`board-undo-v1`](docs/proposals/board-undo-v1.md)），维护者随后裁定**当前不需要该功能，登记为额外需求**。原话与完整设计输入见 [`0001-original-requirements.md`](docs/requirements/0001-original-requirements.md) 2026-09-24 条目与 PRD §13 待决定事项 25；本条不再计入缺口。

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
| 看板撤销（编辑模式下误操作可恢复） | **当前不做**，登记为额外需求（后置） | 维护者 2026-09-24 裁定；原话见 [`0001-original-requirements.md`](docs/requirements/0001-original-requirements.md) 同日条目，登记位置 PRD §13 待决定事项 25，设计输入保留在 [`board-undo-v1`](docs/proposals/board-undo-v1.md)（`rejected`） |

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

**2026-09-25 增量的边界（P4-1 专项，跑过验证）**

- 本次实跑：`bun run test`（**134 文件 / 766 用例 passed**）、`bun run typecheck`（exit 0）、`bun run lint:web`（0 error / 76 warning，全部为存量）、`bun run test:browser` **3 轮**（35 passed / exit 0，175.2s／173.3s／173.0s）、`bun run test:browser:component-lab`（20 passed）、`bun run docs:check`（854 文件 0 失败）、文档体积门禁（PASS，含存量 warning）、`git diff --check`（exit 0）。修前对照：整套 5 轮（1 红 4 绿）+ 两个确定性 RED（计划行被陈旧读取抹掉、3 秒窗口 629 次读取）。
- 未运行：真实来源验收、真实 Agent 验收、Docker／Compose、CI、发布与部署。P3-1／P3-2／P4-2／P4-3 的判定依据未重跑，证据等级仍是原复核那一份。
- 本次改的是产品代码与测试代码（不是纯台账）：`apps/web` 的列表写入闸门与 workspace context、`e2e/browser` 的四个 spec 与新增的 `list-state-race.spec.ts`、`e2e/support/notice-log.ts`；另新增 `docs/testing/known-unstable-cases/ERRATA.md`（分册已封口，勘误走同级 ERRATA）。改动**未提交、未建分支**。
- 证据存档：`.agent/tmp/p41/`（修前 5 轮日志与失败 trace、定向诊断、修后 3 轮日志）。
