# Task 36：Story 阅读页两栏版面与对象详情页补完

> 编号 36 由维护者 2026-10-02 分配。本 Task 承接 Task 35 移交的四项；移交清单原文见
> [`../35-frontend-redesign/README.md`](../35-frontend-redesign/README.md) 的 Follow-ups，
> 现状摘要见 [`PROJECT-STATUS.md`](../../../PROJECT-STATUS.md) 的「当前下一步」。

## User Request / Topic

2026-10-02 维护者指令（原话）：

> 新开 Task 36，新 task 的四项（Story 页排版、归并改可选目标、两个详情页、标签改名），
> 以及已登记不修的三条 /automation 交互诉求与审查留下的可选改进——都在 Task 35 的
> Follow-ups 与 PROJECT-STATUS.md 里记着。

同轮维护者裁定的范围边界（见 Decisions and Deviations）：

- 只收四项；三条 `/automation` 交互诉求**继续留在 Task 35 Follow-ups**，不在本 Task 修。
- 审查留下的 Optional/Nit 只收「顺手修」四条。
- 组件级 772 处内联文案迁移**不在本 Task**，单开文案批次 Task。

Story 页版面的方向由维护者在同轮直接给出（原话）：

> 整体布局如下：分成左右布局，左边为文章内容区，右边为操作编辑区。整体要居中，左右留一些空白，
> 不要完全占满导航栏下方的整个区域，文章内容区与操作编辑区的宽度之比为3比2。先改成这样。

随后逐项裁定：图片留左栏排在正文后；右栏跟着滚、不吸附；1024 px 窄档也保持 3:2、不堆叠。

## Goal

```text
Story 阅读页从「单栏长页 + 编辑面压在最底部」改成「左内容 / 右操作编辑」两栏 3:2 居中版面
-> 拆开 StoryEditSurface：只读区块归左栏、可写区块归右栏、媒体从编辑面移出
-> 归并从「粘贴内部 Story ID」改成可搜索的目标选择
-> /topics/:id 与 /entities/:id 从占位变成可用详情页
-> 标签改名补成一条完整竖切（合同 + 命令 + 领域事件 + 路由 + 界面 + 测试）
```

## 权威合同

- ADR [`0029`](../../../docs/adr/0029-ui-surface-layout-and-visual-direction-v1.md)：版面骨架、阅读页是隐藏侧栏的唯一例外（决策 2）、断点（决策 6）、实时刷新边界（决策 7）。
- Proposal [`frontend-redesign-v1`](../../../docs/proposals/frontend-redesign-v1.md)（accepted）与分册
  [`layer-1-visual-design.md`](../../../docs/proposals/frontend-redesign/layer-1-visual-design.md)（V4 排版规格）、
  [`layer-1-5-engineering.md`](../../../docs/proposals/frontend-redesign/layer-1-5-engineering.md)（E5 断点、E7 预算）。
- 信息架构 [`ui-surface-ownership-v1`](../../../docs/proposals/ui-surface-ownership-v1.md)（accepted）；
  文案判据与术语表 [`ui-copy-review-v1`](../../../docs/proposals/ui-copy-review-v1.md)（reviewing，禁用词门禁的有效例外只此一处）。
- 组件实验室 [`react-component-lab.md`](../../../docs/proposals/react-component-lab.md)（accepted，CI 强制登记）；
  代码规模 [`code-size-governance-v1.md`](../../../docs/proposals/code-size-governance-v1.md)（accepted）。

## Scope / Non-goals

Scope：

- **切片 A（Story 页两栏版面）**：阅读页改成左内容 / 右操作编辑两栏 3:2 居中；拆开 `StoryEditSurface`，
  只读区块（时间线、证据、相关内容、媒体）归左栏，可写区块（改表示、归并、拆分、标签、批注、话题、Entity）归右栏；
  媒体从编辑面移出、成为左栏正文后的独立区块；收藏与置顶从「读完动作区」移入右栏。
- **切片 B（归并改可选目标）**：归并目标从粘贴 Story ID 改成可搜索选择列表；复用既有 `GET /search`，
  **不新增读查询**；删掉禁用词门禁里那条为此登记的例外。
- **切片 C（`/topics/:id` 详情页）**：改标题与目的、成员改角色 / 移除 / 恢复。
- **切片 D（`/entities/:id` 详情页）**：别名增删、类型化关系增删、「关联 Story」解除。
- **切片 E（标签改名）**：`updateLabel` 竖切。
- **顺手修四条**（见 Decisions and Deviations）。
- **文档**：行为落地后同步 `docs/spec/interfaces/0005-web-client.md`、`docs/api/`、`docs/testing/`、`PROJECT-STATUS.md`。

Non-goals：

- **三条 `/automation` 交互诉求**（新建计划与创建连接改模态框、原连接表单位置改连接列表含空态、计划行操作按钮加 tooltip）：按 2026-10-01 与 2026-10-02 两次裁定留在 Task 35 Follow-ups。
- **组件级 772 处内联文案迁移**：单开文案批次 Task（2026-10-02 维护者裁定）。
- **其余审查 Optional/Nit**：事件合并加 maxWait、「取消收藏」与「删除已保存视图」双入口归属、实验室登记门禁扩到 `components/shell`、docs 与夹具治理（`0005-web-client.md` 拆册、`product-fixtures.tsx` 回线内）——均不在本 Task。
- 移动端适配（PC 优先已裁定；<1024 px 只显示「窗口过窄」提示）；权限 UI；i18n；发布与部署。
- **不新增 Prisma schema 或 migration**：本 Task 五项工作全部落在既有表与既有命令之上，唯一的合同新增是 `updateLabel`（改既有 `Label.name`，非版本化模型）。

## Current State

**本轮实现之后（2026-10-03，Round 3 起）**：五项 Scope 与四条顺手修都已落地，逐条证据在
[`walkthrough.md`](walkthrough.md)。

- **阅读页是两栏**（左内容 / 右操作编辑，**3:1**，整组宽 = 视口 **80%** 居中，右栏另加 **240 px**
  最小宽度）：Round 1 的 3:2 + 整组限宽 ≈931 px 已被 Round 3 取代；正文跟着左栏撑满，不再限 34em。
- 右栏按 **C→B→A→D** 分四段、**每段一个段标题**（Round 22），分隔线只放段间（C|B、B|A、A|D）。
- **首页看板拖拽排序可用**（Round 20）：原先每个分区各包一层 `DndContext`、分区之间互不可见，
  导致 `over` 永远是自己、不发移动请求；现由 `BoardDndProvider` 罩住整个看板，跨分区拖拽一并可用。
- `StoryEditSurface` 已拆成 `story-reading-content.tsx`（左栏只读区块）与 `story-edit-panel.tsx`
  （右栏写入动作），旧文件删除；组件实验室登记同步拆成两条，21 条实验室用例全绿。
- **归并改成可搜索的选择列表，零后端改动**——复用既有 `GET /search`（原计划的「新增只读查询」被推翻）；
  据此**删掉了禁用词门禁里唯一的例外**。
- `/topics/:id` 与 `/entities/:id` 已是可用详情页，同样零后端改动。
- **标签改名竖切已通**：合同 → 端口 → 存储（含 `label.updated.v1`）→ `PATCH /api/v1/labels/:labelId`
  → 传输 → 组织页界面 + 三层测试；**无 Prisma schema/migration**。
- 顺手修四条已落地，其中两条变成新的浏览器门禁（见 Verification）。

**Task 36 开始前的现状（2026-10-02 复核，均经代码核对）**——以下五条描述的是**改动前**的事实，
列在这里是为了留下「改了什么」的对照；其中单栏版面、34em 行宽、编辑面在最底部、归并粘贴框、
两个占位页都已在上面落地：

- 阅读页 `apps/web/src/app/(reading)/stories/[id]/story-reading.tsx`（322 行）是单栏：`article` 正文卡片 →
  读完动作区 → `StoryEditSurface`。**编辑面在整页最后**，长正文下要滚到底才够得着。
- 正文卡片**没有限宽**：`(reading)/layout.tsx` 的 `main` 无 max-width，article 占满视口宽度，
  只有正文文字自身限 34em——宽屏下卡片被拉满、正文两侧大片空白。
- **阅读页不渲染图片**：`RevisionAssets` 只挂在 `story-edit-surface.tsx:441`。数据侧不是缺口——
  `StoryDetail.entry.revisions[].assets` 已在读投影里（`entryRevisionSnapshotSchema`），30 张图的真实 Story 现成可读。
- `StoryEditSurface`（464 行）把**只读**区块（用户状态迁移、证据、时间线、相关、媒体）与**可写**区块
  （「编辑与关联」展开里的改表示/拆分/组织）混在一个组件里；只读部分常驻显示，可写部分默认收起。
- 归并入口 `story-panel/story-actions.tsx:162` 仍是「并入本 Story 的 Story ID」+ 粘贴框，placeholder `story:...`。
  这是判据 R3 的违规，已登记为禁用词门禁的例外（带理由）。
- `/topics/:id`、`/entities/:id` 是 30 行占位页（刻意不显示路由 id）。读端点 `GET /topics/:topicId`、
  `GET /entities/:entityId` **已存在**，缺的只是页面。
- **标签改名确实全仓不存在**：`updateLabel` 在合同、应用端口、仓库与 API 都没有；`Label` 是可变的普通行
  （`name String @unique`），不是 revision 模型，所以这条竖切**不含迁移**。对照：收藏夹改名已在 Round 11 用 `PATCH /collections/:collectionId` 落地。
- 三个待回线的 Web 文件现状：`story-edit-surface.tsx` 464 行、`story-reading.tsx` 322 行、
  `story-panel/organization.tsx` 336 行——均在 800 行红线内。

## Decisions and Deviations

- **本 Task 的版面决定来自维护者的直接指令**，不是 Agent 自行设计。现行取值（2026-10-03 修正后）：

  | 项 | 取值 | 依据 |
  | --- | --- | --- |
  | 左栏（内容）宽 | 视口的 60%（整组 80vw 的 3/4） | 维护者 2026-10-03「屏幕大小的 80%，左右 3 比 1」 |
  | 右栏（操作编辑）宽 | 视口的 20%（整组的 1/4） | 同上 |
  | 列间距 | 24 px | — |
  | 内容总宽 | 视口 80%、居中 | 同上，取代 2026-10-02 的「≈931 px」 |
  | 三档断点 | 均 80% + 3:1，不堆叠；<1024 px 只显示「窗口过窄」 | 维护者裁定（ADR-0029 决策 6） |
  | 右栏滚动 | 跟着页面滚，不吸附 | 维护者裁定 |
  | 正文列宽 | **撑满左栏，不再限 34em** | 维护者 2026-10-03；V4 行宽合同在阅读页废止（勘误记 Proposal 勘误节） |

  2026-10-02 的原取值（左栏 34em、右栏 2/3、总宽 931 px、3:2）已被上表取代，过程与代价见
  [`walkthrough.md`](walkthrough.md) Round 3。

- **外壳限宽不适用于阅读页**：ADR-0029 决策 2 规定 `/stories/:id` 隐藏侧栏，所以「侧栏 + 内容整体限宽 1120 px」
  不约束这一页；阅读页的限宽由本 Task 的 80vw 承担。
- **右栏「编辑与关联」默认展开、收藏在标题行**（维护者 2026-10-03）：右栏本来就是操作栏，
  再点一次「展开」才出现表单是多余的一步。（**注**：收藏在 Round 9 已从标题行移入 C 段
  「我的标记」，标题行现在只剩展开/收起；本条的「默认展开」仍然有效。）
- **版面分隔线统一用 `<Separator decorative />`**（维护者 2026-10-03，取代 `border-t pt-4` 的老写法）：
  块与块之间是独立元素，不把线长在区块容器上；`decorative` 把它从无障碍树摘掉（线表达的是视觉层级，
  不是内容语义）。横向线高度用 `--divider-thickness`＝**0.75em**（维护者 2026-10-03，16 px 下 12 px）、
  **两头圆角**；**竖向线固定 1 px 且不加圆角**。**线的位置规则（Round 9/10 收紧到全仓）：任何区块组件
  都不自带线，线只在父级的相邻子元素之间放；条件渲染的区块必须与它前面的线绑在同一条件**。
  列表行（`first:` / `last:` 变体）与 `CardFooter` / `DialogFooter` / `Tabs` 的线仍是 `border`。
  顺带修掉一个真缺陷：`Separator` 的变体属性名停留在 Base UI v1（`data-horizontal`），
  在 v2 下尺寸规则不生效，渲染出来是 0 高度的隐形线。
- **右栏按使用频率分四段、顺序 C→B→A→D**（维护者 2026-10-03）：C 我的标记（收藏/固定/标签/收藏夹/批注）、
  B 家族与关系（归并/拆分；壳上另加已拆分与迁移）、A 内容与表示（改表示/时间范围/关键事实）、
  D 对象关联（关联 Entity/加入 Topic）。分类判据是「改的是哪一层数据」；收藏从标题行移入 C 段。
  实现上按段落拆组件、**状态随段落走**：C 段 `story-edit/marking-editor` +
  `story-panel/story-marking`、D 段 `story-edit/entities-editor`；A/B 段的草稿仍归面板
  （`0005-web-client.md` 的「五份草稿判定在 StoryEditPanel 内」是既有合同）。
- **全站写回执统一走 toast**（维护者 2026-10-03，Round 11 阅读页、Round 12 其余全部页面）：
  写一条标记就凭空出现一条横幅、把正文往下推，很突兀。`ToastProvider` + `ToastHost` 挂在
  路由组 layout（**必须挂在祖先层**：页面自己要 `useToast`，在同一个组件里渲染 Provider 会抛
  `useToastManager must be used within <Toast.Provider>`）；`useNoticeToast` 把 `ctx.setNotice`
  适配成 toast，**语气是参数**（`setNotice(文案, "info")`，只有「报告状态」才传 info，
  默认 success）——写在 context 上会被 `react-hooks/immutability` 拦。
  **`PageBanners` 从此只负责错误**（错误要留在页面上、不该自己消失）。
- **外壳 UI 随后续 UI 需求一并改**（维护者 2026-10-03，Round 17–19，都算在本 Task 内）：
  **顶栏** 56→**64 px**、与下方框架留 **2.5em（40 px）** 间隔、加第 2 层 token `--surface-toolbar`
  底色（原先完全透明、与页面底分不开）；间隔放布局层而不是顶栏的底部内边距（后者会让内容偏上）。
  **悬浮侧栏**整体**等比放大 1.5 倍**（196→294 px）：所有尺寸乘 `--nav-scale`，
  **不能用根字号**（Tailwind 的 rem 按根字号算，会波及全站）也不能用 `transform: scale`
  （焦点环与阴影会拉伸发虚）；整组限宽随之 `calc(196px*var(--nav-scale)+900px)`＝1218 px，
  **主内容仍 880 px**（行宽不随侧栏变宽）。**侧栏跟随滚动**：`sticky top-[calc(4rem+2.5em)]`
  （top 正是未滚动时的位置，贴上不跳）；`sticky` 而非 `fixed`，仍留在文档流里。
  侧栏高度仍由内容撑开——导航项多到超过视口高度时底部会被裁，见 ADR-0029 的 Revisit Gate 第 1 条。
- **「操作面板太靠下」的解法是换轴不是吸附**：两栏从同一高度开始，读标题时右栏编辑入口已在同一屏；
  右栏仍随页面滚动（维护者选择），因此不引入 sticky。
- **媒体归左栏、排在正文之后**（维护者裁定），并**从 `StoryEditSurface` 移出**：一个区块一个所有者，
  不再出现同一张图既在阅读流又在编辑面。
- **归并不新增读查询**（与 Task 35 Follow-ups 的预估不同）：`GET /search` 已能按标题文本检索并返回 `storyId`，
  现有 `page-runtime.ts` 的 `RELATED_STORY_PORTS.searchByLabelIds` 已是同一用法。选择列表在客户端按当前
  Story 去重并排除自身。**该查询只能列出有当前 Revision 的 Story**（Feed/Search 都以 Entry 为投影单位），
  历史壳与零成员 Story 无法作为归并目标——这是既有读合同的边界，本 Task 不扩合同，只记录。
- **顺手修四条**（2026-10-02 维护者裁定「就这四条」，全部落在本 Task 必改的文件里）：
  ① `live-provider` 的 context value 未 memo；② 归并选择列表的键盘/屏幕阅读器可达性；
  ③ 预算门禁「SSE 恰好 1 条」未覆盖唯一例外路由 `/stories/:id`；④ 「编辑中不被覆盖」只验了标题一个字段，
  另四份草稿（类型/细分类型/时间范围/关键事实）无门禁。
- **不新增 schema/migration**：`updateLabel` 改既有 `Label.name`（唯一约束已存在，冲突映射沿用 `LabelConflictError`）。

## Implementation Walkthrough

按切片顺序推进；每切片的 RED/GREEN、实际命令与结果、偏差写入 [`walkthrough.md`](walkthrough.md)（唯一过程记录位置）。

**过程记录已按文档大小治理滚动归档**（2026-10-03）：主文档保留 Round 10 起，更早轮次移入分册，
索引见 [`walkthrough.md`](walkthrough.md) 头部的分册表——`walkthrough/rounds-0001-0003.md`、
`rounds-0004-0006.md`、`rounds-0007-0009.md`、`rounds-0010-0012.md`（四册封口后只读；
主文档保留 Round 13 起）。

| 切片 | 内容 | 状态 |
| --- | --- | --- |
| A | Story 阅读页两栏版面 + 拆 `StoryEditSurface` + 媒体归左栏 | ✅ Round 1；Round 3 改成 80vw + 3:1 + 正文撑满；Round 4–15 按维护者逐项裁定收敛（默认展开、分隔线、右栏重排、toast、字段排版） |
| B | 归并改可选目标（复用 `GET /search`，零后端改动） | ✅ 已落地；据此删掉禁用词门禁的唯一例外 |
| C | `/topics/:id` 详情页 | ✅ 已落地；Round 29 补专属浏览器用例（改标题与目的、成员角色/移除/恢复、读不到的占位与判据 R3） |
| D | `/entities/:id` 详情页 | ✅ 已落地；Round 29 补专属浏览器用例（别名增删、关系增删、两端显示名称、读不到的占位） |
| E | 标签改名竖切（合同→端口→存储→API→传输→界面→三层测试） | ✅ 已落地；无 schema/migration；Round 29 补专属浏览器用例（改名生效、撞名 409 留原地且草稿不丢、取消） |
| F | 顺手修四条（两条变成新的浏览器门禁） | ✅ 已落地并通过 |
| G | 外壳 UI 追加（维护者 2026-10-03 指明算在本 Task 内）：顶栏加高/留间隔/加底色、侧栏等比放大、侧栏跟随滚动 | ✅ Round 17–19；1.5 倍经维护者判定过大，Round 21 收敛到 1.25 |
| H | 真人验收第一轮反馈（维护者 2026-10-03）：A3 侧栏改 1.25、B 右栏每段加标题、E1 右栏最小宽度、F1 首页看板拖拽失效、顶栏换色 | ✅ Round 20–24；A/B/C/E/F 已处理，D 待维护者复验 |
| I | 真人验收 D5 反馈（维护者 2026-10-05）：归并选中后输入框不回填标题、拆分只能增不能删后继、拆到 1 个后继时报 Zod 原始错 | ✅ Round 26–27；三处都已修并补回归用例 |
| J | 真人验收 D5 续（维护者 2026-10-05）：拆空原条后它从信息库消失，留在壳上的用户状态够不着；要求「管空壳」 | ✅ Round 28；合同保留，加 `splitFrom` 回链 + 拆空前确认；不删壳（ORG-014 与 ADR-0012 决策 6 挡着） |
| K | 收尾：补切片 C/D/E 的专属浏览器用例（维护者 2026-10-05 要求） | ✅ Round 29；新增 `object-detail-pages.spec.ts` 5 例，验收债清零 |

**状态：已完成（2026-10-05）。** 真人验收 D4/D5/D6 全部通过，切片 C/D/E 的浏览器验收债已在
Round 29 补齐；改动提交为 `9fccfcb`（实现）与 `5102bf6`（收尾），分支
`feat/t36-reading-layout-and-object-details`，worktree 保留。

**下一步**：

1. **合并**：分支已提交但**未推送、未合并**；未经授权不动。
2. **切片 C/D/E 的验收债**：两页详情页与标签改名没有专属浏览器用例，只有手工抽查。维护者
   2026-10-05 以「验收完成」覆盖了本轮真人验收，但**未单独销账**——补用例或另立 Task 由维护者定。
3. ~~窄档取舍（1024 px 右栏 199 px）待真人验收时定~~ → 已定：右栏加 240 px 最小宽度（Round 23）。
4. ~~D5 复验~~ → 已复验，暴露的三处缺陷见切片 I/J，均已修完。

> `PROJECT-STATUS.md` 已于 2026-10-03 同步（Task 36 段落 + 验证边界）；`docs/api`、`docs/spec` 的标签
> 改名片早已同步（`0002-product-api-http.md`、`0004-http-client.md`）。

## Verification

分四层报告，不互相替代：聚焦测试 → 全量测试与类型检查 → 浏览器验收（含既有门禁）→ 真人验收。

**真人验收的复验范围**：Task 35 关键任务 4/5/6（读一条内容并判断可信度、把两条内容合成一条再拆开、
给内容打标签/写批注/加入话题/关联 Entity）因 Story 页排版问题延后，**在本 Task 的切片 A 与 B 落地后复验**——
这是 Task 35 移交时的原始理由（「两者都在 Story 页上，4/5/6 的复验也要等那一轮，同批只需复验一次」）。

**版面门禁的现行断言**（`e2e/browser/story-reading.spec.ts`，Round 3 起，Round 23 修正）：三档断点各断言
居中（±2 px）与无横向溢出；右栏宽于 240 px 下限时仍断言整组宽为视口 80%（±1%）与两栏比 2.9–3.2，
下限生效时（1024 px 档）改为断言右栏 ≥240 px；正文与左栏等宽（34em 上限已废止）。
`layout-and-budget.spec.ts` 继续守外壳三档断点（侧栏 245 px、整组 ≤1145 px）、阅读页侧栏例外与 SSE 恰好 1 条。

**门禁状态（2026-10-03 收口复核 + Round 20–24 复跑）**：**当前没有未运行的门禁**：

```text
bun run test:browser                      -> 53 passed（2.9m，零失败）
bun run test:browser:component-lab        -> 21 passed / 1 flake（已知双预览 flake，单跑对应文件全过）
bunx vitest run apps/web/src/copy apps/web/src/component-lab -> 32 passed
bun run lint:web                          -> 0 error / 18 warning（基线）
bunx tsc --noEmit -p apps/web/tsconfig.json -> exit 0
bun run docs:check                        -> 952 文件 0 失败
python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new -> PASS
```

**仍未运行的**是**验收**而不是门禁：切片 C/D/E 的专属浏览器验收（见下）与真人验收。

Round 4–8 期间改过断言但**当时未跑**的用例（`story-reading` 的 `expandEditSurface`、
`phase2-organization` 的收藏数、`component-lab/story-edit-panel` 的默认展开）
**已在这两套里跑到并通过**。

**Round 12 的 toast 迁移改了 5 条浏览器用例的断言**（横幅 → toast：`e2e/support/lab.ts` 新增
`latestToast()` 按 `data-toast-seq` 取最新一条，`e2e/support/notice-log.ts` 的记录器同时扫 toast 宿主）：
`collection-plan-multi`、`feed-search-race`、`source-lifecycle-and-search-filters`、
`phase2-entry-relation`、`phase2-organization`。两套套件已全部复跑通过，**没有留下未运行的门禁**。

Round 5 把大量 `border` 换成分隔元素、Round 9 重排 DOM、Round 12 换掉全部回执通道，
**都可能影响按结构或文案断言的浏览器用例**，两套套件均已全绿。

**窄档取舍已定**（Round 23）：右栏加 **240 px 最小宽度**，按 3:1 算的 199 px 不再出现；
代价是窄档整组略超视口 80%、由左栏让位（维护者在「只加下限」与「左栏改自适应」之间选了前者）。

未运行项、已知限制与失败现场按 [`docs/testing/README.md`](../../../docs/testing/README.md) 记录。

## Follow-ups

- 三条 `/automation` 交互诉求仍在 [`../35-frontend-redesign/README.md`](../35-frontend-redesign/README.md) 的 Follow-ups，本 Task 不接手。
- 组件级 772 处内联文案迁移待单开文案批次 Task。
- 其余审查 Optional/Nit（maxWait、双入口归属、实验室门禁扩到 `components/shell`、docs 与夹具治理）仍挂 Task 35 Follow-ups。
- 归并目标只能来自有当前 Revision 的 Story；历史壳与零成员 Story 不可选（既有读合同边界）。
