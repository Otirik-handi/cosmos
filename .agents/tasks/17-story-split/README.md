# Task 17：Story split v1（历史壳 + `replaced_by[]` + 显式关系迁移，Phase 2 第七切片）

## User Request / Topic

2026-09-09 用户指示「开下一片」。Proposal [`story-split-v1`](../../../docs/proposals/story-split-v1.md) 经评审接受（两项裁决：映射范围取「单命令全映射」、`StoryDetail.entry` 放宽为可空），稳定决定沉淀于 [`ADR-0012`](../../../docs/adr/0012-story-split-v1.md)，PRD §7.5 第七切片注记与信息模型 §4.6 注记已同步。

## Goal

交付 ORG-004/014/020/022 的 split 侧语义：

```text
历史壳          -> StoryReplacement 关系表 + 状态派生；旧 ID 不写 alias、不静默重定向
读取投影        -> StoryDetail.story.status/replacedBy[]；entry 可空、entries 可为空
单命令显式映射  -> 每个后继至少 1 主成员；可迁移主成员/证据链接/Story↔Entity/Topic 成员
留在壳          -> 未列出的关系留在历史壳；用户状态（收藏/标签/收藏夹/批注/Spotlight）不迁移
写边界          -> 历史壳拒绝 merge / 改 Revision / 再次 split
```

## Scope / Non-goals

Scope：

- `StoryReplacement` 表（`(storyId, successorStoryId)` 唯一、`(successorStoryId)` 索引、级联到 Story）+ forward-only migration。
- contracts：`storySuccessorSchema`、`splitStoryCommandSchema`、`StoryDetail.story.status`/`replacedBy[]`、`StoryDetail.entry` 可空、`StoryDetail.topics`（供 Web 迁移 Topic 成员）。
- application：`StorySplitConflictError`（`code: "conflict"`）+ `splitStory` 端口。
- storage：`splitStory` 单事务（建后继 Story + 初始 Revision、改指四类关系、写 `StoryReplacement`、发 `story.split.v1` 与 `story.revision_created.v1`）；`story()` 壳投影与空成员容忍；`mergeStories`/`updateStoryRevision` 的壳写边界。
- transport-http + API：`POST /api/v1/stories/:storyId/splits`。
- Web：Story 面板「拆分 Story」表单（后继标题/kind、成员去向、证据条目去向、实体去向、Topic 去向）+ 历史壳视图（无成员时渲染 `replacedBy[]`）。
- 文档：`docs/spec`（contracts/storage/interfaces）、`docs/testing`、`PROJECT-STATUS`。

Non-goals（见 Proposal / ADR-0012）：

- 用户状态的显式迁移、批量与撤销（待决定事项 10）。
- Read State 上线后 `updated_since_last_seen` 的 split 投影（待决定事项 9）。
- 自动拆分建议/自动聚类（ORG-021）。
- Story↔Story 类型化关系（信息模型 §4.5）。
- 「撤销 split」操作（撤销走补偿操作，不删除历史）。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke。

## 权威合同

- Proposal [`story-split-v1`](../../../docs/proposals/story-split-v1.md)（accepted，2026-09-09）。
- ADR [`0012`](../../../docs/adr/0012-story-split-v1.md)；ADR [`0006`](../../../docs/adr/0006-story-domain-v1.md)（merge canonical/alias 与 split 后置）、[`0011`](../../../docs/adr/0011-entry-story-evidence-v1.md)（证据关系 Revisit Gate）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) ORG-004/014/020/022 与 §7.5 第七切片注记。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §4.6。
- 现状 spec：contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10–16 交付，本切片扩展）。

## 实施切片（capability map，无环依赖）

1. **切片 1：持久化 + 域命令**（migration + storage，无公共面）
   - `StoryReplacement` 表与 migration；
   - `splitStory` 事务命令 + 四组映射校验 + 领域事件；
   - `story()` 壳投影（`status`/`replacedBy`/空成员）与写边界（merge/updateRevision/再 split）。
2. **切片 2：公共合同与 Product API**（contracts + application + transport-http + apps/api）
   - 命令 schema、读取字段、错误类与端口；transport client；API 端点与错误映射。
3. **切片 3：Web + 组件实验室 + 浏览器 E2E**
   - Story 面板拆分表单与历史壳视图；`entry` 可空改造；组件实验室 fixture 与登记；浏览器用例。

## Current State

- 生命周期阶段：切片 1（持久化 + 域命令）、切片 2（合同 + API + transport）与切片 3（Web + 组件实验室 + 浏览器 E2E）均已实现并通过门禁，已随 `8d44000` 合入并推送 `master`。
- 连贯目标：让用户能把一个 Story 显式拆成多个后继，同时保留可回看的历史壳。
- 可观察验收（≤3 条）：
  1. 把 2 个成员的 Story 拆成两个后继后，旧 Story 详情返回 `status=split` 与两个后继，且不再有成员；两个后继各自可打开且带各自的成员与迁移过来的关系；
  2. 未列出的关系（成员/证据/实体/Topic）仍留在历史壳，不会被复制到任何后继；
  3. 历史壳上的 merge、改 Revision、再次 split 都返回 409。
- 依赖：Task 10（Story merge/alias 与 Entry 主归属）、Task 11（Topic membership）、Task 12（Story↔Entity）、Task 16（Entry↔Story 证据链接）。
- 受影响合同：contracts（新命令 + StoryDetail 三个字段变化）、application（错误 + 端口）、storage-prisma（新表 + 命令 + 读取 + 写边界）、api（新端点）、transport-http（client 方法）、web（Story 面板）。
- 验证层级：focused（contracts/storage）→ API 集成 → 浏览器 → 全量门禁（已执行，见下）。

## 追加切片（2026-09-15）：用户状态迁移与撤销

Phase 2 收口项之一，维护者 2026-09-15 选定并接受 Proposal。**已实现，待维护者验收后合并**；改动在分支 `feat/t17-story-user-state-migration`（worktree `.worktree/story-user-state-migration`，基线 `2e46dca`），本目录记录随分支提交。

- 生命周期阶段：实现与门禁完成，待验收合并。
- 连贯目标：让拆分后留在历史壳上的用户状态可以显式搬到该去的后继，并且能退回。
- 可观察验收（≤3 条）：
  1. 拆分后历史壳上的收藏/标签/收藏夹/批注/看板固定可勾选迁到指定后继，提交前显示迁移摘要，成功后壳与后继两端状态都正确；
  2. 把来源选成后继、去向选成本壳即为撤销，状态原样回到壳上；
  3. 迁到与该壳无关的 Story、或命名一条不在来源 Story 上的行都返回 409，且不产生任何改动与领域事件。
- 依赖：Task 13（Label/Collection/Annotation/Favorite 读端点）、Task 14（SpotlightPlacement）、本 Task 切片 1–3（历史壳与 `replacedBy[]`）。
- 受影响合同：contracts（新命令 + 结果 DTO）、application（新错误 + 端口）、storage-prisma（新命令，**无 schema/migration 变更**）、api（新端点 + 路由表快照 114 → 115）、transport-http（client 方法）、web（历史壳上的迁移区块）。`StoryDetail` 等读合同不变。
- 验证层级：unit（storage/API/contracts）→ 浏览器产品 E2E → 全量门禁（已执行，见下）。

## Decisions and Deviations

- 以 ADR-0012 六条为稳定边界（壳表 + 派生状态、`entry` 可空、单命令显式映射、用户状态留在壳、事件审计、壳写边界）。
- `splitStory` 返回历史壳的 `StoryDetail`（而非某个后继）：调用方刚拆开对象，面板应立刻显示壳与后继列表；后继详情可由 `replacedBy[]` 再打开。
- Web 表单不提供「用户状态迁移」入口（收藏/标签/收藏夹/批注/Spotlight），与 ADR-0012 决策 4 一致。（2026-09-15 注记：该决策由本期追加切片取代——ADR-0020 实现了迁移与撤销，历史壳上已有入口；本条保留为当时的记录。）
- Web 拆分表单不逐后继编辑 `summary`/`subtype`：`summary` 传 null、`subtype` 继承原 Story（避免静默丢失）；两者仍可通过 API 显式指定，记为偏差。
- 为让 Web 拆分表单能列出并迁移 Topic 成员，`StoryDetail` 增加 `topics` 投影（向后兼容新增，超出 Proposal 明列字段，但 Proposal 的映射范围要求 UI 可达）。
- 追加切片（2026-09-15）：迁移命令按 Label/Collection **自身 id** 命名而不用内部分配行 id。原设计写的是 `labelAssignmentIds`/`collectionItemIds`，实现期发现读模型只暴露 Label/Collection 自身 id，客户端拿不到分配行 id；因 `(label, story)` 与 `(collection, story)` 唯一，按自身 id 定位无歧义，且不必改 `StoryDetail`（Proposal 明确承诺不改读合同），故改为此形态。
- 追加切片（2026-09-15）：迁移区块挂在历史壳上（唯一知道整个家族的一端）。后继在读模型里没有指回壳的引用，要做到后继也能发起迁移就得给 `StoryDetail` 加字段，与「不改读合同」冲突；因此把来源做成可选（壳或任一同族成员），撤销由「来源=后继、去向=壳」表达，同样一次点击面。
- 追加切片（2026-09-15）：空选择是 no-op（返回全零、不写领域事件），不是错误。Web 在没有任何勾选时禁用提交按钮。
- 追加切片（2026-09-15，实现缺陷）：迁移区块最初把 `onLoadSource` 放进 effect 依赖。父组件每次重渲染都会换掉这个函数身份，effect 随之重跑并取消上一次读取，导致切换来源后永远停在「正在读取该成员的标记…」；浏览器用例的 trace 显示同一组四个读请求在 100ms 内连发数轮后停止提交。改为用 ref 持有回调、effect 只依赖来源 Story id 后解决（该用例从 5 分钟超时降到约 4 秒）。

## Implementation Walkthrough（2026-09-09）

1. **持久化层**：`schema.prisma` 新增 `StoryReplacement`（`(storyId, successorStoryId)` 唯一、`(successorStoryId)` 索引、两列都级联到 Story），`Story` 加 `successors`/`splitFrom` 反向关系；migration `20260909160000_story_split_v1`（forward-only、全新表无 backfill）。
2. **contracts**：新增 `storySuccessorSchema`、`storyTopicSchema`、`storySplitSuccessorSchema` 与 `splitStoryCommandSchema`（2–20 个后继、每个后继 ≥1 个 `entryIds`、三组辅助 id 默认空数组）；`storyDetailSchema` 增 `story.status`/`story.replacedBy`/`topics`，`entry` 放宽为可空。
3. **application**：新增 `StorySplitConflictError`（`code: "conflict"`）与 `splitStory` 端口。
4. **storage**：`isStoryShell` 辅助判定；`splitStory` 单事务（先校验四组映射属于当前关系且跨后继不重叠、禁止自关联、禁止拆历史壳/无成员 Story，再创建后继 Story + revision 1、改指四张关系表、写 `StoryReplacement`、发每个后继的 `story.revision_created.v1`（`cause: split`）与一条 `story.split.v1`，返回历史壳）；`story()` 去掉「至少一个成员」的返回 null 条件、投影 `status`/`replacedBy`/`topics` 与可空 `entry`；`mergeStories`/`updateStoryRevision` 拒绝历史壳。
5. **transport/API**：client 新增 `splitStory`；API 新增 `POST /api/v1/stories/:storyId/splits`，经 `sourceCommandError` 映射 400/404/409。
6. **Web**：StoryPanel 新增「拆分 Story」表单（2–5 个后继标题/kind、成员/证据/实体/Topic 各自的「留在历史壳 / 后继 N」下拉、提交前要求每个后继至少 1 个成员）与「历史壳」区块（后继按钮可打开、`entry` 为 null 时不渲染 Entry/Revision 详情、写操作区整体隐藏）；`page.tsx` 新增 `splitStory` 回调并以返回的壳刷新面板与相关内容；组件实验室新增 Splittable / Historical shell 两个场景。
7. **文档**：ADR-0012 + ADR 索引、PRD §7.5 第七切片注记、信息模型 §4.6 注记、`docs/spec`（contracts/0001、storage/0001、interfaces/0002/0004/0005、README migration 顺序）、`docs/testing/README.md` 与 `PROJECT-STATUS.md`。

## Verification / Gate

验证（2026-09-09，实际运行）：

- `bun run typecheck` 全仓通过；`bun run lint:web` 0 error（2 个既有 warning）；`bun run build`（含 Next standalone）通过；`bun run docs:check` 364 文件 failures=[]；`git diff --check` 干净。
- focused：contracts 32/32（新增 split 命令与壳投影用例）、transport-http 14/14（新增 split 端点用例）、api controller 35/35（新增 split 端点与 409/400 映射）、storage `story-split` 4/4（显式映射、校验冲突、壳写边界、零成员壳 + 旧库 upgrade）、component-lab registry 12/12 全部通过。
- 全量 `bun run test`：48 文件 / 417 用例，362 通过；55 例失败全部集中在 storage-prisma 的 `prisma migrate deploy` 5s 超时 + EBUSY（既有 Windows SQLite 并行负载抖动），`bunx vitest run --no-file-parallelism packages/storage-prisma` 串行 12 文件 / 103 用例全部通过。
- 浏览器产品 E2E：`COSMOS_E2E_WEB_PORT=4194 bunx playwright test --config playwright.config.ts` **13/13 通过**（新增“归并成双成员 Story 后拆分 + 壳视图 + 后继打开”用例；`ingestFeed` 增加按来源名等待本来源卡片，避免共用 fixture 时提前放行）。
- 组件实验室浏览器：`bun run test:browser:component-lab` **13/13 通过**。
- Node 进程 E2E：`BUN_BINARY=<真实 bun.exe> bun run test:e2e` **4/4 通过**。
- 未运行：Windows Node smoke（`scripts/smoke-node.ps1`）、Docker/Compose、发布部署（均为既有后置边界）。

### 追加切片验证（2026-09-15，实际运行，worktree `.worktree/story-user-state-migration`）

- `bun run typecheck` 全仓 0；`bun run test` **88 文件 / 524 用例**全绿；`bun run build`（packages + API + Worker + Next standalone）通过；`bun run lint:web` 0 error（86 个既有 warning，本次新增与改动的文件 0 warning）；`bun run docs:check` 625 文件 `failures=[]`；`git diff --check` 干净。
- **先红后绿**：短路 `migrateStoryUserState` 的事务后，`packages/storage-prisma/src/story-user-state-migration.test.ts` 7 例中 4 例失败；仍通过的 3 例断言的是「拒绝不合法的请求」与「空选择 no-op」，本就不需要迁移发生。恢复实现后 7/7 通过。
- focused：storage `story-user-state-migration` 7/7（只迁移命名项、反向即撤销、目标侧去重优先、家族外与同 Story 拒绝、命名不在来源的行拒绝、Entry 级标记不受影响、空选择不写事件）；contracts / transport / API 相关用例随全量跑通；API 路由表守卫 3/3（快照 114 → 115）。
- **导出面**：按入口治理规则显式重生成 `packages/contracts/entry-surface.txt` 与 `packages/application/entry-surface.txt`，diff 只有本次新增的 6 项（3 type + 3 value）与 1 项（新错误类），无其它漂移。
- 浏览器产品 E2E：`COSMOS_E2E_WEB_PORT=4191 bunx playwright test --config playwright.config.ts` **17/17 通过**，其中拆分场景扩展为「拆分前留下标签与收藏 → 拆分后从壳迁到后继并核对两端 API 状态 → 反向迁回即撤销」。
- 组件实验室浏览器：`COSMOS_E2E_WEB_PORT=4192 bunx playwright test --config playwright.component-lab.config.ts` **13/13 通过**（`split` 场景沿用，fixture 补两个回调以渲染迁移区块）。
- 未运行：property、Node 进程 E2E、Windows Node smoke、Docker/Compose、发布部署、真实来源联网验收。
- 未做（需维护者授权）：commit 之外的推送、合并 `master`、清理 worktree 与分支。

## Follow-ups

- 用户状态显式迁移与撤销**已实现**（ADR-0020，2026-09-15）；Read State 投影、自动拆分建议按 ADR-0012 Revisit Gate 评估。
- ADR-0020 的 Revisit Gate：可查询的迁移历史、一键撤销最近一次迁移、Entry 级错位的统一迁移语义。
- Web 拆分表单的 `summary`/`subtype` 逐后继编辑（当前继承原 Story）可按需要补齐。
- Phase 2 需求清单其余条目：Story subtype 注册表（ORG-013）已交付；自动聚类（ORG-021）已于 2026-09-15 改标 Phase 3。
