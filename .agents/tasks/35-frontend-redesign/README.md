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

**依赖**：无（起点）。**风险**：低（只读）。

#### 3b · 内容组 5 页

**贯穿目标**：首页只剩「看」，检索有了自己的家。

- `/` 首页纯看板 + 系统产出区块（删页头、右状态栏、检索区）；`/library` 承接整套检索工作台；`/topics`、`/entities`、`/system` 建页。

**最多三条可观察验收**：① 不打开任何 Story 就能建出话题与 Entity；② 首页不再有检索区且看板仍可操作；③ 搬迁前后同一操作的数据与领域事件一致（既有 Phase 2 浏览器套件回归）。

**依赖**：3a。**风险**：中。**为什么 5 页一起**：「首页去掉检索区」与「`/library` 承接检索」是同一次拆除，分两批会出现「首页空了、新页还没好」的中间态。

#### 3c · 管理组 3 页

**贯穿目标**：每个上层对象有自己的操作面，Story 页不再堆积别人的表单。

- `/organize`（标签/收藏夹/收藏/批注/已保存视图 五分区 + `?tab=` 同步）、`/automation`（来源/采集计划/连接/运行记录）、`/settings`。
- 迁移纪律：同一件事只保留一个可写入口；**抽屉里的旧表单同批删除**，不留双写。

**最多三条可观察验收**：① 标签、收藏夹、已保存视图各有唯一可写入口；② Story 页不再出现「新建话题/Entity/标签/收藏夹」表单；③ 收藏与批注分区能列出带标题的内容。

**依赖**：3a。**风险**：中（`?tab=` 与 URL 同步在仓库内无先例）。

#### 3d · Story 阅读页

**贯穿目标**：`/stories/:id` 成为「读这一条」的地方。

- 正文 + 来源成员（标出采集/人工）+ 时间线 + 关键事实 + 引用关系 + 相关内容 + 读完动作区；归档/拆分/状态迁移保留。

**最多三条可观察验收**：① 阅读卡片 640 px、衬线标题、正文 16/1.8/行宽 ≤34em；② 来源成员行能区分「系统创建 / 人工」；③ 归并、拆分与用户状态迁移仍可用。

**依赖**：3b、3c（动作区需要跳转到对应对象页）。**风险**：**最高**——`story-panel.tsx` 815 行 + 17 个子文件，既要瘦身又要拆回 800 行内。

#### 3e · 规模与门禁收口

**贯穿目标**：三个原超线文件回到线内，且版面与文案的回归从此对门禁可见。

- 拆 `(shell)/page.tsx`（736 行）与 `board-view.tsx`（917 行）；入口文件 ≤300 行。
- 集中文案模块 `src/copy/messages.ts`（维护者裁定放在本子切片：页面搬完文案才稳定）；禁用词扫描写成测试。
- 版面门禁（三档断点下导航位置一致、侧栏存在性、`/stories/:id` 例外）。

**最多三条可观察验收**：① 三个原超线文件回到 800 行内且入口 ≤300 行；② **故意把导航移到页面下方会让断言失败**（证明断言有效，不是空跑）；③ 禁用词扫描能抓到已知违规文案。

**依赖**：3b/3c/3d 全部完成（要拆的东西那时才定型）。**风险**：低，机械量大；拆分必须保持行为等价。


### 切片 4 · 文案与门禁

**贯穿目标**：版面和文案的回归从此对门禁可见。

- 集中文案模块 `src/copy/messages.ts`；**禁用词扫描写成测试**（「分类」「历史壳」「未注册」「Spotlight 区块」「Story ID」「受管理 subtype」「审计」等命中即失败）。
- 版面门禁：三档断点下主导航位置一致；约定页面侧栏存在；`/stories/:id` 左侧栏不存在且返回入口存在。
- 预算门禁：SSE 恰好 1 条、事件 300 ms 合并、首屏 JS 增量 ≤ 30 KB gzip。
- 行为门禁：正在编辑的详情页收到事件时表单内容不变且出现提示。
- V6 复审清单收口：`feed-browser.tsx` 的「分类」与裸 `Topic`；首页徽标与副标题。

**最多三条可观察验收**：① 三档断点下的版面断言全部通过，且**故意把导航移到页面下方会让断言失败**（证明断言有效，不是空跑）；② 禁用词扫描能抓到已知的违规文案；③ 编辑中的详情页不被事件覆盖。

**依赖**：切片 3。**预计核心文件**：`src/copy/**`、`e2e/browser/**`、`docs/testing/README.md`。

## Verification

分四层报告，不互相替代：聚焦测试 → 全量测试与类型检查 → 浏览器验收（含新门禁）→ 真人验收（关键任务不看说明走一遍）。

**关键任务清单**（P0 成功指标的具体条目）在本 Task 与维护者共同确定，尚未冻结。

未运行项、已知限制与失败现场按 [`docs/testing/README.md`](../../../docs/testing/README.md) 记录；每个切片完成时在本 Task 的 `walkthrough.md` 追加实际命令、结果与偏差。

## Follow-ups

- **V1 线框与 V2 逐页状态设计未做**：骨架已冻结，逐页的空态/错误/加载文案在实施各页时确定并回填 Proposal。
- **三档断点未出图**：E5 的断点是文字规格，切片 2 落地后出图验证。
- **E7 预算未实测**：首屏可交互、路由切换、首屏 JS 增量都是设定值，切片 4 用真实数据验证或调整。
- **侧栏高度代价**：导航项增长到影响定位稳定性时，按 ADR-0029 的 Revisit Gate 重新评估。
- **四个只读查询**：落地后 `docs/api/` 与 `docs/spec/` 同步。
