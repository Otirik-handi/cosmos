# G12：`@cosmos/worker-admin` 入口拆分（P4-2 第四个对象）

## User Request / Topic

2026-09-24 维护者确认 G12 为 `packages/worker-admin/src/index.ts`（1047 行、**入口文件**）；拆分方案先经维护者确认再动手。

## Goal

把 Worker Admin 的入口单体拆成按职责聚合的五个分册 + 门面，**导出面逐字节零 diff**（21 个导出），并让入口落回提案对桶文件的 ≤100 行要求。

## Scope / Non-goals

Scope：

- 拆为五个分册：`types`（公共快照/选项类型 + `WorkerAdminRequestError`）、`drain`（排空记录/状态类型与命令校验）、`health`（组件健康与失败快照装配）、`service`（`WorkerAdminService`）、`http`（`createWorkerAdminServer` 与请求处理）。
- `index.ts` 改写成门面（**导出清单直接从冻结的导出面生成**）。
- 补齐该包此前缺失的三样治理资产：`entry-surface.txt`、`entry-contract.test.ts`、`MODULE.md`（提案对包的要求）。
- 移除代码基线里该入口的条目。

Non-goals：

- **不改任何导出符号、类型形状或运行时行为**（21 个导出零 diff）。
- **不拆 `WorkerAdminService`（487 行）**：它是单个内聚的类，拆它＝抽取方法（真重构、有行为风险），超出治理任务的「只移动实现」范围；已写进 `MODULE.md` 的已知边界。
- 不动 `index.test.ts`（363 行，未越红线）。

## Current State

- 生命周期阶段：实现与验证完成；**未 commit、未合并**。
- 连贯目标：入口成为门面，公共合同逐字节不变。
- 可观察验收（≤3 条）：
  1. 入口 `index.ts` ≤100 行，五个分册全部 ≤800 行红线（`service.ts` 487 行高于 400 警戒线但落在提案「100~600 为佳」区间）；
  2. 导出面 21 个逐字节零 diff + 入口契约测试常驻；
  3. worker-admin 测试、全仓 typecheck、全量单元与 Node 进程 E2E 全部通过、`madge --circular` 0 个。
- 依赖：无新增依赖；复用 `scripts/entry-export-surface.ts`。
- 受影响合同：**无**——导出面、类型形状与行为都不变；无 Prisma schema、无 migration、无 DTO、无 API。消费方（`apps/worker/src/main.ts`、`runtime.ts`、`runtime.test.ts`）按**包名**导入，**零改动**。
- 预计核心文件：`packages/worker-admin/src/{types,drain,health,service,http,index}.ts`、`MODULE.md`、`entry-surface.txt`、`entry-contract.test.ts`、`code-baseline.json`。
- 验证层级：导出面脚本比对 → 聚焦单元（worker-admin 包）→ 全仓 typecheck → 全量单元 → Node 进程 E2E → 两份体积门禁 → `docs:check`。

## Decisions and Deviations

### 1. 门面导出清单由冻结快照生成，而不是人眼核对

被拆的文件**就是包入口**，所以本轮不是「删单体、调用方改指向」（G10/G11 的形态），而是**把入口改写成门面**。切片脚本读拆分前的 `before-surface.txt`，按「名称 → 所属分册」生成门面，并在收尾断言「门面覆盖的导出数 == 快照导出数」——「21 个零 diff」因此是**构造上保证**的，不是核对出来的。

### 2. `delay` 归 `service`，否则 service ↔ http 成环

`delay` 在原文里靠近 http 助手，但它**只有 `WorkerAdminService` 用**（排空截止等待），而 `http` 已经依赖 `service`（`createWorkerAdminServer` 装配服务）。放 http 会形成 `service → http → service` 环——实测 tsc 报「Cannot find name delay」正是这条的暴露。

### 3. `LoggerPort` 是我凭空加的导入，已删

首轮我给三个分册加了 `import type { LoggerPort } from "@cosmos/logging"`，tsc 报「`@cosmos/logging` 没有导出 `LoggerPort`」。**原文件根本没有这个导入**——它不依赖任何 logger 类型。教训：切片脚本的第三方导入清单必须从原文件的 import 块推导，不能凭「这个模块大概需要日志」推测。

### 4. `WorkerAdminService`（487 行）保留不拆

见 Non-goals。已写进 `MODULE.md` 的已知边界，并给出将来若拆的切法（按状态快照/排空状态机两条职责）。

## Implementation Walkthrough

1. 取基线：导出面 21、worker-admin 1 文件 / 12 用例、typecheck 0、入口 1047 行 / 38914 B / 9728 tok。
2. 切片脚本（`.agent/tmp/split-worker-admin.ts`，一次性 scratch）按声明边界写入五分册 + 门面；三轮 typecheck 收敛导入。
3. 冻结 `entry-surface.txt`；补 `entry-contract.test.ts` 与 `MODULE.md`。
4. 重新生成代码基线（13 → 12 条）。

## Verification

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 导出面零 diff | `bun run scripts/entry-export-surface.ts packages/worker-admin/src/index.ts --out …` + `Compare-Object` | **21 → 21，逐字节零 diff** |
| 包内单元 | `bunx vitest run packages/worker-admin` | **2 文件 / 13 用例全绿**（拆分前 1 文件 / 12 用例，+1 入口契约用例） |
| 环依赖 | `bunx madge --circular --extensions ts packages/worker-admin/src/index.ts` | **No circular dependency found** |
| 全仓类型 | `bun run typecheck` | **0** |
| 全量单元 | `bun run test` | **129 文件 / 736 用例全绿，真实退出码 0**（+1 文件/+1 用例 = 入口契约） |
| 运行表面 | `BUN_BINARY=<真实 bun.exe> bun run test:e2e` | **6 文件 / 11 用例全绿，真实退出码 0** |
| 代码门禁 | `-c code tests --check … --fail-on-new --warn-lines 800 …` | **PASS**（400 文件 / 基线 **12** 条） |
| 文档门禁 / 链接 | `-c docs --check …` / `bun run docs:check` | **PASS（含 warning）** / **804 文件 0 失败** |

**体积结果**：入口 **1047 → 14 行**（提案对桶文件要求 ≤100）；`service.ts` 487、`types.ts` 198、`http.ts` 197、`drain.ts` 99、`health.ts` 91。

## Follow-ups

- 其余超红线文件：`product-fixtures.tsx`（1192）、`collectors/index.ts`（1014）、`board-view.tsx`（972）、`workflow-backend.ts`（896）、`workflow-ingest.test.ts`（871）、`story-panel.tsx`（849）。
- 三个 Web 文件留到 UI 重做同批；非 UI 的下一项是 `plugins/collectors/src/index.ts`（1014，插件边界）。
- `WorkerAdminService`（487）若将来要拆，按 `MODULE.md` 记录的两条职责切。
