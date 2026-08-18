# Workflow Value Store（`BlobWorkflowValueStore`）

## 状态

当前实现规格；后续代码变化应同步更新本文。本文描述 Blob-backed Workflow ValueStore 的 canonical JSON、ValueRef 生成和读取完整性边界；ValueRef 的公共 wire shape 由[公共合同](../contracts/0001-public-contracts.md)定义，本组件拥有 canonical JSON 编码、实际引用校验和 ValueStore 错误；底层文件 containment/BlobRefLike 错误由 [`0005-file-blob-store.md`](0005-file-blob-store.md)所有。

## 最后更新

2026-08-16

## 组件定位

`BlobWorkflowValueStore` 实现 `@notnotype/nb-workflow` 的 `ValueStore`：把 JSON-safe Workflow value 编码为 canonical JSON，以 `application/json` 写入 `FileBlobStore`，返回可放入 Workflow JSON 的 ValueRef；读取时拒绝缺失、错误引用、篡改 bytes 和非 JSON 内容，并返回 structured clone。它不把 `Uint8Array` 或 Blob bytes 放入 Workflow state，不访问 Prisma，也不拥有 Value 的业务生命周期。

### 在系统中的位置与作用
它是 Workflow Kernel 的 `ValueStore` 适配器，位于 Runner 的 JSON-safe value 与 `FileBlobStore` 的文件字节之间。

### 解决的问题
它把 Workflow value 编成 canonical JSON 并以 ValueRef 引用，避免把二进制或较大结构直接塞进 state，同时在读取时做四重完整性校验。

### 使用方式
Runner/Kernel 通过 `ValueStore` 的 put/get 使用本组件；put 返回的 ValueRef 放进 Workflow JSON，get 依赖 `FileBlobStore` 验证 mediaType、hash、byteSize、key 后再解析 JSON。

### 典型情景
Workflow 跨步骤保存 JSON-safe 中间值、需要恢复时读取外置 value，或要检测引用指向的 bytes 被篡改时，选择本 Store。


## 概念与定义

- **Workflow value**：`JsonValue`，只能是 `@notnotype/nb-workflow` 认可的 JSON 值；canonical JSON 的排序/编码规则由该库提供。
- **ValueRef**：Workflow JSON 中的 `key`、`hash`、`byteSize`、`mediaType` 引用形状；wire owner 是[公共合同](../contracts/0001-public-contracts.md)，canonical bytes 与真实引用完整性 owner 是本组件。其运行时接口由 `@notnotype/nb-workflow` 提供；本组件生成的 mediaType 固定为 `application/json`。
- **四重引用校验**：本组件的 `get` 读取后同时要求 mediaType、SHA-256 hash、byteSize、内容寻址 key 全部匹配当前 bytes；任一失败是完整性错误。随后还必须成功 UTF-8 JSON parse 和 `assertJsonValue`。这套规则不属于 contracts schema，也不由 FileBlobStore 的 BlobRefLike 三项校验替代。
- **结构化复制**：get 不返回 parser 的可变临时对象，而是 `structuredClone(parsed)`；Store 没有对象引用缓存。

## 外部行为

`put(value)` 先用 `canonicalJson(value)` 编码，再用 TextEncoder 得到 UTF-8 bytes，调用底层 `FileBlobStore.put(bytes,{mimeType:"application/json"})`。它根据同一 bytes 计算 `sha256:<hex>`，返回 `{key: stored.key, hash, byteSize: encoded.byteLength, mediaType:"application/json"}`。同一 canonical value 会产生同一 key；底层已有目标文件时由 FileBlobStore 的 EEXIST 规则处理。

`get(reference)` 先按 reference.key 从 BlobStore 读取。底层读取 ENOENT 被包装成 `WorkflowValueNotFoundError(reference)`；其它 I/O/containment 异常原样向上。读取成功后计算 bytes digest，并检查：

1. `reference.mediaType === "application/json"`；
2. `reference.hash === sha256:<digest>`；
3. `reference.byteSize === content.byteLength`；
4. `reference.key === sha256/<digest.slice(0,2)>/<digest.slice(2)>`。

四项任一不满足抛 `WorkflowValueIntegrityError(reference)`。通过后用 TextDecoder 解码、JSON.parse 并运行 `assertJsonValue`；解析失败、非 JSON-safe 值或无法被该库接受的值同样抛完整性错误。成功返回 parsed 的 structured clone。实现不会把 bytes 重新 canonicalize 后与原始文本比较，因此“合法但非 canonical 的 JSON bytes”若 hash/key/size/mediaType 均自洽仍可被 get 接受；put 产生的 bytes 始终是 canonical JSON。

## 输入

- `put` 接受 `JsonValue`；canonicalJson/底层 `assertJsonValue` 是 JSON-safe 边界，undefined、函数、BigInt、二进制等不可作为 Workflow value。
- `get` 接受 `ValueRef`；reference 字段由 ValueStore conformance contract 提供，读取时严格要求上述四项，尤其 mediaType 不能是其它类型。
- 构造函数接受 `FileBlobStore`，其 root/containment 配置由 [`0005-file-blob-store.md`](0005-file-blob-store.md) 定义。
- 缺失引用、损坏 bytes 和错误 metadata 不会被自动修复或重写。

## 输出

- `put` 返回 JSON-safe ValueRef；不返回内容 bytes。
- `get` 返回与存储 JSON 等价的 `JsonValue` structured clone；调用者修改返回对象不会修改缓存或文件（组件没有缓存）。
- 缺失抛 `WorkflowValueNotFoundError`；hash/key/size/mediaType/parse/assert 任一失败抛 `WorkflowValueIntegrityError`；非 ENOENT 的底层文件错误保持原异常。

## 状态与持久化

本组件无数据库和内存持久状态；唯一 durable state 是由底层 FileBlobStore 保存的 canonical JSON 文件：

```text
<blob-root>/sha256/<first-two-hex>/<remaining-62-hex>
```

ValueRef 的 key/hash/byteSize/mediaType 是调用方携带的引用，不单独存 metadata 表。文件不存在、损坏或引用错误不会产生 tombstone；没有 delete/list/GC/version/CAS。WorkflowRun state 只保存 ValueRef（或 inline value），不会保存 Uint8Array。

## 状态转换

- JsonValue → `put`：canonical encode、Blob 写入、返回 ValueRef。
- canonical Blob 已存在 → `put`：底层不覆盖文件，返回同一派生引用；本组件不再次验证既有 bytes。
- 正确 ValueRef +完整 bytes → `get`：读取并返回 clone。
- 缺失 key → `WorkflowValueNotFoundError`；存在但四重校验不匹配 → `WorkflowValueIntegrityError`。
- 四重校验通过但内容不是可接受 JSON → `WorkflowValueIntegrityError`。
- 没有 persisted “pending/leased/delivered” 等 Value 状态转换，也没有跨 Workflow Run 的引用计数。

## 副作用

`put` 只通过 FileBlobStore 创建 Blob 目录/文件；`get` 只读文件。ValueStore 不写 Prisma、DomainEvent、日志、外部网络或 WorkflowRun projection。若 put 成功后调用方后续事务失败，文件不会由 ValueStore 自动删除；内容寻址允许后续同值重用。

## 错误与降级

- canonicalJson/JSON-safe 校验失败：原 `@notnotype/nb-workflow` 序列化异常向上；不会写入伪造引用。
- Blob key 逃出 root、权限/磁盘等非 ENOENT I/O：底层 FileBlobStore 异常向上，不包装成 ValueNotFound。
- ENOENT：包装为 `WorkflowValueNotFoundError(reference)`，调用方可决定重新计算 value 或让 Kernel 进入 recovery；本组件不降级为 null。
- mediaType、hash、byteSize、key 任一错误，或 JSON.parse/assertJsonValue 失败：`WorkflowValueIntegrityError`，不返回部分对象。
- 没有 retry/backoff、修复、重新下载或 metadata-only fallback；重试由上层决定。

## 依赖

- 依赖 `@notnotype/nb-workflow` 的 `canonicalJson`、`assertJsonValue`、`ValueRef`、`ValueStore`、`WorkflowValueIntegrityError`/`WorkflowValueNotFoundError`，Node crypto SHA-256、TextEncoder/TextDecoder/structuredClone，以及 `FileBlobStore`。公共 ValueRef wire shape 见[公共合同](../contracts/0001-public-contracts.md)；本 Store 负责 canonical bytes、四重校验和 JSON-safe 解码；底层 bytes/hash/key/containment 验证接口见 [`0005-file-blob-store.md`](0005-file-blob-store.md)。

## 配置

没有独立环境变量。Blob Root 来自构造时注入的 FileBlobStore；默认由 `createBlobStoreConfig`/storage composition 提供 `.cosmos/blobs`。mediaType、hash 前缀、key 目录布局和 canonical JSON 编码不是可配置项。

## 重建验收

1. 在隔离 Blob Root 中 put `{b:1,a:"two"}`；文件文本精确为 `{"a":"two","b":1}`，ValueRef mediaType 为 `application/json`，byteSize 等于文件字节数，hash/key 符合同一 SHA-256。
2. 用 put 返回的 ValueRef get；返回值深相等但不是同一对象引用，修改返回对象后再次 get 仍返回原值。
3. 将 ValueRef 的 mediaType、hash、byteSize、key 分别单独改错；每一种 get 都抛 `WorkflowValueIntegrityError`，不返回 JSON。
4. 将目标文件 bytes 替换成 `tampered`；即使 key 未变，get 也因 hash/byteSize/key 校验失败抛完整性错误。
5. 使用不存在 key 的 reference；get 抛 `WorkflowValueNotFoundError` 而不是完整性错误；使用 root 外 key 时底层 containment 错误不会被伪装成 not found。
6. 将目标文件写成非法 JSON 或 JSON 中含 `assertJsonValue` 不接受的值；四重 metadata 校验通过后仍因 parse/assert 抛 `WorkflowValueIntegrityError`。
7. 对同一 canonical value 重复 put；两次 ValueRef 完全相同、底层只有同一内容寻址文件，且第二次不覆盖文件。
8. 在 Workflow state 中只保存 `{kind:"ref",ref:ValueRef}`，不保存 Uint8Array；Backend 可接受其 JSON 形状，ValueStore get 能恢复原 JsonValue。

## 实现与测试锚点

- `packages/blob-store/src/workflow-value-store.ts:19-34`：BlobWorkflowValueStore 构造、canonical JSON put、hash/ValueRef；`:36-65`：missing 包装、四项校验、JSON parse/assert、structured clone；`:68-75`：key/digest 和 ENOENT helper。
- `packages/blob-store/src/index.ts:48-96`：底层 FileBlobStore 写入/读取/containment；`packages/blob-store/src/verify-blob-ref.ts`：独立 BlobRef 三项完整性校验。
- `packages/blob-store/src/workflow-value-store.test.ts:27-36`：`valueStoreConformanceCases` 全部 conformance；`:38-51`：tampered bytes/malformed references 的错误；`:53-63`：canonical JSON 字节和 byteSize。

## 非目标/边界

不保存 Value metadata、引用计数、删除/GC、版本 CAS、Run/Job lease、DomainEvent/outbox、非 JSON media type、二进制 inline value 或外部对象存储。get 不重新比较内容是否 canonical，只检查四重引用和 JSON-safe 可解析性；跨进程 Blob 修复、磁盘/容器卷故障和真实 Workflow 长期 recovery 未由该组件测试证明。
