# MODULE: @cosmos/domain

领域语义与确定性判定:受管枚举、时间语义、Story 表示与指纹、内容归一化模型。**纯计算,无 I/O、无 Prisma、无外部依赖**(唯一例外是 `node:crypto` 的哈希)。

## 公共入口

`src/index.ts` 只做导出与模块地图(**12 行**),解析后 **68 个导出(34 值 / 34 类型)**。

- 机器可读真相源:`entry-surface.txt`(排序后的 `kind<TAB>名称`),由 `bun run scripts/entry-export-surface.ts packages/domain/src/index.ts --out packages/domain/entry-surface.txt` 生成。
- 常驻护栏:`src/entry-contract.test.ts` 断言运行时值导出集合等于快照的 `value` 行;增删导出必须先显式重新生成快照。
- 环依赖:已无环(`bunx madge --circular` 0 个);**实现模块不要从 `./index.js` 取类型**,直接指向所属分册。
- `internal.ts` **刻意不被重新导出**:它是跨分册共用的非导出助手,不进公共合同。

## 子模块地图

| 文件 | 职责 | token |
|---|---|---|
| `index.ts` | 入口门面:只有导出与模块地图 | ~0.1k |
| `story-subtypes.ts` | Story kind 与 subtype 受管注册表、`checkStorySubtype` | ~1.0k |
| `enums.ts` | 九个受管枚举(角色/实体/关系/目标/区块/热点/条目关系)与端点归一化 | ~1.0k |
| `content.ts` | 内容类型与发现渠道、Publisher/Metrics、`NormalizedIngestItem`、`deriveExternalKey`、条目 revision 指纹 | ~1.4k |
| `temporal.ts` | 时间语义:`TemporalValue` 家族、`createTemporalValue`、精确时间与原文回退解析 | ~1.6k |
| `story-representation.ts` | Story 当前表示(标题/摘要/时间范围/关键事实)的归一化与指纹 | ~1.0k |
| `revision-fingerprints.ts` | Topic / Entity revision 的内容类型与指纹 | ~0.3k |
| `story-projection.ts` | Entry → 最小 Story 投影 | ~0.3k |
| `internal.ts` | 包内共享助手:哈希、文本归一化、稳定序列化 | ~0.2k |

测试与源码同级:`index.test.ts`(行为)与 `entry-contract.test.ts`(入口契约)。

## 阅读顺序

1. 先读本文件与 `entry-surface.txt`,确认公共面;
2. 改某个概念:直接打开对应分册(例如时间语义看 `temporal.ts`),不要读 `index.ts`(它只有导出);
3. 改入口或导出:先看 `entry-surface.txt` 与 `entry-contract.test.ts`,再动 `index.ts`。

## 禁区

- 不引入 I/O、Prisma、Data Root 或任何运行时外部依赖(哈希除外);
- 入口不新增 `export *` 以外的导出语句;新导出必须先重新生成 `entry-surface.txt` 并在评审中说明;
- 实现模块不从 `./index.js` 取类型(会重新引入环),直接指向所属分册;
- `internal.ts` 的助手不得被门面重新导出。

更新日期:2026-09-24
