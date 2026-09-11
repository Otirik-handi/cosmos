# 治理任务 G02:代码治理首对象——storage-prisma 拆分

## User Request / Topic

`docs/proposals/code-size-governance-v1.md`(accepted)§2 目标 3 与 §4.8:治理 `packages/storage-prisma`(评分最高、重灾区)。行为等价底线与验收标准为用户 2026-09-11 修订六条。

## Goal

`packages/storage-prisma/src/index.ts`(268 KB / 7018 行)落回入口阈值内(门面 ≤100 行),导出签名零 diff,典型任务读取量从约 9 万 token 降至 ≤1.5 万 token。

## Scope / Non-goals

**范围**:`packages/storage-prisma`(index.ts、workflow-host-store.ts 93 KB、三个测试文件)+ 新增 `MODULE.md` + 入口契约测试 + madge 引入。

**非目标**:不动 Prisma schema/migration;不改任何公共导出符号;不治理其他包(application/contracts 等后续 Task);不引入 eslint/prettier/knip(属后续阶段)。

## Current State

提案 accepted(2026-09-11);文档治理门禁已上线;**切片 1~5 全部完成**(2026-09-11):入口契约测试绿、三配置全绿、两个超大测试文件按行为拆分、workflow-host-store.ts 与 index.ts 均拆为继承链分册(门面 12 行)、MODULE.md + repo-map 就绪、典型任务读取量 9 万 → 约 1.1 万 token(细节见 `walkthrough.md`);待维护者验收后 push/合并。发现并处置的偏差:master 上存在 Task 23 遗留测试债与 Windows 本地并行争用,已对齐修复并记录。

## Decisions and Deviations

- 拆分顺序(固定):本对象无桶文件步骤(跳过)→ 测试按行为拆 → index.ts 按聚合拆。
- 按仓库 Git 规则:实施在 `.worktree/g02-storage-prisma` + 分支 `refactor/g02-storage-prisma` 进行(治理任务编号体系见 [`../README.md`](../README.md)),创建前再向维护者确认一次。
- madge 因属于验证闭环,随本 Task 前置安装(devDependency)。

## Implementation Walkthrough

| # | 切片 | 验收(≤3 条/片) | 状态 |
|---|---|---|---|
| 1 | 前置:worktree + 依赖 + 基线(代码类 --write-baseline)+ 入口契约测试(断言 index.ts 导出符号集合)+ 基线记录(大小/行数/导出清单/三配置测试/构建字节数) | 契约测试绿;vitest 三配置全绿;基线入库 | done(2026-09-11,含 1b 测试债对齐) |
| 2 | 测试按行为拆:`index.test.ts`(51 KB)、`workflow-host-store.test.ts`(55 KB)按 describe 拆到对应目录 | 单文件 ≤30 KB;覆盖率不降;三配置全绿 | done(2026-09-11,覆盖率待阶段③复核) |
| 3 | 单体按聚合拆:workflow-host-store.ts → `workflow-host-store/` 按聚合分册(门面 re-export) | 导出零 diff;门禁过;循环依赖零新增 | done(2026-09-11) |
| 4 | 单体按聚合拆:index.ts → storage-roots / workflow-host-store/ / value-store / blob-store / event-sink / state-store 等分册,门面 ≤100 行 | 门面 ≤100 行;导出零 diff;三配置全绿 | done(2026-09-11,门面 12 行;分册按继承链聚合,未见 value-store/blob-store 等独立端口类需求) |
| 5 | 收口:`MODULE.md`(≤3 KB)+ repo-map 生成 + 指标回写(读取量 9 万 → ≤1.5 万)+ 基线缩减 | 验收三件套全过;walkthrough 回写 | done(2026-09-11,指标回写随切片 4 收口补终值) |

## Verification

每切片:tsc → vitest(unit/property/e2e)→ build:packages → 导出签名 diff(契约测试 + 脚本)→ `bunx madge --circular packages/storage-prisma`。回滚:每切片独立 commit,可单独 revert。

## Follow-ups

application/contracts/transport-http 桶文件治理(评分表后续对象);eslint 门禁(阶段②);repo-map CI 校验接入。
