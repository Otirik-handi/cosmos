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

- 生命周期阶段：子切片 A、B 均实现完成、门禁通过（verifying）；等待 commit/合入授权。
- 本轮（2026-09-09）：Proposal accepted、稳定文档同步（PRD/信息模型/ADR-0010/ADR 索引）；worktree `.worktree/board-section-block`、分支 `feat/t14-board-section-block`（基线 master `038ae1b`）已按授权创建；两个子切片代码、focused 测试、浏览器 E2E 与 spec 同步完成。
- 连贯目标：交付 Board/Section/Block 配置域、只读渲染与编辑模式，以及人工 Spotlight 固定。
- 可观察验收（≤3 条）：
  1. 首页按默认 Board 树渲染出三 Section 与初始 Block（Feed/来源健康/Topic/Spotlight 各就位），刷新后保持；
  2. 编辑模式可增删分区与区块、调整顺序/可见性/复制/绑定，写命令经 API 生效且删除 Block 不影响底层内容；
  3. 从 Story/Topic 面板固定后热点区出现该项，解除后消失；未知 Block type 降级占位不阻断其它 Block。
- 依赖：Task 13 的 SavedView 合同与 `search` 过滤（已合入 master）。
- 受影响合同：contracts（新枚举/DTO/命令 schema）、application（repository 端口）、storage-prisma（新表 + 命令）、api（新端点）、transport-http（client 方法）、web（首页布局 + 编辑模式）。
- 验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器（已执行，见下）。

## Decisions and Deviations

- 以 ADR-0010 六条为稳定边界（Block 纯展示配置 + Section 无 kind、type 受管枚举 + 判别 config、Spotlight v1 仅 manual 绑定 Board、多 Board 实体 + 幂等 seed、悬空降级 + merge 重定向、command 编排无新 Workflow）。
- 交付顺序：2 个子切片逐片合入（域 + 只读渲染 → 编辑模式 + Spotlight），每片独立验收。
- seed 不进 migration（ADR-0010 决定 4）：migration 保持纯 schema，默认 Board 由应用侧幂等 seed。

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

## Follow-ups

- 子切片 B 已完成；本 Task 实现阶段结束，等待 commit/合入授权。
- 后续 Phase 2 切片候选：Story split 完整生命周期、`evidence_for`/`mentions`、自动聚类/Knowledge Workflow、Entity merge/dedup。
- 后续能力：Phase 4 Spotlight policy（为 `SpotlightPlacement` 加列与写入路径）、Phase 3 Workspace/Artifact Block、拖拽排序、多 Feed Block 独立取数、Read State「未读」过滤。
