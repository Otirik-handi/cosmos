# G10：`@cosmos/application` 媒体获取单体拆分（P4-2 batch 1 第二个对象）

## User Request / Topic

2026-09-24 维护者裁定 P4-2 的拆分顺序为「先拆非 UI 文件」，batch 1 的第二个对象是 `packages/application/src/media-acquisition.ts`（918 行）；G 编号 G10 由维护者确认。

## Goal

把媒体获取的 918 行单体拆成按关注点聚合的分册，**导出面逐字节零 diff**（157 个导出，对 G05 冻结的 `entry-surface.txt`），并让所有分册落回健康区。

## Scope / Non-goals

Scope：

- 拆为五个分册：`media-policy`（策略解析与上限）、`media-ports`（端口与结果类型）、`media-acquirer`（采集器装配与资产改写）、`media-download`（有界下载管道）、`public-address`（公网地址判定）。
- 删除 `media-acquisition.ts`，把 6 处引用点改指向所属分册。
- 更新 `packages/application/MODULE.md` 的子模块地图。
- 移除代码基线里 `media-acquisition.ts` 那条。

Non-goals：

- **不改任何导出符号、类型形状或运行时行为**（157 个导出零 diff）。
- 不拆 `media-acquisition.test.ts`（580 行，未越红线）与 `media-cleanup.ts`（202 行）。
- 不动其它 8 个「行数越界」文件。

## Current State

- 生命周期阶段：实现与验证完成；**未 commit、未合并**。
- 连贯目标：媒体获取回到可读的分册结构，公共合同逐字节不变。
- 可观察验收（≤3 条）：
  1. 五个新分册全部 ≤400 行，`media-acquisition.ts` 不再存在；
  2. 导出面 157 个逐字节零 diff（对 G05 快照）；
  3. application 与全量测试计数与拆分前一致、`madge --circular` 0 个、全仓 typecheck 0。
- 依赖：无新增依赖；复用 `scripts/entry-export-surface.ts`。
- 受影响合同：**无**——导出面、类型形状与行为都不变；无 Prisma schema、无 migration、无 DTO、无 API。
- 预计核心文件：`packages/application/src/media-*.ts`、`public-address.ts`、`index.ts`（门面的导出来源重排）、4 个调用方、`MODULE.md`、`code-baseline.json`。
- 验证层级：导出面脚本比对 → 聚焦单元（application 包）→ 全仓 typecheck → 全量单元 → 两份体积门禁 → `docs:check`。

## Decisions and Deviations

### 1. 删单体而不是留 shim

`media-acquisition.ts` 被 6 处引用（`workflow-ingest.ts`、`repository-port.ts`、`ingestion-service.ts`、`index.ts`、两个测试）。留一个 `export *` 的 shim 能让 diff 最小，但 `application/MODULE.md` 的禁区明确写着「入口不新增 `export *`」——shim 会把这条纪律破在一个中间文件上。所以按「实现模块直接指向所属聚合模块」改 6 处引用点。

### 2. 结果类型必须放 `media-ports`，否则成环

`MediaOutcome` / `SavedMedia` / `DegradedMedia` 同时被 `media-acquirer`（产出）与 `media-download`（构造降级结果）使用。放任何一边都会形成 `acquirer ↔ download` 环——实测 tsc 报「Cannot find name MediaOutcome」正是这条的暴露。放进 `media-ports` 后两个方向都只依赖端口模块。

### 3. 分册多导出内部符号是安全的

与 G09 不同：`application/index.ts` 用的是**显式具名导出**（不是 `export *`），所以分册把原先非导出的助手补上 `export` 供跨分册使用，不会进公共导出面。零 diff 由脚本比对与 `entry-contract.test.ts` 双重看守。

### 4. 仍用一次性切片脚本按声明边界搬运

与 G09 同法：918 行手抄保不住零 diff。脚本（`.agent/tmp/split-media.ts`，一次性 scratch）从备份的原始文件切片，跨分册与第三方 import 显式声明，靠 typecheck 收敛（两轮修正）。

## Implementation Walkthrough

1. 取基线：导出面 157（G05 冻结）、application 11 文件 / 95 用例、typecheck 0、单体 918 行。
2. 切片写入五个分册；两轮 typecheck 修正（补 `MediaAcquisitionLimits`/`MediaPolicy`/`NormalizedIngestItem` 导入，并把结果类型迁到 `media-ports`）。
3. 删 `media-acquisition.ts`；改 6 处引用点；`index.ts` 的媒体导出块按来源拆成 4 段（导出名集合逐一保留）。
4. 更新 `MODULE.md` 子模块地图与更新日期；重新生成代码基线（15 → 14 条）。

## Verification

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 导出面零 diff | `bun run scripts/entry-export-surface.ts packages/application/src/index.ts --out …` + `Compare-Object` | **157 → 157，逐字节零 diff** |
| 包内单元 | `bunx vitest run packages/application` | **11 文件 / 95 用例全绿**（与拆分前一致） |
| 环依赖 | `bunx madge --circular --extensions ts packages/application/src/index.ts` | **No circular dependency found** |
| 全仓类型 | `bun run typecheck` | **0** |
| 全量单元 | `bun run test` | **128 文件 / 735 用例全绿**（与拆分前一致；真实退出码 0） |
| 代码门禁 | `-c code tests --check … --fail-on-new --warn-lines 800 …` | **PASS**（389 文件 / 基线 **14** 条） |
| 文档门禁 / 链接 | `-c docs --check …` / `bun run docs:check` | **PASS（含 warning）** / **788 文件 0 失败** |
| 空白 | `git diff --check` | 干净 |

**体积结果**：最大分册 `media-download.ts` **385 行**；`media-acquirer.ts` 266、`public-address.ts` 119、`media-ports.ts` 81、`media-policy.ts` 73——五个新文件全部 ≤400 行（提案健康区）。

**偏差（如实记录）**：本 worktree 首次 `bun install` 后**忘了跑 `bun run db:generate`**，导致第一次全仓 typecheck 报出大量 `@prisma/client 没有 PrismaClient`，第一次全量测试也大面积失败；补生成后 typecheck 0、全量 128/735 全绿。**这不是本 Task 的代码问题，是 worktree 环境准备漏了一步**——记录在此，避免下次误判为回归。

**未运行**：Node 进程 E2E、真实来源验收、浏览器验收、Docker。本 Task 只移动实现且导出面零 diff，故未跑运行表面验收。

## Follow-ups

- **G11 = `packages/application/src/workflow-host-runtime.ts`（1205 行，当前最大）**。它与 `workflow-backend.ts`（896）属运行时关键路径，拆分需 focused + 全量 + e2e 门禁。
- 其余：`product-fixtures.tsx`（1192）、`worker-admin/index.ts`（1047）、`collectors/index.ts`（1014）、`board-view.tsx`（972）、`workflow-ingest.test.ts`（871）、`story-panel.tsx`（849）。
- 三个 Web 文件留到 UI 重做同批。
- `media-acquisition.test.ts`（580 行）未拆：它覆盖的是媒体获取这一条能力，跨分册后仍内聚；若将来越过 800 行再按分册对应关系拆。
