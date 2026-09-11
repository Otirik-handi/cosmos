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
