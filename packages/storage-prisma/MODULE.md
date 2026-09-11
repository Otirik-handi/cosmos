# storage-prisma 模块地图

Prisma + SQLite 存储适配层:把应用层与工作流引擎的端口(内容仓储、运行后端、宿主存储、事件落库、密钥、连接器状态)落到本地数据库与文件根;本包是全仓唯一直接依赖 Prisma 的包。

## 入口契约(冻结)

`src/index.ts` 导出 9 个值符号 + 1 个类型,由 `src/entry-contract.test.ts` 看守,拆分期间零增减零改名:

- `PrismaCosmosRepository` —— 内容域仓储,实现 `@cosmos/application` 的 `CosmosRepository`
- `PrismaWorkflowBackend` / `PrismaWorkflowHostStore` / `PrismaWorkflowEventSink` —— 工作流运行后端、宿主存储、事件落库
- `PrismaConnectorStateStore` —— 连接器非密钥状态(ADR-0017)
- `FileSecretStore` —— 文件密钥存储
- `createPrismaClient` / `resolveStorageRoots` / `resolveContainedPath` / `type StorageRoots` —— 客户端与数据根布局

## 子模块地图(2026-09-11,G02 拆分中)

| 文件 | 职责 |
| --- | --- |
| src/index.ts | ① PrismaCosmosRepository 单体(146 方法,红线 268KB,切片 4 拆往 src/repository/)② 存储根解析与 createPrismaClient ③ 兄弟类门面 re-export |
| src/workflow-host-store.ts | PrismaWorkflowHostStore 门面(277B)→ src/workflow-host-store/ 继承链:base + envelope / run-lease / activity / completion-delivery / run-lifecycle 五分册 |
| src/workflow-host-store/internals-*.ts | 模块级 helper 三层:core ← activity ← events-lease |
| src/workflow-backend.ts | PrismaWorkflowBackend:nb-workflow 运行与检查点落库 |
| src/workflow-event-sink.ts | PrismaWorkflowEventSink:领域事件落库与冲突校验 |
| src/connector-state-store.ts | PrismaConnectorStateStore:命名空间 + 版本化连接器状态 |
| src/secret-store.ts | FileSecretStore:文件根密钥读写 |
| src/workflow-run-projection.ts | workflowRunError:运行 state JSON 的错误投影 |

## 阅读顺序

1. 本文件与 `src/entry-contract.test.ts`(入口契约);
2. 改某聚合前用符号搜索定位到分册,只读该分册与对应测试分册;
3. 数据根布局改动先读 index.ts 的 StorageRoots 区段。

## 禁区

- 包外只允许 import 包入口 `@cosmos/storage-prisma`(package.json 仅导出 `.`),不 import 内部分册;
- 入口导出契约冻结;Prisma schema / migration 不在本包治理范围;
- 不读写 `.cosmos/` 运行数据;测试一律使用隔离根目录。

更新:2026-09-11(G02 切片 5)
