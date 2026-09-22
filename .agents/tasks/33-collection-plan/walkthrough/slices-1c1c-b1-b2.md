# Task 33 Walkthrough 分册：1c-1c 归属切换的 b1 与 b2

本册是 Task 33 walkthrough 的历史分册，只搬位置、不改写条目。后续记录继续写在主文件 [walkthrough.md](../walkthrough.md)。

## 2026-09-20：切片 1c-1c-b1 —— 计划写端点与启用状态归属切换

- **本轮切片**：把启用状态、计划名、连接与调度的**写入口**从来源端点搬到计划端点，同批删除来源激活路径；读取口径随之改为「计划是所有者」。
- **改动文件**：
  1. `packages/contracts/src/base.ts`：`updateSourceCommandSchema` 去掉 `connectionId`／`scheduleIntervalMs`（只剩来源名与目标配置）；删除 `sourceActivationCommandSchema`；`sourceSnapshotSchema` 增加 `planId`／`planRevisionId`，并把 `connectionId`／`scheduleIntervalMs` 由可选改为**必填可空**（可选让「缺省」与「没有」不可区分）。
  2. `packages/contracts/src/collection-plan.ts`：`updateCollectionPlanCommandSchema` 增加 `scheduleIntervalMs` 与 `enabled`。
  3. `packages/contracts/src/index.ts`、`entry-surface.txt`、`packages/application/{index.ts,entry-surface.txt}`：导出面同步（contracts −2，application +2 个错误类）。
  4. `packages/application/src/errors.ts`：新增 `CollectionPlanNotFoundError`／`CollectionPlanRevisionConflictError`——计划是独立 CAS 域，拿来源的冲突类型回报计划的并发写会误导调用方。
  5. `packages/storage-prisma/prisma/schema.prisma` + 新 migration `20260920160000_collection_plan_activation_ownership`：删除 `SourceActivationCommand` 表；迁移先把 `SourceInstance.enabled` 的最后意图同步进 `CollectionPlan.enabled`（墓碑来源除外），再删表。
  6. `packages/storage-prisma/src/repository/sources.ts`：`updateSource` 只写名字与配置；删除 `activateSource`；新增 `updateCollectionPlan`（计划 revision CAS，含调度绑定 upsert／删除）；`listScheduleTriggers` 改按 `plan.enabled` 判可执行性（来源只决定「还在不在」）；`deleteSource` 同时停用计划；`toCollectionPlanSnapshot` 的 `revisionId` 修正。
  7. `packages/storage-prisma/src/repository/helpers-4.ts`：`toSourceSnapshot` 的 `enabled`／`connectionId`／`scheduleIntervalMs` 改从计划投影，并带上 `planId`／`planRevisionId`；来源没有计划时**直接抛错**（读取切换后「来源没有计划」是数据损坏，不该静默成 null）。
  8. `packages/storage-prisma/src/storage-root.ts`：`parsePlanRevisionId`（与来源同形、报计划自己的冲突错误）。
  9. `apps/api/src/app.controller/sources.ts`：新增 `PATCH /collection-plans/:planId`（启用时仍校验已保存配置有效）；删除 `POST /sources/:sourceId/activation-commands`。
  10. `packages/transport-http/src/client-sources.ts`：`updateCollectionPlan` 取代 `activateSource`。
  11. `apps/web/src/app/home/use-source-workspace.ts`：启停改调计划端点，CAS 用 `planRevisionId`。
  12. `scripts/e2e/helpers.ts` 与 4 个 e2e 用例、`apps/worker/src/main.ts`、`workflow-ingest.ts`：随类型收窄调整。
- **连带修正（本轮发现的两个真实缺陷）**：
  1. **计划读投影的 `revisionId` 格式是错的**：1c-2a 写成 `String(plan.revision)`（只有数字），而 CAS 的 `parsePlanRevisionId` 要求 `<planId>:<revision>`——客户端拿这个值回送会被判为冲突，计划端点等于永远改不动。已改为 `${plan.id}:${plan.revision}` 并有测试覆盖。
  2. **连接器端口的类型过宽**：`IngestConnector.resolve`／`validate`／`fetchItems` 原先要求完整的 `SourceSnapshot`（含最近运行/错误与计划归属）。配置探测为此伪造了一个「不存在的来源」快照，本切片再往上加计划字段会变成伪造四个。改为要求 `SourceExecutionSnapshot`（目标身份 + 配置），连接器看不到产品读投影与计划归属。
- **Node 进程 E2E 又发现两个缺陷（都是本切片引入/暴露的真实行为问题）**：
  3. **API 的公开来源投影漏了计划身份**：`toPublicSource` 是字段白名单，没带 `planId`／`planRevisionId`，产品面拿不到计划的 CAS 凭据——浏览器里点「启用」会在运行期拿到 undefined，而类型检查抓不到（白名单返回的是推断对象）。已补上，并由 e2e 的 `createRssSource` 路径覆盖。
  4. **`scheduling.e2e.test.ts` 自 1c-1b 起就是坏的**：它用 `schedule:<sourceId>:<bucket>` 制造调度幂等键碰撞，而 1c-1b 已把键改成 `schedule:<planId>:<bucket>`，于是碰撞从未命中、用例静默退化成「没有冲突」，只有断言超时才暴露。已改用计划 id。这条说明 1c-1b 与 1c-2a 当时记的「未运行 test:e2e」确实藏了东西。
- **RED → GREEN**：RED（实现前实跑）为各文件的类型错误与既有断言失败；GREEN：`bun run typecheck` 全仓 **0**；新增 `packages/storage-prisma/src/collection-plan-activation.test.ts` **4/4**（计划 CAS、两个 CAS 域不互相顶替、调度按 `plan.enabled`、墓碑来源停用且不可编辑）；`bun run test` **114 文件 / 654 用例全绿**；`bun run test:e2e` **5 文件 / 6 用例全绿**（Node 进程 E2E，需 `BUN_BINARY` 指向真实 `bun.exe`，见下）。
- **门禁**：`bun run db:validate` 通过；`bun run docs:check` 715 文件 0 失败；`size-governance --fail-on-new` PASS；`git diff --check` 干净。
- **环境注意**：`bun run test:e2e` 在本机直接跑会在建库阶段失败（`spawnSync bun ENOENT`——Node 的 `spawnSync` 在 Windows 上不套 PATHEXT，找不到 `bun.ps1` 之外的 `bun`）。`scripts/e2e/helpers.ts` 已预留 `BUN_BINARY`，指向 `C:\Program Files\nodejs\node_modules\bun\bin\bun.exe` 即可；这是环境问题，不是代码问题。
- **决定与偏差**：
  - 测试重组：`source-activation.test.ts` 的 4 条激活用例随路径删除，改写为计划级等价物（`collection-plan-activation.test.ts`）；同文件里一条与激活无关的指标刷新用例移到新的 `ingest-metrics.test.ts`，没有随路径一起删掉。
  - `updateCollectionPlan` 对 no-op（把 `enabled` 设成当前值）**仍然递增 revision**：PATCH 语义下这次写确实发生了，且 CAS 已经保证调用方拿的是最新值。原来源激活的 no-op 特例是为幂等表服务的，那张表已删除。
  - `SourceInstance.enabled` 列仍在（第 4 步 contract 才删），但不再被读也不再被写；`deleteSource` 也去掉了对它的写入。
  - 未纳入本轮：媒体预算的读写归属（b2）、checkpoint 与连接器状态命名空间（c）。
- **未运行**：浏览器产品 E2E（切片 2）、真实来源验收（切片 3）。Node 进程 E2E 已跑并全绿。
- **下一步**：1c-1c-b2（媒体预算归属切换 + 从 `config` 移除 `media`）。

## 2026-09-21：切片 1c-1c-b2 开工前 —— 媒体预算归属切换的范围

- **本轮切片**：把媒体预算的**读取**从 `SourceInstance.config.media` 切到 `CollectionPlan.mediaPolicyJson`，并把 `media` 从来源配置里移除；写入口在 b1 已经是计划端点，本轮把 Web 的媒体策略保存改接过去。这是 1c-1c-a 留下的过渡期写穿透的终点。
- **仍有后果的假设**：
  - 媒体预算必须在**入队时**随执行快照固化：`resolveMediaPolicy` 的三个读取点（`ingestion-service.ts`、`workflow-ingest.ts` 的重试策略与获取策略）都吃执行快照里的值，所以计划的值要进 `SourceExecutionSnapshot`，而不是在运行时再查一次库——一次运行的中途改策略不该影响这一轮。
  - `SourceExecutionSnapshot` 里已经有 `enabled` 这个计划派生的值，加 `mediaPolicy` 与它同类：都是「入队时固化的计划自有配置」。
  - 移除 `config.media` 是**数据迁移**：已有来源的 `configJson` 里那份 `media` 要删掉，否则同一个事实会继续在库里存两份（计划那份才是读取方）。
- **下一步**：实现。

## 2026-09-21：切片 1c-1c-b2 —— 媒体预算归属切换

- **本轮切片**：媒体预算的读取方由 `SourceInstance.config.media` 改为 `CollectionPlan.mediaPolicyJson`，来源配置不再接受 `media`，Web 的媒体策略保存改接计划端点。1c-1c-a 的过渡期写穿透到此收尾。
- **改动文件**：
  1. `packages/contracts/src/base.ts`：`sourceConfigSchema`／`rssSourceConfigSchema` 去掉 `media`（RSS 是 strict，多带即校验失败）；`sourceExecutionSnapshotSchema` 增加 `mediaPolicy`（入队固化的计划配置，null 表示跟随全局默认）。
  2. `packages/storage-prisma/src/repository/sources.ts`：`createSource` 不再从配置抽取媒体策略（计划起始为 null）；`updateSource` 去掉写穿透并简化掉单语句事务；删除 `extractMediaPolicy`。
  3. `packages/storage-prisma/src/repository/helpers-4.ts`：`toSourceSnapshot` 的 `mediaPolicy` 从计划投影。
  4. `packages/storage-prisma/src/repository/helpers-3.ts`：媒体保留期清理的候选来源改读计划的 `mediaPolicy`（原先读 `config.media`）。
  5. `packages/application/src/ingestion-service.ts`、`workflow-ingest.ts`（两处）：`resolveMediaPolicy` 改吃执行快照的 `mediaPolicy`。
  6. `packages/application/src/catalog.ts`：RSS manifest 的描述性 JSON Schema 去掉 `media` 属性——它是发布投影，留着会让 schema 驱动表单（切片 3）渲染出一个 API 会拒绝的字段。
  7. `apps/api/src/app.controller/internals.ts`：`toPublicSource` 去掉 `config.media`，改为投影计划的 `mediaPolicy`。
  8. `apps/web/`：`use-source-workspace.ts` 的媒体策略保存改调 `updateCollectionPlan`；`source-actions.tsx` 与 `lib/media-policy.ts` 改读 `source.mediaPolicy`（签名接受 null）。
  9. `packages/storage-prisma/prisma/migrations/20260921080000_collection_plan_media_ownership/migration.sql`（新）：先把来源配置的最后意图同步进计划，再从 `configJson` 里 `json_remove` 掉 `media`。
  10. 测试：新增 `collection-plan-media-ownership.test.ts`（迁移两段部署）；`collection-plan-repository.test.ts` 的两条媒体用例改写为计划端点口径；`media-retry.test.ts` 的夹具改为给来源建计划；`collection-plan-backfill.test.ts` 拆成「backfill 后」与「全量迁移后」两段断言。
- **连带修正（本轮发现的真实缺陷）**：
  1. **`toPublicSource` 又漏了一个计划派生字段**：白名单没带 `mediaPolicy`，产品面的媒体策略会读成 undefined——与 b1 漏 `planId` 同一类问题（白名单返回推断对象，类型检查抓不到）。已补上并纳入 API 测试。
  2. **RSS manifest 的 JSON Schema 仍在宣传 `media`**：合同已经拒绝该字段，但发布投影还留着它。切片 3 的表单是 schema 驱动的，留着会直接渲染出一个必然被 API 拒绝的输入框。已删除。
- **RED → GREEN**：RED（实现前实跑）14 条既有用例失败（`config.media` 口径）；GREEN：`bun run typecheck` 全仓 **0**；`bun run test` **115 文件 / 655 用例全绿**；`bun run test:e2e` **5 文件 / 6 用例全绿**；**浏览器 E2E 全量 25 用例全绿**（`bunx playwright test --config playwright.config.ts`，先跑 `bun run build`）——这是本 Task 第一次把浏览器验收跑起来，此前各切片都记的是「未运行」。`e2e/browser/media-policy.spec.ts`（3 用例）覆盖的正是本轮改接的媒体策略保存路径。
- **门禁**：`bun run db:validate` 通过；`bun run docs:check` 718 文件 0 失败；`size-governance --fail-on-new` PASS；`git diff --check` 干净。
- **决定与偏差**：
  - `mediaPolicy` 进 `SourceExecutionSnapshot` 而不是运行时查库：ADR-0014 决策 4 要求策略在入队时固化，否则一轮运行中途改计划会影响这一轮。这与「计划 id 不进执行快照、由 envelope 承载」并不矛盾——前者是本轮的行为输入，后者是归属身份。连接器端口的注释同批改准确：连接器收到整份快照，但只该读目标身份与配置。
  - 迁移以**来源配置**那份为最后意图（先同步进计划、再删除），而不是以计划那份为权威：1c-1c-a 的写穿透一直在保持同步，两者本应一致；以来源为准能让迁移不依赖那段历史。
- **未运行**：真实来源验收（切片 3）。
- **下一步**：1c-1c-c（checkpoint 与连接器状态命名空间归属切换 + 命名空间重写迁移 + manifest 模板改 `plan:{id}`）。
