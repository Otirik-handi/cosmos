# Task 36 实施记录

> 本文件是 Task 36 的**唯一过程记录位置**：RED/GREEN、实际命令与结果、偏差、未运行项都写这里，
> README 只维护当前摘要、范围与下一步。分册规则见 [`../AGENTS.md`](../AGENTS.md)。
>
> **主文档保留最近的记录**（Round 20 起）；更早的轮次已按
> [`oversized-doc-splitting-v1`](../../../docs/proposals/oversized-doc-splitting-v1.md) §4.3/§4.4
> 滚动归档到 [`walkthrough/`](walkthrough/)，原位不再保留副本（拆分是移动不是复制）。

## 分册索引

| 分册 | 覆盖范围 | 标签 | 大小 | 状态 |
| --- | --- | --- | --- | --- |
| [`rounds-0001-0003.md`](walkthrough/rounds-0001-0003.md) | Round 1–3：切片 A 建版面、切片 B/C/D/E、三档断点与 80vw+3:1 改版 | 版面 / 组件拆分 / 归并 / 标签改名 | 25.7 KB | 已封口只读 |
| [`rounds-0004-0006.md`](walkthrough/rounds-0004-0006.md) | Round 4–6：右栏默认展开、分隔线统一成 Separator、粗细 0.5em | 右栏 / 分隔线 | 14.1 KB | 已封口只读 |
| [`rounds-0007-0009.md`](walkthrough/rounds-0007-0009.md) | Round 7–9：圆角、修相邻双线、右栏按 C→B→A→D 重排 | 分隔线 / 右栏重排 | 10.0 KB | 已封口只读 |
| [`rounds-0010-0012.md`](walkthrough/rounds-0010-0012.md) | Round 10–12：收紧「线只由父级放」、阅读页与全站写回执改 toast | 分隔线 / toast | 11.5 KB | 已封口只读 |
| [`rounds-0013-0019.md`](walkthrough/rounds-0013-0019.md) | Round 13–19：字段排版、toast 序号、子类型改名、顶栏加高/底色、侧栏缩放与跟随滚动 | 字段排版 / 顶栏 / 侧栏 | 17.4 KB | 已封口只读 |

主文档（本文件）保留 Round 20 起的过程记录：拖拽排序修复、侧栏 1.25、右栏段标题与最小宽度、
顶栏底色。**勘误不改历史分册**：确需更正时在下方「勘误」节追加条目，注明指向的分册与位置。

## 勘误

（暂无）

> Round 13–19（字段排版、toast 序号、子类型改名、顶栏、侧栏缩放、侧栏跟随滚动）
> 已整段移入分册 [`rounds-0013-0019.md`](walkthrough/rounds-0013-0019.md)，原位不再保留副本。

## Round 20（2026-10-03）：真人验收反馈 F1——首页看板拖拽排序失效

维护者反馈：「首页看板编辑模式的拖拽排序失效」，并要求其余反馈项处理完后再做真人验收。
这是**拖拽从能用到不能用的功能回归**，不是观感问题，所以先取证再改。

### 取证：门禁为什么没拦住

`e2e/browser/phase2-organization.spec.ts` 里那条「moves a block to the slot right below its
drop target」**根本没有拖拽**：它直接 `fetch('/api/v1/board-blocks/:id/moves')`，只额外断言了
拖动按钮的 `aria-label` 指向正确区块。拖动整条指针路径坏掉时，这条用例照样绿——
门禁守的是「接口 + 标签存在」，不是「拖得动」。

### 取证：dnd-kit 到底看到了什么

用一次性探针把 `collisionDetection` 的真实入参写进 `document.body.dataset`（临时代码，随后删除）：

```text
拖动 30px : droppableCount=1  containers=[自己]  collisions=[自己]
拖动 200px: droppableCount=1  containers=[自己]  collisions=[自己]
拖动 420px: droppableCount=1  containers=[自己]  collisions=[自己]
```

**根因**：`BoardBlockList` 每个分区各包一层 `DndContext`，分区之间互不可见。测试数据是
「热点 1 块 / 精华 1 块 / 信息流 2 块」，所以分区内没有第二个落点、跨分区又不在同一个上下文里，
`over` 只能是活动块自己 → `resolveDropTarget` 返回 null → 不发移动请求。
先用 `pointerWithin`/`rectIntersection` 试也是错的方向（它们只会让结果更差），
真正的问题在**测量范围**，不在碰撞算法。原先写的 `closestCenter` 保持不动。

（中途还踩过一次操作事故：用 PowerShell `Get-Content`/`Set-Content` 做批量改名，把文件里的
中文注释写坏了。已 `git checkout` 还原，改用编辑工具逐处修改。**批量替换必须先 dry run**。）

### 改法

`board-sortable-blocks.tsx` 增加 `BoardDndProvider`（持有 `DndContext` + 浮层 + 落点提交），
`BoardView` 用它罩住**所有**分区；`BoardBlockList` 只保留自己那一段的 `SortableContext`。
`resolveDropTarget` 本来就返回 `over` 所在分区，所以跨分区拖拽一并恢复，与编辑器的「移到」
下拉走同一条 `moveBlock`。

### 验证（Round 20）

先把 e2e 里那段假拖拽换成真实指针拖拽（否则修好了也证明不了）：按在**拖动把手的实际位置**上
（把手在区块底部，按区块顶部只点到编辑器空白处；第一版就错在这里），滚到分区顶部再拖
（新分区在页面末尾，拖动期间 dnd-kit 会滚动，事先量好的坐标会失效）。

```text
拖动前顺序: [uyv4, 3gna, b88p, gp5c]
松手前 over = b88p
移动请求: POST /api/v1/board-blocks/…uyv4/moves {"sectionId":"…bm5d","position":1}
拖动后顺序: [3gna, uyv4, b88p, gp5c]
```

落点断言不用「我量出来的坐标」而用 dnd-kit 的 `over`：面板把 `over` 写在被拖区块的
`data-drop-target` 上，用例断言「请求里的 position = `over` 区块在**拖动前**分区里的下标」
且「松手后的顺序 = 把被拖区块插到那个下标」，`over` 等于被拖块自身时直接失败。

```text
bun run test:browser -- phase2-organization -g "moves a block"  -> 1 passed (13.7s)
bun run test:browser -- phase2-organization.spec.ts             -> 8 passed (35.7s)
```

## Round 21（2026-10-03）：侧栏等比放大收敛到 1.25 倍

维护者验收 A3：「侧栏 1.5 倍过大 → 改 1.25」。`globals.css` 的 `--nav-scale` 1.5 → **1.25**，
侧栏 294 → **245 px**；`(shell)/layout.tsx` 的整组限宽随之 1218 → **1145 px**（主内容仍 880 px）。
门禁常量同步：`e2e/browser/layout-and-budget.spec.ts` 的 `SIDEBAR_WIDTH_PX` 294 → 245、
`SHELL_MAX_WIDTH_PX` 1218 → 1145。`side-nav.tsx` / `layout.tsx` / ADR-0029 决策 6 的说明一并更新。

```text
bun run test:browser -- layout-and-budget  -> 11 passed (21.4s)
```

## Round 22（2026-10-03）：右栏每段加段标题

维护者验收 B：「右栏每一段要加一个 Title」。四段中 C（我的标记）、D 两段原本只在各自组件里
有名字，B（家族与关系）、A（内容与表示）只有分割线、没有名字，用户看不出这一堆控件属于哪一类。

维护者对方案的选择（问过再动手）：4 个大段各加标题；B 段内部的「归并」「拆分」也不做子标题
（原选项②）；分割线保持现状不动。**实施时改为**：B 的两处渲染（改表示表单在外面、
归并与拆分在 `StoryActionsSection` 里）在源文件里被 A 的标题分隔开，字面照做会让「内容与表示」
标题下面挂的是拆分表单、而「家族与关系」标题管着归并与拆分两块——命名与归属对不上。
所以把「内容与表示」的标题与线一起跟在 B 之后、拆分之前，段标题统一由 `StoryEditPanel`
渲染（新增 `SegmentTitle`，`font-display text-base font-semibold`，夹在面板总标题与字段标题之间），
段组件删掉自带标题。分割线仍是 C|B、B|A、A|D 三条，位置与数量未变。

A 段（拆分）只对多成员 Story 出现，它的线与标题跟内容绑在同一个条件上：默认场景是单成员，
照原样会留下「有标题、无内容」的空段，组件实验室的分隔线条数断言（4 条）也恰好把它抓出来。

```text
bunx tsc --noEmit -p apps/web/tsconfig.json        -> exit 0
bunx vitest run apps/web/src/copy                  -> 5 passed
bun run test:browser:component-lab (story-edit-panel) -> 2 passed（整档 21 passed / 1 flake，见下）
```

## Round 23（2026-10-03）：右栏最小宽度 240 px

维护者验收 E1。实测两栏宽（整组 = 视口 80% 后 3:1 分）：

```text
视口 1024: 整组 819  左 596 / 右 199
视口 1280: 整组 1024 左 750 / 右 250
视口 1440: 整组 1152 左 846 / 右 282
```

1024 px 窗口下右栏 199 px，「标题」输入框被压成一条、下拉选项文字截断（截图确认）。
维护者在两个方案里选了「只给右栏加下限、比例不变」：`grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]`。
代价是窄档整组略超 80%、由左栏让位（1024 px 下 819 → 855，左 596 → 555）。

`story-reading.spec.ts` 的三档断言随之改成条件式：右栏宽于下限时仍断言「整组 = 视口 80%（±1%）
且两栏比 2.9–3.2」，下限生效时改为断言「右栏 ≥240 px」；居中（±2 px）与无横向溢出两档都断言。

```text
bun run test:browser -- story-reading.spec.ts  -> 1 passed (16.1s)
```

### 验证与已知不稳定（Round 20–23）

```text
bunx tsc --noEmit -p apps/web/tsconfig.json                    -> exit 0
bun run lint:web                                               -> 0 error / 18 warning（基线）
bunx vitest run apps/web/src/copy apps/web/src/component-lab   -> 32 passed
bun run test:browser                                           -> 53 passed（2.9m）
bun run test:browser:component-lab                             -> 21 passed / 1 flake
```

组件的实验室整档那一败是**已知双预览 flake**（`strict mode violation: locator('[data-component-lab-preview]')
resolved to 2 elements`）：失败用例在 spec 之间漂移（一次是 `source-form.spec.ts`、一次是
`story-edit-panel.spec.ts`），**单独复跑对应文件全过**（7 passed / 2 passed）。与
[`known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 第 5 节同源，
不当作本轮回归。

## Round 24（2026-10-03）：顶栏底色从卡片白改成暖纸灰

维护者验收时的追加要求：「顶部导航栏换个颜色，白色不好看」。这是 Round 17 的反向修正——
Round 17 因「顶栏与页面底融为一体」把顶栏设成 `--card`（亮 `#fffefb`、暗 `#1c201d`），
那在视觉上就是白色/纯黑。

### 先出实拍再定，不凭色号猜

新造了一个探针，把候选底色注入真实 DOM 后各拍一张（明亮/暗色各一份）：卡片白（现状）、
主色淡染、暖纸底、次级灰面、主色实底。维护者看图后选了**暖纸底**（A+）。
这张实拍也暴露了一件事：主色实底方案下 `Cosmos` 标题几乎看不见——它要连带改顶栏全部文字色，
是另一档改动，维护者因此没有选它。

### 改法

```css
--surface-toolbar: color-mix(in srgb, var(--cosmos-shadow) 10%, var(--background));
```

用 `--cosmos-shadow` 而不是写死两组色值：它本身是主题感知的（亮 `#18140e` 暖褐、暗 `#000000`），
所以两套主题自动得到「比画布底深一档」的同一档关系。不取 `--card`（等于回到白色）、
不取 `--muted`（偏冷灰，与暖纸调性不合）。

### 实测（Round 24）

```text
明亮：顶栏 #deddd8 / 画布底 #f4f3ee；顶栏文字对比度 12.23:1
暗色：顶栏 #121513 / 画布底 #141715；顶栏文字对比度 14.94:1
```

顶栏不加下边框（底色已足够区分，再画线是重复表达）这条口径不变。文档同步：
`0005-web-client.md` 的「顶栏的现行取值」与 ADR-0029 决策 2。

```text
bunx tsc --noEmit -p apps/web/tsconfig.json  -> exit 0
bun run lint:web                             -> 0 error / 18 warning（基线）
bun run docs:check                           -> 952 文件 0 失败
python scripts/size-governance.py … --fail-on-new -> PASS
```

**未重跑 Playwright 整套**：本轮只改一个第 2 层颜色 token 与两处文档/注释，
CSS 变量不参与任何 e2e 断言（`layout-and-budget` 断言的是壳宽/顶栏高度/侧栏宽度）；
两套主题的观感与对比度用实拍 + 计算值核对。

## Round 28（2026-10-05）：空壳够不着——拆分来源回链 + 拆空前的确认

维护者验完 D4/D6 后，对 D5 的拆分提出一个更根本的问题：

> 默认最少两个拆分去向，但是还有默认的一个去向时保留到本条，也就是说默认其实是三个去向，
> 但是当内容只有 2 条时，无法分到三个方向……这样会导致本条直接删除。我建议的改动如下：
> 默认方向为保留到本条和一个自定义的方向。这样就没问题了。

**诊断确认**：维护者说对了。我实测自己那次拆分留下的壳：

| 项 | 实测 |
| --- | --- |
| `status` | `split` |
| 成员数 | **0** |
| 后继数 | 2 |
| 是否出现在信息库 | **不出现**（列表按 entry 投影） |

**但提议的改法要纠正一处**：合同里的 `successors` 是**要新建的后继列表**，**不含「保留到本条」**
（后端只对 `successors` 每一项 `create` 新 Story，没被认领的成员自然留在原条）。
所以「保留到本条 + 1 个后继」在合同眼里只有 **1 个后继**，正是 Round 27 那个报错的来源。
维护者随后改口：**保留合同，转而解决空壳问题**。

### 空壳该不该删？——不能，而且是否决过的

查证结论：空壳是 ADR-0012 有意保留的，不是没清理干净。它承担四件事：旧 ID 永远指向自己
（不做静默重定向）、用户状态的落脚点、审计与历史、`moveEntryToStory` 的补偿入口。
三条硬约束挡着删除：

1. ADR-0012 决策 6：壳拒绝 merge / 改 Revision / 再次 split，删除比这些更彻底；
2. **ORG-014 是需求级验收条件**：`Story split 必须保留旧 Story 的历史壳`；
3. 架构 §4.6：外部链接继续指向壳，删了会有悬空引用。

而且 ADR-0012 的「被拒绝的方案」里就有「要求历史壳至少保留一个成员」——理由是它会禁止
合法的「两个成员各拆一边」。所以**既不删壳，也不禁止空壳**。

### 真正的缺陷：空壳够不着

问题不在「壳存在」，而在**壳从信息库消失了，而用户状态按 ADR-0020 留在壳上**——
批注和标签没丢，但只能靠记住 URL 才能回去迁移。两处改动：

1. **拆分来源回链**：`StoryDetail.story.splitFrom`（原条 id/标题/kind，非拆分产物为 `null`）。
   数据库里本来就有这个反向关系（`StoryReplacement.splitFrom`），所以**无 migration**，
   只是读投影多一个字段。后继阅读页左栏渲染「拆分来源」区（`data-story-split-origin`）。
2. **拆空前的确认**：所有成员都被分走时，提交前弹 `alert-dialog`（`data-story-split-empty-shell`）
   讲清后果——原条不再出现在信息库与看板里、用户状态留在原条、可从后继的「拆分来源」回去迁移。
   取消则完全不发请求。用 alert-dialog 而不是 toast，因为后果不能从界面上撤销。

配套：删除入口的条件从「> 1」改为「> 下限」，界面到不了必然被拒的状态；后继清单的拼装抽成
`buildSplitSuccessors()`，确认路径与直接提交共用一份，避免四个 target 映射在两处漂移。

### 验证（Round 28）

```text
packages/storage-prisma/src/story-split.test.ts   4 passed（含反向边 + 旧库升级后零成员壳仍可回链）
phase2-organization.spec.ts                       8 passed
  含：弹确认 → 取消 → 状态仍 active（未误拆）→ 再提交 → 确认 → 拆成功
      后继页「拆分来源」指向原条 → 点击回到壳视图
bun run test:browser                              53 passed（2.9m）
bun run test:browser:component-lab                21 passed
apps/web/src/copy                                 5 passed
bunx tsc --noEmit（web/contracts/storage/transport/api）-> 全部 exit 0
bun run lint:web                                  -> 0 error / 18 warning（基线）
```

过程中被两道既有守卫拦下，都按守卫的要求改了实现而不是绕过：

- **禁用词扫描**：我写的「历史壳」是 `BANNED_UI_TERMS` 里的内部术语，用户可见文案不允许出现，
  改成「原条会变空 / 不再有内容」；
- **`entry-surface.txt` 冻结导出面**：新增公共导出必须按两步流程重新生成，已照做。

## Round 27（2026-10-05）：拆分下限没在界面上拦住，用户看到 Zod 原始报错

维护者接着验 D5，点「拆分」后看到：

```text
[ { "origin": "array", "code": "too_small", "minimum": 2, "inclusive": true,
    "path": [ "successors" ], "message": "Too small: expected array to have >=2 items" } ]
```

这是 Round 26 补删除入口时**我自己留下的坑**：删除入口的条件写的是「剩 1 行以上就给」，
所以能删到只剩 1 行；而合同要求**至少 2 个后继**（拆成一条不是拆分），提交必然被拒。

### 报错为什么长这样

不是服务端返回的。`client-content.ts` 的 `splitStory` 在**发出请求之前**先跑
`splitStoryCommandSchema.parse(input)`，抛的是客户端 Zod 的原始 `ZodError`，
它的 `message` 就是这个 JSON 数组。所以这次连 HTTP 请求都没发出去——
也说明「服务端会兜住」这个想法在这里不成立。

（顺带核对了服务端形状：真打到接口时返回的是 `{code:"validation_failed", message:"Request validation failed.",
details:{fieldErrors:{successors:["Too small: expected array to have >=2 items"]}}}`，
有可读字段，但界面这条路径根本没走到那里。）

### 改法

下限只写在一个地方：合同里导出 `storySplitSuccessorMinCount` / `storySplitSuccessorMaxCount`，
界面引用它，不再各写一个字面量。两处用它：

1. 删除入口的条件从「> 1」改成「> 下限」，到下限就不再给删除按钮；
2. 提交前先判下限，给可读文案「拆分至少要保留两个后继；只想留下一条的话，不需要拆分。」

### 验证（Round 27）

```text
初始 2 行 → 删除按钮 0 个（下限处不给删）        ✅
加一行 → 3 行，删除按钮 3 个                     ✅
删回 2 行 → 删除按钮 0 个                        ✅
提交（两成员各分一个后继）→ 历史壳「已拆分为 2 条」，无错误  ✅ 合法拆分仍能成功
```

回归用例加在 `phase2-organization.spec.ts` 的拆分用例里：断言「2 行时删除按钮为 0」「3 行时为 3」
「删回 2 行后为 0」，与已有的重编号断言连在一起。

改动触及 `@cosmos/contracts` 的公共导出面，`entry-surface.txt` 按仓库既定两步流程重新生成
（`bun run scripts/entry-export-surface.ts packages/contracts/src/index.ts --out …`），
`packages/contracts` 的 86 条用例全绿。

```text
bun run test:browser                      -> 53 passed（2.6m）
bun run test:browser:component-lab        -> 21 passed
bunx vitest run packages/contracts        -> 86 passed
bunx vitest run apps/web/src/{copy,component-lab} -> 32 passed
bunx tsc --noEmit -p apps/web/tsconfig.json -> exit 0
bun run lint:web                          -> 0 error / 18 warning（基线）
bun run docs:check                        -> 953 文件 0 失败
size 治理                                 -> PASS
```

## Round 26（2026-10-05）：真人验收 D5 暴露的两个缺陷

维护者做 D5（把两条内容合成一条、再拆开）时发现两处，都在右栏「家族与关系」段：

1. 归并：用选择器选好目标后，**输入框里没有显示选中的标题**。
2. 拆分：**只能增加后继，删不掉**。

两条都在真实界面上先复现再改（不是从代码推断）：

```text
① 归并：搜「派评」→ 候选 2 条 → 点选第一条后 value="派评"（期望完整标题）
② 拆分：区块内按钮只有「增加后继 / 拆分」，无删除入口
```

### ① 归并输入框不回填标题

根因是**受控输入覆盖了组件自己的回填**：`ComboboxInput` 上压了 `value={text}`（text 是搜索词），
选中候选后 Base UI 想按 `itemToStringLabel` 把完整标题写进输入框，却被这个受控值挡回去，
于是框里一直留着用户敲的搜索词。

改法：输入框的值交回 Base UI 持有，本组件只记「当前搜索词」，并**只在用户真的改字时**更新它——
选中候选同样会触发 `onInputValueChange`（reason 为 `item-press`），那时框里已经是完整标题，
若跟着当成搜索词，就会立刻拿标题再搜一次、把候选列表换掉。

### ② 拆分删不掉后继

补 `removeSplitSuccessor`。这里有个不写出来就会静默出错的点：四张「成员/证据/实体/Topic →
后继序号」的映射存的是**下标**，直接删行会让被删行之后的分配整体前移一位、**指到错误的后继上**，
而且不报任何错——只会拆错。所以删行时必须一起重编号：指到被删行的分配退回 -1（留在本条，
与既有规则一致），大于被删下标的减一。

删除入口只在**剩两行以上**时出现：删到 0 行会让「拆分」无从提交。

### 验证（Round 26）

```text
① 选中「派评｜近期值得关注的 App」后输入框 = "派评｜近期值得关注的 App"   ✅ 已回填
② 成员0 指到后继3（value=2）→ 删掉第 1 行 → 成员0 变为 value=1          ✅ 已重编号
```

回归用例（这类缺陷原来的用例抓不到，所以补在真实路径上）：

- `e2e/support/story-flow.ts` 的 `pickMergeTarget` 末尾加 `expect(picker).toHaveValue(title)`——
  它是每处归并的共用入口，一处断言覆盖全部归并场景。
- `e2e/browser/phase2-organization.spec.ts` 的拆分用例里加「增行 → 指派 → 删行 → 断言重编号 →
  回到正式分配」，复用该用例已有的双成员 Story。

```text
bun run test:browser -- phase2-organization.spec.ts        -> 8 passed（含拆分用例 5.1s）
bun run test:browser -- phase2-entry-relation ingest story-reading -> 3 passed
bun run test:browser:component-lab                        -> 21 passed
bunx tsc --noEmit -p apps/web/tsconfig.json               -> exit 0
bun run lint:web                                          -> 0 error / 18 warning（基线）
bunx vitest run apps/web/src/copy apps/web/src/component-lab -> 32 passed
```

### 顺带澄清的一件事（不是缺陷）

候选列表里出现过两条同名「派评｜近期值得关注的 App」。查证后是**两条不同的 Story**
（`cmu254fkb…` 与 `cmtsc2ik6…`）恰好同名，`storyId` 去重逻辑本身正确。不改代码。

## Round 25（2026-10-03）：口径同步与文档

- `docs/spec/interfaces/0005-web-client.md`：侧栏 245 / 整组 1145 / `--nav-scale` 1.25；
  阅读页补段标题与右栏 240 px 下限；第 21 条改成「一个看板一个 `DndContext`，跨分区拖拽可用」，
  `BoardBlockList` 的职责说明同步（它不再自己持有 `DndContext`）；顶栏底色改为暖纸灰。
- `docs/adr/0029-ui-surface-layout-and-visual-direction-v1.md` 决策 6：修正块改为 1.25 / 245 / 1145，
  并追加右栏 240 px 下限的取舍；决策 2 追加顶栏底色一条。
- **仍待维护者做**：D（Task 35 遗留的关键任务 4/5/6）真人验收；slice C/D/E 的浏览器验收债。
