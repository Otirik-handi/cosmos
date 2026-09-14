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
