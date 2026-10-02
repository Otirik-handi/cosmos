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

**Task 36 开始前（2026-10-02 复核，均经代码核对）**：

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

- **本 Task 的版面决定来自维护者 2026-10-02 的直接指令**，不是 Agent 自行设计。具体取值与依据：

  | 项 | 取值 | 依据 |
  | --- | --- | --- |
  | 左栏（内容）宽 | 34em（≈544 px） | V4「正文列 ≤34em」；**行宽合同不动** |
  | 右栏（操作编辑）宽 | 左栏 × 2/3 ≈ 363 px | 维护者 3:2 |
  | 列间距 | 24 px | — |
  | 内容总宽 | ≈931 px 居中 | 维护者「不要完全占满导航栏下方」 |
  | 三档断点 | 均 3:2，不堆叠 | 维护者裁定 |
  | 右栏滚动 | 跟着页面滚，不吸附 | 维护者裁定 |

- **外壳限宽不适用于阅读页**：ADR-0029 决策 2 规定 `/stories/:id` 隐藏侧栏，所以「侧栏 + 内容整体限宽 1120 px」
  不约束这一页；阅读页的限宽由本 Task 的 931 px 承担。
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

| 切片 | 内容 | 状态 |
| --- | --- | --- |
| A | Story 阅读页两栏 3:2 版面 + 拆 `StoryEditSurface` + 媒体归左栏 | 未开始 |
| B | 归并改可选目标（复用 `GET /search`） | 未开始 |
| C | `/topics/:id` 详情页 | 未开始 |
| D | `/entities/:id` 详情页 | 未开始 |
| E | 标签改名竖切 | 未开始 |
| F | 顺手修四条 | 未开始 |

## Verification

分四层报告，不互相替代：聚焦测试 → 全量测试与类型检查 → 浏览器验收（含既有门禁）→ 真人验收。

**真人验收的复验范围**：Task 35 关键任务 4/5/6（读一条内容并判断可信度、把两条内容合成一条再拆开、
给内容打标签/写批注/加入话题/关联 Entity）因 Story 页排版问题延后，**在本 Task 的切片 A 与 B 落地后复验**——
这是 Task 35 移交时的原始理由（「两者都在 Story 页上，4/5/6 的复验也要等那一轮，同批只需复验一次」）。

**版面门禁的既有断言需随本 Task 复核**：`e2e/browser/layout-and-budget.spec.ts` 已断言阅读页的侧栏例外、
三档断点、SSE 恰好 1 条与首屏/路由预算；改成两栏后这些断言是否仍成立、哪些要补（尤其 34em 行宽与
3:2 比例本身是否要变成可断言合同），在切片 A 的验收里逐条核对并记录。

未运行项、已知限制与失败现场按 [`docs/testing/README.md`](../../../docs/testing/README.md) 记录。

## Follow-ups

- 三条 `/automation` 交互诉求仍在 [`../35-frontend-redesign/README.md`](../35-frontend-redesign/README.md) 的 Follow-ups，本 Task 不接手。
- 组件级 772 处内联文案迁移待单开文案批次 Task。
- 其余审查 Optional/Nit（maxWait、双入口归属、实验室门禁扩到 `components/shell`、docs 与夹具治理）仍挂 Task 35 Follow-ups。
- 归并目标只能来自有当前 Revision 的 Story；历史壳与零成员 Story 不可选（既有读合同边界）。
