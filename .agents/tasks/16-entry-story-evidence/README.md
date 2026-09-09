# Task 16：Entry↔Story 证据关系 v1（evidence_for / mentions，Phase 2 第六切片）

## User Request / Topic

2026-09-09 用户确认启动 Phase 2 下一切片，并评审接受 Proposal [`evidence-for-mentions-v1`](../../../docs/proposals/evidence-for-mentions-v1.md) 的六项默认建议；稳定决定沉淀于 [`ADR-0011`](../../../docs/adr/0011-entry-story-evidence-v1.md)，PRD §7.5 第六切片注记与信息模型 §4.4/§9 注记已同步。

## Goal

交付 ORG-011（以及被它阻塞的 ORG-005/ORG-022 数据落点）：

```text
Entry↔Story 证据关系 -> (entryId, storyId) 唯一 + 受管类型 evidence_for/mentions + provenance
主归属不变          -> Entry.storyId 仍是唯一主归属；禁止指向自己的主 Story
读取投影            -> StoryDetail 证据来源 + EntryDetail 关联 Story（同一张表）
一致性              -> mergeStories 同事务重定向；moveEntryToStory 删除冗余关系
Product API + Web   -> entry-story-links 写命令 + Story 面板「证据来源」区块
```

## Scope / Non-goals

Scope：

- `EntryStoryLink` 表：`(entryId, storyId)` 唯一 + `relationType` 受管枚举 + `producer`/`producerVersion`/`confidence`/`evidence`/`actorJson`/`reason`。
- domain：`entryStoryRelationTypes = ["evidence_for", "mentions"]` + 未知值降级读取。
- contracts：`entryStoryRelationTypeSchema`、`linkEntryStoryCommandSchema`/`unlinkEntryStoryCommandSchema`、`StoryDetail.evidence`、`EntryDetail.relatedStories`。
- storage：link/unlink 幂等命令（canonical 解析 + 自关联 409 + 存在性校验）、Story/Entry 读取投影、`mergeStories` 重定向、`moveEntryToStory` 冗余删除。
- transport-http + API：`POST /api/v1/entry-story-links`、`POST /api/v1/entry-story-links/removals`。
- Web：Story 面板「证据来源」区块（列出/解除/从最近条目添加）+ 成员列表显示反向关联；组件实验室登记。
- 文档：`docs/spec`（domain/contracts/storage/interfaces）、`docs/testing`、`PROJECT-STATUS`。

Non-goals（见 Proposal / ADR-0011）：

- 正文片段字符级锚点（v1 用可选 `evidence` 文本字段）。
- 自动抽取/提议流（ORG-021 Knowledge Workflow）。
- Story↔Story 类型化关系（信息模型 §4.5 `followed_by`/`background_for`）。
- Story split 的关系迁移（split 尚未实现）。
- Artifact/Workspace 目标、多用户权限、审批 UI、embedding。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`evidence-for-mentions-v1`](../../../docs/proposals/evidence-for-mentions-v1.md)（accepted，2026-09-09）。
- ADR [`0011`](../../../docs/adr/0011-entry-story-evidence-v1.md)；ADR [`0006`](../../../docs/adr/0006-story-domain-v1.md)（主归属单外键）与 [`0008`](../../../docs/adr/0008-entity-relation-v1.md)（当前关系 + provenance 模式）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) ORG-005/011/022 与 §7.5 第六切片注记。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §4.4/§4.5/§9/§11。
- 现状 spec：domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10–15 交付，本切片扩展）。

## 实施切片（capability map，无环依赖）

1. **切片 1：域语义 + 持久化**（domain + migration + storage，无公共面）
   - domain：`entryStoryRelationTypes` 受管枚举 + 未知降级；
   - Prisma：`EntryStoryLink` + migration（forward-only、全新表无 backfill）；
   - storage 事务命令：link/unlink（幂等、canonical 解析、自关联 409）；Story/Entry 读取投影；`mergeStories` 重定向（冲突丢弃）；`moveEntryToStory` 删除冗余关系。
2. **切片 2：公共合同与 Product API**（contracts + transport-http + apps/api）
   - 命令 schema 与两个读取字段；transport client；API 端点与错误映射。
3. **切片 3：Web + 组件实验室**
   - Story 面板「证据来源」区块与成员反向关联；组件实验室 fixture 与登记；浏览器 E2E。

## Current State

- 生命周期阶段：切片 1（域 + 持久化）、切片 2（合同 + API + transport）与切片 3（Web + 浏览器 E2E）均已实现并通过门禁；等待 commit/合入授权。
- 连贯目标：让一个 Entry 可以作为证据/提及关联多个其它 Story，且主归属与一致性语义不变。
- 可观察验收（≤3 条）：
  1. 一篇长文（document Story 成员）关联到另一个 event Story 后，event Story 详情「证据来源」出现该条目并标注类型与理由；解除后消失；
  2. 同一 Entry 指向自己主 Story 的写入返回 409；
  3. merge 后关系跟随 canonical，move 后指向新主 Story 的关系被删除。
- 依赖：Task 10（Entry 主归属与 Story merge）、Task 12（story-entity-links 形态参照）、Task 13（`GET /entries` 列表用于 Web 候选）。
- 受影响合同：contracts（新枚举/命令/两个读取字段）、application（repository 端口）、storage-prisma（新表 + 命令 + merge/move 事务）、api（新端点）、transport-http（client 方法）、web（Story 面板）。
- 验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器 → 全量门禁（已执行，见下）。

## Decisions and Deviations

- 以 ADR-0011 六条为稳定边界（`(entryId, storyId)` 唯一一语义、关系挂稳定身份、禁止自关联、merge 重定向 + move 冗余删除、手动优先、两个读取投影）。
- 读取投影选 StoryDetail 正向 + EntryDetail 反向（同一张表两次查询），Web 反向视图复用 Story 面板已加载的成员数据，不额外发请求。
- `linkEntryStory`/`unlinkEntryStory` 返回 canonical `StoryDetail`（而非 `EntryDetail`）：Story 面板是主要消费方，一次往返即可刷新证据列表与成员反向视图；与 `linkStoryEntity` 返回 Entity 侧的形态不同，记为偏差。
- Web 添加证据用「从最近条目下拉选择」而不是粘贴 Entry ID：`EntryDetail` 不暴露主归属 Story id，而 `GET /entries` 列表项带 `storyId` 与标题，可同时用于候选与排除本 Story 成员。
- 变更记录（实施过程偏差）见下。

## Implementation Walkthrough（2026-09-09）

1. **持久化层**：`schema.prisma` 新增 `EntryStoryLink`（`(entryId, storyId)` 唯一 + relationType + provenance + `(storyId)` 索引），`Entry`/`Story` 各加反向关系字段；migration `20260909140000_entry_story_evidence_v1`（forward-only、全新表无 backfill、双外键级联删除）。
2. **domain**：新增 `entryStoryRelationTypes = ["evidence_for", "mentions"]` 受管枚举 + 未知降级。
3. **contracts**：新增 `entryStoryRelationTypeSchema`、`entryStoryLinkProvenanceSchema`、`storyEvidenceSchema`、`entryRelatedStorySchema`、`linkEntryStoryCommandSchema`/`unlinkEntryStoryCommandSchema`；`storyDetailSchema` 增 `evidence`、`entryDetailSchema` 增 `relatedStories`（均向后兼容）。
4. **application**：新增 `EntryStoryLinkConflictError`（`code: "conflict"`）与 `linkEntryStory`/`unlinkEntryStory` 端口。
5. **storage**：`linkEntryStory`（canonical 解析 + Entry/Story 存在性 + 自关联 409 + 幂等/覆盖写 + `entry.story_linked.v1`）、`unlinkEntryStory`（物理解除 + `entry.story_unlinked.v1`）；`story()` 投影 `evidence` 与成员 `relatedStories`（一次查询后内存分组），`entry()` 投影 `relatedStories`；`mergeStories` 同事务重定向（冲突丢弃 + `entry_story.merged.v1`）并清理 self-link；`moveEntryToStory` 删除指向新主 Story 的冗余关系（`cause: primary_story_changed`）。
6. **transport/API**：client 新增两个方法（返回 `StoryDetail`）；API 新增 `POST /entry-story-links` 与 `/entry-story-links/removals`，经 `sourceCommandError` 映射 400/404/409。
7. **Web**：StoryPanel 新增「证据来源」区块（列表 + 解除 + 从最近条目下拉添加 + 关系类型选择）；来源成员列表每条成员显示反向关联（`relatedStories`）；`page.tsx` 打开 Story 时并行拉取 `GET /entries` 生成候选并排除本 Story 成员，写命令返回的 StoryDetail 直接刷新面板。
8. **文档**：ADR-0011 + ADR 索引、PRD §7.5 第六切片注记、信息模型 §4.4/§9 注记、`docs/spec`（domain/0001、contracts/0001、storage/0001、interfaces/0002/0004/0005）、`docs/testing/README.md` 与 `PROJECT-STATUS.md`。

## Verification / Gate

验证（2026-09-09，实际运行）：

- `bun run typecheck` 全仓通过；`bun run lint:web` 0 error（2 个既有 warning）；`bun run build`（含 Next standalone）通过；`bun run docs:check` 359 文件 failures=[]；`git diff --check` 干净。
- focused：domain 11/11（新增枚举用例）、contracts 31/31（新增命令与双向投影用例）、transport-http 13/13（新增端点用例）、api controller 34/34（新增 2 例）、storage `entry-story-evidence` 6/6、component-lab registry 12/12 全部通过。
- 全量 `bun run test`：47 文件 / 410 用例，364 通过；46 例失败全部集中在 storage-prisma 的 `prisma migrate deploy` 5s 超时 + EBUSY（既有 Windows SQLite 并行负载抖动），`bunx vitest run --no-file-parallelism packages/storage-prisma` 串行 11 文件 / 99 用例全部通过。
- 浏览器产品 E2E：`COSMOS_E2E_WEB_PORT=4194 bunx playwright test --config playwright.config.ts` **12/12 通过**（新增“从另一条 Story 的条目添加证据 + 反向视图 + 解除”用例）。
- 组件实验室浏览器：`bun run test:browser:component-lab` **13/13 通过**。
- Node 进程 E2E：`BUN_BINARY=<真实 bun.exe> bun run test:e2e` **4/4 通过**。
- 未运行：Windows Node smoke（`scripts/smoke-node.ps1`）、Docker/Compose、发布部署（均为既有后置边界）。

## Follow-ups

- 正文片段字符级锚点、自动抽取（ORG-021）、Story↔Story 类型化关系、Story split 的关系迁移按 ADR-0011 Revisit Gate 评估。
- Phase 2 需求清单其余条目：Story split、subtype 注册表、自动聚类；平台面（Trigger/Connection/StateStore/媒体策略/Run 控制/OPS）继续按 `PROJECT-STATUS.md` 排序。
