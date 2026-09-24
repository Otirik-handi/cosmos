# G15：`apps/worker/src/workflow-ingest.test.ts` 拆分（P4-2 第七个对象，重做）

## User Request / Topic

2026-09-24 维护者确认 G15 为 `apps/worker/src/workflow-ingest.test.ts`（871 行、测试文件），拆分方案先经确认；**第一次尝试因全量套件 2/2 变红被回滚**，维护者裁定「先修测试预算（G16），再重做 G15」。本记录是重做后的结果。

## Goal

把 871 行的测试文件按 `it` 边界拆成两个测试文件 + 一个共享装置模块，**用例数不变（4 个）**、断言原文逐字不动，且**全量套件连续两轮全绿**。

## Scope / Non-goals

Scope：

- 拆为 `workflow-ingest.parity.test.ts`（parity 长场景）、`workflow-ingest.media.test.ts`（三个媒体用例）、`workflow-ingest.fixtures.ts`（共享装置）。
- 装置模块导出 `temporaryRoots` 与 `cleanupTemporaryRoots()`；两个测试文件各自 `afterEach(cleanupTemporaryRoots)`（装置模块**不**注册钩子，否则被导入时会重复注册）。
- 同批修正 `docs/spec/`、`docs/testing/` 里指向旧文件路径与行范围的引用。
- 移除代码基线里该文件的条目。

Non-goals：

- **不拆 parity 长场景**：它是一个**单场景 62 个断言**的全链路一致性测试，拆成多个 `it` 是测试重构（要重组场景与共享前置），超出「只移动实现」的范围。parity 文件因此仍有 **458 行**（高于 400 健康线、远低于 800 红线），已在 `MODULE`/本记录中标注。
- 不改任何断言、不改被测代码。

## Current State

- 生命周期阶段：实现与验证完成；**未 commit、未合并**（与 G16 同分支 `fix/g16-test-timeout-budget`）。
- 可观察验收：①用例数仍为 4；②三个文件 ≤800 行红线；③全量连续两轮全绿。
- 受影响合同：**无**——只移动测试代码，不改断言与行为。
- 验证层级：聚焦单元 → 全仓 typecheck → 全量单元 ×2 → 两份体积门禁 → `docs:check`。

## Decisions and Deviations

### 1. 第一次尝试为什么被回滚

按 `it` 边界拆完后聚焦跑 4/4 通过，但**全量套件连续两次失败**（131 个测试文件 vs master 的 130 个），而 master 同一时段连续 6 次全绿：

| 跑法 | 结果 |
| --- | --- |
| master（130 文件） | 6/6 全绿 |
| G15 run #1 | parity 用例 `Test timed out in 15000ms` + 派生 `EBUSY` |
| G15 run #2 | 另一个文件（`story-human-protection.test.ts`）的独立 `EBUSY` |

两个失败都是**已登记的已知抖动**，但多出的第 131 个并发测试文件把它们的触发率抬了上来。按「不用重跑结案、不合入让套件变红的改动」的纪律，**回滚并先修前置**（G16）。

### 2. G16 修掉了决定性因素

查明 `vitest.config.ts` 全局 `testTimeout` 本就是 **60 秒**，而该文件自己覆盖成 15/15/15/20 秒。G16 删掉这四处覆盖后，同样的拆分**连续两轮全绿**（131 文件 / 737 用例）。对照结论：

| 状态 | 全量结果 |
| --- | --- |
| master（130 文件） | 6/6 绿 |
| 拆分 + 旧预算（131 文件） | **0/2** |
| 拆分 + 去预算（131 文件） | **2/2 绿** |

### 3. parity 文件保留 458 行，如实标注

见 Non-goals。这是「内聚的单场景测试」与「400 行健康线」的取舍：拆它需要重组场景（真重构），本次不做。

### 4. 文档引用同批修正

`docs/spec/application/0005`、`0006` 与 `docs/spec/runtime/0002` 都指向旧文件（其中两处还带**行范围锚点** `#L193-L283`、`#L28-L467`）。行范围跨拆分后无法保留，改为指向新文件 + 引用稳定的用例标题；`docs/testing/README.md` 两处散文提及也一并改名。台账 `known-unstable-cases.md` 里的**历史命令与路径按原样保留**（该文件是观察记录，按仓库规则不回改历史叙述），只补一行新文件名便于定位。

## Implementation Walkthrough

1. 重写切片脚本：边界改为**自动探测** `it(` 与 `describe` 收尾，不再硬编码行号（上一版硬编码时踩到过工具间行号不一致）。
2. 首跑导入块被截断（「找最后一个 import 行」写成了「找第一个匹配」）→ 改为以 `temporaryRoots` 声明为界取导入块。
3. 删原文件；改文档引用；重新生成基线（10 → 9 条）。

## Verification

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 聚焦单元 | `bunx vitest run apps/worker/src/workflow-ingest.{parity,media}.test.ts` | **2 文件 / 4 用例全绿**（用例数与拆分前一致） |
| 全仓类型 | `bun run typecheck`（apps/worker 包内 + 全仓） | **0** |
| 全量单元 ×2 | `bun run test` | **两轮均 131 文件 / 737 用例全绿，真实退出码 0** |
| 代码门禁 | `-c code tests --check … --fail-on-new --warn-lines 800 …` | **PASS**（基线 **9** 条） |
| 文档门禁 / 链接 | `-c docs --check …` / `bun run docs:check` | **PASS（含 warning）** / **824 文件 0 失败** |
| 空白 | `git diff --check` | 干净 |

**体积结果**：`workflow-ingest.parity.test.ts` **458 行**、`workflow-ingest.media.test.ts` 392、`workflow-ingest.fixtures.ts` 90（原单文件 871 行）。

## Follow-ups

- 三个 Web 文件（`product-fixtures.tsx`、`board-view.tsx`、`story-panel.tsx`）留到 UI 重做同批——**P4-2 的非 UI 侧到此清空**。
- 台账第 8 条（`afterEach` 清理撞 `EBUSY`）仍开放：本次两轮全量未复现，但机制未查清，修法需单独裁定。
- parity 长场景若要拆，应作为**测试重构**单独提案（要说明 62 个断言如何重组）。

## 勘误（2026-09-24，热修）：本次拆分曾让 `apps/worker` 的生产构建失败

**回归由本记录的拆分引入，所以勘误记在这里。**

**症状**：`bun run build`、`bun run test:e2e`、`bun run test:browser`（它先 build）全部失败；CI 的 `ci.yml:61`／`:75`／`:90` 三步自合并 `4126dc9` 起为红。报错 **40 条 `TS6059`**：

```
src/workflow-ingest.fixtures.ts(11,8): error TS6059: File '.../packages/application/src/index.ts'
is not under 'rootDir' 'apps/worker/src'
```

**根因**：`apps/worker/tsconfig.json` 的 `include` 是 `src/**/*.ts`（构建可见），只有 `apps/worker/tsconfig.build.json` 排除 `src/**/*.test.ts`。原文件 `workflow-ingest.test.ts` 因此被排除；本次新建的 **`workflow-ingest.fixtures.ts` 不匹配 `*.test.ts`**，于是进入生产构建，而它用**相对源码路径**导入 `packages/application/src/*` 与 `packages/storage-prisma/src/*`，把 rootDir 之外的文件拉进程序。

**修复**：`apps/worker/tsconfig.build.json` 的 `exclude` 增加 `"src/**/*.fixtures.ts"`。该配置的语义本就是「排除测试专用文件」，而 `.fixtures.ts` 正是测试专用文件（`packages/storage-prisma` 已有 `index.fixtures.ts`、`workflow-host-store.fixtures.ts` 两个先例）。

**验证**（worktree `fix-worker-build`，分支 `fix/worker-build-fixtures-exclude`）：

| 检查 | 结果 |
| --- | --- |
| `bun run build`（api + worker + web） | **exit 0**（修前 40 条 TS6059） |
| `apps/worker/dist` 是否还有 `*fixtures*` | **无**（修前有 `workflow-ingest.fixtures.js` + `.map`） |
| `test:e2e`（带 `BUN_BINARY`） | **6 文件 / 11 用例全绿，exit 0** |
| worker 测试（fixtures 对测试仍须可用） | **2 文件 / 4 用例全绿** |

**同类风险排查**：全仓搜索「逃出本项目 rootDir 的相对导入」（`from "../../../`），**只有本次这三个文件命中**（fixtures + 两个测试文件），其它 app／包／插件一律走 `@cosmos/*` 别名。**没有第二处同类隐患。**

**流程教训（本勘误最重要的一条）**：本次拆分在 `apps/worker/src` 下**新增了一个非 `*.test.ts` 的文件**，而那是**构建可见**的目录——**验证清单里却没有「跑构建」这一项**。当时只覆盖了聚焦测试、typecheck、全量单测、体积门禁与 `docs:check`，**构建与 `test:e2e` 都漏了**（上一次跑 e2e 是 G14，在拆分之前）。**凡在 `apps/*/src` 或 `packages/*/src` 下新增非测试文件，验证必须包含 `bun run build`。**

**顺带观察（既有问题，本次未修）**：`apps/api/tsconfig.json` 只排除 `dist`，因此 `apps/api/dist` 里有编译后的 `*.test.js`；各包（domain 2／application 13／storage-prisma 54／collectors 2）的 `dist` 里也有测试与 fixtures 产物。不影响构建通过，属**产物卫生**问题，需要时单开切片。
