# Task 33 Walkthrough（append-only）

## 2026-09-20：定义阶段（Proposal → ADR → Task → API Draft）

- **本轮切片**：把已 accepted 的采集计划决定落成可执行的合同与切片计划，**不写代码**。
- **前置**：`Phase-2-UNDO.md` 的 P0-1 复核结论——架构 §4.6 早已冻结 `CollectionPlan`，§4.7 记录了 Phase 1 的收窄，实现里始终缺席；数据面的隔离（Run／错误／重试／游标按来源）已具备。
- **落地**：
  1. Proposal [`collection-plan-v1`](../../../docs/proposals/collection-plan-v1.md) 起草后经维护者确认 5 项待裁定（全部按建议），转 `accepted` 并记录决策；
  2. PRD 勘误台账 [`ERRATA.md`](../../../docs/requirements/0002-product-requirements/ERRATA.md) 新增 AUT-010 行；
  3. 架构主文档 §19 决定 85、§21 不变量 63；
  4. 新增 ADR [`0023`](../../../docs/adr/0023-collection-plan-v1.md) 并登记进 [`docs/adr/README.md`](../../../docs/adr/README.md)；
  5. 新建本 Task（编号 33 由 Agent 建议、待维护者确认）；
  6. API Draft 补 v1 落地范围：[`0002`](../../../docs/api/0002-product-service-api.md) §4.3、[`0003`](../../../docs/api/0003-product-dtos.md) §2 落地注记、[`0006`](../../../docs/api/0006-scenarios-and-conformance.md) S03。
- **偏差**：无范围偏差。一个发现：API Draft 早已规划 CollectionPlan 的端点、DTO 与 S03 场景，因此本轮只补「v1 落地范围」而不重写目标合同；`docs/api/0003-product-dtos/part-02-04.md` 已封口，按治理规则把更正登记在 0003 主文档的落地注记节。
- **验证**：`bun run docs:check` 711 文件 0 失败、`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` PASS（含基线内增长 warning）。未运行 typecheck／单元测试／浏览器 E2E——本阶段没有代码改动。
- **下一步**：切片 1a（expand）。开工前需要维护者确认 Task 编号，并给出 worktree 与提交授权（仓库规则：创建 worktree／分支与 commit 各自需要授权）。

## 2026-09-20：切片 1a（expand）—— 计划表与可空计划列

- **本轮切片**：ADR-0023 决策 2 的第 1 步。只加表与可空列，不改任何读取路径；假设「回填与读取切换之前，按来源调度/读取的旧路径必须继续可用」，所以计划引用列一律可空。
- **改动文件**：
  1. `packages/contracts/src/collection-plan.ts`（新）：计划快照读投影、创建/更新命令、v1 重叠策略枚举（只有 `forbid`）。
  2. `packages/contracts/src/index.ts`、`entry-surface.txt`、`MODULE.md`：导出面 +8（4 schema / 4 类型），既有导出零增删零改名（`entry-surface.txt` 用生成脚本重写，diff 只有 8 行新增）。
  3. `packages/storage-prisma/prisma/schema.prisma`：新增 `CollectionPlan` 模型；`Run`／`WorkflowRun`／`Checkpoint`／`TriggerBinding` 增加可空 `planId` 与索引；`SourceInstance`／`ConnectionInstance` 补反向关系。
  4. `packages/storage-prisma/prisma/migrations/20260920120000_collection_plan_v1/migration.sql`（新）。
  5. 测试：`packages/contracts/src/collection-plan.test.ts`、`packages/storage-prisma/src/collection-plan-migration.test.ts`（新）。
- **RED → GREEN**：
  - RED（实现前实跑）：contracts `4 failed`（schema 不存在，`Cannot read properties of undefined`）；storage `2 failed`（`CollectionPlan` 表不存在 → `expected [] to deeply equal ArrayContaining`；`prisma.collectionPlan` undefined）。
  - GREEN（实现后实跑）：contracts 该文件 **4/4**；storage **2/2**；`bunx vitest run packages/contracts` **13 文件 / 72 用例全绿**（含冻结导出面守卫）。
- **门禁**：`bun run db:validate` 通过；`bun run typecheck` 全仓 **0**；`bunx madge --circular --extensions ts packages/contracts/src/index.ts` **0 环**；`bun run test` **110 文件 / 643 用例全绿**（切片前基线 108 文件 / 637 用例）。
- **决定与偏差**：
  - `CollectionPlan` 新表的 `sourceId`／`connectionId` 带数据库级外键（`CREATE TABLE` 不受限）；四处 `planId` 是 `ALTER TABLE ADD COLUMN`，按仓库先例不加外键（与 `SourceInstance.connectionId`、`WorkflowRun.sourceInstanceId` 同例）。
  - v1 一对一用唯一索引 `CollectionPlan_sourceId_key` 在数据库层表达，不靠调用方自觉。
  - 合同的媒体预算字段叫 `mediaPolicy`（ADR-0014 语义）；API Draft 目标合同的 `budget: WorkflowBudget` 属通用预算切片，v1 不用——Draft 的 v1 注记同批补上（[`0002`](../../../docs/api/0002-product-service-api.md) §4.3、[`0003`](../../../docs/api/0003-product-dtos.md) §2）。
  - 未新增 storage 包导出：仓库方法仍挂在既有 `PrismaCosmosRepository` 上，冻结入口契约不受影响。
- **未运行**：浏览器产品 E2E、真实来源验收（切片 1a 没有用户可观察行为变化，属后续切片的验收面）。
- **下一步**：切片 1b（backfill）——为每个既有来源生成默认计划，回填三处计划引用并重写状态命名空间；开工前在 walkthrough 记录回填的幂等与失败停止条件。

## 2026-09-20：切片 1b（backfill）—— 默认计划与计划引用回填

- **本轮切片**：ADR-0023 决策 2 的第 2 步。假设：回填只写新列；来源侧字段与状态命名空间在读取切换之前仍是唯一读取方，所以这一步不动它们（可独立部署、可回滚）。
- **改动文件**：
  1. `packages/storage-prisma/prisma/migrations/20260920140000_collection_plan_backfill/migration.sql`（新）：为每个既有来源（含墓碑）生成 `plan:<sourceId>` 默认计划，继承连接、媒体策略与启用状态；回填 `Run`／`WorkflowRun`／`Checkpoint`／`TriggerBinding` 的计划引用。
  2. `packages/storage-prisma/src/collection-plan-backfill.test.ts`（新）：按真实迁移顺序两段部署——先部署到 expand 步、播种子数据，再部署含 backfill 的全量迁移。
- **RED → GREEN**：RED（实现前实跑）**1 failed**（`20260920140000_collection_plan_backfill 必须存在`）；GREEN（实现后实跑）**1/1**。
- **门禁**：`bun run test` **111 文件 / 644 用例全绿**（切片 1a 后基线 110 / 643）。
- **决定与偏差**：
  - **偏差（相对 ADR-0023 决策 2 的措辞）**：ADR 把「状态命名空间按计划重写」写在 backfill 步；实现把它推到切片 1c 的读取切换。理由：命名空间改的是**读取方**要查的键，回填期提前重写会让仍按来源读取的旧路径查不到状态（等于丢掉 ETag／游标，虽可重建但要白付一次全量抓取）。同一理由，`SourceInstance.config.media` 与 `SourceInstance.connectionId` 在这一步只被**复制**、不被移除，移除与读取切换同批。
  - 墓碑来源的计划写成 `enabled=false`（来源行可能仍留 `enabled=1`），避免读取切换后把已删除来源重新调度起来。
  - 计划 id 用 `plan:<sourceId>` 派生，映射可复现、便于核对与回滚。
  - 回填不幂等（重复插入会撞 `CollectionPlan_sourceId_key` 而失败）：这是有意的失败停止，不静默生成第二份计划。
- **未运行**：浏览器 E2E、真实来源验收（本切片仍无用户可观察行为变化）。
- **下一步**：切片 1c 拆两段——1c-1 数据面读取切换（调度、ingest、checkpoint、状态命名空间与媒体策略读取改读计划，并同批重写命名空间、移除来源侧 media）；1c-2 计划的产品面（API CRUD、读投影、transport）。
