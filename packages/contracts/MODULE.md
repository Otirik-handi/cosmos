# MODULE: @cosmos/contracts

共享合同包：Zod schema 与对应类型的唯一定义处，被 56 个非测试源文件消费（API、Worker、Web、transport、storage 等）。不含运行时编排逻辑与 I/O。

## 公共入口

`src/index.ts` 只做导出与模块地图（**183 行**），解析后 **471 个导出（239 值 / 232 类型）**。

- 机器可读真相源：`entry-surface.txt`（排序后的 `kind<TAB>名称`），由 `bun run scripts/entry-export-surface.ts packages/contracts/src/index.ts` 生成。
- 常驻护栏：`src/entry-contract.test.ts` 断言运行时值导出集合等于快照的 `value` 行（239 个）；增删导出必须先显式重新生成快照。
- 环依赖：入口与模块之间 **0 环**（`bunx madge --circular`）；守卫是保持 0。

## 子模块地图

模块按域切分，依赖为单向（括号内是引用它的模块）：

| 文件 | 职责 | token |
|---|---|---|
| `index.ts` | 入口门面：只有导出与模块地图 | ~2.8k |
| `base.ts` | 基础合同：来源 / 内容 / 发布者 / 触发器 / 连接 / 媒体策略（83 导出） | ~3.9k |
| `collection-plan.ts` | 采集计划（ADR-0023）：快照读投影、创建/更新命令与 v1 重叠策略枚举（← base） | ~0.4k |
| `action.ts` | Action 与采集合同：Action manifest/执行、归一化采集项、媒体重试、Source fetch/checkpoint（53 导出） | ~3.3k |
| `source.ts` | 来源与采集：Connector 描述符、Catalog SourceDefinition 清单、来源配置探测、Job 快照、资产与媒体清理（← search、entry-relation） | ~2.4k |
| `run-control.ts` | Run/Job 生命周期：五态状态机、步与作业状态、Run 快照、取消/恢复/重跑命令与结果（← source） | ~0.6k |
| `platform.ts` | 运行平台：存储占用与备份、健康快照、服务错误、事件信封与 SSE 事件快照 | ~0.8k |
| `search.ts` | 搜索与 Feed 读模型：查询条件、FeedItem/FeedPage、SearchResult/SearchPage | ~0.4k |
| `entry-relation.ts` | Entry 侧读模型：修订快照与观测、Entry↔Story 关系与证据、Entry 详情/列表/分页、修订详情（← story、ingest 结果） | ~1.2k |
| `story.ts` | Story 域：详情与实体/标签/主题投影、后继关系、编辑命令（移动 Entry、更新修订、归并、拆分、证据挂接） | ~1.5k |
| `story-subtype.ts` | 受管 Story 子类型注册表：目录分页与查询 | ~0.3k |
| `topic.ts` | Topic 域：详情/摘要/分页与成员命令（创建、更新、归并、成员角色与恢复） | ~1.0k |
| `entity.ts` | Entity 域：类型与关系、别名、详情/摘要/分页与写入命令 | ~1.6k |
| `user-organization.ts` | 用户组织：Label、Collection、Favorite、Annotation 与 Saved View 条件与命令 | ~2.1k |
| `board.ts` | 看板：Block 类型与配置白名单、Board/Section/Block 详情与写入命令、Spotlight 人工固定 | ~2.1k |

测试与源码同级（`*.test.ts`），全部从 `./index.js` 导入：门面 re-export 使其无需改导入，同时它们构成门面的额外护栏。按域对应：`source.test.ts`、`entity-relation.test.ts`、`user-organization.test.ts`、`topic.test.ts`、`board.test.ts`、`story-subtype.test.ts`、`collection-plan.test.ts`，以及既有的 `run-control.test.ts`、`connection.test.ts`、`trigger.test.ts`、`action.test.ts`。

## 阅读顺序

1. 先读本文件与 `entry-surface.txt`，确认公共面；
2. 改某个合同：按上表定位所属域模块，只读该模块（多数 ≤3k token），不要读 `index.ts`；
3. 改入口或导出：先看 `entry-surface.txt` 与 `entry-contract.test.ts`，再动 `index.ts`。

## 禁区

- 入口不新增 `export *`（G06 切片 1 已清零，保持 0）；
- 类型再导出必须写 `export type`（仓库 `verbatimModuleSyntax: true`）；
- 不重新生成 `entry-surface.txt` 就不改导出面；
- 此处只放 schema 与类型，不放编排逻辑或 I/O；
- 新增模块必须保持依赖单向：`bunx madge --circular --extensions ts packages/contracts/src/index.ts` 必须是 0 环。

更新日期：2026-09-20
