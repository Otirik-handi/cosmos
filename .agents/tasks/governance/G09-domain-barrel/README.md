# G09：`@cosmos/domain` 单体拆分（P4-2 batch 1 第一个对象）

## User Request / Topic

2026-09-24 维护者裁定 P4-2 的拆分顺序为「先拆非 UI 文件」，batch 1 从 `packages/domain/src/index.ts`（885 行）起；G 编号 G09 由维护者确认。

## Goal

把 `@cosmos/domain` 的**纯单体**拆成 8 个分册 + 门面，且**导出面逐字节零 diff**（68 个导出一个不多一个不少）。

## Scope / Non-goals

Scope：

- 按概念聚合把 885 行单体拆为 `story-subtypes` / `enums` / `content` / `temporal` / `story-representation` / `revision-fingerprints` / `story-projection` / `internal` 八个分册，`index.ts` 变门面。
- 新增 `packages/domain/MODULE.md`（提案硬性要求，该包此前没有）。
- 新增 `packages/domain/src/entry-contract.test.ts` 与 `packages/domain/entry-surface.txt`（把「导出零 diff」从一次性比对升级为长期护栏）。
- 移除代码基线里 `packages/domain/src/index.ts` 那条（拆分后已回健康区）。

Non-goals：

- **不改任何导出符号、类型形状或运行时行为**（68 个导出的签名与种类零 diff）。
- 不动 `packages/domain/src/index.test.ts`（504 行行为测试原样保留）。
- 不动 `media-acquisition.ts`（那是 G10）。
- 不动其它 9 个「行数越界」文件。

## Current State

- 生命周期阶段：实现与验证完成；**未 commit、未合并**。
- 连贯目标：让 `@cosmos/domain` 的入口成为门面，公共合同逐字节不变。
- 可观察验收（≤3 条）：
  1. 入口 `index.ts` ≤100 行（提案对桶文件的要求），全部新文件 ≤400 行；
  2. 导出面 68 个逐字节零 diff（脚本比对）+ 入口契约测试常驻；
  3. 现有行为测试全绿、`madge --circular` 0 个、全仓 typecheck 0。
- 依赖：无新增依赖；复用 `scripts/entry-export-surface.ts`（G05/G07 既有工具）。
- 受影响合同：**无**——公共导出面、类型形状与行为都不变；无 Prisma schema、无 migration、无 DTO、无 API。
- 预计核心文件：`packages/domain/src/*.ts`、`packages/domain/MODULE.md`、`packages/domain/entry-surface.txt`、`docs/doc-governance/code-baseline.json`。
- 验证层级：导出面脚本比对 → 聚焦单元（domain 包）→ 全仓 typecheck → 全量单元 → 两份体积门禁 → `docs:check`。

## Decisions and Deviations

### 1. 八分册的切法（维护者 2026-09-24 确认）

| 分册 | 内容 |
| --- | --- |
| `story-subtypes.ts` | Story kind 与 subtype 受管注册表、`checkStorySubtype` |
| `enums.ts` | 九个受管枚举 + 条目关系端点归一化 |
| `content.ts` | 内容类型/发现渠道、Publisher/Metrics、`NormalizedIngestItem`、`deriveExternalKey`、条目 revision 指纹 |
| `temporal.ts` | `TemporalValue` 家族、`createTemporalValue`、时间解析助手 |
| `story-representation.ts` | Story 当前表示的归一化与指纹 |
| `revision-fingerprints.ts` | Topic / Entity revision 指纹 |
| `story-projection.ts` | Entry → 最小 Story 投影 |
| `internal.ts` | 包内共享助手（哈希、文本归一化、稳定序列化） |

### 2. 时间解析助手归 `temporal.ts`，且**保持非导出**

原计划把它们放 `internal.ts`，实测 tsc 报缺名——它们要用 `TemporalFallback` / `TemporalPrecision`，而那两个类型在 `temporal.ts`，于是 `internal ↔ temporal` 成环。

改放 `temporal.ts` 后仍有一个坑：`temporal.ts` **会被门面重新导出**，若给这些助手补 `export` 就会把它们泄漏进公共导出面，直接破坏「零 diff」。实测没有别的分册用它们，所以保持非导出即可。只有 `internal.ts` 的助手需要补 `export`——它刻意不被门面重新导出。

### 3. 用一次性切片脚本按**声明边界**搬运，不手抄

手抄 885 行必然引入差异，而本 Task 的硬约束是零 diff。脚本（`.agent/tmp/split-domain.ts`，一次性 scratch）从备份的原始文件按顶层声明边界切片，只搬运字节。

**为什么不硬编码行号**：实测声明行号与直觉有偏差（例如 `PublisherMetrics` 的实际位置与按声明表推算的差数行），硬编码会切错。脚本按正则找声明并处理「紧贴其上的注释块随声明一起搬走」。

### 4. 顺手移除基线里的 domain 条目

拆分后门禁报「基线内文件已回到健康区(可移除)」。治理目标是「条目只减不增」，所以同批移除，`code-baseline.json` 16 → **15 条**——这是 G08 那道门禁第一次产生收敛效果。

## Implementation Walkthrough

1. 取拆分前基线：domain 2 文件 / 23 用例全绿、typecheck 0、导出面 68（`entry-surface.txt` 冻结）。
2. 按声明边界切片，写入 8 个分册 + 12 行门面；跨分册 import 显式声明，类型用 `import type`（tsconfig 开了 `verbatimModuleSyntax`），门面用 `.js` 后缀。
3. 三轮修正：门面 `.ts` → `.js`；类型导入加 `type`；temporal 助手归位并保持非导出。
4. 补 `MODULE.md`、`entry-contract.test.ts`，移除过期基线条目。

## Verification

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 导出面零 diff | `bun run scripts/entry-export-surface.ts packages/domain/src/index.ts --out …` + `Compare-Object` | **68 → 68，逐字节零 diff** |
| 包内行为测试 | `bunx vitest run packages/domain` | **2 文件 / 23 用例全绿** |
| 环依赖 | `bunx madge --circular --extensions ts packages/domain/src/index.ts` | **No circular dependency found** |
| 全仓类型 | `bun run typecheck` | **0** |
| 全量单元 | `bun run test` | **128 文件 / 735 用例全绿**（较 master 127/734 多入口契约测试 1 文件 1 用例） |
| 代码门禁 | `-c code tests --check --baseline … --fail-on-new --warn-lines 800 …` | **PASS**（385 文件 / 基线 **15** 条） |
| 文档门禁 | `-c docs --check --baseline … --fail-on-new` | **PASS（含 warning）** |
| 文档链接 | `bun run docs:check` | **783 文件 0 失败** |
| 空白 | `git diff --check` | 干净 |

**体积结果**（脚本口径）：入口 **885 → 12 行**；最大分册 `temporal.ts` **221 行**；九个文件全部 ≤400 行（落在提案的健康区，不只是红线以下）。

**未运行**：Node 进程 E2E、真实来源验收、浏览器验收、Docker。本 Task 只移动实现且导出面零 diff，故未跑运行表面验收；合并前已跑全量单元与 typecheck。

## Follow-ups

- **G10 = `packages/application/src/media-acquisition.ts`（918 行）**，batch 1 的第二个对象。
- 其余按行数降序：`workflow-host-runtime.ts`（1205）、`product-fixtures.tsx`（1192）、`worker-admin/index.ts`（1047）、`collectors/index.ts`（1014）、`board-view.tsx`（972）、`workflow-backend.ts`（896）、`workflow-ingest.test.ts`（871）、`story-panel.tsx`（849）。
- 三个 Web 文件（`product-fixtures.tsx`、`board-view.tsx`、`story-panel.tsx`）**留到 UI 重做同批**。
- `packages/domain` 现已无越界文件；`MODULE.md` 与入口契约测试是后续拆分可复用的模式。
