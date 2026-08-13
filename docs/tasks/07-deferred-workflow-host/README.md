# Task 07：Deferred Workflow、Cosmos Host 与本地 Worker 收敛

> 状态：Cosmos Host 代码实施尚未开始；nb-workflow Phase 1 Deferred Activity 的本地实现、package gates 和 Registry consumer 已通过；Cosmos Host 发布后接入仍待授权。
>
> 日期：2026-08-13

总体架构：[`../../architecture/0001-cosmos-foundation.md`](../../architecture/0001-cosmos-foundation.md)

Kernel/Host 决定：[`../../adr/0002-nb-workflow-kernel-cosmos-host.md`](../../adr/0002-nb-workflow-kernel-cosmos-host.md)

API 边界：[`../../adr/0003-service-worker-api-boundaries.md`](../../adr/0003-service-worker-api-boundaries.md)

API/DTO 草案：[`../../api/README.md`](../../api/README.md)

前序 Spike：[`../04-workflow-runtime/README.md`](../04-workflow-runtime/README.md)

设计前置 Task：[`../06-nb-workflow-kernel-convergence/README.md`](../06-nb-workflow-kernel-convergence/README.md)

Walkthrough：[`walkthrough.md`](walkthrough.md)

## 1. 目标与范围

先稳定独立的 nb-workflow Deferred Activity，再用它实现 Cosmos 本地 Durable Host、Activity Job、固定 Ingest parity 和 Worker Admin。Task 04 只提供行为证据，不整体搬运源码、migration 或平行 Kernel。

目标链路：

```text
Web → Product API → Cosmos WorkflowRun → nb-workflow Kernel
→ Activity Job → Attempt/Lease → Worker executable Action
→ Application Command → Observation/Entry/Story/FTS
→ Completion Outbox → Workflow resume
```

首条产品流程固定为：

```text
cosmos.ingest@1 → source.fetch@1 → library.ingest@1[] → source.checkpoint@1
```

## 2. 当前状态与三层基线

Cosmos 共享基线：

```text
origin/master = 61ed21e
```

当前 origin/master 已有 Next.js Web、NestJS API、固定 Ingest Worker、Prisma/SQLite、Source/Run/Job、Observation/Entry/Revision/Asset/Story、FTS5/BM25、Feed/Search/Story 查询和 SSE。当前没有基于已发布 nb-workflow 的 Cosmos Durable Host、Activity 级 Deferred Activity 恢复、Worker Admin 或 Gateway。

Task 07 必须区分当前共享主分支、未合并 Spike 和目标架构。Spike 中出现的模型、migration、测试结果不自动属于 origin/master。

| 能力 | origin/master | Task 04 Spike | Task 07 目标 |
| --- | --- | --- | --- |
| Run | 固定 Ingest Run | Workflow Run projection | WorkflowRun |
| Job | 普通持久 Job | Action Job | Activity Job |
| Attempt | lease/attempt 计数为主 | Spike 中已有部分语义 | 独立 Attempt |
| Journal | 尚无规范 Kernel Journal | Spike projection | nb-workflow Journal |
| Outbox | 当前基础事件能力 | Spike 扩展 | Completion Outbox |
| Worker | 固定 IngestionWorker | Spike Worker | Kernel-driven Worker |

历史 Spike 证据必须附带来源 commit、测试文件、完整命令、结果和是否可在当前 master 重放的结论。

```text
Spike evidence ≠ current validation
```

nb-workflow 实施基线：

```text
origin/master = af162ea
本地 dirty master = cf34d15（保护区，不能作为实现起点）
Task 03 Deferred Activity 发布合并提交 = af162ea114c2fddddf3e1cde2c654d357b217fb2
Registry package = @notnotype/nb-workflow@0.2.0
```

`@notnotype/nb-workflow@0.2.0` 已包含 Deferred Activity 公开符号。Task 03 已通过真实 Registry Node/Bun runtime 与 TypeScript declaration consumer；但这些证据仍不等同 Cosmos durable host、跨进程 waiting 恢复或生产集成。
### Phase 1 门禁结果（2026-08-13）

| 证据层 | 当前结果 | 边界 |
| --- | --- | --- |
| 行为合同 | focused：9 pass / 0 fail / 24 expect；conformance：21 pass / 0 fail / 2 expect；full：118 pass / 0 fail / 306 expect；typecheck/build passed | 使用 deterministic Memory fixture，不等同 durable Backend 或多进程恢复 |
| 真实 tarball | `bun run verify:package` 输出 `NODE_PACKAGE_SMOKE_OK`、`TARBALL_DECLARATION_CONSUMER_OK`、`ISOLATED_PACKAGE_SMOKE_OK` | 验证 Node/TypeScript 包边界和 Deferred 行为，不验证 Cosmos |
| npm Registry consumer | `@notnotype/nb-workflow@0.2.0` 已可安装；`REGISTRY_CONSUMER_OK version=0.2.0 exports=6`、`BUN_REGISTRY_IMPORT_OK function function`、TypeScript tsc passed | 证明公开包可被 Node/Bun/TypeScript consumer 使用，不证明 durable host |

因此，Phase 1 的本地行为、package 和 Registry consumer 门禁已通过；进入 Cosmos Phase 2 仍缺真实 Durable Host consumer 与已授权的 Cosmos 实施。

## 3. 已接受的架构决定

- nb-workflow 是唯一规范脚本 Kernel，负责 Activity identity、fingerprint、Journal replay、pending/waiting/resume、cancel 和 completion 冲突语义。
- Cosmos 负责 Prisma Backend、TaskStore、Job/Attempt/Lease/Retry、ValueStore、Outbox、Worker 装配和领域事务。
- Job 使用 Activity 级粒度，不把整个 Workflow Run 包成一个长任务。
- Workflow 作者目标保持透明调用：`await wf.callAction(actionReference, input)`；具体 public symbol 和 payload 由 nb-workflow Task 通过 conformance 决定。
- SQL TaskStore 是 Job/lease/终态唯一真相；WakeupBus 或 Redis 只做通知、缓存或限流。
- API 目标为 manifest-only，Worker 独占 executable，Migrator 独立；Worker Admin 不提供同步 Job execute。
- 固定 Ingest parity、恢复和 fencing 通过前，不删除旧 IngestionWorker 或 Cosmos 平行 Runtime。

## 4. 实施阶段与硬门禁

```text
Phase 0 共享文档、dirty 快照和开放 PR 审查
Phase 1 独立 nb-workflow Deferred Activity Task
Phase 2 Cosmos Prisma WorkflowBackend / ValueStore
Phase 3 Activity Job / Attempt / Lease / Completion Outbox
Phase 4 cosmos.ingest@1 parity
Phase 5 Product API 收敛
Phase 6 Worker Admin API
Phase 7 Node/browser/Docker/migration/recovery 验收并切换默认路径
```

进入 Cosmos Phase 2 的行为硬门禁是：nb-workflow 在不依赖 Cosmos、Prisma 或领域类型的情况下，能够通过行为测试表达 pending、resume、cancel、duplicate completion、冲突 completion、失败传播和 waiting 跨进程恢复。Task 03 已通过本地 Deferred conformance、package gates 和真实 Registry consumer；真实 durable Backend、外部 Worker 和跨进程恢复仍未验证。

## 5. 跨代理写入所有权

| 工作包 | 可写范围 | 不得修改 |
| --- | --- | --- |
| nb-workflow Kernel | nb-workflow 独立 Task worktree | Cosmos 代码、dirty master |
| Storage | Prisma schema、migration、Storage adapter | API、Connector、Kernel |
| Runtime | Application Job/Attempt/Lease、Host adapter | Prisma schema/migration |
| Ingest | Ingest Application/Connector 和行为测试 | Kernel、公共 DTO、schema |
| API | contracts、Nest Controller、Transport | Storage schema、Worker executable |
| QA | 默认只读 | 所有生产实现 |
| Leader | Task、walkthrough、集成和最终验证 | 用户保护区、无授权外部操作 |

Prisma schema/migration、公共 DTO 和 Task walkthrough 各自只能有一个当前写入者。每个写入代理必须登记 repository、branch、worktree、base SHA、writable file list 和隔离 test data root。

## 6. 代理权限与交付格式

Leader 可以分派、审查和控制阶段门禁，但不能仅凭阶段判断执行 commit、push、创建 PR、merge、npm publish、部署或删除 worktree；这些仍需用户授权和仓库规则。

每轮交付必须包含：

```text
目标：
范围：
实际修改：
证据：完整命令、通过/失败、关键输出
偏差：
未验证风险：
需要 leader 决定：
```

报告必须区分 focused、full、typecheck/build、Node、browser、Docker 和 real source。

## 7. 验收与停止条件

nb-workflow 至少验收：首次 pending、外部 completion 后恢复、透明结果、重复 completion 幂等、冲突拒绝、失败传播、cancel 后迟到结果拒绝、waiting 跨进程恢复、ValueRef 和能力不足时启动前拒绝。

Cosmos 至少验收：Prisma Backend conformance、Activity Job 幂等、双 Worker fencing、completion Outbox 可重试、固定 Ingest parity、API 不加载 executable、Worker Admin 不提供同步 execute。

分别报告 Bun development、Node production、migration、browser、Docker、Worker takeover、真实来源、长时间运行、多主机、Gateway、Redis 和 Agent；未运行不得写成完成。

遇到以下情况立即停止并记录最小复现：Deferred Activity 需要 Cosmos 类型；Kernel 无法表达 pending/resume/cancel/duplicate completion；Prisma 无法提供 revision CAS；Outbox 无法安全重试；旧 Worker 越过 lease 写领域状态；两个 Worker 同时提交同一 Activity 终态；migration 需要改写共享历史；Feed/Search/Story 回归；或代理试图覆盖 dirty worktree。

1. 保持 Task 03 的公开 API 与发布后 Registry consumer 证据，不把 `0.2.0` 的 Memory/包边界验证写成 Cosmos durable host 验证。
2. 发布和依赖边界已闭环；只有获得 Cosmos 实施授权后，才在独立 Cosmos Host worktree 中实现 Phase 2 Prisma WorkflowBackend / ValueStore。
3. 复用 Task 04 convergence 分支作为行为和 fencing 证据，逐项重建 Activity Job、双 Worker fencing、Completion Outbox 和固定 Ingest parity；历史 Spike 不作为当前验证。
4. 只有本地 Host/Worker 收敛通过后，才进入 Product API manifest-only 收敛和 Worker Admin 门禁。

本 Task 当前不授权 Cosmos Host 代码实施、发布、合并或部署；本次仅提交已获授权的文档 PR。
