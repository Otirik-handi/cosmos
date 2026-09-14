# 治理任务 G05:代码治理第三对象——`packages/application` 入口与实现拆分

## User Request / Topic

维护者 2026-09-14:G04 验收完毕后推进 G05。选型依据 [`docs/proposals/code-size-governance-v1.md`](../../../../docs/proposals/code-size-governance-v1.md)(accepted)§4.2 评分模型、§4.3 拆分决策树、§4.4 拆分模式库;方向承接 G03 Follow-ups 的首条「桶文件群治理(`packages/application`、`packages/contracts`、`packages/transport-http` 的 index.ts)」。

## Goal

`packages/application/src/index.ts`(67.32 KB / 2048 行 / 147 个解析后导出,其中 7 处 `export *`)与其同目录测试 `index.test.ts`(21.16 KB / 610 行)按提案固定顺序治理:**先桶文件模块地图化与显式导出(不动实现)→ 测试按行为拆 → 单体按聚合拆**。完成后 `index.ts` 只做导出与模块地图(≤100 行),`packages/application/MODULE.md` 成为定位入口,包入口导出符号零 diff。

## Scope / Non-goals

**范围**:`packages/application/src/index.ts`(红线:2048 行 / 67.32 KB);`packages/application/src/index.test.ts`(610 行 / 21.16 KB,警戒区,按拆分后的聚合同步调整);新增 `packages/application/MODULE.md`(≤3 KB);新增入口导出面快照 `packages/application/entry-surface.txt` 与契约测试 `src/entry-contract.test.ts`;`scripts/entry-export-surface.ts`(导出面生成器);`repo-map.json` 重生成。

**非目标**:不改任何导出符号、类型形状或运行时行为;不动 Prisma schema/migration;不动其它包与 app(含 `contracts`/`transport-http` 的入口,属同一桶文件群但另开编号);不引入 eslint/prettier/knip(提案阶段②);不为达标制造微文件(产物 100~600 行为佳)。

## 评分与选型依据(2026-09-14 实测重排)

V 口径:`V = round(对象单元覆盖率 lines% / 10)`,数据源为本次 `bunx vitest run --coverage`(v8,72 文件 / 513 用例全绿)。**本次 V 与 G03 当时的数值逐项一致**(application 80.72%、contracts 100%、transport-http 47.51%),说明 V 侧口径稳定、可直接比较。

| # | 对象(文件 + 同名测试) | 行 / 大小 | T | L | H(30 天) | D | V | R | N | P |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `packages/application/src/index.ts` | 2659 / 88.0 KB | 3.00 | 3.80 | 9.60(24) | 10.00(44) | 8 | 2 | 26.40 | **2.64** |
| 2 | `packages/transport-http/src/index.ts` | 2235 / 80.0 KB | 2.74 | 3.19 | 10.00(29) | 1.50(6) | 5 | 2 | 17.43 | 2.49 |
| 3 | `packages/contracts/src/index.ts` | 2468 / 89.1 KB | 3.05 | 3.53 | 10.00(33) | 10.00(61) | 10 | 4 | 26.58 | 1.90 |
| 4 | `packages/domain/src/index.ts` | 714 / 19.6 KB | 0.68 | 1.02 | 3.60(9) | 4.00(16) | 9 | 2 | 9.30 | 0.85 |
| 5 | `packages/application/src/workflow-host-runtime.ts` | 1980 / 71.4 KB | 2.44 | 2.83 | 1.20(3) | 0.25(1) | 8 | 0 | 6.72 | 0.84 |
| 6 | `packages/application/src/media-acquisition.ts` | 1498 / 52.9 KB | 1.82 | 2.14 | 2.80(7) | 0.50(2) | 9 | 0 | 7.26 | 0.81 |
| 7 | `packages/storage-prisma/src/workflow-backend.ts` | 897 / 31.4 KB | 1.07 | 1.28 | 1.20(3) | 1.25(5) | 8 | 1 | 4.80 | 0.53 |
| 8 | `packages/worker-admin/src/index.ts` | 1048 / 38.0 KB | 1.30 | 1.50 | 0.80(2) | 0.50(2) | 8 | 2 | 4.10 | 0.41 |
| 9 | `plugins/collectors/src/index.ts` | 819 / 25.4 KB | 0.87 | 1.17 | 0.40(1) | 0.25(1) | 6 | 2 | 2.69 | 0.34 |
| 10 | `packages/logging/src/index.ts` | 674 / 19.4 KB | 0.66 | 0.96 | 0.00(0) | 1.50(6) | 9 | 2 | 3.12 | 0.28 |
| 11 | `plugins/rss/src/index.ts` | 558 / 18.2 KB | 0.62 | 0.80 | 0.80(2) | 0.25(1) | 7 | 2 | 2.47 | 0.27 |

`N = T + L + H + D`;`P = N / max(V + R, 1)`;T = token/7.5k(上限 10)、L = 行/700(上限 10)、H = 近 30 天提交/2.5(上限 10)、D = 被 import 分(上限 10,口径见下)。对象字节/行数为文件 + 同名 `.test.ts` 之和。

**V 未测对象**(提案 §4.2:主要执行层不经单元数据源,记未测、不代入 `P`,按 `N` 排序):

| 对象 | 行 / 大小 | T | L | H(30 天) | D | N |
|---|---|---|---|---|---|---|
| `apps/web/src/app/page.tsx` | 1681 / 62.2 KB | 2.20 | 2.40 | 9.20(23) | 0.00(0) | 13.80 |
| `apps/web/src/components/cosmos/story-panel.tsx` | 1903 / 92.4 KB | 3.21 | 2.72 | 5.60(14) | 1.00(4) | 12.53 |
| `apps/web/src/component-lab/product-fixtures.tsx` | 808 / 27.6 KB | 0.96 | 1.15 | 8.00(20) | 0.25(1) | 10.36 |
| `apps/web/src/components/cosmos/board-view.tsx` | 806 / 30.6 KB | 1.08 | 1.15 | 0.40(1) | 1.00(4) | 3.63 |

另:`apps/worker/src/workflow-ingest.test.ts`(865 行 / 37.4 KB)是纯测试对象,`V` 不适用,按测试按行为拆处理(提案 §4.4)。

## D 口径问题(影响榜首,需维护者裁定)

本次 `D` 采用**可复现口径**:引用该包/文件的**非测试源文件数 ÷ 4**(上限 10),命令为 `rg -l "from \"@cosmos/<pkg>\"" --glob '!node_modules' -g '*.ts' -g '!*.test.ts' | wc -l`。实测 application 44、contracts 61、transport-http 6、domain 16、logging 6。

G03 表格里的 D 值(application 8、contracts 5、transport-http 1、media-acquisition 4、story-panel 2)在本仓库**无法复现**——其评分脚本是一次性脚本(`.agent/tmp/score-governance.py`,未入库),当时的计数范围没有记录。两种口径会**翻转榜首**:

- 本次口径:application 2.64 > transport-http 2.49;
- G03 口径(D 更小):transport-http 2.31 > application 1.84。

**维护者 2026-09-14 已批准本次口径与首位对象**(`packages/application`),并批准 worktree/分支创建;D 口径与评分逻辑并入 `scripts/size-governance.py` 仍列为后续项(与 G03 Follow-ups 同一条:让排名可复现,不依赖临时脚本)。两者形态差异在于:`application` 是**桶 + 单体混合**(7 处 `export *` + 35 个自有导出值声明),要跑完整三步;`transport-http` 是**纯单体**(0 处 `export *`、4 个导出、1269 行),跳过桶文件步骤——它是本批次的下一候选。

## Current State

**实施完成,待维护者验收**(2026-09-14)。对象 `packages/application` 已获批准。worktree `.worktree/g05-application` 与分支 `refactor/g05-application`(5 个提交)。**切片 0–4 全部完成**:切片 0(`84ee6b5`)基线 + 入口导出面快照(147 个)+ 常驻契约测试 + madge 基线(3 个既有环);切片 1(`b729c3c`)7 处 `export *` 换显式具名导出 + `MODULE.md`;切片 2(`ad624bc`)`index.test.ts` 按行为拆为 3 个测试文件 + 共享 helper;切片 3(`68efdf9`)60 个声明按聚合移入 11 个模块,**入口 2149 → 98 行**,内部 import 改指聚合模块后 **madge 循环依赖 3 → 0**;切片 4(`d5b7b4a` + `cd2de66`)MODULE.md 回写、repo-map 重生成、读取量指标、`docs/spec/` 旧行锚点同批修正。

每切片验证:导出面逐字节零 diff(仍 147)、全仓 typecheck 0、unit 75 文件/514 用例、property 3/4、e2e 4/4、build:packages 0、worktree 内 `docs:check` 0 失败。读取量:入口 17,234 → 1,243 token(−93%),改域错误类型 22,525 → 2,707(−88%),改采集入队 22,525 → 5,620(−75%)。代价:`packages/application/dist` 735 → 953 KB(+30%,模块数量带来的文件固定开销)。细节见 `walkthrough.md`(在分支上,合并后补齐)。

**记录位置**(沿用 G03 的裁定):本 README 落 master,`walkthrough.md` 随切片提交在分支上。

## Decisions and Deviations

- 沿用代码治理 SOP(提案 §4.7):进入独立 worktree,单 Task 只治一个包;拆分顺序固定为桶文件 → 测试 → 单体。
- `application` 的入口不是纯桶文件:`index.ts` 自有的 2048 行里含约 30 个域错误类、`CosmosRepository`(端口接口,约 530 行)、连接器端口与结果类型,属「桶 + 单体」混合,三步都需要执行,不能只做模块地图化。

## Implementation Walkthrough

| # | 切片 | 验收(≤3 条) | 状态 |
|---|---|---|---|
| 0 | 前置:worktree + 基线(大小/行数/导出清单/三配置测试/构建产物)+ 包入口契约测试(冻结当前导出符号集)+ madge 循环依赖基线 | 三配置全绿;入口契约测试与导出清单快照入库 | done(2026-09-14,`84ee6b5`;导出面 147 个,unit 73/514、property 3/4、e2e 4/4、build 0、typecheck 0) |
| 1 | 桶文件步骤:新增 `packages/application/MODULE.md`(≤3 KB);7 处 `export *` 改为显式具名导出(不动实现) | 导出签名零 diff;三配置全绿 | done(2026-09-14,`b729c3c`;导出面逐字节零 diff 仍 147 个;MODULE.md 2,664 B;madge 仍 3 个既有环、未新增) |
| 2 | 测试按行为拆:`index.test.ts`(610 行)按 describe/行为拆为同级文件,与切片 3 的聚合对齐 | 单文件 ≤400 行(不制造微文件);三配置全绿 | done(2026-09-14,`ad624bc`;3 个测试文件 24/329/149 行 + `test-support.ts`;用例数守恒 11 → 1+8+2) |
| 3 | 单体按聚合拆:错误类 / 仓储端口(`CosmosRepository`)/ 连接器端口 / 结果与日志类型分别移出,`index.ts` 只留门面与模块地图(≤100 行) | 导出签名零 diff;`index.ts` ≤100 行;三配置全绿 | done(2026-09-14,`68efdf9`;60 个声明 → 11 个模块;入口 **98 行**;madge **0 环**,原 3 个全部消失) |
| 4 | 收口:MODULE.md 回写、`repo-map.json` 重生成、读取量指标 | 验收三件套全过;典型任务读取量下降写入 walkthrough | done(2026-09-14,`d5b7b4a` + `cd2de66`;MODULE.md 2,916 B;入口读取量 −93%;spec 旧行锚点同批修正) |

## Verification

每切片:`bun run typecheck` → vitest 三配置(unit/property/e2e)→ `bun run build:packages` → 导出签名 diff(`bun run scripts/entry-export-surface.ts packages/application/src/index.ts` 与 `packages/application/entry-surface.txt` 比对,加常驻契约测试)→ madge 循环依赖检查(基线 3 个既有环,按「不新增」守卫)。行为等价底线三条同时满足:现有测试全绿 + 公共入口契约测试通过 + 导出签名零 diff。回滚:每切片独立 commit,可单独 revert。

**worktree 环境前置**(2026-09-14 实测,未写进仓库流程文档前先记此处):新建 worktree 在 `bun install` 之后必须再跑 `bun run db:generate`,否则 typecheck 会报隐式 any、测试与构建大面积失败;本机跑 e2e 还需把真实 `bun.exe` 所在目录加进 PATH(`scripts/e2e/helpers.ts` 的 `spawnSync("bun")` 无法执行 npm 的 Git Bash 包装脚本)。

## Follow-ups

- 桶文件群其余两个入口(`contracts` 296 个导出、含公开 DTO;`transport-http` 纯单体)另开编号。
- 把评分逻辑(D 口径、V 数据源、churn 统计)并入 `scripts/size-governance.py`(提案 §4.7 阶段①与 G03 Follow-ups 同条),使排名可复现。
- 组件分解与 V 未测对象的覆盖口径(提案 §4.2「可选演进」:接入浏览器侧覆盖率后回填 V)。
