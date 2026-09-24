# MODULE: @cosmos/application

应用层用例编排:Connector 目录与运行、采集入队、媒体获取与清理、Workflow Host 端口与常驻运行部件的实现。

## 公共入口

`src/index.ts` 只做导出与模块地图(**98 行**),解析后 **147 个导出(54 值 / 93 类型)**。

- 机器可读真相源:`entry-surface.txt`(排序后的 `kind<TAB>名称`),由 `bun run scripts/entry-export-surface.ts packages/application/src/index.ts` 生成。
- 常驻护栏:`src/entry-contract.test.ts` 断言运行时值导出集合等于快照的 `value` 行;增删导出必须先显式重新生成快照。
- 环依赖:入口与实现之间已无环(`bunx madge --circular` 0 个);**实现模块不要从 `./index.js` 取类型**,直接指向所属聚合模块。

## 子模块地图

| 文件 | 职责 | token |
|---|---|---|
| `index.ts` | 入口门面:只有导出与模块地图 | ~1.2k |
| `ingestion-service.ts` | 采集用例编排:入队、终态化与失败归类 | ~2.8k |
| `ingestion-worker.ts` | 采集 Worker 循环 | ~3.4k |
| `internals.ts` | 包内共享 helper:文件读取、失败归类、重试延时 | ~0.6k |
| `connector-registry.ts` | Connector 注册表 | ~0.4k |
| `connector-probe.ts` | 来源连通性探测与未保存配置探测 | ~2.6k |
| `connector-ports.ts` | Connector 端口、租约、错误码与解析器 | ~0.5k |
| `repository-port.ts` | 仓储端口与证据链接输入 | ~5.0k |
| `result-types.ts` | 仓储与采集用例的读模型结果类型 | ~0.4k |
| `errors.ts` | 域错误类型(31 个) | ~1.8k |
| `logger.ts` | 结构化日志端口与默认实现 | ~0.3k |
| `health.ts` | 健康快照装配 | ~0.2k |
| `workflow-ingest.ts` | 采集 Workflow 执行体 | ~7.4k |
| `workflow-host.ts` | Workflow Host 端口与存储合同 | ~3.3k |
| `workflow-host-runtime-types.ts` | 运行时常驻部件的端口类型、依赖与 `FixedRunIdGenerator` | ~1.4k |
| `workflow-runtime-support.ts` | lease/runner 支撑:租约时长、runner 装配与租约感知包装 | ~2.0k |
| `workflow-run-lane.ts` | Run lane:单次 Run 的领取、心跳与终态化 | ~1.8k |
| `workflow-activity-worker.ts` | Activity worker:Activity Job 的领取、执行与完成回执 | ~4.0k |
| `workflow-completion-dispatcher.ts` | Completion dispatcher:Workflow 完成投递与重排/死信 | ~2.8k |
| `workflow-action-support.ts` | Action 错误/取消/重试判定、心跳与租约竞速助手 | ~2.1k |
| `action.ts` / `catalog.ts` | Action 注册表 / manifest 目录 | ~3.1k / ~4.0k |
| `media-policy.ts` | 媒体策略解析:默认值、上限与 `parseAllowedHosts` | ~0.6k |
| `media-ports.ts` | 媒体端口与结果类型(`MediaAcquirer`/`MediaRetrier`/`MediaOutcome` 家族) | ~0.6k |
| `media-acquirer.ts` | 采集器装配、跳过未变化项与资产改写 | ~2.6k |
| `media-download.ts` | 有界下载管道:URL/主机校验、重定向、体积与 MIME 嗅探 | ~3.0k |
| `public-address.ts` | 公网地址判定(SSRF 边界) | ~1.0k |
| `media-cleanup.ts` | 媒体清理 | ~1.8k |
| `workflow-control.ts` / `secret-store.ts` / `connector-state-store.ts` | Run 控制 / Secret 端口 / 状态 KV 端口 | ~1.4k / ~0.2k / ~0.4k |

测试与源码同级(`*.test.ts`),property 测试为 `workflow-control.property.test.ts`;共享测试 helper 在 `test-support.ts`。

## 阅读顺序

1. 先读本文件与 `entry-surface.txt`,确认公共面;
2. 改某个能力:直接打开对应子模块,不要读 `index.ts`(它只有导出);
3. 改入口或导出:先看 `entry-surface.txt` 与 `entry-contract.test.ts`,再动 `index.ts`。

## 禁区

- 不直接依赖 Prisma / SQLite / Data Root / Blob,一律经端口;
- 入口不新增 `export *`,新导出必须是显式具名导出;
- 实现模块不从 `./index.js` 取类型(会重新引入环);
- 不重新生成 `entry-surface.txt` 就不改导出面。

更新日期:2026-09-24
