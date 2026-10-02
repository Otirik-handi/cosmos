# Task 35 Walkthrough · Round 8 分册

> 本册是 [`../walkthrough.md`](../walkthrough.md) 的封口分册：Round 8（旧浏览器套件重写）的逐轮
> 记录，2026-10-01 按文档大小治理整段移入，**只搬位置、不改写条目**。
> 当前状态、门禁与最近几轮仍在主文档。

## Round 8 · 旧浏览器套件重写（2026-10-01）

**授权**：维护者「开」（承接 Round 7 的结论：切片 3 未达完工标准，差 3b ③ 的搬迁回归证据、
浏览器验收层的完整通过、以及 3d ③ 的 UI 端到端）。

### 为什么这是唯一的证据来源

Round 7 核对时实测：`e2e/browser` 20 个 spec 里 **6 个仍在驱动已删除的单页 UI**
（`打开 Story` / `role="dialog"`）——`phase2-organization`(21 处)、`ingest`(6)、`offline`(5)、
`phase2-entry-relation`(4)、`story-representation`(4)、`media-policy`(2)。
3b 验收 ③ 点名的「Phase 2 浏览器套件回归」就是它们；它们跑不起来，层 3 就无法整体报绿。

### 唯一保留下来的前置：共享录入助手

**共享录入前置 `e2e/support/story-flow.ts`**：把「`/automation` 建来源 → 启用 → 手动录入 →
等 Story 落库 → 打开阅读页 → 展开编辑面」收成一份（旧套件每个文件都抄了一遍 `ingestFeed`）。
另有 `FIXTURE_TITLES`、`uniqueSourceName`、`boardBlock`、`enterBoardEditing`、
`collectConsoleErrors`，以及重写过程中补的 `mergeStoryInto`（造多成员 Story 的唯一路径）与
`readStoryDetail`（读服务端落库形状）。用独立 tsc 校验过类型——顺带发现 **`e2e/` 与 `scripts/`
都不在 `bun run typecheck` 覆盖内**，浏览器验收的代码只靠运行时验证。

> 另外两个为并行而加的基础设施（RSS 端口可配、跳过重复构建）**最终都撤回了**，
> 理由见下面「并行方案整体撤回」——那一节也保留了它们曾经造成的事故。

### 并行重写（按文件分四批，各占独立端口）

| 批次 | 文件 | 用例数 | 端口 |
| --- | --- | --- | --- |
| 1 | `ingest.spec.ts` | 1 | web 4173 / rss 4380 |
| 2 | `phase2-organization.spec.ts` | 8 | web 4174 / rss 4381 |
| 3 | `media-policy.spec.ts`、`offline.spec.ts` | 3 + 1 | web 4175 / rss 4382 |
| 4 | `story-representation.spec.ts`、`phase2-entry-relation.spec.ts` | 1 + 1 | web 4176 / rss 4383 |

**纪律**（写进每批的任务书）：只换导航与选择器，**保住领域断言**（数据/事件/持久化结果）；
对话框形状断言（`role="dialog"`、Escape、焦点归还）删掉而不伪造；断言按各自的唯一来源名限定
（同一栈会话内数据库跨重试/跨 spec 持久化）；不用 `test.skip` / 加长超时掩盖问题。
第 2 批额外要求保住 **ADR-0020 用户状态迁移**那一段——它是全仓唯一的 UI 端到端证据。

### 一次自己造成的事故：跳过构建把四套栈全指向了 QQ

第 4 批在跑到录入前置时报告「所有栈都拿不到 API 数据」，并给出正确判断：`next build` 会把
`rewrites()` 的目标地址**烘焙**进 `.next/routes-manifest.json`，`next start` 读的是那份产物，
运行时设 `COSMOS_API_URL` 不生效。**根因是我加的 `COSMOS_E2E_SKIP_BUILD=1`**：
`web-stack.ts` 本来每次都会带**本栈**的 `COSMOS_API_URL` 重跑一次 `build:web`，跳过之后四套栈
共用我那份预构建产物，而它烘焙的是默认值 `http://localhost:4310`——本机 4310 的 `127.0.0.1`
被 QQ.exe 占着（对任何路径都回 200 + 168 字节垃圾），于是四套栈的 `/api/*` 全打到 QQ。

### 并行方案整体撤回（本轮第二次修正）

第一版修法是「撤掉跳构建 + 给每套一份产物目录（`COSMOS_WEB_DIST_DIR`）」。**这个方案最终也撤回了**，
因为另外两批实测出两个新副作用，合起来说明并行不值这个风险：

1. **`next build` 会写脏跟踪中的文件**：Next 自动往 `apps/web/tsconfig.json` 的 `include` 追加
   `<distDir>/types/**/*.ts`，五个产物目录就在 `git status` 里留下 10 行 `apps/web/tsconfig.json`
   的改动（已 `git checkout` 还原，并删掉 5 个 `.next-e2e-*` 目录）。
2. **`findAvailablePort(4310)` 有探测→绑定竞态**：四套栈同时启动时各自探到同一个空闲端口，
   只有一套能 bind。表现比失败更坏——web 仍报就绪、代理指向**另一套栈的 API**，用例前半段
   「通过」其实打的是别人的数据库；那套栈一收工，本栈就全线超时（实测 `EADDRINUSE 4311`）。
3. **残留服务会被静默复用**：上一轮崩掉的 `next start` 占着端口，`waitForHttp` 被它满足，
   于是本轮测试打在**上一轮的构建产物与数据库**上（`reuseExistingServer: false` 挡不住这个形态）。

**最终形态**：撤回 `COSMOS_WEB_DIST_DIR` 与 `COSMOS_E2E_RSS_PORT` 两个开关（`next.config.ts`、
`playwright.config.ts` 恢复原样），改为**一套一套串行跑**；只保留一条真正防坑的守卫——
`web-stack.ts` 启动前探测 web 端口，被占用就明确报错退出，不再悄悄复用别人的服务。

**教训（写给下一个想并行跑这套验收的人）**：要并行，得同时解决三件事——每套独立产物目录
（且要处理 `tsconfig.json` 被自动改写）、按栈错开的确定性 API 端口、启动前的端口占用校验；
本任务不值得为省十几分钟承担这三样。串行跑一套约 2–3 分钟（含构建）。

**顺带堵住一个更危险的形态**：第 4 批为绕开问题在 `[::1]:4310` 起了一条中继转发到自己的栈。
`localhost` 会解析到 `::1`，那样四套栈会**全部打到同一条中继**——不是失败，而是四套互相污染，
跑出来的绿是假的。已要求拆除，并要求各批只用仓库的 `playwright.config.ts`。

**教训**：`rewrites` 的构建期烘焙是这套验收的隐含前提，任何「省一次构建」的优化都会静默改变
被测对象指向谁；要并行就该给每套独立的产物目录，而不是共用产物。

### 重写过程中由各批反查出来的问题

各批在跑绿的过程中反查出 6 处产品缺陷，全部是本轮或切片 3 引入的，已修 5 处、留 1 处记录。
**它们有个共同点：都是「界面照样渲染、门禁照样绿」的那一类**，只有把用例逐条跑到真实数据上才暴露。

1. **我简报里的造数办法是错的**：我说「两个来源录同一份 fixture feed 就能得到双成员 Story」。
   实测证伪——`projectEntryToStory` 用 `story:<entryId>` 生成 Story id，Entry 又按
   `(sourceInstanceId, canonicalExternalId)` 唯一，两个来源只会得到 6 条各自独立的 Story。
   **多成员 Story 的唯一造法是归并**。已把 `mergeStoryInto` / `readStoryDetail` 加进
   `e2e/support/story-flow.ts`，并纠正还在跑的两批。
2. **阅读页自激取数循环（最严重，我引入的）**：`story-reading.tsx` 的挂载 effect 依赖
   `openStory`，而 `useStoryWorkspace` 里它是普通 async 函数——每次渲染都是新身份，effect 每渲染
   重跑一次 → `setStory` → 再渲染。实测**3 秒内对同一条 Story 发了 349 次请求**（一条拆分用例
   24 秒内 2300+ 次）。后果：页内 Story 跳转失效（点历史壳的后继按钮跳不过去）、迁移提交后的
   界面长时间停在提交前、整套验收被拖慢。**修法**：`openStory` 改 `useCallback`（依赖
   `collectionList` / `ctx` / `refreshRelatedStories`，三者都身份稳定）；并在
   `story-reading.spec.ts` 加**取数次数门禁**（阅读页对同一条 Story ≤8 次），防止再犯。
3. **阅读页的关键事实出处恒为「出处已删除」**（切片 3d 起就在）：`story-reading.tsx` 给
   `StoryKeyFactsBlock` 传的是 `entryOptions={[]}`，而 `keyFactSourceLabel` 只在候选里找不到时
   才回「出处已删除」——传空数组等于把**每一条**出处都判成已删除。**修法**：传与编辑面同一份候选
   （`keyFactEntryOptions`：本 Story 成员 + 全量已加载条目，ADR-0021 决定 3）。
4. **阅读页从不加载标签目录**（我引入的）：`story-reading.tsx` 没调 `listLabels`，
   `labels.items` 恒空 → 「选择要添加的标签」下拉**从不渲染**，Story 页无法打标签。
   **修法**：`useStoryWorkspace` 增加 `loadLabels`，阅读页挂载时调用。
5. **`/library` 没把 `labels` 传给 FeedBrowser**（切片 3b 搬页时漏的）：`按标签筛选` 一栏全站
   无处渲染，用户无法按标签筛内容。**修法**：信息库也调 `loadLabels` 并把 `labels.items` 传下去。
6. **`/topics/:id`、`/entities/:id` 是死链**（切片 3b/3c 遗留）：两个列表页的每一行都
   `router.push` 到详情路由，但**没有页面文件** → 点进去 404。README 里「仍是占位」的说法与事实
   不符（占位页从来不存在）。**修法**：补两个占位路由（说明这一页还没建好 + 回列表入口），
   404 消失；详情页本身（话题改标题与目的、成员改角色/移除、Entity 别名与关系）仍是 Follow-up。

另有两处**记录与事实不符**（已按实测更正）：`/library` 其实有 `<h2>Story Feed</h2>`（缺的是
**页级**标题「信息库」）；`e2e/browser` 的陈旧 spec 不是 6 个而是 6 个用抽屉形状 + 6 个用首页
「新建计划」入口，后者在首页入口删除后一并搬走。

### 顺带清掉的两处重复

1. **页面级错误/回执横幅**：同一段标记在首页、阅读页、信息库、话题、Entity 五个页面里各抄了
   一遍（`/automation` 的回执多一个对勾图标，是它自己的变体）。抽成
   `components/shell/page-banners.tsx`，五处改为调用它。这也把首页拉回 **287 行**
   （Round 7 收在 294，加横幅后一度到 301，超了入口红线 1 行）。
2. **首页的来源创建入口**（见上）：删掉后首页只剩看板与系统产出两块。
3. **实验室预览台的瞬时双份**：`source-form.spec.ts` 的 probe-success 用例在整套跑里假红过一次
   （`getByText("测试成功")` 命中 2 个节点、单跑通过）——`LabStage` 在会话同步那一帧会渲染两份。
   抽 `e2e/support/lab.ts` 的 `expectSinglePreview`（先等「恰好一个预览台」再断言，既容忍瞬时态、
   又把「只有一个预览台」当不变量），`source-form` / `theme` / `story-edit-surface` 三个 spec 统一用它。
   同类 flake 在本轮出现过两次（`[data-component-lab-preview]` 严格模式违规），这是它的根治。

### 逐批结果

| 批次 | 文件 | 结果 |
| --- | --- | --- |
| 1 | `ingest.spec.ts` | **1 用例连续 8 次全绿**（含真实归并、看板隐藏/恢复、Spotlight 固定/解除、未绑定收藏夹区块） |
| 2 | `phase2-organization.spec.ts` | **8/8 绿，连跑两次**（46.2s / 54.5s；含拆分 + ADR-0020 迁移正反两向） |
| 3 | `media-policy.spec.ts`、`offline.spec.ts` | spec 已重写并自查（tsc 通过）；**在串行全量跑里验证** |
| 4 | `story-representation.spec.ts`、`phase2-entry-relation.spec.ts` | **2 用例连跑两次通过** |
| 5 | 6 个用首页入口的 spec 搬到 `/automation` | **10/10 绿，连跑两次**（44.3s） |
| 6 | `theme`、`user-data-export`、`connector-state-export`、`connection-visibility` | **11/11 绿，连跑两次**（1.1–1.2m；新增 1 条覆盖「存量取值不可识别 → 跟随系统」） |
| 全量 | `npx playwright test --config playwright.config.ts`（20 个 spec） | 第 1 次：**39 通过 / 10 失败**（3.6m）；第 2 次（补完最后 4 个文件后）：**50 通过 / 0 失败（2.6m，exit 0）** |

### 全量跑暴露的第四批陈旧 spec（我前两次统计都漏了）

第 1 次全量跑 39 通过 / 10 失败，失败的 10 条集中在 4 个此前没进过我陈旧清单的文件：

- `theme.spec.ts`（6 条）：仍在断言**切片 1 就删掉的两套轴**（`data-cosmos-theme="neurobook"` ×
  `data-cosmos-colorway="macos-light|macos-night"`），连用例名都写着「falls back to macOS light」。
  参考实现是已经改好的 `e2e/component-lab/theme.spec.ts`。
- `user-data-export.spec.ts`、`connector-state-export.spec.ts`（各 1 条）：在首页找**存储面板**，
  它现在在 `/settings`。
- `connection-visibility.spec.ts`（2 条）：在首页找**连接面板**，它现在在 `/automation`。

**统计口径的教训**：我前两次用 `打开 Story`/`dialog`/`新建计划` 去筛陈旧 spec，得到「6 个」，
后来又补出「再 6 个用首页入口」，实际是 **16 / 20 个文件**。原因是**旧单页把什么都挂在首页**——
页面标题、连接面板、存储面板、主题切换、检索区、计划列表、Story 抽屉——任何一处搬走都会让
按那一处写的 spec 失效，而按关键词筛只能筛到你想到的关键词。**可靠的判定只有一种：跑一遍全量。**

各批都按要求交代了删掉的旧断言（对话框形状、`打开 Story` 触发器、首页 `Cosmos` 标题、
`信息库与搜索` 区块、四个创建表单、`[data-story-subtype]`、已不存在的 Topic/Entity 面板），
并主动报告了一处放宽：`requestfailed` 只排除 `net::ERR_ABORTED`（Next 路由预取被取消），
控制台错误与 pageerror 仍零容忍。

另有一处**我上一轮漏收的 3e 范围**：首页仍保留「新建计划」+ 来源表单，与 `/automation` 的
「新建来源」重复（Round 5 明确记为 3e 的清理项，我 Round 7 拆首页时把它原样搬进了新组件）。
维护者裁定删除首页入口，并把 6 个依赖它的 spec（`collection-plan-connectors`、
`collection-plan-multi`、`feed-search-race`、`list-state-race`、
`source-lifecycle-and-search-filters`、`webhook-entry`）一并搬到 `/automation`。

### 收尾修掉的两处产品问题与一处合同纠正

1. **`/automation` 的来源表单开关有两个所有者**：页面自己 `useState`，hook 里也有一份（保存成功后
   置回收起）。首页入口删掉后 hook 那份**没有消费者**，于是保存成功后表单不收起、字段又被
   `reset()` 回示例值——「回执说已保存、表单还开着、URL 还是 example.com」的错位。**修法**：页面改用
   workspace 的 `showSourceForm`（单一所有者），保存后收起，与旧首页行为一致。
2. **我简报里关于主题降级的说法是错的**：我写「localStorage / matchMedia 不可用时落回 `system`」，
   产品合同是**一律回退亮色**（`theme-provider.tsx` 的两条降级分支都返回 `preference:"light"`，
   `theme-bootstrap.ts` 注释也写明「回退亮色，绝不阻止页面启动」）。真正落回 `system` 的是
   **无法识别的存量取值**（`theme.ts` 的 `parseThemePreference`，旧的 `macos-*` 走这条）。
   该批按真实语义重写，并**新增一条**浏览器层用例覆盖它。
3. **`.agent/` 会被 docs 规模门禁扫描**：某批把 207 KB 的运行日志留在那里，门禁直接判红。
   已清理（含 49 个残留的隔离栈数据根）。

### Round 8 验证

| 命令 / 检查 | 结果 |
| --- | --- |
| `npx playwright test --config playwright.config.ts`（全量，20 个 spec，**当前树复跑**） | **50 通过 / 0 失败（2.6m，exit 0）** |
| `bun run test:browser:component-lab` | **21 通过**（含预览台守卫修好后的复跑） |
| `bun run test:e2e`（CI 另一条门禁） | **6 文件 / 12 用例通过**（须先 `bun run db:generate`，并设 `BUN_BINARY` 指向真实 `bun.exe`，见下） |
| `bun run test` / `typecheck` / `lint` | **137 文件 783 用例** / **0 错误** / **0 error（18 warning）** |
| `bun run docs:check` / 两条规模门禁 | **925 文件 0 失败** / 代码与 docs **双 PASS** |
| 版面与预算门禁（在全量里） | 三档断点、过窄提示、导航常驻、阅读页例外、断言有效性自证、SSE 恰好 1 条、reduced-motion 归零、首屏可交互 158ms、路由切换 121ms、首屏 JS 289.5 KB |
| 逐批（串行，默认端口） | 批次 1 8 次全绿；批次 2 8/8 两次；批次 4 2/2 两次；批次 3 4 条；批次 5 10/10 两次；批次 6 11/11 两次 |

### Round 8 未运行 / 已知边界

- **`bun run test:e2e` 在本机需要两个前置**：① 先 `bun run db:generate`（CI 里有这一步，我第一遍漏了，
  表现为 6 个文件全失败在 `applyMigrations`）；② 设 `BUN_BINARY` 指向真实的
  `C:\Program Files\nodejs\node_modules\bun\bin\bun.exe`——`helpers.ts` 用
  `spawnSync(BUN_BINARY || "bun")`，而本机 PATH 里的 `bun` 只是 PowerShell 垫片 `bun.ps1`，
  `spawnSync` 解析不了 `.ps1`，报 `spawnSync bun ENOENT`。这是环境层问题，不是本轮改动引入的。
- 4 个主题用例的**降级路径**（localStorage/matchMedia 不可用 → 回退亮色）是按产品合同断言的；
  「localStorage 不可用但 matchMedia 可用时是否该跟随系统」是产品决策，未改。
- 各批建议的助手补充（`expectShellReady`、`openSettings`/`openAutomation`、`e2e/support/theme.ts`、
  `planGroupOf`、`openSourceForm`、`readStoryUntil`）**没有实现**：它们各自只在 2–3 处重复，
  收益小于再加一层抽象的维护成本；记在这里，等真出现第四处再收。
- **`e2e/` 与 `scripts/` 都不在 `bun run typecheck` 覆盖内**：浏览器验收的代码只靠运行时验证，
  本轮给共享助手单独跑过 `tsc --strict`。

### 第 4 层：真人验收（2026-10-01，维护者本人）

**环境**：隔离数据根 `.agent/acceptance/`（全程不碰真实数据）；RSS fixture(4380) + API(4312) +
Worker（轮询 50 ms）+ Web dev(3000)；用真实 UI 路径种入 2 个来源 / 6 条内容、1 个标签（已挂 1 条）、
1 个话题（1 成员）、1 个 Entity（已关联）、1 条收藏、1 条批注。维护者另外**用真实来源（阮一峰 RSS）
跑通了任务 2**——这是「真实来源验收」层的证据，不是 fixture 造出来的。

| # | 任务 | 结果 | 维护者原话要点 |
| --- | --- | --- | --- |
| 1 | 看一眼今天有什么 | **通过** | 「能」，但左侧竖直导航栏不醒目、无法跟随页面滚动，要求放大并随页面滚动 |
| 2 | 配一个来源并让它跑起来 | **通过** | 真实来源配置成功、抓到信息、信息库看到新内容；三条改进诉求见下 |
| 3 | 按标签筛一遍并留住条件 | **通过** | 「这个没问题，功能正常，使用没问题」 |
| 4 | 读一条内容并判断可信度 | **延后** | 受 Story 页排版问题阻塞，难以测试 |
| 5 | 把两条内容合成一条、再拆开 | **延后** | 同上；另暴露「归并要填 Story ID，但完全不知道去哪里找」 |
| 6 | 打标签/批注/加入话题/关联 Entity | **延后** | 受 Story 页排版问题阻塞 |

**维护者裁定（2026-10-01）**：① Story 页排版（正文与图片分开、内容区过窄、操作面板太靠下）
**新开 task 处理**，本 task 不记录、不处理；② 任务 4/5/6 的人工验收等 Story 页 UI 改动后再做，
本轮功能验收以脚本为准；③ 任务 2 的三条改进诉求**记在本 task 的 Follow-ups，不在本 task 修**；
④ 「归并要粘贴内部 Story ID」**归到 Story 页那个新 task 同批处理**（两者都在 Story 页上，
4/5/6 的复验也要等那一轮）。

**任务 2 的三条改进诉求**（维护者原话整理）：① 「新建计划」应改成模态框；② 「创建连接」同样改成
按钮 → 模态框 → 表单 → 确认/取消，现在的连接表单位置改成**连接列表**（要有空状态）；
③ 采集计划列表行的操作按钮（启动/暂停等）只有图标没有文字，需要 tooltip。

**本轮顺带核出、已按实测更正的两处记录**：① README 的 3a 段原本**没有「状态」行**，已补，
并写明判据①只达成 3/4（批注列表无标题投影）、判据③「写入合同 diff 为零」**未验证**；
② 3c 的批注标题投影、`/topics/:id` 与 `/entities/:id` 详情页、标签与收藏夹改名、收藏夹加成员
四项未完成项已在 Follow-ups 显式列出（此前散在子切片正文里）。
