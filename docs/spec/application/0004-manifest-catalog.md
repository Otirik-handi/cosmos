## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

2026-08-16

## 组件定位

`packages/application/src/catalog.ts` 提供：

- `StaticCatalog`：`CatalogPort` 的进程内静态实现，保存 Source、Workflow、Action 和 Connector 清单。
- `createBuiltinManifestCatalog`：创建包含内置 Source、Workflow、Action 和 Connector 的 `StaticCatalog`。

该组件只负责清单存储与查询，不负责 Action executable 的注册或执行。Action executable 的职责见 [Action Registry](0003-action-registry.md)。

### 在系统中的位置与作用
它是组合根内的进程内清单查询层，保存 Source、Workflow、Action 和 Connector 的 manifest，供产品边界或诊断读取。

### 解决的问题
它把“系统宣称有哪些能力”和“如何执行这些能力”分开，提供稳定的清单查询而不把 executable、handler 或 Workflow runtime 对象暴露给调用方。

### 使用方式
启动组合根时创建 `StaticCatalog` 或 `createBuiltinManifestCatalog`，把它注入需要读取清单的 API/应用端口；Action executable 仍必须单独注册到 [Action Registry](0003-action-registry.md)。

### 典型情景
API 要展示可用 Source、Workflow、Action 或 Connector，或重建进程组合时需要一份 builtin manifest 清单时，选择本组件。

## 概念与定义

`StaticCatalog` 使用 `packages/application/src/catalog.ts` 自己定义的 catalog manifest 形状；它不是 `WorkflowDefinition`、`ActionDefinition` 或 `ActionDescriptor` 的可执行运行时对象。

### Catalog manifest hash

目录中的 `ManifestHash` 是对象 `{ algorithm: string; value: string }`。Source、Workflow、Action catalog manifest 的 `manifestHash` 都是该对象；`JsonSchemaRef.hash` 也使用同一对象形状。内置目录通过 `builtinHash(value)` 只包装固定字符串为 `{ algorithm: "builtin", value }`，不从内容计算摘要，也不验证摘要与内容是否一致。

### 三种相邻但不同的 manifest 形状

- **Catalog manifest**：`StaticCatalog` 的 Source/Workflow/Action 条目使用对象 `manifestHash: ManifestHash`，用于只读清单投影。
- **Workflow Definition**：`createIngestWorkflowDefinition()` 和 `IngestWorkflowControlService.createWorkflowEnvelope()` 使用 `WorkflowDefinitionReference`，其 `manifestHash` 是字符串 `"builtin:cosmos.ingest@1:source-snapshot-v1"`。入队时不会把 catalog 的 `{ algorithm, value }` 对象写入 envelope。
- **Executable Action Definition**：`createIngestActions()` 的 `ActionDefinition.manifestHash` 是可选字符串；三个实现分别使用 `builtin:source.fetch@1:source-snapshot-v1`、`builtin:library.ingest@1`、`builtin:source.checkpoint@1:cas-v1`。它同时携带运行时 Zod `inputSchema`/`outputSchema`，不能放入目录或 Workflow JSON。
- **Action Descriptor/Manifest**：`ActionRegistry.descriptors()` 输出 `ActionDescriptor`，其中 `manifestHash` 仍是可选字符串，且不含 executable schema；公共 `actionManifestSchema` 是该 descriptor schema 的别名。目录里的 Action manifest 是另一种 catalog 条目，仍使用 `ManifestHash` 对象。

因此，字符串与对象只在明确的投影/写入边界转换：固定 catalog 字符串经 `builtinHash` 包成 catalog 对象；Workflow/Action runtime definition 从固定字符串读取；不存在把三种类型混成一个 `ManifestHash` 的隐式转换。

### Catalog manifest 字段

- Source manifest：`id`、`version`、`ref`、`provider`、`displayName`、`description`、`manifestHash`、`status`、`operationIds`、`capabilities`、`configurationSchema`
- Workflow manifest：`id`、`version`、`ref`、`kind`、`provider`、`manifestHash`、`status`、`requiredActionRefs`、`requiredBackendCapabilities`、`inputSchema`、`outputSchema`
- Action manifest：`id`、`version`、`ref`、`provider`、`manifestHash`、`effectMode`、`executionPlacement`、`requiredCapabilities`、`status`、`inputSchema`、`outputSchema`

上述 catalog 条目的 `inputSchema`/`outputSchema` 是 `JsonSchemaRef` 数据（可选 plain `schema` record），不是可执行 Zod schema。

约束枚举：

- `status`：`enabled | disabled | unavailable | incompatible`
- Workflow `kind`：`ingest | knowledge | research | maintenance | delivery | interaction | custom`
- Action `effectMode`：`none | external`
- Action `executionPlacement`：`host | trusted_worker | remote_worker`

## 外部行为

`StaticCatalog` 实现以下同步 `CatalogPort` 方法：

| 方法 | 行为 |
| --- | --- |
| `listSourceDefinitions()` | 返回保存的 Source 数组 |
| `getSourceDefinition(id, version?)` | 按 `id` 查询；提供 `version` 时同时匹配版本 |
| `listWorkflowDefinitions()` | 返回保存的 Workflow 数组 |
| `getWorkflowDefinition(id, version)` | 按 `id` 和 `version` 精确查询 |
| `listActionDefinitions()` | 返回保存的 Action 数组 |
| `getActionDefinition(id, version)` | 按 `id` 和 `version` 精确查询 |
| `listConnectors()` | 返回保存的 Connector 数组 |

所有 `list` 方法均保持构造输入顺序。代码不自行排序，输入顺序就是输出顺序。

重复条目不会报错、覆盖或合并。所有 `get` 方法使用顺序查找并返回第一个匹配项。`getSourceDefinition(id)` 省略 `version` 时返回第一个 `id` 匹配项；其他 `get` 方法必须同时提供 `id` 和 `version`。没有匹配项时返回 `null`。

## 输入

`StaticCatalog` 构造时接收 Source、Workflow、Action 和 Connector 四组数组。

构造阶段的复制边界如下：

- 每组输入数组都会复制。
- 每个数组条目都会进行一次顶层对象复制。
- Source 的 `operationIds` 和 `capabilities` 数组会复制。
- Workflow 的 `requiredActionRefs` 数组会复制；数组中的引用对象不递归复制。
- Action 的 `requiredCapabilities` 数组会复制。
- Connector 的 `capabilities` 数组会复制。
- Workflow 的 `requiredBackendCapabilities` 不复制，保存的字段与输入对象保持同一引用。
- schema 中的 plain record 不深复制。
- 不执行递归 `freeze`。

## 输出

`createBuiltinManifestCatalog` 不接收外部配置，使用源码中的固定 manifest 和固定顺序构造目录。

`createBuiltinManifestCatalog` 的 Source 顺序稳定为：

| 顺序 | provider | manifest | capabilities | `configurationSchema` 中的业务属性 |
| --- | --- | --- | --- | --- |
| 1 | `rss` | `source.rss@1` | `source:read`、`cursor` | `feedUrl`、`scheduleIntervalMs` |
| 2 | `fixture-rss` | `source.fixture-rss@1` | `source:read`、`cursor` | `scheduleIntervalMs` |
| 3 | `bilibili` | `source.bilibili@1` | `source:read`、`cursor`、`external:opencli` | `mode`、`profile`、`limit`、`scheduleIntervalMs` |
| 4 | `aihot` | `source.aihot@1` | `source:read`、`cursor` | `scheduleIntervalMs` |

内置 Workflow 仅有 `cosmos.ingest@1`，其 catalog `manifestHash` 是对象 `{ algorithm: "builtin", value: "builtin:cosmos.ingest@1:source-snapshot-v1" }`。`requiredActionRefs` 顺序为 `source.fetch@1`、`library.ingest@1`、`source.checkpoint@1`；`requiredBackendCapabilities.processRestart`、`multiWorker`、`leases`、`externalReceipts`、`valueReferences` 均为 `true`。

内置 Action catalog 顺序稳定为：

| 顺序 | ref | catalog `manifestHash.value` | `effectMode` | `executionPlacement` | `requiredCapabilities` |
| --- | --- | --- | --- | --- | --- |
| 1 | `source.fetch@1` | `builtin:source.fetch@1:source-snapshot-v1` | `external` | `trusted_worker` | `source:read` |
| 2 | `library.ingest@1` | `builtin:library.ingest@1` | `none` | `host` | `library:write` |
| 3 | `source.checkpoint@1` | `builtin:source.checkpoint@1:cas-v1` | `none` | `host` | `source:checkpoint` |

上述 Action catalog hash 的 `algorithm` 均为 `builtin`。Connector 顺序与 Source 顺序一致：`rss`、`fixture-rss`、`bilibili`、`aihot`。Connector 的字段语义以 [公共契约](../contracts/0001-public-contracts.md) 为准。

目录只读 API 返回 catalog 条目；API 不加载 executable Action Definition、Zod schema 或 handler。`ActionRegistry.descriptors()` 的运行时 descriptor 是独立的 manifest-safe projection，见 [Action Registry](0003-action-registry.md)。
## 状态与持久化

目录状态仅存在于 `StaticCatalog` 实例的进程内内存中，没有 durable 状态，不写入数据库、文件、缓存或其他持久化介质。进程结束后状态丢失；重新创建实例时由构造输入或内置常量重建。

TypeScript 的 `readonly` 不构成运行时不可变保证。由于没有递归冻结，调用方若绕过类型约束修改 list 返回值，或者修改仍被共享的 schema、`requiredBackendCapabilities` 等嵌套对象，后续查询可以观察到变化。

## 状态转换

`StaticCatalog` 没有注册、替换、删除或刷新操作。其公开 API 只包含读取方法，不定义正常业务状态转换。

唯一受支持的建库过程发生在构造阶段：

1. 接收四组数组。
2. 按既定复制边界保存条目。
3. 后续查询按保存顺序读取。

若需要不同目录内容，应创建新的 `StaticCatalog` 实例。

## 副作用

`StaticCatalog` 和 `createBuiltinManifestCatalog`：

- 不访问网络。
- 不访问数据库。
- 不读取或写入文件。
- 不加载或注册 executable handlers。
- 不探测远程执行能力或远程服务可用性。
- 不执行 hash 加密校验或内容完整性验证。
- 不启动后台任务、定时器或订阅。

## 错误与降级

查询缺失通过 `null` 表达，不因未命中而抛出异常。

重复 `id` 或重复 `id + version` 不视为错误，也不自动合并。查询结果由输入顺序决定，始终选择第一个匹配项。

组件不校验 `ManifestHash.value` 是否对应 manifest 内容，也不根据远程能力动态调整 `status`。不存在网络、数据库或文件系统失败后的降级路径，因为组件不依赖这些资源。

## 依赖

- `CatalogPort` 及共享 manifest、schema 引用和 `ConnectorDescriptor` 类型来自应用与公共契约层；canonical 定义见 [公共契约](../contracts/0001-public-contracts.md)。
- Action executable 由 [Action Registry](0003-action-registry.md) 管理，本组件仅保存 Action manifest。
- 运行时不依赖网络客户端、数据库驱动、文件系统适配器或加密 hash 实现。

## 配置

`StaticCatalog` 的内容完全由构造输入决定。

`createBuiltinManifestCatalog` 没有环境变量、配置文件或运行时探测项。内置 ID、版本、顺序、能力、schema 引用和 hash value 均为源码中的固定值。

## 重建验收

1. 以任意顺序构造四组条目后，各 `list` 方法必须严格保持对应输入顺序，且连续两次调用返回同一数组引用。
2. 修改构造时传入的外层数组或条目顶层字段，不得改变目录中已保存的数组结构或条目顶层值。
3. 修改原输入中的 Source `operationIds`/`capabilities`、Workflow `requiredActionRefs`、Action `requiredCapabilities` 或 Connector `capabilities` 数组，不得改变目录中对应数组。
4. 修改共享的 Workflow `requiredBackendCapabilities` 或 schema plain record 后，目录查询结果必须能观察到该修改。
5. 输入重复项时不得抛错、合并或覆盖；`get` 必须返回顺序中的第一个匹配项。
6. `getSourceDefinition(id)` 必须允许省略版本；指定版本时必须同时匹配 `id` 和 `version`。Workflow 和 Action 查询必须使用 `id + version`。所有未命中查询必须返回 `null`。
7. `createBuiltinManifestCatalog().listSourceDefinitions()` 的标识顺序必须为 `source.rss@1`、`source.fixture-rss@1`、`source.bilibili@1`、`source.aihot@1`，能力和配置属性必须与“输出”表一致。
8. 内置 Workflow 必须且只能包含 `cosmos.ingest@1`；hash、三个 Action 引用的顺序及五个值为 `true` 的 backend flags 必须与“输出”一致。
9. 内置 Action 的标识顺序、hash value、effect mode、execution placement 和 required capability 必须与“输出”表逐项一致。
10. 内置 Connector 顺序必须为 `rss`、`fixture-rss`、`bilibili`、`aihot`，与 Source provider 顺序一致。
11. 所有内置 hash 的 `algorithm` 必须为 `builtin`；实现不得根据 manifest 内容计算或校验 hash。
12. 创建和读取目录期间不得产生网络、数据库或文件 I/O，不得注册 executable handler，也不得执行远程能力探测。

## 实现与测试锚点

- [`packages/application/src/catalog.ts` 第 1-295 行](../../../packages/application/src/catalog.ts#L1-L295)：`StaticCatalog`、内置 manifest 和 `createBuiltinManifestCatalog` 的实现。
- [`apps/api/src/app.controller.ts`](../../../apps/api/src/app.controller.ts)：当前 API controller 对 catalog 的读取调用。
- [`apps/api/src/app.controller.test.ts`](../../../apps/api/src/app.controller.test.ts)：catalog 读取相关 API 场景。

当前没有独立的 `StaticCatalog` 单元测试；现有覆盖主要来自 API controller 相关场景。

## 非目标/边界

- 不提供动态注册、替换、删除、刷新或热重载。
- 不负责 manifest 的 canonical 定义、反序列化、迁移或深层验证。
- 不提供递归不可变性、深复制或运行时冻结。
- 不处理 Action executable 的加载、绑定、调度或执行。
- 不探测 Connector、worker 或远程服务的实时能力与可用性。
- 不验证 hash 的真实性、完整性或加密强度。
- 不提供持久化、分布式同步、租约、缓存失效或多进程一致性。
