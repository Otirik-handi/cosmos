# Task 30：Feed 列表残留旧卡片（重复 React key）与搜索结果被陈旧响应覆盖

> 目录名与分支名（`30-feed-stale-response-race`、`fix/t30-feed-stale-response-race`）在授权时按"竞态"命名；排查后确认 `:539` 的真实根因是**重复 React key**，竞态是同期发现的另一个真实缺陷。分支名保持不动（重命名会影响已授权范围），以本文件为准。

## User Request / Topic

2026-09-17 维护者授权按「先证明、再修、后复测」处理 `e2e/browser/phase2-organization.spec.ts` 里最频繁的那个失败点（`:539` 搜索用例）。编号 30、worktree 与分支 `fix/t30-feed-stale-response-race`。

**记录例外（必须留痕）**：按[准入决策表](../../../docs/standards/repository-workflow.md#准入决策表)，可判定的局部 Bug 需要公开 Issue；但修复期间 fork `Otirik-handi/cosmos` 的 Issues 处于关闭状态（`gh issue create` 返回 `the repository has disabled issues`）。因此按准入表原文的例外——「非公开的维护者或用户明确请求可以替代公开 Issue 的记录与实现授权；需要 Task 时必须记录该请求」——本轮以本 Task 承载记录，维护者的授权即上文那条指示。**2026-09-18 补开公开 Issue**：维护者开放 Issues 后已补记 [#4](https://github.com/Otirik-handi/cosmos/issues/4)（标签 `source: agent` / `type: bug` / `status: needs-triage` / `area: board-workspace` / `area: library-search`），正文含根因、修复与验证；例外记录到此闭合。

## Goal

首页 Feed 与搜索结果不再出现"提示语说 0 条、列表却还有内容"：

1. **重复 React key（`:539` 的真实根因）**：同一 Story 可以有多张成员卡片同时出现在 Feed 里（ADR-0022 决定 4/6），列表 key 必须用条目身份；否则其中一张卡的 DOM 节点脱离 React 管理，列表被整体替换后残留成"幽灵卡片"。
2. **陈旧响应覆盖（同期发现的真实竞态）**：搜索提交后，早于搜索发起、晚于搜索返回的刷新不得再把搜索结果改写成最新内容。

## Scope / Non-goals

Scope：

- 两条**能稳定复现**的浏览器回归：`e2e/browser/phase2-entry-relation.spec.ts`（归并出"同一 Story 两张成员卡片"后替换列表，断言无残留）与 `e2e/browser/feed-search-race.spec.ts`（人为延迟 `/api/v1/feed`，提交无结果搜索）。
- 修 `apps/web/src/components/cosmos/feed-browser.tsx` 与 `board-view.tsx` 的列表 key（`storyId` → `entryId`）。
- 修 `apps/web/src/app/home/use-feed-workspace.ts`（以及 `page.tsx` 必要的接线）：给会写 **Feed 状态**的请求加版本号，陈旧响应丢弃；与搜索条件无关的来源/分类/集合/已保存视图列表任何一次刷新都可以写。
- 既有断言**保持不变**（不放宽、不加重试掩盖）：`phase2-organization.spec.ts:539` 一字未改。
- 记录更新：`docs/testing/known-unstable-cases.md` 第 1 条、`PROJECT-STATUS.md` 两处。

Non-goals：

- 不处理 `:103`（证据关系反向视图等待超时）、`:417`（用户组织场景耗时异常）与整套慢跑时的 `media-policy` 等待超时——它们需要分别诊断归因。
- 不放宽任何既有断言、不以"重跑即过"结案。
- 不做 SQLite WAL / `busy_timeout` 的显式配置（登记表建议里的另一条，属持久化行为变更，另行评估）。

## 权威合同

- 维护者 2026-09-17 授权（本 Task 的 User Request 段）。
- [`docs/standards/repository-workflow.md`](../../../docs/standards/repository-workflow.md)：准入表与其非公开请求例外。
- [`docs/adr/0022-entry-duplicate-relations-v1.md`](../../../docs/adr/0022-entry-duplicate-relations-v1.md) 决定 4/6：同一 Story 内两条重复条目合法且常见，v1 只标记与展示、不折叠、不参与 Feed 去重——这正是"同一 `storyId` 在一份列表里出现多次"的合同来源。
- `packages/contracts/src/search.ts`：`feedItemSchema` 同时有 `storyId`（可重复）与 `entryId`（条目身份）。
- [`docs/testing/known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 第 1 条与登记规则（不以重跑结案、不把断言改宽松当修复）。

## 实施切片

| # | 切片 | 可观察验收 | 状态 |
| --- | --- | --- | --- |
| 1 | 证明竞态（RED） | 延迟 `/api/v1/feed` + 提交无结果搜索 → 列表残留 3 张卡（无守卫时必挂） | 完成 |
| 2 | 修实现（GREEN） | 同用例 1 passed；`phase2-organization.spec.ts:539` 断言未改 | 完成 |
| 3 | 查明 `:539` 真根因（RED） | MutationObserver 记录：20 张卡插入、搜索时只移除 19 张；归并场景里"替换列表"必然残留 1 张 | 完成 |
| 4 | 修 key（GREEN） | 同一 spec 由必挂转为 1 passed (14.9s)；`board-view` 区块列表同批修正 | 完成 |
| 5 | 收窄守卫范围 | 刷新里的全局列表（来源/分类/集合/视图）不再被搜索结果作废 | 完成 |
| 6 | 记录更新 | `known-unstable-cases` 第 1 条更正归因、`PROJECT-STATUS` 两处更新 | 完成 |
| 7 | 完整门禁 | 定向用例 → 整套浏览器 + 组件实验室 → 单测/类型/lint/build → 文档门禁 → 合并后 master CI | 进行中 |

## Current State

- 生命周期阶段：**已完结（2026-09-18，维护者确认内容完成后收尾）**。两个缺陷都已修好、各有一条确定性红→绿证据；`--no-ff` 合并为 master `699ff5a` 并推送，master CI run `35313175640` 五个 job 全绿（Browser E2E `22 passed`、组件实验室 `14 passed`）；worktree 与任务分支（本地 + 远端）已清理，公开记录补为 [#4](https://github.com/Otirik-handi/cosmos/issues/4)。
- 关键结论（判据见 walkthrough）：`:539` 的失败**不是**状态竞态——失败现场 `feed.length === 0`、页头无"N 篇内容"、React 渲染的是空状态分支，残留的 `<article>` 是重复 key 造成的孤儿 DOM 节点。
- 依赖：无（与 Task 26/29 无文件交叠；`use-feed-workspace.ts`、`page.tsx`、两个列表组件由本 Task 独占写入）。
- 验证层级：两条定向回归（RED→GREEN）→ 整套浏览器 + 组件实验室 → 全量单测 / lint / typecheck / build → 文档门禁 → 合并后 master CI。

## Decisions and Deviations

- 先写测试再改实现：两条缺陷都能被确定性复现，无需依赖"重跑即过"。
- 用 Playwright `page.route` 人为延迟响应制造竞态窗口，而不是往产品代码里加测试开关。
- 守卫只作用于 Feed 与游标：与搜索条件无关的列表（来源/分类/集合/视图）继续由任何一次刷新写入——这是对第一版实现的收窄，避免把超出修复范围的语义一起改掉。
- key 用 `entryId`（条目身份）而不是 `${storyId}-${sourceId}` 之类的组合：合同里已有条目身份字段，`story-panel/evidence.tsx` 已是同样写法。

## Verification / Gate

过程、命令、实际结果与未运行项的唯一记录见 [`walkthrough.md`](walkthrough.md)。

## Follow-ups

- `:103`、`:417` 与整套慢跑时的 `media-policy` 等待超时仍未归因（后者已按登记规则补记）。
- 公开记录已补：[#4](https://github.com/Otirik-handi/cosmos/issues/4)（Open，待维护者确认后关闭）。
- 追记（与本 Task 的改动无关，按维护者 2026-09-18 指示不再深挖）：最后一个记录提交 `bd58f76`（只改 README）的 CI 首轮在 `apps/worker/src/workflow-ingest.test.ts` 撞到该用例自带的 15 秒预算（`Test timed out in 15000ms`，同代码本地与上一轮 master CI 均通过），整轮复跑后 Quality 通过。该观察**没有**登记进 `docs/testing/known-unstable-cases.md`（没有覆盖它的 Task）；若在 CI 再次复现，应登记并把预算与 `vitest.config.ts` 的 `testTimeout: 60_000` 对齐。
- `docs/testing/known-unstable-cases.md` 第 1 条里"失败点漂移、单跑不复现"的其余部分需要在 `:539` 修掉后重新观察，才能判断是否还有独立机制。
