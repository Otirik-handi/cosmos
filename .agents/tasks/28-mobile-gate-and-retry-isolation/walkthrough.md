# Task 28 walkthrough：移动端门禁后置 + 浏览器重试幂等

基线：`origin/master` = `d50f4bc`。分支：`test/t28-mobile-gate-and-retry-isolation`，worktree `.worktree/t28-mobile-gate-and-retry-isolation`。

## 本轮切片与假设

- 切片 1（B）：修 `e2e/browser/ingest.spec.ts` 的重试不幂等。
- 切片 2（A）：暂停 390px 页面级横向溢出检查（产品决定：移动端适配后置）。
- 假设（仍有后果）：CI 那次 `ingest.spec.ts` 的 strict mode violation（「每 30 分钟自动抓取」匹配到 2 个元素）来自**重试时上一次尝试留下的同名来源**，而不是页面本身渲染了两份。依据：该 spec 用固定来源名「浏览器 RSS 来源」并使用未限定作用域的 `healthSection.getByText(...)`，而同目录 4 个 spec 都改成唯一命名 + 按来源限定卡片；且该文件第 17-18 行已注明「同一栈会话内数据库跨重试持久化」。
- 复现手段（本地，确定性）：`--repeat-each=2` 让同一条用例在**同一应用与数据根**里连跑两遍，与 CI 重试等价。本机已装 Playwright chromium，且 api/worker/web 产物可构建。

## 环境准备（worktree 内）

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 844 包，25.59s |
| `bun run db:generate` | 成功——顺带验证 Task 27 的解析器：本 worktree 的布局里 `packages/storage-prisma/node_modules/prisma` 不存在 |
| `bun run build` | 首次失败：`Module '"@prisma/client"' has no exported member 'Prisma'`（未生成 Client，CI 里 `db:generate` 在 build 之前）；生成 Client 后通过 |

## 切片 1（B）：重试幂等 —— RED → GREEN

### RED（改前，本机确定性复现）

```text
bunx playwright test --config playwright.config.ts e2e/browser/ingest.spec.ts --repeat-each=2 --reporter=line
```

（`CI` 未设置以关掉 Playwright 自带 retry；`--repeat-each=2` 让同一条用例在**同一应用与数据根**里连跑两遍，与 CI 重试等价。）

结果 `1 failed / 1 passed`，失败在 `ingest.spec.ts:49`：

```text
Error: strict mode violation: getByRole('heading', { name: '来源健康' }).locator('..').locator('..').getByText('每 30 分钟自动抓取') resolved to 2 elements
```

与 CI（run 35179029322 的 Browser E2E job）日志里的失败点完全一致 → 假设成立：第二遍看到第一遍遗留的同名来源。

### 改动（`e2e/browser/ingest.spec.ts`）

| 位置 | 改动 |
| --- | --- |
| 来源名 | 固定「浏览器 RSS 来源」→ `浏览器 RSS 来源-${randomUUID().slice(0, 8)}`，与 `media-policy` / `offline` / `phase2-organization` 的既有约定一致 |
| 健康卡片 | 新增 `healthRow = healthSection.locator("li").filter({ hasText: sourceName })`，把「已停用，定时抓取暂停」「每 30 分钟自动抓取」与启用 / 运行按钮限定到本来源 |
| Feed 断言 | 新增 `sourceCards = page.locator("article").filter({ hasText: sourceName })`，五处页面级文本（`Cosmos scaffold is ready`、`Message without a web URL`、`2026年8月7日`、`含 N 个附件`、`The second fixture item…`）改为按来源限定 + `.first()` |
| 打开 Story | 两处 `page.getByRole("button", { name: "打开 Story" }).first()` → `sourceCards…first()` |

### GREEN 迭代

| 轮次 | 结果 |
| --- | --- |
| 1 | 修好健康卡片后重跑：第 2 遍推进到 `:125` 才失败——`getByText('Cosmos scaffold is ready')` 匹配 3 个元素（上一次尝试的同源条目仍在 Feed） |
| 2 | 再限定 Feed 断言与 Spotlight 的「打开 Story」后：**`2 passed (23.0s)`** |

### 完整套件（改后，按 CI 原命令）

`bun run test:browser` exit 0；`bun run test:browser:component-lab` exit 0。

## 切片 2（A）：暂停 390px

新增 `e2e/support/viewports.ts`（`MOBILE_WIDTH_VERIFIED = false`、`DEFERRED_MOBILE_WIDTH = 390`、`verifiedWidths()`；注释写明暂停理由与恢复条件）。

`--list` 证据（390 不再出现在执行集合里，PC/平板宽度保留）：

- 浏览器：`theme.spec.ts:165 › keeps the home page free of horizontal overflow at **1440px**`（390px 那条已消失）；
- 组件实验室：`… at **768px** / **1024px** / **1440px**`（390px 消失）；
- `ingest.spec.ts` 的 390 段由 `if (MOBILE_WIDTH_VERIFIED)` 关闭，代码、理由与恢复条件保留。

文档同步：`docs/testing/README.md`（标准口径）、`PROJECT-STATUS.md`（当前运维边界）、`docs/testing/known-unstable-cases.md`（第 2/3 条改标「暂停（产品决定），未修」）、`docs/proposals/ui-surface-ownership-v1.md`（决策记录 2026-09-17 一行）。

## 门禁

| 命令 | 结果 |
| --- | --- |
| `bun run docs:check` | 662 文件 0 失败 |
| `python scripts/size-governance.py -c docs --check …` | PASS（含既有 warning）；`docs/testing/README.md` 回到健康区 |
| `git diff --check` | 干净 |

## 未运行 / 限制

- 未跑 `bun run test` 与 `bun run typecheck`：本切片不改产品代码；`e2e/**` 本来就不在任何 tsconfig 覆盖内（新模块只由运行时验证）。
- 浏览器套件只做了「一次全绿 + repeat-each 两遍」采样，未做多次重复采样。
- `docs/testing/README.md` 正好 **9,000 / 9,000 token**（登记 28,294 B）：它在基线内，越线只报 warning 不阻塞 CI，但已无余量，任何后续追加都会让它长期停在警戒线（与 PROJECT-STATUS 同一类问题）。

## 偏差

- B 的修复范围比「改第 49 行」大：还要处理 4 处页面级断言在重复执行下的二义性（健康卡片、Feed 文本、打开 Story），否则第 2 遍只是换一个地方失败。
- 对重复文本采用「限定到本来源 + `.first()`」，而不是改写产品 UI 或新增来源删除接口（来源本就没有 DELETE）。
