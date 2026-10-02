# Phase 1 / Phase 2 排查结果

> 排查日期：2026-09-25 ｜ 排查基线：`master` @ `da147a5`（工作区干净，仅 `.agents/learning/` 未跟踪）
>
> 排查口径：以 PRD [`§12 实施范围与阶段验收`](requirements/0002-product-requirements/part-10-12.md) 的 Phase 1／Phase 2 范围与验收为清单主体，加上 [`§7 功能需求`](requirements/0002-product-requirements.md) 中阶段列为 `Phase 1`／`Phase 1B`／`Phase 1C`／`Phase 2` 的 68 行需求。
>
> 证据等级：**【实跑】**= 本次直接运行命令；**【代码核实】**= 本次读了实现、合同、路由或文件清单；**【文档核实】**= 只读仓库台账，未运行验证。
>
> 本文是**排查结果**，不替代 [`PROJECT-STATUS.md`](../PROJECT-STATUS.md)（当前快照与有效决定）、[`ERRATA.md`](requirements/0002-product-requirements/ERRATA.md)（需求表口径更正）与 [`Phase-2-UNDO.md`](Phase-2-UNDO.md)（Phase 2 缺口台账）。

## 一句话结论

**Phase 1 的 §7 需求行已无未闭合项**（`Phase 1C` 的 Gateway 三行已改标 Phase 3，`EXT-008` 与 AUT-001「删除凭据」已收口）；**Phase 1 真正的缺口只剩「已划线后置的验收债」与一条台账未登记项**。**Phase 2 的 §7 需求行只剩 `LIB-004` 一行部分交付**（剩余半边已改标 Phase 3），四条 §12 验收标准全部有实现与测试证据，但**三条真人验收产生的界面决定仍未落地**，另有三条门禁／证据欠账。

---

## 一、Phase 1

### 1.1 §12 Phase 1 范围（10 项）

| # | 范围项 | 状态 | 依据 |
| --- | --- | --- | --- |
| 1 | manual + schedule Trigger、脚本优先的最小 Workflow/Action Runtime（只固定 Ingest Workflow） | 已完成 | 【文档核实】AUT-002／AUT-006 收口；通用编辑器按 PRD 定级 Phase 3 |
| 2 | RSS/RSSHub 真实 Connector + 一个 fixture Connector | 已完成 | 【代码核实】`plugins/rss` 导出 `rss` 与 `fixture-rss` 两个 connector（`plugins/rss/src/index.ts:24`）；`fixture-rss` 不进产品配置入口 |
| 3 | Next.js App Router Web、NestJS API、独立 Worker 最小宿主边界 | 已完成 | 【代码核实】`apps/web`、`apps/api`、`apps/worker` 三入口 |
| 4 | Prisma + SQLite、受控 SQLite SQL Adapter、Blob Store、FTS5/BM25 | 已完成 | 【代码核实】`packages/storage-prisma`、`packages/blob-store`；**WAL/busy timeout 显式配置未验收**（见 1.4） |
| 5 | Observation、EntryRevision、Asset、「一个 Entry → 一个最小 Story projection」 | 已完成 | 【代码核实】migration 与 projection 路径在册 |
| 6 | 版本化 Service Endpoint/Command/Query/Event/Transport；最小 SSE 与健康检查 | 已完成 | 【代码核实】`packages/contracts`、`packages/transport-http`；`/healthz`、`/readyz`、`/api/v1/health` |
| 7 | 最小搜索页、Story-based Feed Block 和 Source/Run 状态 | 已完成 | 【代码核实】`apps/web` 首页 + `feed-browser.tsx`；`GET /runs/:runId/jobs` |
| 8 | 配置优先的产品入口（选 `rss`、schema 驱动填 URL、校验/测试/保存/启用/调度） | 已完成 | 【文档核实】Task 02 配置优先产品 E2E 切片 |
| 9 | 两块固定最小看板（最新内容 Feed、来源健康摘要） | 已完成 | 【文档核实】BRD-001 收口 |
| 10 | 首条产品 E2E 从空数据根目录 + 用户填写的实际 RSS URL 开始 | 已完成 | 【文档核实】2026-09-18 真实公网 RSS 验收（阮一峰源，item count 3） |

### 1.2 §12 Phase 1 验收（9 条）

| # | 验收条件 | 状态 | 依据 |
| --- | --- | --- | --- |
| 1 | 定时录入真实内容，重复运行和重启不产生重复 Entry | 已完成 | 【文档核实】ING-005／RUN-002 |
| 2 | 来源编辑形成 Revision | 已完成 | 【文档核实】ADR-0004 |
| 3 | 无 URL fixture 可完整录入；fixture 只作管线集成证据 | 已完成 | 【文档核实】ING-001／ING-011 |
| 4 | 断网后可搜索正文并查看已保存媒体；未保存媒体显示明确状态 | 已完成（口径已收窄） | 【文档核实】ERRATA 2026-09-18：按 ADR-0005 收窄为「图片实体 + 音视频元数据」，验收文字不改写 |
| 5 | Feed 以 Story 为入口，可打开 Story → Entry → Source/Revision | 已完成 | 【文档核实】BRD-001；Phase 1 不要求跨来源聚类 |
| 6 | 失败能定位到 Source、Run 和 Action | 已完成 | 【文档核实】OPS-001／OPS-002 |
| 7 | 同一 Web/Transport 合同可在本地与远端服务间复用；SSE 断线后可解释恢复 | 已完成（合同层面） | 【文档核实】OPS-008；**真实远端 Gateway 属 Phase 3**，不在本条 |
| 8 | Bun 开发与 Node 生产启动路径通过最小兼容性检查；Docker 未提供时明确记录未运行 | 部分满足 | 【文档核实】Bun/Node 最小兼容性检查通过（Node smoke 由远端 CI 覆盖）；本条 Docker 分支的前提「环境未提供 Docker」不成立——**已实跑且失败**（见 1.4 缺口 1） |
| 9 | 产品可用性验收必须从空数据根目录开始，走完 Web 配置 → Worker 抓取 → 看板显示 | 已完成 | 【文档核实】2026-09-18 真实 RSS 产品 E2E |

### 1.3 §7 需求行（Phase 1 系，31 行）

| 分组 | 行数 | ID | 状态 |
| --- | --- | --- | --- |
| `Phase 1` | 25 | AUT-001、AUT-002、AUT-003、AUT-006、RUN-001、RUN-002、RUN-003、ING-001、ING-002、ING-003、ING-004、ING-005、ING-007、ING-008、ING-011、LIB-001、LIB-002、OPS-001、OPS-002、OPS-008、BRD-001、BRD-010、REC-001、EXT-001、EXT-005 | 全部已交付 |
| `Phase 1B` | 1 | ING-017 | 已交付 |
| `Phase 1C` | 1 | EXT-008 | 已交付（第三条「独立构建/部署实跑」并入生产验收债） |
| `Phase 1C` | 3 | RUN-010、RUN-011、OPS-010 | 已改标 `Phase 3`（ERRATA 2026-09-18，与插件运行时同批） |
| `Phase 1C` | 1 | OPS-011 | **实现存在、口径未登记**（见 1.4 缺口 5） |

### 1.4 Phase 1 未完成与缺口

| # | 缺口 | 性质 | 依据 |
| --- | --- | --- | --- |
| 1 | Docker/Compose 实际容器启动、共享卷与 healthcheck 验收 | **已实跑并失败** | 【文档核实】2026-09-23 首次 `test:docker` 失败：镜像构建缺 Prisma client 生成步骤；根因与候选修复见 [`docs/research/2026-09-23-docker-acceptance-run.md`](research/2026-09-23-docker-acceptance-run.md)，修复待单开 Task |
| 2 | 真实 RSS/RSSHub 的**长时定时抓取**与更长 Worker 重启演练 | 后置债（2026-09-07 划线） | 【文档核实】单次与双源验收已过；长时稳定性未验 |
| 3 | 发布部署 | 后置债（2026-09-07 划线） | 【文档核实】PROJECT-STATUS「尚未实现」 |
| 4 | 非 Windows 平台 smoke | 后置债（2026-09-07 划线） | 【文档核实】仅 Windows Node smoke 由远端 CI 覆盖 |
| 5 | OPS-011（API liveness／API readiness／产品健康／Worker readiness 分开表达）的 Phase 1 收口口径 | **台账缺口** | 【代码核实】`/healthz`、`/readyz`（`apps/api/src/main.ts:50-63`）、`/api/v1/health`、`packages/worker-admin/src/health.ts` 均存在；但 2026-09-18 只把 RUN-010／RUN-011／OPS-010 三行改标 Phase 3，**OPS-011 未被排除也未被登记收口**，需求表仍标 `Phase 1C` |
| 6 | SQLite WAL/busy timeout 的显式配置与并发行为验收 | 未做 | 【文档核实】PROJECT-STATUS「尚未实现」；架构基线写明「当前尚未在代码/migration 中显式验证」 |
| 7 | manifest-only API、executable-only Worker 与独立 Migrator 的完整生产验收 | 未做 | 【文档核实】EXT-008 第三条并入本条；代码路径有 Node smoke 与行为测试，无独立构建/部署实跑 |
| 8 | Activity Host 跨进程 durable recovery、双 Worker 长时 fencing、SIGTERM 活跃 Attempt deadline | 未做 | 【文档核实】已有部分 Activity Job／lease／completion 证据，不能替代这些边界 |

---

## 二、Phase 2

### 2.1 §12 Phase 2 范围（3 项）

| # | 范围项 | 状态 | 依据 |
| --- | --- | --- | --- |
| 1 | Label、Annotation、Collection、Saved View | 已完成 | 【代码核实】`apps/api/src/app.controller/organization.ts` 有 label／label-assignment／collection／favorite／annotation／saved-view 全套路由 |
| 2 | Story、Topic、Entity 与关系 | 已完成（人工半边） | 【代码核实】`content.ts` 有 topic member、entity alias、story-entity link、entry-story link、entry-relation、entity-relation 路由；**自动半边**（自动识别/归并/候选）随 ORG-021 归 Phase 3 |
| 3 | Board/Section/Block、Spotlight 和多分区 Feed | 已完成 | 【代码核实】`organization.ts` 有 board／board-section／board-block／spotlight-placement 路由；`board-sortable-blocks.tsx` 用真实 `DndContext`；**系统自动 Spotlight** 归 Phase 4 |

> 口径注记（ERRATA 2026-09-23）：§12 的 Phase 2 范围**不含平台面**（Connection／Secret／State、Trigger、连接与认证）；平台面按 §7 的逐行阶段计入 Phase 2。

### 2.2 §12 Phase 2 验收（4 条）

| # | 验收条件 | 状态 | 依据 |
| --- | --- | --- | --- |
| 1 | 用户能按来源、分类、时间、全文和 Topic 浏览 | 已完成 | 【代码核实】`feed-browser.tsx` 支持 `labelIds`／`topicIds`／来源／时间／全文过滤；`source-lifecycle-and-search-filters.spec.ts` 覆盖 |
| 2 | 能打开一个多来源 Story，查看时间线和相关内容 | 已完成 | 【代码核实】`story-panel/timeline-section.tsx`（`data-story-timeline`）＋`story-panel/related.tsx`（`data-story-related`）；Task 15 浏览器 E2E |
| 3 | 用户可调整看板；删除 Block 不删除底层信息 | 已完成 | 【代码核实】拖拽排序在 `board-sortable-blocks.tsx`；删除走 `board-blocks/:blockId/removals`，实现只执行 `boardBlock.delete`（`packages/storage-prisma/src/repository/board-content.ts:273`），不触碰 Story／Entry。**边界**：拖拽手势本身未自动化，由真人验收覆盖 |
| 4 | 重分析不覆盖用户批注和人工关系修正 | 已完成（有残留） | 【代码核实】ADR-0028：`helpers-4.ts:275` 读 `producer === "human"` 并发出 `story.representation_projection_skipped.v1`；migration `20260924100000_story_revision_producer` 在册。**残留**：批注与人工关系修正两类今天**没有自动写入方会碰它们**，属「无威胁对象、未被考验」，保护规则已进合同，考验随 Phase 3 第一个写入方落地 |

### 2.3 §7 需求行（Phase 2，37 行）

| 状态 | 行数 | ID | 说明 |
| --- | --- | --- | --- |
| 已交付 | 35 | AUT-004、AUT-009、AUT-010、RUN-004、ING-006、ING-009、ING-012、LIB-003、LIB-008、OPS-003、OPS-004、EXT-003、EXT-006、EXT-007、ORG-001、ORG-002、ORG-003、ORG-004、ORG-005、ORG-006、ORG-008、ORG-011、ORG-012、ORG-013、ORG-014、ORG-015、ORG-016、ORG-017、ORG-020、ORG-022、BRD-002、BRD-003、BRD-006、BRD-007、BRD-008 | 逐行依据见 ERRATA 与 Phase-2-UNDO；无单独勘误的行按 Task 切片与汇总口径记 |
| 部分交付 | 1 | **LIB-004** | 批注核心已交付；**Artifact 目标**与**正文片段字符级锚点**改标 `Phase 3` |
| 已改标 Phase 3 | 1 | ORG-021 | 自动聚类／Knowledge Workflow 依赖 Agent 边界与预算模型（ERRATA 2026-09-15） |

行内口径（需求行仍算已交付，但部分内容改标）：

| ID | 行内改标内容 | 去向 |
| --- | --- | --- |
| AUT-004 | `event`／`condition`／`dependency` 三种触发形态 | Phase 3（ADR-0024） |
| AUT-010 | 迁移第 4 步 contract（从来源移除旧列） | 单独排期与授权（ADR-0023） |
| ING-009 | 历史媒体回填冻结（不做）；音视频下载实体；单条目媒体数量上限；全局默认值 env 化 | 冻结／Phase 4／Phase 3／Phase 3 |
| ORG-003、ORG-004、ORG-022 | 自动识别／自动归并／成员候选的**自动半边** | Phase 3 |
| BRD-006 | 验收里的「排序配置」 | Phase 4（推荐体系） |
| BRD-007 | 「差异对比」与 Agent 产物 | Phase 3 |
| EXT-006 | — | 无残留（两条验收条件全部满足） |

### 2.4 Phase 2 未完成与缺口

| # | 缺口 | 性质 | 依据 |
| --- | --- | --- | --- |
| 1 | LIB-004 剩余半边：批注绑定 Artifact、正文片段字符级锚点 | 已改标 Phase 3 | 【代码核实】`targetTypeSchema = z.enum(["story","entry","topic"])`，无 `artifact`；`quote` 只是文本快照（上限 5000），不能定位 revision 正文区间 |
| 2 | 界面职责重划未落地：Topic／Entity／用户组织缺独立页面 | **已 accepted 未落地** | 【代码核实】Web 只有 2 个路由（`app/page.tsx`、`app/dev/components/page.tsx`），三个新页面不存在；Proposal [`ui-surface-ownership-v1`](proposals/ui-surface-ownership-v1.md) 已 accepted，实现尝试 2026-09-15 作废；**PRD §8／架构 §11.4／新 ADR 与 Task 在 `master` 上均未同步** |
| 3 | UI 文案专业化 | Proposal 仍 `reviewing` | 【文档核实】[`ui-copy-review-v1`](proposals/ui-copy-review-v1.md)；判据 R0 与术语表 A–E 组已裁定，R1–R5 与落点未接受；5 个浏览器 spec 约 205 处断言按文案定位，必须同批改 |
| 4 | 代码规模红线：3 个 Web 文件超 800 行 | 门禁欠账（非 UI 侧已清零） | 【实跑】本次扫描：`product-fixtures.tsx` 1143、`board-view.tsx` 917、`story-panel.tsx` 815。G08 已把行数门禁并入 size gate；G09–G16 已治理 `domain`／`media-acquisition`／`workflow-host-runtime`／`worker-admin`／`collectors`／`workflow-backend`／`workflow-ingest` 测试 |
| 5 | 浏览器验收间歇失败 | 待归因点已结清 | 【文档核实】四个点全部有结论（`:103` 与 `collection-plan-multi:63` 测试缺陷、`:417` 产品缺陷，均已修；`media-policy` 降级为「历史观察、当前不可复现」）；`known-unstable-cases.md` 仍是唯一症状台账 |
| 6 | 拖拽手势自动化 | 不做（真人验收覆盖） | 【文档核实】指针坐标在该布局下不可靠（Task 14 已知边界） |
| 7 | Entity merge／dedup | 未纳入 Phase 2 验收，仍开着 | 【文档核实】PROJECT-STATUS「本次未纳入、仍开着的项」 |
| 8 | §12 第 4 条的两类对象（用户批注、人工关系修正）从未被自动写入方触碰 | 残留，Phase 3 回归 | 【文档核实】保护规则已进 ADR-0028 合同，考验随 Phase 3 写入方落地 |

---

## 三、汇总表

### 3.1 已完成

| 范围 | 条目 | 证据等级 |
| --- | --- | --- |
| Phase 1 §12 范围 | 10/10 项 | 代码核实 + 文档核实 |
| Phase 1 §12 验收 | 8/9 条完全满足；第 8 条部分满足（Docker 分支前提不成立） | 文档核实 |
| Phase 1 §7 需求行 | 27/31 行（含 `Phase 1B` ING-017、`Phase 1C` EXT-008） | 文档核实 |
| Phase 2 §12 范围 | 3/3 项（人工半边；自动半边按已裁定归属 Phase 3） | 代码核实 |
| Phase 2 §12 验收 | 4/4 条（第 4 条带残留） | 代码核实 |
| Phase 2 §7 需求行 | 35/37 行 | 文档核实 + 代码抽查 |

### 3.2 未完成

| 范围 | 条目 | 数量 |
| --- | --- | --- |
| Phase 1 §7 需求行 | 无（3 行已改标 Phase 3，1 行 OPS-011 待登记口径） | 0 |
| Phase 2 §7 需求行 | LIB-004（部分交付，剩余改标 Phase 3） | 1 |
| Phase 2 §12 验收 | 无未完成项；第 4 条残留两类对象未被考验 | 0 |

### 3.3 缺口

| 优先级 | 缺口 | 归属／下一步 |
| --- | --- | --- |
| 高 | Docker/Compose 实跑失败（镜像构建缺 Prisma client 生成步骤） | 修复待单开 Task；Phase 1 后置债 |
| 高 | 界面职责重划未落地：三个独立页面不存在，且已 accepted 的决定未沉淀进 PRD／架构／ADR | 记录义务可低成本先补；UI 重做按维护者节奏排期 |
| 中 | LIB-004 剩余半边（Artifact 目标、字符级锚点） | Phase 3 |
| 中 | UI 文案 Proposal 仍 `reviewing`（R1–R5 与落点未裁定） | 先只裁定判据与落点，不写代码；实施与 UI 重做同批 |
| 中 | 3 个 Web 文件超 800 行 | 与 UI 重做同批（同一批改动对象） |
| 中 | OPS-011 口径未登记（实现存在，需求表仍标 `Phase 1C`） | 补一条 ERRATA 即可 |
| 低 | 长时定时抓取、非 Windows smoke、长时故障恢复、发布部署 | Phase 1 后置债（2026-09-07 划线） |
| 低 | SQLite WAL/busy timeout 显式配置；manifest-only／独立 Migrator 生产验收；跨进程 recovery 与长时 fencing | 未做，未排期 |
| 低 | Entity merge／dedup；拖拽手势自动化 | 仍开着／不做 |

---

## 四、本次核对发现的台账偏差

排查中直接比对 `master` 与三份台账，发现以下不一致（**均为台账滞后，不是实现缺失**）：

| # | 台账写法 | 实际情况 | 影响 |
| --- | --- | --- | --- |
| 1 | [`Phase-2-UNDO.md`](Phase-2-UNDO.md) P4-1 段与「复核方法」段写 P4-1 的改动「**未提交、未建分支**」 | P4-1 的代码与文档改动已提交并 `--no-ff` 合入 `master`（合并提交 `da147a5`，前置 `87671ed` 代码、`3b38db7` 文档） | 读台账会以为 P4-1 成果还在工作区 |
| 2 | [`PROJECT-STATUS.md`](../PROJECT-STATUS.md) 首页写「更新于 2026-09-23。代码基线 `da5ae84`」；[`Phase-2-UNDO.md`](Phase-2-UNDO.md) 写「当前 `master` 为 `8a1b2f2`」 | 当前 `master` 为 `da147a5`，自 `8a1b2f2` 起已有 **47 个提交** | 台账快照落后于代码；两次基线数字互不相同 |
| 3 | PROJECT-STATUS「本次未纳入」段把 3 个超 800 行文件记为「另有 2 个入口超 300 行」 | 本次扫描：源码超 800 行的仍是那 3 个 Web 文件，但 `product-fixtures.tsx` 已从 903 行涨到 **1143 行** | 规模欠账在扩大，未计入任何清单 |

> 注：本文只登记偏差，不改写三份台账；台账更正按仓库规则追加勘误（[`ERRATA.md`](requirements/0002-product-requirements/ERRATA.md)）或更新 PROJECT-STATUS 快照。

---

## 五、未运行与证据边界

**本次实跑**

- `bun run test` → **134 文件 / 766 用例 passed，exit 0**（157.65s）。
- 源码行数扫描（`apps`／`packages`／`plugins`／`e2e`／`scripts`，排除 `node_modules`／`dist`／`.next`）→ 3 个文件超 800 行。
- Web 路由清点 → 仅 `app/page.tsx` 与 `app/dev/components/page.tsx`。

**本次未运行**

- `bun run typecheck`、`bun run build`、`bun run docs:check`、`bun run lint:web`。
- 浏览器产品 E2E、组件实验室 E2E、Node 进程 E2E、属性测试。
- 真实来源验收（`test:real:*`）、真实 Agent 验收、Docker／Compose、CI、发布与部署。
- 上述未运行项的最近一次数字仍以 [`PROJECT-STATUS.md`](../PROJECT-STATUS.md)「验证边界」与 [`Phase-2-UNDO.md`](Phase-2-UNDO.md) 的 2026-09-25 记录为准，本文不重复引用为本次结果。

**证据边界**

- §7 需求行的状态**主要来自台账口径**（ERRATA／PROJECT-STATUS／Phase-2-UNDO），本次只对其中约 15 项做了代码抽查（路由、合同 schema、migration、Web 组件、健康端点），未逐行读实现。
- 205 处「按文案定位的断言」未逐条核对，按 Proposal 与 PROJECT-STATUS 记载引用。
- Phase 1 后置债的「已划线」依据是维护者 2026-09-07 决定，本次未重新裁定其归属。
- 本文不评估实现质量、性能或安全，只核对「清单项是否完成、缺什么」。
