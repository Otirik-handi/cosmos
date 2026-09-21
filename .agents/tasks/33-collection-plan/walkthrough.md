# Task 33 Walkthrough（append-only）

> 2026-09-20 按文档大小治理拆出历史分册：定义阶段与数据面切片 1a～1c-1c-a 的逐片证据移入 [`walkthrough/slices-0-1c1a.md`](walkthrough/slices-0-1c1a.md)（只搬位置、不改写条目）。本文件保留仍然有效的决定与当前切片记录。
>
> 2026-09-21 再拆一册：1c-1c 的 b1 与 b2 逐片证据移入 [`walkthrough/slices-1c1c-b1-b2.md`](walkthrough/slices-1c1c-b1-b2.md)。

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

## 2026-09-21：切片 2 开工前 —— 产品面形态与三处合同补充

- **本轮切片**：把产品面从「来源健康」改造成「采集计划」并按连接分组，新建流程能选连接，从而在一个连接下建出第二个计划。1c-1c 已让计划行成为唯一事实，界面形态此时才定。
- **决定（维护者确认，记录）**：
  1. **把「来源健康」改造成「采集计划」并按连接分组**（不新增并存区块）。符合 ADR-0023 决策 5；来源名作为内容出处保留在 Feed 卡片。
  2. **`POST /sources` 增加可选 `connectionId`**：与既有 `scheduleIntervalMs` 同例——创建命令在同一步里建出来源与默认计划，连接也是计划自有字段，一步原子，不会留下「建了来源但没绑上连接」的半成品。
  3. **看板区块的 type 键 `source-health` 不动，只改显示标签**：type 是看板布局里已持久化的标识，改它要迁移；标签是用户看到的文字，随产品术语改为「采集计划」。
- **三处合同补充（计划读投影要能独立支撑产品面，记录不静默）**：
  - 计划快照增加 `lastRunAt`／`lastError`，取**归计划**的 Run／WorkflowRun（ADR-0023 决策 2 已把运行归属计划）。1c-2a 当时记的「等计划视图真正需要时再加」现在到期了。
  - 计划快照增加 `sourceRevisionId`：v1 的删除仍是目标域命令（`DELETE /collection-plans/{id}` 是 Planned），产品面要拿目标的 revision 才能发它。这是「计划引用目标」的读投影，与 `SourceSnapshot.planRevisionId` 对称。
- **仍有后果的假设**：v1 计划与目标一对一，所以按连接分组时「连接下有几个计划」等于「连接下有几个目标」；「同一目标多个计划」落地后分组逻辑不用改。
- **下一步**：实现。

## 2026-09-21：切片 2 —— Web 计划管理面

- **本轮切片**：产品面从「来源健康」改造成「采集计划」并按连接分组，新建流程能选连接，从而在一个连接下建出第二个计划。验收 3（不打开数据库就能在一个连接下建出第二个计划，并看到两个计划各自的频率与最近一次失败）达成。
- **改动文件**：
  1. `packages/contracts/src/base.ts`：`createSourceCommandSchema` 增加可选 `connectionId`（与 `scheduleIntervalMs` 同例：创建命令在同一步里建出来源与默认计划）。
  2. `packages/contracts/src/collection-plan.ts`：计划快照增加 `sourceRevisionId`（v1 删除仍是目标域命令）、`lastRunAt`／`lastError`（取归计划的 Run／WorkflowRun）。
  3. `packages/storage-prisma/src/repository/helpers-4.ts`：把「最近一次运行诊断」抽成 `latestRunDiagnostics(db, where)`，来源与计划两个读投影共用同一套口径。
  4. `packages/storage-prisma/src/repository/sources.ts`：`createSource` 把连接写进计划；`toCollectionPlanSnapshot` 变为类的 protected 方法（要取目标 revision 与运行诊断），新增 `CollectionPlanRow` 形状。
  5. `apps/api/src/app.controller/sources.ts`：创建路由先校验连接存在（否则会撞外键变成 500）。
  6. `apps/web/src/components/cosmos/collection-plan-list.tsx`（新，取代 `source-actions.tsx`）：按连接分组的计划列表，行数据来自 `CollectionPlanSnapshot`；「未绑定连接」组固定压尾。
  7. `apps/web/src/components/cosmos/source-form.tsx`：新增连接选择；标题／按钮改为「新建采集计划」「保存计划（停用）」。
  8. `apps/web/src/app/home/use-source-workspace.ts`、`page.tsx`、`status-summary.tsx`、`board-view.tsx`、`component-lab/*`：接线与术语同步（看板区块 type 键 `source-health` 不动，只改显示标签）。
  9. `e2e/browser/collection-plan-multi.spec.ts`（新）：切片 2 的验收——一个连接下两个计划，各自频率、各自启停、跑一次后失败只落在坏的那一行，刷新后仍在。
  10. 9 个既有 spec 的术语同步（`新建来源`→`新建计划` 等 36 处，先 dry run 再应用）。
- **决定（维护者确认，见开工前记录）**：改造而非并存；创建命令带 `connectionId`；看板 type 键不动只改标签。
- **连带修正（本轮发现并修掉的一处既有测试脆弱性）**：
  - `offline.spec.ts` 的「已保存图片能从 API 渲染」断言原本依赖浏览器对**屏外** `loading="lazy"` 图片的预加载时机（该图在详情面板折叠线以下，约 y=900／面板高 720）。本切片给页面加了计划与连接的加载请求后，预加载被推迟，断言开始在默认轮询窗口内超时。**先做了对照实验**：同一 spec 在 master 上 `--repeat-each=3` 3/3 通过、在本分支 3/3 失败；加长轮询窗口后本分支也能通过（`naturalWidth: 32`），证明图片本身可取、几何位置与 master 完全一致（同为 y=956、面板 720）。因此这是断言的时机假设问题，不是图片服务回归——已改为**先滚进视口再断言**，`--repeat-each=3` 3/3 稳定通过。
- **RED → GREEN**：RED（实现前实跑）为各文件的类型错误与既有断言失败（含 9 条单元用例、3 条浏览器用例）；GREEN：`bun run typecheck` 全仓 **0**；`bun run test` **116 文件 / 656 用例全绿**；`bun run test:e2e` **5 文件 / 6 用例全绿**；浏览器 E2E **26 用例全绿**（含新增的切片 2 验收）。
- **门禁**：`bun run db:validate` 通过；`bun run docs:check` 722 文件 0 失败；`size-governance --fail-on-new` PASS；`git diff --check` 干净。
- **未运行**：真实来源验收（切片 3）。
- **下一步**：切片 3（连接器选择与 schema 驱动表单），使 Bilibili 双计划能在产品面建出并跑真实来源。

## 2026-09-21：切片 3 开工前 —— 表单从硬编码 RSS 改为 manifest 驱动

- **本轮切片**：新建计划时可选来源定义（不再硬编码 RSS），字段按所选 manifest 的 JSON Schema 渲染（含 `enum` 与认证提示），使 Bilibili 计划能在产品面建出。这是 Task 33 的最后一块。
- **读到的现状（决定了改法）**：
  - `readManifestFields` 只认 `type === "string" | "integer"`，而 Bilibili manifest 的 `mode` 是**只有 `enum` 没有 `type`** 的属性——照现状它会被整条跳过，表单根本渲染不出「动态 / 推荐流」这个必填选择。
  - manifest 里 `profile` 与 `mode` 的**条件依赖**（`mode: "feed"` 才需要 `profile`）只写在 canonical Zod 的 `superRefine` 里，JSON Schema 投影表达不了。表单不做这个推断，交给服务端校验并把错误回显——这是有意的边界，不在这里复制一份规则。
- **决定（记录，不静默选择）**：
  1. **字段类型只由 manifest 的 JSON Schema 决定**：`enum` → 选择框、`integer` → 数字、`string` → 文本；三种以外不渲染，也不猜。
  2. **客户端只做能从 JSON Schema 读出来的校验**（必填、整数、最小/最大、枚举取值）；更细的规则（如 Bilibili 的条件必填）由服务端 canonical schema 裁决，错误原样回显。
  3. **认证提示按 `manifest.auth` 展示**：`kind !== "none"` 时显示 label（Bilibili 是「OpenCLI 浏览器登录态」），不在这里做凭证输入——连接才是凭证的载体（ADR-0017）。
- **仍有后果的假设**：字段值与 config 的映射是「按 manifest 属性名一一对应」，不做重命名；`scheduleIntervalMs` 仍不进 config（定时是 TriggerBinding，ADR-0018）。
- **下一步**：实现。

## 2026-09-21：切片 3 —— 连接器选择与 manifest 驱动表单

- **本轮切片**：新建计划时可选来源定义（不再硬编码 RSS），字段按所选 manifest 的 JSON Schema 渲染（含 `enum` 与认证提示），使 Bilibili 计划能在产品面建出。Task 33 的最后一块。
- **改动文件**：
  1. `apps/web/src/components/cosmos/source-form.tsx`：重写为 manifest 驱动——来源定义选择器；`readManifestFields` 支持 `enum`（→ 选择框）、`integer`/`number`（→ 数字）、`string`（→ 文本）；新增 `validateManifestFields`（必填、整数、范围、枚举取值）与 `toConfigFromFields`（按字段类型转换）；`auth.kind !== "none"` 时渲染认证提示与 label；配置字段收敛到 `config` 子对象（`config.<属性名>`）。
  2. `apps/web/src/app/home/use-source-workspace.ts`：保留目录里全部 `enabled` 定义供选择；`selectedDefinitionRef` 状态与 `selectDefinition`（切换时整组重置配置字段）；probe 与创建都改用所选定义的 ref 与首个 operationId；提交前跑字段级校验并按字段报错。
  3. `apps/web/src/app/page.tsx`、`home/page-runtime.ts`：接线与默认值（`config.feedUrl` 起始值）；删除只为 RSS 服务的 `toSourceConfig`。
  4. `apps/web/src/component-lab/product-fixtures.tsx`：新增合成的 Bilibili 定义（`mode` 只有 `enum` 没有 `type`、`auth: external`），用来覆盖这两条分支。
  5. `e2e/browser/collection-plan-connectors.spec.ts`（新）：切片 3 验收——一个 Bilibili 连接下建出「热门」与「动态」两个计划，字段来自 manifest，认证提示出现；另有一条断言必填枚举留空会在本地被拒、且切换定义会清空上一组字段。
  6. `docs/spec/interfaces/0005-web-client.md`、`docs/api/0002-product-service-api.md`：把「表单固定 `source.rss@1`」的陈述改成选择器 + 按所选定义渲染，并补上创建命令接受 `connectionId`。
- **连带修正（本轮发现的一处产品缺陷）**：必填枚举原先**静默取第一个选项**（选择框没有空选项），用户没选也会按「热门」建计划。已改为必填枚举同样保留空选项（“请选择…”），留空在本地就报「请填写采集模式。」。这是新验收 spec 的第二条用例逼出来的。
- **RED → GREEN**：RED（实现前实跑）为各文件的类型错误与既有断言失败；GREEN：`bun run typecheck` 全仓 **0**；`bun run test` **116 文件 / 656 用例全绿**；`bun run test:e2e` **5 文件 / 6 用例全绿**；浏览器 E2E **28 用例全绿**（含新增的 2 条连接器验收）。
- **门禁**：`bun run db:validate` 通过；`bun run docs:check` 723 文件 0 失败；`size-governance --fail-on-new` PASS；`git diff --check` 干净。
- **未运行（明确记录）**：**真实来源验收**。`bun run test:real:bilibili` 需要 `COSMOS_OPENCLI_PATH`（外部 OpenCLI 可执行文件）、`OPENCLI_PROFILE`（浏览器里已登录的 profile）、`COSMOS_REAL_RSS_URL` 与 `COSMOS_ALLOW_REAL_NETWORK=true`，且本机网络不可用（同轮 `git fetch` 也因 schannel 凭证失败）。因此切片 3 的验收只完成了**产品面那一半**：Bilibili 双计划能在产品面建出（浏览器 E2E 已证），真实抓取未验证。
- **下一步**：Task 33 的 v1 完成定义（expand + backfill + read switch + 产品面）已齐，剩真实来源验收与第 4 步 contract（单独排期）。
