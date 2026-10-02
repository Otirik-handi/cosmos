# Task 35 Walkthrough

本文件是 Task 35 的**唯一过程记录**：每轮的切片、RED/GREEN、实际命令与结果、范围偏差、未运行项、五轴 review finding 都追加在这里，不回改历史记录。当前摘要、范围与门禁在 [`README.md`](README.md)。

> 2026-09-24 按文档大小治理拆出封口分册：Round 0–3 的逐轮记录移入
> [`walkthrough/slices-0-3.md`](walkthrough/slices-0-3.md)（只搬位置、不改写条目）。
> 主文档保留当前状态、门禁与最近几轮。


> 2026-10-01 按文档大小治理再拆一次：Round 4–6 的逐轮记录移入
> [`walkthrough/rounds-4-6.md`](walkthrough/rounds-4-6.md)（只搬位置、不改写条目）。
> 主文档保留当前状态、门禁与最近一轮。
> 2026-10-01 按文档大小治理再拆：Round 7 的逐轮记录移入
> [`walkthrough/rounds-7.md`](walkthrough/rounds-7.md)（只搬位置、不改写条目）。
> 2026-10-01 按文档大小治理再拆：Round 8（旧浏览器套件重写）的逐轮记录移入
> [`walkthrough/rounds-8.md`](walkthrough/rounds-8.md)（只搬位置、不改写条目）。

## Round 9 · 切片 4 行为门禁（2026-10-01）

**授权**：维护者「先提交所有改动，然后继续切片任务」。本轮做切片 4 唯一未做的验收项
（ADR-0029 决策 7 的刷新边界），也是人工验收第 1 层与第 3 层之间的最后一块门禁缺口。

### 判据与实现

判据原文：「列表页与未在编辑的详情页静默后台重读（保留滚动位置与筛选条件）；**详情页正在编辑时
不覆盖**，显示『有新变化，重新读取？』由用户决定。」

- 阅读页订阅 `stories` topic（`useLiveTopic` 通过 ref 转发回调，回调里读到的是最新的编辑状态）。
- **未在编辑**：静默 `openStory(storyId)`，滚动位置与展开状态都不动。
- **正在编辑**：只置 `stale`，页面渲染「这条内容在别处有了新变化。你正在编辑的内容没有被改动。」
  + 「重新读取」按钮；用户点它才重读。
- 「正在编辑」的判定在编辑面内：以**上次同步时的服务端状态**为基准，比较五份草稿
  （标题 / 类型 / 细分类型 / 时间范围 / 关键事实）。**基准不能是当前的 `story`**——后台静默重读会
  换掉它，那样用户什么都没动也会立刻被算成「正在编辑」，从此再也收不到静默重读。
- 用户确认重读时，阅读页换编辑面的 `key` 让它重挂载：草稿与基准一起重新初始化。这比在编辑面里写
  「prop 变了就 setState」的 effect 干净——后者会级联渲染，也被本仓库的 React Compiler 规则拦下
  （本轮先写成 effect，lint 报 `Calling setState synchronously within an effect` 与
  `Cannot access refs during render` 两条 error，改成换 key 后归零）。

### 门禁

`e2e/browser/story-live-refresh.spec.ts`（1 条，5.0s）：① 无未保存编辑时外部改标题 → 标题主体跟着变、
**不出现提示**；② 编辑标题后外部再改 → 提示出现、**输入框仍是用户那一版**、页面主体也没被换掉；
③ 点「重新读取」→ 读到新内容、提示消失、编辑面草稿对齐到新内容；全程零控制台错误。
外部改动走界面同一个命令（`POST /api/v1/stories/:id/revisions`），所以事件是真的。

用例里断言顺序有意为之：先等标题主体换掉再重新展开编辑面——先展开会拿到重挂载前那个还带草稿的输入框
（第一次跑就是这条假红，注释已写明）。

### 验证

| 命令 | 结果 |
| --- | --- |
| `npx playwright test --config playwright.config.ts story-live-refresh` | **1 通过**，连跑三次稳定（5.0s / 5.0s / 5.1s） |
| `npx playwright test --config playwright.config.ts`（全量 21 个 spec） | **51 通过 / 0 失败（2.7m，exit 0）** |
| `bun run --cwd apps/web tsc --noEmit` / `lint` | 0 错误 / 0 error（18 warning，与改动前一致） |
| 文案扫描 | 754 处 / 46 文件不变（新文案进 `copy/areas/reading.ts`） |

## Round 10 · 3a 判据①收尾：批注列表的标题投影（2026-10-01）

**授权**：同上（继续切片）。这一项是 Q1 里「切片 3 还剩 4 件」中的第 1 件，也是 3a 判据①
唯一没达成的部分。

### 做了什么

- `Annotation` 读取侧新增 `targetTitle: string | null`：目标显示标题的投影，目标已被删除时为 `null`
  （与 `SpotlightPlacement.targetTitle`、收藏列表的 `title` 同一条约定：**不把裸 ID 当标题显示**）。
- 批量解析抽成一个所有者：`resolveTargetTitles(rows)` 支持 story / entry / topic 三类，
  收藏列表与批注列表都改用它（此前收藏那份内联解析只能处理 story / entry，且与批注各写一份）。
- 整理页批注分区显示 `挂在 Story「标题」上`；目标不可读时显示「（目标已不可读）」。
- 文档同步：`docs/spec/contracts/0001-public-contracts.md` 的 Annotation DTO 字段表补上 `targetTitle`。

### 验证

| 命令 | 结果 |
| --- | --- |
| `bun run vitest run packages/storage-prisma/src/read-title-projection.test.ts …` | **15 通过**（含新增：三类目标各解析出标题、目标删除后投影为 `null`） |
| `bun run test` | **784 通过 / 137 文件**（新字段让两处 fixture 缺字段而失败，已按新合同补齐） |
| `bun run typecheck` / `lint` / 文案扫描 / `docs:check` | 0 错误 / 0 error（18 warning）/ 754 处不变 / 927 文件 0 失败 |

## Round 11 · 3c 遗留：收藏夹改名 + 两处偶发（2026-10-01）

### 收藏夹改名与改描述

命令链（合同 / 传输 / API 路由 / 仓库）本来就有 `updateCollection`，缺的只是界面：展开收藏夹后
只有成员列表与移除，没有改名入口——而分区顶部的注释还写着「新建、改描述、删除与增删成员都在这里」，
与实际不符（已改）。现在展开区里有「改名或改描述」→ 名称 + 描述两个字段 → 保存/取消，
保存后回执、重读详情并刷新列表。

**「收藏夹不能加成员」不再是缺口**：按 ADR-0029 §3「关联就地」，把某条 Story 放进收藏夹是那条
Story 上的动作（Story 页勾选），对象页只负责对象的字段。分区注释已按这条改写，不再把它记成待办。

**标签改名仍缺**：`updateLabel` 这条命令在合同、应用端口、仓库、API 里**都不存在**，要实现得补一整条
竖切（合同 + 命令 + 事件 + 路由 + 界面 + 测试），不是纯界面工作。留在 Follow-ups。

### 全量跑里的两处偶发（一处已修）

第 4 次全量跑起，两次全量各挂了一条**不同的**用例，且都在单跑时通过：

1. `phase2-organization.spec.ts` 的 feed 区块用例（1 次）：未见失败现场（被后续运行覆盖），
   单跑与随后两次全量都通过。**未定性**。
2. `layout-and-budget.spec.ts` 的「断言有效性自证」（1 次，**已修**）：对照组在首屏某一帧量到的
   盒子不满足版面断言，于是这条本该确定性的自证变成随机假红。修法与 1024px 那条同源——
   先 `expect.poll` 到版面稳定，再拿稳定的盒子做实验组。连跑三次通过。

修完后的全量为 **51 通过 / 0 失败**。

| 命令 | 结果 |
| --- | --- |
| `npx playwright test --config playwright.config.ts phase2-organization --grep "organizes a Story"` | 1 通过（含新增的改名断言：界面改名 + 服务端 `name`/`description` 都变） |
| `npx playwright test --config playwright.config.ts`（全量） | **51 通过 / 0 失败（2.6m）** |
| `typecheck` / `lint` / 文案扫描 | 0 错误 / 0 error（18 warning）/ 754 处不变 |

## Round 12 · 切片 3/4 收尾审计：把三处「未验证」全部验证掉（2026-10-01）

维护者要求确认切片 3/4 除已移交给新 task 的两项外没有别的未完成。逐条复查后，此前标「未验证／
无法回溯」的三处都能验证，已全部补上证据。

### ① 切片 4 预算门禁的「首屏 JS 增量 ≤ 30 KB gzip」（此前记「无法回溯测量」）

回到切片 1 之前的提交 `da147a5` 重新构建，与当前版在**同一探针、同一 API、同一时点**下量：

| 版本 | `load` 时点（首屏 JS） | 之后 3 秒（含路由预取） |
| --- | --- | --- |
| 基线 `da147a5`（旧单页） | 298.1 KB / 7 个脚本 | 298.1 KB / 7（当时没有外壳，无预取） |
| 当前（新 IA 首页） | **289.7 KB / 14 个脚本** | 363.2 KB / 21 个脚本 |

**增量 = −8.4 KB，在预算内**，判据达成。两点值得记：

- **口径**：E7 量的是**首屏** JS，即到 `load` 事件为止加载的脚本（`encodedBodySize`，gzip 传输体）。
  新外壳的导航链接会被 Next 预取，`load` 之后还会再拉 7 个脚本（+73.5 KB）——那不属于首屏，
  但**任何「等 3 秒再量」的做法都会把它算进去**，得出「新首页比旧页重 65 KB」的错误结论。
  我第一遍就是这么量的，差一点写出一条假的预算违规。
- **计量步骤**：`git checkout da147a5` → 清 `apps/web/.next`（**必须先清**：dev server 在当前分支留下的
  `.next/dev/types/validator.ts` 会让基线构建因找不到新路由而失败）→ 带 `COSMOS_API_URL` 跑
  `bun run build` → `next start` → 探针量 → 切回分支重建。

### ② 切片 4 的 V6 复审清单收口（此前只核了一半）

原文两条：`feed-browser.tsx` 界面上的「分类」与裸 `Topic`；首页徽标「Phase 1 · 本地信息库」与副标题已过时。

- 「分类」与裸 `Topic`：用户可见文案已改为「标签」「话题」（`copy/areas/common.ts` 的 `topic: "话题"`、
  `organize.labels: "标签"`，检索区是「按标签筛选」）；`feed-browser.tsx` 里剩下的 `分类`/`Topic`
  只在**代码注释与标识符**里，不是界面文案。
- 「Phase 1 · 本地信息库」徽标与副标题：`apps/web/src` 已无这两个字符串——切片 3b 删页头时一并去掉。

### ③ 切片 3a 判据③「写入合同 diff 为零」

查那四个只读查询的落地提交 `1c4e0aa`：改动集中在 docs、读取侧合同（`entity`/`topic`/`user-organization`）、
仓库读取实现、传输客户端与一个新的读取投影测试；**`*CommandSchema` 的行一行未动**，也没有 prisma schema
或 migration 改动；`repository-port.ts` 的唯一改动是把批注查询的目标参数改成可选（只读参数）。

### 结论

切片 3 与切片 4 除已移交新 task 的两项（`/topics/:id`、`/entities/:id` 详情页；标签改名）外，
**没有其它未完成项**：3a①-③、3b①-③、3c①-②、3d①-③、3e①-③ 与切片 4 的全部五项均已达成并有证据。

## Round 13 · 独立五轴审查与四条 Required 的修复（2026-10-01）

**授权**：维护者「检查 Task 35 是否可以闭合」。仓库唯一完成定义第 5 条要求
「所有 Critical 和 Required review finding 已解决」，而本 Task **此前没有任何 review 记录**——
这是闭合前的真缺口。于是派了一个**只读**的独立审查者（不共享本会话上下文），按仓库生命周期
第 6 阶段审 `612bc87..HEAD`（179 文件、+12773/−5238），先读测试再读实现。

### 审查结论

| 轴 | 结论 |
| --- | --- |
| 正确性 | 无 Critical、无数据损坏类缺陷；1 条 Required（占位页显示裸 ID） |
| 简单性 | 无 Required；2 条 Nit |
| 架构 | 2 条 Required（同一页两个收藏写入口；禁用词门禁不覆盖 `copy/**`） |
| 安全 | **未发现问题**（唯一 `dangerouslySetInnerHTML` 是静态常量；外部内容全部走 React 文本子节点；图片只从同源 `/api/v1/assets/:id`；媒体 URL 限 http/https 且有 `ftp://` 拒绝用例） |
| 性能 | 1 条 Required（预算门禁量的是 400 KB 绝对值，不是 E7 的增量） |

另有 10 条 Optional、3 条 Nit、11 处「测试没真正覆盖的合同」。

### 四条 Required 的修复

1. **禁用词门禁完全不覆盖 `copy/**`**（`scan.ts` 的 `SKIPPED_DIRECTORIES` 含 `copy`，而
   `messages.test.ts` 只读内联扫描的结果）——**迁移得越彻底，门禁越空**，与「命中即失败」相反。
   修法：`messages.test.ts` 新增一条直接遍历 `messages` 的断言（字符串值 + 用占位实参求值带参文案，
   求不出值的显式记成问题而不是静默跳过），且**不过中文字面量过滤**，所以 `Revision` 这类纯拉丁词
   也能抓到。首跑覆盖 212 条字符串值、**零命中**；`scan.ts` 的注释写明「跳过 `copy` 是为了量内联残留，
   禁用词由那条测试负责」。
2. **`/stories/:id` 同一页两个收藏写入口**（动作区按钮与编辑面的 `story-favorite-toggle` 调同一条命令，
   违反 ADR-0029 决策 1，也是 3c 验收 ② 要清的形态）。修法：删掉编辑面那一块及其 prop 链
   （`organization.tsx` → `organization-editor.tsx` → `story-edit-surface.tsx` → 阅读页），
   动作区保留唯一入口；两条 spec 断言同批改，并新增「整页只有 1 个收藏按钮、编辑面里 0 个」。
3. **两个占位详情页把内部 ID 显示给用户**（我自己 Round 8 加的 `<p className="font-mono">`）。
   判据 R3 与「不把裸 ID 当标题显示」是同一条规矩，本 Task 还为此删过阅读页的调试页脚。
   修法：删掉那两行，页面连 `params` 都不再需要（顺带去掉 `decodeURIComponent` 在畸形转义下的
   500 风险）。**同类还有一处**：看板 Spotlight 区块的 `targetTitle ?? targetId` 回退（搬迁前就有，
   本 Task 未登记）→ 改成「（目标已不可读）」，与收藏/批注分区一致。
4. **预算门禁没量它声称的东西**：断言写的是 400 KB 绝对值，等于给 +110 KB 的回归开绿灯。
   修法：上限改成**基线 + 预算**（298.1 KB + 30 KB，注释写明基线的来源是 Round 12 对 `da147a5`
   的实测），并把取样点移到 **`load` 事件那一刻**（`addInitScript` 在 load 时快照脚本体积）——
   新外壳的导航预取发生在 `load` 之后（实测 +73.5 KB），等几秒再量会得出错误的「重了 65 KB」。

### 顺手修掉的 Optional 与门禁盲区

- **O4** 看板区块回退显示裸 ID（见上）。
- **O6** `live-provider.tsx` 的注释说「Job 成功没有独立事件」与事实不符（`job.succeeded.v1` 存在），
  已改成准确表述并列出未映射的三个事件类型及理由。
- **O7** 整理页批注分区的注释还写着「没有标题投影」，而它正在用 `targetTitle`。
- **O9** 1024px 那条的注释声称「整组不渲染」，实现是 `max-[1023px]:hidden`（DOM 与 JS 仍在）——
  注释改成只声称「不可见」。
- **覆盖缺口 #8**：`story-reading.spec.ts` 的正文 16px/1.8 断言被 `if (count > 0)` 包着，
  元素消失时用例照样绿 → 改成先断言正文块可见，并补上「阅读列 ≤ 544px」。
- **覆盖缺口 #9**：取数次数门禁统计了整个用例会话的请求 → 改成进入阅读页时清零计数器。
- **覆盖缺口 #3**：「写入口唯一性」只按 4 个创建按钮名做黑名单 → 新增收藏入口的唯一性断言。

### 顺带查清一处反复出现的偶发

`phase2-organization.spec.ts` 的 feed 区块用例在两次全量/整文件跑里挂过、单跑必过。查清后发现
**断言用错了标记**：看板区块渲染成 `listitem`/`button`（页面级阅读流才是 `article`），
`toContainText(sourceName)` 在区块尚未取到数时假红。改成「先等区块有 listitem，再断言含本用例来源、
且不是空视图提示」。整文件连跑两次 8/8 通过。


### 未修、已登记的审查发现

Optional/Nit 里剩下的：O1 纯拉丁禁用词对内联文案仍不可达（`copy/**` 已覆盖）、O2 另两条「移除」动作
各有两处入口（取消收藏、删除视图）、O3 实验室登记门禁不扫 `components/shell/**`、
O5 合并窗口是去抖而非节流（无 maxWait）、O8 点「重新读取」会连带把编辑面收回折叠态、
O10 路由切换预算余量只有 2.7×、N1 `listAnnotations` 在只给 `targetType` 时静默降级成列出全部、
N2 40+ prop 压成一行、N3 context value 未 memo。覆盖缺口里剩下的 6 条（增量之外的四条草稿分支无门禁、
SSE 未覆盖阅读页例外路由、entry 标题投影的空断言、纯文本渲染无载荷 fixture、断言自证只证纯函数、
`e2e/` 不在 typecheck 覆盖内）一并进 Follow-ups。

### 验证

| 命令 | 结果 |
| --- | --- |
| `bun run vitest run apps/web/src/copy/messages.test.ts` | **5 通过**（含新增的文案模块禁用词断言） |
| `npx playwright test --config playwright.config.ts phase2-organization` | **8/8 连跑两次**（feed 区块偶发已修） |
| `npx playwright test --config playwright.config.ts`（全量） | **51 通过 / 0 失败（2.6m）** |
| `bun run test` / `typecheck` / `lint` | **785 通过** / 0 错误 / 0 error（18 warning） |
| 文案扫描 | 内联 **751** 处（删掉重复收藏块后由 754 下降，基线已同步下调） |
