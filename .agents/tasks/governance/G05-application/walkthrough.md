# G05 过程记录(append-only)

本文件是 G05 的过程、偏差与验证的唯一记录位置;README 只维护当前摘要、范围、门禁与下一步。追加规则与文档大小治理见根 `AGENTS.md`。

## 2026-09-14 切片 0:前置(worktree + 基线 + 入口契约测试 + madge 基线)

### 载体

- worktree `.worktree/g05-application`,分支 `refactor/g05-application`,基于本地 `master` `a172e69`(G04 收口 + G05 立项)。`git fetch origin` 后确认 `origin/master` 无新提交,本地领先 6 个提交;从本地 master 建分支是为了带上 G04/G05 的记录,不是从落后基线开分支。
- 维护者 2026-09-14 批准对象(`packages/application`,按本次 D 口径的模型首位)与 worktree/分支创建。

### 基线(对象 = `index.ts` + 同名测试)

| 文件 | 行数 | 字节 | token 估算 | 近 30 天提交 |
|---|---|---|---|---|
| `packages/application/src/index.ts` | 2048 | 68,937 | 17,234 | 20 |
| `packages/application/src/index.test.ts` | 610 | 21,164 | 5,291 | 4 |
| 对象合计 | 2659 | 90,101(88.0 KB) | 22,525 | 24 |

- 入口**解析后导出面 147 个**(54 值 / 93 类型);源码层形态为 7 处 `export *` + 14 个导出类型 + 35 个导出值声明。`export *` 使源码层计数(49)严重低估真实公共面(147),这是必须用编译期解析的原因。
- 构建产物基线:`packages/application/dist` = 735 KB(`bun run build:packages` 后测得)。
- **madge 循环依赖基线(既有,非本次引入)3 条**:`index.ts > media-acquisition.ts`、`index.ts > workflow-host-runtime.ts`、`index.ts > workflow-host-runtime.ts > workflow-host.ts`。三条都是入口与实现互指,是桶文件与实现同处一个文件的典型环;切片 1/3 执行后应减少或消失,切片验收按「不新增环」看守。

### 新增资产

- `scripts/entry-export-surface.ts`:用 TypeScript 编译器 API 打印某个入口的解析后导出面(`kind<TAB>名称`,排序)。为什么不用正则扫源码:`export *` 的名称要跨文件解析;为什么不能只看 `Object.keys`:类型导出(93 个)运行时不存在,只看运行时会漏掉大半个合同。
- `packages/application/entry-surface.txt`:147 行导出面快照,作为「允许存在的导出」唯一真相源;增删导出必须显式重新生成它。
- `packages/application/src/entry-contract.test.ts`:常驻契约测试,断言运行时值导出集合等于快照的 `value` 行(54 个,一次通过)。

### 验证(全部在本 worktree 内执行)

| 命令 | 结果 |
|---|---|
| `bun run typecheck` | EXIT=0 |
| `bunx vitest run` | 73 文件 / 514 用例全绿(含新增契约测试;主工作区基线为 72/513) |
| `bun run test:property` | 3 文件 / 4 用例全绿 |
| `bun run test:e2e` | 4 文件 / 4 用例全绿(真实启 API/Worker Node 进程) |
| `bun run build:packages` | EXIT=0 |
| `bunx madge --circular --extensions ts packages/application/src/index.ts` | 3 个既有环,已记入基线 |

### 偏差与教训

1. **worktree 首次使用只 `bun install` 不够,必须先 `bun run db:generate`。** 未生成 Prisma Client 时:`bun run typecheck` 在 `packages/storage-prisma/src/workflow-host-store/run-lifecycle-store.ts` 报 4 处 TS7006 隐式 any、`bunx vitest run` 只收集到 382 个用例、property 与 build:packages 均失败。生成后四步全绿。该前置步骤没有写在任何 worktree 使用文档里,建议补进仓库流程文档(见 Follow-ups)。
2. **e2e 在本机需要把真实 `bun.exe` 放进 PATH。** `bun run test:e2e` 首次失败于 `Error: Prisma migration failed ... Error: spawnSync bun ENOENT`:本机通过 npm 安装的 `bun` 是 Git Bash 包装脚本(内部再 exec `node_modules/bun/bin/bun.exe`),Node 的 `spawnSync("bun")` 无法执行该脚本,而 `scripts/e2e/helpers.ts` 的 `applyMigrations` 正是这么起的迁移。把 `node_modules/bun/bin` 加进 PATH 后 e2e 4/4 通过。这是本机环境问题,与 G05 对象无关,但值得作为仓库侧改进项记录(见 Follow-ups)。
3. **立项 README 的数字写错并已修正。** 我把 `packages/application/src/index.test.ts` 写成 36.37 KB / 1011 行——那是 `packages/contracts/src/index.test.ts` 的数字;实际为 21.16 KB / 610 行(警戒区,非红线)。已修正 master 上 README 的 Goal、Scope、切片 2 三处,并把切片 2 的验收从「≤800 行」改为「≤400 行(不制造微文件)」。

### 未运行

浏览器/component-lab 验收(切片 2 测试拆分后按需运行);CI(分支未推送)。

## 2026-09-14 切片 1:桶文件步骤(显式具名导出 + MODULE.md)

- 变更:`packages/application/src/index.ts` 的 7 处 `export *`(原第 77–83 行)替换为 27 行显式具名导出。值导出用 `export { … } from "…"`,类型导出用 `export type { … } from "…"`——仓库 `verbatimModuleSyntax: true`,类型再导出必须走 `export type`。**实现零改动**。
- 新资产 `packages/application/MODULE.md`(2,664 B,≤3 KB):职责、公共入口(147 个导出的分组概述 + 快照与契约测试指针)、11 个非测试子模块的地图与 token 估算、阅读顺序、禁区。
- 显式清单由脚本按解析结果生成,不手抄:逐个模块跑 `scripts/entry-export-surface.ts` 取值/类型导出再合成(值 19 个、类型 79 个)。147 个名字手工转录必然出错。
- 验证(worktree 内):**导出面零 diff**(重新生成后与 `entry-surface.txt` 逐字节相同,仍是 147 个);`bun run typecheck` EXIT=0;`bunx vitest run` 73 文件 / 514 用例;`bun run test:property` 3 文件 / 4 用例;`bun run test:e2e` 4 文件 / 4 用例;`bun run build:packages` EXIT=0。
- madge:**仍是 3 个既有环,未新增**。桶文件步骤本身不消环——环源于入口同时 import 实现与再导出,消环要等切片 3 把实现移出 `index.ts`。切片 1 的验收因此是「不新增环」而非「环归零」。
- 偏差:`MODULE.md` 没有逐条枚举 147 个导出名——3 KB 硬上限装不下,改为按语义分组概述 + 指向 `entry-surface.txt`(机器可读真相源)与 `entry-contract.test.ts`(常驻护栏)。提案 §4.5「公共入口导出清单」由此满足实质而非字面。

## 2026-09-14 切片 2:index.test.ts 按行为拆(3 个测试文件 + 共享 helper)

- 原 `index.test.ts` 610 行(含 5 个 describe + 两个共享 helper)拆为:
  - `connector-registry.test.ts` 24 行(describe ConnectorRegistry)
  - `connector-probe.test.ts` 329 行(ConnectorProbeService + SourceConfigProbeService + worker dispatch)
  - `logger.test.ts` 149 行(runtime logging context)
  - `test-support.ts`:`captureLogger()` 与 `source()` 被 4 个 describe 共用,抽成同级非测试模块(`.test.ts` 后缀会进 vitest 收集,故不叫测试文件)。仓库既有的 `dist` 已 emit `*.test.js`,因此该文件随包 emit 属现状而非新增问题。
- 与切片 3 的聚合对齐:测试文件按「连接器注册表 / 连接器探测 / 日志」分组,对应切片 3 的 `connector-registry.ts`、`connector-probe.ts`、`logger.ts`。
- 验证(worktree 内):类型检查 0;application 包内 9 文件 / 78 用例;全仓 unit **75 文件 / 514 用例**(文件数 73 → 75,用例数不变——拆分前后测试数守恒是本次的关键判据);property 3/4;e2e 4/4;build:packages 0;madge 仍是 3 个既有环、未新增。
- 偏差:单个 describe 一个文件会产出 24 行的微文件,但 ConnectorRegistry 是独立单元,与 `connector-probe.ts` 各自成对,故保留 3 个文件而非合并成 2 个。

## 2026-09-14 切片 3:单体按聚合拆(入口 2149 → 98 行)

- 入口自有 60 个顶层声明按聚合移入 11 个模块:`result-types`、`logger`、`errors`(31 个域错误类)、`repository-port`(含 `CosmosRepository` 532 行)、`connector-ports`、`connector-registry`、`connector-probe`、`ingestion-service`、`ingestion-worker`、`health`,以及包内共享 helper 模块 `internals`(文件读取、失败归类与重试延时;被探测与 Worker 共用,故不放进任何一方)。`internals` 的取舍沿用 G03 的先例(模块级 helper 抽到 `internals.ts`)。
- 入口改写为「每模块一条导出语句、类型用内联 `type` 修饰、名字按 92 列密集排布」:**98 行**,全部是导出与模块地图。
- **内部 import 改指聚合模块**是本次的关键动作:原先 `media-acquisition.ts`、`workflow-ingest.ts`、`workflow-media-cleanup.ts`、`workflow-host.ts` 等实现模块都从包入口 `./index.js` 取类型——这正是 3 个循环依赖的成因。改为指向各自聚合模块后,**madge 循环依赖 3 → 0**(不再只是「不新增」)。
- 验证(worktree 内):导出面**逐字节零 diff(仍 147 个)**;全仓 `bun run typecheck` 0 错误;unit **75 文件 / 514 用例**(与切片 2 一致);property 3/4;e2e 4/4;`bun run build:packages` 0;madge 0 环。
- 成本记录:`packages/application/dist` 由 735 KB 增至 953 KB(+30%)——模块数量增加带来更多 `.js`/`.d.ts`/`.map` 文件的固定开销。这是拆分的真实代价,按提案「最小必要上下文」的目标换取的是读取量下降。
- 偏差(全部由验证发现,非人工核对发现):
  1. 首版脚本用「最后一个 `} from "…"` 行」定位 import 头结束,而切片 1 之后**导出语句同样以 `} from "…"` 结尾**,导致每个聚合模块的头部被塞进整段导出块(重复导出、假循环边、测试大面积失败)。改为只在第一个导出语句之前统计。
  2. `ConnectorExecutionError` 名称以 `Error` 结尾,被 `errors` 与 `connector-ports` 同时认领,声明写了两份、入口重复导出。按「连接器错误属于连接器端口合同」判归 `connector-ports`。
  3. `ClaimedJob`/`CompleteJobInput` 是包内类型,`verbatimModuleSyntax` 要求 `import type`;首版按值导入报 TS1484。
  4. 生成器产出过 `import type { type X }`(TS2206),以及单行形式下的同类问题;两次修正后收敛。
  5. 每个模块整块继承原 import 头会留下一批未使用导入,既撑大文件又制造假循环边(`media-acquisition.ts > logger.ts`)。清掉未使用导入后,模块总行数由 4096 降到 2138,且最后一个环消失。

## 2026-09-14 切片 4:收口(MODULE.md 回写、repo-map、读取量指标)

- `packages/application/MODULE.md` 按拆分后的形态重写(2,916 B,≤3 KB):入口门面说明、147 个导出的取用方式、23 个非测试子模块的地图与 token 估算、阅读顺序、四条禁区(含「实现模块不从 `./index.js` 取类型,否则重新引入环」)。
- `docs/doc-governance/repo-map.json` 由 `python scripts/size-governance.py --map` 重生成(38 个包/应用目录),与提交版本 diff 即本次结构变化。
- 读取量指标(同一入口,拆分前后):

| 典型任务 | 拆分前 | 拆分后 | 变化 |
|---|---|---|---|
| 读入口本身 | 17,234 token | 1,243 token | −93% |
| 改域错误类型 | 22,525 token(入口+入口测试) | 892(MODULE.md)+1,815(errors.ts)= 2,707 | −88% |
| 改采集入队行为 | 22,525 token | 892+2,806(ingestion-service)+1,922(相关测试)= 5,620 | −75% |

- 本切片未改代码逻辑;验证沿用切片 3 的结果(同一工作树、同一提交内容,仅新增 MODULE.md 与 repo-map)。
- 遗留:`workflow-host-runtime.ts`(1,206 行 / ~11.2k token)自身仍越 800 行红线,不在本对象范围内,仍列在治理候选清单。
