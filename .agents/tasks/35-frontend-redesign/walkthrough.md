# Task 35 Walkthrough

本文件是 Task 35 的**唯一过程记录**：每轮的切片、RED/GREEN、实际命令与结果、范围偏差、未运行项、五轴 review finding 都追加在这里，不回改历史记录。当前摘要、范围与门禁在 [`README.md`](README.md)。

## Round 0 · Task 建立（2026-09-24）

**本轮性质**：任务建立，**未开始任何实现切片**。

### 已完成

| 事项 | 结果 |
| --- | --- |
| Proposal `frontend-redesign-v1` 转 `accepted` | 维护者 2026-09-24 接受；授权更新稳定文档与创建本 Task |
| 新增 ADR [`0029`](../../../docs/adr/0029-ui-surface-layout-and-visual-direction-v1.md) | 沉淀三层分工、版面骨架、路由层级、视觉方向、token 轴收敛、断点、外壳级单条 SSE |
| ADR 索引登记 | `docs/adr/README.md` 追加 0029 条目 |
| `ui-surface-ownership-v1` 勘误节 | 注记「Story 抽屉」措辞、`/library` 独立页面、标签/收藏夹新建对称化；信息架构决定继续有效 |
| `neurobook-theme-system` 勘误节 | 注记主题与配色合同被取代、两套轴收敛为单一明暗轴；分层思想与 token 约束继续有效 |
| 原始需求追加 | `docs/requirements/0001-original-requirements.md` 追加 2026-09-24 条目，含维护者原话要点表与 Agent 的反对/保留 |
| 本 Task 建立 | 编号 35（维护者分配，不复用 25）；一个 Task 内分四个切片 |

### 未做

- **未写任何实现代码**（硬闸门：三层设计已获批，但本 Task 尚未进入实现授权）。
- **未建 worktree、未建分支、未 commit、未 push**。
- 未更新 PRD §8 与架构 §11.4 的注记（见下方偏差）。
- 未更新 `docs/spec/interfaces/0005-web-client.md`（行为未落地，spec 记录当前事实）。
- 未更新 `PROJECT-STATUS.md`（状态改变时更新）。

### 偏差与说明

1. **PRD 与架构的注记未在本轮执行**。Proposal 的「对稳定文档的预期改动」列出了 PRD §8.1–8.3/8.5/8.6 与架构 §11.4 的注记；本轮只改了 Proposal 状态、ADR、两份旧 Proposal 的勘误与原始需求。理由：这两处注记描述的是**落地形态**，而落地形态在切片 3 才产生；现在写会变成对未实现状态的承诺。切片 3 完成时同批更新。
2. **文档大小**：`docs/requirements/0001-original-requirements.md` 为 51.8 KB，已在红线区且属只增不改的需求真相源，按治理规则允许继续追加；本轮追加为单次事件记录，未拆分该文件。
3. **Agent 就设计提出的反对意见已留档**：侧栏高度由内容撑开的代价（维护者维持原选择）、i18n 框架的反对（维护者采纳）、「B 会丢上下文」表述过重（已更正）。三条都写在原始需求条目与本 Task 的 Decisions 节。

### 验证

| 命令 / 检查 | 结果 |
| --- | --- |
| 新增/修改文档的相对链接解析 | 全部 OK（按各文件自身目录为基准） |
| `python scripts/size-governance.py --check --baseline docs/doc-governance/docs-baseline.json` | 新增的 `docs/proposals/frontend-redesign*` 文件**未触发**任何门禁；整体 FAIL 的 6 项红线均为既有 Web 文件（`page.tsx` / `story-panel.tsx` / `board-view.tsx` / `product-fixtures.tsx` 等），正是本 Task 切片 3 要重做的对象 |
| `typecheck` / `bun run test` / 浏览器验收 / `docs:check` 全量 | **未运行**——本轮只改文档，未改代码 |

### 下一步

等待维护者授权进入**切片 1（地基）**。进入实现前需要：① 实现授权；② worktree 与分支授权（AGENTS.md 要求建 worktree 前获批准）。

## Round 1 · 切片 1 地基（2026-09-24）

**授权**：维护者 2026-09-24 授权切片 1 + worktree。

**环境**：worktree `.worktree/t35-foundation`，分支 `feat/t35-frontend-redesign-foundation`，base SHA `da147a5`（与 `origin/master` 同点）。可写文件集合：`apps/web/src/**`。未 commit、未 push。

### 已完成

| 子切片 | 内容 |
| --- | --- |
| 1a token 换装 | `globals.css` 重写为 V4 的 token 三层（语义映射 + `--marker`/`--marker-soft`/`--paper` + 形状密度动效，两档圆角，`--elevation-*` 三档阴影）；`theme.ts` / `theme-bootstrap.ts` / `theme-provider.tsx` 收敛为单一 `data-cosmos-appearance`；`theme-switcher` 三选项改为跟随系统/亮色/暗色；`component-lab` 的 `LabThemeId`+`LabColorwayId` 合并为 `LabAppearanceId`，URL 维度由 `theme`+`colorway` 改为 `appearance` |
| 1a 附带 | 移除 `next/font` 的 Geist 引入——V4 字族合同是系统栈，留着会让中英文出现两种字形 |
| 1b AppShell | `components/shell/`：`top-bar.tsx`（品牌、全局搜索跳 `/library?q=`、连接状态、明暗切换）、`side-nav.tsx`（内容/管理两组八项，`aria-current` 标记当前项）、`page-placeholder.tsx` |
| 1c 路由骨架 | 路由组 `(shell)`（顶栏 + 悬浮侧栏）与 `(reading)`（仅顶栏 + 返回）；首页由 `app/page.tsx` 移入 `app/(shell)/page.tsx`，其 7 条 `./home/*` 相对导入改为 `@/app/home/*`；另建 8 个路由（library / topics / entities / system / organize / automation / settings / stories/:id） |
| 1d live-provider | `components/shell/live-provider.tsx`：单条 `EventSource`、事件→topic 映射表、300 ms 合并、`useLiveTopic` / `useStreamState`；首页移除自建连接，改为订阅 `library` 与 `automation` |

### 过程中发现并修正的三个问题

1. **`LiveProvider` 放错层级会导致切组重连**。第一版放进两个路由组 layout，实测 9 次页面加载产生 9 条 SSE 请求。改为挂在**根布局**：`ThemeProvider > LiveProvider > children`，事件订阅 hooks 经 context 跨路由组存活，与「顶栏/侧栏常驻」的架构一致。
2. **worktree 需要自己的 Prisma client 与包构建**。首次 `bun run test` 有 50 个文件失败（`Cannot find module '.prisma/client/default'`），`bun run dev:web` 报 `Cannot resolve '@cosmos/logging'`。在 worktree 内执行 `bun run db:generate` 与 `bun run build:packages` 后恢复。
3. **验证脚本的口径错误（自查发现）**。此前用 `page.goto()` 逐页测 SSE 计数，得出「9 次加载 9 条连接」——但 `goto` 是整页重载，每次重载本就应该新建连接，那不是回归。改为「首载一次 + 其余全部用侧栏链接做 SPA 导航」后，7 次切页新增连接为 **0**。

**一次误判（记录以免重犯）**：截图里画布看起来是白的，一度怀疑 token 没生效；实测 `body` 背景是 `rgb(244,243,238)`（`#f4f3ee`），卡片是 `rgb(255,254,251)`（`#fffefb`），两者只差约 4% 亮度，是设计上有意为之的克制，在缩放后的图片预览里看不出来。**结论来自实测，不来自看图。**

### 验证

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun run --cwd apps/web tsc --noEmit` | **0 错误** |
| `bun run test`（worktree 内） | **134 文件 / 767 用例全部通过**；基线（PROJECT-STATUS 记录 2026-09-23）为 124 文件 / 726 用例，差额来自这段时间的其它切片 |
| 亮/暗 token 实测 | 亮 `#f4f3ee`/`#1c1f1c`、暗 `#141715`/`#e4e9e3`；`data-cosmos-appearance` 与 `dark` class 同步；字体已是系统栈 |
| 版面骨架（Playwright，1440×900） | 八个内容页 `navTop=56 / navLeft=20 / searchTop=18` 完全一致，**SPA 切页无漂移** |
| `/stories/:id` 例外 | 侧栏不存在、返回入口存在、顶栏保留 |
| 顶栏搜索 | 回车跳 `/library?q=测试关键词` |
| SSE 连接 | 全过程 **2 条 = 2 次整页文档加载**（首载 + Story 直接访问）；**7 次 SPA 切页新增 0 条** |
| 代码规模 | 新增外壳文件 12–101 行；`(shell)/page.tsx` 由 802 行降至 736 行（代码规模门禁要求入口 ≤300 行，切片 3 继续拆） |

### 未运行 / 已知边界

- **浏览器验收全量套件未运行**：`bun run test:browser` 需要先 `bun run build` 且要起 API 与 Worker；切片 1 只跑了一次性的 Playwright 版面探针（脚本已删）。
- 首页仍带旧的页头（「Phase 1 · 本地信息库」）、右侧状态栏与 `max-w-7xl` 容器，与 V3 的版面不完全一致——属**切片 3 的范围**（首页纯看板化时同批处理），本轮未动。
- `component-lab` 的 token 登记表（`tokens.ts`）仍是旧 token 名（背景/前景/主色/圆角），与新 token 的对应关系待切片 2 一并整理。
- 未 commit、未 push、未创建 PR。

## Round 2 · 切片 2 组件库（2026-09-24）

**授权**：维护者「继续」。仍在同一 worktree 与分支，未 commit。

### 已完成

| 事项 | 内容 |
| --- | --- |
| 8 个 primitive | `dialog` / `alert-dialog` / `menu` / `tabs` / `toast` / `select` / `combobox` / `tooltip`，全部基于 Base UI（`@base-ui/react`），对齐项目已有的 class 与 token 写法（`rounded-[var(--radius-control)]`、`shadow-[var(--elevation-*)]`、`text-[13px]` 密度） |
| 实验室登记 | 新增 `component-lab/primitive-fixtures.tsx`；`registry.tsx` 追加 8 个定义（共 31 个）；`registry.test.ts` 的期望公共模块清单同步；`tokens.ts` 的 token 登记表改为 14 个新 token（画布底/卡片面/阅读面/正文/次要/强调/机器来源/圆角两档…） |
| toast 组合修正 | Base UI 的 Toast 是「manager 持有队列 → Viewport 遍历渲染」，改为导出 `ToastProvider` / `ToastHost` / `useToast` 三样，`useToast` 返回稳定函数 |

### 过程中发现并修正的四个问题

1. **toast fixture 触发「Maximum update depth exceeded」**。`useToastManager()` 每次渲染返回新引用，把它放进 `useEffect` 依赖 → effect 反复执行 → `add()` 更新状态 → 再渲染。改为 ref 持有；`useToast` 也改用 `useMemo` 返回稳定函数，避免真实页面踩同一个坑。
2. **弹层用受控 `open` 时实验室失去验证意义**。受控强制打开时组件没走完真实初始化路径：dialog 的 Esc 不生效（焦点不在弹层内）、menu 的内容根本没有渲染。改为非受控 `defaultOpen`，评审者可以真的点、真的用键盘。
3. **`MenuContent` 的 children 放错层级**。挂在 `Positioner` 上导致 `Popup` 内为空——Base UI 的菜单项必须挂在 `Menu.Viewport` 下。补上 `Viewport` 后菜单项正常渲染，方向键高亮随之生效。
4. **PowerShell 批量正则替换破坏了文件编码**。用 `Get-Content -Raw` + `-replace` 批量改一个含中文的 `.tsx`，写出后文件变成非法 UTF-8、无法读取，只能删除重写。**教训：含多字节字符的文件不能用 PowerShell 文本管道批量改，必须用编辑工具。** 已删除的损坏文件与新建文件同名，`write` 工具因状态跟踪仍指向旧 inode 而拒绝写入，最终以「写新文件名 → 移动覆盖」绕过。

### 验证

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun run --cwd apps/web tsc --noEmit` | **0 错误** |
| `bun run test`（worktree 内） | **134 文件 / 767 用例全部通过** |
| `bunx vitest run apps/web/src/` | 16 文件 / 102 用例通过（含组件实验室 4 个门禁文件 / 27 用例） |
| 注册表门禁 RED→GREEN | 加 primitive 未登记时 `registry.test.ts` 如期报红（列出 7 个未登记模块）；补登记后转绿 |
| 8 个 primitive 浏览器渲染 | 全部 `stage=true`、**无渲染循环**；控制台只剩「API 未启动」导致的 SSE MIME 错误（预期，本轮不跑 API） |
| 键盘路径（V4 要求） | tooltip 由 focus 触发 ✅；dialog 打开与 Esc 关闭 ✅；combobox 方向键高亮 ✅；menu 方向键高亮 ✅ |
| **对比度实测**（V4 要求必须量） | 亮/暗各 7 组，**14 组全部 ≥ 4.5:1**；最低为亮色 `次要文字/画布` 4.97:1 与 `机器来源/机器来源底色` 4.95:1 |
| 新增文件规模 | 46–136 行（`primitive-fixtures.tsx` 266 行），均在 400 行舒适区 |

### 未运行 / 已知边界

- **三档断点（1024 / 1280 / 1440）未出图验证**：E5 定义的三档断点属版面规则，切片 1 只在 1440 px 测过导航位置；断点本身的验证并入切片 4 的门禁断言。
- **`prefers-reduced-motion` 未在浏览器里实测**：token 已归零（`globals.css` 的媒体查询），但没有断言证明动效确实停止。
- `test:browser:component-lab` 未运行（需要 build）。
- 首页旧页头与右侧状态栏仍在，属切片 3 范围。
- 未 commit、未 push、未创建 PR。

## Round 2b · 维护者验收发现的两个缺陷（2026-09-24）

维护者在实验室里实际点击后报告：**「Dialog 组件点击后没有对话框弹出」**。复查确认是两个真实缺陷，且**都是我自己先前的验证方法掩盖掉的**。

### 缺陷 1：Dialog / AlertDialog 的触发器从未接上

`primitive-fixtures.tsx` 里把 `<Button>` 直接放在 `<Dialog>` 内，**没有用 `DialogTrigger` 包裹**。Base UI 的触发器要靠 `Trigger` 组件接收 ref 并合并 props（`render={<Button />}`），直接放普通按钮只会得到一个普通按钮。

证据：点击前触发器按钮的 `data-slot` 是 `button` 而不是 `dialog-trigger`，`aria-haspopup` 为 `null`；点击后弹层与遮罩数量均为 0，且控制台无报错。

**为什么先前没发现**：上一轮的验证用 `defaultOpen`（自动打开）判断「组件能渲染」，而受控/初始打开恰好绕过了触发路径。**教训：验证交互组件必须走真实的交互路径（点击、键盘），不能用初始状态代替。**

修复：两个 fixture 改用 `DialogTrigger` / `AlertDialogTrigger` 的 `render` 属性包裹按钮。

### 缺陷 2：Combobox 的输入过滤没有生效

我按「自己过滤数组再 map」的方式实现，输入「定价」后 4 条仍全部显示。Base UI 的 Combobox 是**由 `Combobox.List` 的函数子节点接收组件已过滤的条目**；调用方不应自己过滤。

修复：`ComboboxList` 改为要求函数子节点（`children: (item, index) => ReactNode`），不要 `map` 一个外部数组；fixture 同步改为函数子节点写法。**这个 primitive 的合同本身就是交付物**——如果保持错误用法，切片 3 的每个选择器都会重犯。

### 修复后的完整验证（真实点击路径）

| 组件 | 结果 |
| --- | --- |
| dialog | 点击打开 ✅ · Esc 关闭 ✅ · 关闭后焦点回到触发元素 ✅ |
| alert-dialog | 点击打开 ✅ · 取消关闭 ✅ · 确认键为 destructive ✅ |
| menu | 点击打开 ✅ · 4 个菜单项 ✅ · 方向键高亮 ✅ · Esc 关闭 ✅ |
| select | 点击打开 ✅ · 4 个选项 ✅ |
| combobox | 点击展开 ✅ · 输入「定价」过滤为 **1** 条 ✅ · 无匹配时显示空态 ✅ |
| tooltip | 键盘 focus 触发 ✅ |

`failures: 0`。同轮 `bun run test` 仍为 **134 文件 / 767 用例全部通过**，`tsc --noEmit` 0 错误。

### 结论

维护者的一次实际点击，暴露了两个被「看起来能跑」掩盖的接线错误。**这两个缺陷都不在类型系统或单元测试的覆盖范围内**——它们只在真实交互中显现。后续切片必须保留「真实点击路径」的验证方式，不能退回初始状态检查。

## Round 2c · 维护者验收与 FeedBrowser 顺手修改（2026-09-24）

### 验收结果

维护者 2026-09-24：**「这样刚好，看起来不错，组件这部分切片验收通过。」** 切片 2（8 个 primitive + 实验室登记 + 键盘/对比度验证）验收通过。

### 同轮顺手修改：FeedBrowser 搜索区排布

维护者在验收过程中另提了三条布局要求，直接落在 `components/cosmos/feed-browser.tsx`（**该文件不属于切片 2 的交付范围**，见下）：

| 维护者要求 | 实现 | 实测 |
| --- | --- | --- |
| 关键词框视觉占比最大 | 主搜索行独占一行，字号 13→15px、高度 36→45px（筛选控件保持 32px） | 宽 512px，同行最宽 |
| 两个时间框同一行，`<from> - <to>` 形式 | 同一行并排，中间「至」；随后按维护者要求**去掉「从」**以使左边界对齐 | 两框 `top` 相同；三档宽度下左边界与搜索框一致 |
| 搜索按钮与关键词框在一起 | 紧贴其右侧同排 | 按钮 `left` = 搜索框右边界 |
| 关键词框与下方距离 +12px | 行距 10 → 22px | 实测 22px |

顺带把三个 `<select>` 的 `rounded-lg` 改为 `rounded-[var(--radius-control)]`，对齐 V4 的两档圆角。**无障碍标签（「开始日期」「结束日期」「搜索已保存内容」）全部保留**，浏览器验收里按标签定位的断言不受影响。

验证：`tsc --noEmit` 0 错误；`bunx vitest run apps/web/src/` 16 文件 / 102 用例通过；1440 / 1280 / 1024 三档均无横向溢出；`feed-browser.tsx` 现 447 行。

### 待维护者决定：这次改动的归属

FeedBrowser 是**过渡组件**——按 ADR-0029 决策 3，检索工作台在切片 3 会整体搬到 `/library`，届时它的布局与主题还会再统一一次。因此这次修改有两种处理方式：

维护者 2026-09-24 裁定：**保留**。改动随本分支进入切片 3，在其基础上继续调整。

## Round 2d · 提交切片 1 与 2（2026-09-24）

维护者授权：**commit 切片 1+2**（未授权 push、PR、merge）。

| commit | 内容 | 范围 |
| --- | --- | --- |
| `a00597e` | `feat(web): give the UI one appearance axis, a floating shell and a single event stream` | 切片 1：token 换装、单一明暗轴、AppShell、路由组、外壳级单条 SSE。27 文件 |
| `374c6d6` | `feat(web): add the eight primitives the new pages need, with lab scenes` | 切片 2：8 个 primitive + 实验室登记 + token 登记表 + FeedBrowser 排布。15 文件 |

**提交前检查**：暂存区逐项核对，`git diff --cached --name-status` 确认只含该切片文件；未用 `git add -A`。切片 1 提交时 Git 自动把 `app/page.tsx → app/(shell)/page.tsx` 识别为 `R093` 重命名。

**提交后复核**：
- `git diff --stat master..HEAD`：**42 文件，2317 插入 / 385 删除**；
- 全部改动都在 `apps/web/` 内，无跨模块污染；
- `tsc --noEmit` 0 错误；`bun run test` **134 文件 / 767 用例通过**；
- 工作树 `git status` 干净；临时 commit message 文件建在仓库外并已删除。

**未做**：未 push、未创建 PR、未 merge。分支 `feat/t35-frontend-redesign-foundation` 仍只存在本地 worktree。

### 下一步

切片 3（四个只读查询 + 十个页面搬迁 + 首页纯看板化 + 抽屉表单同批删除）尚未开始，等待授权。





