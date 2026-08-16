# Workflow Event Sink（`PrismaWorkflowEventSink`）

## 状态

`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`。本文只描述 Prisma EventSink 的当前写入与 fencing 行为；Workflow event 输入/校验由 `@notnotype/nb-workflow` 以及 [`../application/0007-workflow-host-contract.md`](../application/0007-workflow-host-contract.md) 所有，DomainEvent 查询/replay 由 [`0001-prisma-repository.md`](0001-prisma-repository.md) 所有。

## 最后更新

2026-08-16

## 组件定位

`PrismaWorkflowEventSink` 是 Kernel/Host 运行时使用的 Workflow 事件持久适配器。它把已校验的事件写入 `DomainEvent`，并把 Run lease 作为写入前和事务内的 fail-closed fence。它只负责 durable append/idempotency，不负责向外部 broker 发布、SSE 连接、outbox 投递或事件消费。

## 概念与定义

- **Workflow event**：由 `validateWorkflowEvent` 接受的 `{type, version, payload}`；payload 以 `canonicalJson` 存储。
- **事件幂等身份**：`(workflowRunId, context.idempotencyKey)`。该组合对应 schema 的唯一索引；同身份必须是同 type/version/canonical payload 才能重放。
- **Run lease fence**：`WorkflowRun.runLeaseOwner`、`runLeaseToken`、`runLeaseExpiresAt` 与 request context 的 `runId`/lease owner/token 的同时匹配，expiry 必须严格晚于事务 now。
- **DomainEvent 行**：`eventId` 是随机 UUID，`sequence` 由 SQLite 自增；本组件不让调用者指定 sequence，也不把 Activity fence 写入 payload。

## 外部行为

`emit(request)` 无条件抛 `WorkflowHostError(code="lease_lost")`，提示 Prisma EventSink 必须获得当前 Workflow Run lease；它不会尝试无 lease 写事件。这是故意的 fail-closed 默认路径。

`emitWithLease(request, lease)` 先校验 event，再在同一个 Prisma transaction 中：

1. 用 `lease.runId` 查 WorkflowRun，要求 owner、token 相等、expiry 存在且 `expiry > now`；然后执行带完全相同条件的 guarded `updateMany`，受影响行数不是 1 就抛 lease_lost。该 guarded update 不改变业务字段，只确保检查和插入处在同一事务的当前 lease 条件下。
2. 以 `workflowRunId + idempotencyKey` 查 DomainEvent。若已存在，比较 type/version/payloadJson；完全相同直接成功返回，任一不同抛 `EventSinkConflictError`。
3. 不存在时创建 DomainEvent：随机 eventId、event type/version、canonical payload、workflowRunId、idempotencyKey。唯一键竞争后重新读取 winner，并执行同一比较；没有 winner 则保留数据库异常。

成功返回 `void`；调用者只能从后续 DomainEvent 查询观察 sequence。事件写入与 Run lease 检查在同一事务中，但它不和 Kernel state save 自动组成跨组件事务。

## 输入

- `EventSinkRequest`、`WorkflowRunLease` 和 event validator 来自 `@notnotype/nb-workflow`/application Host contract；本组件不复制 DTO。
- request.context.runId 和 idempotencyKey 作为持久身份；lease 必须包含非空 runId、owner、leaseToken，expiry 若提供必须是可解析时间。
- event 必须通过 `validateWorkflowEvent`；payload 必须能被 canonical JSON 编码。不可 JSON 的值、非法 type/version 或缺失 context 由 validator/序列化器拒绝。
- `emit` 不能绕过 lease；只有 `emitWithLease` 能进入数据库写入路径。

## 输出

成功是 `Promise<void>`，没有返回 eventId/sequence；幂等重放与首次插入对调用者同样成功。冲突是 `EventSinkConflictError`，租约错误是 `WorkflowHostError(code="lease_lost")`。DomainEvent 的 sequence、eventId 和 occurredAt 由数据库/默认值生成，须通过 Repository events 查询获得。

## 状态与持久化

本组件没有单独的内存或配置持久状态；唯一 durable 状态是 `DomainEvent`：

| 字段 | 行为 |
| --- | --- |
| `sequence` | SQLite autoincrement 主键，供 replay；调用者不能指定 |
| `eventId` | randomUUID，schema unique |
| `type`/`version` | 校验后的 event type/version |
| `payloadJson` | event payload 的 canonical JSON 字符串 |
| `occurredAt` | Prisma default now |
| `workflowRunId` | request.context.runId，关联 WorkflowRun，可 SET NULL |
| `idempotencyKey` | request.context.idempotencyKey；与 workflowRunId 组成 unique |
| aggregate/run 字段 | 本 sink 写入时不设置；其它 repository/Host event helper 可填充 |

已有同幂等身份的 DomainEvent 不会被更新；没有 delete、mark delivered、outbox status 或 external broker offset。

## 状态转换

- 不存在的 `(workflowRunId,idempotencyKey)` → 一个 append-only DomainEvent。
- 相同身份、相同 type/version/payload → 幂等成功，行数仍为 1。
- 相同身份、不同 type/version/payload → conflict，原行不变。
- Run lease 缺失、owner/token 不符、expiry 到期或 guarded update 竞争失败 → lease_lost，事件不写入。
- 数据库 unique race 若 winner payload 相同 → 幂等成功；winner 不同 → conflict。

## 副作用

每次首次成功 emitWithLease 产生一行 DomainEvent 并消耗数据库 sequence；重复 emit 不产生第二行。事务失败回滚该事件插入。该组件不发送网络请求、不写 Blob、不修改 WorkflowRun status/revision、不生成 SSE 帧。结构化日志不由 EventSink 直接生成。

## 错误与降级

- 无 lease 或 stale lease：`WorkflowHostError("lease_lost")`，fail closed，不降级为无 fence append。
- 同幂等 key 的 type/version/payload 不一致：`EventSinkConflictError`；不能以重试覆盖旧 payload。
- event 校验/canonical JSON/Prisma 非 unique 错误：原异常向上抛出；事务不会返回伪成功。
- unique race 但找不到 winner：原 unique 错误保留；不能猜测 winner。
- 本组件没有 retry/backoff/dead-letter；调用方可在保持当前 lease 的前提下重试同一请求，幂等 key 使已成功写入可安全重放。

## 依赖

依赖 `@notnotype/nb-workflow` 的 `validateWorkflowEvent`、`canonicalJson`、`EventSinkConflictError`、`EventSinkRequest`，Prisma Client/SQLite，以及 `@cosmos/application` 的 `WorkflowHostError`/`WorkflowRunLease`。Run lease 的获取/续期由 Host Store；DomainEvent replay 由 Prisma Repository；Kernel 状态由 Workflow Backend。

## 配置

无独立环境变量或持久配置。PrismaClient 的 Data Root/DATABASE_URL 由 storage 组合根提供；数据库必须包含 `DomainEvent.workflowRunId`、`idempotencyKey` 和复合 unique migration。lease 的 owner/token/expiry 由调用者传入，不能在 sink 内伪造或自动续租。

## 重建验收

1. 构造没有 lease 的 sink，调用 `emit(request)`；观察到 `WorkflowHostError.code = "lease_lost"`，DomainEvent 数不增加。
2. 创建带当前 owner/token/未来 expiry 的 WorkflowRun，调用 `emitWithLease`；观察到一个 DomainEvent，payloadJson 是 canonical JSON，workflowRunId/idempotencyKey 正确。
3. 用完全相同 request/lease 重放两次；第二次成功返回 void，查询到的 DomainEvent 数仍为 1、sequence/eventId 不变。
4. 用同一 runId/idempotencyKey 改变 type、version 或 payload；调用抛 `EventSinkConflictError`，原 DomainEvent payload 不改变。
5. 将 Run lease expiry 改为过去或 token 改变后用旧 lease 调用；调用抛 lease_lost，新的 DomainEvent 不被写入；恢复当前 lease 后新的 idempotencyKey 才能成功。
6. 让两个隔离 Prisma client 竞争同一幂等身份；最多一行 DomainEvent，winner payload 相同的调用成功，payload 不同的调用 conflict。

## 实现与测试锚点

- `packages/storage-prisma/src/workflow-event-sink.ts:13-29`：emit/emitWithLease；`:32-96`：event validation、canonical payload、unique idempotency；`:98-138`：Run lease 查询与 guarded update；`:140-165`：冲突与 unique helper。
- `packages/storage-prisma/prisma/schema.prisma:117-135`：DomainEvent 字段、WorkflowRun 关系、occurredAt/workflow index 和 `(workflowRunId,idempotencyKey)` unique；`20260814090000_workflow_activity_host/migration.sql:19-23`：新增 Workflow event provenance/idempotency 约束。
- `packages/storage-prisma/src/workflow-host-store.test.ts:56-93`：无 lease emit 拒绝、持有 lease 写入、过期 lease 拒绝与幂等行数；`packages/storage-prisma/src/workflow-host-store.test.ts:132-212`：两个 Prisma client 的 Run/Completion lease 竞争上下文。

## 非目标/边界

不提供无 lease 的兼容写入、不管理事件消费、不提供外部 outbox/broker、SSE 推送、事件删除/压缩或跨数据库事务；DomainEvent sequence 只在数据库中有序，不等同于外部网络投递顺序。跨进程长时 lease 续租和 broker delivery 未由该组件测试证明。
