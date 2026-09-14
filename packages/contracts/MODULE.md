# MODULE: @cosmos/contracts

共享合同包：Zod schema 与对应类型的唯一定义处，被 56 个非测试源文件消费（API、Worker、Web、transport、storage 等）。不含运行时编排逻辑与 I/O。

## 公共入口

`src/index.ts` 当前是「桶 + 单体」混合：显式再导出 `base.js` / `action.js`（136 个名字，46+26 值 / 37+27 类型），其余 schema 内联声明。解析后 **432 个导出（219 值 / 213 类型）**。

- 机器可读真相源：`entry-surface.txt`（排序后的 `kind<TAB>名称`），由 `bun run scripts/entry-export-surface.ts packages/contracts/src/index.ts` 生成。
- 常驻护栏：`src/entry-contract.test.ts` 断言运行时值导出集合等于快照的 `value` 行（219 个）；增删导出必须先显式重新生成快照。
- 环依赖：入口 **0 环**（`bunx madge --circular`）；守卫是保持 0。

## 子模块地图

| 文件 | 职责 | token |
|---|---|---|
| `index.ts` | 入口门面 + 尚未拆出的内联 schema（G06 切片 3 继续按聚合拆出） | ~14.6k |
| `base.ts` | 基础合同：来源 / 内容 / 发布者 / 触发器 / 连接 / 媒体策略（83 导出） | ~3.9k |
| `action.ts` | Action 与采集合同：Action manifest/执行、归一化采集项、媒体重试、Source fetch/checkpoint（53 导出） | ~3.3k |
| `index.test.ts` | 入口级 schema 测试（G06 切片 2 按行为拆） | — |
| `connection.test.ts` / `run-control.test.ts` / `trigger.test.ts` | 已按聚合存在的测试（实现仍在 `index.ts`，切片 2/3 对齐） | — |

测试与源码同级（`*.test.ts`），全部从 `./index.js` 导入：门面 re-export 使其无需改导入，同时它们构成门面的额外护栏。

## 阅读顺序

1. 先读本文件与 `entry-surface.txt`，确认公共面；
2. 找某个合同：先用名字在 `entry-surface.txt` 定位，再打开 `base.ts` / `action.ts` / `index.ts`；
3. 改入口或导出：先看 `entry-surface.txt` 与 `entry-contract.test.ts`，再动 `index.ts`。

## 禁区

- 入口不新增 `export *`（G06 切片 1 已清零，保持 0）；
- 类型再导出必须写 `export type`（仓库 `verbatimModuleSyntax: true`）；
- 不重新生成 `entry-surface.txt` 就不改导出面；
- 此处只放 schema 与类型，不放编排逻辑或 I/O。

更新日期：2026-09-14
