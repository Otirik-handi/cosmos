# Proposal：可配置看板 v1（Board + Section + Block + 人工 Spotlight，Phase 2 第五切片）

> 状态：accepted
>
> 日期：2026-09-09
>
> 需求真相源：[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md)（BRD-002、BRD-003、BRD-004、BRD-006、LIB-005 注记、§13 待决定事项 3、§12 Phase 2 验收「用户可调整看板；删除 Block 不删除底层信息」）与 [`../requirements/0001-original-requirements.md`](../requirements/0001-original-requirements.md)
>
> 关联：信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §5.2（BoardPlacement 拆分）、§7（Spotlight 展示决定）、§8.7（看板精华区 = Board Section 展示选中对象）、§9 关系图（SP/F → B）；公共术语 [`../../CONTEXT.md`](../../CONTEXT.md)；ADR [`0009`](../adr/0009-user-organization-v1.md)（Saved View 条件合同，本片 Feed Block 复用）；Task 13 walkthrough（Saved View 与 `search` 过滤已交付）

## 问题

PRD §7.8「看板与浏览体验」要求 Phase 2 交付可配置看板：看板由可配置 Board、Section 和 Block 构成，用户可以调整顺序、隐藏、复制和配置区块，删除区块不删除内容（BRD-002）；默认看板按热点、精华、普通信息流组织，三个区域可引用相同对象但使用不同展示策略（BRD-003）；Spotlight Block 可由用户设置、能固定一个 Topic（BRD-004）；Feed Block 可绑定 Saved View，让不同分区拥有不同来源与排序配置（BRD-006）。当前实现完全没有这一层：

- `packages/storage-prisma/prisma/schema.prisma`、`packages/contracts/src/index.ts`、`packages/domain/src/index.ts`、`apps/api/src/app.controller.ts` 全部 grep 无 Board/Section/Block 概念（无命中）。
- Web 首页（`apps/web/src/app/page.tsx`）是纯硬编码布局：侧栏（服务状态 + 来源健康 + Topics + Entities）+ 主区 FeedBrowser（搜索卡 + 已保存视图面板）+ Story/Topic/Entity 弹层面板；用户无法调整任何区块的顺序、可见性或配置。
- BRD-006 的依赖已就绪：Task 13 已交付 Saved View（条件 = text/sourceId/时间范围/labelIds/topicIds）与 `search` 的 `labelIds`/`topicIds` 过滤，Feed Block 绑定 Saved View 只差 Block 配置层。
- 信息模型已冻结相关语义：Spotlight 是展示决定不是内容实体（§7），人工固定可不设 TTL、自动 Placement 用可续期 TTL（§5.2/§7）；「看板精华区 = Board Section 展示选中的对象」（§8.7）；`SpotlightPlacement` 与 Topic 字段解耦（§5.2）。本 Proposal 只做最小实现切片并处理实现级取舍，不引入新的语义分歧。

本 Proposal 把 Phase 2 第五切片冻结为「可配置看板 v1」：Board/Section/Block 三层配置实体 + 四类 Block（Feed 绑定 SavedView、Spotlight 人工固定、来源健康、Topic/Collection 列表）+ 多 Board 实体（产品预置一个默认 Board）+ 人工固定 Spotlight。**不包含**自动 Spotlight policy（Phase 4 REC-014）、Workspace/Artifact Block（BRD-005，Phase 3）、Board/Query snapshot 与 Publication（PUB 系列，Phase 5）、拖拽排序（v1 用上移/下移动词）。

## 已拍板输入（用户 2026-09-09 接受）

| 输入 | 决定 |
| --- | --- |
| Spotlight 范围 | 只做人工固定（pin Story/Topic 到看板热点区，不设 TTL）；自动 policy 推荐整体后置 Phase 4（REC-014） |
| Board 实例数 | 数据模型按多 Board 实体建模；产品 v1 预置一个默认 Board 并允许创建/切换多个（提前消化 PRD 待决定事项 3） |
| v1 Block 类型 | Feed Block（绑定 SavedView）、Spotlight Block、来源健康 Block、Topic/Collection 列表 Block，四类全做 |
| 交付拆分 | 拆 2 个子切片逐片合入：①Board/Section/Block 域 + API + Web 只读渲染（默认 Board seed + 四类只读 Block）；②Web 编辑模式 + Spotlight 人工固定（表 + 命令 + pin/unpin 交互） |

## 目标与非目标

### 目标

1. **Board/Section/Block 三层配置实体**：Board（命名看板）→ Section（带标题的分区容器）→ Block（可配置区块）。Block 是纯展示配置——创建、删除、隐藏、复制、移动 Block 不触碰 Story/Entry/Topic/Entity/Collection/SavedView/Source 等底层内容（BRD-002 验收核心）。
2. **四类 Block（受管 type 枚举）**：
   - `feed`：绑定一个 Saved View，渲染该查询条件下的 Story 流（BRD-006：开发、硬件、娱乐等分区各自配置）；
   - `spotlight`：渲染本 Board 的人工固定 Spotlight 列表（热点区，BRD-004 v1）；
   - `source-health`：来源健康摘要（把现有侧栏看板搬进 Block 体系）；
   - `topic-list` / `collection`：Topics 概览 / 命名收藏夹成员（把现有侧栏列表搬进 Block 体系；Collection Block 承载「精华区」语义，对齐信息模型 §8.7）。
3. **多 Board 实体 + 默认 Board seed**：Board 是实体（name 唯一），产品预置「默认看板」（热点 / 精华 / 信息流三 Section，对齐 BRD-003），seed 幂等；Web 支持创建与切换 Board。
4. **人工 Spotlight（SpotlightPlacement）**：与未来自动 policy 共用同一 Placement 合同——v1 只有 `source=manual`、`expiresAt=null` 的固定记录，绑定具体 Board（`targetType` 受管枚举 story/topic + `targetId`），解除即移除；满足「同一 Story 可以在不同 Board 有不同人工展示决定」（REC-016）与「人工覆盖绑定具体 Placement」（信息模型 §6.8）。
5. **Product API 写命令与读取**：Board/Section/Block CRUD + move/visibility/duplicate + Spotlight pin/unpin，沿用 Task 10–13 的编排路径形态（API command → Application 命令 → repository 事务 → 领域事件），不引入新 Workflow/Job 类型。
6. **Web 首页改造为 Board 渲染**：首页按 Board 树渲染 Section/Block（只读 → 编辑两步交付）；编辑模式提供加/删/排序（上移/下移）/隐藏/复制/配置 Block 与 Section 管理；侧栏内容迁入 Block 后首页布局以 Board 为主体。

### 非目标

- 自动 Spotlight policy、Trend Signal、评分/迟滞/TTL 续期（REC-014，Phase 4）；v1 的 `SpotlightPlacement` 保留 `expiresAt` 可空列与 `source` 枚举扩展位，但不实现自动写入路径。
- Workspace/Artifact Block（BRD-005，Phase 3）；Spotlight 指向 Workspace/Artifact（对象尚不存在）。
- 拖拽排序、多列网格布局编辑器（v1 纵向流 + 上移/下移）；Board 级视觉主题与每-Block 自定义样式。
- Board/Query snapshot、Publication、推送（PUB 系列，Phase 5）。
- Feed 反馈（曝光/隐藏/not_interested 记录）、Read State「未读」过滤（依赖 Read State，独立后置项）。
- 协作、权限、多租户（沿用本地单用户边界）。

## 当前行为与证据

- `packages/storage-prisma/prisma/schema.prisma`：现有 model 到 `SavedView`/`WorkflowCompletion` 为止，无 Board/Section/Block/Placement 表。
- `apps/web/src/app/page.tsx:1117-1208`：首页布局硬编码——`aside` 侧栏（StatusSummary/SourceActions/Topics/Entities 列表）+ `FeedBrowser` 主区；全部区块无顺序/可见性/配置控制。
- `apps/api/src/app.controller.ts:533-544`：`GET /feed`、`GET /search`（已支持 `labelIds`/`topicIds`）；`saved-views` CRUD 位于 `:1210-1252`。Feed Block 数据源无需新查询端点（Block 渲染 = 客户端按 SavedView 条件调 `search`）。
- 语义设计已冻结：信息模型 §5.2（BoardPlacement/SpotlightPlacement 与 Topic 字段解耦）、§7（Spotlight = 展示决定，可指向 Story/Topic/Workspace/Artifact，不复制目标内容）、§8.7（看板精华区 = Board Section 展示选中对象）、§9 关系图（`SP/F → B`，Spotlight 与 Feed 流向 Board）、§11 不变量（过期只移除展示位置，不改变内容对象）。
- 前四个切片的已验证模式可复用：受管枚举 + 未知值降级读取（storyKinds/topicMemberRoles/entityTypes）、`baseRevisionId` CAS 不适用于本片（Board 配置无并发冲突诉求，v1 用 last-write + 领域事件即可）、多态 target（LabelAssignment 模式）、merge 迁移（mergeStories 已迁移 CollectionItem/Favorite/LabelAssignment 并重定向 Annotation targetId）。

## 方案与取舍

### 1. 领域层：三层配置 + Placement

- **Board**：`Board` 表保存 id、name（唯一）、可选 description、时间戳。Board 配置彼此独立，底层信息共享（BRD-009 语义提前落进模型）。
- **Section**：`BoardSection` 表保存 boardId、title、position、时间戳。Section 只是「带标题的 Block 容器」，**不设 kind/展示策略字段**——展示策略由其内 Block 类型承载（热点区 = 含 Spotlight Block 的 Section，精华区 = 含 Collection Block 的 Section，普通信息流 = 含 Feed Block 的 Section；同一 Story 可同时出现在三者中，满足 BRD-003「引用相同对象、不同展示策略」）。避免把展示策略误固化到容器上。
- **Block**：`BoardBlock` 表保存 sectionId、`type` 受管枚举（`feed`/`spotlight`/`source-health`/`topic-list`/`collection`，未知值降级读取为「未知区块」占位）、`config` 白名单化 JSON（按 type 判别的 zod union 校验：`feed` 必填 `savedViewId`；`collection` 必填 `collectionId`；`source-health`/`topic-list`/`spotlight` 仅可选 `limit`）、position、`visible` 布尔（隐藏 ≠ 删除）、时间戳。
- **SpotlightPlacement**：`SpotlightPlacement` 表保存 boardId（必填，v1 固定绑定 Board）、targetType 受管枚举（`story`/`topic`）、targetId、`source` 枚举（v1 仅 `manual`，未来扩展 `policy`）、可选 reason、actor、`expiresAt` 可空列（manual 固定为 null，预留自动 policy）、`policyVersion`/信号明细列不建（自动 policy 落地时再加列）、时间戳；唯一约束 `(boardId, targetType, targetId)`（物理删除解除固定，普通唯一约束即成立）。Placement 是展示决定：pin/unpin 不改变 Story/Topic 本身，过期语义 v1 不触发。

**取舍**：Block 用「当前关系表 + position 字段」而非 append-only 事件表——看板配置的当前投影是首页主路径，需要 O(1) 树读取；历史只保留时间戳，v1 不重建配置变更历史链（与 Label/Collection 附加关系同一取舍）。Section 无 kind 是有意收窄：BRD-003 的「区域差异」在 v1 由 Block 类型表达，未来若需要 Section 级策略再加列，不影响既有合同。

### 2. 持久化与迁移

预计改动（以 Task 细化为准，按子切片分 2 条 forward-only migration）：

- 子切片 A：`Board`（name 唯一）、`BoardSection`、`BoardBlock`。
- 子切片 B：`SpotlightPlacement`。

全新表、无既有数据 backfill；migration forward-only、只增不改；每条 migration 按门禁验证 fresh DB + 既有 master 旧库 upgrade 两态。默认 Board（含热点/精华/信息流三 Section 与初始 Block）不在 migration 里 seed，由应用侧幂等 seed 交付（无任何 Board 时创建默认 Board，位置与触发时机以 Task 细化为准）。

### 3. 引用完整性与 merge 一致性

- **删除方向**：删除 Block/Section/Board 只删展示配置行（Section 删除连带其下 Block，Board 删除连带 Section/Block 与本 Board 的 SpotlightPlacement），**不触碰**任何内容对象；删除 SavedView/Collection 不级联删 Block，`config` 中的 id 悬空时读取侧降级（Block 保留并显示「视图/收藏夹已删除」占位，用户可重新配置或移除 Block）。
- **Story merge**（既有 `mergeStories`）：子切片 B 落地后，`mergeStories` 同一事务内把指向 obsolete Story 的 `SpotlightPlacement.targetId` 重定向到 canonical；若与 canonical 既有 placement 冲突（同 board 同 target），丢弃 obsolete 侧重复项——与 Task 13 迁移 `CollectionItem`/`Favorite` 的做法对称。
- **Topic merge**（Task 11 `mergeTopics`）：Spotlight 的 targetType 含 topic，`mergeTopics` 需同样重定向 placement（Task 12/13 未涉及 topic 侧用户数据，本片补齐）。

### 4. 公共边界：Product API command，不引入新 Workflow 类型

看板配置是单机本地事务 + 审计，不产生外部副作用。待 Task 细化的命令形态（版本化、幂等键、输入校验先以 `unknown` 收口）：

- `board.create`、`board.update`、`board.delete`；
- `section.create`、`section.update`（title/position）、`section.delete`；
- `block.create`、`block.update`（config）、`block.move`（可跨 Section）、`block.set-visibility`、`block.duplicate`、`block.delete`；
- `spotlight.placement.create`（pin）、`spotlight.placement.delete`（unpin）；
- 读取：`GET /boards`（列表）、`GET /boards/:boardId`（sections + blocks 树，一次查询）、Spotlight placements 列表（按 board 过滤，附带目标摘要投影（Story/Topic 标题），避免 Web N+1）。

Block 渲染数据源复用既有端点：Feed Block = `search`（按 SavedView 条件）、来源健康 = `listSources`、Topic/Collection = `listTopics`/`listCollections`；不新增内容查询端点。

### 5. Web 最小验证面

- 子切片 A：首页改为按 Board 树渲染（默认 Board seed 后首屏等价于现状的信息密度：信息流 + 来源健康 + Topics/Collection），四类 Block 只读渲染；Board 切换器。
- 子切片 B：编辑模式（进入/退出），提供 Section 增删改名排序、Block 增删/上移下移/跨 Section 移动/隐藏/复制/配置（Feed Block 选 SavedView、Collection Block 选收藏夹）；Spotlight pin/unpin 交互（从 Story/Topic 面板固定到当前 Board 热点区）；组件实验室登记对应场景。
- 现有浏览器 E2E（ingest 流程 8 场景）依赖当前首页 DOM，布局改造后需同步更新选择器与断言——属于本切片验收工作的一部分，不是回归风险。

## 影响

- **产品/API**：新增看板配置写命令与树读取、Spotlight pin/unpin；既有 Feed/Search/Story/Topic/Entity/用户组织路径不变；Web 首页布局由 Board 配置驱动。
- **数据**：新增 4 张表（`Board`/`BoardSection`/`BoardBlock`/`SpotlightPlacement`），分 2 条 migration；不改既有表结构；`mergeStories`/`mergeTopics` 各增一段 placement 迁移。
- **公开合同**：contracts 新增 blockTypes/targetType 受管枚举、config 判别 union、命令与树读取 schema；既有 DTO 不变。
- **安全**：本地单用户最大权限（沿用既有边界）；config 白名单化校验，未知 type/id 降级不抛错；写入审计记录 actor。
- **迁移/回滚**：migration forward-only、全新表无 backfill；回滚只回退代码路径，已建看板配置数据保留。
- **发布**：本切片不涉及发布与部署（后置债）。

## 验收草案（设计通过后归 Task）

- **domain focused**：blockTypes/targetType 枚举校验与未知值降级；Block config 按 type 判别校验（非法 config 拒绝）。
- **storage/迁移**：fresh + 旧库 upgrade（每条 migration）；Board name 唯一；`(boardId, targetType, targetId)` 唯一；Board/Section 级联删除边界（删配置不删内容）；Story/Topic merge 的 placement 重定向与冲突丢弃。
- **contracts/API focused**：命令 Zod 校验、幂等键、白名单投影；Board 树一次读取；placements 附带目标摘要。
- **浏览器**：默认 Board 渲染出三 Section 与初始 Block；调整 Block 顺序/隐藏/复制后刷新保持；Feed Block 按绑定 SavedView 出内容，删除该 SavedView 后 Block 显示降级占位；pin 一个 Topic 到默认 Board 热点区 → Spotlight Block 可见 → 解除后消失；删除 Block 不影响底层 Story/Topic/Collection/SavedView。
- **明确不运行**：Docker/Compose、发布部署、真实公网长时定时、非 Windows 平台 smoke、长时间故障恢复（Phase 1 后置债划线不变）。

## 对稳定文档的预期改动（接受后执行）

- `docs/requirements/0002-product-requirements.md`：BRD-002/003/004/006 注记 v1 已实现边界（自动 policy、Workspace Block、拖拽、snapshot 后置）；§13 待决定事项 3 注记已按「多 Board 实体 + 预置默认 Board」决策。
- `docs/architecture/0002-information-model.md` §5.2/§7/§8.7/§9：注记 v1 实现边界（SpotlightPlacement 手动优先落地，自动 policy 后置；Block type 受管枚举）。
- `docs/adr/`：新增 ADR-0010 可配置看板 v1，沉淀稳定决定（Block 是纯展示配置、Section 无 kind、Spotlight v1 仅 manual + 物理解除 + 绑定 Board、多 Board 实体决策、config 白名单判别）。
- `docs/spec/`：domain/contracts/storage/interfaces 同步新合同；`docs/testing/README.md` 补充浏览器 E2E 边界变化。
- 新建 Phase 2 Task（编号待维护者分配，建议 14）记录实施切片；本 Proposal 状态 reviewing → accepted 前不修改任何代码或稳定文档。

## 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-09 | Spotlight v1 只做人工固定；自动 policy 后置 Phase 4 | 用户 |
| 2026-09-09 | Board 按多实体建模，v1 预置默认 Board 并允许多 Board（提前消化 PRD 待决定事项 3） | 用户 |
| 2026-09-09 | v1 Block 类型 = Feed（绑 SavedView）/ Spotlight / 来源健康 / Topic/Collection 列表 | 用户 |
| 2026-09-09 | 拆 2 个子切片：①域 + API + 只读渲染；②编辑模式 + 人工 Spotlight | 用户 |
| 2026-09-09 | **接受本 Proposal**（含上述四项默认：Spotlight 范围、多 Board 实体、Block 类型清单、两片子切片） | 用户（评审接受） |
