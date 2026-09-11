# G02 Walkthrough——storage-prisma 拆分

## 2026-09-11 切片 1(前置基线)

- worktree `.worktree/g02-storage-prisma`、分支 `refactor/g02-storage-prisma`(自 master `22763a5`,维护者批准)。
- `bun install` + `bun run db:generate`;madge 加入 devDependencies。
- 新增入口契约测试 `packages/storage-prisma/src/entry-contract.test.ts`:冻结 9 个值导出(FileSecretStore、PrismaConnectorStateStore、PrismaCosmosRepository、PrismaWorkflowBackend、PrismaWorkflowEventSink、PrismaWorkflowHostStore、createPrismaClient、resolveContainedPath、resolveStorageRoots);类型导出 `StorageRoots` 由 tsc 看守。
- 基线指标:`src/index.ts` 267.9 KB / 7018 行 / 9 值导出;`workflow-host-store.ts` 93.5 KB;全仓超标清单见 `docs/doc-governance/code-baseline.json`(24 条)。
- madge --circular(27 files):零循环依赖。
- property 配置:3 文件 / 4 测试绿。

## 2026-09-11 切片 1b(偏差与修复:基线三配置验证时发现 Task 23 遗留测试债)

### 现象

切片 1 验收跑全量 unit:14 文件 / 61 测试失败;master 主工作区更红(17 文件 / 85 失败,typecheck 亦红,系主工作区 Prisma client 未重新 generate)。失败与 G02 改动无关(G02 当时仅新增一个测试文件)。

### 定性

1. **负载争用(主因,~56 个)**:storage-prisma 的 Prisma-backed 测试单跑约 4s/个,全量并行下超时/SQLite 争用,失败数随负载波动(三次全量分别为 85/61/66)。**验证**:`bunx vitest run --maxWorkers=2` 后 **62 文件 / 510 测试全绿**(254s)。此为 Windows 本地高并行特性;CI 的 unit 在 Ubuntu 上运行,不受影响,故不改仓库配置。
2. **确定性债(5 个,application/index.test.ts)**:fixture 将 `scheduleIntervalMs` 放在 Source config 内(Task 23 已迁出)、repository mock 缺 `listScheduleTriggers`(Task 23 新增端口方法)。

### 修复(对齐 ADR-0018 已验收合同,不改产品代码)

- `packages/application/src/index.test.ts`:probeCommand.config 移除 `scheduleIntervalMs`;4 处 repository mock 补 `listScheduleTriggers: async () => []`。
- `scripts/e2e/helpers.ts`:`createRssSource` 将 `scheduleIntervalMs` 从 config 移到 create 命令顶层(ADR-0018 §新合同)。
- Windows 本地运行 e2e 需 `BUN_BINARY` 指向真实 `bun.exe`(npm 垫片无法被 spawnSync 解析;CI 的 e2e 仅在 Ubuntu 跑,无需此变量)。

### 终态(全绿)

- typecheck:零错误。
- unit:62 文件 / 510 测试全绿(`--maxWorkers=2`,254.91s)。
- property:3 文件 / 4 测试绿。
- e2e:4 文件 / 4 测试绿(`BUN_BINARY=<bun.exe>` + `bun run test:e2e`)。
- 契约测试:绿。
- madge:零循环。

## 2026-09-11 切片 2(测试按行为拆分)

### 拆分

- `index.test.ts`(52 KB / 1359 行 / 18 it)→ `index.fixtures.ts`(2.8 KB,状态 + afterEach + captureLogger + prepareDatabase)+ 4 册:`repository-ingest`(12.0 KB)、`source-activation`(12.6 KB)、`job-claims`(8.8 KB)、`worker-pipeline`(17.3 KB)。
- `workflow-host-store.test.ts`(56 KB / 1271 行 / 30 it + 1 嵌套 describe)→ `workflow-host-store.fixtures.ts`(7.6 KB,roots/clients/databasePaths 状态 + afterEach + createStore 等 7 个 helper + 3 个 fixture 常量)+ 4 册:`store-migrations-fencing`(10.4 KB)、`store-idempotency-activity`(8.5 KB)、`store-completion-delivery`(25.6 KB)、`run-control`(5.7 KB)。
- 外层 describe 壳有意消解(2 个);测试本体逐字节移动,调用点零改动(helper 经具名导入)。

### 工具与迭代

- 一次性脚本 `.agent/tmp/split-tests3.py`:按行号切分、fixtures 导出注入、各分册导入按实际引用自动生成(保留 `type` 标记)、it/describe 标题守恒断言。v2 迭代教训:fixtures 导入重复(原 prelude 自带导入 + 生成导入叠加)与 `type` 标记丢失(verbatimModuleSyntax),v3/v4 修复。
- typecheck 一次通过(v4);发现并导出书内直接引用的模块级状态:`temporaryRoots`、`roots`、`clients`、`databasePaths` 与尾部 helper `createFixtureSource`。

### 终态

- unit:68 文件 / **510 测试全绿**(与拆分前 510 完全一致,零丢失;`--maxWorkers=2`,254s)。
- property 4/4 绿;e2e 4/4 绿;契约测试绿;typecheck 零错误;madge 零循环(35 files)。
- 覆盖率:未运行(工具在阶段③引入);测试内容零丢失,覆盖率按构造不变,阶段③引入后复核。

## 2026-09-11 切片 3(单体按聚合拆:继承链 + 门面)

### 拆分

- `workflow-host-store.ts`(93.5 KB / 2470 行)→ 门面(277 B,6 行,路径与 `PrismaWorkflowHostStore` 导出不变)+ 继承链分册 `workflow-host-store/`:
  - `base.ts`(1.1 KB):三字段(prisma 公有 readonly;logger/actionRetryPolicies private→protected)与构造器重载;方法体间零横向调用、this 引用仅三类字段,继承链因此安全。
  - `envelope-store.ts`(6.7 KB)→ `run-lease-store.ts`(7.7 KB)→ `activity-store.ts`(24.1 KB)→ `completion-delivery-store.ts`(10.4 KB)→ `run-lifecycle-store.ts`(9.7 KB):26 个方法按聚合分组、逐字节移动。
- 45 个模块级 helper/类型/常量分三层(依赖单向,madge 验证零循环):`internals-core`(常量+行类型+JSON/日期/错误原语,5.8 KB)← `internals-activity`(envelope/activity/completion 归一化与校验,26.5 KB)← `internals-events-lease`(事件追加与租约卫兵,7.0 KB)。

### 验证

- typecheck 零错误;unit 68 文件 / 510 测试全绿;property 4/4;e2e 4/4;契约测试绿(9 值导出零 diff);madge 零循环。
- 工具:`.agent/tmp/split-whs.py`(行号分段 + 导入自动生成,含 type 标记保留);迭代中两次因源文件被门面覆写需 git 恢复后重跑。

## 2026-09-11 切片 5(收口基建:MODULE.md + repo-map + 基线缩减)

按维护者指示先行,不依赖切片 4;MODULE.md 与 repo-map 在切片 4 落地后按「与代码同 PR 更新」规则再各更新一次。

- 新增 `packages/storage-prisma/MODULE.md`(2449 B ≤ 3 KB):职责一句话、入口契约清单、子模块地图、阅读顺序、禁区、更新日期;当前版本反映切片 3 后结构(index.ts 仍为单体,已如实标注拆分中)。
- `scripts/size-governance.py` 新增 `--map`:生成 `docs/doc-governance/repo-map.json`(38 个包/应用目录;每条含入口路径/字节/行数/zone、MODULE.md 路径与字节、red/warn 文件清单;类别缺省 code+tests,`--path` 可换扫描根)。
- 基线缩减:`code-baseline.json` 24 → 21 条,仅移除切片 2/3 后已不存在的 3 条(`index.test.ts` / `workflow-host-store.test.ts` / `workflow-host-store.ts`);对「已回到健康区但仍存在」的 6 条(info 提示)不动——提前移除会使文件回升时被计为新增。
- 门禁:`python scripts/size-governance.py -c code tests --check --baseline docs/doc-governance/code-baseline.json` → PASS(21 条基线,豁免 1 条)。
- repo-map 的 CI diff 校验属 Follow-ups(README「repo-map CI 校验接入」),本切片只交付生成能力。
- 指标回写(典型任务读取量 9 万 → ≤1.5 万)在切片 4 收口后于本文件补终值与测算口径。
