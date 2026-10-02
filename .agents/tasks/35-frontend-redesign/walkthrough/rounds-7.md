# Task 35 Walkthrough · Round 7 分册

> 本册是 [`../walkthrough.md`](../walkthrough.md) 的封口分册：Round 7（切片 3e 收口 + 切片 4）
> 的逐轮记录，2026-10-01 按文档大小治理整段移入，**只搬位置、不改写条目**。
> 当前状态、门禁与最近一轮仍在主文档。

## Round 7 · 切片 3e 收口 + 切片 4（2026-10-01）

**授权**：维护者「继续 Task 35 切片 3e 的剩余部分，然后做切片 4」。中途就三处停下来问，裁定如下：

| 问题 | 裁定 |
| --- | --- |
| 组件实验室里「产品不可达」的三个面板怎么收 | **A：把编辑面接回 `/stories/:id`**（不删、不只服务实验室） |
| 集中文案的范围与节奏 | **甲·分批**：本会话做外壳 + 页面级 + 门禁；组件级按域后续批 |
| 实验室 `registry.tsx` 超线 | **拆到线内**（推翻了上一轮「实验室文件不并入」的建议） |

### 已完成

**1. 阅读页编辑面（裁定 A）**：删掉 `story-panel.tsx`（849 行抽屉壳），新建
`story-edit-surface.tsx`（450 行）+ `story-edit/organization-editor.tsx`（389 行）。
阅读页接管取数与写入（`use-story-workspace` 成为 Story 的**唯一可写入口**），只读区块常驻、
写入动作收在「编辑与关联」里按需展开。实验室登记、fixtures、用例同步改名。
顺带删掉抽屉里的调试页脚（Entry / Revision / Observation 裸 id 清单）——判据 R3 明令禁止
要求用户认内部标识符。

**2. 三个原超线文件收口**（node 口径）：

| 文件 | 前 | 后 |
| --- | --- | --- |
| `components/cosmos/board-view.tsx` | 972 | **194**（桶文件）+ `board-view/{shared,types,editor,blocks}` 45/44/351/384 |
| `app/(shell)/page.tsx` | 520 | **294** + `home/board-toolbar.tsx` 95 + `home/source-form-panel.tsx` 72 |
| `components/cosmos/story-panel.tsx` | 849 | 删除（由编辑面取代） |

首页同时删掉切片 3b 留下的死代码（`onSearch` 54 行、`savedViewsPanel` 54 行——两者定义了但
渲染里没有任何引用，lint 因「内部互相引用」看不见）。`EMPTY_SEARCH_VALUES` /
`SOURCE_FORM_DEFAULTS` 收进各自表单模块，首页与信息库不再各写一份默认值。

**3. `registry.tsx` 拆分**：814 行 → 入口 15 行 + `registry/{shared,controls,ui-renderers,definitions-ui,definitions-cosmos}`（86/110/127/283/271）。

**4. 集中文案模块（E6）**：`src/copy/messages.ts` 是唯一入口，按界面区域分册
（`copy/areas/{common,shell,home,library,pages,organize,automation,reading,notices}.ts`）。
本会话迁完**外壳 + 十个页面 + 写入口径的回执**（`app/home/use-*` 的通知与错误）。
组件级剩余 **772 处 / 46 个文件**登记在 `copy/inline-copy-baseline.json`，**只减不增**。

**5. 两条文案门禁**（`copy/messages.test.ts` + `copy/scan.ts`，用 TypeScript AST 扫用户可见字面量）：
禁用词命中即失败（「分类」「历史壳」「未注册」「Spotlight」「Story ID」「受管理 subtype」
「审计」「不变量」「provenance」「policy/version」「Revision」）；内联文案新增/增长/迁完未销账即失败。
进度随时可量化：`bun run apps/web/src/copy/scan.ts`。

**6. 版面与预算门禁**（`e2e/browser/layout-and-budget.spec.ts`，9 条全绿）：

| 断言 | 实测 |
| --- | --- |
| 三档断点（1024/1280/1440）侧栏在左、内容限宽、无横向溢出 | 通过 |
| 低于 1024px 只显示「窗口过窄」提示、外壳不渲染（E5 原文要求，本轮补上） | 通过 |
| 切页后导航与内容位置不变（外壳不重建） | 通过 |
| `/stories/:id` 无侧栏 + 有返回入口 | 通过 |
| **故意把导航移到内容下方必须失败**（断言有效性自证，3e 验收 ②） | 通过 |
| 一次会话事件流**恰好 1 条**连接 | 1 条 |
| `prefers-reduced-motion` 动效归零 | `0s` / `0s` |
| 首屏可交互（预算 2000 ms） | **152 ms** |
| 路由切换（预算 300 ms） | **111 ms** |
| 首屏 JS（记录绝对值） | **289.7 KB / 13 个脚本** |
| 首页新建看板的回执可见（行为门禁，`home-board.spec.ts`） | 通过 |
| 对象页独立创建话题 / Entity（3b 验收 ①，`object-pages.spec.ts`） | 2 用例通过 |
| Story 页**没有**创建入口、关联入口仍在（3c 验收 ②，`story-reading.spec.ts`） | 通过 |

300 ms 事件合并窗口抽成 `components/shell/live-coalesce.ts`，用假定时器逐毫秒验证
（4 例：窗口内合并、不同 topic 各自计时、窗口过后重开、卸载不触发）。

**7. 阅读页真实数据验收**：`e2e/browser/story-reading.spec.ts` 自建来源 → 触发录入 →
按 id 打开阅读页 → 断言卡片 640px、标题 Charter、正文 16px/1.8、只读锚点、来源标记，
并断言编辑面在阅读页**可达**（保存修改 / 归并 / 添加批注 / 创建并关联 / 创建并加入）。

### 过程中发现并修正的问题

1. **PowerShell 计行漏行（工具坑，必须记住）**：本环境的 `Get-Content` 会漏掉部分行——
   `page.tsx` 数出 499 行而真实是 520，`board-view.tsx` 955 而真实 972，行号定位却一致。
   历史记录里的「472 行」「917 行」都是这个漏行值。**行数一律用 node 统计**，本轮所有数字都是 node 口径。
2. **CI 的代码门禁本来就是红的**：`ci.yml` 第 43 行的 `size-governance.py --check` 因
   `registry.tsx`（33.9 KB / 814 行，未登记进 baseline）失败。切片 2 加 8 个 primitive 时就超线了，
   历史记录没提。拆完转绿（`结果: PASS`）。
3. **浏览器套件自切片 3a 起没更新过**：`e2e/browser/**` 16 个 spec 仍全部驱动旧单页 UI
   （首页 feed 卡片 + `打开 Story` 抽屉），`bun run test:browser` 不可能通过；组件实验室 6 条断言
   还在测切片 1 已删除的 `theme × colorway` 两套轴。本轮修好实验室（21/21 绿），旧 spec 记债。
4. **外壳级 SSE 在组件实验室也开连接**：实验室不连服务，拿不到 `text/event-stream` 就往控制台报错，
   把实验室的「零控制台错误」验收弄脏（4 条 spec 因此假红）。改为 `/dev/**` 不开连接。
5. **禁用词扫描误报**：「分类」命中「细分类型」——后者恰是术语表裁定的 `subtype` 正确译名。
   加豁免词表（`BANNED_TERM_FALSE_POSITIVES`），豁免必须写理由。
6. **拆分表单要求 Story ≥2 个成员**（`split.tsx` 的 `entries.length >= 2`）：一条 RSS 条目进来只有
   1 个成员，真实数据里看不到拆分表单。这不是缺陷而是领域约束——拆分的渲染验收放组件实验室的
   双成员夹具，真实数据侧验其余动作。
7. **版面断言偶发假红**：1024px 档在整套跑时失败、单跑通过（首帧到 hydration 之间盒子短暂不成立）。
   改为 `expect.poll` 等稳定态。
8. 首页 `notice` 状态有 setter 却没有渲染点：写入口径的通知在首页**看不见**（`/automation`、
   `/topics`、`/entities`、`/library`、阅读页都有横幅）。属切片 4 的「行为门禁」范围，本轮未处理，
   记入 Follow-ups。

### 验证

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun run typecheck` | **0 错误** |
| `bun run lint`（apps/web） | **0 error**；warning 54 → **24**（拆页后失效声明清完） |
| `bun run test` | **137 文件 / 783 用例通过**（+2 文件 / +8 用例：文案门禁与合并窗口） |
| `bun run test:browser:component-lab` | **21 用例全绿**（含新增的编辑面/拆分/迁移场景） |
| `npx playwright test --config playwright.config.ts layout-and-budget home-board object-pages story-reading` | **14 用例全绿**（版面 10 + 首页回执 1 + 对象页创建 2 + 阅读页真实数据 1） |
| `python scripts/size-governance.py -c code tests --check …`（CI 口径） | **PASS**（拆 registry 前是 FAIL；基线同步删掉 3 条已不存在的条目） |
| `python scripts/size-governance.py -c docs --check …`（CI 口径） | **PASS**（修前是 FAIL：`Phase-2-UNDO.md` 9708 token、`docs/proposals/ui-surface-ownership-v1.md` 9300 token，两份都在本轮之前就超线，按先例登记进 `docs-baseline.json`） |
| `bun run docs:check` | **919 文件 0 失败**（修掉 4 条指向已删除 `story-panel.tsx` 的断链） |
| `bun run apps/web/src/copy/scan.ts` | 内联文案 772 处 / 46 文件；禁用词 1 处（已登记例外） |

### 未运行 / 已知边界

- **真人验收未做**（关键任务清单尚未冻结）。
- **`bun run test:browser` 整体仍不可能通过**：14 个旧 spec 驱动已不存在的单页 UI，本轮只重写了
  与阅读页/版面/预算相关的部分。旧 spec 逐条记债在 README 的 Follow-ups。
- **文案组件级 772 处未迁**：基线只减不增，门禁已能拦住新增内联文案。
- **E7 的「增量 ≤ 30 KB gzip」无法回溯测量**：切片 2 之前的构建产物不在本 worktree 里，
  因此本轮记录的是**绝对值**（首屏 289.7 KB）与上限，不是增量。
- 「并入本 Story 的 Story ID」仍是判据 R3 的违规（要用户粘贴内部编号），已登记为门禁例外：
  改成可搜索的选择列表需要新增只读查询，`ui-copy-review-v1` 明确不夹带进纯文案批次。

### 维护者裁定与落地（本轮收尾）

四个待裁定项都在同轮裁定并已落地：

1. **E5 偏差 → 改 ADR + 补提示**。ADR-0029 决策 6 按实测收敛为一条不随档位变化的规则
   （侧栏固定 196px、「侧栏 + 内容」整体限宽 1120px 居中、主区 880px，附两处实测理由），
   并**补上了原文一直没实现的「窗口过窄」提示**：`< 1024px` 隐藏整个外壳、只留提示，
   不做降级布局（`components/shell/narrow-window-notice.tsx`，两个路由组各挂一次）。
   顺带删掉切片 1 留下的死代码 `components/shell/page-placeholder.tsx`（无人导入）。
   门禁补一条：1000px 下提示可见、导航与内容区都不可见；1024px 起提示消失、外壳正常。
2. **首页通知横幅 → 补上**。首页现在与其它页同一条规则渲染错误与回执横幅，
   并新增 `e2e/browser/home-board.spec.ts`：新建看板后回执在首页可见、看板出现在切换器里。
3. **docs 规模门禁的既有红 → 登记进基线**。`Phase-2-UNDO.md`（9708 token，本轮未改）与
   `docs/proposals/ui-surface-ownership-v1.md`（HEAD 9228 → 9300 token）按 2026-09-16 的先例
   登记进 `docs-baseline.json`，CI 的 docs 门禁转 **PASS**（其余 8 条是已登记存量债的 warning）。
4. **切片 3 收口（裁定 A）**：核对验收口径时发现两处缺口，同轮补齐——
   ① **3b 验收 ①「不打开任何 Story 就能建出话题与 Entity」从未达成**：`/topics`、`/entities`
   一直是只读列表，而创建动作又被 ADR-0029 决策 1 从 Story 页移走，于是「建话题 / 建 Entity」
   在产品里一度没有入口。现在两个对象页各有一条创建行（话题：标题 + 关注目的；
   Entity：名称 + 类型），域命令 `createTopic` / `createEntity` 落在各自的 workspace hook 里。
   ② **3c 验收 ①②被本轮 A 裁定重新破坏**：我把四个 `onCreate*` 回调传给了阅读页的编辑面，
   组件里的 `onCreateX &&` 守卫因此失效，「新建话题 / 新建 Entity / 新建标签 / 新建收藏夹」
   四个表单又回到 Story 页，与 `/organize` 形成双写入口、并违反 ADR「创建去对象页」。
   修法不是只摘回调：四个「创建并关联」域命令（`createTopicFromStory` / `createEntityLinkedToStory` /
   `createLabelForStory` / `createCollectionFromPanel`）与三个区块组件里的创建表单**一并删除**，
   让这条违规在结构上不可能再出现；阅读页只保留关联动作（挂到已有话题、关联已有 Entity、
   打已有标签、勾已有收藏夹）。新增两条门禁：`story-reading.spec.ts` 断言四个创建按钮
   **不存在**、关联按钮存在；`object-pages.spec.ts` 断言两个对象页能独立创建。
