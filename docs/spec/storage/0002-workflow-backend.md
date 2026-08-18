# Prisma Workflow Backend（`PrismaWorkflowBackend`）

## 状态

当前实现规格；后续代码变化应同步更新本文。本文只记录当前 `WorkflowBackend` 实现；WorkflowRun 的通用 DTO 与 Kernel 语义由 [`../application/0007-workflow-host-contract.md`](../application/0007-workflow-host-contract.md) / `@notnotype/nb-workflow` 拥有，本文件只补充 Prisma 持久化合同。

## 最后更新

2026-08-16

## 组件定位

`PrismaWorkflowBackend` 是 `@notnotype/nb-workflow` 的 durable `WorkflowBackend` 适配器。它把一个合法 `WorkflowRunState` 规范化为 `WorkflowRun.stateJson`，同步维护可查询的 status/revision/definition/finishedAt projection，并以 CAS 防止同一 Run 的旧 revision 覆盖新状态。Workflow Host 的 Envelope、Run lease、Activity Job、Completion 和 EventSink 是相邻组件，不由本 Backend 生成或调度。

### 在系统中的位置与作用
它是 Workflow Kernel 使用的 durable `WorkflowBackend`，位于 Kernel Runner 与 `WorkflowRun.stateJson` 的 Prisma 持久化之间。

### 解决的问题
它规范化并保存合法 Kernel state，同时以 revision CAS 防止旧执行结果覆盖新状态，并维护查询所需的状态投影。

### 使用方式
Host 组合根把它提供给 Kernel Runner；Runner 先 load，再以期望 revision save，marker Envelope、Run lease、Activity/Completion 和事件写入分别通过 Host Store/EventSink 完成。

### 典型情景
Workflow 开始、恢复、重放或并发执行需要读取/保存 Kernel state 时使用它；不要用它代替 Host lease 或事件适配器。


## 概念与定义

- **Kernel state**：`WorkflowRun.stateJson` 中的 JSON-safe `WorkflowRunState`。要求 runId、Definition、input、extensionContext、status、数组字段、时间等都存在并满足实现验证器。
- **Kernel revision**：`WorkflowRun.kernelRevision` 与 state.revision 的同值持久投影。成功 save 将期望 revision 加一。
- **Envelope marker**：精确三字段 `{kind: "cosmos.workflow-envelope", version: 1, runId}` JSON sentinel，表示 Host 已创建 Envelope 但 Kernel 尚未采用 state。它不是用户可用的 Workflow state。
- **Projection**：WorkflowRun 表中的 status、resumeRequired、definition key/version/hash、created/updated/finishedAt 必须与 state 对应字段一致；不一致按完整性错误拒绝读取。
- **Run lease**：`saveRunWithLease`/`createRunWithLease` 使用 application 的 `WorkflowRunLease` owner/token/expiry。它与 revision CAS 是两个独立的写入条件。

## 外部行为

### 创建、读取和列表

`createRun(initial)` 要求输入 revision 为 0，先规范化并验证 state，然后在事务中按 runId 查找：不存在则创建 `WorkflowRun`；存在精确 marker 则采用该 envelope 行，否则返回 revision conflict。并发 unique race 会重新读取 winner，再执行同样的 marker adoption/conflict 判定。成功返回 structured clone 的规范化 state。

`loadRun(runId)` 查找单行；不存在返回 `null`；精确 envelope marker 行对 Kernel 隐藏并返回 `null`；其它行解析 JSON、验证 state 并验证表 projection 后返回 clone。`listRuns()` 按 `(createdAt ASC, id ASC)` 读取，过滤 marker 行后逐行执行同样的完整性验证。

`createRunWithLease(initial, lease, now)` 只对已存在的 WorkflowRun 执行 adoption；要求 initial revision 0、行存在、owner/token 相等且 expiry 严格大于 now。然后在同一事务中以 marker/state revision 和 lease 条件 adopt；不存在或 lease 过期/错误抛出错误。它不会创建一个缺失的 Run。

实现没有 `deleteRun` 或其它删除 API；WorkflowRun 的删除若由 Prisma 外部调用，将遵守 schema 关系，但不属于本接口合同。

### 保存和 CAS

`saveRun(next, expectedRevision)` 先按 runId 读取并解析当前 state，验证 immutable identity（runId、definition、input、extensionContext、createdAt）未变，再把 next 规范化为 revision `expectedRevision + 1`。`updateMany` 的成功条件至少包含 `id` 和 `kernelRevision = expectedRevision`；受影响行数必须为 1，随后重新读取行并返回。旧 revision 或并发 winner 返回 `WorkflowBackendConflictError`；缺行返回 `WorkflowRunNotFoundError`。

`saveRunWithLease(next, expectedRevision, lease, now)` 还要求 row.id、lease.runId、runLeaseOwner、runLeaseToken、runLeaseExpiresAt > now 全部匹配；CAS update 的 where 同时包含 expected revision 与 owner/token/expiry。revision 正确但 lease 丢失抛 `WorkflowStateIntegrityError`，不会写入 state。两类 save 都会把 terminal finishedAt projection 写到同一事务更新中。

同一 Backend 实例内，save 按 runId 使用 process-local promise lock 串行化；Kernel completion 冲突路径会暂缓释放该锁，等待两次后续 load。该锁不是跨进程 durability 或数据库锁替代，真正的跨 worker 保护仍是数据库 CAS/lease predicate。

### 状态校验和投影

输入 state 必须是 object、不能是 array；definition 的 key/version/manifestHash、runId、status、createdAt、updatedAt 必须为非空字符串，日期必须可解析。status 只接受 `running`、`waiting`、`completed`、`failed`、`cancelled`。`input` 与 checkpoint/result（若存在）必须是 WorkflowValue；extensionContext、budget、progress、数组字段和整个 state 必须 JSON-safe；logs 的每一项必须是 string。

WorkflowValue 只接受 `{kind: "inline", value: JSON}` 或 `{kind: "ref", ref: {key, hash, byteSize, mediaType: "application/json"}}` 的形状。Backend 只验证 JSON-safe、非负 safe integer byteSize 和 application/json mediaType；Blob 文件本身的 hash/key/byte-size 校验由 ValueStore 负责。

读取时 state 的 runId、Definition、status、revision、resumeRequired、时间和表 projection 必须一致。非 terminal 状态的 `WorkflowRun.finishedAt` 必须为 null；terminal 状态的 finishedAt 必须等于 state.updatedAt。任一 JSON 损坏、字段缺失、投影不一致或 immutable identity 改变都 fail closed。

## 输入

- `WorkflowRunState`、`WorkflowValue`、`BackendCapabilities`、`WorkflowBackendConflictError` 等共享类型来自 `@notnotype/nb-workflow`；Run lease 来自 `@cosmos/application`。本组件不复制公共 DTO。
- `createRun`/`createRunWithLease` 的 initial revision 必须为 0；`saveRun*` 的 expectedRevision 是调用者最近一次成功读取的 kernel revision。
- runId、Definition 字段、时间字符串不能为空；JSON 字段不可包含 undefined、函数、BigInt 或二进制对象。
- `createWorkflowEnvelopeMarker` 的 runId 必须为非空字符串；`isWorkflowEnvelopeMarker` 只接受精确三键 shape，可选再校验指定 runId。
- `now` 由 lease-aware 方法接受，默认当前时间；expiry 必须是有效 Date 且严格晚于 now。

## 输出

成功创建/保存返回规范化的 `WorkflowRunState`，其中 revision 是数据库 kernelRevision，所有 JSON 值均为 structured clone。读取 marker 行返回 `null`，因此 Kernel caller 看不到未采用的 Host envelope。`capabilities` 是冻结对象：`durability=durable`、`processRestart=true`、`concurrentExecution=true`、`multiWorker=true`、`leases=true`、`externalReceipts=true`、`valueReferences=true`；durableSignals、durableTimers、childWorkflows、outbox 均为 false。

## 状态与持久化

权威表为 Prisma `WorkflowRun`：

| 字段 | 作用 |
| --- | --- |
| `id` | Workflow runId 主键 |
| `stateJson` | canonical JSON Kernel state 或 envelope marker |
| `kernelRevision` | 与 state.revision 对应的 CAS 版本，默认 0 |
| `status` / `resumeRequired` | state projection |
| `definitionKey` / `definitionVersion` / `manifestHash` | Definition projection |
| `createdAt` / `updatedAt` / `finishedAt` | 时间 projection；finishedAt 只在 terminal state 存在 |
| Host 字段 | `idempotencyKey`、input/product snapshot、run lease 等由 Host Store 使用，本 Backend 只在 row projection/lease predicate 中读取需要的字段 |

`20260813160000_workflow_run_backend` 创建初始 WorkflowRun 表；`20260814090000_workflow_activity_host` 增加 Host envelope/lease/snapshot 时间字段。后续 ingest migration 只为其它领域表增加 Workflow provenance，不改变 Backend CAS 合同。

## 状态转换

- 新 Kernel Run：`revision = 0`，状态由输入指定但必须是 running/waiting/completed/failed/cancelled；`createRun` 写入 state 与 projection。
- Host marker adoption：marker 行保持相同 runId、createdAt 和现有 revision（通常 0），`createRun`/`createRunWithLease` 以完整 Kernel state 原子替换 marker，并同步 projection；已存在非 marker state 不可被 createRun 覆盖。
- 普通 save：`expectedRevision = n` 且 row revision 仍为 n 时，state/revision/status/projection 一起写为 n+1；成功后旧 n 不再可写。
- Terminal：状态进入 completed/failed/cancelled 时 `finishedAt = updatedAt`；从非 terminal 进入 terminal 后，后续 save 若输入 immutable identity 不变仍由 CAS 控制。非 terminal 状态的 finishedAt 必须清空。
- 删除、durable signal、timer、child workflow 和 outbox 没有本接口状态转换。

## 副作用

每个 create/adopt/save 在 Prisma transaction 中写 `WorkflowRun`；保存成功后再次读取 winner 以返回 durable projection。读取会解析 JSON、clone 对象并可能因损坏抛错，但不改数据库。save lock 只产生当前进程内存状态，不写表、不跨进程共享。Backend 不写 DomainEvent、Blob、日志或外部网络。

## 错误与降级

- 不存在 Run：`WorkflowRunNotFoundError`；期望 revision 与当前 revision 不同或非 marker 行重复创建：`WorkflowBackendConflictError`。
- state JSON 损坏、字段/数组/WorkflowValue/日期非法、immutable identity 改变或表 projection 不一致：`WorkflowStateIntegrityError`。
- lease-aware create/save 的 owner/token 不同、expiry 为空或不再大于 now：`WorkflowStateIntegrityError`；条件更新为 0 后重新读取，按缺行、revision conflict 或 lease integrity 区分。
- 初始 revision 非 0、空 marker runId 等输入错误由普通 Error 拒绝；不会静默修正。
- 没有把损坏 state 降级为空 Run，也没有在缺失 Blob 时由 Backend 自动读取或重建 Value。

## 依赖

依赖 `@notnotype/nb-workflow@0.2.0` 的 Backend/JSON/错误合同、Prisma Client/SQLite 和 `@cosmos/application` 的 `WorkflowRunLease` 类型。`PrismaWorkflowHostStore` 负责先创建 marker envelope/Run lease；`BlobWorkflowValueStore` 负责 ref 的文件完整性；Kernel Runner 负责 journal/replay。

## 配置

本组件没有独立环境变量。PrismaClient 由组合根提供并使用 storage-prisma 的 `DATABASE_URL`/Data Root 配置；CAS lease 的 leaseMs/now 由调用者传入。数据库必须先应用 WorkflowRun migration；缺表会暴露为 Prisma 错误而不是被 Backend 模拟。

## 重建验收

1. 在隔离 SQLite 上创建 revision 0、合法 JSON state；`createRun` 后 `loadRun` 返回同 runId/definition，数据库 `kernelRevision = 0`，且重新建立 Prisma client 仍能读回。
2. 对同一 Run 用 expectedRevision 0 保存一个 terminal state；返回 revision 1，`WorkflowRun.finishedAt` 等于 state.updatedAt；再次以 expectedRevision 0 保存必须得到 `WorkflowBackendConflictError`。
3. 修改已存在 Run 的 input 或 definition 后调用 save；观察到 `WorkflowStateIntegrityError`，数据库 stateJson/revision 不变。
4. 直接插入精确 envelope marker 行；`loadRun`/`listRuns` 不返回它；以相同 runId、createdAt 的 initial state 调用 `createRun`，marker 被原子采用并随后可由 `loadRun` 读取。
5. 使用错误 owner/token 或已过期 expiry 调用 `saveRunWithLease`；调用失败且 stateJson、kernelRevision、finishedAt 均不变；使用当前 lease 和 expected revision 才能成功递增。
6. 把 stateJson 改为非法 JSON 或把 projection status/revision 改成与 state 不同；`loadRun` 抛 `WorkflowStateIntegrityError`，不返回部分 state。
7. 读取 `capabilities` 时精确观察 durable/processRestart/concurrentExecution/multiWorker/leases/externalReceipts/valueReferences 为 true，durableSignals/durableTimers/childWorkflows/outbox 为 false。

## 实现与测试锚点

- `packages/storage-prisma/src/workflow-backend.ts:18-82`：完整性错误、marker 常量/构造/识别、capabilities；`:98-417`：create/load/save/createRunWithLease/list 与 process-local save lock；`:420-503`：completion conflict 和 marker adoption；`:505-752`：row projection、state normalization、WorkflowValue/immutable/projection/finishedAt 校验。
- `packages/storage-prisma/prisma/migrations/20260813160000_workflow_run_backend/migration.sql`：WorkflowRun 初始表和 status/updatedAt index；`20260814090000_workflow_activity_host/migration.sql`：idempotency、snapshot、Run lease、started/finishedAt 字段。
- `packages/storage-prisma/src/workflow-backend.test.ts:39-68`：nb-workflow backend/runner/deferred Activity conformance；`:70-127`：重启 round-trip、revision conflict、immutable/missing/corrupt state；`:129-190`：capabilities、marker 隐藏与原子 adoption。

## 非目标/边界

不提供删除 API、durable signals、durable timers、child workflows、outbox、外部消息发送或跨数据库事务；不把 process-local save lock 当作多进程锁。Backend 只校验 ValueRef 的 JSON 形状和 `application/json`，不验证 Blob bytes；真实跨进程长时 recovery、双 Worker 竞态和 Docker 运行未由本组件测试证明。
