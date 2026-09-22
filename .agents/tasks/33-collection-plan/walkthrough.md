# Task 33 Walkthrough（append-only）

> 2026-09-20 按文档大小治理拆出历史分册：定义阶段与数据面切片 1a～1c-1c-a 的逐片证据移入 [`walkthrough/slices-0-1c1a.md`](walkthrough/slices-0-1c1a.md)（只搬位置、不改写条目）。本文件保留仍然有效的决定与当前切片记录。
>
> 2026-09-21 再拆一册：1c-1c 的 b1 与 b2 逐片证据移入 [`walkthrough/slices-1c1c-b1-b2.md`](walkthrough/slices-1c1c-b1-b2.md)。
>
> 2026-09-22 再拆一册：切片 2（Web 计划管理面）与切片 3（连接器与 manifest 驱动表单）的逐片证据移入 [`walkthrough/slices-2-3.md`](walkthrough/slices-2-3.md)。

## 2026-09-20：把已完成的数据面切片并入 master，冻结剩余顺序

- **本轮切片**：不写新功能。把已验证的 1a～1c-2a 合并进 master，并把剩余四块（1c-1c、1c-2b、切片 2、切片 3）的顺序定下来。
- **合并**：`067428f merge: introduce the collection plan as a data-plane object (Task 33)`，`--no-ff`（沿用仓库既有的任务合并形态，同 Task 24）。带进 8 个提交 / 32 文件（+1201 / −60），分支 `feat/t33-collection-plan` 保留为已合并历史，worktree 继续复用。**未 push**。
- **合并前在 worktree 内的门禁**：`bun run typecheck` **0**；`bun run test` **113 文件 / 654 用例全绿**；`bun run db:validate` 通过；`bun run docs:check` 713 文件 0 失败；`size-governance --fail-on-new` PASS。
- **合并后在 master 的门禁**：`bun run typecheck` **0**（先跑了一次 `db:generate`，见发现 1）；`bun run test` **113 文件 / 654 用例全绿**；`bun run db:validate` 通过；`bun run docs:check` 721 文件 0 失败；`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` PASS（基线内 7 条 warning，不阻塞）；`git diff --check` 干净。
- **决定**：
  1. 剩余顺序冻结为 **1c-1c → 切片 2 → 切片 3**。原 walkthrough 写的「下一步是切片 2」被推翻，理由：计划行的 `enabled` 与 `mediaPolicy` 现在只是创建时从来源复制的副本，产品面若现在做，显示的启用状态与媒体预算是过期值，1c-1c 切换后还要再改一次界面。
  2. **界面形态推迟**：现有「来源健康」区块是否改造成「采集计划」并按连接分组，等 1c-1c 让计划行成为唯一事实之后再定，避免在计划行还是副本时先做一次界面。
  3. **连接器状态命名空间的 manifest 默认模板改为按计划解析**。ADR-0023 决策 2 写「模板语义不变」，按**解析对象**不变理解（仍是单一 `{id}` 占位、仍由 manifest 声明）。原记的是「改为 `plan:{id}`」，1c-1c-c 落地时证明字面照做会得到 `plan:plan:<sourceId>`（计划 id 本身已带 `plan:` 前缀），最终取**裸 `{id}`**，命名空间就是计划 id；迁移把已有 `source:<sourceId>` 重写为 `plan:<sourceId>`。内置插件（rss、collectors）都不覆盖该默认值，改 `packages/application/src/catalog.ts` 一处即可。
  4. **`docs/spec/` 的同步推迟到 1c-1c 之后一次性写**。当前读取路径一半按计划、一半按来源，现在写 spec 会被下一轮立刻改写。
- **发现（影响后续与其它工作区）**：
  1. **合并含 Prisma schema 改动的分支后，必须在目标工作区跑 `bun run db:generate`**。合并刚完成时主工作区 `bun run typecheck` 报 6 个错（`Property 'collectionPlan' does not exist on type 'PrismaClient'`、`Prisma` 无 `CollectionPlanGetPayload` 等），因为生成的 Prisma Client 只在 worktree 里更新过；`db:generate` 后归 0。生成物在 `node_modules` 下、不入库，所以这是每个拉取该 master 的工作区都要走的一步。
  2. `git fetch origin` 与 `git fetch upstream` 均失败（schannel `SEC_E_NO_CREDENTIALS`），无法确认远端是否前进；`origin/master` 停在 `5cbb670`，本地 master 领先它 3 个文档提交加这次合并。本轮只有本地合并。
  3. 任务范围里写的「行为落地后的 `docs/spec/`」至今为空：`docs/spec/` 下没有任何 CollectionPlan 内容（只有 `PROJECT-STATUS.md` 与 `Phase-2-UNDO.md` 提到）。按决定 4 排到 1c-1c 之后。
- **未运行**：`test:e2e`、浏览器产品 E2E、真实来源验收（本轮无用户可观察行为变化；浏览器验收属于切片 2）。
- **下一步**：从合并后的 master 开新分支 `feat/t33-plan-read-switch` 做 1c-1c——媒体策略读取、启用状态、checkpoint 与连接器状态命名空间改按计划，同批做命名空间重写迁移与 `config.media` 移除，并冻结 `PATCH /sources/{id}` 与 `PATCH /collection-plans/{id}` 的字段边界。

## 2026-09-20：切片 1c-1c 开工前 —— 冻结字段边界与启用入口

- **本轮切片**：1c-1c 的读取切换。开工前先冻结两处 README 标为「待实现期决定」的项，再拆成自洽的子切片；本轮只做 1c-1c-b1（见下）。
- **冻结的字段边界**（写入 API Draft §4.3）：
  - `PATCH /collection-plans/{id}` 是计划自有字段的**唯一**写入口：计划名、连接、调度间隔、媒体预算、启用状态。
  - `PATCH /sources/{id}` 只写采集目标自身的字段：来源名（内容出处的名字）与目标配置 `config`（不含 `media`）。
  - 创建路径不变：`POST /sources` 仍接受 `scheduleIntervalMs`，因为它在同一步里建出来源与默认计划。
- **决定（记录，不静默选择）**：
  1. **计划的启用状态走 `PATCH /collection-plans/{id}` 的 `enabled`，不新增计划级 activation-commands**。理由：API Draft §4.3 没有为计划定义 activation 路由；PATCH 已带 `baseRevisionId` CAS，足以阻止并发覆盖；启用/停用不产生新事实，不需要幂等键。同批**删除** `POST /sources/{id}/activation-commands`、`sourceActivationCommandSchema` 与 `SourceActivationCommand` 表——它原先拥有的启用状态已归计划，留着就是第二个所有者。
  2. **v1 两个名字各自可改**：计划名由计划端点改（用户在产品面看到的是它），来源名保留为内容出处的名字，创建时同值、之后可各自演化（Feed 卡片显示来源名）。符合 ADR-0023 决策 5「来源保留为内容出处」。
  3. **1c-1c 拆三个自洽子切片**，每片可独立验证：`b1` 计划写端点 + 启用状态归属切换 + 删除来源 activation 路径；`b2` 媒体预算归属切换（读写 + 从 `config` 移除 `media`）；`c` checkpoint 与连接器状态命名空间归属切换 + 迁移重写命名空间。
- **仍有后果的假设**（本轮 b1 内成立才继续）：
  - `connectionId` 目前**没有运行期读取方**（worker 与 application 只做连接 CRUD，连接器尚未用连接认证），所以把它搬到计划不改变运行行为；连接真正参与认证时才有行为影响。
  - `SourceInstance.enabled` 列与 `CollectionPlan.enabled` 列在 b1 之后仍然并存（第 4 步 contract 才删列），但**只有计划是所有者**：来源读投影改为从计划取 `enabled`，来源列不再被读也不再被写。
- **下一步**：1c-1c-b1。

## 2026-09-21：切片 1c-1c-c 开工前 —— 计划身份必须进入执行路径

- **本轮切片**：checkpoint 与连接器状态命名空间的归属由来源改到计划，含命名空间重写迁移与 manifest 模板改按计划解析。这是 1c-1c 的最后一块。
- **一个必须推翻的前一决定**：b1 记过「计划 id 不进执行快照、由 workflow envelope 承载」。本轮证明那条走不通：checkpoint 提交发生在 **workflow action 内部**，连接器状态句柄也在 **workflow 回调里**解析，两者都拿不到 envelope，只能拿到执行快照。所以 `planId` 从产品读投影上移到 `sourceExecutionSnapshotSchema`（两个投影都有），`planRevisionId` 仍只留在产品投影（它是 CAS 凭据，不是执行输入）。b1 的措辞随之作废，理由记在这里。
- **决定（记录，不静默选择）**：
  1. **checkpoint 的 action 载荷按计划寻址**：`sourceCheckpointInputSchema`／`Output` 的 `sourceId` 改为 `planId`。理由：ADR-0023 决策 2 要求 checkpoint 按计划隔离；若 action 仍按来源寻址，「同一目标多个计划」时载荷无法区分两个计划，等于还要再改一次。
  2. **action ref 随之改名 `source.checkpoint@1` → `collection-plan.checkpoint@1`**（含 manifest hash）。理由：载荷已经按计划寻址，留着旧名字就是一个会撒谎的合同名；仓库规则不允许为兼容保留误导性命名。代价是 workflow manifest hash 变化，在途 run 不能跨版本恢复——本项目尚无生产部署，可接受。
  3. **manifest 的 `stateStoreNamespace` 默认模板按计划解析**（最终取裸 `{id}`，见上）。
  4. **迁移重写已有 `ConnectorState.namespace`**：`source:<sourceId>` → `plan:<sourceId>`。状态可重建，重写只为避免切换后白付一次全量抓取。
- **仍有后果的假设**：`plan:<sourceId>` 是 v1 一对一下的可推导映射，所以重写不需要额外查表；「同一目标多个计划」落地时命名空间已经天然按计划区分。
- **下一步**：实现。

## 2026-09-21：切片 1c-1c-c —— checkpoint 与连接器状态命名空间归属切换

- **本轮切片**：1c-1c 的最后一块。checkpoint 的寻址键由来源改为计划，连接器状态命名空间的 `{id}` 由来源 id 改为计划 id，并重写已入库的命名空间。
- **改动文件**：
  1. `packages/contracts/src/base.ts`：`planId` 由产品读投影上移到 `sourceExecutionSnapshotSchema`（两个投影都有）；`planRevisionId` 仍只留在产品投影。
  2. `packages/contracts/src/action.ts`：`sourceCheckpointInputSchema`／`Output` 的 `sourceId` 改为 `planId`。
  3. `packages/application/src/catalog.ts`：Action `source.checkpoint@1` 改名 `collection-plan.checkpoint@1`（含 manifest hash、`requiredActionRefs`）；`stateStoreNamespace` 默认模板 `source:{id}` → **`{id}`**（见下「连带修正」）。
  4. `packages/application/src/workflow-ingest.ts`：action ref 与 manifest hash 常量、checkpoint action 载荷 `planId`、`WorkflowIngestDomainPort.setWorkflowIngestCheckpoint({planId})`、Activity key 改名。
  5. `packages/application/src/workflow-control.ts`：`enqueue` 不再接受调用方另传的 `planId`，改从执行快照取（`source.planId`），checkpoint 快照按 `planId` 取。
  6. `packages/application/src/repository-port.ts`：`getCheckpoint`／`getCheckpointSnapshot`／`setCheckpoint`／`setWorkflowIngestCheckpoint` 全部改按 `planId`。
  7. `packages/storage-prisma/src/repository/{job-claims,media}.ts`：checkpoint 读写按 `planId`；`sourceInstanceId` 仍写（必填列，第 4 步才删）；领域事件改名 `collection-plan.checkpoint.committed.v1`／`superseded.v1`。
  8. `apps/worker/src/main.ts`：`resolveConnectorStateHandle` 的 `{id}` 换成 `source.planId`；`apps/worker/src/scheduling.ts` 的 `enqueue` 调用去掉 `planId`。
  9. `packages/storage-prisma/prisma/migrations/20260921160000_collection_plan_state_namespace/migration.sql`（新）：`ConnectorState.namespace` 由 `source:<sourceId>` 重写为 `plan:<sourceId>`，只认 `source:` 前缀。
  10. 文档同步（Task 范围里排到 1c-1c 之后的那项）：`docs/spec/application/{0001,0004,0006,0009}`、`docs/spec/storage/0001`、`docs/spec/interfaces/0005`、`docs/architecture/.../part-01-03.md`、`part-05-06.md`、`docs/api/0002` 的归属与命名同步更新。
- **连带修正（本轮发现的两个真实缺陷）**：
  1. **命名空间模板会写出双前缀**：`plan:{id}` 里的 `{id}` 是计划 id，而计划 id 本身已经形如 `plan:<sourceId>`，于是运行期写出 `plan:plan:<sourceId>`，与迁移重写出的 `plan:<sourceId>` 对不上——切换后旧状态查不到、新状态又写进了另一个键。默认模板改为**裸 `{id}`**：命名空间就是计划 id 本身。这是 Node E2E（`conditional-fetch` 的「验证器确实落盘」）抓出来的，单元测试看不见，因为断言与实现用的是同一个常量。
  2. **`enqueue` 有两个 planId 来源**：调用方传一个、执行快照里有一个。两者若不一致，入队记录的归属会与运行期实际用的计划（checkpoint、命名空间）对不上。改为只从执行快照取，`enqueue` 的 `planId` 参数删除。
- **RED → GREEN**：RED（实现前实跑）11 条既有用例失败；GREEN：`bun run typecheck` 全仓 **0**；`bun run test` **116 文件 / 656 用例全绿**；`bun run test:e2e` **5 文件 / 6 用例全绿**；浏览器 E2E **25 用例全绿**；新增 `collection-plan-state-namespace.test.ts`（迁移两段部署，验证重写、值保留、非本模板命名空间不动）。
- **门禁**：`bun run db:validate` 通过；`bun run docs:check` 720 文件 0 失败；`size-governance --fail-on-new` PASS；`git diff --check` 干净。
- **决定与偏差**：
  - b1 记的「计划 id 不进执行快照、由 workflow envelope 承载」被本轮推翻并已在开工前记录：checkpoint 提交与命名空间解析都在 workflow 内部，拿不到 envelope。
  - 一并跑浏览器全量时 `phase2-organization` 曾超时失败，单独复跑 8/8、全量复跑 25/25——是并发压测下的 flake，不是回归。
- **未运行**：真实来源验收（切片 3）。
- **下一步**：1c-1c 整片收口。接着按冻结顺序做切片 2（Web 计划管理面），再切片 3（连接器与 schema 驱动表单）。

> 切片 2（Web 计划管理面）与切片 3（连接器与 manifest 驱动表单）的逐片证据见 [`walkthrough/slices-2-3.md`](walkthrough/slices-2-3.md)。

## 2026-09-21：提交与编号登记

- **本轮切片**：把本分支积压的改动提交，并按维护者裁定正式登记编号。
- **提交**（worktree `feat/t33-plan-read-switch`，基于 master `97a5e72`）：
  - `559f356 feat(t33): switch enabled, media, checkpoint and connector state to the collection plan (AUT-010)`——94 文件实现（含 3 个 migration 与 4 个新测试文件）。
  - `f9b76ac docs(t33): sync the task record, spec and API draft with the delivered slices`——14 文件文档。
  - 未切成更多提交的原因：这四块工作在**文件层面交织**（`contracts/base.ts` 被 1c-1c-b1／b2／c 与切片 2 都改过，`use-source-workspace.ts` 四块都改过），按层或按切片拆会得到单独跑不过 typecheck 的提交。提交后 `bun run typecheck` 仍为 **0**，工作区干净。**未 push**。
- **编号**（维护者 2026-09-21 裁定）：
  1. **33 正式分配给本 Task**；README 的「编号 33 由 Agent 建议、待维护者确认」改为「编号 33 由维护者 2026-09-21 分配」，Follow-ups 里的待确认项删除。
  2. **`.agents/tasks/README.md` 的 Task 导航补上 32 与 33**（此前索引停在 31，32 就已经漏登记）。32 的条目未写「编号由维护者分配」，因为 Task 32 自己的 README 没有该记录，不替它补一个没有证据的日期。
- **发现（对后续 Task 有影响）**：`01–24 → 26` 的跳号不是漏号，**25 是预留号**——[`ui-surface-ownership-v1`](../../../docs/proposals/ui-surface-ownership-v1.md) 写明界面职责重划那次尝试的分支已作废，「重做时可复用编号 **Task 25**（它只存在于已作废的分支上，`master` 没有这个 Task）」。按「最大号 +1」顺延会误占它。另有 17、20、21、22、23、24 六条至今挂着「编号待维护者确认」。

## 2026-09-22：真实来源验收 —— 同一连接下 hot 与 feed 两个 Bilibili 计划

- **本轮切片**：Task 33 的最后一块验收。切片 3 当时只完成了产品面那一半（Bilibili 双计划能在产品面建出，浏览器 E2E 已证），真实抓取记为未运行。本轮把 `bun run test:real:bilibili` 从「单来源」升级为「同一连接下两个计划」，并真跑一次。
- **开工前纠正的两条既有记录**：
  1. **「本机网络不可用」是误判**。切片 3 那轮把 `git fetch` 的 schannel `SEC_E_NO_CREDENTIALS` 当成了断网；本轮实测 `node fetch https://api.bilibili.com/x/web-interface/popular` 返回 200（125ms）。缺的从来不是网络，而是 Browser Bridge 连接与浏览器里的 Bilibili 登录态。
  2. **`test:real:bilibili` 当时只建一个来源**，所以即便跑通也覆盖不到验收 2 的「同一连接下两个计划」；它的激活路径本身已随 1c-1c-b1 改成计划端点，跟得上合同。
- **改动文件**：
  1. `scripts/e2e/real-bilibili-plans.ts`（新）：双计划场景——建一个连接，在同一连接下建 hot（`mode: hot`）与 feed（`mode: feed` + `profile`）两个计划，各自启用、各跑一次 Run（**串行**：Browser Bridge 只有一个登录态，并发抓取会互相干扰浏览器窗口，那证明不了计划隔离），断言两条 Run 都 succeeded、item 数有界，再核对归属。
  2. `scripts/e2e/real-source.ts`：单来源流程收进 `runSingleSourceAcceptance`，入口按 kind 分派；`bilibili` 走双计划场景，`rss`／`aihot`／`bilibili-hot` 行为不变。
  3. `scripts/e2e/helpers.ts`：`requestJson`／`readString`／`expectJsonObject`／`waitForTerminalRun`／`assertRunSucceeded`／`boundedItemCount` 提为共享，单来源与双计划共用同一套「成功」口径（此前 `requestJson`／`readString` 是 `real-source.ts` 的私有函数）。
  4. `docs/testing/README.md`：**未改**。该段落的通用陈述（要求 Run 成功、item 数有界、日志脱敏）对双计划仍然成立，而该文件已在 [`docs/doc-governance/`](../../../docs/doc-governance/) 基线内增长到 29.3 KB（警戒 30 KB），治理目标是只减不增；入口语义变化记录在本 walkthrough。
- **验收命令与结果**（worktree `feat/t33-plan-read-switch`，`apps/api`／`apps/worker` 的 dist 为分支代码）：

  ```text
  COSMOS_ALLOW_REAL_NETWORK=true COSMOS_OPENCLI_PATH=<worktree>/node_modules/.bin/opencli.exe OPENCLI_PROFILE=<已登录 profile> bun run test:real:bilibili
  ```

  PASS（exit 0）：`Real bilibili dual-plan acceptance passed: connection <connectionId>; plan:<...>（hot）Run run_<...> with 20 items; plan:<...>（feed）Run run_<...> with 20 items; runs, checkpoints and plan diagnostics stayed per-plan.`

  断言修正后连续跑两次（两次的 connectionId 与 Run id 都不同），两次都是 hot 与 feed 各 20 items、exit 0——真实抓取结果随热门榜与动态流变化，但「两个计划各自成功且归属不串台」稳定成立。
- **断言的实际内容**（归属读隔离库的落库事实，不是 API 自报）：
  1. 两个计划都列在同一个 `connectionId` 下，且计划与来源两两不同。
  2. 两条 `WorkflowRun`（产品 Run id 就是它的主键）各自的 `planId`／`sourceInstanceId` 指向自己的计划与来源。
  3. 每个计划恰有一行 `Checkpoint`，落在自己的来源上。
  4. 每个计划读投影的 `lastRunAt` 非空、`lastError` 为 null——各自的运行诊断不串台。
- **一个必须纠正的断言假设**：最初还断言 legacy `Run` 表按 `planId` 归属，实测为空——验收栈开着 `COSMOS_WORKFLOW_HOST_ENABLED=true`，产品 Run 由 `WorkflowRun` 承载，legacy `Run` 行在这条路径上不产生。断言已按实际载体改写，**未放宽**。
- **真实环境的两次瞬时失败（如实记录，未用重试掩盖）**：
  1. `opencli bilibili feed` 首次调用返回 `COMMAND_EXEC: Pre-navigation to https://www.bilibili.com failed: Navigation rejected`，同一条命令立即重试成功——Browser Bridge 的导航竞争，与计划归属无关。
  2. 验收首跑时 hot 计划的 Run 内 `connector.opencli` 退出码 1（映射 `dependency_unavailable`，可重试），worker 按既有重试语义再跑一次成功，Run 最终 succeeded。这是**真实重试路径**的现场证据，不是脚本的补偿逻辑。
- **未覆盖（明确记录）**：本轮没有制造「错误只落在某一个计划」的真实失败（例如用未登录 profile 触发 `authentication_required`），所以「错误互不混淆」仍由行为测试与浏览器 E2E 覆盖（`e2e/browser/collection-plan-multi.spec.ts`）。Bilibili connector 不产生游标（`fetchItems` 恒返回 `nextCursor: null`），「游标互不混淆」在 Bilibili 上只能落到 checkpoint 行按计划分开，不能验成「两个游标值不同」。
- **门禁**：`bun run typecheck`（packages + apps）**0**；`scripts/e2e/**` 另用 `bunx tsc --noEmit --strict --module nodenext --types node ...` 单独检查 **0**（仓库 `typecheck` 不覆盖 `scripts/`，见发现 1）；`bun run test` **116 文件 / 656 用例全绿**；`bun run test:e2e` **5 文件 / 6 用例全绿**（本机需先设 `BUN_BINARY`，见发现 2）；`bun run docs:check` **725 文件 0 失败**；`size-governance --fail-on-new` PASS（含基线内增长 warning，未新增超标文件）；`git diff --check` 干净。
- **发现（对后续真实来源验收有影响）**：
  1. **`scripts/` 不在 `bun run typecheck` 覆盖内**。`typecheck:packages` 与 `typecheck:apps` 都不含它，所以真实来源脚本此前带着 6 个严格模式错误（`stopManagedProcess(undefined)`、闭包赋值后收窄成 `never`）也没被门禁发现；本轮顺带修掉。
  2. **本机 PATH 上的 `bun` 只有 `.ps1`**（`C:\Program Files\nodejs\bun.ps1`），`bun.exe` 在 `node_modules/bun/bin/`。`scripts/e2e/helpers.ts` 的 `applyMigrations` 用 `spawnSync("bun")`，而 vitest 是 node 进程（没有 bun 进程注入的 `BUN_BINARY`），于是 `bun run test:e2e` 在本机全部报 `spawnSync bun ENOENT`；设 `BUN_BINARY=<...>/bun.exe` 后 5 文件 / 6 用例全绿。这是本机环境问题，不是本分支回归。
- **下一步**：Task 33 的 v1 完成定义与真实来源验收都已达成；剩第 4 步 contract（从来源移除连接／触发器／预算字段）单独排期与授权，以及分支合并。

## 2026-09-22：并入 master、推送两个远端，并修掉合并后才暴露的 lint error

- **本轮切片**：把已验证的分支并入 master、同步状态文档、推送 fork 与上游。唯一的产品代码改动是修一处让 CI 变红的 lint error。
- **合并**：`4ef3636 merge: land the collection plan v1 product surface and per-plan state (Task 33)`，`--no-ff`。合并后先跑 `bun run db:generate`（本 Task 早先记录的发现 1），否则主工作区 typecheck 会报 Prisma Client 缺 `collectionPlan`。
- **状态文档**（`deeab04`）：`PROJECT-STATUS.md` 把 AUT-010／EXT-007 移出未闭合行、更新基线与最近一次全量证据；`Phase-2-UNDO.md` 把 P0-1 从「完全未交付」移出（保留交付记录与证据），P1-3 的「来源↔连接绑定」半边标记为已补、只剩连接可见性面板。
- **推送**：`origin`（fork）`5cbb670..deeab04`、`upstream` `67ce4b9..deeab04`，都是 fast-forward，未 force。
- **合并后门禁（主工作区）**：`bun run typecheck` **0**、`bun run test` **116 文件 / 656 用例全绿**、`bun run test:e2e` **5 文件 / 6 用例全绿**、`docs:check` **733 文件 0 失败**、`db:validate` 通过、size 门禁 PASS、`git diff --check` 干净。
- **CI 变红（本轮最重要的发现）**：推送后两个远端的 `Quality` job 都失败，根因是 `apps/web/src/app/home/use-source-workspace.ts:94` 的 `react-hooks/set-state-in-effect`（1 error）——该文件是切片 2／3 新增 `loadPlans` 时引入的。**本 Task 的验证矩阵里没有 `lint:web`**（typecheck 不跑 ESLint，浏览器 E2E 也不跑），所以本地全绿、CI 才暴露。这与发现 1（`scripts/` 不在 typecheck 覆盖内）同类：**「本地跑过的门禁」与「CI Quality job 实际跑的门禁」不是同一张表**。
- **修法与依据**：`react-hooks/set-state-in-effect` 会把 effect 直接调用的**局部 async 函数**内联展开，把 `await` 之后的 setState 判成同步 setState；仓库里合规的先例（`connection-panel.tsx`）是**把 setState 放进 `.then` 回调**。据此把首屏加载从 `void loadPlans()` 改为 effect 内直接 `Promise.all([...]).then(...)`，并补 `cancelled` 守卫（顺带修掉卸载后写入的隐患）；`loadPlans` 保留给 8 处事件处理器复用。
- **修复后门禁**：`bun run lint:web` **0 errors**（79 warnings）、`bun run typecheck` **0**、`bun run test` **116 文件 / 656 用例全绿**。
- **浏览器 E2E（同一 build 连跑 3 次，如实记录）**：27/28（失败在 `phase2-organization.spec.ts:103`）→ 27/28（失败**漂移**到 `collection-plan-multi.spec.ts:63`，等「录入任务已排队」15 秒超时）→ **28/28 全绿**；两个失败 spec 单跑分别 8/8 与 1/1 通过。形态与 [`known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 第 1 条一致（失败点漂移、单跑通过），观察已追加进该表。**未做修复前的整套对照**（需要重新 build），所以「这次漂移与首屏加载改动无关」目前只有「失败点与首屏加载无可解释因果 + 单跑通过」这一层证据。
- **下一步**：第 4 步 contract 单独排期与授权；`lint:web` 应补进后续 Task 的验证矩阵。
