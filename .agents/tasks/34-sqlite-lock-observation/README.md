# Task 34：SQLite 并发锁等待观测（P4-1 诊断）

## User Request / Topic

2026-09-24 维护者裁定「P4 三项按顺序做」，P4-1 的下一步定为**先补观测再定**（不在证据不足时直接改并发形状）。编号 34 由维护者分配。

## Goal

把 [`docs/testing/known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 第 1 条那几条「同一构建单跑通过、只在整套里失败」的用例，与 SQLite 的锁等待/失败事件在时间上对上号，从而回答台账第 2 步的问题：**修应用侧并发，还是修测试隔离**。

本轮只做观测与证据，**不改并发形状、不开 WAL、不改测试隔离、不放宽任何断言**。

## Scope / Non-goals

Scope：

- 新增一个默认关闭的 SQLite 诊断开关（慢操作 + 错误事件 + 每次运行的 PRAGMA 环境事实）。
- 用该开关跑整套浏览器验收多轮，逐轮记录命令、次数、结果与诊断分布。

Non-goals：

- 不修应用并发、不改 Prisma 事务形状、不引入 `BEGIN IMMEDIATE` 等价物。
- 不启用 WAL、不改 `busy_timeout`、不改 `synchronous`。
- 不改浏览器 spec 的任何断言，不给测试分数据根。
- 不处理 P4-2（代码规模）与 P4-3（看板撤销）。

## Current State

- 生命周期阶段：诊断观测实现完成，证据采集中；**未 commit、未合并**。
- 连贯目标：为「P4-1 修哪一侧」提供可复现的证据。
- 可观察验收（≤3 条）：
  1. 开关关闭时 Prisma 客户端的构造参数与之前逐字相同（不注册任何 log 事件），且不产生任何诊断输出；
  2. 开关打开时，一次普通查询能产生结构化的慢操作记录，并记录本次运行的 `journal_mode` / `busy_timeout` / `synchronous`；
  3. 整套浏览器验收连跑多轮，逐轮留下通过/失败计数、失败用例名与诊断事件分布。
- 依赖：无新增依赖；复用 Prisma 6 的 `log: [{ emit: "event" }]` 事件与既有 `known-unstable-cases.md` 的观察记录。
- 受影响合同：**无**公共 DTO、无 Prisma schema/migration、无 API 路由变化；新增一个环境变量开关（`COSMOS_SQLITE_DIAGNOSTICS` / `COSMOS_SQLITE_DIAGNOSTICS_FILE` / `COSMOS_SQLITE_SLOW_MS`）。
- 预计核心文件：`packages/storage-prisma/src/sqlite-diagnostics.ts`（新增）、`storage-root.ts`、`repository/base.ts`、`sqlite-diagnostics.test.ts`（新增）。
- 验证层级：聚焦单元（隔离库）→ typecheck → 整套浏览器验收多轮（本 Task 的主要证据面）。

## Decisions and Deviations

### 1. 台账给的第一步，有一半经实测不成立（本轮最重要的结论）

台账第 1 条的建议次序写的是「把 SQLite 的 WAL 与 `busy_timeout` 显式配置上」。实测（探针只写临时库）：

| 量 | 台账假设 | 实测 |
| --- | --- | --- |
| `journal_mode` | 尚未显式配置 | **`delete`（WAL 未开）** —— 假设成立 |
| `busy_timeout` | 尚未显式配置 | **`5000`** —— 假设**不成立**，Prisma 引擎默认就设了 5000ms |
| `synchronous` | — | `2`（FULL） |

因此「显式配置 `busy_timeout`」在当前实现下是空操作；把它写进证据而不是靠回忆，是本轮的第一项产出。

### 2. 一个真实的写-写争用已复现，但**它不是**「先读后写升级锁」那个陷阱

两个 Prisma 客户端各跑一个「先 SELECT 再 INSERT」的交互式事务（用屏障保证两边都拿到读锁之后才写）：

```text
[默认 busy_timeout（5000）] T1=FAIL(5108ms) P2028 | T2=ok(5108ms)
```

一个事务被卡满 5 秒后失败，另一个随后成功——这是**两个写者争用同一把写锁**，`busy_timeout` 把等待封顶在 5 秒，然后放弃。

**修正上一轮自己的假设（实测推翻）**：诊断日志里出现了 `BEGIN IMMEDIATE`，说明 **Prisma 对 SQLite 的交互式事务本来就用立即写锁**。所以 [berthub.eu](https://berthub.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout) / [simonwillison.net](https://simonwillison.net/2025/Feb/17/sqlite-busy) 说的「延迟事务先读后写、升级写锁失败时不走 busy handler」这个陷阱**在本仓库不适用**——`BEGIN IMMEDIATE` 从根上避开了它。这条写进来，是为了下一轮不要再从那个方向查。

### 3. 结论：SQLite 锁/慢操作**不是**这些失败的成因（8 轮，n=4）

命令：`COSMOS_SQLITE_DIAGNOSTICS=1` + 每轮独立诊断文件 + Playwright JSON reporter 取 per-test 计时，`bunx playwright test --config playwright.config.ts "--reporter=list,json"` 整套连跑 8 轮；再用一次性分析脚本把「每个用例的执行区间」与「慢操作时间戳」对齐。

| 轮 | 结果 | 耗时 | 慢操作总数 | **落在失败用例区间内的慢操作** |
| --- | --- | --- | --- | --- |
| 1–3 | 33 passed | 2.1m ×3 | 0 | — |
| 4 | 1 failed：`source-lifecycle`「删除来源需要两段确认」（`locator.fill` 超时 300s） | **7.2m** | **0** | **0** |
| 5 | 1 failed：`collection-plan-multi`「creates two plans…」（element not found） | 2.5m | 68（worker 25 / api 43） | 39（worker 20 / api 19），最慢 1356ms |
| 6 | 1 failed：`phase2-organization`「splits a Story…」（deep equality） | 2.7m | **0** | **0** |
| 7 | 1 failed：`phase2-organization`「links an entry… reverse view」（element not found） | 2.3m | 1（api） | **0** |
| 8 | 33 passed | 2.2m | 0 | — |

**结论（负结果）**：4 个失败轮次里有 **3 个的慢操作总数为 0**，包括那次 7.2 分钟、`locator.fill` 卡满 300 秒的卡死。唯一有慢操作爆发的第 5 轮里，**同一轮通过的用例也有 19 条慢操作落在自己的区间内**——所以慢操作既不是失败的充分条件，也不是必要条件。

**因此**：

- 台账原先「怀疑与 SQLite WAL/busy_timeout 同根因」**不被这份证据支持**；上一轮基于单轮（n=1）观察到的「失败轮次伴随慢操作爆发」**不成立，此处明确撤回**。
- 失败症状集中在 **DOM/前端层**（元素找不到 / 不可填充 / 状态不等），失败点漂移；第 4 轮是「5 分钟内那个元素始终没出现」，而不是「慢」。
- 诊断开关本身仍然有效——它把一条候选路径**证伪**了，这正是不该用「重跑就过」结案的原因；但它**不是**下一步该用的工具。

**下一步该看的地方**：Playwright 配置是 `trace: "retain-on-failure"`，那 4 次失败的 trace 已落在 `test-results/`。看 trace 能直接回答「页面当时在等什么」，比继续加数据库观测对症。

### 4. 为什么用 Prisma 的 log 事件，而不是 `$extends` 或中间件

`$extends` 的返回值类型与 `PrismaClient` 不同，要塞进 `PrismaCosmosRepository` 的 `prisma` 字段就得做一次类型断言；而「开关关掉时也静默注册事件」最容易藏在那种断言后面。改用 `log: [{ emit: "event" }]` + `$on`，并且把**构造与挂载写在同一个作用域**里（`createDiagnosedPrismaClient`），让 TS 自己推出 `$on` 的重载——零断言、零开销。

### 5. 两条实现约束（踩过才知道）

- `PRAGMA journal_mode` / `busy_timeout` 都会**返回一行结果**，所以只能用 `$queryRawUnsafe` 设或读；用 `$executeRawUnsafe` 会直接报 `P2010 Execute returned results`。
- 诊断默认写 stderr；整套浏览器跑时 Playwright 会吞掉 webServer 的输出，所以必须支持写文件（`COSMOS_SQLITE_DIAGNOSTICS_FILE`）才能事后 grep。

## Implementation Walkthrough

1. **`packages/storage-prisma/src/sqlite-diagnostics.ts`（新增）**：`sqliteDiagnosticsEnabled()`（`COSMOS_SQLITE_DIAGNOSTICS === "1"`）、`createDiagnosedPrismaClient(url)`（构造 + 挂载 `query`/`error`/`warn` 事件，慢操作阈值 `COSMOS_SQLITE_SLOW_MS`，默认 250ms）、`recordSqliteDiagnostics(record)`（一行一条 JSONL，含 `timestamp`/`process`/`pid`）、`recordSqlitePragmaFacts(client)`（每次运行记一次环境事实）。
2. **`storage-root.ts`**：`createPrismaClient()` 在开关打开时走 `createDiagnosedPrismaClient`，关闭时构造参数与以前逐字相同。
3. **`repository/base.ts`**：`initialize()` 在 `$connect()` 之后调用 `recordSqlitePragmaFacts`（关闭时是 no-op）。
4. **`packages/storage-prisma/src/sqlite-diagnostics.test.ts`（新增）**：开关关闭时零输出；打开时写结构化 JSONL；经真实客户端跑一次查询并钉住 PRAGMA 事实（`journal_mode=delete`、`busy_timeout > 0`）。

## Verification

- `bun run typecheck`：**0**（首次因 `as const` 的 readonly 元组不满足 `PrismaClientOptions` 报错，改成本决定 4 的写法后通过）。
- 聚焦单元 `bunx vitest run packages/storage-prisma/src/sqlite-diagnostics.test.ts`：**3 passed**。
- 整套浏览器验收多轮（`COSMOS_SQLITE_DIAGNOSTICS=1` + 每轮独立诊断文件）：命令、轮次与逐轮结果见上方决定 3 的表。
- 未运行：全量 `bun run test`、Node 进程 E2E、真实来源验收、Docker（本 Task 只新增一个默认关闭的观测开关，行为等价由聚焦测试与 typecheck 覆盖；合并前补全量）。

## Follow-ups

- **数据库这条候选路径已证伪**（见决定 3）：4 个失败轮次里 3 个没有任何慢操作，含那次 7.2 分钟卡死。因此台账第 2 步的「修应用并发 vs 修测试隔离」二选一**在当前证据下不成立**——两个选项都建立在「失败源于数据库争用」这个前提上，而前提没被支持。
- **下一步**：看 Playwright 为 4 次失败保留的 trace（`test-results/`，配置为 `retain-on-failure`），回答「页面当时在等什么」。失败症状已归类到 DOM/前端层。
- 诊断开关是否长期保留、是否要在 `docs/spec/` 登记，取决于前端那条线的结论；本轮的证伪价值已兑现，但开关对后续是否有用尚未证明。
- 本 Task **未 commit、未合并**；合并前需补全量 `bun run test`（本轮只跑了聚焦测试与 typecheck）。
