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

**立项**（2026-09-14）。任务文档已建；**worktree/分支创建待维护者审批**，批复前不动代码。

## 计划切片（待 worktree 批复后细化）

| # | 切片 | 验收（≤3 条） | 状态 |
|---|---|---|---|
| 0 | 前置：worktree + 基线（大小/行数/4 个导出的导出面快照与常驻契约测试/三配置测试/build 字节/madge） | 三配置全绿；导出面快照与契约测试入库 | todo |
| 1 | 测试按行为拆：`index.test.ts`（964 行）按行为/聚合拆为同级文件 | 单文件 ≤400 行；用例数守恒；三配置全绿 | todo |
| 2 | 单体按聚合拆：按 HTTP 传输的关注点（客户端/错误/SSE 或等价聚合）移入模块，入口留门面 | 4 个导出零 diff；入口 ≤300 行；三配置全绿 | todo |
| 3 | 收口：`MODULE.md`、`repo-map.json` 重生成、`code-baseline.json` 下调（2 条移除）、读取量指标 | 基线只减不增；`docs:check` 0 失败 | todo |

## Verification

- 每切片：`bun run typecheck` → vitest 三配置（unit/property/e2e）→ `bun run build:packages` → 导出面 diff（`scripts/entry-export-surface.ts` + 快照 + 常驻契约测试）→ madge 循环依赖。
- 行为等价底线：现有测试全绿 + 入口契约测试 + 导出签名零 diff；每切片独立 commit、可单独 revert。
- 全部验证在 G07 worktree 内执行；`docs:check` 在 worktree 内跑（仓库规则）。

## Follow-ups

- **行数红线盲区（本轮核实）**：`size-governance.py --check` 只按字节/token 判红线，行数越界不拦；按完整口径仓库仍有 10 个文件超红线（清单见 [`../README.md`](../README.md)「红线口径提醒」）。把行数阈值并入门禁是根因修复，承接 G03/G05 Follow-ups。
- 其余 9 个行数越界文件的治理顺序由维护者裁定（维护者 2026-09-14 指令：非红线不做，本次不排）。
