# G07 过程记录（append-only）

本文件是 G07 的过程、偏差与验证的唯一记录位置；README 只维护当前摘要、范围、门禁与下一步。追加规则与文档大小治理见根 `AGENTS.md`。

## 2026-09-14 立项

### 指令

维护者 2026-09-14：G06 收尾完成后开 G07，治理 `packages/transport-http/src/index.ts`；其余非红线文件暂不处理，等未来触碰红线再治理。

### 摸底

- 对象是**纯单体**：`src/` 下仅 `index.ts`（1269 行 / 42,368 B）与 `index.test.ts`（964 行 / 39,598 B），**0 处 `export *`**，解析后**仅 4 个导出**（`bun run scripts/entry-export-surface.ts packages/transport-http/src/index.ts`）。
- 因此提案固定顺序里的「桶文件模块地图化」不适用，跳过；实际执行「测试按行为拆 → 单体按聚合拆」。
- 两个文件都超红线，但**都是「行数越界、字节未越界」**：41.4 KB / 38.7 KB 均在 50 KB 之下——这正是当前门禁的盲区（见下）。

### 本轮核实到的口径问题（影响本项目全部后续选型）

G06 汇报里的「代码红线文件 3 → 0」只对**字节/token 门禁**成立。按提案 §4.1 的完整红线（源码/测试 **>800 行** 或 >50 KB 或 >15k token），仓库仍有 **10 个文件超红线**，全部为行数越界：`transport-http/index.ts`(1269)、`application/workflow-host-runtime.ts`(1205)、`worker-admin/index.ts`(1047)、`transport-http/index.test.ts`(964)、`application/media-acquisition.ts`(918)、`storage-prisma/workflow-backend.ts`(896)、`worker/workflow-ingest.test.ts`(864)、`plugins/collectors/index.ts`(818)、`component-lab/product-fixtures.tsx`(807)、`cosmos/board-view.tsx`(805)。根因是 `scripts/size-governance.py --check` 只判字节/token，行数不拦（该缺口治理索引早有记载）。维护者 2026-09-14 的指令按「红线才做」给出，因此在开工前需确认：**G07 只做维护者点名的 transport-http，其余 9 个待后续裁定**。

### 未做

worktree/分支创建（待维护者审批）；全部验证命令（尚无代码改动）。

## 2026-09-14 切片 0：前置（worktree + 基线 + 导出面与契约测试）

### 载体

- 维护者 2026-09-14 批复「批准 G07 开工」，并把**红线口径设定为完整口径**（>800 行 或 >50 KB 或 >15k token 先到先触发），裁定已写入治理索引。
- worktree `.worktree/g07-transport-http`，分支 `refactor/g07-transport-http`，基于 `master` `e33de88`（`git fetch origin` 后与 `origin/master` 一致）。
- 环境前置：`bun install`（1,659 包）+ `bun run db:generate`（G05/G06 教训复用）。

### 基线（对象 = 文件 + 同名测试）

| 文件 | 行数 | 字节 |
|---|---|---|
| `packages/transport-http/src/index.ts` | 1269 | 42,368（41.4 KB） |
| `packages/transport-http/src/index.test.ts` | 964 | 39,598（38.7 KB） |
| 对象合计 | 2233 | 81,966（80.0 KB） |

- **导出面 4 个**（2 值 / 2 类型）：值 `CosmosTransportError`、`HttpCosmosClient`；类型 `CosmosEventSource`、`HttpCosmosClientOptions`。0 处 `export *`，源码层与解析后一致。
- **内部形态**：顶层只有 4 个声明——两个 interface、`CosmosTransportError`（约 12 行）、`HttpCosmosClient`（**约 1058 行**，含约 90 个按资源排列的 `async` 方法：health/connector/来源定义/探测/媒体清理 → 来源 → 连接 → 存储备份 → 运行控制 → feed/search → story → topic → entity → label/collection/favorite/annotation/saved view → board/spotlight）。
- 构建产物基线：`packages/transport-http/dist` = 94 KB。
- madge 循环依赖基线：**0 环**（守卫是保持 0）。

### 新增资产

- `packages/transport-http/entry-surface.txt`：4 行导出面快照。
- `packages/transport-http/src/entry-contract.test.ts`：常驻契约测试，断言运行时值导出集合等于快照 `value` 行（2 个）。

### 验证（worktree 内）

| 命令 | 结果 |
|---|---|
| `bun run typecheck` | EXIT=0 |
| `bunx vitest run` | 82 文件 / 516 用例全绿（master 基线 81/515 + 本切片新增契约测试 1 文件 1 用例） |
| `bun run test:property` | 4 用例全绿 |
| `bun run test:e2e` | 4 用例全绿 |
| `bun run build:packages` | EXIT=0；`dist` = 94 KB |
| `bunx madge --circular --extensions ts packages/transport-http/src/index.ts` | 0 环 |

### 方案预告（待切片 2 执行）

沿用 **G03 先例：继承链拆文件 + 门面**——`HttpCosmosClient` 按资源域拆到多个模块（Base 承载构造与请求管道 → 来源/内容/用户组织/看板各一册 → `index.ts` 留 4 个导出的门面），类仍是单个、**消费方与导出面零改动**；模块级 helper 与请求管道抽到 `internals.ts`。切片 1 先按行为拆 `index.test.ts`（964 行）作为护栏。
