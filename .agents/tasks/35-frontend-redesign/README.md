# Task 35：前端界面重做 v1（版面骨架、视觉方向与页面级对象入口）

> 编号 35 由维护者 2026-09-24 分配。**不复用编号 25**：`ui-surface-ownership-v1` 曾建议复用，但 25 已被作废分支 `feat/t25-ui-surface-ownership` 的「Task 25」占用，复用会让历史引用歧义。

## User Request / Topic

2026-09-24 维护者指令：

> @docs/前端设计流程.md 项目现在要从0开始重新设计前端界面，技术栈底座还是React + Tailwind CSS。按照流程一步步与我进行讨论。

执行依据 [`docs/前端设计流程.md`](../../../docs/前端设计流程.md)（v0.4）。流程 §0 适用判断为「多页面 / 有路由」→ 四层全做；§8 硬闸门为「三层设计获批前不写代码」。第 0、1、1.5 层走完后，维护者同轮**接受设计**并授权更新稳定文档与创建本 Task；**未授权**实现代码、worktree、分支、commit、push、PR、merge、发布或部署。

## Goal

把已冻结的三层设计落成可运行的前端：

```text
主题 token 换装（单一明暗轴）+ 版面骨架（顶栏 + 悬浮侧栏 + 路由组）
-> 8 个新 primitive 入库并登记组件实验室
-> 十个页面取代「单页 + 五个抽屉」：首页看板 / 信息库 / 话题 / Entity / 系统产出 / 整理 / 自动化 / 设置 / Story 阅读页
-> 补齐四个只读查询，使话题页、Entity 页、整理页有真实数据可渲染
-> 版面门禁 + 预算门禁 + 禁用词扫描上线，让版面和文案回归对门禁可见
```

## 权威合同

- Proposal [`frontend-redesign-v1`](../../../docs/proposals/frontend-redesign-v1.md)（**accepted**）与四份分册：
  - [`layer-0-product-structure.md`](../../../docs/proposals/frontend-redesign/layer-0-product-structure.md)（P0–P6、路由表、数据缺口）
  - [`layer-1-visual-design.md`](../../../docs/proposals/frontend-redesign/layer-1-visual-design.md)（V0/V3/V5/V6）
  - [`layer-1-v4-design-system.md`](../../../docs/proposals/frontend-redesign/layer-1-v4-design-system.md)（token 清单、组件规范）
  - [`layer-1-5-engineering.md`](../../../docs/proposals/frontend-redesign/layer-1-5-engineering.md)（E1–E7）
- ADR [`0029`](../../../docs/adr/0029-ui-surface-layout-and-visual-direction-v1.md)（界面职责、版面骨架与视觉方向）
- 信息架构：[`ui-surface-ownership-v1`](../../../docs/proposals/ui-surface-ownership-v1.md)（accepted，含 2026-09-24 勘误节）
- 文案判据与术语表：[`ui-copy-review-v1`](../../../docs/proposals/ui-copy-review-v1.md)（reviewing；术语表 A–E 组已逐行裁定）
- 组件实验室：[`react-component-lab.md`](../../../docs/proposals/react-component-lab.md)（accepted，CI 强制登记）
- 代码规模治理：[`code-size-governance-v1.md`](../../../docs/proposals/code-size-governance-v1.md)（accepted）

## Scope / Non-goals

Scope：

- **切片 1（地基）**：token 换装 + 主题轴收敛；`AppShell`（顶栏 + 悬浮侧栏）；路由骨架与两个路由组；外壳级单条 SSE 连接与事件→topic 映射。
- **切片 2（组件库）**：8 个 primitive 入库 + 组件实验室登记；`globals.css` 正式 token；三档断点的版面规则。
- **切片 3（页面搬迁）**：十个页面；四个只读查询（E3）；首页纯看板化；信息库独立成页。
- **切片 4（文案与门禁）**：集中文案模块 + 禁用词扫描测试；版面门禁（三档断点）；预算门禁（SSE 恰好 1 条、事件 300 ms 合并、首屏 JS 增量）。
- **文档**：行为落地后更新 `docs/spec/interfaces/0005-web-client.md`、`docs/api/`（四个查询）、`docs/testing/`、`PROJECT-STATUS.md`。

Non-goals：

- Phase 3 对象页面（Workspace / Artifact / 知识管理者 Web Chat / Agent 调研）——一律不做。
- 移动端适配（PC 优先已裁定）；1024 px 以下只显示「窗口过窄」提示。
- 权限体系与权限 UI（单用户最大权限）。
- 多语言 / i18n 框架（非目标维持；文案走集中模块）。
- 批量操作、看板撤销（后者已裁定为额外需求）。
- 发布与部署（既有后置债）。

## Current State

评审当时的现状（完整证据见第 0 层分册）：

- 首页 `apps/web/src/app/page.tsx`（802 行）是唯一产品页面，Story / 话题 / Entity 都以抽屉盖在其上；无路由、无全局导航。
- 侧栏是首页正文网格的第二行，上方压着页头和搜索区——上次「导航落在页面下方、切页后侧栏消失」的结构成因。
- 三个文件在代码规模红线内：`page.tsx` 802 行、`board-view.tsx` 917 行、`story-panel.tsx` 815 行；`product-fixtures.tsx` 42.9 KB。**本次必须让被重做的文件回到线内。**
- `components/ui/` 只有 8 个 primitive；无 dialog / menu / tabs / toast / select / combobox / tooltip。
- `client.openEventStream()` 每次调用新建一个 `EventSource`；当前只在首页订阅一次，六个事件类型每个都触发全量重读 Feed + 采集计划。
- 主题为 `data-cosmos-theme="neurobook"` × `data-cosmos-colorway="macos-*"` 两套轴。

## Decisions and Deviations

- 本 Task 的**全部设计决定**来自已 accepted 的 Proposal 与 ADR-0029，不在实施中重新决定。实施若发现设计缺陷，按 [`repository-workflow.md`](../../../docs/standards/repository-workflow.md) 回到 Proposal 修订，不就地打补丁。
- **已知代价（维护者明确选择，非缺陷）**：悬浮侧栏高度由内容撑开，将来每增加一个导航项卡片会长高、其下方内容位置随之变化。
- **唯一框架例外**：`/stories/:id` 隐藏左侧栏。必须有对应门禁断言，否则会被读成「侧栏消失」回归。
- **不得复制探针做法**：V5 探针用任意值语法 `bg-[var(--p-*)]` 是因为 Tailwind v4 的 `@theme` 不能写在运行时注入的 `<style>` 里；**正式 token 必须写进根布局导入的 `globals.css`**。

## Implementation Walkthrough

按切片顺序推进；每切片的 RED/GREEN、实际命令与结果、偏差写入 [`walkthrough.md`](walkthrough.md)（唯一过程记录位置）。

### 切片 1 · 地基

**贯穿目标**：让外壳与路由先立起来，且首页在换装后行为不变。

- 1a **token 换装**：`globals.css` 写入 V4 的 token 三层（语义映射 + `--marker`/`--marker-soft`/`--paper` + 形状密度动效）；`theme.ts` / `theme-bootstrap.ts` / `component-lab` 收敛为单一 `data-cosmos-appearance`。
- 1b **AppShell**：顶栏（品牌、全局搜索跳转 `/library?q=`、服务状态、系统产出、外观切换、新建）+ 悬浮侧栏（内容/管理两组，八项）+ 主内容区居中限宽。
- 1c **路由骨架**：`(shell)` 与 `(reading)` 两个路由组；十项路由建立；现有首页内容先整体挂在 `/`，行为不变。
- 1d **live-provider**：外壳级单条 SSE 连接、`streamState`、事件→topic 映射表、300 ms 合并、`subscribe(topic, handler)`。

**最多三条可观察验收**：① 换装后首页在 1440 px 下外观符合 V3，且现有浏览器套件通过；② 顶栏与悬浮侧栏在所有 `(shell)` 页面位置一致，切页不重建；③ 打开任意页面时浏览器 Network 面板中 `/api/v1/events` 只有一条连接。

**依赖**：无（起点）。**预计核心文件**：`apps/web/src/app/globals.css`、`src/theme/*`、`src/components/shell/*`、`src/app/layout.tsx`、`src/app/(shell)/layout.tsx`、`src/app/(reading)/layout.tsx`。

### 切片 2 · 组件库

**贯穿目标**：8 个 primitive 可用且登记完整。

- `dialog` / `alert-dialog` / `menu` / `tabs` / `toast` / `select` / `combobox` / `tooltip` 走 `shadcn add` 生成并落到 `components/ui/`。
- 每个 primitive 按 V4 的规范要求：cva 变体、六态、只消费语义 token、文案由调用方传入。
- **同时提交组件实验室定义**（CI 强制登记），否则门禁失败。
- 三档断点的版面规则落地（紧凑/标准/宽屏）；「窗口过窄」提示。

**最多三条可观察验收**：① 组件实验室能预览全部 8 个新 primitive 的关键状态，`test:browser:component-lab` 通过；② 四组对比度实测 ≥ 4.5:1（暗色尤其）；③ 键盘路径可用（dialog 焦点陷阱与归位、menu 方向键、combobox 上下选择、tooltip focus 触发）。

**依赖**：切片 1（token 与外壳）。**预计核心文件**：`src/components/ui/*.tsx`、`src/component-lab/registry.tsx`、`src/component-lab/product-fixtures.tsx`。

### 切片 3 · 页面搬迁

**贯穿目标**：十个页面取代「单页 + 抽屉」，且同一操作产生与搬迁前一致的数据与领域事件。

维护者 2026-09-24 复核拆法后确认：**拆成 5 个子切片，每片完成后停下验收**（不只一次做完再看）。拆法依据之一是现状——现有 5 个 workspace hook（`use-feed-workspace` 等，共约 1,600 行）**已按域分开**，每页只需挂载自己那几个，搬迁的机械难度低于文件体量给人的印象；真正的难点在写入入口的删除与三个超线文件的拆分。

依赖关系：

```text
3a 四个只读查询 ──┬─→ 3b 内容组 5 页
                  ├─→ 3c 管理组 3 页
                  └─→ 3d Story 阅读页 ──→ 3e 规模与门禁收口
```

#### 3a · 四个只读查询

**贯穿目标**：话题页、Entity 页、整理页有真实数据可渲染。

- 话题成员带 Story 标题、Entity 关联 Story 带标题、收藏列表带标题、跨目标批注列表。
- 按仓库规则先更新 `docs/api/` Draft 并补 conformance 场景。
- **四项都是「把已有数据取出来」**：不改写入合同、不改持久化、不新增业务语义；一律沿用 `Page<T>` 分页形状。

**最多三条可观察验收**：① 四个查询各返回解析后的标题（不再是裸 ID）；② conformance 场景通过；③ 写入合同 diff 为零。

**状态：已完成，判据①在 Round 9 补齐为 4/4**（Round 3 落地；Round 8 末实测复核；Round 9 补批注标题投影）：

- ① 话题成员 ✓ 返回 `title`、Entity 关联 Story ✓ 返回 `title`、收藏 ✓ 返回 `title`、
  **跨目标批注列表 ✓ 返回 `targetTitle`**（Round 9 补：`Annotation` 增加读取侧 `targetTitle` 投影，
  目标已删除时为 `null`，整理页据此显示「（目标已不可读）」而不是裸 ID）。
- ② ✓（在全量 784 用例内）。
- ③ **未验证**：要与 3a 之前的提交比对写入合同 diff，本轮没有做，不能算已证。
  已补的是读取侧字段（`targetTitle`），写入命令与持久化未动。

**依赖**：无（起点）。**风险**：低（只读）。

#### 3b · 内容组 5 页

**贯穿目标**：首页只剩「看」，检索有了自己的家。

- `/` 首页纯看板 + 系统产出区块（删页头、右状态栏、检索区）；`/library` 承接整套检索工作台；`/topics`、`/entities`、`/system` 建页。

**状态：已完成**（Round 4 建页；验收 ① 在 Round 7 达成，③ 的回归证据在 Round 8 补齐）。三处与原文的差异：

- 验收 ①「不打开任何 Story 就能建出话题与 Entity」在 Round 4–6 一直**不成立**：`/topics`、
  `/entities` 只做浏览，而创建动作又被 ADR-0029 决策 1 从 Story 页移走，于是「建话题 / 建 Entity」
  一度没有入口。Round 7 给两个对象页各补一条创建行（`object-pages.spec.ts` 门禁）。
- 验收 ③「搬迁前后同一操作的数据与领域事件一致」的证据在 Round 8 补齐：旧 Phase 2 套件已按新 IA
  重写并全绿，含录入→阅读→改标题→归并的服务端落库断言、看板区块、检索与竞态语义。
- `/topics/:id`、`/entities/:id` 详情页仍是占位（Round 8 补了占位路由，不再 404）：改标题与目的、
  成员改角色/移除、Entity 别名与关系仍未落地。

#### 3c · 管理组 3 页

**贯穿目标**：每个上层对象有自己的操作面，Story 页不再堆积别人的表单。

- `/organize`（标签/收藏夹/收藏/批注/已保存视图 五分区 + `?tab=` 同步）、`/automation`（来源/采集计划/连接/运行记录）、`/settings`。
- 迁移纪律：同一件事只保留一个可写入口；**抽屉里的旧表单同批删除**，不留双写。

**状态：已完成**（Round 5）。**Round 7 曾一度回退并已修复**：切片 3e 把编辑面接回阅读页时，
四个 `onCreate*` 回调被传下去，`onCreateX &&` 守卫失效，「新建话题/Entity/标签/收藏夹」四个表单
又回到 Story 页——同时破坏验收 ①②。修复不只是摘回调：四个「创建并关联」域命令与三个区块组件里的
创建表单**一并删除**（结构上不可能再违规），阅读页只保留关联动作；门禁在 `story-reading.spec.ts`。
遗留：标签与收藏夹不能改名、收藏夹不能加成员、批注没有标题投影（Round 5 已记）。

#### 3d · Story 阅读页

**贯穿目标**：`/stories/:id` 成为「读这一条」的地方。

- 正文 + 来源成员（标出采集/人工）+ 时间线 + 关键事实 + 引用关系 + 相关内容 + 读完动作区；归档/拆分/状态迁移保留。

**最多三条可观察验收**：① 阅读卡片 640 px、衬线标题、正文 16/1.8/行宽 ≤34em；② 来源成员行能区分「系统创建 / 人工」；③ 归并、拆分与用户状态迁移仍可用。

**依赖**：3b、3c（动作区需要跳转到对应对象页）。**风险**：**最高**——`story-panel.tsx` 815 行 + 17 个子文件，既要瘦身又要拆回 800 行内。

#### 3e · 规模与门禁收口

**贯穿目标**：三个原超线文件回到线内，且版面与文案的回归从此对门禁可见。

- 拆 `(shell)/page.tsx` 与 `board-view.tsx`；入口文件 ≤300 行。
- 集中文案模块 `src/copy/messages.ts`（维护者裁定放在本子切片：页面搬完文案才稳定）；禁用词扫描写成测试。
- 版面门禁（三档断点下导航位置一致、侧栏存在性、`/stories/:id` 例外）。

**状态：已完成**（Round 7，2026-10-01）。实际交付与原文的差异：

- 行数用 **node 口径**重算（本环境 PowerShell `Get-Content` 会漏行，原文里的 736/917/815 都是漏行值）：
  `board-view.tsx` 972 → **194**（桶文件）+ 4 个分片；`(shell)/page.tsx` 520 → **294**；`story-panel.tsx` 849 → **删除**。
- **`story-panel.tsx` 不是拆小而是删除**：维护者裁定「把编辑面接回 `/stories/:id`」，
  抽屉壳由 `story-edit-surface.tsx` + `story-edit/organization-editor.tsx` 取代，
  阅读页成为 Story 的唯一可写入口（ADR-0029 决策 1/7）。原抽屉里的编辑/归并/拆分/整理能力因此**重新可达**。
- 顺带收掉一处 CI 红：`component-lab/registry.tsx`（814 行）拆成入口 + 5 个分片，
  `size-governance.py --check`（CI 口径）从 FAIL 转 PASS。

**验收**：① 三个原超线文件回到线内且入口 ≤300 行 ✓（另附 CI 代码门禁 PASS）；
② 故意把导航移到内容下方会让断言失败 ✓（`layout-and-budget.spec.ts` 的「断言有效性自证」）；
③ 禁用词扫描能抓到已知违规文案 ✓（首次运行抓到 15 处，其中 14 处已改、1 处登记例外）。


### 切片 4 · 文案与门禁

**贯穿目标**：版面和文案的回归从此对门禁可见。

- 集中文案模块 `src/copy/messages.ts`；**禁用词扫描写成测试**（「分类」「历史壳」「未注册」「Spotlight 区块」「Story ID」「受管理 subtype」「审计」等命中即失败）。
- 版面门禁：三档断点下主导航位置一致；约定页面侧栏存在；`/stories/:id` 左侧栏不存在且返回入口存在。
- 预算门禁：SSE 恰好 1 条、事件 300 ms 合并、首屏 JS 增量 ≤ 30 KB gzip。
- 行为门禁：正在编辑的详情页收到事件时表单内容不变且出现提示。
- V6 复审清单收口：`feed-browser.tsx` 的「分类」与裸 `Topic`；首页徽标与副标题。

**状态：已完成**（Round 7 落地门禁与文案；**Round 9 补上行为门禁**）。

门禁落点与口径：

| 门禁 | 落点 | 口径 |
| --- | --- | --- |
| 禁用词 | `apps/web/src/copy/messages.test.ts` + `copy/scan.ts`（TypeScript AST 扫用户可见字面量） | 命中即失败；例外必须登记理由，且修好后必须销账 |
| 内联文案只减不增 | 同上 + `copy/inline-copy-baseline.json` | 新增/增长/迁完未销账都失败；进度：`bun run apps/web/src/copy/scan.ts` |
| 三档断点版面 | `e2e/browser/layout-and-budget.spec.ts` | 侧栏在左、内容限宽、无横向溢出；含「故意错位必须失败」的自证 |
| 侧栏存在性与唯一例外 | 同上 | `(shell)` 各页有侧栏；`/stories/:id` 无侧栏且有返回入口 |
| 支持下限（E5） | 同上 | `< 1024px` 只显示「窗口过窄」提示、外壳不渲染；`≥ 1024px` 提示消失 |
| 写入口径回执可见 | `e2e/browser/home-board.spec.ts` | 首页新建看板后回执可见、看板进入切换器（此前首页静默丢弃通知） |
| SSE 恰好 1 条 | 同上 | 一次会话内跨页导航后仍只有 1 条 `/api/v1/events` 请求 |
| 300 ms 合并 | `apps/web/src/components/shell/live-coalesce.test.ts` | 假定时器逐毫秒验证（窗口内合并、不同 topic 各自计时、卸载不触发） |
| 详情页编辑中不被覆盖 | `e2e/browser/story-live-refresh.spec.ts` | 无编辑时静默重读且不提示；有未保存编辑时只提示、草稿与页面主体都不变；点「重新读取」后读到新内容（Round 9） |
| `prefers-reduced-motion` | `layout-and-budget.spec.ts` | 动效时长归零 |
| 首屏可交互 / 路由切换 / 首屏 JS | 同上 | 实测 152 ms / 111 ms / 289.7 KB，断言 2000 ms / 300 ms / 400 KB |

**同时落地的裁定**（维护者，2026-10-01）：E5 三档表按实测修正进 ADR-0029 决策 6 并补上
「窗口过窄」提示；首页补上写入口径的回执横幅；docs 侧两处既有超线登记进 `docs-baseline.json`。

**验收**：① 三档断点版面断言全过且「故意错位必须失败」✓；
② 禁用词扫描抓到已知违规 ✓（15 处）；
③ **编辑中的详情页不被事件覆盖 ✓**（Round 9）：阅读页订阅 `stories` topic，未编辑时静默重读、
编辑中只提示「有新变化，重新读取？」且不覆盖草稿，门禁在 `story-live-refresh.spec.ts`。

**依赖**：切片 3。**预计核心文件**：`src/copy/**`、`e2e/browser/**`、`docs/testing/README.md`。

## Verification

分四层报告，不互相替代：聚焦测试 → 全量测试与类型检查 → 浏览器验收（含新门禁）→ 真人验收（关键任务不看说明走一遍）。

**当前四层状态**（Round 8 收尾，2026-10-01）：

| 层 | 状态 | 证据 |
| --- | --- | --- |
| 1 聚焦测试 | ✅ | 各切片按域跑（文案门禁、合并窗口、实验室 21 条） |
| 2 全量测试与类型检查 | ✅ | `bun run test` 137 文件 / 783 用例；`bun run typecheck` 0 错误；`bun run lint` 0 error |
| 3 浏览器验收（含新门禁） | ✅ | **全量 `playwright test` 50 通过 / 0 失败**；实验室 21 通过；`bun run test:e2e` 6 文件 / 12 用例（本机需 `db:generate` + `BUN_BINARY`） |
| 4 真人验收 | ❌ **未做** | 关键任务清单（P0 成功指标的具体条目）尚未与维护者冻结 |

**关键任务清单**（P0 成功指标的具体条目）**已于 2026-10-01 与维护者冻结**。判据来源：维护者在设计流程 P0 环节选定的成功指标「**真人走一遍关键任务不迷路 + 版面门禁断言**」（[`0001-original-requirements.md`](../../../docs/requirements/0001-original-requirements.md) 的 2026-09-24 条目），任务内容取自 PRD §9 在 Phase 2 范围内的用例（UC-02 / UC-05 / UC-06 / UC-07）。

| # | 任务（用户视角） | 起点 | 通过判据 | 对应 |
| --- | --- | --- | --- | --- |
| 1 | 看一眼今天有什么 | 首页 | 不靠说明就能分辨哪些是系统/Agent 产出的；能一步进信息库 | UC-05 |
| 2 | 配一个来源并让它跑起来 | 任意 | 自己找到配置位置 → 建计划 → 启用 → 手动录入 → 在信息库看到内容 | UC-06 |
| 3 | 按标签筛一遍并留住条件 | 任意 | 找到标签筛选 → 筛出结果 → 保存成视图 → 清除筛选恢复全量 | UC-05 ① |
| 4 | 读一条内容并判断可信度 | 任意 | 看到时间线、来源成员（系统/人工标记）、关键事实及其出处；相关内容不伪装成同一事件 | UC-02 ③、UC-07 ④ |
| 5 | 把两条内容合成一条、再拆开 | 任意 | 找到「编辑与关联」→ 归并后成员变 2 → 拆分出后继并留下历史壳 | UC-07、§8.3 |
| 6 | 给内容打标签、写批注、加入话题、关联 Entity | 任意 | 能挂到已有对象上；新建话题/Entity/标签/收藏夹知道该去对象页 | UC-07 ③ |

每条只记三件事：① 不看说明能否找到入口（「不迷路」判据）；② 做完是否看到预期结果；③ 中途有没有出现让人怀疑「我是不是点错了」的地方（原话记录，这类最有价值）。**结果与偏差记在 walkthrough，不回改本清单。**

未运行项、已知限制与失败现场按 [`docs/testing/README.md`](../../../docs/testing/README.md) 记录；每个切片完成时在本 Task 的 `walkthrough.md` 追加实际命令、结果与偏差。

## Follow-ups

- **V1 线框与 V2 逐页状态设计未做**：骨架已冻结，逐页的空态/错误/加载文案在实施各页时确定并回填 Proposal。已知缺口之一：`/library` 没有**页级**标题（其余九页都有；它只有阅读流自己的 `Story Feed` 小标题），等 V2 决定它的页头形状。
- **`/topics/:id` 与 `/entities/:id` 详情页仍是占位**（Round 8 补了占位路由，不再 404）：话题改标题与目的、成员改角色/移除、Entity 别名与关系、解除关联都还没有归属页面（3b/3c 的创建入口已在对象页补上，Round 7）。
- **3b 验收 ③ 的回归证据已补齐**（Round 8）：旧 Phase 2 浏览器套件按新 IA 重写后全绿，
  含「录入→阅读→改标题→归并」的服务端落库断言。真人验收仍未做（见下）。
- **旧浏览器套件已按新 IA 重写**（Round 8）：20 个 spec 里 **16 个**曾驱动已删除的旧单页 UI
  （Story 抽屉、首页来源入口、首页检索区、连接面板、存储面板、旧主题两套轴）。
  现在全部搬到新 IA 并通过；判定口径见 walkthrough Round 8——**按关键词筛陈旧 spec 不可靠，
  只有跑一遍全量才算数**（我按关键词筛过两次，分别得出 6 个和 12 个，实际 16 个）。
- **首页来源表单的残留**：`(shell)/page.tsx` 仍挂载 `useSourceWorkspace`（只为看板的「采集计划」
  区块），并因此需要一个从不渲染的 `sourceForm` 实例。hook 把「来源表单」与「计划列表」两类关注
  捆在一起，值得拆开。
- **文案组件级 772 处未迁**：`copy/inline-copy-baseline.json` 只减不增，新增内联文案已被门禁拦住；
  剩余集中在 `components/cosmos/**`（board-view 分片、collection-plan-list、connection-panel、
  source-form、story-panel 子区块、topic/entity panel）与 `lib/**`（media-policy、story-time-range-draft 等）。
- **编辑中的详情页不被事件覆盖（切片 4 行为门禁）已在 Round 9 落地**：阅读页订阅 `stories` topic，
  未编辑时静默重读、编辑中只提示「有新变化，重新读取？」。门禁 `story-live-refresh.spec.ts`。
- **话题与 Entity 的详情页未建**（见上）；**标签目录读取**已在 Round 8 补进阅读页与信息库
  （此前 Story 页无法打标签、信息库无法按标签筛选）。
- **「并入本 Story 的 Story ID」是判据 R3 的违规**：要用户粘贴内部编号才能归并。
  改成可搜索的选择列表需要新增「可作为归并目标的 Story 列表」只读查询，
  `ui-copy-review-v1` 明确不夹带进纯文案批次；已登记为禁用词门禁的例外（带理由）。
  **2026-10-01 维护者裁定：归到「Story 页排版」新 task 同批处理**（两者都在 Story 页上，
  4/5/6 的人工复验也要等那一轮，同批只需复验一次）。
- **真人验收发现的三条交互缺口（2026-10-01 维护者裁定：本 task 只记录，不在本 task 修）**：
  ① `/automation` 的「新建计划」应改成**模态框**；② 「创建连接」同样改成按钮 → 模态框 → 表单 →
  确认/取消，并把现在的连接表单位置改成**连接列表（要有空状态）**；③ 采集计划列表行的操作按钮
  （启动/暂停等）**只有图标没有文字，需要 tooltip**。
- **跨目标批注列表的标题投影已在 Round 9 补齐**：`Annotation` 增加读取侧 `targetTitle`（目标已删除为
  `null`），整理页显示「（目标已不可读）」。收藏与批注共用同一个批量解析器，不再各写一份。
- **实验室夹具仍超线**：`component-lab/product-fixtures.tsx` 42.9 KB / 1192 行在基线里（存量债）。
- **E7 的「增量 ≤ 30 KB gzip」无法回溯测量**：切片 2 之前的构建产物不在本 worktree 里，
  本轮记录的是绝对值（首屏 289.7 KB）与上限；要真正量增量需在旧基线提交上另做一次构建。
- **docs 侧存量债**：`Phase-2-UNDO.md` 与 `docs/proposals/ui-surface-ownership-v1.md` 已登记进
  `docs-baseline.json`（越过 9k token 警戒线，本轮之前就存在）；前者是历史回滚记录，
  后者在信息架构收口后应缩回并移除登记。
- **侧栏高度代价**：导航项增长到影响定位稳定性时，按 ADR-0029 的 Revisit Gate 重新评估。
- **四个只读查询**：落地后 `docs/api/` 与 `docs/spec/` 同步。
