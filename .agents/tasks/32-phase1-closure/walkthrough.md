# Task 32 walkthrough（过程、偏差与验证）

> 本文件是 Task 32 的唯一过程记录（append-only）；README 只保留摘要、范围、口径与下一步。

## 切片 1：LIB-001 搜索补三个过滤维度

### 口径与边界

- 「录入状态」按维护者 2026-09-18 裁定 = 该 Entry **当前 Revision 的本地媒体保存状态**（资产四态 `saved`/`metadata_only`/`skipped`/`failed`）；「未读」属 Read State（LIB-005 / Phase 4），不在本片。
- 「媒体类型」取内容形态 `ContentKind`（ING-017 已冻结的受管枚举），不新建枚举。
- 「作者」匹配发布者的 `name` 或 `handle`，子串、大小写不敏感；发布者为空的条目不会被任何作者条件命中。
- 合同字段：`author`（字符串）、`contentKind`（受管枚举）、`assetStatus`（受管四态），都是可选单值——多选留给后续需要时再加，避免现在就把 Saved View 的条件形状搅乱。

### RED

新增 [`packages/storage-prisma/src/search-filters.test.ts`](../../../packages/storage-prisma/src/search-filters.test.ts)：一条来源里录入三条内容（Alice/视频/已保存媒体、Bob/文章/失败媒体、无作者/帖子/无媒体），断言三个维度各自与组合都能筛出正确条目。

```text
bunx vitest run packages/storage-prisma/src/search-filters.test.ts   # 实现前
Test Files  1 failed (1)
     Tests  1 failed (1)
```

失败形态：`search({ author: "alice" })` 返回全部 3 条（条件被忽略）。

### GREEN

- [`packages/contracts/src/search.ts`](../../../packages/contracts/src/search.ts)：`searchQuerySchema` 增加三个可选字段与口径注释。
- [`packages/storage-prisma/src/repository/search.ts`](../../../packages/storage-prisma/src/repository/search.ts)：作者用 `json_extract(r.publisherJson, '$.name'/'$.handle') LIKE ? ESCAPE '\'`（含 LIKE 通配符转义，`a_b` 不会匹配 `axb`）；媒体类型 `r.contentKind = ?`；录入状态 `EXISTS (SELECT 1 FROM Asset a WHERE a.entryRevisionId = r.id AND a.status = ?)`。JSON1 的 `json_extract` 在本仓库 SQLite 上实测可用（该用例转绿即证据）。
- [`packages/transport-http/src/client-content.ts`](../../../packages/transport-http/src/client-content.ts)：`search()` 拼上三个 query 参数。
- Web：[`feed-browser.tsx`](../../../apps/web/src/components/cosmos/feed-browser.tsx) 表单加「作者」输入与「媒体类型」「录入状态」两个下拉（受管枚举，用 `contentKindSchema`/`assetStatusSchema` 收窄类型），筛选回显 chip 同步；[`page.tsx`](../../../apps/web/src/app/page.tsx) 的默认值、`onSearch`、结果提示同步；[`use-feed-workspace.ts`](../../../apps/web/src/app/home/use-feed-workspace.ts) 的套用视图显式清空这三个条件。

```text
bunx vitest run packages/storage-prisma/src/search-filters.test.ts
Test Files  1 passed (1)
     Tests  1 passed (1)
```

### 偏差与取舍

- **保存视图与新增过滤的冲突（有意为之）**：Saved View 的条件形状由 LIB-005（Phase 4）拥有，只有关键词/来源/时间/分类/Topic。当前搜索带了作者/媒体类型/录入状态时，`saveCurrentSearchAsView` **拒绝保存并给出原因**，而不是让这三个条件被 Zod 静默剥掉——静默丢条件比拒绝更难排查。代价：这三个条件暂时无法存成视图（属 Phase 4 扩展）。
- **表单值类型**：首版把三个字段写成 `z.string()`，`bun run typecheck` 立刻报 `page.tsx` 把 `string` 赋给受管枚举类型；改为 `contentKindSchema.or(z.literal(""))` 收窄后通过。这是本片唯一一次返工。

### 验证

| 命令 | 结果 |
|---|---|
| `bunx vitest run packages/storage-prisma/src/search-filters.test.ts` | 1 passed（新增） |
| `bunx vitest run packages/transport-http apps/web/src/components/cosmos/feed-browser.test.ts` | 10 文件 / 32 用例全绿（新增 [`client-content.test.ts`](../../../packages/transport-http/src/client-content.test.ts) 2 例：参数确实拼上 query、未传时不出现；`feed-browser.test.ts` 新增 3 例：默认值、trim 与受管枚举、越界值被拒） |
| `bunx vitest run packages/storage-prisma packages/contracts packages/transport-http apps/web apps/api` | 76 文件 / 415 用例全绿 |
| `bun run typecheck` | 0 |

未运行（本片）：浏览器产品套件、组件实验室——新控件没有新增浏览器用例；计划在五个切片完成后跑整套，届时覆盖回归但不单独证明这三个控件。剩余风险：新控件的端到端可用性只有组件级与表单级证据。

## 切片 2：ING-004 发现渠道

### 设计决定（维护者 2026-09-18 裁定）

字段由**连接器在域层声明**，不写进 manifest。理由（本片实施时发现）：Bilibili 的 hot 与 feed 是同一个 manifest（`source.bilibili@1`，只有 `fetch` 一个 operation）下的两种发现方式，manifest 表达不了这个差别；而连接器本来就知道自己的 mode。代价：manifest 上那个自由字符串 `discoveryContext` 仍是空串，留待后续清理。

### 实现

- [`packages/domain/src/index.ts`](../../../packages/domain/src/index.ts)：新增 `discoveryChannels`（account / recommendation / search / announcement / email / manual / related / agent / unknown）与 `DiscoveryChannel`；`NormalizedIngestItem.discoveryChannel?` 加为**可选**，并注明它不进内容指纹——同一条内容换一种发现方式不产生新 Revision（`fingerprintEntryRevision` 的入参本来就只含标题/摘要/正文/URL/kind/发布者，未改）。
- [`packages/contracts/src/base.ts`](../../../packages/contracts/src/base.ts)：`discoveryChannelSchema`（wire 校验）；[`action.ts`](../../../packages/contracts/src/action.ts) 的 `normalizedIngestItemSchema` 与 [`entry-relation.ts`](../../../packages/contracts/src/entry-relation.ts) 的 `observationSnapshotSchema` 各加一个可选字段；`entry-surface.txt` 重新生成（+2）。
- 连接器：RSS → `account`；Bilibili `mode=hot` → `recommendation`、`mode=feed` → `account`；AI HOT → `recommendation`。
- 仓储：写入 `discoveryContextJson` 时在既有 `kind`（触发类型）旁加 `channel`；读投影 `observationDiscoveryChannel()` 用受管枚举校验，缺失或非法值一律降级 `unknown`（升级前的行没有该字段）。
- Web：Story 面板的 Observation 徽标显示渠道文案（新增 `DISCOVERY_CHANNEL_LABELS`）。

### 验证

| 命令 | 结果 |
|---|---|
| `bunx vitest run packages/storage-prisma/src/observation-discovery.test.ts` | 2 passed（新增）：连接器声明的渠道能往返；旧数据缺字段时读回 `unknown` 而不是抛错 |
| `bunx vitest run plugins packages/storage-prisma packages/contracts apps/web packages/transport-http apps/worker apps/api` | 86 文件 / 467 用例全绿（连接器测试新增 3 处渠道断言：RSS=account、hot=recommendation、feed=account、AI HOT=recommendation） |
| `bun run typecheck` | 0 |
| `bun scripts/entry-export-surface.ts packages/contracts/src/index.ts --out packages/contracts/entry-surface.txt` | 456 个导出（+2：`discoveryChannelSchema` / `DiscoveryChannel`） |

未运行（本片）：浏览器产品套件；新徽标文案没有新增浏览器断言。剩余风险：渠道在界面上的展示只有类型与组件层证据。
