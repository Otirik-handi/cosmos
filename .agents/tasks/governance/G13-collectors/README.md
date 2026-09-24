# G13：`@cosmos/plugin-collectors` 入口拆分（P4-2 第五个对象）

## User Request / Topic

2026-09-24 维护者确认 G13 为 `plugins/collectors/src/index.ts`（1014 行、**包入口**）；拆分方案先经维护者确认再动手。

## Goal

把内置连接器包的入口单体拆成按职责聚合的六个分册 + 门面，**导出面逐字节零 diff**（16 个导出），入口落回提案对桶文件的 ≤100 行要求。

## Scope / Non-goals

Scope：

- 拆为六个分册：`opencli-runner`（OpenCLI 子进程执行器与常量）、`bilibili-connector`（连接器与执行计划）、`bilibili-normalize`（Bilibili 归一化与执行计划类型）、`aihot-connector`（AI HOT 连接器）、`shared`（JSON 抽取与资产/指标助手）、`registry`（内置注册表）。
- `index.ts` 改写成门面（**导出清单由冻结快照生成**，同 G12）。
- 补齐该包此前缺失的 `entry-surface.txt`、`entry-contract.test.ts`、`MODULE.md`。
- 移除代码基线里该入口的条目。

Non-goals：

- **不改任何导出符号、类型形状或运行时行为**（16 个导出零 diff）。
- 不动 `index.test.ts`（约 500 行，未越红线）。

## Current State

- 生命周期阶段：实现与验证完成；**未 commit、未合并**。
- 可观察验收（≤3 条）：
  1. 入口 `index.ts` ≤100 行，六个分册全部 ≤400 行；
  2. 导出面 16 个逐字节零 diff + 入口契约测试常驻；
  3. collectors 测试、全仓 typecheck、全量单元与 Node 进程 E2E 全部通过、`madge --circular` 0 个。
- 依赖：无新增依赖；复用 `scripts/entry-export-surface.ts`。
- 受影响合同：**无**——导出面、类型形状与行为都不变；无 Prisma schema、无 migration、无 DTO、无 API。消费方只按包名 `@cosmos/plugin-collectors` 导入（三处 vitest 别名），**零改动**。
- 预计核心文件：`plugins/collectors/src/{opencli-runner,bilibili-connector,bilibili-normalize,aihot-connector,shared,registry,index}.ts`、`MODULE.md`、`entry-surface.txt`、`entry-contract.test.ts`、`code-baseline.json`。
- 验证层级：导出面脚本比对 → 聚焦单元（collectors 包）→ 全仓 typecheck → 全量单元 → Node 进程 E2E → 两份体积门禁 → `docs:check`。

## Decisions and Deviations

### 1. 门面导出清单由冻结快照生成（沿用 G12）

16 个导出按「名称 → 所属分册」自动分组，脚本收尾断言「门面覆盖数 == 快照数」，零 diff 由构造保证。

### 2. 三个环，全部靠「符号归使用者」解决

本轮切片脚本第一次跑就暴露了三个循环，都是「符号放错模块」而非逻辑问题：

| 环 | 原因 | 解法 |
| --- | --- | --- |
| `registry → connector → runner → registry` | 来源标识/URL/CLI 常量被集中放在 `registry.ts`，而 registry 又依赖各连接器 | 常量归**各自的使用者**：`openCliExecutableEnv`/`supportedOpenCliMajor` → `opencli-runner`；`bilibiliConnectorId` → `bilibili-connector`；`aiHotConnectorId`/`aiHotItemsUrl` → `aihot-connector`；`registry` 只留注册表本身 |
| `bilibili-connector ↔ bilibili-normalize` | 归一化要用 `BilibiliExecutionPlan`，而连接器要用 `normalizeBilibiliOutput` | 执行计划类型归**归一化一侧**，依赖变成单向 |
| （G12 同类）`service ↔ http` | 只有一方使用的助手被放进另一方 | 归唯一使用者 |

**通用规则（三次都成立）**：切片时先问「这个符号有谁用」，再决定归属；把「同类的东西」放一起（例如所有常量进 registry）在跨模块引用下必然成环。

### 3. 切片脚本的「补 export」正则要防注释块

本轮首跑报 `readBilibiliAccountName` 未导出——因为切片会把**紧贴声明上方的注释块**一起搬走，块首不再是声明行，单行 `^` 锚点的正则匹配不到。改成多行锚点（`/^(async\s+)?(function|const|...)\s/m`）后修复。**这条对所有分册脚本都适用**，G09–G12 只是恰好没踩到。

### 4. 第三方导入清单必须从原 import 块推导（G12 教训再次生效）

首轮我按「这个模块大概需要什么」推测导入，tsc 报出 `LoggerPort`/`IngestConnector`/`ConnectorExecutionError`/`aiHotSourceConfigSchema` 等一大片缺失。读原文件 1–32 行的 import 块后按「谁用谁导入」重新分配，两轮收敛。

### 5. 脚本对象字面量的重复键

给 `registry` 补导入时插入了**第二个 `imports` 键**，JS 语义下后者覆盖前者，导致生成的 registry 缺 `OpenCliRunner`。教训：往自己写的 spec 对象里追加字段前先确认该键是否已存在。

## Implementation Walkthrough

1. 取基线：导出面 16、collectors 1 文件 / 11 用例、typecheck 0、入口 1014 行 / 34351 B。
2. 切片脚本（`.agent/tmp/split-collectors.ts`，一次性 scratch）按声明边界写入六分册 + 门面；四轮 typecheck 收敛导入与三个环。
3. 冻结 `entry-surface.txt`；补 `entry-contract.test.ts` 与 `MODULE.md`。
4. 重新生成代码基线（12 → 11 条）。

## Verification

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 导出面零 diff | `bun run scripts/entry-export-surface.ts plugins/collectors/src/index.ts --out …` + `Compare-Object` | **16 → 16，逐字节零 diff** |
| 包内单元 | `bunx vitest run plugins/collectors` | **2 文件 / 12 用例全绿**（拆分前 1 文件 / 11 用例，+1 入口契约用例） |
| 环依赖 | `bunx madge --circular --extensions ts plugins/collectors/src/index.ts` | **No circular dependency found** |
| 全仓类型 | `bun run typecheck` | **0** |
| 全量单元 | `bun run test` | **130 文件 / 737 用例全绿，真实退出码 0**（+1 文件/+1 用例 = 入口契约） |
| 运行表面 | `BUN_BINARY=<真实 bun.exe> bun run test:e2e` | **6 文件 / 11 用例全绿，真实退出码 0** |
| 代码门禁 | `-c code tests --check … --fail-on-new --warn-lines 800 …` | **PASS**（407 文件 / 基线 **11** 条） |
| 文档门禁 / 链接 | `-c docs --check …` / `bun run docs:check` | **PASS（含 warning）** / **813 文件 0 失败** |

**体积结果**：入口 **1014 → 17 行**；`bilibili-connector.ts` 248、`aihot-connector.ts` 244、`opencli-runner.ts` 214、`shared.ts` 172、`bilibili-normalize.ts` 111、`registry.ts` 36——六个分册全部 ≤400 行。

## Follow-ups

- 其余超红线文件：`product-fixtures.tsx`（1192）、`board-view.tsx`（972）、`workflow-backend.ts`（896）、`workflow-ingest.test.ts`（871）、`story-panel.tsx`（849）。
- 三个 Web 文件留到 UI 重做同批；非 UI 的下一项是 `packages/storage-prisma/src/workflow-backend.ts`（896，运行时关键路径）。
- 本轮积累的三条通用规则（符号归使用者、补 export 用多行锚点、第三方导入从原 import 块推导）应作为后续所有 G 系列切片的默认做法。
