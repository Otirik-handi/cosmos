# 治理任务 G03:代码治理第二对象——app.controller.ts 按资源拆分

## User Request / Topic

`docs/proposals/code-size-governance-v1.md`(accepted)§4.2 评分模型与 §4.4 拆分模式库。维护者 2026-09-13 要求按模型重排候选后决定第二治理对象;重排结果见本 README「评分与选型依据」。

## Goal

`apps/api/src/app.controller.ts`(69.8 KB / 2093 行,单个 `@Controller()` 类含 114 条路由、118 个方法)按资源拆为多个实现文件——**方案 B:继承链拆文件 + 门面**,类仍是单个 `@Controller()`,**HTTP 路由表零变化**。对象含同族 4 个测试文件,合计 138.0 KB / 3930 行。

## Scope / Non-goals

**范围**:`apps/api/src/app.controller.ts`;测试 `app.controller.test.ts`(56.7 KB / 1519 行)、`app.controller.run-control.test.ts`、`app.controller.connection.test.ts`、`source-lifecycle.test.ts`;`app.module.ts` 的 controllers 注册;新增 `apps/api/MODULE.md`;按需引入 `@vitest/coverage-v8`。

**非目标**:不改任何路由路径、请求/响应形状与状态码;不重写 `docs/spec/interfaces/0002-product-api-http.md` 的合同(只做一致性核对);不动 Prisma schema/migration;不改其他 app 或 package;不引入 eslint/prettier/knip(属阶段②)。

## 评分与选型依据(2026-09-13 重排)

按提案 §4.2 `P = (T + L + H + D) / (V + R)` 对当前触犯红线的 19 个 code/tests 对象重排。候选集口径:源码/测试文件 >50 KB 或 >800 行,入口文件 >300 行;对象 = 文件 + 同目录同名 `.test.ts`。

### 阶段一:初排(V 未实测,敏感性分析)

| # | 对象 | KB | 行 | T | L | H(30天提交) | D(被 import) | R | P(V=5) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `apps/api/src/app.controller.ts`(+test) | 126.5 | 3612 | 4.33 | 5.16 | 10.00(39) | 1.25(5) | 0 | **4.15** |
| 2 | `apps/web/src/app/page.tsx` | 62.2 | 1680 | 2.20 | 2.40 | 9.20(23) | 0.00(0) | 0 | 2.76 |
| 3 | `packages/application/src/index.ts`(+test) | 88.0 | 2657 | 3.00 | 3.80 | 9.60(24) | 2.00(8) | 2 | 2.63 |
| 4 | `apps/web/src/components/cosmos/story-panel.tsx` | 92.4 | 1902 | 3.21 | 2.72 | 5.60(14) | 0.50(2) | 0 | 2.41 |
| 5 | `packages/transport-http/src/index.ts`(+test) | 80.0 | 2233 | 2.74 | 3.19 | 10.00(29) | 0.25(1) | 2 | 2.31 |
| 6 | `apps/web/src/component-lab/product-fixtures.tsx` | 27.6 | 807 | 0.96 | 1.15 | 8.00(20) | 0.25(1) | 0 | 2.07 |
| 7 | `packages/contracts/src/index.ts`(+test) | 89.1 | 2466 | 3.05 | 3.52 | 10.00(33) | 1.25(5) | 4 | 1.98 |
| 8 | `packages/application/src/media-acquisition.ts`(+test) | 52.9 | 1496 | 1.82 | 2.14 | 2.80(7) | 1.00(4) | 0 | 1.55 |

`app.controller.ts` 在 V=1 / V=5 / V=10 三种假设下均居首,据此初选为 G03 对象。

### 阶段二:V 回填后的终排(2026-09-13)

V 口径:`V = round(源文件单元覆盖率 lines% / 10)`,数据源为本分支 `bunx vitest run --coverage`(v8,131 文件)。

| # | 对象 | 行覆盖 | V | R | N | P | 备注 |
|---|---|---|---|---|---|---|---|
| 1 | `apps/web/src/app/page.tsx` | 0.00% | 0 | 0 | 13.80 | 13.80 | 退化(V+R=0,按下限 1) |
| 2 | `apps/web/src/components/cosmos/story-panel.tsx` | 1.97% | 0 | 0 | 12.03 | 12.03 | 退化 |
| 3 | `apps/web/src/component-lab/product-fixtures.tsx` | 23.21% | 2 | 0 | 10.36 | 5.18 | |
| 4 | `apps/web/src/components/cosmos/board-view.tsx` | 3.06% | 0 | 0 | 3.13 | 3.13 | 退化 |
| 5 | `apps/api/src/app.controller.ts` | 74.55% | 7 | 0 | 20.74 | 2.96 | V 可测对象中居首 |
| 6 | `packages/transport-http/src/index.ts` | 47.51% | 5 | 2 | 16.18 | 2.31 | |
| 7 | `packages/application/src/index.ts` | 80.72% | 8 | 2 | 18.40 | 1.84 | |
| 8 | `packages/contracts/src/index.ts` | 100.00% | 10 | 4 | 17.82 | 1.27 | |

### 模型口径问题(维护者 2026-09-13 已裁定)

1. **UI 对象的 V 测不出来,不能当 0 用。** `page.tsx` / `story-panel.tsx` / `board-view.tsx` 的单元覆盖率为 0,是因为它们是 React 组件、由 Playwright 浏览器用例覆盖(`e2e/browser/`、component-lab),而覆盖数据源只跑单元配置。把它们按 V=0 处理会让「未测」的假信号把它们顶到榜首。
2. **公式在 V+R=0 处除零。** 提案写「低分触发'先补测试'前置,不降优先级」,但 V 在分母——V=0 且 R=0 时 P 未定义。本轮按 `V+R` 下限 1 计算并标注退化。

**裁定**:维护者 2026-09-13 决定「继续治理 `app.controller.ts`」,即采用「V 可测对象中居首」的读法;上述两条转为提案维护项(需给 UI 接入浏览器侧覆盖率、或明确 UI 对象不参与 V 排序;公式需定义 V=0 的数值口径),不阻塞本 Task。

- 另一处口径偏差:提案 R 只计「包入口 / contracts 或 Prisma schema / 公开 DTO」,未把「HTTP 路由表」算作合同风险。`app.controller.ts` 的 114 条路由实际是公开接口;若按 +1 计,R=1、P=2.59,仍居 V 可测对象首位。
- 复现:`python .agent/tmp/score-governance.py`(N 值)+ `python .agent/tmp/v-score.py <coverage-summary.json>`(V 与 P),均为临时脚本未入库;建议按 Follow-ups 并入 `scripts/size-governance.py`。

## Current State

对象已定并获维护者确认(2026-09-13):`apps/api/src/app.controller.ts`。编号按序列顺延 G03。worktree `.worktree/g03-api-controller` 与分支 `refactor/g03-api-controller`(已 rebase 至 `a47aa20`)就绪;**切片 1 完成**:typecheck 绿、unit 68/510 绿、property 3/4 绿、e2e 4/4 绿、build 通过、体积门禁 PASS、路由表快照入库、coverage 已装并回填 V(细节见 `walkthrough.md`);**切片 1~5 全部完成**(2026-09-13),验收三件套对账:现有测试全绿(unit 72/513、property 4、e2e 4 真实启服务)+ 入口契约测试通过(`app.controller.route-table.test.ts` 冻结 114 条路由)+ 导出签名零 diff(`app.module.ts` 与 25 处实例化零改动且全量 typecheck 通过)。**待维护者验收后**决定分支合并与 worktree 清理(分支 `refactor/g03-api-controller` 目前只在本地,尚未推送)。

**记录位置(维护者 2026-09-13 裁定)**:README 与路由表快照落 master(本次提交);`walkthrough.md` 随切片提交到分支 `refactor/g03-api-controller`。故 master 上本目录暂无 walkthrough,分支上暂无 README,合并后补齐。

## Decisions and Deviations

- 对象含 **5 个测试文件**,不只同名的 1 个:`app.controller.run-control.test.ts`、`app.controller.connection.test.ts`、`source-lifecycle.test.ts` 也 import `AppController`,拆分时同步处理。
- 拆分顺序按提案固定序:本对象是单体而非桶文件,桶文件步骤跳过 → 测试按行为拆 → 实现按资源拆。
- 路由表零变化用「method + path + handler 清单快照 diff」看守,不靠人工核对。快照 `route-snapshot-app.controller.txt`(114 条,sha256 `8d13402622819a9b413bc60939e7c0194cf924ebfa62171e699b001a1b435193`)由 `.agent/tmp/route-snapshot.py` 生成;**切片 3+4 后护栏切换**:常驻护栏改为 `apps/api/src/app.controller.route-table.test.ts`——按 Nest 元数据枚举 `AppController` 并与该快照比对(顺序无关),e2e 之外对 114 条路由全量覆盖;静态脚本保留为基线生成工具(拆分后门面文件已无路由文本可解析)。
- 拆分方案选 **B(继承链拆文件)**,维护者 2026-09-13 裁定「先做 B」。前置实测 Nest `MetadataScanner` 走原型链可扫到父类路由,e2e 真实启动服务验证继承构造函数与 `@Inject` 元数据在依赖注入下正常解析;代价是仍为单类,收益是 `app.module.ts` 与 25 处 `new AppController(...)` 零改动。

## Implementation Walkthrough

| # | 切片 | 验收(≤3 条/片) | 状态 |
|---|---|---|---|
| 1 | 前置:worktree + 依赖 + 基线 + 路由表快照(114 条 method+path+handler)+ 安装 coverage 回填 V | 快照入库;三配置全绿;门禁过 | done(2026-09-13;unit 需带 `--testTimeout=30000` 才稳定全绿,见 walkthrough 定性;coverage 已装并回填 V,暴露两个口径问题待裁定) |
| 2 | 测试按行为拆:`app.controller.test.ts`(1519 行 / 13 describe)按资源拆为 4 个**同级**文件(runs / sources / story-domain / user-organization) | 单文件 ≤800 行且 ≤50 KB;三配置全绿 | done(2026-09-13;42 用例与三配置全绿;实际未建 `app.controller/` 目录,理由见 walkthrough 偏差) |
| 3+4 | 实现按资源拆(方案 B,继承链):`AppControllerBase` → `sources` → `runs` → `content` → `organization` → 门面;12 个模块级 helper + schema 抽到 `internals.ts` | 路由表 diff 空;单文件落回红线内;三配置全绿 | done(2026-09-13;合并为一次完成,见 walkthrough 偏差 4;最大分册 577 行/18.5 KB,门面 8 行) |
| 5 | 收口:`apps/api/MODULE.md`(≤3 KB)+ repo-map 回写 + 指标回写 | 验收三件套全过;walkthrough 回写 | done(2026-09-13;MODULE.md 3054 B;repo-map 红线清零;读取量 32,454 → 约 8.6k token,降幅约 73%) |

## Verification

每切片:`bun run typecheck`(或 apps/api 单包)→ vitest 三配置 → `bun run build:api` → 路由表快照 diff → e2e(`scripts/e2e` + `e2e/browser`)。回滚:每切片独立 commit,可单独 revert。

## Follow-ups

桶文件群治理(`packages/application`、`packages/contracts`、`packages/transport-http` 的 index.ts,提案 §4.4);组件分解(`page.tsx`、`story-panel.tsx`);代码大小门禁接入 CI(当前只接线文档门禁);行数/入口/函数/复杂度四条阈值待阶段② eslint 落地;把本 README 的评分逻辑并入 `scripts/size-governance.py`(提案 §4.7 阶段①已列「churn 统计」但未实现),使排名可复现而不依赖临时脚本。
