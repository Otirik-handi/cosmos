# Task 13：用户组织 v1（Phase 2 第四切片）

## User Request / Topic

2026-09-08 用户确认：Phase 2 第四切片为「用户组织」= Label/Annotation/Collection/Saved View；Proposal [`label-annotation-collection-saved-view-v1`](../../../docs/proposals/label-annotation-collection-saved-view-v1.md) 经评审接受（三项默认：拆 3 子切片、Annotation 目标范围、收藏语义），稳定决定沉淀于 [`ADR-0009`](../../../docs/adr/0009-user-organization-v1.md)，PRD §7.4 第四切片注记与信息模型 §9 已同步。

## Goal

交付 PRD §7.4「信息库、分类与检索」与 LIB-003/004/005/008 的用户组织层（手动优先）：

```text
Label 分类标签 -> 全局命名注册表 + 多态 LabelAssignment（Story/Entry/Topic）
Collection 命名收藏夹 -> 成员为 Story + Story/Entry 独立轻量收藏标记（Favorite）
Annotation 批注 -> 绑定 Story/Entry/Topic（可编辑笔记 + targetRevisionId + 可选 quote/evidence）
Saved View 持久查询视图 -> 只存查询条件不存快照，search 扩展 labelIds/topicIds
用户编排 -> create/update/delete/attach/detach/set/unset + 列表/详情
```

## Scope / Non-goals

Scope：

- Label：全局命名注册表（name 唯一）+ 多态 `LabelAssignment` 附加到 Story/Entry/Topic（`targetType` 受管枚举 + 未知降级）；批量打标/移除。
- Collection：命名收藏夹（name/可选 description）+ `CollectionItem`（`(collectionId, storyId)` 唯一）；`Favorite`（`(targetType, targetId)` 唯一）表达 Story/Entry 轻量收藏。
- Annotation：绑定 Story/Entry/Topic 的批注，含 `actor`、创建/更新时间、可选 `targetRevisionId`、`quote`、`evidence`；增删改。
- Saved View：命名视图 + 结构化查询条件（text/sourceId/时间范围/labelIds/topicIds），只存条件不存快照；`search` 扩展可选 `labelIds`/`topicIds` 过滤。
- Product API 写命令与读取（label/collection/favorite/annotation/saved-view 的增删改、附加/解除、列表/详情）。
- Web：Story/Entry/Topic 面板打标签/批注/收藏开关；侧栏 Collection 列表 + 从 Story 侧加入集合；搜索页保存/套用 Saved View。

Non-goals（见 Proposal / ADR-0009）：

- 自动分类/标签推荐、`KnowledgeSignal`/Knowledge Workflow（ORG-021，LLM/Agent 后置）。
- Artifact 作为目标（Phase 3 对象）、正文片段字符级锚点（本片用可选 `quote` 文本表达）。
- Read State（`last_seen_revision_id`）驱动的「未读/状态」过滤（LIB-005 部分）。
- Feed Block 绑定 Saved View（BRD-006，依赖可配置看板）、批量导出/删除（LIB-008 部分）。
- 可配置 Board/Section/Block、Spotlight（BRD-002~008）、`TopicRelation`（ORG-015 类型化 Relation 部分）。
- 混合召回/推荐排序（REC 系列 Phase 4）、embedding、多用户权限、审批 UI。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`label-annotation-collection-saved-view-v1`](../../../docs/proposals/label-annotation-collection-saved-view-v1.md)（accepted，2026-09-08）。
- ADR [`0009`](../../../docs/adr/0009-user-organization-v1.md)；ADR [`0006`](../../../docs/adr/0006-story-domain-v1.md)/[`0007`](../../../docs/adr/0007-topic-domain-v1.md)/[`0008`](../../../docs/adr/0008-entity-relation-v1.md)（复用 command/当前关系/唯一附加模式）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) LIB-003/004/005/008、ORG-015、REC-013、§11 数据保留、§7.4 第四切片注记。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §2「用户组织」、§8.2、§9、§11 不变量 16/24。
- 现状 spec：domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10/11/12 交付，本切片扩展）。

## 实施切片（capability map，无环依赖，逐片合入）

1. **子切片 A：Label + Collection + 收藏标记**（domain + migration + storage + contracts + API + Web）
   - domain：`targetType` 受管枚举 + 未知降级、Label/Collection/Favorite 语义、命令输入语义；
   - Prisma：`Label`/`LabelAssignment`/`Collection`/`CollectionItem`/`Favorite` + migration（forward-only、只增不改）；
   - storage 事务命令：label create/delete/attach/detach、collection create/update/delete/add-item/remove-item、favorite set/unset；`mergeStories` 迁移 `CollectionItem`/`Favorite` 并重定向 `LabelAssignment.targetId`；
   - contracts DTO/命令 schema + transport-http + API 端点 + Web（打标签/收藏/集合）。
2. **子切片 B：Annotation**（domain + migration + storage + contracts + API + Web）
   - `Annotation` 表 + migration；annotation create/update/delete 事务命令；DTO/命令 schema；API 端点；Web 批注面板（Story/Entry/Topic）。
3. **子切片 C：Saved View**（migration + storage + contracts + API + Web + search 扩展）
   - `SavedView` 表 + migration；saved-view create/update/delete；`search` 扩展 `labelIds`/`topicIds` 过滤；Web 保存/套用 Saved View。

## Current State

- 生命周期阶段：三个子切片（A Label/Collection/收藏、B Annotation、C Saved View + search 扩展）均已实现并通过门禁；分支 `feat/t13-user-organization`，待维护者授权合入 master。
- 迁移：`20260908140000_user_organization_v1`（5 张表）、`20260908160000_annotation_v1`、`20260908180000_saved_view_v1`，均 forward-only、无 backfill。
- 未运行：浏览器产品 E2E（用户组织流程）、`test:browser:component-lab`、Node 进程 E2E、Windows smoke、Docker/Compose、发布部署（均为既有后置边界）。
- 已知 UI 限制：搜索表单目前没有标签/Topic 选择控件，因此 Web 保存的 Saved View 只含 text/source/date 条件；API 已支持 label/topic 过滤，带这两类 id 的视图套用时会正确传参（记为子切片 C 偏差）。

## Decisions and Deviations

- 以 ADR-0009 六条为稳定边界（targetType 受管枚举 + 未知降级、Label 全局注册表 + 多态附加、Collection 与收藏标记分离、Annotation 用可编辑笔记而非 revision 链、Saved View 只存条件不存快照并扩展 search、自动分类/Artifact/片段锚点/Read State/Feed Block 绑定后置）。
- 交付顺序：3 个子切片逐片合入（Label+Collection → Annotation → Saved View），每片独立验收、独立 commit/merge。
- Story merge 的成员迁移与 targetId 重定向在子切片 A 一并落地（与 ADR-0007/0008 对称）。
- 子切片 A 偏差 1：`StoryDetail` 向后兼容新增 `labels: LabelRef[]` 与 `favorited: boolean`，使 Story 侧用户组织区不必二次查询。
- 子切片 A 偏差 2：用户组织写命令（Label/Collection/Favorite）不带 `actor`/`reason`——它们是单用户本地用户真相，区别于 Story/Topic/Entity 的协作者审计命令；如需协作者审计留待多用户切片。
- 子切片 A 偏差 3：`LabelAssignment`/`Favorite` 不建到目标行的外键（多态 target 无法固定引用），因此删除 Story/Entry/Topic 不会自动清理这些行；Story merge 的显式迁移覆盖了当前唯一会改变 Story id 的路径。
- 子切片 B 偏差：批注删除采用物理删除 + `annotation.deleted.v1` 审计事件（ADR-0009 允许 tombstone 或物理删除）；`StoryDetail` 未追加批注数组，Web 通过 `GET /annotations` 单独读取，避免再改 StoryDetail DTO。
- 子切片 C 偏差：搜索表单暂无标签/Topic 选择控件，Web 保存的视图只含 text/source/date；API 与 storage 已完整支持 label/topic 过滤。

## Verification / Gate

- 每子切片按仓库验证层级：focused（domain/contracts/storage）→ API 集成 → 浏览器；全量门禁至少 typecheck、docs:check、test、build、git diff --check。
- 迁移类改动必须在 `.agent/tmp/` 用含旧数据的隔离库验证 upgrade（全新表，仍跑 fresh + upgrade 两态）。
- `docs/spec/` 在行为落地后同步（domain/0001 扩展、contracts/0001、storage/0001、interfaces/0002/0005）与 `docs/testing/README.md`。

## Implementation Walkthrough（子切片 A，2026-09-08）

实现顺序与提交：

1. `244461c` 领域/存储层：domain 新增 `targetTypes`/`favoriteTargetTypes`；contracts 新增 Label/Collection/Favorite DTO 与 6 个命令 schema，并给 `StoryDetail` 追加 `labels`/`favorited`；application 新增 4 个错误类与 16 个 repository 端口方法；Prisma 新增 5 张表 + migration `20260908140000_user_organization_v1`；storage 实现 label/collection/favorite 事务命令与 `mergeStories` 的 `CollectionItem`/`Favorite`/`LabelAssignment` 迁移，`story()` 投影 labels/favorited。
2. `1401022` API/transport 层：transport client 新增 14 个方法；`apps/api` 新增 18 个端点（labels、label-assignments、collections、items、favorites），全部经 `sourceCommandError` 漏斗映射 400/404/409/500。
3. `1a9735d` Web 层：`page.tsx` 加载 labels/collections 并新增 7 个处理器；`story-panel.tsx` 新增“用户组织”区（收藏开关、标签增删/新建、收藏夹成员勾选/新建），全部 props 可选。
4. `d3d183f` 文档同步：`docs/spec` 五个文件 + `docs/testing/README.md` + 本 Task。

验证（2026-09-08，实际运行）：

- `bun run typecheck` 全仓通过（packages + apps，含 web `tsc --noEmit`）。
- `bun run test` 全量 43 文件 / 368 用例全部通过（本轮无 Windows SQLite 抖动）；其中 `user-organization-domain.test.ts` 5 用例、domain 9、contracts 24、transport-http 8、api controller 29、component-lab 27。
- `bun run build` 通过（含 Next standalone）；`bun run lint:web` 0 error（2 个既有 warning）；`bun run docs:check` 339 文件 failures=[]；`git diff --check` 干净。
- 迁移：`bun run db:validate` 通过；隔离库 `prisma migrate deploy` 应用 `20260908140000_user_organization_v1` 成功（storage 行为测试的 setup 即该路径）。

未运行：浏览器产品 E2E（用户组织流程）、`test:browser:component-lab`、Node 进程 E2E、Windows smoke、Docker/Compose、发布部署。

## Implementation Walkthrough（子切片 B：Annotation，2026-09-08）

1. 后端层（`a58438a` 前一提交）：Prisma `Annotation` 表 + migration `20260908160000_annotation_v1`；contracts 新增 `Annotation`/`AnnotationList` DTO 与 `CreateAnnotationCommand`/`UpdateAnnotationCommand`/`AnnotationTargetQuery`；application 新增 `AnnotationNotFoundError` 与 4 个 repository 方法；storage 实现 create（Story 目标固定写入当时 `currentRevisionId`）/update/delete/list，并把 Story merge 时的批注 `targetId` 重定向到 canonical；transport client 4 个方法；API 4 个端点（GET/POST `/annotations`、PATCH `/annotations/:id`、POST `/annotations/:id/removals`）。
2. Web 层（`a58438a`）：`page.tsx` 新增 story/topic 批注状态与 6 个处理器，打开 Story/Topic 时按 canonical id 加载批注；StoryPanel/TopicPanel 新增“批注”区（列表含正文/引用/作者/时间，新建/编辑/删除），全部 props 可选。
3. 文档同步：`docs/spec` 四文件 + `docs/testing/README.md` + 本 Task。

验证（2026-09-08，实际运行）：`bun run typecheck` 全仓通过；聚焦 `bunx vitest run packages/contracts packages/transport-http apps/api/src/app.controller.test.ts packages/storage-prisma/src/user-organization-domain.test.ts` 全部通过（contracts 36、transport 9、api controller 30、storage 7）；`bun run lint:web` 0 error（2 个既有 warning）；component-lab 27 通过；`git diff --check` 干净。子切片 B 收尾前会再跑一次全量 `bun run test`、`bun run build`、`bun run docs:check`。

## Implementation Walkthrough（子切片 C：Saved View + search 扩展，2026-09-08）

1. 后端层：Prisma `SavedView` 表 + migration `20260908180000_saved_view_v1`；contracts 新增 `SavedView`/`SavedViewList`/`SavedViewConditions` 与 create/update 命令，并给 `SearchQuery` 增加 `labelIds`/`topicIds`（逗号分隔 id）；application 新增 `SavedViewNotFoundError` 与 4 个 repository 方法；storage 实现 CRUD 与 `search` 的 EXISTS 子查询过滤（Story 级标签 + active Topic 成员，any-of 语义）；transport client 4 个方法并把 label/topic 参数加入 search 查询串；API 4 个端点（search 参数透传无需改动）。
2. Web 层：`page.tsx` 新增 savedViews 状态与保存/套用/删除处理器；`feed-browser.tsx` 增加可选 `searchExtras` 插槽，搜索卡内渲染“已保存视图”区块。
3. 文档同步：`docs/spec` 四文件 + `docs/testing/README.md` + 本 Task。

验证（2026-09-08，实际运行）：`bun run typecheck` 全仓通过；聚焦 `bunx vitest run packages/contracts packages/transport-http apps/api/src/app.controller.test.ts packages/storage-prisma/src/user-organization-domain.test.ts` 全部通过（contracts 37、transport 10、api controller 31、storage 8）；`bun run lint:web` 0 error（2 个既有 warning）；component-lab 27 通过；`git diff --check` 干净。

## 三个子切片收尾门禁（2026-09-08，实际运行）

- `bun run typecheck` 全仓通过；`bun run build` 通过（含 Next standalone）；`bun run lint:web` 0 error（2 个既有 warning）；`bun run docs:check` 341 文件 failures=[]；`git diff --check` 干净。
- 聚焦测试：domain 9、contracts 37、transport-http 10、api controller 31、component-lab 27、storage `user-organization-domain` 8 全部通过。
- 全量 `bun run test`：43 文件 / 377 用例，370 通过；7 例失败全部是已知 Windows SQLite 并行负载抖动（5 个 storage-prisma 迁移测试文件的 setup `migrate deploy` 5s 超时 + EBUSY unlink），串行重跑这 6 个文件 39/39 通过（`entity-relation-domain` 5、`index` 18、`story-orchestration` 2、`story-revision-versioning` 1、`topic-domain` 5、`user-organization-domain` 8），与 `PROJECT-STATUS.md` 已记录的既有环境问题一致，非功能回归。
- 未运行：浏览器产品 E2E（用户组织流程）、`test:browser:component-lab`、Node 进程 E2E、Windows smoke、Docker/Compose、发布部署。

## Follow-ups

- 浏览器产品 E2E（用户组织流程）与人工浏览器验收留待后续。
- 后续 Phase 2 切片：可配置 Board/Spotlight（BRD-006 Feed Block 绑定）、自动聚类/Knowledge Workflow、Entity merge/dedup、`evidence_for`/`mentions`。
- 后续能力：Artifact 目标、正文片段字符级锚点、Read State「未读」过滤、批量导出/删除（LIB-008 部分）。
