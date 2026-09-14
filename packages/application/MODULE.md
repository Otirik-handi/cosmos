# MODULE: @cosmos/application

应用层用例编排:Connector 目录与运行、采集入队、媒体获取与清理、Workflow Host 端口与常驻运行部件的实现。

## 公共入口

`src/index.ts` 是唯一公共入口,解析后 **147 个导出(54 值 / 93 类型)**。

- 机器可读真相源:`entry-surface.txt`(排序后的 `kind<TAB>名称`),由 `bun run scripts/entry-export-surface.ts packages/application/src/index.ts` 生成。`export *` 会掩盖真实公共面(源码层只数出 49 个),必须按解析后结果看守。
- 常驻护栏:`src/entry-contract.test.ts` 断言运行时值导出集合等于快照的 `value` 行;增删导出必须先显式重新生成快照。
- 入口分组:域错误类(`*NotFoundError` / `*ConflictError`,覆盖 Source/Story/Topic/Entity/Label/Collection/Board 等);端口与仓储合同(`CosmosRepository`、`CatalogPort`、`ConnectorStateStorePort`、`SecretStorePort`、`LoggerPort`);结果与快照类型;连接器与 Workflow Host 的输入输出类型;实现类(`ActionRegistry`、`StaticCatalog`、`WorkflowRunLane`、`WorkflowActivityWorker`、`WorkflowCompletionDispatcher`、媒体获取工厂等)。

## 子模块地图

| 文件 | 职责 | token |
|---|---|---|
| `index.ts` | 入口 + 域错误类 + 仓储端口 + 结果类型(G05 待拆) | ~18.0k |
| `workflow-host-runtime.ts` | Run lane / Activity Worker / Completion Dispatcher | ~11.2k |
| `media-acquisition.ts` | 媒体获取、策略解析、重试与去重 | ~7.4k |
| `workflow-ingest.ts` | 采集 Workflow 用例编排 | ~7.3k |
| `catalog.ts` | Source/Action/Workflow manifest 目录与内置目录 | ~4.0k |
| `workflow-host.ts` | Workflow Host 端口、输入类型与错误码 | ~3.3k |
| `action.ts` | Action 注册表与 Host Action 执行边界 | ~3.1k |
| `media-cleanup.ts` | 媒体清理预览与执行 | ~1.8k |
| `workflow-control.ts` | Run 取消 / 恢复 / 重跑控制 | ~1.4k |
| `connector-state-store.ts` | Connector 状态 KV 端口与冲突错误 | ~0.4k |
| `secret-store.ts` | Secret 端口 | ~0.2k |

测试与源码同级(`*.test.ts`),property 测试为 `workflow-control.property.test.ts`;入口契约测试随入口同目录。

## 阅读顺序

1. 先读本文件与 `entry-surface.txt`,确认公共面;
2. 改某个能力:直接打开对应子模块,不要通读 `index.ts`;
3. 改入口或导出:先看 `entry-surface.txt` 与 `entry-contract.test.ts`,再动 `index.ts`。

## 禁区

- 不直接依赖 Prisma / SQLite / Data Root / Blob,一律经端口;
- 入口不新增 `export *`,新导出必须是显式具名导出;
- 不重新生成 `entry-surface.txt` 就不改导出面。

更新日期:2026-09-14
