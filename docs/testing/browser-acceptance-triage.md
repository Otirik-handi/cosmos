# Phase 2 浏览器验收分桶清单（33 条）

> 状态：**完成（33/33）**
>
> 日期：2026-09-24
>
> 目的：项目**后续要重做 UI**，而 P4-1 记录这套验收有五成概率间歇失败。本文件把这 33 条按「断言到底在查什么」分成三桶，供两件事决策：**重做 UI 时哪些必须保留、哪些可以重写**，以及 **P4-1 的加固该覆盖哪些用例**。
>
> **本文件只做分类，不改任何测试。** 分桶结论来自只读代码 + `docs/testing/known-unstable-cases.md`，**未运行任何测试**。

## 1. 方法与证据边界

- 由 4 个只读子代理分工通读 15 个 spec 文件（约 121 KB），逐条拆出断言并按下面的三桶定义归类；本文件是汇总。
- 每条用例的「重做 UI 时」判定只有三档：**必须保留**（合同须继续被验证，定位可改）｜**可重写**（行为须留，断言要重写）｜**大概率作废**（断言随界面重做失效）。
- **未做**：没有逐条实跑、没有读 Playwright trace、没有判定任何间歇失败的根因。凡涉及 P4-1 的因果判断都只写「候选」。

## 2. 环境事实（决定加固范围）

| 事实 | 值 | 含义 |
| --- | --- | --- |
| 并发 | `fullyParallel: false`、`workers: 1` | 33 条**串行**跑 |
| **重试** | **`retries: process.env.CI ? 2 : 0`** | **CI 上每条最多试 3 次；本地不重试** |
| 整套栈 | `scripts/e2e/web-stack.ts` 起**一个** API + **一个** Worker + **一个** Web | 33 条**全部共用**同一数据根；栈在整套结束时才拆 |
| Worker 轮询 | `COSMOS_WORKER_POLL_MS: "50"` | 抓取/工作流推进很密 |
| 超时 | 单条 60 秒 / 断言 **10 秒** | 台账里「10 秒超时」即 `expect.timeout` |
| 失败留证 | `trace`/`screenshot`/`video: retain-on-failure` | 留证配好了，但 `test-results/` 每轮被清 |
| CI | `ci.yml:90` `bun run test:browser` | 这层是 CI 门禁的一部分 |

**两条推论**（本文件多处依赖）：

1. **数据根是「每次跑一套」干净、但「一套内的 33 条」共用**；因为重试也在同一次 `playwright test` 内，`retries: 2` 的两次重试**共用同一个库**。用例靠随机源名规避 strict mode 冲突，就是为这个。
2. **「CI 绿」不代表这套验收稳定**：本地 `retries=0` 实测 8 轮里 4 轮失败；CI 上同一条要连挂 3 次才算失败，所以五成抖动率被摊薄成看起来没事（台账里就记过「判为 1 flaky（失败后重试通过）」）。

## 3. 三桶定义

| 桶 | 判据 | 例子 |
| --- | --- | --- |
| **产品契约** | 断言的是**用户可观察的产品行为或数据结果**，与界面长什么样无关 | 删除来源后已录入内容仍在；拆分后保留历史壳；FTS5 特殊字符不报 500；刷新后状态仍生效 |
| **UI 机制** | 断言的是**实现机制**；机制背后有产品决定，但换一种界面实现可能就换了机制 | 拖拽落点在目标正下方；每个区块各自取自己的流；行内两段确认的交互形式 |
| **外观** | 断言的是**当前界面的呈现**，与产品行为无关 | 明暗配色、无横向溢出、具体文案、某个布局 |

**口径提醒**：一条用例通常是**混合**的——同一个 `test()` 里既有契约断言也有外观断言。所以「整条保留/整条作废」多数时候是错的问题，正确的问题是**把一条拆成「API 层契约断言（保留）+ UI 层交互（重写）」两半**（见第 7 节规律 3）。

## 4. 总表（33 条）

| # | 文件:行 | 用例（短） | 整体桶 | 重做 UI 时 | 最脆的依赖 |
| --- | --- | --- | --- | --- | --- |
| 1 | `ingest.spec.ts:5` | 建源→采集→打开 Story | 混合（契约为主） | 可重写 | 中文精确文案链；`article`/`li` 结构；两跳父级取区块 |
| 2 | `phase2-entry-relation.spec.ts:28` | 转载关系双向 | 混合（契约为主） | 可重写 | badge 文案须精确等于「转载自 {title}」；成员标题按 ` · ` 切分 |
| 3 | `story-representation.spec.ts:30` | 事件时间＋关键事实顺序＋no-op | 混合（契约为主） | **必须保留**（契约） | 「第 N 条事实」类无障碍名；时间格式与提示文案被当契约 |
| 4 | `phase2-organization.spec.ts:30` | 标签／相关／存视图 | 混合 | 可重写 | `heading.locator("..").locator("..")` 两跳父级；中文文案链 |
| 5 | `phase2-organization.spec.ts:103` | 证据链接＋反向视图 | **产品契约为主** | **必须保留** | `selectOption({index:1})` 依赖 fixture 恰好有可选条目 |
| 6 | `phase2-organization.spec.ts:186` | 拆分＋历史壳＋ADR-0020 迁移与撤销 | 混合（契约主导） | **必须保留** | 「来源成员（N）」把计数与文案绑死；中文 label |
| 7 | `phase2-organization.spec.ts:351` | 受管子类型校验与拒绝 | **产品契约** | **必须保留** | `heading{level:2}` 取原标题；显示名「漫画」被当断言值 |
| 8 | `phase2-organization.spec.ts:417` | Topic/Entity/收藏/收藏夹/批注 | 混合 | 可重写 | **`getByRole("checkbox").last()`**（最易错位）；`aria-label` 正则匹配动态文案 |
| 9 | `phase2-organization.spec.ts:496` | 每个 feed 区块各自取流 | 混合（**偏机制**） | 可重写 | 「区块数=1/2」绑在当前默认看板；region 名 |
| 10 | `phase2-organization.spec.ts:539` | FTS5 特殊字符不报错 | 混合（核心是契约） | **必须保留**（其中 1 条须重写） | `page.locator("article")` 计数——正是已修「幽灵卡片」bug 的现场 |
| 11 | `phase2-organization.spec.ts:583` | 区块排序落点 | 混合 | 可重写 | 「上移区块」按钮名；拖动 `aria-label` |
| 12 | `collection-plan-connectors.spec.ts:12` | manifest 表单建两个 B 站计划 | 混合 | 可重写 | 两跳父级爬区块；toast 文案 |
| 13 | `collection-plan-connectors.spec.ts:93` | 按声明 operation 建搜索计划 | 混合 | 可重写 | 错误/成功文案 |
| 14 | `collection-plan-connectors.spec.ts:128` | 必填枚举留空被拒 | **UI 机制** | 可重写 | 两条中文错误文案 |
| 15 | `theme.spec.ts:41` | 跟随系统浅色 | **外观** | **大概率作废** | 调色板名；`data-cosmos-*` 属性；localStorage key |
| 16 | `theme.spec.ts:55` | 跟随系统深色 | **外观** | **大概率作废** | 同上 |
| 17 | `theme.spec.ts:69` | localStorage 不可用时降级 | **外观** | **大概率作废** | 同上 + 直接桩掉 `window.localStorage` |
| 18 | `theme.spec.ts:91` | matchMedia 不可用时降级 | **外观** | **大概率作废** | 主题按钮名「macOS Night」 |
| 19 | `theme.spec.ts:117` | 显式夜间选择跨刷新保留 | 混合 | 可重写 | localStorage key；直接断 body 背景色 |
| 20 | `theme.spec.ts:164` | 1440px 无横向溢出 | **外观** | **大概率作废** | 只依赖文档级溢出测量，但结论只对当前布局成立 |
| 21 | `source-lifecycle-and-search-filters.spec.ts:39` | 删来源两段确认＋内容保留 | **产品契约** | **必须保留** | 两跳父级爬区块；按钮名靠中文模板拼装 |
| 22 | `source-lifecycle-and-search-filters.spec.ts:78` | 作者/媒体类型/录入状态过滤 | 混合（契约为主） | 可重写 | label 文案与 `article` 卡片结构（API 直查那半最稳） |
| 23 | `media-policy.spec.ts:17` | 改媒体策略＋拒绝超默认值 | 混合 | 可重写 | 中文摘要句式；两跳父级爬区块 |
| 24 | `media-policy.spec.ts:60` | 清理预览不真删 | 混合 | 可重写 | 「预览过期媒体」按钮与「可清理 N 项」文本 |
| 25 | `media-policy.spec.ts:89` | 关图片下载后保持 metadata-only | 混合 | 可重写 | `article` 卡片；「打开 Story」文案 |
| 26 | `collection-plan-multi.spec.ts:13` | 一连接两计划各自的排期与失败 | 混合 | 可重写 | **`span.text-destructive`（Tailwind 类名，重做必断）** |
| 27 | `offline.spec.ts:4` | 断网后本地图片仍渲染 | 混合 | **必须保留**（2/3/4/6/7） | `heading→..→..` 祖先跳转；卡片必须是 `article`；图片断言依赖 lazy 加载时序 |
| 28 | `connection-visibility.spec.ts:10` | 连接面板显示授权范围与失效原因 | 混合 | **必须保留**（1/2/5/6/7） | 行必须是 `li`；`read: true · comment: false` 格式串；「未记录」占位文案 |
| 29 | `connection-visibility.spec.ts:64` | 连接面板登录探测与检查时间 | 混合 | **必须保留**（1/3/4） | `not.toContainText("未检查")` 换空态文案即失去判别力；硬编码 `bilibili` 与 profile 配置 |
| 30 | `webhook-entry.spec.ts:12` | 生成入口并触发 Run | 混合 | **必须保留**（1/2/5/6/7/8/9） | `code` 元素靠数量与顺序取；`#source-schedule-interval` 实现 id；**对布局形状敏感**（曾因侧栏遮挡失败） |
| 31 | `user-data-export.spec.ts:11` | 导出用户数据为 JSON | 混合 | **必须保留**（2–6） | download 事件依赖「用下载交付」这一机制；按钮与「已导出：」文案 |
| 32 | `connector-state-export.spec.ts:11` | 导出并回导连接器状态 | 混合 | **必须保留**（2–5、7） | 「覆盖 0」把数字与文案拼成同一字符串；文件输入与 label 的关联 |
| 33 | `feed-search-race.spec.ts:37` | 搜索提交后陈旧刷新不得覆盖结果 | **产品契约** | **必须保留** | `article` 计数（重做后卡片非 `<article>` 即断）；`waitForTimeout(5_000)` 固定等待裕度 |

**分布（33 条）**：外观 **5**（全在 `theme.spec.ts`）｜UI 机制 **1**｜产品契约（整体）**4**｜混合 **23**。

### 按「重做 UI 时怎么办」汇总（决策口径）

| 判定 | 条数 | 内容 |
| --- | --- | --- |
| **必须保留**（合同须继续被验证，定位可改） | **13** | 拆分＋历史壳＋ADR-0020 迁移与撤销（`:186`）、证据关系双向（`:103`）、受管子类型校验（`:351`）、FTS5 不报错（`:539`）、删来源后内容保留（`source-lifecycle:39`）、断网媒体可读（`offline:4`）、连接授权范围与失效（`connection-visibility:10`）、登录探测（`:64`）、webhook 外部触发契约（`webhook-entry:12`）、用户数据导出格式（`user-data-export:11`）、连接器状态导出格式与幂等（`connector-state-export:11`）、搜索竞态（`feed-search-race:37`）、Story 表示契约（`story-representation:30`） |
| 可重写（行为须留，断言要重写） | **15** | 混合桶里契约断言保留、UI 断言重写 |
| **大概率作废** | **5** | **全部是 `theme.spec.ts` 的主题外观用例** |

**一句话结论：33 条里只有 5 条（15%）是纯外观、会随重做作废；13 条（39%）必须保留；其余 15 条行为必须留、断言要重写。**

## 5. 跨用例共性（决定「怎么重做」而不是「哪条留」）

**规律 1：没有一条「纯外观」之外的用例可以整条作废。** 已看的 26 条里，除 `theme.spec.ts` 的 5 条外观用例外，**每条都至少含产品契约级断言**。所以「重做 UI 就整批丢掉」不成立。

**规律 2：稳定的钩子已经存在，且已经是刻意设计的。** 套件里已经在用 `data-block-id`、`data-block-type`、`data-section-id`、`data-story-*`、`data-entry-relation-*`、`data-asset-status`、`data-media-*`、`data-plan-group`、`data-testid`。**易碎的只是那些改用中文精确文案、两跳父级 `locator("..").locator("..")`、`page.locator("article")` 计数、`checkbox.last()`、Tailwind 类名（`span.text-destructive`）定位的地方。**
→ **重做 UI 时把这套 `data-*` 契约保留下来**，就能把测试从「靠文案找元素」换成「靠钩子找元素」。这是成本最低、收益最大的一条。

**规律 3：数据面断言天然与 UI 解耦，可以直接留下。** 多条用例已经在用 `page.evaluate` 直接打 `/api/v1/...` 校验落库结果（成员数、`revisionId`、`status=split`、关系方向、400 拒绝、搜索结果条数…）。这部分重做后**可原样保留**。
→ 建议重做时把每条拆成 **「API 层契约断言（保留）+ UI 层交互（重写）」**，而不是整条留或整条扔。

**规律 4：一条与产品无关的全局严格断言埋在几乎每条里**：「零 console error / 零失败请求」。重做 UI 时新增可选资源、React 警告或探测性 404 都可能让它误报——**它会让整套变红，但不代表产品坏了**。

**规律 5：三个覆盖缺口**（是测试自身的问题，不是 UI 问题）：

- `phase2-organization.spec.ts:583` 名为「拖到目标正下方」，但**它根本没真的拖**——直接调 `POST /board-blocks/:id/moves` 验证服务端排序。**「拖到 B 下方 ⇒ position=1」这条前端映射没有被端到端覆盖。**
- `phase2-organization.spec.ts:539` 的「搜索后 `article` 数为 0」绑在当前 Feed 的 DOM 实现上，重做后必须换写法。
- `collection-plan-connectors.spec.ts:128` 通篇断表单校验机制，**没有「非法配置最终不落库」的服务端证据**（没 reload 验证）。

## 6. 与 P4-1 的关系

分桶本身**不解释**间歇失败，但它决定了加固该覆盖哪些用例：

- 台账登记的间歇失败点集中在 **`phase2-organization.spec.ts`（`:103`/`:186`/`:417`）**、**`source-lifecycle-and-search-filters.spec.ts:39`**、**`media-policy.spec.ts:17/89`**、**`collection-plan-multi.spec.ts`（`:63`）**、**`ingest.spec.ts`**。这些**几乎全部落在「产品契约 / 混合（契约为主）」桶**——也就是说**要保留的那部分，恰好也是当前最不稳的那部分**。
- 三个候选根因（① 用例之间互相干扰 ② 测试等待方式不牢 ③ 应用真有前端竞态）**不互斥**，且都无法靠只读代码区分；**必须先读 trace**（`trace: retain-on-failure` 已配好，但 `test-results/` 每轮被清，失败后要立刻拷出）。
- 因为 `retries: 2` 只在 CI 生效，**本地 `retries=0` 的失败是更干净的证据**。

**分桶顺带发现的三条与「不稳定」直接相关的事实**：

- `webhook-entry.spec.ts:12` **历史上那次失败已查明不是抖动，而是确定性布局缺陷**（固定宽度侧栏不收缩，画到右侧计划列表上挡住「生成入口」按钮，`known-unstable-cases.md:41`，已修）。这说明**台账里那些「漂移的失败」中，至少有一条其实是真 bug**——「漂移 + 单跑通过」这个特征**不能单独用来断定是测试问题**。
- `feed-search-race.spec.ts:37` 用 `page.route` 注入 3 秒延迟 + **`waitForTimeout(5_000)` 固定等待**把竞态变成必然。这条用例的稳定性**直接取决于这 2 秒裕度**，与产品无关，属于测试自身的时序设计。
- 分桶还标出若干**尚未在台账里登记、但同类易碎**的定位（`getByRole("checkbox").last()`、`page.locator("article")` 计数、`span.text-destructive`、`code` 元素靠数量顺序取）。它们是**潜在的下一批间歇失败点**，台账目前没有覆盖。

## 7. 未做 / 未验证

- **未运行任何测试**，未读任何 trace，**未判定任何间歇失败的根因**。第 6 节三条候选根因不互斥，只读代码无法区分。
- **未查证「产品术语 vs 实现名」的归属**，而这直接决定对应断言是契约还是外观：主题配色名（`neurobook`/`macos-light`/`macos-night`）、时间显示格式、各条中文提示文案、`read: true · comment: false` 的格式串、webhook 地址前缀是否承诺冻结。**需要产品侧确认。**
- **三处明确标为不确定、没有替它们下结论**：
  1. `offline.spec.ts:4` 第 6 条（图片经 `/api/v1/assets/` 取回）按 ADR-0005 归为接口契约；**若重做后改走别的取回路径，这条会误伤**。
  2. `webhook-entry.spec.ts:12` 第 7 条（地址含 `/hooks/collection-plans/`）按接口契约归类，但**未见「前缀不可变」的裁定**，可能只是当前实现。
  3. `feed-search-race.spec.ts:37` 的 `toHaveCount(0)` 与在册的「重复 key 孤儿节点」（`known-unstable-cases.md:43-45`，Task 30 已修）**落在同一个断言位**——单看用例**无法区分**这次失败是竞态回归还是残留节点，需要 trace 才能定性。
- 390px 用例的核实：`e2e/support/viewports.ts` 的 `MOBILE_WIDTH_VERIFIED=false` 使 `verifiedWidths([390,1440])` 只返回 `[1440]`，**390 在收集阶段就被剔除**（不是 `test.skip`，报告里连 skipped 条目都没有）。`known-unstable-cases.md` 第 3 条记作「暂停，未修」是准确的。
- 本文件的输入是**只读代码 + 台账**；分桶口径由 4 个只读子代理分工执行后汇总，**没有交叉复核**（同一条用例只被一个代理看过）。

## 8. 下沉进展（2026-09-24）

核实了第 4 节里「可以下沉」的 12 条契约**在下层是否已有断言**。结论是**大部分早就有了——浏览器套件在重复覆盖**。只补了真正的缺口，**全部是纯新增断言**（`git diff --numstat` 的 removed 全为 0，未修改、未削弱任何既有断言）。

| 契约 | 下层判定 | 本次补的 |
| --- | --- | --- |
| A 拆分＋历史壳＋迁移撤销 | 已覆盖 | —（`story-split` / `story-user-state-migration` 已断到反向迁移复原） |
| B 证据关系双向 | 已覆盖 | —（`entry-story-evidence` 已断双向投影与解除） |
| C 受管子类型校验 | 部分覆盖 | **补**：400 响应体的公开错误码 `validation_failed`（覆盖 `updateStoryRevision` 与 `splitStory` 两条路径） |
| D FTS5 特殊字符 | 已覆盖 | —（`search-query.test.ts` 用的就是同一个字符串 `state-of-the-art`） |
| E 删来源墓碑 | 部分覆盖 | **补**：删除后计划从 `listCollectionPlans()` 投影消失（**反例先行**，并另断计划行仍在且 `enabled=false`，把「消失」钉在墓碑过滤而非硬删） |
| F 本地媒体端点 | 部分覆盖 | **补**：`GET /api/v1/assets/:assetId` 的 content-type 与**字节原样透出** + 未知 id 404（该端点此前零测试） |
| G 连接授权范围 | 部分覆盖 | **补**：`scopeJson` 往返 + 手工恢复时 `lastError: null` 确实写库（此前只有探测路径） |
| H 登录探测 | 已覆盖 | — |
| I webhook 入口 | 已覆盖 | **补**：计划**停用 409 → 启用 202** 的真实进程状态转换（此前只有 mock 单测），并断被拒那次不入队 |
| J 用户数据导出 | 已覆盖 | —（文件名、`schemaVersion`、`counts`、不含 `secretRef` 全有） |
| K 连接器状态导出 | 部分覆盖 | **补**：真实导出件过 schema（`schemaVersion===1`）、不含 `secretRef`、**真正的 export→import 往返**（此前导入用的是手工 fixture） |
| L Story 表示 | 部分覆盖 | **补**：fallback（只有原文）形态**真正落库**（同时断仓储读回与原始落库行）、该形态重复保存 no-op、no-op 时逐条断 `keyFacts` 不变 |

**验证**：全量单测 **132 文件 / 745 用例 exit 0**（原 131/737，+1 文件 +8 用例）；全仓 `typecheck` exit 0；`test:e2e` **6 文件 / 12 用例 exit 0**（原 11，新增的正是 I 那条）；代码与文档门禁 PASS。

**明确不下沉的（必须留在浏览器层）**：

- `offline.spec.ts:4` 的**渲染半边**：断网后浏览器真的把已保存图片渲染出来——API 层看不到（API 那半已由 F 补上）。
- `feed-search-race.spec.ts:37`：竞态在**客户端状态管理**里，API 层看不到；仓库也没有 jsdom 组件测试层（`vitest.config.ts` 是 `environment: "node"`），要么为它新建这一层，要么让它继续留在浏览器层。

**仍未补的下层缺口（本次有意不动，记录备查）**：

- A 的「归并后 canonical Story 成员数 = 2」计数。
- I 的「外部触发」中文标签映射（`run-history.tsx`）——属文案层。
- 各条用例的**渲染/文案半边**（`[data-story-shell]`、迁移面板控件、「作为证据关联到」的拼装、`[data-story-human-protected]` 标记与「自动更新已暂停」等）——这些是 UI 层，属重做 UI 时的重写范围。
- F 的「不依赖外网」没有显式断言（现有证据是「读本地 Blob Root」的隐含本地性）。
