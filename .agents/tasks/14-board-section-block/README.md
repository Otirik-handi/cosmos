# Task 14：可配置看板 v1（Phase 2 第五切片）

## User Request / Topic

2026-09-09 用户确认：Phase 2 第五切片为「可配置 Board/Section/Block」；Proposal [`board-section-block-v1`](../../../docs/proposals/board-section-block-v1.md) 经评审接受（四项默认：Spotlight 只做人工固定、多 Board 实体、四类 Block 全做、拆 2 子切片），稳定决定沉淀于 [`ADR-0010`](../../../docs/adr/0010-board-section-block-v1.md)，PRD §7.8 第五切片注记（含待决定事项 3 决策注记）与信息模型 §7 v1 切片注记已同步。

## Goal

交付 PRD §7.8「看板与浏览体验」BRD-002/003/004(v1)/006 的可配置看板层：

```text
Board/Section/Block 三层配置实体 -> Block 是纯展示配置（删/藏/复制/移动不触碰内容）
四类 Block -> feed（绑定 SavedView）/ spotlight / source-health / topic-list / collection
多 Board 实体 -> 应用侧幂等 seed 默认 Board（热点/精华/信息流三 Section）
SpotlightPlacement v1 -> 仅 source=manual、expiresAt=null，绑定 Board，pin Story/Topic
Product API -> Board/Section/Block CRUD + move/visibility/duplicate + pin/unpin
Web -> 首页按 Board 树渲染（只读渲染 -> 编辑模式两步交付）
```

## Scope / Non-goals

Scope：

- `Board`（name 唯一）/ `BoardSection`（title + position）/ `BoardBlock`（type 受管枚举 + 白名单 config + position + visible）。
- Block 类型：`feed`（必填 `savedViewId`）、`spotlight`（人工固定列表）、`source-health`、`topic-list`、`collection`（必填 `collectionId`）；未知 type 降级占位。
- `SpotlightPlacement`（targetType 受管枚举 story/topic + targetId + boardId 必填 + source=manual + 可空 reason/expiresAt）；`(boardId, targetType, targetId)` 唯一；物理解除。
- Product API：Board/Section/Block 增删改 + move/set-visibility/duplicate + Spotlight pin/unpin + Board 树读取 + placements 列表（附带目标摘要）。
- 默认 Board 幂等 seed（应用侧，不进 migration）；Web 首页改造为 Board 树渲染 + 编辑模式 + pin/unpin 交互。
- `mergeStories`/`mergeTopics` 同事务重定向 placement（冲突丢弃 obsolete 侧重复项）。

Non-goals（见 Proposal / ADR-0010）：

- 自动 Spotlight policy、Trend Signal、评分/迟滞/TTL 续期（REC-014，Phase 4）。
- Workspace/Artifact Block（BRD-005，Phase 3）、Spotlight 指向 Workspace/Artifact。
- 拖拽排序、网格布局编辑器（v1 纵向流 + 上移/下移）、Board 级视觉主题。
- Board/Query snapshot、Publication、推送（PUB 系列，Phase 5）。
- Feed 反馈（曝光/隐藏记录）、Read State「未读」过滤。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`board-section-block-v1`](../../../docs/proposals/board-section-block-v1.md)（accepted，2026-09-09）。
- ADR [`0010`](../../../docs/adr/0010-board-section-block-v1.md)；ADR [`0007`](../../../docs/adr/0007-topic-domain-v1.md)/[`0009`](../../../docs/adr/0009-user-organization-v1.md)（复用受管枚举/多态 target/command 编排模式，Saved View 是 Feed Block 绑定目标）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) BRD-002/003/004/006、§13 待决定事项 3、§7.8 第五切片注记。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §5.2、§6.8、§7、§8.7、§9。
- 现状 spec：domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10–13 交付，本切片扩展）。

## 实施切片（capability map，无环依赖，逐片合入）

1. **子切片 A：Board/Section/Block 域 + API + Web 只读渲染**
   - domain：`blockTypes` 受管枚举 + 未知降级、config 按 type 判别校验；
   - Prisma：`Board`/`BoardSection`/`BoardBlock` + migration（forward-only、只增不改）；
   - storage 事务命令：board/section/block CRUD + move/set-visibility/duplicate + 默认 Board 幂等 seed + Board 树读取；
   - contracts DTO/命令 schema + transport-http + API 端点；
   - Web：首页按 Board 树渲染四类 Block（只读），Board 切换器。
2. **子切片 B：Spotlight 人工固定 + Web 编辑模式**
   - Prisma：`SpotlightPlacement` + migration；pin/unpin 事务命令；`mergeStories`/`mergeTopics` placement 重定向；
   - contracts/API：pin/unpin 命令与 placements 列表（附带目标摘要）；
   - Web：编辑模式（Section 管理 + Block 增删/排序/隐藏/复制/配置）+ Spotlight Block pin/unpin 交互。

## Current State

- 生命周期阶段：子切片 A、B 均实现完成、门禁通过，已随 `2ea8939` 合入并推送 `master`。
- 本轮（2026-09-09）：Proposal accepted、稳定文档同步（PRD/信息模型/ADR-0010/ADR 索引）；worktree `.worktree/board-section-block`、分支 `feat/t14-board-section-block`（基线 master `038ae1b`）已按授权创建；两个子切片代码、focused 测试、浏览器 E2E 与 spec 同步完成。
- 连贯目标：交付 Board/Section/Block 配置域、只读渲染与编辑模式，以及人工 Spotlight 固定。
- 可观察验收（≤3 条）：
  1. 首页按默认 Board 树渲染出三 Section 与初始 Block（Feed/来源健康/Topic/Spotlight 各就位），刷新后保持；
  2. 编辑模式可增删分区与区块、调整顺序/可见性/复制/绑定，写命令经 API 生效且删除 Block 不影响底层内容；
  3. 从 Story/Topic 面板固定后热点区出现该项，解除后消失；未知 Block type 降级占位不阻断其它 Block。
- 依赖：Task 13 的 SavedView 合同与 `search` 过滤（已合入 master）。
- 受影响合同：contracts（新枚举/DTO/命令 schema）、application（repository 端口）、storage-prisma（新表 + 命令）、api（新端点）、transport-http（client 方法）、web（首页布局 + 编辑模式）。
- 验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器（已执行，见下）。

### 追加切片（2026-09-15）：Feed Block 独立取数（拖拽排序另记）

Phase 2 收口项之一，维护者 2026-09-15 选定。**Feed Block 独立取数已完成、待验收合并**；改动在分支 `fix/t14-board-feed-blocks`（worktree `.worktree/t14-board-feed-blocks`，基线 `2e46dca`，已 rebase 到合并 split 之后的 master），本目录记录随分支提交。

- 生命周期阶段：Feed Block 独立取数实现与门禁完成，待验收合并；拖拽排序见下方 2026-09-15 追加切片（已实现）。
- 连贯目标：让每个阅读流区块按自己的绑定取数，不再由「第一个可见区块」独占页面阅读流；交互式搜索归位页面级。
- 可观察验收（≤3 条）：
  1. 两个以上「阅读流」区块各自取数、互不干扰：绑定的按该 Saved View 条件显示，未绑定的显示最新内容流，悬空引用显示占位；
  2. 交互式搜索与「已保存视图」管理位于页面级 section（对齐 PRD §8.2），不再依附某个区块；
  3. 首页既有流程（录入、搜索、Story 打开、390px 无横向溢出）不回归。
- 依赖：无新增合同依赖；复用既有 `search`/`feed` 端点与既有 `boardConfig` schema。
- 受影响合同：**无公共合同变化**（`savedViewId` 早已持久化并可选）；Web 内部取数位置与布局变化。
- 验证层级：typecheck → 单元回归 → build → 浏览器产品 E2E（新增独立取数用例）→ 组件实验室 → `docs:check`。
- 分类依据：属**当前合同可判定的局部 Bug**——ADR-0010 已决定阅读流区块绑定 Saved View，实现却让第一个可见区块独占页面阅读流、`savedViewId` 写入后未被消费；按准入决策表不需要新 Proposal。

**开工前发现的合同冲突与裁决（2026-09-15）**：默认看板 seed 的阅读流区块是**未绑定**态（`packages/storage-prisma/src/repository/views.ts` 写入 `configJson: "{}"`）。照 ADR-0010 决定 5 的字面把「未绑定」渲染成占位，首页「信息流」分区将不再显示内容，与 PRD §8.1「首页看板展示热点、精华和多个分类 Feed」及 Phase 1 的「Feed 以 Story 为入口」验收冲突。维护者选 **方案 A**：未绑定 = 渲染默认最新内容流（即原首页行为），绑定 Save View 后按其条件取数；决定 5 对 `feed` 收窄为「悬空引用渲染占位」（`collection` 不变），ADR-0010 已加注记。

## Decisions and Deviations

- 以 ADR-0010 六条为稳定边界（Block 纯展示配置 + Section 无 kind、type 受管枚举 + 判别 config、Spotlight v1 仅 manual 绑定 Board、多 Board 实体 + 幂等 seed、悬空降级 + merge 重定向、command 编排无新 Workflow）。
- 交付顺序：2 个子切片逐片合入（域 + 只读渲染 → 编辑模式 + Spotlight），每片独立验收。
- seed 不进 migration（ADR-0010 决定 4）：migration 保持纯 schema，默认 Board 由应用侧幂等 seed。
- 追加切片（2026-09-15）：`BoardFeedBlock` 沿用 `BoardCollectionBlock` 的自取数模式——按绑定值重挂载、effect 内不做同步 setState、失败或悬空只降级占位。绑定的 Saved View 解析用页面已加载的 `savedViews`（不再单独拉一次视图详情）：既避免多一次请求，也让视图被改名/删除时区块跟着刷新。
- 追加切片（2026-09-15）：区块内的流是**紧凑列表**（标题 + 来源，点击打开 Story），不复用完整 `FeedBrowser`。完整的搜索卡与结果列表留在页面级；区块是看板的一个格子，不需要承载搜索表单。
- 追加切片（2026-09-15）：组件实验室的 `board-view` fixture 给 `feed` 一个固定响应，使自取数区块在实验室里渲染内容而不是失败占位；此前该 fixture 用 `feedSlot` 传合成内容，现在改为覆盖 client 的 `feed`。
- 追加切片（2026-09-15，验证期发现）：拆分场景的浏览器用例原先只断言收藏按钮翻转、没有服务端确认，标签写入慢时可能在状态落库前就拆分并在事后读到中间态（观察过一次该失败）。已改为先轮询 API 确认收藏与标签都已落库再继续。

## Verification / Gate

- 每子切片按仓库验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器；全量门禁至少 typecheck、docs:check、test、build、git diff --check。
- 迁移类改动必须在 `.agent/tmp/` 用含旧数据的隔离库验证 upgrade（全新表，仍跑 fresh + upgrade 两态）。
- Web 首页布局改造后同步更新现有浏览器 E2E（ingest 流程 8 场景）的选择器与断言（ADR-0010 已记为验收工作一部分）。
- `docs/spec/` 在行为落地后同步（domain/0001、contracts/0001、storage/0001、interfaces/0002/0005）与 `docs/testing/README.md`。

## Implementation Walkthrough（子切片 A：域 + API + 只读渲染，2026-09-09）

实现顺序：

1. **文档层**：Proposal `board-section-block-v1` 从 reviewing → accepted（补接受决策记录）；PRD §7.8 第五切片注记 + §13 待决定事项 3 决策注记；信息模型 §7 v1 切片注记；新增 ADR-0010 与 ADR 索引登记。
2. **持久化层**：`schema.prisma` 新增 `Board`（name 唯一）/`BoardSection`（position）/`BoardBlock`（type/configJson/position/visible）；migration `20260909100000_board_section_block_v1`（forward-only、全新表无 backfill、Section/Block 级联删除）。
3. **domain**：新增 `blockTypes` 受管枚举（`feed`/`spotlight`/`source-health`/`topic-list`/`collection`）。
4. **contracts**：新增 `blockTypeSchema`、按类型判别的 `blockConfigSchemas`（strict，`feed.savedViewId` 可选以支持未绑定默认流、`collection.collectionId` 必填）、`blockConfigSchemaFor(type)` helper、`BoardSummary`/`BoardList`/`BoardBlock`/`BoardSection`/`BoardDetail` DTO、八个命令 schema 与 `BoardCommandAck`。
5. **application**：新增 `BoardNotFoundError`/`BoardNameConflictError`/`BoardSectionNotFoundError`/`BoardBlockNotFoundError`（复用 `code` 漏斗）与 16 个 repository 端口方法（写命令统一返回 `BoardDetail` 树）。
6. **storage**：实现树读取（单次 include）、Board/Section/Block 全部命令（position 重排、跨 Section move、隐藏、原位复制、级联删除）、config 按类型白名单校验（`stringifyBlockConfig`，ZodError 上抛）与 `ensureDefaultBoard` 幂等 seed（热点/精华/信息流三 Section + spotlight/topic-list/feed 初始 Block；并发 name 冲突回退已存在 Board）。全部写路径写 DomainEvent。
7. **transport-http**：新增 14 个 client 方法（含 `ensureDefaultBoard`、move/visibility/duplicate）。
8. **API**：新增 15 个端点（boards 6 + board-sections 3 + board-blocks 6），统一经 `sourceCommandError` 映射 400/404/409/500。
9. **Web**：新增 `BoardView`（Section/Block 分发、首个可见 feed Block 渲染页面持有的完整阅读流、source-health 渲染 SourceActions 插槽、topic-list 渲染 Topic 列表、collection 自取收藏夹详情、未知 type/悬空引用降级占位）；`page.tsx` 首载 `ensureDefaultBoard` 后按 Board 树渲染主区，失败回退完整阅读流；侧栏来源健康与 Topics 列表迁入 Block，保留服务状态/Entities/新建来源表单；组件实验室登记 `board-view` 与 fixture（不发 Product API 请求）。
10. **文档同步**：`docs/spec/` 五个文件（domain/0001、contracts/0001、storage/0001、interfaces/0002、interfaces/0005）与 `docs/testing/README.md`。

偏差与已知限制（记入本切片）：

- Web `BoardView` 的 `feed` Block 复用页面持有的完整阅读流，因此**多个 feed Block 只有第一个渲染真实内容，其余显示占位**——多 Feed Block 的独立取数（每个 Block 按自己的 SavedView 查询）留到子切片 B 编辑模式一并重构。
- `spotlight` Block 在子切片 A 只有空态占位（`SpotlightPlacement` 与 pin/unpin 是子切片 B）。
- 默认 Board 的「精华」Section 初始放 `topic-list` Block（seed 时不存在 Collection 实例，无法绑定 `collectionId`）；用户可在子切片 B 改为 Collection Block。
- 默认 Board 的「信息流」Section 同时含 `feed` 与 `source-health` 两个 Block：侧栏来源健康已迁入 Block 体系，seed 若不包含 `source-health` 会导致该看板整块消失（首次浏览器 E2E 发现的回归，已修复并补断言）。
- 修复 Task 13 遗留的浏览器 E2E 定位器冲突：`getByLabel("名称")` 在 Saved View 面板加入后同时匹配来源表单「名称」与「视图名称」，两个 spec 改为 `exact: true`（Task 13 未运行浏览器 E2E，故首次在本切片暴露）。
- Block 写命令沿用 Task 13 用户组织命令的形态：不带 `actor`/`reason`/幂等键（单用户本地真相）。
- `ensureDefaultBoard` 的语义是「无任何 Board 时创建默认看板」：删光所有 Board 后再次调用会重建，未做「用户已删除则不再 seed」的标记。
- `bun install` 在 worktree 重写了 `bun.lock` 的 registry URL 字段（本机镜像源差异），已 `git checkout` 还原，不带入提交。

验证（2026-09-09，实际运行）：

- `bun run typecheck` 全仓通过（packages + API/Worker/Web）。
- `bun run db:validate` 通过；`bun run db:generate` 通过。
- focused：`board-domain.test.ts` 5/5、contracts 40/40（新增 3 例）、transport-http 11/11（新增 1 例）、domain 10/10（新增 1 例）、api controller 32/32（新增 1 例）、component-lab 27/27（新增 board-view 登记）全部通过。
- `bun run test` 全量 44 文件 / 382 用例：363 通过；19 例失败全部是既有 Windows SQLite 并行抖动（storage-prisma 迁移测试 setup 的 `migrate deploy` 5s 超时 + EBUSY），串行重跑 7 个失败文件 44/44 通过（board-domain 5、entity-relation 5、story-orchestration 2、story-revision-versioning 1、topic-domain 5、user-organization 8、index 18）。
- `bun run build` 通过（含 Next standalone）；`bun run lint:web` 0 error（2 个既有 warning）；`bun run docs:check` 347 文件 failures=[]；`git diff --check` 干净。
- 浏览器 E2E：`COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser` 9/9 通过（ingest 来源创建/测试/启用/录入/Feed/搜索、offline 离线渲染、theme 三态与溢出），证明首页改为 Board 树渲染后既有产品流程完好；过程中发现并修复两处问题（seed 缺 `source-health` Block、Task 13 遗留定位器冲突）。
- 未运行（子切片 A 当轮）：`test:browser:component-lab`、Node 进程 E2E、Windows smoke、Docker/Compose、发布部署。其中组件实验室浏览器与 Node 进程 E2E 已在两个子切片收尾门禁中补跑通过（见下）。

## Implementation Walkthrough（子切片 B：Spotlight 人工固定 + Web 编辑模式，2026-09-09）

1. **持久化层**：`SpotlightPlacement`（boardId/targetType/targetId/source/reason/actorJson/expiresAt、`(boardId, targetType, targetId)` 唯一、Board 级联删除）+ migration `20260909120000_spotlight_placement_v1`。
2. **domain/contracts**：新增 `spotlightTargetTypes`（story/topic）与 `spotlightTargetTypeSchema`、`SpotlightPlacement`/`SpotlightPlacementList` DTO（含解析后的 `targetTitle`、读取侧放宽 targetType）、`PinSpotlightCommand`；`UpdateSectionCommand` 增加可选 `position` 以支持分区排序。
3. **application/storage**：新增 `SpotlightPlacementNotFoundError` 与三个端口；storage 实现幂等 pin（canonical 解析 + 目标/Board 校验）、物理解除、批量标题解析的列表，并在 `mergeStories`/`mergeTopics` 同一事务内重定向 placement（同 Board 冲突丢弃 obsolete 侧）；`updateSection` 支持 `position` 重排。
4. **transport/API**：client 新增 3 个方法；API 新增 3 个端点（list/pin/removals）。
5. **Web**：`BoardView` 重写——Spotlight Block 自取数并支持逐项解除、`refreshToken` 驱动刷新；`editable` 模式提供分区与区块的完整编辑控件（改名/排序/隐藏/复制/删除/跨分区移动/绑定配置/条数）；page 新增看板工具条（切换/编辑开关/新建看板）与统一写命令回调；Story/Topic 面板新增「固定到看板热点区」。
6. **文档同步**：`docs/spec/` 五个文件 + `docs/testing/README.md` + 浏览器 E2E 断言扩展。

子切片 B 偏差与已知限制：

- 隐藏的 Block 在**非编辑模式完全不渲染**、编辑模式保留「已隐藏」占位（便于恢复）——浏览器 E2E 覆盖该语义。
- 首次 E2E 暴露 `listBoards` 与 `ensureDefaultBoard` 并行的竞态（列表在 seed 前返回空，看板工具条不出现），改为串行调用。
- Spotlight Block 为自取数组件（`refreshToken` 触发重取），与 `BoardCollectionBlock` 同一模式；v1 只展示人工固定，自动 policy 后置 Phase 4。
- 多个 `feed` Block 仍只有第一个渲染真实阅读流（子切片 A 已记录），本片未改。
- **维护者实测缺陷修复（2026-09-09）**：在编辑模式创建「收藏夹」区块必然失败——contracts 把 `collectionId` 定为必填，而添加表单只能提交空 config，API 返回 400。修复：`collectionId` 改为可选（与 `feed.savedViewId` 同一「绑定可选、未绑定渲染占位」规则，ADR-0010 决定 2/5 同步），添加区块表单新增 Saved View / 收藏夹选择器支持创建时直接绑定；补浏览器 E2E 断言（未绑定收藏夹区块创建成功并显示占位）。

## 两个子切片收尾门禁（2026-09-09，实际运行）

- `bun run typecheck` 全仓通过；`bun run db:validate`、`bun run db:generate` 通过；`bun run build` 通过（含 Next standalone）；`bun run lint:web` 0 error（2 个既有 warning）；`bun run docs:check` 348 文件 failures=[]；`git diff --check` 干净。
- focused 测试：domain 10/10、contracts 41/41、transport-http 12/12、api controller 32/32、component-lab 27/27、storage `board-domain` 7/7 全部通过。
- 全量 `bun run test`：44 文件 / 392 用例，357 通过；35 例失败全部是既有 Windows SQLite 并行负载抖动（storage-prisma 迁移测试 setup 的 `migrate deploy` 5s 超时 + EBUSY），`bunx vitest run --no-file-parallelism packages/storage-prisma` 串行 **93/93 全部通过**。
- 浏览器产品 E2E：`COSMOS_E2E_WEB_PORT=4183 NODE_ENV= bun run test:browser` **9/9 通过**（含本切片新增的隐藏/恢复与 Spotlight 固定/解除断言）。
- 组件实验室浏览器：`COSMOS_E2E_WEB_PORT=4183 bun run test:browser:component-lab` **13/13 通过**。
- Node 进程 E2E：`BUN_BINARY=<真实 bun.exe> bun run test:e2e` **4/4 通过**（Windows 需指向 `node_modules/bun/bin/bun.exe`，npm shim 路径会 ENOENT）。
- 未运行：Windows Node smoke（`scripts/smoke-node.ps1`）、Docker/Compose、发布部署（均为既有后置边界）。

## 追加切片验证（Feed Block 独立取数，2026-09-15，实际运行）

- `bun run typecheck` 全仓 0；`bun run test` **88 文件 / 524 用例**全绿；`bun run build`（packages + API + Worker + Next standalone）通过；`bun run lint:web` 0 error（86 个既有 warning，本次改动文件 0 warning）；`bun run docs:check` 625 文件 `failures=[]`；`git diff --check` 干净。
- 浏览器产品 E2E：**18/18 通过**。新增用例断言：未绑定的阅读流区块渲染最新内容流（不是占位）；再绑定一个匹配不到内容的 Saved View 后两个区块各取各的（绑定的显示「视图「空视图」没有匹配的内容。」，未绑定的仍是最新内容）；搜索与「已保存视图」位于页面级 `region`「信息库与搜索」；首页 390px 与 1440px 无横向溢出。
- 组件实验室浏览器：**13/13 通过**。
- 首次运行新增用例时失败过一次，原因是测试用的搜索词带连字符，撞上了 search 端点把用户输入直接交给 SQLite FTS5 `MATCH` 的既有缺陷（500）。改用不含 FTS5 特殊字符的搜索词后通过；**该缺陷属搜索路径、不属于本切片**，见 Follow-ups。
- **合并后在 master 重跑浏览器套件时观察到同一 spec 文件内的间歇失败**（2026-09-15）：整套 17/18，失败的是拆分场景（拆分前已由 API 确认落库的标签/收藏，在拆分后读不到）。本切片的验证结论按「分支内 18/18、合并后 17/18（1 例间歇失败）」如实记录，不按绿灯口径写。该用例的症状、实际观察次数、当前判断（含未查清的部分）与建议的处理次序统一登记在 [`docs/testing/known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md)，本文件不重复维护。**本切片可能加剧了它**：页面现在每个阅读流区块各发一次取数请求，叠加页面级阅读流，单位时间并发读比以前多。
- 未运行：Node 进程 E2E、Windows Node smoke、Docker/Compose、发布部署、真实来源联网验收。

## 追加切片（2026-09-15）：区块拖拽排序

Phase 2 收口尾巴。维护者 2026-09-15 按真人验收结论把拖拽排序从「后置可选」升级为**必做**（原话：用上下按钮排序让人烦躁、容易丢失注意点）。本轮实现落在分支 `feat/t14-board-drag-sort`（worktree `.worktree/t14-board-drag-sort`，基线 `ae180e9`）。

- 生命周期阶段：实现与门禁完成，维护者真人验收通过（分区内拖拽落点、松手无中间态、上移/下移按钮与键盘路径均确认与预期一致）；待合并。跨分区拖拽经维护者裁定为**不做**（理由见 ADR-0010 决定 7）。
- 连贯目标：编辑模式下可以直接拖动区块排序，分区内与跨分区都行；拖拽不是唯一路径，上移/下移按钮与键盘操作都不回退。
- 可观察验收（≤3 条）：
  1. 编辑模式下拖动「来源健康」到「阅读流」上方：服务端返回的新树里两者顺序互换，页面顺序同步；
  2. 跨分区拖动：**不做**（维护者 2026-09-15 裁定，理由见 ADR-0010 决定 7）——分区是「用户的一个关注方面」的语义容器、区块是分区内的内容细分，把区块拖到别的分区会破坏这两层语义，且拖拽高频易误触。编辑模式下每个分区各自是一个拖拽区，从 A 分区发起的拖动看不到 B 分区的落点，拖过去松手弹回原位（从代码结构推断，未实测）；跨分区重新归类不是拖拽的职责。
  3. 拖拽只改展示配置：底层内容不受影响；上移/下移按钮仍然存在可用，控制台无错误。
- 依赖：无新增公共合同依赖——服务端 `moveBlock`（分区内重排 + 跨分区移动 + 两侧 position 连续化）与 `updateSectionPosition` 早就实现，本轮只补界面。
- 受影响合同：**Web 内部实现**（`board-view.tsx` 编辑模式 + 新组件与纯函数模块）、组件实验室登记；ADR-0010 决定 6 加注记并新增决定 7；`docs/spec/interfaces/0005-web-client.md` 同步。
- 分类依据：ADR-0010 曾把拖拽排序列为后置项，维护者已明确改判为必做并留下理由，因此按 Task 14 追加切片执行，不需要新 Proposal。

**落地决定（2026-09-15）**：

- 拖拽库选 `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`（新增运行时依赖）。理由：该库自带键盘传感器与屏幕阅读器播报，跨分区拖拽有官方 pattern；备选的原生 HTML5 拖拽在触屏与键盘上支持极差，自研 Pointer Events 要自己补自动滚动、拖拽预览和无障碍播报。
- 只做 **Block**（分区内 + 跨分区），不做 Section 拖拽：对应维护者原话里的痛点，且 `updateSection` 要求同时回传 `title`，两套拖拽上下文会让无障碍与 E2E 面翻倍。服务端能力保留，界面不开放。（2026-09-15 收窄：跨分区拖拽经维护者裁定**不做**，理由见 ADR-0010 决定 7——分区是「关注方面」的语义容器、区块是分区内的内容细分；跨分区重新归类保留区块编辑条的「移到」下拉框作为显式入口，维护者同日裁定保留。）
- 落点解析放纯函数模块 `board-drag.ts` 并配单测；拖动中按指针位置判定落点，键盘拖拽回退到 dnd-kit 的碰撞结果。
- 松手只发**一次** `moveBlock`；不按拖动过程逐步发命令（避免半途状态与大量请求）。
- 顺手修掉一处既有缺陷：区块「下移」按钮的禁用条件原为 `index === block.position`（数组下标与 position 混用），现在用「是否已在本分区最后一位」判断。

**维护者实测缺陷修复（2026-09-15，同日两轮）**：

*第一轮：落点下标口径用错。* 维护者真人拖拽发现「把 A 拖到 B 下方，结果插到了 C 与 D 之间」。根因：服务端 `moveBlock` 的 `position` 是「**先移除被拖区块**、再在目标分区剩余区块之间插入」的下标（`PrismaCosmosRepository.moveBlock` 先 `filter` 掉被拖区块再 `splice`），而客户端传的是**包含被拖区块的全量数组下标**，向下拖时永远比正确值大 1。这一轮新增纯函数 `dropPositionFor`（按「指针在目标上半 → 插前、下半 → 插后」再加移除位移）修掉了算术，**但没有解决更根本的问题**：它仍然让客户端用指针几何自行判定落点，与服务端/预览各算一套（见第二轮）。

*第二轮：两套判定（本轮返工的真正根因）。* 维护者继续实测，又发现两个现象并给出决定性线索——**「排序结果出错，但排序的预览结果却没有问题」**：① 拖 B 向下、指针靠近 D，落库成了 `[A,C,D,B]`，预览是 `[A,C,B,D]`；② 拖 B 向上、指针靠近 B 原位置，落库成了 `[A,B,C,D]`（no-op，看起来「拖不动」）。预览是 dnd-kit 按碰撞结果 `over` 算出来给用户看的，而提交走的是第一轮保留的指针几何，于是同一动作有两套判定、必然分叉。一次性复算确认旧公式在这两个场景分别得到 `A,C,D,B` 与 `A,B,C,D`，与维护者观察逐字吻合。修复：**删掉指针几何判定（含 `resolveDropTargetFromPointer`、`dropPositionFor`、`onDragMove`/pointerRef 全套），提交只使用 dnd-kit 的 `over`**，按 arrayMove 语义取目标区块下标；`board-drag.ts` 里留下「别再把几何判定加回来」的原因注释。回归护栏是一条**不变量用例**：对 12 组（被拖区块，落点区块）断言「本地落定结果 = arrayMove 预览」，即「所见即所得」结构性成立，而不是靠另算一套去逼近。

*动画（同轮）：松手闪烁。* 维护者反馈排序动画「闪烁了一下」。原因有两处：其一，松手后 dnd-kit 先撤掉位移（画面回到旧顺序），要等服务端返回才跳成新顺序，中间多出一帧旧顺序；其二，`DragOverlay` 的落位回弹动画与已落定的布局打架。按维护者给出的第二个可接受形态修（「松手后预览直接成为实际结果，中间没有动画」）：新增纯函数 `applyLocalMove` 在 `boardCommands.moveBlock` 里**乐观应用**本地顺序（语义与服务端 `moveBlock` 一致，失败回滚并报错），并给 `DragOverlay` 加 `dropAnimation={null}`。选择第二个形态而不是「按曲线从旧位置动画到新位置」，是因为后者要在 dnd-kit 已持有 transform 的同一层上再叠一套 FLIP 动画，成本和回归面都更大；本地落定同样满足「没有中间态」。

## 追加切片验证（区块拖拽排序，2026-09-15，实际运行）

- `bun run typecheck` 全仓 0；`bun run test` **90 文件 / 540 用例**全绿；`bun run build`（packages + API + Worker + Next standalone）通过；`bun run lint:web` 0 error（86 个既有 warning，本次改动文件 0 warning）。
- focused：`apps/web/src/components/cosmos/board-drag.test.ts` **15/15 通过**——`resolveDropTarget` 5 例（落点取目标区块下标、首位、跨分区、隐藏区块仍占下标、原地/未知返回 null）+ **不变量 1 例**（12 组（被拖区块，落点区块）的本地落定结果都等于 arrayMove 预览）+ 两个实测场景各 1 例（B 落到 C 上得 `[A,C,B,D]`、B 落到 A 上得 `[B,A,C,D]`）+ `applyLocalMove` 6 例（同分区重排后 position 连续化、跨分区并重排两边、缺省目标分区、越界下标收敛、未知区块/分区原样返回）+ `findBlock` 2 例。**红证据**：一次性复算被删除的指针几何公式，两个场景分别得到 `A,C,D,B` 与 `A,B,C,D`，与维护者观察逐字吻合（该公式与临时脚本已删除，不作为资产保留）。
- `bun run typecheck` 全仓 0；`bun run test` **90 文件 / 542 用例**全绿（`apps/web/src` 为 11 文件 / 71 用例，含组件实验室登记守卫 `registry.test.ts` 12 例）；`bun run build`（packages + API + Worker + Next standalone）通过；`bun run lint:web` 0 error（86 个既有 warning，本次改动文件 0 warning）。
- 浏览器产品 E2E：**20/20 通过**（本轮含已登记间歇用例 `splits a Story into successors and keeps a historical shell` 也通过，该用例的不稳定性不因本轮改变）。用例 `moves a block to the slot right below its drop target`：自建四个区块的分区，断言每个区块的拖动入口指向自己，并调 `moves` 命令验证「A 落到 B 下方」得到 `[B, A, C, D]`，刷新后顺序保持、上移/下移按钮仍可用。
- 组件实验室浏览器 **13/13 通过**（新增 `board-sortable-blocks` 登记未破坏既有场景）；`bun run docs:check` 634 文件 `failures=[]`；`git diff --check` 干净；`bun install --frozen-lockfile` 通过（锁文件与 `apps/web/package.json` 一致）。
- **拖拽手势本身仍未自动化**：坐标方案试了 6 轮都不可靠——看板区块高度从约 230px 到 2400px 不等（内容流与来源健康区块），指针拖拽要求起点与落点同时在视口内，而 `locator.boundingBox()` 内部会先 `scrollIntoViewIfNeeded()`，测量动作本身就把看板挪出视口（实测 scrollY 从 244 跳到 6815，`elementFromPoint` 全部落到 `MAIN` 上）。键盘路径能激活拖拽（Space 后拖动浮层出现），但「放下」按键未被 dnd-kit 键盘传感器接收，代码里没有可靠的替代动作，就没有把这个用例留在套件里（本仓库已有两条登记在案的间歇用例，不再新增一条不稳定的）。**落点语义与本地落定已有单测，服务端往返有 E2E，但「按住拖动松手」这一步仍需真人复核**——本切片的两轮缺陷都来自真人实测，且都是自动化没有覆盖到的那一段。
- 服务端排序语义此前已有覆盖，无需重复：[`packages/storage-prisma/src/board-domain.test.ts`](../../../packages/storage-prisma/src/board-domain.test.ts) 覆盖跨分区移动 + 两侧 position 连续化。
- 未运行：Node 进程 E2E、Windows Node smoke、Docker/Compose、发布部署、真实来源联网验收。

## Follow-ups

- **搜索 FTS5 查询未转义（2026-09-15 发现，未修）**：`packages/storage-prisma/src/repository/search.ts` 把 `parsed.text` 原样放进 `entry_search MATCH ?`，用户搜索含 `-`、`"`、`*`、括号等 FTS5 语法字符的词会触发 SQLite 语法错误 → search 端点返回 500（实测：`GET /api/v1/search?text=绝不匹配-212c82&limit=5`）。这是既有缺陷，与看板切片无关；修法（把用户输入转成短语查询/转义引号）需要单独确认边界并补回归测试。
- **拖拽排序（维护者 2026-09-15 定为必做）**：**已实现**（2026-09-15，见「追加切片（2026-09-15）：区块拖拽排序」）。ADR-0010 决定 6 已加注记并新增决定 7。
- 子切片 B 已完成；本 Task 已在 `2ea8939` 合入并推送 `master`。
- 后续 Phase 2 切片候选：Story split 完整生命周期、`evidence_for`/`mentions`、自动聚类/Knowledge Workflow、Entity merge/dedup。
- 后续能力：Phase 4 Spotlight policy（为 `SpotlightPlacement` 加列与写入路径）、Phase 3 Workspace/Artifact Block、Read State「未读」过滤。
