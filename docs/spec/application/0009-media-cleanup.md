# Application：保留期清理维护 Workflow（`cosmos.media-cleanup@1`）

> 权威合同：[ADR-0015](../../adr/0015-media-retry-retention-v1.md) 决策 6–10、[`media-retry-retention-v1` Proposal](../../proposals/media-retry-retention-v1.md)
>
> 实现：`packages/application/src/media-cleanup.ts`；组合根注册见 `apps/worker/src/main.ts`；HTTP 入口见 [Product API HTTP](../interfaces/0002-product-api-http.md)

## 组件边界

`media-cleanup.ts` 注册一个工作流 Definition `cosmos.media-cleanup@1` 和一个 Action `media.cleanup@1`，并提供入队用的 `MediaCleanupWorkflowControlService`。它不拥有 Prisma、Blob Root 或 Connector；删除与降级通过 `CosmosRepository.runMediaCleanup` 端口完成。

## Definition

| 字段 | 值 |
| --- | --- |
| key / version | `cosmos.media-cleanup` / `1` |
| manifestHash | `builtin:cosmos.media-cleanup@1` |
| requires | `durability: durable`、`processRestart`、`concurrentExecution`、`multiWorker`、`leases`、`externalReceipts`、`valueReferences` |
| requiredActionRefs | `media.cleanup@1` |
| 输入 | strict `{ sourceId: string \| null, dryRun: boolean }` |
| 输出 | `MediaCleanupReport` |

工作流体只有一步：调用 `media.cleanup@1`（Activity key `media.cleanup`）并返回其报告。没有 checkpoint、cursor 或来源状态写入。

## Action `media.cleanup@1`

| 字段 | 值 |
| --- | --- |
| manifestHash | `builtin:media.cleanup@1` |
| kind / placement / effect | `library` / `host` / `none` |
| capabilities | `library:write` |
| idempotent / supportsCancellation / timeout | `true` / `true` / `null` |
| retry | `maxAttempts: 3`，`backoff: 1000` |

handler 要求 `HostActionExecutionFence`，把 `fence.workflowRunId` 与 `fence` 传给 `runMediaCleanup({ workflowRunId, fence, sourceId, dryRun })`，并输出结构化日志 `media.cleanup.completed`。

## 端口语义

`runMediaCleanup`（[Prisma Repository](../storage/0001-prisma-repository.md) 实现）：

1. 按来源读取 `config.media.retentionDays`，对 `> 0` 的来源收集 `status: saved`、`storageKey` 非空、`createdAt < now - retentionDays` 的 Asset 作为候选；无保留期配置的来源不产生候选。
2. `dryRun: true` 只汇总候选，不写任何数据、不发事件。
3. `dryRun: false` 对每个候选在一个事务里（先校验 host fence）把 Asset 更新为 `status: metadata_only`、`storageKey: null`、`byteSize: null`、`errorCode: retention_expired`、`errorMessage: 已按保留期清理（保留 N 天）`，保留 `sourceUrl`；随后统计同一 `storageKey` 是否仍有其它 Asset 引用，只有最后一个引用者才删除 Blob 字节。
4. 无论 dryRun 与否，都追加 `media.cleanup.completed.v1` DomainEvent（`aggregateType: WorkflowRun`、`aggregateId: runId`），报告是事件 payload；`getMediaCleanupReport(runId)` 读取该 Run 的最新一条。

清理不删除 Asset 行，也不产生新 EntryRevision；`contentFingerprint`、Observation、Story 均不变。

## 入队

`MediaCleanupWorkflowControlService.enqueue({ sourceId, dryRun, idempotencyKey })` 用 `findWorkflowEnvelopeByIdempotencyKey` 做幂等：同 key 同 `{sourceId, dryRun}` 返回既有 Run，同 key 不同请求抛 `WorkflowHostConflictError`。envelope 的 `productRun` 记录 `{status: "queued", sourceId, dryRun, idempotencyKey}`。

## 重建验收

- Definition 与 Action 的 ref、manifestHash、placement、capability、retry 与本文一致。
- 没有保留期配置的来源不产生候选；未到期的媒体不受影响。
- dryRun 报告与实际执行的候选集合一致，且 dryRun 不改变任何 Asset 行或 Blob。
- 执行后：Asset 行保留、`sourceUrl` 保留、`storageKey` 为空、`errorCode = retention_expired`；同一 `storageKey` 的最后一次引用才真正删除文件。
- 事件 payload 可被 `mediaCleanupReportSchema` 解析；同一 Run 的 `GET /api/v1/media-cleanups/:runId` 返回该报告。
