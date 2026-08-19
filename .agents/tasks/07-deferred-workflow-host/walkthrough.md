# Task 07 Walkthrough：Deferred Workflow、Cosmos Host 与本地 Worker 收敛

> 本文件按 Round 追加 Task 07 的实施过程、历史基线、验证结果、偏差和 leader 判定；不得覆盖既有 Round。仓库当前提交、已验证能力和未完成边界以 [`PROJECT-STATUS.md`](../../../PROJECT-STATUS.md) 为准，稳定目标与完成定义见 [`README.md`](README.md)。

> Task：[`README.md`](README.md)

## Round 0：治理基线与只读审查

日期：2026-08-13

目标：建立一个可被 leader 和多个子代理共享的跨仓库实施基线，修复协作入口中过时的项目状态描述，并保护现有 dirty worktree。

范围：Cosmos 文档与协作规则；建立独立 nb-workflow Task worktree；只读审查 Deferred Activity 的可行性。

保护区：Cosmos 主工作区、Task 04/05 worktree、nb-workflow dirty master、nb-workflow release worktree 和 neuro-book 外部 worktree。未使用 reset、checkout、clean 或 stash。

### 基线

```text
Cosmos origin/master = 61ed21e
Cosmos governance branch = docs/t07-governance-baseline
Cosmos governance worktree = .worktree/t07-governance-baseline
nb-workflow origin/master = cb4c814
nb-workflow dirty local master = cf34d15
nb-workflow implementation worktree = nb-workflow-t03-deferred-activity
nb-workflow package latest（Round 0 历史基线）：0.1.2
```

### 实际修改

Cosmos 治理 worktree 修改：

- `CONTRIBUTING.md`、`CONTRIBUTING.en.md`：修正已有 Phase 1 运行时状态，增加 leader、worktree、文件所有权、代理交付和外部操作授权规则。
- `AGENTS.md`：增加跨仓库多 worktree 的 leader 治理和唯一写入者要求。
- `docs/README.md`、`docs/tasks/README.md`：增加 Task 07 入口并标明其尚未开始 Cosmos Host 实施。
- `docs/tasks/07-deferred-workflow-host/README.md`：增加当前主分支/Spike/目标三层基线、阶段门禁、跨代理所有权和停止条件。
- 本 walkthrough：记录本轮基线、验证和偏差。

nb-workflow worktree 当前尚未修改代码或文档。

### 只读审查结论

现有 nb-workflow Kernel 已具备 Activity identity、fingerprint、journal replay、Run CAS、waiting、cancel、ValueRef 和可复用 conformance 基础；但 `ActivityExecutor` 仍是同步 `Promise<JsonValue>`，没有 pending Activity、外部 completion reference、completion 路由、duplicate/conflict/late completion 语义。

因此 Deferred Activity 可以在 Core 内实现，但必须先增加行为合同和 conformance；不能用 `waitForSignal()` 作为长期替代，也不能先进入 Cosmos Worker/Host。

审查证据来自 `nb-workflow origin/master@cb4c814` 的静态代码检查；本轮没有在该 worktree 运行测试、build 或 package smoke。

### 验证

已运行：

- Cosmos/nb-workflow `git fetch origin`、HEAD/remote 基线和 `git worktree list --porcelain`。
- Task 07 文档、协作规则和当前文件范围的只读检查。
- 子代理对 `nb-workflow origin/master@cb4c814` 的 public API、Runner、Backend、状态和 conformance 静态审查。

未运行：

- 代码测试、typecheck、build、Node、browser、Docker、真实来源和 Cosmos 集成。

### 偏差与风险

- Task 07 初始只存在于 Cosmos dirty 主工作区；本轮已在治理 worktree 重新建立共享版本，但尚未 commit/push/merge。
- `nb-workflow` dirty master 仍落后远端 16 个提交；不能从 dirty master 开始实现。
- Cosmos 开放 PR #5/#6 尚未在本轮重放验证；它们不阻塞 nb-workflow Deferred Activity，但在 Cosmos Host 开工前必须单独审查。

### Leader 判定

继续：先完成文档门禁，再在 `nb-workflow-t03-deferred-activity` 中建立独立 Task walkthrough 和 Deferred Activity 行为测试；Kernel conformance 通过前停止 Cosmos Host 实施。

## Round 1：Deferred Activity package gate 与真实 Cosmos consumer 边界

日期：2026-08-13

目标：把 nb-workflow Phase 1 的实际验证结果接回 Task 07，并确认 Cosmos 当前哪条分支是真实 consumer；不提前实现 Cosmos Host、Worker Admin 或固定 Ingest parity。

范围：nb-workflow `nb-workflow-t03-deferred-activity`、Cosmos `origin/master`、Task 04 convergence worktree 及 Task 07 文档。保留所有 dirty worktree；不修改 Cosmos 运行时代码，不发布 npm，不 push，不创建 PR。

实际修改：

- Task 03 已在 `1caeecb` worktree 完成本地 Deferred Activity 行为实现；`bun run verify:package` 已通过 `NODE_PACKAGE_SMOKE_OK`、`TARBALL_DECLARATION_CONSUMER_OK`、`ISOLATED_PACKAGE_SMOKE_OK`。
- Task 07 README 增加 Phase 1 门禁矩阵、发布依赖边界和真实 consumer 证据；没有把 `@notnotype/nb-workflow@0.1.2` 写成已包含 Deferred Activity。
- Cosmos `origin/master@61ed21e` 仍是旧 Source Ingest Job 链路；唯一发现完整 `cosmos.ingest@1` 生产接线的是未合并的 `feat/t04-ingest-workflow-convergence` worktree。该分支只作为移植和 parity 证据，不作为 Task 07 当前代码基线。

关键决定：

1. Phase 1 的 deterministic Memory、Node/TypeScript tarball consumer 和 Deferred completion smoke 已足以证明行为侧前置条件，但不证明真实 durable Backend、外部 Worker 或跨进程恢复。
2. `0.1.2` 没有 Deferred 导出；在发布和依赖授权完成前不添加 Cosmos package 依赖、本地 shim 或假 consumer。
3. convergence 分支的 API 仍加载 Workflow/Action executable，违反 Task 07 的 manifest-only 目标；因此只能复用其 WorkflowRun、双 fence、checkpoint CAS 和 Outbox 作为待重建证据。
4. 当前没有发现已实现的 Worker Admin；不得把 Draft v0.2 或历史 Spike 文档当作 API 验收结果。

证据与验证：

```text
nb-workflow checkpoint
  1caeecbcff74d11fa196fe9eee81ca74253ee9b0

bun run verify:package
  NODE_PACKAGE_SMOKE_OK
  TARBALL_DECLARATION_CONSUMER_OK
  ISOLATED_PACKAGE_SMOKE_OK

Cosmos current code baseline
  origin/master = 61ed21e72422767462838eba162a8098ac5732fa
```

focused、conformance、full test、typecheck 和 build 结果沿用 Task 03 Round 2/3 记录；本轮没有在 Cosmos worktree 运行代码测试、typecheck、build、Node、browser、Docker、migration 或真实来源验证。

与计划的偏差：原计划可在 Phase 1 后进入 Cosmos Host；Round 1 当时审查发现 npm latest 仍是 `0.1.2`，且 `origin/master` 没有 `cosmos.ingest@1` consumer。该段是 Round 1 的历史记录；Round 3 已记录 `0.2.0` 发布后的当前状态。Task 04 convergence 分支存在可复用实现，但尚未合并且 API executable ownership 尚未满足目标，因此没有创建 Cosmos implementation worktree。

未验证和风险：npm 发布后的外部消费者、真实 Prisma Backend conformance、跨进程 waiting 恢复、双 Worker 长时间 takeover、固定 Ingest parity、API manifest-only、Worker Admin、Docker、browser、migration、Redis、Gateway、真实 Provider 和多主机均未验证。Task 04 文档中与其代码不一致的“API 已统一走 Ingest Workflow”叙述不得作为证据。

leader 判定：Phase 1 本地行为和包边界门禁通过；Cosmos Host/Worker、固定 Ingest parity、Product API 收敛和 Worker Admin 继续停止，返回规划，等待发布/接入授权。

## Round 2：Windows package gate 回归收口与 Cosmos 停止边界

日期：2026-08-13

目标：把 Task 03 最新 package gate 结果和 Windows 回归修复接回 Task 07；确认 Phase 1 仍只达到本地候选实现门禁，不把未发布包写成 Cosmos 依赖。

范围：nb-workflow `nb-workflow-t03-deferred-activity` 的 package scripts、真实 tarball consumer、focused helper test，以及本 Task 文档。没有修改 Cosmos 运行时代码、Prisma、migration、API、Worker、NeuroBook 或其它 dirty worktree。

实际修改：

- `execNpm()` 在 Windows 通过当前 Node 直接加载 npm CLI，保持 `shell: false`；这收口了 `npm.cmd` 在 Node `shell:false` 下的 `spawnSync npm.cmd EINVAL` 和此前 `DEP0190` warning。
- declaration consumer 与 isolated smoke 都通过真实 `npm install` 消费本地 `npm pack` tarball；declaration consumer 只验证类型，Deferred runtime 由 isolated smoke 验证。
- `prepublishOnly` 先运行 `bun run verify:package`（包含 build），再检查 metadata、dist 和 pack 清单；当前 dirty metadata 仍拒绝发布。

验证命令与结果：

```text
bun test test/deferred-activity.test.ts
  9 pass / 0 fail / 24 expect calls

bun test test/backend-conformance.test.ts
  21 pass / 0 fail / 2 expect calls

bun test test/package-process.test.mjs
  1 pass / 0 fail / 1 expect calls

bun test
  118 pass / 0 fail / 306 expect calls；15 个测试文件

bun run typecheck
  passed

`bun run verify:package`
  NODE_PACKAGE_SMOKE_OK
  TARBALL_DECLARATION_CONSUMER_OK
  ISOLATED_PACKAGE_SMOKE_OK

`bun run prepublishOnly`（nb-workflow clean checkpoint `9183a4f`）
  PUBLISH_READY_OK

```
偏差：第一次 Windows 修复使用 `npm.cmd`，在当前 Node `v24.13.0` 下仍触发 `EINVAL`；已改用 Node 直接加载 npm CLI，并修正 declaration consumer 的真实 tarball 安装参数。上述结果来自本地 dirty worktree；Registry `@notnotype/nb-workflow@0.1.2` 仍没有 Deferred 导出。

未验证和风险：远端 CI、npm publish、Registry 外部消费者、真实 Prisma Backend、跨进程 waiting 恢复、双 Worker takeover、固定 Ingest parity、API manifest-only、Worker Admin、browser、Docker、migration、Redis、Gateway、真实 Provider 和多主机均未验证。Cosmos `origin/master@61ed21e` 仍没有 `cosmos.ingest@1` consumer；Task 04 convergence worktree 只能作为待移植 parity 证据。

leader 判定：Phase 1 本地行为和 package gates 通过；Cosmos Host/Worker、固定 Ingest parity、Product API 和 Worker Admin 继续停止，等待发布/接入授权与独立 Cosmos implementation worktree。

## Round 3：`0.2.0` Registry 发布证据回接

日期：2026-08-13

目标：把 nb-workflow `0.2.0` 的真实 Registry 发布和 consumer 证据回接到 Cosmos Task 07，纠正 Phase 1 的版本、基线和依赖边界；不启动 Cosmos Host 实施。

范围：本 Task `README.md` 与 walkthrough。只读取 nb-workflow Task 03 Round 6、发布合并提交 `af162ea114c2fddddf3e1cde2c654d357b217fb2` 和 Registry consumer 结果；没有修改 Cosmos 运行时代码、Prisma、migration、API、Worker、NeuroBook 或其它 worktree。

实际修改：

- 将 nb-workflow 实施基线更新为发布合并提交 `af162ea114c2fddddf3e1cde2c654d357b217fb2` 与 Registry package `@notnotype/nb-workflow@0.2.0`。
- 将 Phase 1 证据拆成行为合同、真实 tarball 和 Registry consumer 三层，保留 Memory fixture、durable Backend、跨进程恢复和 Cosmos 生产集成之间的边界。
- 更新 Phase 2 入口条件：发布/依赖门禁已完成，但真实 Durable Host consumer 与 Cosmos 实施授权仍是前置条件。

验证命令与结果：

```text
来源：nb-workflow Task 03 walkthrough Round 6
npm publish --access public -> Registry `0.2.0` 可查询，dist-tags.latest = `0.2.0`
npm install @notnotype/nb-workflow@0.2.0 -> added 1 package in 1s
Node consumer -> REGISTRY_CONSUMER_OK version=0.2.0 exports=6
Bun consumer -> BUN_REGISTRY_IMPORT_OK function function
TypeScript declaration consumer -> tsc passed，退出码为 0
PR #8 verify -> SUCCESS
```

偏差：此前 Round 1/2 记录的是 `@notnotype/nb-workflow@0.1.2` 尚未发布 Deferred 的状态；本轮已按 Round 6 真实结果更新，不能把历史未发布状态继续当作当前状态。

未验证和风险：Cosmos `origin/master` 仍没有 `@notnotype/nb-workflow` consumer、Harness Adapter 或 `cosmos.ingest@1` 的 Kernel consumer；真实 Prisma Backend、跨进程 waiting 恢复、双 Worker takeover、固定 Ingest parity、API manifest-only、Worker Admin、browser、Docker、migration、Redis、Gateway、真实 Provider 和多主机仍未运行。

leader 判定：Phase 1 的发布、package 和 Registry consumer 门禁完成；Cosmos Host/Worker、固定 Ingest parity、Product API 和 Worker Admin 继续停止，等待 Cosmos 实施授权与独立实现 worktree。


## Round 4：Cosmos PR A Prisma Backend / Blob ValueStore

日期：2026-08-13

目标：在发布的 `@notnotype/nb-workflow@0.2.0` 之上建立真实 Cosmos durable Backend consumer，不复制 Task 04 Runtime。

范围：独立 worktree `t07-prisma-workflow-backend`，分支 `feat/t07-prisma-workflow-backend`，基线 `origin/master@fb73962`。可写范围为根依赖、`packages/storage-prisma`、`packages/blob-store` 和本 Task 证据；未修改受保护主工作区、Task 04/05、nb-workflow dirty master、Action/API、Job/Attempt/Outbox。

实际修改：

- 根 `package.json` 和 `bun.lock` 固定 `@notnotype/nb-workflow@0.2.0`；`packages/storage-prisma`、`packages/blob-store` 声明各自运行时依赖。
- `WorkflowRun` forward-only migration `20260813160000_workflow_run_backend` 保存完整 Kernel `WorkflowRunState` JSON、`kernelRevision`、查询投影和 `(status, updatedAt)` index。
- `PrismaWorkflowBackend` 实现 create/load/save/list、immutable identity 校验、revision CAS、损坏 JSON/projection fail-closed 和 `WorkflowRunNotFoundError`/`WorkflowBackendConflictError`。
- `BlobWorkflowValueStore` 使用 `canonicalJson` 和 `FileBlobStore`，返回并验证 `sha256`、key、byteSize、`application/json` media type。
- PR A 提交：`79cbfd5 fix: tighten workflow state validation`（包含实现提交 `2ba4341`、证据提交 `6aa5730`），已 squash 合并为 Cosmos `b678fb5`；主工作区已同步 `origin/master`，PR B worktree 已从该基线创建。

验证命令与结果：

```text
nb-workflow clean verify worktree @ b327156：
bun install --frozen-lockfile
bun test -> 118 pass / 0 fail / 306 expect calls
bun run typecheck -> passed
bun run build -> passed
bun run verify:package -> NODE_PACKAGE_SMOKE_OK / TARBALL_DECLARATION_CONSUMER_OK / ISOLATED_PACKAGE_SMOKE_OK

Cosmos PR A focused：
bun run test -- packages/storage-prisma/src/workflow-backend.test.ts packages/blob-store/src/workflow-value-store.test.ts
  2 test files / 17 tests passed
bun run typecheck:packages -> passed
bun run build:packages -> passed
bun run db:validate -> schema valid
bun run db:migrate && bun run db:status（隔离 `.cosmos`）-> 4 migrations applied / schema up to date
git diff --check -> passed
```
未验证和风险：Kernel package smoke 仍不证明 Cosmos durable recovery；PR A 未实现 lease、multi-worker、Job/Attempt、completion staged activation、EventSink/Domain Outbox、Action、API 或固定 Ingest parity。独立审查代理因 `503 Service temporarily unavailable` 重试预算耗尽，未产出审查结论。

补充验证：使用隔离数据库从前三条历史 migration 升级到 `20260813160000_workflow_run_backend`，保留 `Source/Run/Job/Entry`，输出 `BACKEND_MIGRATION_UPGRADE_OK source=1 runs=1 jobs=1 entries=1 foreignKeyErrors=0`。

leader 判定：PR A focused、package type/build、schema validate、fresh migration 和历史 migration upgrade 均通过；PR #9 已于 2026-08-14 合并为 `b678fb5`，PR B 尚未实现或提交。

## Round 5：PR A 合并、PR B dirty worktree 与执行合同冻结

日期：2026-08-15

目标：收口当前实现基线，记录 PR A/#9 合并与 PR B dirty WIP 的边界，并为后续
Activity Host 实现冻结可追溯的候选执行合同；不把 dirty WIP、PR #5/#6 或历史 Spike
写成已合并、已验证或生产能力。

历史动作（2026-08-14）：主工作区 `master` 已从 `fb73962` 通过
`git fetch origin && git merge --ff-only origin/master` 同步到 `b678fb5`；PR A #9
已 squash merge。旧的 `feat/t07-prisma-workflow-backend` 分支及其工作树已删除。

当前基线与保护区：

```text
Cosmos master = origin/master = b678fb5
PR A/#9 merge = b678fb5
PR #5 read-only source = 96e27fd
PR #6 read-only source = 498018e
T04 ingest parity source = dc78f05
T04 runtime spike source = 9fe84f2
T05 normalized content source = d0b8e03
t07-activity-host dirty worktree base = b678fb5
t07-action-contract-convergence dirty worktree base = 61ed21e
```

`t07-activity-host` 位于 `.worktree/t07-activity-host`、分支
`feat/t07-activity-host`，当前有未提交 dirty WIP；`t07-action-contract-convergence`
位于 `.worktree/t07-action-contract-convergence`，同样是保护区。两个 worktree 的
dirty 内容均不得被 reset、checkout、clean、stash、覆盖或直接当作已验收实现。
Task 04/05 worktree、PR #5/#6 只读审计来源和 `nb-workflow` dirty master 也继续是
保护区；本轮不修改它们。

PR #5/#6 都基于落后于 `b678fb5` 的旧 base，不能直接合并。PR #5 的未版本化
Action 合同已分叉，只能在当前基线上重建并重新验证；PR #6 OpenCLI 不是本四阶段
前置依赖，只保留其行为作为后续重建参考。

候选执行合同（冻结为后续实现输入，不是当前完成证明）：

- `ActionRef` 为 `namespace.operation@positive-integer`；
- `ActionDefinition` 携带 executable Zod input/output schema，
  `ActionDescriptor`/`Manifest` 只含可序列化字段；
- `executionPlacement` 仅为 `host | trusted_worker | remote_worker`；
- Host Action 的领域写入必须同时通过 Workflow Run lease、Activity Job lease 和
  SQL revision fencing；lease token 只用于内部事务校验，不进入 Job payload、Kernel
  state、manifest 或 Product/Admin DTO。

这些是后续实现的执行合同，不是已合并 API，也不表示 Activity Host、Ingest parity、
Product API 或 Worker Admin 已完成。

本阶段实际修改仅限 Task 06/07 状态文档与本 walkthrough；跳过测试、lint、formatter
和项目级验证。未运行 fresh/历史 migration、durable Deferred Activity harness、双
Worker fencing、completion crash recovery、cancel/late completion、full typecheck/
build、workflowz、Node/browser/Docker、真实来源或 PR 独立审查；这些均保持“未验证”。

与计划的偏差：PR A/#9 已合并，Phase 1 的 `@notnotype/nb-workflow@0.2.0` 已发布，
但 PR B 仍是 dirty、未提交、未验证 WIP；PR #5/#6 未直接合并，后续只能在当前基线
重建。阶段一只完成状态文档收口，跳过测试、lint、formatter 和项目级验证；不复制
Task 04 Spike 的 Kernel 或 migration。

leader 判定：冻结 `b678fb5` 为唯一共享基线；保留 PR #5/#6、T04/T05、两个 dirty
worktree 和 nb-workflow dirty master 为保护区；Activity Host 后续必须先完成自身门禁，
再决定是否进入固定 `cosmos.ingest@1` parity。

## Round 6：PR B dirty Host focused 记录（未合并、未验证）
本轮以下内容是 `t07-activity-host` dirty WIP 的历史 focused 记录，不是本阶段新运行的
门禁，也不改变 Round 5 冻结的“PR B 未提交、未验证”边界；任何实现描述均不得解释为
Activity Host 已合并或生产能力已完成。


日期：2026-08-14

目标：在 `origin/master@b678fb5` 的独立 `t07-activity-host` worktree 中完成 PR B 的 Host contract、Prisma Activity Job/lease/completion、Run lane、Activity lane 和 Completion dispatcher；不实现固定 `cosmos.ingest@1` parity、Product API 默认切换或 Worker Admin。

实际修改：

- `packages/application/src/workflow-host.ts` 恢复为干净 Host contract；不引入冗余 `activityActivationPending`，Activity Worker 只在 Kernel `stateJson.pendingActivities` 精确匹配时领取 Job。
- `packages/storage-prisma/src/workflow-host-store.ts` 实现 envelope 幂等、Run/Activity/Completion lease fencing、Activity terminal completion、`retry_wait`、max-attempts failure completion、duplicate/conflict completion 和 completion retry/dead-letter。
- execution Run claim 保留 `candidate.resumeRequired`，避免 Kernel 在 completion CAS 后持久化的 `running + resumeRequired` 与 Prisma projection 分叉；Kernel 0.2.0 的 `rerun(runId)` 不接收 signal，Runtime 仅使用 lease race 停止等待迟到结果。
- Worker 的 durable Host opt-in 目前明确拒绝空的 executable catalog；旧 Ingestion Worker 保持默认路径和 accepted-kind 隔离。

验证命令与结果：

```text
bun run db:validate
  The schema at packages\\storage-prisma\\prisma\\schema.prisma is valid 🚀

bun run --cwd packages/application typecheck
bun run --cwd packages/storage-prisma typecheck
bun run --cwd apps/worker typecheck
  三项通过

bun test packages/application/src/workflow-host-runtime.test.ts packages/storage-prisma/src/workflow-host-store.test.ts packages/storage-prisma/src/workflow-backend.test.ts
  24 pass / 0 fail / 53 expect calls

git diff --check
  通过
```

`bun run db:generate` 本轮运行但因 Windows Prisma Engine 文件被占用返回 `EPERM` rename；不能报告为通过。focused 测试使用隔离临时 SQLite 根，不读写真实 `.cosmos` 数据。

未验证和风险：`workflowz` 工具未找到，未运行；fresh/历史 migration upgrade、full package build、双 Worker 长时间 fencing、真实 completion-CAS crash 后跨进程 `rerun()`、cancel/late completion 的真实 Prisma 场景、真实 Workflow/Action production registry、Node/browser/Docker 和 PR 独立 adversarial review 未完成。Worker `COSMOS_WORKFLOW_HOST_ENABLED=true` 会显式拒绝启动，避免空 registry 被误当作生产能力；固定 Ingest parity 仍后置。

leader 判定：PR B 仍不可合并；当前 focused Host/Store 行为与类型/schema 门禁通过，但 production executable registration、migration/restart/fencing 证据和 workflowz 门禁不足。禁止 commit、push、创建 PR 或 merge，等待后续实现和授权。

## Round 7：Host/Ingest/API/Worker Admin dirty worktree 收口（历史记录，非当前结果）

日期：2026-08-15

目标：在不修改保护区、不 commit/push/创建 PR/merge 的前提下，继续审查并验证
`.worktree/t07-activity-host` 的 Activity Host、固定 Ingest vertical smoke、manifest-only
Product API 和独立 Worker Admin；明确哪些证据仍不足以标记 Task 07 完成。

实际修改：

- Application 增加 `workflow-control` 与 executable `workflow-ingest` 子路径隔离；Catalog
  提供可序列化 Source/Workflow/Action manifest，API 不再加载 Connector/Action executable。
- Product API 增加 catalog/capability、WorkflowRun 查询别名和白名单 Source/Run 投影，
  根级 `/healthz`/`/readyz` 与 API prefix 隔离；API focused 测试统一使用 Vitest。
- Prisma Repository 从持久 Activity lifecycle DomainEvent 投影 `AttemptSnapshot`，提供
  `GET /jobs/{id}/attempts` 与 `GET /attempts/{id}`，不返回 lease token；新增 Workflow
  Ingest durable fixture smoke，覆盖 source.fetch → library.ingest → checkpoint、checkpoint
  CAS、Search 和 Attempt projection。
- 新增独立 `packages/worker-admin` package：direct mode 的 loopback HTTP host、`/healthz`、
  `/readyz`、`/admin/v1/status`、`/admin/v1/capabilities`、drain endpoints 和 `/metrics`；
  drain 使用 `Idempotency-Key`、active poll/Attempt 等待和 deadline timeout，非 loopback
  绑定必须显式提供 authorize middleware。Worker 主循环接入 readiness、lane 状态、停止新
  claim、资源关闭和 Admin drain；生产构建使用独立 `tsconfig.build.json`。

关键决定：

1. Admin health/liveness、Product API 和 Worker Admin 使用不同 HTTP host/端口；Worker Admin
   不依赖 NestJS、Product DTO、Prisma 或 Connector executable。
2. `/healthz` 只报告进程存活；`/readyz` 才检查 migration/storage/catalog/lane/drain，未
   ready 返回 `503`。默认绑定 `127.0.0.1`；`0.0.0.0` 等非 loopback 地址没有显式 authorize
   时拒绝启动。
3. Admin drain 默认 `exitAfterDrain=true`；超时保持 `resourcesClosed=false`，不把活跃
   Attempt 伪装成 clean success。旧 IngestionWorker 仍保留，并在 Workflow Host 启用时停止
   调度旧路径。

验证命令与结果：

```text
bunx vitest run
  22 test files / 131 tests passed / 0 failed

bun run typecheck
  contracts、logging、domain、application、storage、blob-store、worker-admin、rss、collectors、
  transport、API、Worker、Web 全部通过

bun run build
  packages、API、Worker、Next Web 全部通过；Worker Admin package 单独编译

bunx vitest run apps/api/src/app.controller.test.ts apps/api/src/request-logging.test.ts
  2 files / 11 tests passed

Node production smoke（隔离 `.agent/tmp/worker-node-smoke-package/`）：
  Prisma db push（锁定 Prisma 6.19.3）通过；`node apps/worker/dist/main.js` 启动并监听
  loopback Admin；curl `/healthz`、`/readyz`、`/admin/v1/status`、`/metrics` 返回 200；
  POST `/admin/v1/drains` 返回 202；Worker drain 后退出码 0。
```

未验证和风险：

- 上述 Ingest 证据是 fixture 的单条 durable vertical smoke，不替代 URL/无 URL、重复轮询、
  Revision、Observation、媒体、abort/takeover、Feed/Search/Story 全矩阵；双 Worker 长时
  fencing、跨进程 completion recovery 和真实来源仍未完成本轮验收。
- Worker Admin 当前只实现 direct mode；Gateway、远程认证策略、远程 Worker、Redis、多主机、
  Docker、browser、SIGTERM/活跃 Attempt deadline 的独立人工验收仍未运行。
- 当前实现仍是 `feat/t07-activity-host` dirty、未提交、未创建 PR、未合并；共享 `master`
  仍不包含本轮 Host/API/Worker Admin 代码，不能写成 Task 07 完成。

leader 判定（Round 7 历史记录，非 Round 8 当前结果）：当时记录的 focused/full Vitest、typecheck、build、Node Admin smoke 门禁通过；Round 8 已以当前重跑结果纠正 full 数字和 Node smoke 阻塞边界，继续保留旧路径，先完成 parity/recovery/生产矩阵与只读审查，再决定是否进入可合并阶段。

## Round 8：2026-08-16 dirty worktree 验证收口（历史重跑记录，非最终结果）

目标：记录当时对当前 `.worktree/t07-activity-host` 的 focused/full 与工程门禁重跑结果；
本轮是历史记录，不能覆盖随后由当前编译产物完成的最终 Node smoke PASS，也不把任何 dirty
worktree 证据写成生产完成或 Task 07 完成。

### Node smoke 与外部运行时边界（历史失败记录）

Round 8 当时的 Node smoke 已执行 fresh `db:migrate`，6 条 migration 成功；随后在
`scripts/smoke-node.ps1` 第 66 行因 Windows PowerShell 5.1 不支持
`Invoke-WebRequest -SkipHttpErrorCheck` 阻塞。这是已修复的脚本宿主兼容性问题，属于历史
失败证据，不是当前代码失败，也不能与 Round 9 的最终 PASS 混写。Docker CLI/browser/e2e
当时仍 blocked/未验证；真实 RSS、Bilibili、OpenCLI 来源当时仍 blocked/未验证。此前缺少
`run.queued.v1` 的运行还使用了 stale dist，属于同一历史失败链路。

### 偏差、未验证与 leader 判定（Round 8 历史记录）

- Round 8 当时仍是 dirty、未提交、未 merge；共享 `master` 不包含本轮 Host/API/Worker Admin 代码。
- 完整 parity、跨进程 completion/restart recovery、长时 two-client/two-Worker fencing、
  Worker Admin SIGTERM/活跃 Attempt deadline、Docker/browser/真实来源、Gateway/Redis/多主机和
  只读生产审查当时仍未完成或未验证。
- 保留旧 IngestionWorker 作为回滚基线；在上述门禁全部通过前，不删除旧默认路径，不标记
  Task 07 或生产完成，不进入 commit/PR/merge。

Round 8 leader 判定（历史）：继续；当时只确认 focused/full、typecheck/build、Prisma
generate/validate、migration 测试边界和 two-client fencing 证据，不能解除后续 parity、
recovery、生产运行时和人工验收门禁。

## Round 9：2026-08-16 final Node durable smoke PASS（合入前历史结果，仍未合并）

日期：2026-08-16

目标：记录当前 `.worktree/t07-activity-host` 在重新 build 当前 dist 后的最终 Node durable
smoke；保留 dirty worktree、共享基线和未完成门禁边界，不把 smoke PASS 写成 Task 07 或生产完成。

范围：命令在目标 worktree 执行；不修改共享 `master = origin/master = b678fb5`，不 commit、
push、创建 PR 或 merge。

### 验证命令与结果

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'C:\Users\notnotype\Documents\CodeRepository\GithubProjects\cosmos\.worktree\t07-activity-host\scripts\smoke-node.ps1'"
cwd=C:/Users/notnotype/Documents/CodeRepository/GithubProjects/cosmos/.worktree/t07-activity-host
exitCode=0 wallTime=7.04s
fresh db:migrate: 6 migrations applied
  20260808003247_phase1_foundation
  20260808150000_collector_jobs
  20260810020829_normalized_content_model
  20260813160000_workflow_run_backend
  20260814090000_workflow_activity_host
  20260815090000_workflow_ingest
healthWorker=ready queuedStatus=queued durableRunStatus=succeeded durableRunSourceId=<source>
feedItems=3 searchItems=1 storyTitle=Fixture media metadata
sseHasRunEvent=true sseHasFeedEvent=true
apiStructuredRecords=21 workerStructuredRecords=33 durableLaneCompletedRecords=1
requestIdBridgedToDurableRun=1 requestIdBridgedToProbe=1 probeWorkerRecords=6
notFoundStatus=404 validationStatus=400
```

脚本成功走到终端 JSON，表示 log redaction 与 serialized `undefined` 检查通过。新的持久化
`run.queued.v1` event 由当前编译产物经 SSE 回放；之前缺少该 event 是 stale dist 的历史
失败证据，已通过重新 build 当前 dist 修正，不能混写成当前代码失败。

### 当前边界与判定

- 当前 `feat/t07-activity-host` 仍 dirty、未提交、未 merge；共享 `master` 不包含本轮 Host/API/
  Worker Admin 代码。
- Docker CLI 不可用，Docker/Compose 未验证；browser/e2e 配置或工具不可用，未验证；真实
  RSS、Bilibili、OpenCLI 来源未运行。
- 完整固定 Ingest parity、跨进程 durable recovery、长时双 Worker fencing、Worker Admin
  SIGTERM/活跃 Attempt deadline、Gateway/Redis/多主机和只读生产审查仍未完成或未验证。
- 因此保留旧 IngestionWorker 回滚基线，不标记 Task 07 或生产完成，不进入 commit/PR/merge。

Round 9 leader 判定：最终 Node durable smoke PASS；继续保留剩余 parity、recovery、生产运行时
和人工验收门禁。

## Round 10：2026-08-16 质量审查合同修复与最终门禁（合入前历史结果，仍未合并）

目标：收口质量审查发现的六项 P1/P2 合同缺口，并在当前源码与编译产物上重新执行全量门禁和 Node durable smoke。共享 `master = origin/master = b678fb5` 未改动；本 worktree 仍 dirty、未提交、未 merge。

实际修改：

- Worker Host 默认启用，只有显式 `COSMOS_WORKFLOW_HOST_ENABLED=false` 才关闭；API Product Run 将 `waiting/running` 映射为 `running`、`completed` 映射为 `succeeded`。
- 终态 WorkflowRun 持久化 `finishedAt`；Action manifest 的 `retryPolicy` 持久化到 Activity Job，并在执行期按 `retryableErrors` allow-list 与 manifest backoff/max-attempts 执行。
- Connector 按 validate/fetch/payload 阶段区分配置错误、瞬时依赖错误和 malformed payload；Prisma EventSink 的无 lease 调用 fail closed，持有 Run lease 时以事务内 fencing 写入。
- 删除 `packages/application/src` 下 tsc 生成的 `.js/.js.map` 遮蔽物；smoke 断言同步 Product projection 的 `succeeded` 状态。

验证命令与结果：

```text
bunx vitest run <四个合同回归文件>
  4 test files / 47 tests passed / 0 failed
bunx vitest run
  23 test files / 165 tests passed / 0 failed
bun run typecheck                 -> passed
bun run build                     -> passed
bun run db:generate               -> passed
bun run db:validate               -> passed
git diff --check                  -> passed
scripts/smoke-node.ps1            -> exitCode=0, wallTime=7.04s
  6 migrations; durableRunStatus=succeeded; feedItems=3; searchItems=1;
  run.queued.v1/feed.updated.v1 SSE; requestId bridges; redaction/undefined checks passed
```

首次 smoke 在状态映射修复后按旧的 `completed` 断言失败；该失败暴露脚本与 Product API 合同不一致，已将 smoke 断言改为 `succeeded`，随后原场景通过。Docker CLI 不可用，Docker/Compose、browser/e2e、真实 RSS/Bilibili/OpenCLI、完整 parity、跨进程 recovery、长时双 Worker fencing、Worker Admin SIGTERM/活跃 Attempt deadline、Gateway/Redis/多主机仍未验证。

Round 10 leader 判定：六项质量审查缺口已修复并有 focused/full、类型、构建、数据库和 Node smoke 证据；Task 07 仍不可标记完成，不进入 commit/PR/merge。

## Round 11：Task 07 本地快进合入与实现规格化

日期：2026-08-16

目标：在保留 Round 0–10 全部历史记录的前提下，记录旧 `packages/worker-admin` 草稿的仓库外
归档、Task 07 实现提交和 `master` 快进合入，并把合入后可重建规格的范围与未验证边界固定下来。

范围：Cosmos 主工作区、Task 07 实现提交 `5ce628690ab0110b0525e8ebcbacbe673ced9c55`、
`docs/spec/` 规格索引及其组件范围。未创建文档提交，不 push、不创建 PR，不清理任何 worktree；
本轮不把 Draft、Planned、Reserved API 或历史 Spike 当作实现证据。

### 归档与合入事实

主工作区旧草稿已完整归档到仓库外：

```text
C:\Users\notnotype\Documents\CodeRepository\cosmos-worker-admin-draft-20260816-100755Z
```

源目录与归档目录的文件集合、字节数和 SHA-256 已逐项一致；归档清单中的两份源码为：

```text
src/index.ts       33749 bytes  sha256 88b8c87d02258b728fc39b2d6bd7ee55b886fdf588f69eed9af19dd63f0e469a
src/index.test.ts   6186 bytes  sha256 e8470eeb4939525f432cdfecd87df21178e2a8bb4e0b51dbf736010423412bb0
```

旧草稿未移植进实现、未进入 Git；采用的是 Task 07 完整实现版本。实现提交信息为
`feat: add durable activity host and worker admin`。本地 `master` 从 `b678fb5` 通过
`git merge --ff-only feat/t07-activity-host` 快进到
`5ce628690ab0110b0525e8ebcbacbe673ced9c55`；`origin/master` 仍为 `b678fb5`，本地结果尚未
push。`git diff --name-only b678fb5fe1fb10d4b177957be2f2ad0a6bd2dbde..5ce628690ab0110b0525e8ebcbacbe673ced9c55 | wc -l`
结果为 `61`，即实现合入涉及 61 个文件；没有把文档提交 SHA 倒填到本轮记录。

### 功能验证命令与实际结果

以下结果来自合入前 Task 07 实现树，并作为合入提交的行为证据；本轮没有把它们扩大解释为
完整 Task 07 或发布验收：
本轮文档编辑未重跑 Vitest、typecheck、lint:web、build、db:generate、db:validate 或 Node smoke；
上面列出的工程结果均是合入前实现树的既有实际结果，不能写成本文档编辑重新验证的结果。

```text
bunx vitest run packages/application/src/workflow-ingest.test.ts packages/application/src/workflow-host-runtime.test.ts apps/api/src/app.controller.test.ts packages/storage-prisma/src/workflow-host-store.test.ts
  4 files / 47 tests passed / 0 failed
bunx vitest run
  23 files / 165 tests passed / 0 failed
bun run typecheck       -> passed
bun run lint:web        -> passed
bun run build           -> passed
bun run db:generate     -> passed
bun run db:validate     -> passed
git diff --check         -> passed
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-node.ps1
  exitCode=0; wallTime=7.04s; 6 migrations applied; healthWorker=ready; queuedStatus=queued;
  durableRunStatus=succeeded; feedItems=3; searchItems=1; storyTitle=Fixture media metadata;
  sseHasRunEvent=true; sseHasFeedEvent=true;
  apiStructuredRecords=21; workerStructuredRecords=33; durableLaneCompletedRecords=1;
  requestIdBridgedToDurableRun=1; requestIdBridgedToProbe=1; probeWorkerRecords=6;
  notFoundStatus=404; validationStatus=400;
  structured-log redaction and serialized undefined checks passed

### 规格范围与当前边界

实现规格统一归入 `docs/spec/`。`docs/spec/README.md` 固定规格职责分工、阅读顺序、统一模板、
canonical 术语、生产源码覆盖表、测试锚点和未验证边界；组件范围按索引分为 contracts/domain
（2）、application（8）、storage（6）、interfaces（5）、runtime（4）以及
connectors/operations（4），共 29 个组件规格路径。规格正文只描述
`5ce628690ab0110b0525e8ebcbacbe673ced9c55` 已合入实现的可观察行为；索引中的
`Planned for this documentation pass` 仅表示文档尚待收口，绝不表示代码能力为 Planned，
源码核对补充：合入树虽提供 manifest/catalog/control 增量，但 `apps/api/src/app.controller.ts`
仍保留 `/connectors` executable SourceProbe 路由，`packages/transport-http` 仍有
`listConnectors` 对应 `/api/v1/connectors` 调用；因此本轮不把 Product API 写成已完成
manifest-only clean cutover，旧兼容路径的收口仍是后续边界。

未运行或未完成的验收仍包括：Docker/Compose 容器、browser/e2e、真实 RSS/Bilibili/OpenCLI、
完整 Ingest parity、跨进程 recovery、长时双 Worker fencing、Worker Admin SIGTERM/活跃
Attempt deadline、Gateway、Redis/WakeupBus、远程/多主机运行及其它真实来源/生产人工验收。
因此本地快进合入不等于 push、PR、worktree 清理或 Task 07 完成；后续在本地 `master` 上继续
按这些边界补证据，保留旧路径作为回滚边界。

Round 11 leader 判定：Task 07 实现已形成本地唯一合入基线，规格范围已指向 `docs/spec/`；
剩余 parity、recovery、Docker/browser、真实来源和分布式边界继续标记为未验证，不得升格为已实现。

## 后续轮次模板

```text
### Round N：标题

目标：
范围：
负责人/子代理：
实际修改：
关键决定：
验证命令与结果：
与计划的偏差：
未验证和风险：
leader 判定：继续 / 停止 / 请求决策
```

任何“通过”都必须标明 focused、full、typecheck/build、Node、browser、Docker 或真实来源范围。

## Round 12：README 动态状态收敛

日期：2026-08-19

目标：落实 Task 治理的唯一写入分工，使 README 只保留稳定目标、范围、阶段门禁和完成定义；过程、偏差、验证和历史基线只在 walkthrough 按 Round 追加，当前仓库状态只由 `PROJECT-STATUS.md` 维护。

范围：Task 07 README、本 walkthrough，以及治理准入入口的唯一决策表收敛；不改运行时代码、测试、依赖、数据库、migration、版本、发布或部署状态。

实际修改：

- README 顶部改为稳定职责说明并链接 walkthrough、实现规格和项目状态；
- 删除 README 第 2 节复制的 SHA、worktree、阶段结果和验证矩阵；这些事实已由 Round 0–11 保留；
- 删除 Phase 0–3 中的动态完成状态和基线 SHA，把阶段内容保留为门禁合同；
- 将动态“下一步”改为由 leader 从阶段门禁、验收矩阵和完成定义选择最小未满足切片；
- walkthrough 顶部不再缓存当前状态，只声明 append-only 职责和权威状态入口；
- `repository-workflow.md` 建立 Proposal、公开 Issue、Task 和项目状态要求的唯一准入决策表，贡献指南与 Proposal 入口删除各自矩阵和例外正文，只链接该表。

关键决定：README 不记录当前 SHA、push/PR/worktree 状态、最近测试数字或未完成清单；这些事实分别归 `PROJECT-STATUS.md`、`docs/spec/` 和本 walkthrough 所有。历史 Round 不改写。准入规则只在仓库流程决策表维护。

与计划的偏差：治理审查后的第一轮修复只更新了未来写入规则并统一了多处措辞，没有迁移 Task 07 现有双写状态，也没有把准入矩阵真正收敛为唯一正文；本 Round 补齐这两项遗漏。

验证命令与结果（第一次完整验证，随后因本段写入而对最终文件状态复跑）：

```text
bun run docs:check
  failures=[]; checkedFiles=256
bun run test -- scripts/check-documentation.test.ts
  1 test file / 8 tests passed
bun run typecheck
  packages 与 apps 全部通过，exit code 0
bun run test
  29 test files / 193 tests passed
git diff --check
  exit code 0，无输出
```

上述验证段写入后，对最终文件状态复跑同一组命令：`docs:check` 仍为 `failures=[]`、`checkedFiles=256`；聚焦测试 1 文件 / 8 测试通过；typecheck 退出码 0；全量测试 29 文件 / 193 测试通过；`git diff --check` 退出码 0、无输出。

未验证和风险：build、Node E2E、浏览器、Docker、真实来源和发布验收不属于本次文档职责收敛，不由本 Round 证明。

leader 判定：Task 07 README 动态状态与治理准入矩阵收敛完成，最终五项门禁通过。
