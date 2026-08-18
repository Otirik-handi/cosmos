# 文件 Blob Store（`FileBlobStore` / `readVerifiedBlob`）

## 状态

当前实现规格；后续代码变化应同步更新本文。本文描述当前本地文件 Blob 适配器和 BlobRefLike 读取校验；Asset/Observation 如何决定何时写 Blob 由 [`0001-prisma-repository.md`](0001-prisma-repository.md) 和[规范化内容](../domain/0001-normalized-content.md)定义。Workflow JSON 中的 BlobRef wire shape 由[公共合同](../contracts/0001-public-contracts.md)定义；本文只拥有 bytes、hash、key 和 Blob Root containment 验证。

## 最后更新

2026-08-16

## 组件定位

`FileBlobStore` 在受控 Blob Root 中保存和读取二进制字节，以 SHA-256 内容寻址；`readVerifiedBlob` 为已有 BlobRefLike 做缺失与内容完整性检查。它不保存数据库 metadata、不提供目录索引、不负责垃圾回收，不把 mimeType 当作文件内容校验字段。

### 在系统中的位置与作用
它是受控 Blob Root 下的二进制存储层，为 Repository 的 raw/Asset 内容和 ValueStore 的 canonical JSON 提供内容寻址文件读写。

### 解决的问题
它用 SHA-256 key 管理字节并在读取时验证 hash、大小和路径 containment，避免大字节或损坏内容进入上层状态；数据库 metadata 仍由其他组件拥有。

### 使用方式
调用方通过 `put` 保存 bytes，并把返回的 ref/metadata 交给对应 owner；读取已有引用时调用 `readVerifiedBlob`，不要自行拼接 Blob Root 路径或把 mimeType 当内容校验。

### 典型情景
保存抓取到的 raw payload/Asset，或让 Workflow ValueStore 把 JSON value 放到文件而非 Workflow state 中时，选择本组件。


## 概念与定义

- **Blob**：Blob Root 下的一份字节文件；其逻辑 key 由内容 SHA-256 派生。
- **StoredBlob**：`put` 返回的 `{key, hash, byteSize, mimeType}`；mimeType 是调用者提供的可选 metadata，不写入文件。
- **BlobRefLike**：本文件导出的本地读取校验接口，包含 key/hash/byteSize/mediaType；本文件是其唯一验证 owner。它不是 contracts 的公共 wire DTO；公共 BlobRef 形状见[公共合同](../contracts/0001-public-contracts.md)。
- **内容寻址 key**：给定 digest hex `d`，key 为 `sha256/${d.slice(0,2)}/${d.slice(2)}`，hash 为 `sha256:${d}`。
- **Blob Root containment**：任何 key 先被 resolve 到 configured root 下的路径；包含 `..` escape、Windows volume colon、或 normalize 后不一致的路径都被拒绝。

## 外部行为

`createBlobStoreConfig(root = COSMOS_BLOB_ROOT 或 `.cosmos/blobs`)` 对 root 调用 `path.resolve`，返回绝对 Blob Root。`resolveBlobKey(config,key)` 对 root/key 做 resolve/relative 检查；路径逃逸抛 `Error("Blob key escapes the configured Blob Root.")`，否则返回绝对文件路径。该检查在 `put`、`read`、`exists` 前都会执行。

`put(content, {mimeType?})` 对传入 `Uint8Array` 计算 SHA-256，生成内容寻址 key，创建 `sha256/<prefix>` 目录并用 `writeFile(...,{flag:"wx"})` 写入。文件已存在时只吞掉 `EEXIST`，不覆盖、不比较现有 bytes；其它 mkdir/write 错误向上抛出。成功返回派生 key/hash、当前 bytes 的 byteSize 和 mimeType（未提供时 null）。

`read(key)` 解析 containment 后直接 `readFile`，返回 `Uint8Array`；缺失、权限、目录或其它文件系统错误沿用 Node 异常。`exists(key)` 同样先做 containment；ENOENT 返回 false，其它错误向上抛出。

`readVerifiedBlob(blobs, reference)` 调用 `blobs.read(reference.key)`。ENOENT 被包装成 `BlobRefNotFoundError(key)`；其它读取异常不改写。成功读到 bytes 后重新计算 SHA-256，并同时检查：reference.hash、reference.key、reference.byteSize 分别等于计算出的 hash、规范 key、实际 byteLength。任一不符抛 `BlobIntegrityError`，全部相符才返回原始 bytes。该函数不检查 `reference.mediaType` 与文件内容，也不做 JSON 解码；mediaType 只是 BlobRefLike 兼容字段，不能据此声称 MIME 或内容类型已验证。

## 输入

- `FileBlobStore.put` 接受 `Uint8Array` 和可选 `{mimeType?: string|null}`；不自行校验 mime 类型格式或 byteSize 声明。
- `read`/`exists`/`resolveBlobKey` 接受 key 字符串；key 不被额外限制为空字符串，但最终路径仍须通过 containment，空 key 的文件系统行为由 Node 产生。
- `readVerifiedBlob` 接受实现 `read(key): Promise<Uint8Array>` 的最小 Blob port 和 `BlobRefLike`。校验只使用 key/hash/byteSize；mediaType 作为引用字段传入但不参与 digest 检查。
- 任何外部字符串路径必须先经过 `resolveBlobKey`，不得直接拼接绝对路径。

## 输出

- `createBlobStoreConfig` 返回绝对 root。
- `resolveBlobKey` 返回 root 内绝对路径，不创建目录。
- `put` 返回 StoredBlob；同内容重复 put 返回相同 key/hash/byteSize，但不会证明既有文件未被篡改。
- `read` 返回 bytes；`exists` 返回 boolean；`readVerifiedBlob` 返回通过三项内容校验的 bytes。
- 错误类型：路径逃逸为普通 Error；缺失验证目标为 `BlobRefNotFoundError`；hash/key/byteSize 不一致为 `BlobIntegrityError`。

## 状态与持久化

组件没有数据库状态、版本号、租约或内存索引。唯一 durable state 是 Blob Root 中的文件：

```text
<root>/sha256/<first-two-hex>/<remaining-62-hex>
```

目录按需创建；不存在的文件没有 tombstone。重复写入同一 key 不覆盖，调用仍返回 StoredBlob；若 root 中已有被篡改的文件，`put` 本身不会检测，必须通过 `readVerifiedBlob` 发现。

## 状态转换

- 不存在 → `put` 成功：创建父目录和目标文件。
- 已存在 → 同 key `put`：文件保持不变，EEXIST 被忽略，返回派生 metadata。
- 已存在 → `read`：返回当前文件 bytes，不做完整性检查。
- 已存在 → `readVerifiedBlob`：bytes 与 ref 三项匹配则读取成功；任一不匹配不改变文件并抛完整性错误。
- 不存在 → `read`：Node ENOENT；不存在 → `exists`：false；不存在 → `readVerifiedBlob`：BlobRefNotFoundError。
- 没有 delete、overwrite、repair、garbage collect 或 metadata 状态转换。

## 副作用

仅有 Blob Root 文件系统副作用：mkdir 和首次写入。`read`/`exists`/`readVerifiedBlob` 不修改文件。Blob key 由内容决定，写入不会访问 Prisma、DomainEvent、网络或日志。mkdir/write 的部分失败可能留下已创建父目录；实现没有临时文件和补偿清理。

## 错误与降级

- key 逃逸 configured root：立即抛 containment Error，不访问 root 外路径。
- 目标缺失：`read` 原生 ENOENT，`exists` 返回 false，`readVerifiedBlob` 转换为 `BlobRefNotFoundError` 并保留 cause。
- hash、key 或 byteSize 任一不匹配：`BlobIntegrityError`；不会返回不可信 bytes。
- 权限拒绝、目标是目录、磁盘空间不足、mkdir/write/read 其它失败：原 Node 文件系统异常向上抛出；`exists` 只吞 ENOENT。
- `put` 对 EEXIST 视为成功但不验证既有文件；这不是损坏修复，也不是 exactly-once 内容保证。

## 依赖

- `packages/storage-prisma` 使用它保存 raw payload/Asset；具体 Asset metadata 与 repository 投影见 [`0001-prisma-repository.md`](0001-prisma-repository.md) 和[规范化内容](../domain/0001-normalized-content.md)。
- `BlobWorkflowValueStore` 使用它保存 canonical JSON；ValueRef 的四重校验由 [`0006-workflow-value-store.md`](0006-workflow-value-store.md)负责，而不是本组件重复拥有。

## 配置

- `COSMOS_BLOB_ROOT`：默认 `.cosmos/blobs`，通过 `resolve` 变为绝对路径。
- 构造 `FileBlobStore` 时也可直接传 `{root}`；调用者负责选择受控目录。
- key 规则固定为 `sha256/<2>/<62>`；不支持可配置 hash 算法、分片目录深度或外部 URL。
- 本组件没有 size limit、retention、文件权限模式或并发 worker 配置。

## 重建验收

1. 给定内容 `hello` 调用 put；返回 key 匹配 `sha256/[a-f0-9]{2}/[a-f0-9]{62}`、hash 为 `sha256:2cf24d...b9824`、byteSize=5，随后 read 返回相同 bytes，exists 为 true。
2. 对同一内容调用 put 两次；两次 key/hash/byteSize 相同，目标目录只有一个文件，第二次不覆盖既有文件。
3. 调用 `resolveBlobKey(config,"../secrets.txt")`；抛出包含 `Blob key escapes` 的错误，且不会读取 root 外文件；Windows volume/colon 路径同样拒绝。
4. 用正确 key/hash/byteSize 调用 readVerifiedBlob；返回原 bytes；把 hash、key 或 byteSize 任一改错，观察到 `BlobIntegrityError`。
5. 用不存在 key 调用 readVerifiedBlob；观察到 `BlobRefNotFoundError`，其 key 等于输入且 cause 保留 ENOENT；用 exists 则返回 false。
6. 写入与 ref 对应 key 的 tampered bytes；普通 read 仍返回 bytes，但 readVerifiedBlob 必须抛 BlobIntegrityError，证明完整性检查不是普通 read 的隐式行为。

## 实现与测试锚点

- `packages/blob-store/src/index.ts:14-29`：BlobStoreConfig/StoredBlob/config 默认值；`:31-46`：key resolve 与 containment；`:48-96`：FileBlobStore put/read/exists；`:98-106`：导出 wiring。
- `packages/blob-store/src/verify-blob-ref.ts:3-22`：BlobRefLike、缺失/完整性错误；`:24-48`：读取、ENOENT 包装、SHA-256/key/byteSize 三项验证。
- `packages/blob-store/src/index.test.ts:23-51`：内容寻址、重复读、BlobRef 校验失败；`:53-59`：root escape；`packages/blob-store/src/workflow-value-store.test.ts:38-51`：被篡改文件与缺失 ValueRef 的底层行为。

## 非目标/边界

不提供数据库 Blob 元数据、Asset 状态机、删除/回收、内容修复、临时文件 rename、跨进程写锁、mimeType 验证、JSON 解析或外部对象存储。`readVerifiedBlob` 不检查 mediaType；`FileBlobStore.put` 不验证已存在文件的 bytes。真实磁盘故障、权限策略、容器卷和跨主机共享文件系统未由当前测试证明。
