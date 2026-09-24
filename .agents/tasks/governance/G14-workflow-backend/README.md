# G14：`@cosmos/storage-prisma` Workflow 后端拆分（P4-2 第六个对象）

## User Request / Topic

2026-09-24 维护者确认 G14 为 `packages/storage-prisma/src/workflow-backend.ts`（896 行、运行时关键路径）；拆分方案先经维护者确认再动手。

## Goal

把 Prisma Workflow 后端从 896 行单体拆成按职责聚合的六个分册 + 一个保留原名的类模块，**包入口导出面逐字节零 diff**（10 个导出），所有文件 ≤400 行。

## Scope / Non-goals

Scope：

- 拆为：`workflow-envelope-marker`（信封标记，被 host-store 多处使用）、`workflow-backend-errors`（完整性错误与唯一约束判定）、`workflow-state-fields`（低层字段助手）、`workflow-state-codec`（行 ↔ 状态映射）、`workflow-state-validation`（状态归一化与断言）、`workflow-run-events`（终态事件与信封收养）。
- `workflow-backend.ts` **保留原名**，只放 `PrismaWorkflowBackend` 与能力声明。
- 改 5 处引用点（它自己的测试 + 4 个 host-store 文件）指向新分册。
- 移除代码基线里该文件的条目。

Non-goals：

- **不改任何导出符号、类型形状或运行时行为**（包入口 10 个导出零 diff）。
- **不拆 `PrismaWorkflowBackend`（360 行）**：单个内聚类，已在 400 行内。
- 不动 `workflow-host-store/` 下其它文件（`internals-activity.ts` 700 行等不在本 Task 的红线清单里）。

## Current State

- 生命周期阶段：实现与验证完成；**未 commit、未合并**。
- 连贯目标：Workflow 后端回到可读分册结构，公共合同逐字节不变。
- 可观察验收（≤3 条）：
  1. 七个文件全部 ≤400 行，`workflow-backend.ts` 只剩类；
  2. 包入口导出面 10 个逐字节零 diff；
  3. 聚焦测试、全仓 typecheck、全量单元与 Node 进程 E2E 全部通过、`madge --circular` 0 个。
- 依赖：无新增依赖；复用 `scripts/entry-export-surface.ts`。
- 受影响合同：**无**——包入口导出面、类型形状与行为都不变；无 Prisma schema、无 migration、无 DTO、无 API。`index.ts` 只从这里导出 `PrismaWorkflowBackend`，而类保留原名 → **包入口零改动**。
- 预计核心文件：`packages/storage-prisma/src/workflow-{envelope-marker,backend-errors,state-fields,state-codec,state-validation,run-events,backend}.ts`、5 处引用点、`code-baseline.json`。
- 验证层级：包入口导出面比对 → 聚焦单元 → 全仓 typecheck → 全量单元 → **Node 进程 E2E** → 两份体积门禁 → `docs:check`。

## Decisions and Deviations

### 1. 类保留原文件名，包入口零改动

`index.ts` 只从这里导出 `PrismaWorkflowBackend`。让类留在 `workflow-backend.ts` 后，包入口那一行不用动；只有 5 处**内部**引用点需要改指向（它们要的是信封标记与错误类）。

### 2. 抽一层 `workflow-state-fields`，消掉 codec ↔ validation 环

首轮方案把 `parseDate`/`terminalFinishedAt` 放 validation、`WorkflowRunRow` 放 codec，两者互用 → 成环。把五个低层字段助手（`WorkflowRunRow`、`parseDate`、`terminalFinishedAt`、`requireString`、`requireArray`、`isRecord`）单独抽成 `workflow-state-fields`，依赖变成 `codec → fields`、`validation → fields` 的单向。

**这是「符号归使用者」规则的第三种形态**：不是「谁用就归谁」，而是「多方都用 → 抽到共同的低层模块」。前两种（G12 的 `delay`、G13 的常量）是单一使用者；这一轮是多个使用者。

### 3. 沿用已固化的三条规则

第三方导入清单从原 import 块（第 1–19 行）推导；补 export 用多行锚点；符号归属先问「有谁用」。

## Implementation Walkthrough

1. 取基线：包入口导出面 10、`workflow-backend.test.ts` 24 用例、typecheck 0、单体 896 行 / 32164 B。
2. 切片脚本（`.agent/tmp/split-workflow-backend.ts`，一次性 scratch）按声明边界写入七文件；三轮 typecheck 收敛导入与一个环。
3. 改 5 处引用点（测试 2 个符号、4 个 host-store 文件各 1–2 个符号）。
4. 重新生成代码基线（11 → 10 条）。

## Verification

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 包入口导出面零 diff | `bun run scripts/entry-export-surface.ts packages/storage-prisma/src/index.ts --out …` + `Compare-Object` | **10 → 10，逐字节零 diff** |
| 聚焦单元 | `bunx vitest run packages/storage-prisma/src/workflow-backend.test.ts` | **24 用例全绿**（与拆分前一致） |
| 环依赖 | `bunx madge --circular --extensions ts packages/storage-prisma/src/index.ts` | **No circular dependency found** |
| 全仓类型 | `bun run typecheck` | **0** |
| 全量单元 | `bun run test` | **130 文件 / 737 用例全绿，真实退出码 0**（与拆分前完全一致——本 Task 未新增测试，因为被拆文件不是包入口） |
| 运行表面 | `BUN_BINARY=<真实 bun.exe> bun run test:e2e` | **6 文件 / 11 用例全绿，真实退出码 0** |
| 代码门禁 | `-c code tests --check … --fail-on-new --warn-lines 800 …` | **PASS**（基线 **10** 条） |
| 文档门禁 / 链接 | `-c docs --check …` / `bun run docs:check` | **PASS（含 warning）** / **820 文件 0 失败** |

**体积结果**：`workflow-backend.ts` **896 → 360 行**（只剩类与能力声明）；`workflow-state-validation.ts` 199、`workflow-run-events.ts` 137、`workflow-state-codec.ts` 104、`workflow-state-fields.ts` 60、`workflow-envelope-marker.ts` 49、`workflow-backend-errors.ts` 10——七个文件全部 ≤400 行。

## Follow-ups

- 其余超红线文件：`product-fixtures.tsx`（1192）、`board-view.tsx`（972）、`workflow-ingest.test.ts`（871）、`story-panel.tsx`（849）。三个 Web 文件留到 UI 重做同批。
- **非 UI 的最后一个 = `apps/worker/src/workflow-ingest.test.ts`（871，测试文件，按行为拆）**。
- `workflow-host-store/internals-activity.ts`（700 行）虽未越红线但已是同族最大者，将来治理时可复用本轮的「低层字段模块」切法。
