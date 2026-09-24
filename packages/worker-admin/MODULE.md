# MODULE: @cosmos/worker-admin

Worker 进程内的管理/观测服务:组件健康、Run lane 状态、排空(drain)命令与本机 HTTP 管理端口。**只服务本机 Worker 进程**,不对外暴露数据面。

## 公共入口

`src/index.ts` 只做导出与模块地图(**14 行**),解析后 **21 个导出**。

- 机器可读真相源:`entry-surface.txt`(排序后的 `kind<TAB>名称`),由 `bun run scripts/entry-export-surface.ts packages/worker-admin/src/index.ts --out packages/worker-admin/entry-surface.txt` 生成。
- 常驻护栏:`src/entry-contract.test.ts` 断言运行时值导出集合等于快照的 `value` 行;增删导出必须先显式重新生成快照。
- 环依赖:已无环(`bunx madge --circular` 0 个);**实现模块不要从 `./index.js` 取类型**,直接指向所属分册。
- 消费方(`apps/worker/src/main.ts`、`runtime.ts`、`runtime.test.ts`)按**包名**导入,不依赖内部路径。

## 子模块地图

| 文件 | 职责 | token |
|---|---|---|
| `index.ts` | 入口门面:只有导出与模块地图 | ~0.2k |
| `types.ts` | 公共快照/选项类型与 `WorkerAdminRequestError` | ~1.4k |
| `drain.ts` | 排空记录/状态类型、默认 lane 与命令校验 | ~0.9k |
| `health.ts` | 组件健康与失败快照的装配与脱敏 | ~0.9k |
| `service.ts` | `WorkerAdminService`:状态快照、排空状态机与事件 | ~5.3k |
| `http.ts` | `createWorkerAdminServer`:本机管理端口、请求处理与读写助手 | ~1.8k |

测试与源码同级:`index.test.ts`(行为)与 `entry-contract.test.ts`(入口契约)。

**已知边界**:`service.ts` **487 行**——单个内聚的 `WorkerAdminService` 类,高于 400 行警戒线、低于 800 行红线,落在提案「100~600 行为佳」区间。拆它需要抽取方法(真重构),不在治理任务的「只移动实现」范围内;若将来要拆,应按状态快照/排空状态机两条职责切。

## 阅读顺序

1. 先读本文件与 `entry-surface.txt`,确认公共面;
2. 改某个能力:直接打开对应分册(状态快照看 `service.ts`、健康投影看 `health.ts`、端口看 `http.ts`),不要读 `index.ts`(它只有导出);
3. 改入口或导出:先看 `entry-surface.txt` 与 `entry-contract.test.ts`,再动 `index.ts`。

## 禁区

- 不把管理端口暴露到非本机地址(沿用 `isLoopbackOrInternalHost` 的判定);
- 入口不新增 `export *`;新导出必须先重新生成 `entry-surface.txt`;
- 实现模块不从 `./index.js` 取类型(会重新引入环)。

更新日期:2026-09-24
