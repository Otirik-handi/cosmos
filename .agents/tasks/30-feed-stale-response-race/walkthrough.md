# Task 30 walkthrough：Feed 搜索结果被陈旧响应覆盖

基线：`origin/master` = `47689d2`。分支：`fix/t30-feed-stale-response-race`，worktree `.worktree/t30-feed-stale-response-race`（已装依赖、生成 Prisma Client、构建产物齐全）。

## 本轮切片与假设

- 切片 1：用**人为延迟**把偶发竞态变成必然复现（RED）。
- 切片 2：修实现（GREEN），既有断言保持不变。
- 切片 3：更新登记表与状态文档。
- 假设：`e2e/browser/phase2-organization.spec.ts:539` 的失败不是测试抖动，而是首页 Feed 的**陈旧响应竞态**——`use-feed-workspace` 的 `refresh()` 按发起时的搜索条件取数、返回后无条件 `setFeed`；页面挂载时发起的那次 refresh 携带 `activeSearch = null`，若它在搜索之后才返回，就把搜索置空的列表重新写成"最新内容"，而搜索条件与提示语仍停留在搜索态。

## 切片 1：证明竞态（RED）

新增 `e2e/browser/feed-search-race.spec.ts`：自建来源并触发真实录入（保证列表非空）→ 用 `page.route` 把 `**/api/v1/feed**` 的响应**延后 3 秒** → 重新加载页面并在延迟窗口内提交一次不会命中的搜索 → 越过窗口后断言阅读流里没有卡片。

```text
bunx playwright test --config playwright.config.ts e2e/browser/feed-search-race.spec.ts --reporter=line
```

| 结果 | 证据 |
| --- | --- |
| **失败（RED）** | `expect(locator).toHaveCount(expected) failed / Expected: 0 / Received: 3` —— 提示语已是「搜索到 0 条结果。」，阅读流里却回来了 3 张卡片。**一次性稳定复现**，不用整套跑、也不靠运气 |

这同时解释了 CI/本地此前的观察（提示语 0 条、列表仍有 1 张、10 秒内 23 次都读到 1）以及"单跑通过、整套才失败"：整套时每个场景都在触发真实录入，SSE 事件频繁，撞上搜索窗口的概率高。

> **更正（同日，见下文「更正」节）**：竞态确实存在且被这条用例稳定复现，但它**不是** `:539` 的成因——`:539` 现场的残留卡片是重复 React key 造成的孤儿节点。上面这句归因是错的，保留原文以便对照。

## 切片 2：修实现（GREEN）

`apps/web/src/app/home/use-feed-workspace.ts`：

- 新增 `feedWriteToken` + `beginFeedWrite()` / `isFeedWriteCurrent(token)`：**只有最后发起的那次写者可以写 Feed 状态**；
- `refresh`、`clearSearch`、`applySavedView`、`loadMore` 四处异步写入都先取令牌、返回后校验，陈旧响应直接丢弃（错误与 loading 标记同样只在当前令牌下写）；
- 返回对象暴露两个函数，供 `page.tsx` 的 `onSearch` 使用（搜索是"更新的写者"，必须让更早发起的刷新作废）。

`apps/web/src/app/page.tsx`：`onSearch` 在 `client.search` 之前取令牌，返回后校验再写 `activeSearch` / `feed` / `nextCursor` / 提示语。

| 验证 | 结果 |
| --- | --- |
| `bun run --cwd apps/web tsc --noEmit` | exit 0 |
| 定向用例（同一条命令） | **1 passed (16.6s)** —— 陈旧响应被丢弃，搜索态保住 |
| 既有 `phase2-organization.spec.ts:539` 断言 | **未改动**（不放宽、不加重试掩盖） |

### 一个明确的取舍（记录在案）

`loadMore` 也参与同一套令牌：如果用户在"加载更多"飞行途中发生刷新/搜索，那次分页追加会被丢弃（列表已是新内容，用户可再次点击）。改动前它会把旧游标的一页**追加到新列表**上（可能出现重复/混排），所以这里选择"丢弃陈旧追加"，代价是极端情况下一次点击看起来没生效。

## 切片 3：记录更新

- `docs/testing/known-unstable-cases.md` 第 1 条：` :539` 从本条移出并注明已归因修复；本条收窄为仍未归因的 `:103` / `:417`。
- `PROJECT-STATUS.md`：「已知不稳定的测试用例」与「验证边界」两处按新结论更新。

## 完整门禁（2026-09-17，两个修复都在内）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 定向（重复 key） | `bunx playwright test e2e/browser/phase2-entry-relation.spec.ts` | 修 key 前 **1 failed**（Expected 0 / Received 1）→ 修后 **1 passed (14.9s)** |
| 定向（陈旧响应竞态） | `bunx playwright test e2e/browser/feed-search-race.spec.ts` | 临时还原守卫 **1 failed**（Expected 0 / Received 3）→ 有守卫 **1 passed** |
| 整套浏览器 | `bun run test:browser`（含 `bun run build`） | **22 passed (55.9s)**；另两轮中 `:539` 均通过（一轮 22/22 用时 56.6 秒，一轮整轮 2.9 分钟、失败在 `media-policy.spec.ts:60`，已登记为第 4 条） |
| 组件实验室 | `bun run test:browser:component-lab` | **14 passed (12.1s)** |
| 类型 | `bun run typecheck` | exit 0 |
| 单测 | `bun run test` | **99 文件 / 599 用例全绿** |
| lint | `bun run lint:web` | exit 0，**81 warning / 0 error**（与改动前同数） |
| 文档门禁 | `bun run docs:check` | `failures: []` |
| 文档大小 | `python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` | PASS（含 6 条基线内文件增长的 warning，都不是本次改动的文件） |
| 空白/冲突 | `git diff --check` | 干净 |

未运行：property、Node 进程 E2E、Docker/Compose、真实来源联网验收、合并后的 master CI（需要授权后才能推分支并触发）。

## 更正：`:539` 的真实根因是重复 React key（2026-09-17，同日追加）

切片 1 的假设（陈旧响应覆盖）能用人为延迟稳定复现，于是被当成了 `:539` 的成因。复测显示**修掉竞态后整套里 `:539` 仍会失败**，因此把它当结论是错的。下面是把"观察"变成"机制"的过程。

### 证据一：失败现场的状态是自洽的，残留卡片不在 React 的状态里

在 `:539` 的断言前临时加 DOM 探针（提交前已删除）并跑整套，得到：

- 提示语 `role=status`＝「搜索到 0 条结果。」
- 临时探针在结果容器上标出 React 当时的 `feed` 长度＝**0**，容器是**空状态分支**（`data-branch="empty"`）
- 页头没有「N 篇内容」（该 span 只在 `feed.length > 0` 时渲染）→ React 的 `feed` 确实是空
- 残留的 `<article>`（来源 `重复关系验收来源-…`、标题 "Fixture media metadata"）的父节点正是那个空状态 `div`，并且它是该 `div` 的第一个子节点
- `consoleErrors` 为空（生产构建不打印重复 key 警告，见下）

结论：搜索状态与提示语始终一致，"应用搜索状态不一致"这个怀疑可以排除；有问题的是 DOM 里多出一个 React 不再接管的节点。

### 证据二：MutationObserver 记录到 React 插入了 20 张、只移除了 19 张

在页面脚本之前注入 MutationObserver（观察 `document`），记录到的时间线（毫秒为页面内相对时间）：

| t | 事件 |
| --- | --- |
| 173 | 首次刷新写入列表：`div[items]` 上连续插入 **20 个 `article`**，页头出现「20 篇内容」 |
| 295 | 提交搜索：同一个 `div` 被复用并切成空状态分支，React **移除 19 个 `article`**、插入空状态的两个 `<p>`；卡片计数 20 → **1** |

其中 `重复关系验收来源` 的卡片插入了 2 张、只被移除 1 张——与"重复 key"的算术完全吻合。旁证：`phase2-entry-relation.spec.ts` 自己的注释写明「归并后同一 Story 在 Feed 里有两个成员卡片」，即**同一 `storyId` 会在一份列表里出现多次**，而 `feed-browser.tsx` 当时用 `key={item.storyId}`。

合同依据：ADR-0022 决定 4/6（同一 Story 内两条重复条目合法且常见；v1 只标记与展示，不折叠、不参与 Feed 去重）＋ `packages/contracts/src/search.ts` 里 `feedItemSchema` 同时提供 `storyId`（可重复）与 `entryId`（条目身份，`story-panel/evidence.tsx` 已是同样用法）。

### 切片 3：确定性 RED

把"归并出同一 Story 的两张成员卡片 → 把列表整体替换成一次无结果搜索"写进 `e2e/browser/phase2-entry-relation.spec.ts`（在该 spec 已有的归并场景之后，追加断言，不改既有断言）：

```text
bunx playwright test e2e/browser/phase2-entry-relation.spec.ts
```

| 结果 | 证据 |
| --- | --- |
| **失败（RED）** | `expect(locator).toHaveCount(expected) failed / Expected: 0 / Received: 1`（第 182 行），**单跑必现**、无需整套 |

这正是登记表里那条"10 秒内 23 次都读到 1"的症状，第一次变成可复现的确定性失败。

### 切片 4：修 key（GREEN）

- `apps/web/src/components/cosmos/feed-browser.tsx`：`key={item.storyId}` → `key={item.entryId}`（附一行原因注释）。
- `apps/web/src/components/cosmos/board-view.tsx`：看板阅读流区块的 `<li>` 同样按 `storyId` 做 key，同批改为 `entryId`。
- 既有断言一字未改。

| 验证 | 结果 |
| --- | --- |
| 同一条定向用例 | **1 passed (14.9s)** |
| 整套浏览器第 1 / 2 轮 | `:539` 均通过（整轮分别 2.9 分钟 / 56.6 秒） |

### 切片 5：收窄守卫范围（对切片 2 实现的修正）

第一版守卫在校验失败时会把整批写入一起丢掉，包括**与搜索条件无关**的来源/分类/集合/已保存视图列表——那超出修复范围，相对 master 是语义变化（例如"新建来源"后的列表刷新若恰与一次搜索交错，就会少一次更新）。现改为：全局列表任何一次刷新都写，只有 `feed` 与 `nextCursor` 受版本号约束。

### 切片 6：记录更新

- `docs/testing/known-unstable-cases.md` 第 1 条：`:539` 的状态段落按新根因改写；第 32 行那条"未查清"的观察后追加结论段（保留原文对照）。
- `PROJECT-STATUS.md`：「尚未实现」里的已知不稳定条目与「当前验证」里的浏览器整套条目同步更正。
- 本 Task README 改为以两个缺陷为主线的当前摘要（授权原文保留）。

## 远端 CI（2026-09-18，分支 `fix/t30-feed-stale-response-race`）

维护者批准后 `git push -u origin fix/t30-feed-stale-response-race`（基线 `47689d2`，推送 `8096c4d`）。fork 的 CI 只在 `master` 收到 push 时自动跑，所以手动触发：

```text
gh -R Otirik-handi/cosmos workflow run CI --ref fix/t30-feed-stale-response-race
```

run [`35312050392`](https://github.com/Otirik-handi/cosmos/actions/runs/35312050392)，head `8096c4d`，五个 job 全部 success：Docs、Quality、Browser E2E、Windows Node smoke、Node process E2E。

| 远端证据 | 数值 |
| --- | --- |
| Browser E2E 的 `bun run test:browser` | **22 passed (1.3m)** |
| Browser E2E 的 `bun run test:browser:component-lab` | **14 passed (26.6s)** |

这是 `:539` 在远端第一次整套通过——此前 master run `35193865031` 正是失败在该用例。
