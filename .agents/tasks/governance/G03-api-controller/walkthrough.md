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

## 2026-09-13 切片 2(测试按行为拆)

### 拆分

`apps/api/src/app.controller.test.ts`(56.7 KB / 1519 行 / 13 个 describe / 42 用例)→ 4 个同级文件,按资源分组:

| 文件 | 含 describe | 原行数 | 输出 |
|---|---|---|---|
| `app.controller.runs.test.ts` | workflow conflicts、media cleanup(ADR-0015)、SSE、WorkflowRun projection | 227 | 8.3 KB |
| `app.controller.sources.test.ts` | source run gating、source media policy projection、source probe、source config probes | 349 | 12.9 KB |
| `app.controller.story-domain.test.ts` | story orchestration、topic orchestration、entity orchestration、entry↔story evidence | 540 | 19.3 KB |
| `app.controller.user-organization.test.ts` | user organization orchestration | 362 | 17.0 KB |

- 方式:按 describe 块**逐字节移动**,不重写用例;每文件只保留自己用到的导入(`noUnusedLocals` 未开,但按干净代码裁剪)。
- **零丢失校验**(`.agent/tmp/split-controller-tests.py`):原文件非头部、非空行的**行多重集** vs 新文件正文行多重集 → 缺失 0、多余 0。
- **偏差**:README 切片 2 原写「拆到 `app.controller/` 下」,实际改为**同级平铺**文件——与既有 `app.controller.run-control.test.ts`、`app.controller.connection.test.ts` 一致,且避免改动 `./app.controller.js` 的相对导入路径。

### 偏差与修复(首版脚本缺陷)

首版脚本的导入解析同时从头部抓到了 `AppController` 又无条件追加一次,4 个文件都出现重复导入。**单跑 4 文件仍 42 用例全绿**(esbuild 不做类型检查),是 `bun run --cwd apps/api typecheck` 报 `TS2300: Duplicate identifier 'AppController'` 才暴露。处置:`git checkout HEAD --` 还原原文件、删掉误产物、修脚本(导入解析跳过 `./app.controller.js`,由追加逻辑统一负责)后重跑。

### 验证

- 4 个新文件:`42 tests passed`(与拆分前用例数一致)。
- `bun run --cwd apps/api typecheck`:通过(无 error)。
- 路由表快照复核:sha256 仍为 `8d134026…435193`,零变化。
- 全量 unit:`71 passed (71)` 文件 / `510 passed (510)` 测试,269.46s(文件数 68→71 为拆分结果,用例总数不变)。
- property:3 文件 / 4 测试绿,4.91s。e2e:4 文件 / 4 测试绿,32.25s(`BUN_BINARY` 指向真实 bun.exe)。
- 体积门禁:`PASS`(扫描 224 文件、基线 20 条、豁免 1 条)。4 个新文件均 8.3~19.8 KB、远低于 800 行/50 KB 红线。

## 2026-09-13 切片 3+4(实现按资源拆,方案 B:继承链)

### 前置实测:NestJS 能否路由扫描继承方法

方案 B 的全部前提。临时 spike 定义三层继承的 `@Controller` 类(leaf extends middle extends base),用 `MetadataScanner.getAllMethodNames` 枚举——**三级路由全被扫到**,顺序为子类→父类。结论:Nest 的扫描器走原型链,方案 B 成立。因此路由表守卫测试采用**顺序无关的集合比对**(拆分后枚举顺序必然改变)。

### 新增常驻护栏:路由表零变化

- `apps/api/src/app.controller.route-table.test.ts`:按 Nest 自身的扫描方式(`MetadataScanner` + `PATH/METHOD/SSE` 元数据)枚举 `AppController` 注册的路由,与入库快照 `route-snapshot-app.controller.txt` 比对 —— ① method+path 集合一致 ② handler 名集合一致 ③ 无重复 method+path。
- **护栏口径变更**:静态脚本 `route-snapshot.py` 从单文件文本解析路由;拆分后 `app.controller.ts` 只剩门面,静态脚本不再适用每次切片复核。改为**元数据测试作为常驻护栏**(读同一份快照作期望值),静态脚本保留为基线生成工具。这条变更同时是 e2e 之外对 114 条路由的全量覆盖。

### 拆分结果

| 文件 | 内容 | 行数 | 大小 |
|---|---|---|---|
| `app.controller/internals.ts` | 12 个模块级 helper + `productRunSchema`,改为导出 | 211 | 7.7 KB |
| `app.controller/base.ts` | 7 个注入字段 + constructor + 原 4 个 private helper(改 protected) | 92 | 3.6 KB |
| `app.controller/sources.ts` | 27 handler:health / definitions / capabilities / sources / probes / connections / storage / backups | 406 | 13.9 KB |
| `app.controller/runs.ts` | 12 handler:runs / workflow-runs / media-cleanups / jobs / attempts / events | 316 | 11.1 KB |
| `app.controller/content.ts` | 33 handler:stories / entries / topics / entities / relations / evidence / subtypes / revisions / assets / feed / search | 577 | 18.5 KB |
| `app.controller/organization.ts` | 42 handler:labels / collections / favorites / annotations / saved-views / boards / sections / blocks / spotlight | 545 | 16.8 KB |
| `app.controller.ts`(门面) | `@Controller() export class AppController extends AppControllerOrganization {}` | 8 | 0.2 KB |

- 继承链:`AppControllerBase` → `Sources` → `Runs` → `Content` → `Organization` → 门面。**25 处 `new AppController(...)` 与 `app.module.ts` 注册零改动**——门面类名与构造签名不变,这是选 B 的主要收益。
- 方法块逐字节搬运。仅改:构造字段 `private readonly` → `protected readonly`、4 个 helper `private` → `protected`、下沉一层的相对导入上跳一级、每文件按自身用到的标识符裁剪导入(保留 `import type` 语句与具名列表里的逐项 `type ` 前缀,适配 `verbatimModuleSyntax`)。
- 零丢失校验(归一化后类体行多重集):**缺失 0 / 多余 0**。

### 偏差与修复

1. 头部声明边界把类的 `@Controller()` 一并收进 `internals.ts` → `TS1206: Decorators are not valid here`;改为向前跳过类的装饰器块。
2. 文件下沉一层后 `./source-probe.service.js` 相对路径失效;下沉文件的相对导入统一上跳一级。
3. 守卫测试的 `@nestjs/common/constants` 深路径在类型层不可解析 → 加 `@ts-expect-error`(运行时可用;键名实测为 `path` / `method` / `__sse__`)。
4. **原计划切片 3/4 分两步**(先 definitions/sources/connections,再其余),实际按资源一次性分成 4 组完成:分组由脚本按路由一级路径段判定,整体零丢失校验通过;分两步只会增加中间态风险。
5. 分组与 README 初稿的「两半」不同:改为 sources / runs / content / organization 四组,原因是要按行数均衡——初版把 domains 合成一组会到 1200+ 行、直接越过 800 行红线。

### 验证(全绿)

- 路由表守卫:3 项通过 —— 114 条 method+path 与 handler 名集合同快照一致。
- 全量 `bun run typecheck`:通过(packages 全部 + apps/api、worker、web)。
- unit:`72 passed (72)` 文件 / `513 passed (513)` 测试,264.56s(较拆分前 +1 文件 +3 测试,即新增守卫)。
- property:4 测试绿;e2e:4 文件 / 4 测试绿 —— e2e 真实启动服务且 `build:api` 先行通过,**证明继承来的 constructor 与 `@Inject` 元数据在 Nest 依赖注入下正常解析**(方案 B 最大风险点)。
- `madge --circular`:门面链上 8 文件零循环依赖。
- 体积门禁:`PASS`(231 文件、基线 20 条、豁免 1 条)。

## 2026-09-13 切片 5(收口)

### 产出

- **`apps/api/MODULE.md`(3054 B ≤ 3 KB)**:职责一句话、入口与启动、路由入口契约(冻结)、子模块地图(文件→职责→token)、阅读顺序、禁区。
- **`docs/doc-governance/repo-map.json` 重新生成**:`apps/api` 条目 `moduleDoc` 就位(3054 B)、**红线清单从 2 条清零**(原 `app.controller.ts` + `app.controller.test.ts`)、files 12→23、bytes 172,550→181,870。
- **验收三件套对账**:
  - 现有测试全绿:unit 72 文件 / 513 测试、property 4、e2e 4(真实启服务);
  - 公共入口契约测试:`app.controller.route-table.test.ts` 承担本对象的入口契约(114 条路由 method+path 冻结),通过;
  - 导出签名零 diff:`app.module.ts` 注册与 25 处 `new AppController(...)` 零改动,且全量 `bun run typecheck` 通过——签名若有任何变化,这些调用点会直接报错。

### 指标回写(口径:`size-governance.py` 的 token 估算 = ascii/4 + nonAscii/3 × 1.1,可复现)

场景:改单个资源的接口行为(以 sources / runs 为例),需读「源码 + 对应测试」。

| | 文件 | token |
|---|---|---|
| 拆前(`4a29060`) | `app.controller.ts` 17,922 + `app.controller.test.ts` 14,532 | **32,454** |
| 拆后(sources) | MODULE.md ≈ 800 + `sources.ts` 3,564 + `app.controller.sources.test.ts` 3,307 + `base.ts` 930 | **约 8.6k** |
| 拆后(runs) | MODULE.md ≈ 800 + `runs.ts` 2,959 + `app.controller.runs.test.ts` 2,114 + `base.ts` 930 | **约 6.8k** |

降幅约 **73%**;单文件上限从 2093 行降到 577 行(max),门面 8 行。

### 偏差与修复

1. `apps/api/MODULE.md` 首版 3081 B,超 3 KB 硬上限 9 字节;裁剪两处措辞后 3054 B。
2. `repo-map.json` 由脚本在 Windows 上写出为 CRLF,与仓库 LF 不一致(485 处 `\r`);按字节替换 `\r\n`→`\n` 后提交。

### 验证

- 代码门禁 `-c code tests --check --baseline docs/doc-governance/code-baseline.json` → `PASS`(231 文件、基线 20 条、豁免 1 条)。
- `bun run docs:check` → `failures: []`(504 文件)。
- repo-map 与 MODULE.md 一致:`moduleDoc: apps/api/MODULE.md` / `moduleDocBytes: 3054`。
