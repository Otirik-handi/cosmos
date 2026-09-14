# 治理任务 G06：红线代码批次——contracts 入口与两个 Web UI 单体

## User Request / Topic

维护者 2026-09-14：开启 G06，目标治理当前门禁扫描超红线的 3 个代码文件：`packages/contracts/src/index.ts`（53.5 KB）、`apps/web/src/app/page.tsx`（62.2 KB）、`apps/web/src/components/cosmos/story-panel.tsx`（92.4 KB）。依据 [`docs/proposals/code-size-governance-v1.md`](../../../../docs/proposals/code-size-governance-v1.md)（accepted）§4.2 评分模型、§4.3 拆分决策树、§4.4 拆分模式库；方向承接 G05 Follow-ups 的「桶文件群剩余入口（contracts）」与「V 未测对象治理」。

## Goal

三个对象全部离开红线（源码/测试 >800 行 或 >50 KB，双轨先到先触发），且：

- **contracts**：`index.ts` 变为纯门面（只做导出与模块地图），新增 `packages/contracts/MODULE.md`；包入口导出面零 diff（快照 + 常驻契约测试双重确认）。门面行数验收以提案 §4.1 的**入口文件红线 >300 行**为准——「≤100 行」是为导出面 147 个的 application 设定的值，对 432 个导出的 contracts 不可达（实际 167 行，理由见 Decisions）。
- **page.tsx / story-panel.tsx**：按聚合拆分，门面/主文件落在 100~600 行区间（不制造微文件）；`page.tsx` 默认导出与 `story-panel.tsx` 的唯一具名导出 `StoryPanel` 不变；现有浏览器用例全绿。

## Scope / Non-goals

**范围**：上列 3 个文件；`packages/contracts/src/index.test.ts`（35.5 KB / 1011 行，警戒区，随聚合同步拆，用例数守恒）；contracts 的 `MODULE.md`、`entry-surface.txt`、`src/entry-contract.test.ts`（复用 [`scripts/entry-export-surface.ts`](../../../../scripts/entry-export-surface.ts)）；UI 拆分产出的新组件/模块文件；`repo-map.json` 重生成；`docs/doc-governance/code-baseline.json` 下调。

**非目标**：不改任何导出符号、类型形状或运行时行为；不动 Prisma schema/migration；不动 `packages/transport-http`（桶文件群最后一员，另开编号）；不动 `board-view.tsx`、`product-fixtures.tsx`（警戒区非红线）；不接入浏览器侧覆盖率口径、不新增浏览器用例（覆盖缺口记 Follow-ups）；不引入 eslint/prettier/knip（提案阶段②）。

## 对象与顺序依据（2026-09-14 门禁实测）

| 顺序 | 对象 | 大小 / 行数 | 形态与护栏 |
|---|---|---|---|
| 1 | `packages/contracts/src/index.ts`（+同名测试） | 89.0 KB / 2466 行 | 桶 + 单体混合（2 处 `export *` + 296 处 export 语句，含公开 DTO）；单元覆盖 100%（G05 评分表 V=10）；消费面 56 个非测试源文件，靠导出面零 diff 守护 |
| 2 | `apps/web/src/app/page.tsx` | 62.2 KB / 1680 行 | 单体路由页（唯一默认导出 `Home`）；V 未测，浏览器 5 spec 实际触达 |
| 3 | `apps/web/src/components/cosmos/story-panel.tsx` | 92.4 KB / 1902 行 | 单体组件（唯一具名导出 `StoryPanel`，内含多个子组件）；V 未测，浏览器 spec 覆盖打开/保存 Revision/归并/证据/时间线 |

风险递增排序：contracts（护栏最全）→ page → story-panel（体量最大）。contracts 走完整三步（桶文件化 → 测试拆 → 聚合拆）；两个 UI 文件桶文件步骤不适用、跳过，测试护栏 = 现有浏览器用例（覆盖清单见 `walkthrough.md` 立项节）。

## Current State

**进行中**（2026-09-14 开工）。worktree `.worktree/g06-redline-code` + 分支 `refactor/g06-redline-code` 已基于 `master` `ebb9ddb` 建立（维护者批复「批准开工」，并授权每切片提交）。**切片 0–3 完成**：contracts 已离开红线——`export *` 清零、入口从 1499 行拆成 **167 行纯门面 + 11 个域模块（38~298 行）**，导出面逐字节零 diff（432），`index.test.ts` 按域拆为 6 个测试文件（用例数守恒）。每切片门禁：typecheck 0 / unit 81 文件·515 用例 / property 4 / e2e 4 / 浏览器 17 / build:packages 0 / madge 0 环。

**提交状态**：切片 0–2 已提交（`4444cf0`/`28ef4e0`/`7305a8e`），任务文档已提交（`86df8aa`）；切片 3 与其后的记录待提交。

## Decisions and Deviations

- 维护者 2026-09-14 指令为一个 G06 治 3 个超红线文件，偏离提案 §4.7 SOP「单 Task 只治一个文件（或一个包的桶文件群）」（3 个对象跨 `packages/contracts` 与 `apps/web` 两处）；按指令执行，以「每对象独立切片、独立 commit、可单独 revert」控制半径。
- **入口行数验收下调（切片 3）**：提案对 storage-prisma / application 设定的「`index.ts` ≤100 行」对本对象不可达——contracts 导出面 432 个（application 147 的 3 倍），显式门面的下限约为「名字密排 100+ 行 + 13 个导出块包装」≈130 行以上，实际 167 行。改以提案 §4.1 的入口文件红线（>300 行）为验收，理由与算式见 `walkthrough.md` 切片 3。
- **模块划分口径（切片 3）**：11 个域模块按「切片 2 的测试文件 + 既有 per-domain 测试文件」对齐；`revisionDetail`→`entry-relation`（extend 自 `entryRevisionSnapshotSchema`）、`ingestResult`→`source`、Saved View→`user-organization`、事件/SSE→`platform`；run 状态族移入 `run-control` 专为消环（否则 source ↔ run-control 互指）。模块依赖单向、madge 0 环。
- UI 验收口径按推荐默认执行（立项提问未获批复，可在任意 UI 切片开工前推翻）：现有浏览器用例全绿 + 导出面不变 + typecheck/lint/build。切片 0 复核后确认 5 个 spec 已覆盖 StoryPanel 全部交互面（含资产列表、子类型下拉、拆分选择），残余缺口仅为纯展示格式化与四张标签映射表（无断言），按「同值搬运」处理并在切片 5 复核。

## Implementation Walkthrough

| # | 切片 | 验收（≤3 条） | 状态 |
|---|---|---|---|
| 0 | 前置：worktree + 三对象基线（大小/行数/contracts 导出面快照与常驻契约测试/三配置测试/浏览器用例/build 字节） | 三配置全绿；导出面快照与契约测试入库 | done（2026-09-14；typecheck 0 / unit 515 / property 3·4 / e2e 4·4 / 浏览器 17 / build 0 / madge 0；导出面 432、快照与契约测试入库） |
| 1 | contracts 桶文件化：`export *` 改显式具名导出 + `MODULE.md`（实现零改动） | 导出面零 diff；三配置全绿 | done（2026-09-14；2 处 `export *` → 136 个显式名，导出面逐字节零 diff 仍 432，`MODULE.md` 2.4 KB，madge 仍 0） |
| 2 | contracts 测试按行为拆：`index.test.ts`（1011 行）按聚合拆为同级文件 | 单文件 ≤400 行；用例数守恒；三配置全绿 | done（2026-09-14；6 个域文件 39~385 行，contracts 64 用例守恒、全仓 81 文件/515 用例，用例数不变） |
| 3 | contracts 单体按聚合拆：schema/类型移入聚合模块，`index.ts` 成纯门面 | 导出面零 diff；入口满足红线（≤300 行）；madge 保持 0 | done（2026-09-14；297 声明 → 11 个域模块 38~298 行，入口 **167 行**，导出面逐字节零 diff 仍 432，madge 保持 0，入口读取量 14,602 → 2,824 token） |
| 3b | contracts `MODULE.md` 回写为 11 模块地图（原为「尚未拆出」的过渡版） | 模块职责/token/依赖方向与代码一致 | done（2026-09-14） |
| 4 | `page.tsx` 按聚合拆：页面 section 抽组件、helper 模块化 | 默认导出不变；门面 100~600 行；浏览器用例全绿 | todo |
| 5 | `story-panel.tsx` 按聚合拆：子组件模块化 + `StoryPanel` 门面 | `StoryPanel` 唯一具名导出不变；门面 100~600 行；浏览器用例全绿 | todo |
| 6 | 收口：repo-map 重生成、code-baseline 下调（3 条红线条目移除；顺带移除已回健康区的 7 条登记，仅动基线登记不动文件）、读取量指标、本 README 与索引回写 | 基线只减不增；`docs:check` 0 失败 | todo |

## Verification

- contracts 切片（1–3）：`bun run typecheck` → vitest 三配置（unit/property/e2e）→ `bun run build:packages` → 导出面 diff（`scripts/entry-export-surface.ts` + `entry-surface.txt` + 常驻契约测试）→ madge 循环依赖（既有环不新增）。
- UI 切片（4–5）：`bun run typecheck:apps` → `bun run lint:web` → `bun run build:web` → `bun run test:browser`（Playwright，5 spec，含移动端与离线场景）。
- 行为等价底线：现有测试全绿 + 入口契约测试（contracts）+ 导出/路由签名不变。每切片独立 commit，可单独 revert。
- 全部验证在 G06 worktree 内执行；`docs:check` 在 worktree 内跑（仓库规则：主工作区跑会因文件差异出假绿灯）。

## Follow-ups

- `packages/transport-http`（桶文件群最后一员，P=2.49）另开编号。
- UI 对象浏览器侧覆盖率口径接入（提案 §4.2 可选演进）；StoryPanel 残余缺口（纯展示格式化与标签映射表）的断言补齐。
- 评分逻辑（D 口径、V 数据源、churn 统计）并入 `scripts/size-governance.py`（承接 G05 同条）。
