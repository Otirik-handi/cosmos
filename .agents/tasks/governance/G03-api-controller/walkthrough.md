# G03 Walkthrough——app.controller.ts 按资源拆分

## 2026-09-13 对象选定(评分重排)

- 依据:提案 §4.2 `P = (T + L + H + D) / (V + R)`;候选集口径与完整排名表见 README「评分与选型依据」。
- 候选集:当前触犯红线的 19 个 code/tests 对象(源码/测试 >50 KB 或 >800 行;入口 >300 行)。
- 结果:`apps/api/src/app.controller.ts` 在 V=1 / V=5 / V=10 三种假设下均居首,选为 G03 对象。
- 偏差记录:
  - V(测试覆盖分)数据源 `@vitest/coverage-v8` 未安装,本轮固定 V 做敏感性分析,未实测;真实 V 待切片 1 安装后回填。
  - 提案 R 口径未把「HTTP 路由表」算作合同风险;按 +1 试算 P 由 4.15 降至 3.46,仍第一,结论不变。
  - 评分脚本 `.agent/tmp/score-governance.py` 为临时脚本未入库;README Follow-ups 记「评分逻辑并入 `scripts/size-governance.py`」。

## 2026-09-13 切片 1(前置基线)

### 环境

- worktree `.worktree/g03-api-controller` + 分支 `refactor/g03-api-controller`,自 `origin/master` `4a29060`(维护者 2026-09-13 批准;`master` 与 `origin/master` 同 SHA,无需 fast-forward)。
- `bun install` → 1599 packages / 13.01s;`bun run db:generate` → Prisma Client 6.19.3。
- 同期清理 G02 worktree:Git 在 Windows 下无法删除嵌套 `node_modules` 深目录,`git worktree remove` 后残留 3775 个空目录骨架(0 个文件,无数据丢失);启用 `core.longpaths` 后用 `rmdir /s /q` 在已确认的目标目录内清除。`refactor/g02-storage-prisma` 分支保留未删。

### 路由表快照(零变化护栏)

- 工具 `.agent/tmp/route-snapshot.py`(临时,未入库):解析 `@Controller(prefix)` 与 `@Get/@Post/@Put/@Patch/@Delete/@Sse(...)` 及紧随其后的 handler 方法名,输出稳定排序文本并附 sha256。
- 基线 **114 条路由**:POST 60 / GET 45 / PATCH 8 / SSE 1;类内方法 118 = 114 个路由 handler + 4 个 private helper。
- 快照文件 `route-snapshot-app.controller.txt`,sha256 `8d13402622819a9b413bc60939e7c0194cf924ebfa62171e699b001a1b435193`。
- 口径更正:README 初版记「113 条路由、115 个方法」,系漏计 SSE 路由、且行首正则漏计部分方法;以本快照 114 / 118 为准。

### 基线指标

| 项 | 值 |
|---|---|
| `app.controller.ts` | 69.8 KB / 2093 行 |
| `app.controller.test.ts` | 56.7 KB / 1519 行 |
| `app.controller.run-control.test.ts` | 4.7 KB / 132 行 |
| `app.controller.connection.test.ts` | 2.2 KB / 62 行 |
| `source-lifecycle.test.ts` | 4.5 KB / 124 行 |
| 对象合计 | 138.0 KB / 3930 行 |
| 被 import | 5 个文件(`app.module.ts` + 4 个测试) |

### 验证(切片 1 基线)

**unit(三跑才定性)**:`bunx vitest run --maxWorkers=2`

| 跑次 | 命令 | 结果 |
|---|---|---|
| 1 | 默认超时 | 1 failed / 67 passed 文件,509/510 测试(`story-split.test.ts` 5000ms 超时) |
| 2 | 默认超时 | 2 failed / 66 passed 文件,508/510 测试(`store-completion-delivery.test.ts` 5000ms 超时后 temp sqlite `EBUSY`;`workflow-backend.test.ts` 5000ms 超时) |
| — | 单跑 `story-split.test.ts` | 4/4 绿(单条 2.8~3.3s) |
| 3 | `--testTimeout=30000` | **68 文件 / 510 测试全绿**,264.94s |

- **定性**:两次默认超时的失败都是 `Test timed out in 5000ms`,失败对象每次不同,且失败用例单跑均绿;**提高超时后全绿**——即非真实失败,而是默认 5000ms 超时与 Prisma 测试单条耗时(3.0~5.1s,个别 6.9s)余量过窄,在 `--maxWorkers=2` 争用下偶发擦线。与本机负载相关(两次全量 494s / 515s;G02 记录同口径为 256s)。
- **本切片结论**:基线判定以第 3 跑为准(全绿);默认超时下的红为环境抖动。后续切片同样建议带 `--testTimeout=30000` 跑 unit,避免把抖动当回归。
- 注意:`bunx vitest ... | tail` 会让管道退出码恒为 0,掩盖 vitest 的失败;报告结果要看输出末尾的统计行,不看退出码。

**typecheck**:`bun run typecheck` 全绿(packages 全部 + apps/api、apps/worker、apps/web)。

**property**:`bun run test:property` → 3 文件 / 4 测试绿,4.98s。

**e2e**:`BUN_BINARY=C:\Users\Otirik\AppData\Roaming\npm\node_modules\bun\bin\bun.exe bun run test:e2e` → `build:packages` + `build:api` + `build:worker` 全部通过;e2e 4 文件 / 4 测试绿,16.77s。注意真实 `bun.exe` 不在 `~/.bun/bin`,而在 npm 全局包内(Windows 下 `spawnSync` 无法解析 npm 垫片,故必须设 `BUN_BINARY`)。

**体积门禁**:`python scripts/size-governance.py -c code tests --check --baseline docs/doc-governance/code-baseline.json` → PASS(扫描 221 文件、基线 20 条、豁免 1 条)。

**路由快照可复现**:同一脚本复跑 sha256 一致(`8d134026…435193`)。

### 前置改动(维护者 2026-09-13 批准)

- `vitest.config.ts`:补 `testTimeout: 60_000`、`hookTimeout: 120_000`,并加 `coverage` 块(v8、include 源码、exclude 测试)。unit 配置原先缺这两个超时、走 vitest 默认 5000ms,而 `vitest.property.config.ts` / `vitest.e2e.config.ts` 早已是 60_000/120_000——本次是把 unit 对齐仓库既有约定,不是新口径。
- devDependency 新增 `@vitest/coverage-v8@3.2.7`(覆盖分 V 的数据源,提案 §4.7 阶段③)。偏差:首次 `bun add -d @vitest/coverage-v8` 装到 5.0.0,bun 报 peer 警告(仓库 vitest 为 3.2.7),会运行时不兼容;改为锁定同版本 `@3.2.7`。
- **Windows/bun 注意**:任何 `bun add` 都会重装 `node_modules` 并冲掉 Prisma 生成产物,随后所有 Prisma 测试报 `Cannot find module '.prisma/client/default'`(本次覆盖率首跑因此 26 文件失败)。改依赖后必须重跑 `bun run db:generate`,再用单个 Prisma 测试冒烟确认。

### 覆盖分 V 回填(切片 1)

- 命令:`bunx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary --maxWorkers=2` → 68 文件 / 510 测试全绿,265.12s;整体 lines **60.66%**、branches 75.26%、functions 73.93%(报告 131 文件)。
- 偏差:首跑把 `coverage.include` 写成 `*.ts`,`.tsx` 全被排除,报告只有 100 文件、4 个 web 对象缺失,整体 lines 虚高到 76.58%;改为 `**/*.{ts,tsx}` 后重跑,分母 24960 → 33157。
- V 口径:`V = round(源文件单元覆盖率 lines% / 10)`,上限 10。实测:`contracts/index.ts` 100%→10;`workflow-ingest.ts` 93.37%→9;`application/index.ts` 80.72%→8;`app.controller.ts` 74.55%→**7**;`transport-http/index.ts` 47.51%→5;`product-fixtures.tsx` 23.21%→2;`board-view.tsx` 3.06%→0;`story-panel.tsx` 1.97%→0;`page.tsx` 0.00%→0。
- **两个口径问题(已写入 README,待维护者裁定)**:
  1. UI 组件实际由 Playwright 浏览器用例覆盖(`e2e/browser/`、component-lab),单元覆盖率口径测不到,报 0 会让「未测」的假信号把 `page.tsx`/`story-panel.tsx`/`board-view.tsx` 顶到榜首。
  2. `V + R = 0` 时 `P = N/(V+R)` 除零;本轮按 `V+R` 下限 1 计算并标注退化。提案只说「低分触发先补测试前置,不降优先级」,未定义数值口径。
- 结论:V 可测对象中 `app.controller.ts` 仍居首(P=2.96);若维护者按「未测即最优先」判定 UI 对象,首选应改为 `page.tsx`。
- 工具:`.agent/tmp/v-score.py`(读 coverage-summary.json,输出 V 与 P),临时脚本未入库;`.agent/tmp/score-governance.py` 出 N 值。建议按 README Follow-ups 并入 `scripts/size-governance.py`。
