# Ingest Workflow 采集工作流

## 状态

`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`

## 最后更新

2026-08-16

## 组件定位

`packages/application/src/workflow-ingest.ts` 注册并实现一个工作流 Definition `cosmos.ingest@1`，以及三个 Action：`source.fetch@1`、`library.ingest@1`、`source.checkpoint@1`。

该组件负责协调来源分页抓取、逐项入库和来源 checkpoint 提交。它不拥有领域模型或持久化 schema；相关 canonical 定义见[标准化内容模型](../domain/0001-normalized-content.md)、[公共合同](../contracts/0001-public-contracts.md)和[文件 Blob Store](../storage/0005-file-blob-store.md)。

## 概念与定义

三个 runtime Action 都有 versioned ref；其 executable `ActionDefinition.manifestHash` 是可选字符串，Action Descriptor/Manifest 也是字符串 hash 的 manifest-safe projection，见 [Action Registry](0003-action-registry.md)。这里的 catalog manifest hash（对象 `{ algorithm, value }`）只属于 [Manifest Catalog](0004-manifest-catalog.md)，不能写入 Definition、Action descriptor 或 Workflow envelope。

| runtime identity | manifest hash string | kind | placement | effect |
| --- | --- | --- | --- | --- |
| `cosmos.ingest@1` | `builtin:cosmos.ingest@1:source-snapshot-v1` | Workflow Definition | durable host runtime | — |
| `source.fetch@1` | `builtin:source.fetch@1:source-snapshot-v1` | `connector` | `trusted_worker` | external |
| `library.ingest@1` | `builtin:library.ingest@1` | `library` | `host` | none |
| `source.checkpoint@1` | `builtin:source.checkpoint@1:cas-v1` | `control` | `host` | none |

`cosmos.ingest@1` 的 Definition 要求运行时支持：`durable`、`processRestart`、`concurrentExecution`、`multiWorker`、`leases`、`externalReceipts`、`valueReferences`，且均为 `true`。

`NormalizedIngestItem`、`BlobRef`、`ValueRef`、`Observation`、`Entry`、`Revision`、`Story`、`Checkpoint` 的 canonical 语义和结构不在本文重复定义，以[标准化内容模型](../domain/0001-normalized-content.md)、[公共合同](../contracts/0001-public-contracts.md)和[文件 Blob Store](../storage/0005-file-blob-store.md)为准。

## 外部行为

工作流严格按以下顺序运行：

1. 调用 `source.fetch@1`，输入 `{source, cursor}`，Activity key 为 `source.fetch`。
2. 按 `page.items` 的索引顺序调用 `library.ingest@1`，输入 `{sourceId, triggerKind, item}`，Activity key 为 `library.ingest:${index}`。
3. 根据每项结果累加 `createdEntry`、`revisedEntry`、`duplicateObservation` 三个布尔结果对应的计数；item 不并行处理。
4. 调用 `source.checkpoint@1`，输入 `{sourceId, cursor: page.nextCursor, expectedRevision: input.checkpointRevision, itemCount: page.items.length}`。
5. 写入 key 为 `ingest-page` 的 `workflow.checkpoint`。
6. 发出 `ingest.page.persisted`、版本 `v1` 的 workflow event，payload 为 `sourceId`、`triggerKind`、`itemCount`、`nextCursor`、`checkpointRevision`、`checkpointCommitted`。
7. 返回工作流输出。

## 输入

`cosmos.ingest@1` 输入严格由 `ingestWorkflowInputSchema` 校验：

```ts
{
  source: SourceExecutionSnapshot;
  cursor: string | null;
  checkpointRevision: number; // nonnegative integer
  triggerKind: "manual" | "schedule";
}
```

`source.fetch@1` 的 JSON 输入/输出是：

```ts
input: { source: SourceExecutionSnapshot; cursor: string | null }
output: { items: NormalizedIngestItemContract[]; nextCursor: string | null }
```

`library.ingest@1` 的 JSON 输入/输出是：

```ts
input: { sourceId: string; triggerKind: "manual" | "schedule"; item: NormalizedIngestItemContract }
output: { createdEntry: boolean; revisedEntry: boolean; duplicateObservation: boolean }
```

`source.checkpoint@1` 的 JSON 输入/输出是：

```ts
input: { sourceId: string; cursor: string | null; expectedRevision: number; itemCount: number }
output: { sourceId: string; cursor: string | null; revision: number; committed: boolean }
```

这些三个 Action schema 都是 strict；额外输入字段、非 JSON-safe item 值、负 revision/count 或不满足 normalized item 身份证据的 payload 均在 ActionRegistry/contract schema 边界失败。

`WorkflowBlobStore` 是 workflow ingest 的字节端口：

```ts
interface WorkflowBlobStore {
  put(content: Uint8Array, options?: { mimeType?: string | null }): Promise<{
    key: string; hash: string; byteSize: number; mimeType: string | null;
  }>;
  read(key: string): Promise<Uint8Array>;
}
```

`WorkflowIngestDomainPort` 是 host Action 的双 fence 领域端口：

```ts
persistWorkflowIngestItem(input: {
  sourceId: string; workflowRunId: string;
  triggerKind: "manual" | "schedule"; item: NormalizedIngestItem;
  fence: HostActionExecutionFence; idempotencyKey: string;
}): Promise<PersistIngestItemResult>;

setWorkflowIngestCheckpoint(input: {
  sourceId: string; workflowRunId: string;
  cursor: string | null; expectedRevision: number; itemCount: number;
  fence: HostActionExecutionFence; idempotencyKey: string;
}): Promise<SourceCheckpointOutput>;
```

生产组合中的 `PrismaCosmosRepository` 实现这两个方法；`CosmosRepository` 同名方法与端口签名一致。`WorkflowIngestDomainPort` 只接收领域运行时的 `NormalizedIngestItem`（资产 `content: Uint8Array | null`），不接收 Workflow JSON 或 BlobRef。

`SourceExecutionSnapshot` 使用[公共合同](../contracts/0001-public-contracts.md)中的 canonical 合同。

## 输出

工作流输出为：

```ts
{
  itemCount: number;
  createdEntryCount: number;
  revisedEntryCount: number;
  duplicateObservationCount: number;
  nextCursor: string | null;
  checkpointRevision: number;
  checkpointCommitted: boolean;
}
```

`itemCount` 等于本页 `page.items.length`。三个结果计数来自逐项 host Action 返回值。`nextCursor`、`checkpointRevision` 和 `checkpointCommitted` 取 checkpoint Action 的实际结果，因此 CAS 失败时反映当前已持久化 checkpoint，而不是覆盖候选值。

## 状态与持久化

## 状态转换

`source.fetch@1` 成功后，工作流从“待抓取”进入“逐项入库”；所有 item 按索引成功处理后进入“待提交 checkpoint”；checkpoint Action 返回后先写 `ingest-page` workflow checkpoint，再发出 persisted event，最后完成。

checkpoint 使用 `expectedRevision` CAS。revision 匹配时更新 cursor/revision 并返回 `committed: true`；不匹配时保留较新的 cursor/revision，返回 `committed: false`，并记录 `source.checkpoint.superseded.v1`。CAS 冲突不是覆盖写入，也不回滚已经完成的 item 入库。

任一未被运行时重试恢复的 Action 失败都会中止本次工作流运行；后续步骤和 persisted event 不执行。

## 副作用

`source.fetch@1` 先把 `SourceExecutionSnapshot` 扩展为运行时 `SourceSnapshot`（`lastRunAt: null`、`lastError: null`），调用已解析 connector 的 `validate(source)`，再调用 `fetchItems({ source, cursor, idempotencyKey, signal })`，属于外部副作用。该 Action 的返回 item 仍以 JSON-safe `NormalizedIngestItemContract` 传递；`rawPayload` 是字符串，不通过 WorkflowBlobStore 外置。

对每个状态为 `saved` 且带 `content: Uint8Array` 的 asset，`toJsonItem` 调用 `WorkflowBlobStore.put(content, { mimeType })`，并在 Workflow JSON 中写入 `{ key, hash, byteSize, mediaType }` BlobRef；非 saved、无 content 的 asset 写 `blobRef: null`。host `library.ingest@1` 再用 `readVerifiedBlob` 将 BlobRef 恢复为 bytes 后传给领域端口。

`library.ingest@1` 的 Action 元数据为 `effect: none`，但其领域端口在 host fence 与 ingest command idempotency 保护下会持久化 raw payload Blob、资产 Blob、`Observation`、`Entry`、`EntryRevision`、`Story`/`StoryRevision`、`Asset`、FTS，以及 entry/feed events。raw payload Blob 的最终写入由生产 `PrismaCosmosRepository.persistIngestItemInternal` 完成，不由 WorkflowBlobStore 的 asset 转换重复写入。

`source.checkpoint@1` 同样在 host fence 与 DomainEvent idempotency 下更新来源 checkpoint，并记录 committed 或 superseded event。工作流自身另写 `workflow.checkpoint`，再发出 type 为 `ingest.page.persisted`、version 为 `v1` 的事件。

## 错误与降级

- `ActionRegistry` 在 handler 前解析 Action 输入；输入 schema 失败是 `invalid_input`、不可重试。handler 内 payload 转换或 `SyntaxError`、`ZodError`、`XMLParserError` 映射为 `malformed_payload`、不可重试；handler 返回值无法通过输出 schema 也由 Registry 映射为 `malformed_payload`、不可重试。
- `resolveConnector` 或 `validate(source)` 抛出的已分类 `ConnectorExecutionError` 保留其 code/retryable；未分类验证/解析错误映射为 `invalid_configuration`、不可重试。
- `fetchItems({...})` 抛出的已分类 `ConnectorExecutionError` 保留其 code/retryable；未分类 fetch 错误映射为 `dependency_unavailable`、可重试。`source.fetch@1` 的 retry allow-list 仅为 `dependency_unavailable`、`timeout`、`rate_limited`。
- `toJsonItem` 期间 Blob 写入或输出 payload 处理失败走 payload 分类，成为 `malformed_payload`、不可重试。
- host Action 缺少 fence、placement 与入口不匹配或 fence 形状无效时，ActionRegistry 立即以 `invalid_input`、不可重试失败。
- host Action handler 读取 BlobRef 只使用 `readVerifiedBlob`；缺失 Blob、key/path 不匹配、SHA-256 hash 不匹配或 byteSize 不匹配会转为 `malformed_payload`、不可重试。
- fence 的数据库复核不是 ActionRegistry 能单独完成的：生产 Repository 在事务中检查 workflowRunId/run lease token 未过期且 Run 非终态、kernelRevision、workflow-activity Job 的 leased 状态/attempt/job lease token，以及 activity 的 key/path/seq/kind/fingerprint。任一复核失败时 Repository 抛出 fence-loss `Error`，ActionRegistry 对未分类 handler 异常当前包装为 `internal_error`、不可重试；不会降级成无 fence 写入。这里没有单独的公开 `lease_lost` 映射。
- checkpoint 的 Domain port 对相同 workflowRunId + idempotencyKey 重放返回已有结果；不同 sourceId 冲突抛错。CAS 失配不是异常，而是返回当前 cursor/revision 与 `committed: false`。
- `ActionRegistry` 负责输入/输出 schema 校验；运行时按 Action retry policy 重试，耗尽后错误向工作流传播，不伪造成功结果。

## 依赖

`source.fetch@1` 依赖 connector resolver、connector 的 `validate(source)`/`fetchItems({...})` 接口和 `WorkflowBlobStore`。handler 从输入快照构造运行时 source，并将 `lastRunAt`、`lastError` 设为 `null`；随后调用 `fetchItems({ source, cursor, idempotencyKey: context.idempotencyKey, signal: context.signal })`。

`toJsonItem` 将领域 `NormalizedIngestItem` 转为 `NormalizedIngestItemContract`：保存 asset content 的 bytes 外置到 WorkflowBlobStore，返回的 StoredBlob `mimeType` 在 BlobRef 中命名为 `mediaType`；`byteSize` 使用存储返回的 byteSize（asset 已提供时只作为领域 metadata 保留）。`fromJsonItem` 对非空 BlobRef 调用 `readVerifiedBlob`，将返回的 `Uint8Array` 放回领域 asset `content`。

`library.ingest@1` 和 `source.checkpoint@1` 依赖 `HostActionExecutionFence`、`WorkflowIngestDomainPort`/Repository 和 verified Blob reader。两个 handler 把 `hostContext.fence.workflowRunId` 作为 `workflowRunId`，把 `context.idempotencyKey` 原样作为端口 `idempotencyKey`；它们不从输入 payload 猜测或替换 fence。领域与存储语义分别见[标准化内容模型](../domain/0001-normalized-content.md)和[文件 Blob Store](../storage/0005-file-blob-store.md)。

## 配置

| Action | kind | placement | effect | idempotent | supportsCancellation | timeout | retry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `source.fetch@1` | `connector` | `trusted_worker` | `external` | `true` | `false` | `null` | `maxAttempts: 3`，`backoff: 1000`，仅 `dependency_unavailable`、`timeout`、`rate_limited` 可重试 |
| `library.ingest@1` | `library` | `host` | `none` | `true` | `true` | `null` | `maxAttempts: 3`，`backoff: 1000` |
| `source.checkpoint@1` | `control` | `host` | `none` | `true` | `true` | `null` | `maxAttempts: 3`，`backoff: 1000` |

三个 Action 的 idempotency key 均由 workflow runtime/context 提供；本组件不提供绕过 fence、CAS 或 ActionRegistry 的配置开关。

## 重建验收

- 注册的四个 refs、四个实现哈希以及 Definition capability requirements 与本文完全一致。
- 相同输入下，Activity 调用顺序和 key 可观测为 `source.fetch`、`library.ingest:0..n-1`、`source.checkpoint`；不存在并行 item 调用。
- raw `Uint8Array` 不出现在 workflow JSON；saved content 可由生成的 `BlobRef` 完整、逐字节校验读取。
- 连续运行可产生预期的 Observation、Entry revision、Story/feed/search/events，重复 command 由 fence 和 idempotency 返回既有结果。
- checkpoint revision 匹配时提交新 cursor；不匹配时不覆盖新状态，返回当前 cursor/revision、`checkpointCommitted: false`，并产生 superseded event。
- type 为 `ingest.page.persisted` 且 version 为 `v1` 的事件，仅在 checkpoint Action 返回且 `ingest-page` workflow checkpoint 写入后发出，其 payload 与最终输出一致。
- connector 分类、Blob 校验失败分类、schema/JSON 校验和最多三次 Activity attempt 均可由自动化测试判定。

## 实现与测试锚点

- [workflow-ingest.ts](../../../packages/application/src/workflow-ingest.ts#L40-L480)：Definition、三个 Action definitions、handlers 与错误映射。
- [application workflow-ingest.test.ts](../../../packages/application/src/workflow-ingest.test.ts#L53-L84)：fetch 错误分类。
- [worker workflow-ingest.test.ts](../../../apps/worker/src/workflow-ingest.test.ts#L28-L467)：快照、两次运行、Blob、Entry revision、Story/feed/search/events 与 Activity attempts。

## 非目标/边界

本实现不提供 signals、timers、children workflows 或 outbox，不执行远程 Action，不并行处理同页 item，也不承诺 exactly-once。其保证限于 runtime idempotency、execution fence、领域 command/event idempotency 和 checkpoint CAS；connector 对外部真实来源的一致性、稳定性、去重能力及内容真实性不由本组件保证。
