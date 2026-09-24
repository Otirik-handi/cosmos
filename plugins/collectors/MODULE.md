# MODULE: @cosmos/plugin-collectors

内置连接器包:Bilibili(经 OpenCLI 子进程)与 AI HOT 的取数、配置解析与输出归一化,以及内置连接器注册表。

## 公共入口

`src/index.ts` 只做导出与模块地图(**17 行**),解析后 **16 个导出**。

- 机器可读真相源:`entry-surface.txt`(排序后的 `kind<TAB>名称`),由 `bun run scripts/entry-export-surface.ts plugins/collectors/src/index.ts --out plugins/collectors/entry-surface.txt` 生成。
- 常驻护栏:`src/entry-contract.test.ts` 断言运行时值导出集合等于快照的 `value` 行;增删导出必须先显式重新生成快照。
- 环依赖:已无环(`bunx madge --circular` 0 个);**实现模块不要从 `./index.js` 取类型**,直接指向所属分册。
- 消费方(`vitest*.config.ts` 的 `@cosmos/plugin-collectors` 别名)按**包名**导入。

## 子模块地图

| 文件 | 职责 | token |
|---|---|---|
| `index.ts` | 入口门面:只有导出与模块地图 | ~0.2k |
| `opencli-runner.ts` | OpenCLI 子进程执行器、doctor/版本校验与常量 | ~2.0k |
| `bilibili-connector.ts` | Bilibili 连接器、执行计划与 profile 解析 | ~2.7k |
| `bilibili-normalize.ts` | Bilibili 输出归一化与执行计划类型 | ~1.1k |
| `aihot-connector.ts` | AI HOT 连接器、配置解析与条目归一化 | ~2.3k |
| `shared.ts` | 共享的 JSON 抽取(文档/行/候选)与资产、指标助手 | ~1.3k |
| `registry.ts` | 内置连接器注册表 | ~0.4k |

测试与源码同级:`index.test.ts`(行为)与 `entry-contract.test.ts`(入口契约)。

## 阅读顺序

1. 先读本文件与 `entry-surface.txt`,确认公共面;
2. 改某个能力:直接打开对应分册(取数看连接器分册、解析看 `shared.ts`),不要读 `index.ts`(它只有导出);
3. 改入口或导出:先看 `entry-surface.txt` 与 `entry-contract.test.ts`,再动 `index.ts`。

## 禁区

- 来源标识与 URL 常量归**各自的连接器分册**,不要集中到 `registry.ts`——`registry` 依赖各连接器,常量放那里会形成 `registry → connector → runner → registry` 环;
- 归一化模块不得反向依赖连接器分册(执行计划类型归归一化一侧,依赖保持单向);
- 入口不新增 `export *`;新导出必须先重新生成 `entry-surface.txt`;
- 实现模块不从 `./index.js` 取类型(会重新引入环)。

更新日期:2026-09-24
