# 治理任务 G07：代码治理第四对象——`packages/transport-http` 单体拆分

## User Request / Topic

维护者 2026-09-14：完成 G06 收尾后开启 G07，治理 `packages/transport-http/src/index.ts`；其余**非红线**文件暂不处理，等未来触碰红线再治理。依据 [`docs/proposals/code-size-governance-v1.md`](../../../../docs/proposals/code-size-governance-v1.md)（accepted）§4.3 拆分决策树、§4.4 拆分模式库；方向承接 G05/G06 对桶文件群（application / contracts / transport-http）的治理序列。

## Goal

`packages/transport-http/src/index.ts`（**1269 行 / 41.4 KB**）与其同名测试 `index.test.ts`（**964 行 / 38.7 KB**）离开红线（提案 §4.1：源码/测试 **>800 行** 或 >50 KB）。对象是**纯单体**：0 处 `export *`、解析后仅 **4 个导出**，因此固定顺序中的「桶文件模块地图化」不适用、跳过，实际执行 **测试按行为拆 → 单体按聚合拆**。

## Scope / Non-goals

**范围**：`packages/transport-http/src/index.ts`、`src/index.test.ts`；拆分产出的同级模块文件；入口导出面快照与常驻契约测试（沿用 G05/G06 已入库的 [`scripts/entry-export-surface.ts`](../../../../scripts/entry-export-surface.ts)）；`packages/transport-http/MODULE.md`；收口时 `repo-map.json` 重生成与 `code-baseline.json` 下调。

**非目标**：不改任何导出符号、类型形状或运行时行为（4 个导出的签名零 diff）；不动 `apps/api` ↔ transport 的调用方；不动其它 9 个「行数越界」文件（维护者 2026-09-14 指令：非红线不做）；不把行数阈值并入 `size-governance.py`（属治理机制修复，另议）。

## 对象形态与基线（2026-09-14 实测）

| 文件 | 行数 | 字节 | 备注 |
|---|---|---|---|
| `packages/transport-http/src/index.ts` | 1269 | 42,368（41.4 KB） | 纯单体；0 处 `export *`；解析后 **4 个导出** |
| `packages/transport-http/src/index.test.ts` | 964 | 39,598（38.7 KB） | 同名测试，自身亦越红线 |

- `src/` 下只有这两个文件——没有既有模块边界可沿用，聚合划分需从实现内容推导。
- G05 评分表中 P=2.49（当时第 2 位），R=2（包入口 + 连接公共合同）；本轮不重算 P，直接采用维护者指定的对象。

## Current State

**已完成收口**（2026-09-14，维护者授权「直到 G07 完成」）。经 `refactor/g07-transport-http` 以 `--no-ff` 合入 `master` **`06065cd`**，已推送 `origin`，worktree 与分支已清理；**CI 四作业全绿**（Quality / Browser E2E / Windows Node smoke / Node process E2E）。

| 对象 | 行数 | 字节 | 读取量 |
|---|---|---|---|
| `packages/transport-http/src/index.ts` | 1269 → **11** | 41.4 KB → **0.5 KB** | 10,592 → **141 token**（−98.7%） |
| `packages/transport-http/src/index.test.ts` | 964 → 拆成 **6 个文件**（99~253 行） | 38.7 KB → 各 3~10 KB | — |

拆法（G03 先例「继承链拆文件 + 门面」）：`types.ts` → `client-base.ts`（字段/构造/**唯一 `request` 管道**/SSE）→ `client-platform`(90) → `client-sources`(223) → `client-content`(407) → `client-organization`(277) → `client-board`(223) → `index.ts` 门面。关键实测：**103 个方法之间无互相调用**（全是 `this.request(...)`），故继承链只是文件组织、无行为耦合；类仍是单个，消费方零改动。

master 上重验：typecheck 0；unit **87 文件 / 516 用例**（用例数守恒）；property 4；e2e 4；浏览器 **17/17**；两份体积门禁 PASS；`docs:check` 618 文件 0 失败；**导出面 4 个逐字节零 diff**、madge 0 环。`code-baseline.json` 8 → 6 条；**完整红线口径下红线文件 10 → 8 个**。代价：`dist` 94 → 186 KB（+98%，模块数的固定开销）。

## 切片记录

| # | 切片 | 验收（≤3 条） | 状态 |
|---|---|---|---|
| 0 | 前置：worktree + 基线（大小/行数/4 个导出的导出面快照与常驻契约测试/三配置测试/build 字节/madge） | 三配置全绿；导出面快照与契约测试入库 | done（2026-09-14；导出面 4 个、契约测试入库、madge 0、dist 94 KB、typecheck 0 / unit 82·516 / property 4 / e2e 4） |
| 1 | 测试按行为拆：`index.test.ts`（964 行）按行为/聚合拆为同级文件 | 单文件 ≤400 行；用例数守恒；三配置全绿 | done（2026-09-14；6 个域文件 99~253 行、17 用例守恒、全仓 unit 87 文件·516 用例） |
| 2 | 单体按聚合拆：按 HTTP 传输的关注点（客户端/错误/SSE 或等价聚合）移入模块，入口留门面 | 4 个导出零 diff；入口 ≤300 行；三配置全绿 | done（2026-09-14；继承链 6 分册 + 门面，入口 **11 行**、导出面 4 个逐字节零 diff、madge 0 环） |
| 3 | 收口：`MODULE.md`、`repo-map.json` 重生成、`code-baseline.json` 下调（2 条移除）、读取量指标 | 基线只减不增；`docs:check` 0 失败 | done（2026-09-14；`MODULE.md` 3,093 B、repo-map 38 目录、基线 **8 → 6 条**、入口读取量 −98.7%；`docs:check` 首跑断链已同批修正后 0 失败） |

## Verification

- 每切片：`bun run typecheck` → vitest 三配置（unit/property/e2e）→ `bun run build:packages` → 导出面 diff（`scripts/entry-export-surface.ts` + 快照 + 常驻契约测试）→ madge 循环依赖。
- 行为等价底线：现有测试全绿 + 入口契约测试 + 导出签名零 diff；每切片独立 commit、可单独 revert。
- 全部验证在 G07 worktree 内执行；`docs:check` 在 worktree 内跑（仓库规则）。

## Follow-ups

- **门禁仍不拦行数**：维护者 2026-09-14 已裁定采用**完整口径**（行数或字节或 token），但 `size-governance.py --check` 目前只判字节/token——标准已定、执行未跟上。把行数阈值并入门禁（并为其建立行数基线）是下一步机制任务；完整口径下当前仍有 **8 个**红线文件，清单见 [`../README.md`](../README.md)「红线口径提醒」。
- 其余 8 个红线（行数越界）文件的治理顺序：维护者 2026-09-14 裁定采用完整口径后，已在 [`../README.md`](../README.md) 按行数降序列出建议次序；G 系列任务当前暂停，待恢复时按该次序推进。
