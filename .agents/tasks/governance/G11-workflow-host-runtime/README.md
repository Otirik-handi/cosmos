# G11：`@cosmos/application` Workflow Host 运行时拆分（P4-2 第三个对象，当前最大）

## User Request / Topic

2026-09-24 维护者确认 G11 为 `packages/application/src/workflow-host-runtime.ts`（1205 行，当前最大）；拆分方案先经维护者确认再动手。

## Goal

把 Workflow Host 的运行时常驻部件从 1205 行单体拆成按职责聚合的六个分册，**导出面逐字节零 diff**（157 个导出，对 G05 冻结的 `entry-surface.txt`）。

## Scope / Non-goals

Scope：

- 拆为六个分册：`workflow-host-runtime-types`（端口类型与依赖 + `FixedRunIdGenerator`）、`workflow-runtime-support`（lease/runner 支撑）、`workflow-run-lane`、`workflow-activity-worker`、`workflow-completion-dispatcher`、`workflow-action-support`。
- 删除 `workflow-host-runtime.ts`；`index.ts` 的 13 个导出按来源拆成 4 段；测试的 3 个值导入改指向 3 个类模块。
- 更新 `packages/application/MODULE.md`；移除代码基线里该文件的条目。

Non-goals：

- **不改任何导出符号、类型形状或运行时行为**（157 个导出零 diff）。
- 不拆 `workflow-host-runtime.test.ts`（779 行，未越红线）与 `workflow-host.ts`（459 行）。
- 三个 lane 类各自内聚，不再细分（最大 `WorkflowActivityWorker` 345 行）。

## Current State

- 生命周期阶段：实现与验证完成；**未 commit、未合并**。
- 连贯目标：运行时关键路径回到可读分册结构，公共合同逐字节不变。
- 可观察验收（≤3 条）：
  1. 六个新分册全部 ≤400 行，`workflow-host-runtime.ts` 不再存在；
  2. 导出面 157 个逐字节零 diff；
  3. 全量单元与 Node 进程 E2E 与拆分前一致、`madge --circular` 0 个、全仓 typecheck 0。
- 依赖：无新增依赖；复用 `scripts/entry-export-surface.ts`。
- 受影响合同：**无**——导出面、类型形状与行为都不变；无 Prisma schema、无 migration、无 DTO、无 API。
- 预计核心文件：`packages/application/src/workflow-*.ts`、`index.ts`、`workflow-host-runtime.test.ts`、`MODULE.md`、`code-baseline.json`。
- 验证层级：导出面脚本比对 → 聚焦单元（application 包）→ 全仓 typecheck → 全量单元 → **Node 进程 E2E（运行时关键路径，G 台账要求）** → 两份体积门禁 → `docs:check`。

## Decisions and Deviations

### 1. 六分册切法（维护者 2026-09-24 确认）

| 分册 | 内容 |
| --- | --- |
| `workflow-host-runtime-types.ts` | 端口类型/依赖 + `FixedRunIdGenerator` |
| `workflow-runtime-support.ts` | lease 时长、runner 装配、租约感知包装 |
| `workflow-run-lane.ts` | `WorkflowRunLane` |
| `workflow-activity-worker.ts` | `WorkflowActivityWorker` |
| `workflow-completion-dispatcher.ts` | `WorkflowCompletionDispatcher` |
| `workflow-action-support.ts` | action 错误/取消/重试判定 + 心跳 + 租约竞速 |

### 2. 助手分册的符号要补 `export`，但公共面不受影响

与 G10 同理：`index.ts` 是**显式具名导出**，所以 `workflow-runtime-support` 与 `workflow-action-support` 把原先非导出的助手补上 `export` 供跨分册使用，不会进公共导出面。零 diff 由脚本比对与 `entry-contract.test.ts` 双重看守。

### 3. 两轮 typecheck 收敛，其中一轮是根因

第一轮 20 个错误里，`workflow-runtime-support.ts` 缺三个类型导入（`WorkflowLeaseRuntimeOptions` / `WorkflowRuntimeDependencies` / `WorkflowRunnerLike`）。补上后**一次性归零**——另外 3 个错误（run-lane 的 `WorkflowRunnerLike | undefined`、dispatcher 的 `unknown`）都是它的连带效应，不是独立缺陷。记下来避免下次逐个去查连带错误。

### 4. `CompleteActivityResult` 是宿主类型，不是 kernel 的

它来自 `./workflow-host.js`。放进 kernel 导入清单会同时报「重复标识符」与「kernel 没有该导出」——两处一起报是它的特征。

## Implementation Walkthrough

1. 取基线：导出面 157（G05 冻结）、application 11 文件 / 95 用例、typecheck 0、单体 1205 行 / 44831 B / 11208 tok。
2. 切片脚本（`.agent/tmp/split-host-runtime.ts`，一次性 scratch）按声明边界写入六个分册；两轮 typecheck 收敛导入。
3. 删 `workflow-host-runtime.ts`；`index.ts` 的 13 个导出重排为 4 段；测试 3 个值导入改指向三个类模块。
4. 更新 `MODULE.md` 子模块地图；重新生成代码基线（14 → 13 条）。

## Verification

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 导出面零 diff | `bun run scripts/entry-export-surface.ts packages/application/src/index.ts --out …` + `Compare-Object` | **157 → 157，逐字节零 diff** |
| 包内单元 | `bunx vitest run packages/application` | **11 文件 / 95 用例全绿**（与拆分前一致） |
| 环依赖 | `bunx madge --circular --extensions ts packages/application/src/index.ts` | **No circular dependency found** |
| 全仓类型 | `bun run typecheck` | **0** |
| 全量单元 | `bun run test` | **128 文件 / 735 用例全绿，真实退出码 0**（与拆分前一致） |
| 运行表面 | `BUN_BINARY=<真实 bun.exe> bun run test:e2e` | **6 文件 / 11 用例全绿，真实退出码 0** |
| 代码门禁 | `-c code tests --check … --fail-on-new --warn-lines 800 …` | **PASS**（基线 **13** 条） |
| 文档门禁 / 链接 | `-c docs --check …` / `bun run docs:check` | **PASS（含 warning）** / **795 文件 0 失败** |

**E2E 的环境前置（踩过一次）**：不带 `BUN_BINARY` 直接跑 `bun run test:e2e` 会 **6 个文件全失败、11 用例 skipped**，日志里的根因是 `spawnSync bun ENOENT`——e2e harness 要 spawn `bun`，而本机 PATH 上找不到。带上 `BUN_BINARY=C:\Program Files\nodejs\node_modules\bun\bin\bun.exe` 后 6/11 全绿。**这不是回归**，是 Windows 上的既有前置（G05 记录里也写过这个用法）。

**体积结果**：`workflow-activity-worker.ts` **345 行**、`workflow-completion-dispatcher.ts` 226、`workflow-action-support.ts` 209、`workflow-runtime-support.ts` 182、`workflow-run-lane.ts` 134、`workflow-host-runtime-types.ts` 116——六个新文件全部 ≤400 行（原 1205 行）。

## Follow-ups

- 其余超红线文件：`product-fixtures.tsx`（1192）、`worker-admin/index.ts`（1047）、`collectors/index.ts`（1014）、`board-view.tsx`（972）、`workflow-backend.ts`（896）、`workflow-ingest.test.ts`（871）、`story-panel.tsx`（849）。
- 三个 Web 文件留到 UI 重做同批。
- `workflow-backend.ts`（896）属同一运行时族，拆分时可复用本次的分册切法。
